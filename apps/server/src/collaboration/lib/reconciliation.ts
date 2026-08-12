// ─── Reconciliation Engine ────────────────────────────────────────────────────
// When a user saves from Working mode, this module applies changes to an
// existing Y.Doc, preserving comment anchors.
//
// Flow:
//   0. Global unique exact match — re-anchor all comments whose anchorText
//      exists uniquely anywhere in the NEW document (before any clearing)
//   1. Update meta
//   2. Reconcile each rich-text fragment (context + description fields) —
//      clear-and-rebuild with diff-based comment re-anchoring
//   3. Reconcile structured arrays (requirements/tasks) — match by ID,
//      diff titles, reconcile description fragments
//   4. Replace change_log / spec_analysis (not commentable)
//   5. Heal remaining comments (cross-block search fallback — safety net)

import { Logger } from '@nestjs/common';
import * as Y from 'yjs';
import DiffMatchPatch from 'diff-match-patch';
import { parseArtifactYAML } from './yaml-to-ydoc.js';
import { healAllComments, type HealingResult } from './comment-healing.js';
import {
  populateFragmentFromMarkdown,
  extractFlatText,
  markdownToPmJson,
  extractFlatTextFromPmJson,
  type FlatTextResult,
  type TextSegment,
} from './markdown-to-ydoc.js';
import { RICH_TEXT_FIELDS, fragmentName } from './constants.js';

const logger = new Logger('Reconciliation');
const dmp = new DiffMatchPatch();

export interface ReconciliationResult {
  healingResult: HealingResult;
  contextUpdated: boolean;
  commentsRemapped: number;
  requirementsMatched: number;
  requirementsAdded: number;
  requirementsRemoved: number;
  tasksMatched: number;
  tasksAdded: number;
  tasksRemoved: number;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function reconcileYamlIntoYDoc(
  doc: Y.Doc,
  newYamlString: string,
  clientYjsState?: Uint8Array,
): ReconciliationResult {
  const parsed = parseArtifactYAML(newYamlString);

  const result: ReconciliationResult = {
    healingResult: { totalComments: 0, active: 0, outdated: 0, healed: 0 },
    contextUpdated: false,
    commentsRemapped: 0,
    requirementsMatched: 0,
    requirementsAdded: 0,
    requirementsRemoved: 0,
    tasksMatched: 0,
    tasksAdded: 0,
    tasksRemoved: 0,
  };

  // Track which comment IDs were already re-anchored
  const alreadyHealedIds = new Set<string>();

  doc.transact(() => {
    // ─── Step 0: Global unique exact match ─────────────────────────
    // Before clearing any fragments, collect ALL comments and search
    // for their anchorText in the NEW document. If unique → re-anchor.
    // This handles cross-fragment moves (e.g., text moved from context
    // to a requirement description, or between requirements).
    const step0Count = globalExactMatchReanchor(doc, parsed, clientYjsState, alreadyHealedIds);
    result.commentsRemapped += step0Count;

    // ─── 1. Update Meta ─────────────────────────────────────────────
    updateMeta(doc, parsed.meta);

    // ─── 2. Reconcile Context ───────────────────────────────────────
    const newContextMarkdown = normalizeContextBlocks(parsed.context).join('\n\n');
    const contextResult = reconcileFragment(
      doc, 'context', newContextMarkdown, clientYjsState, alreadyHealedIds,
    );
    result.contextUpdated = contextResult.updated;
    result.commentsRemapped += contextResult.commentsRemapped;
    for (const id of contextResult.remappedCommentIds) {
      alreadyHealedIds.add(id);
    }

    // ─── 3. Reconcile Requirements ──────────────────────────────────
    const reqResult = reconcileStructuredArray(
      doc, 'requirements',
      doc.getArray('requirements'),
      (parsed.requirements ?? []) as unknown as StructuredItem[],
      clientYjsState, alreadyHealedIds,
    );
    result.requirementsMatched = reqResult.matched;
    result.requirementsAdded = reqResult.added;
    result.requirementsRemoved = reqResult.removed;
    result.commentsRemapped += reqResult.commentsRemapped;

    // ─── 4. Reconcile Tasks ─────────────────────────────────────────
    const taskResult = reconcileStructuredArray(
      doc, 'task_list',
      doc.getArray('task_list'),
      (parsed.task_list ?? []) as unknown as StructuredItem[],
      clientYjsState, alreadyHealedIds,
    );
    result.tasksMatched = taskResult.matched;
    result.tasksAdded = taskResult.added;
    result.tasksRemoved = taskResult.removed;
    result.commentsRemapped += taskResult.commentsRemapped;

    // ─── 5. Replace Change Log (not commentable) ────────────────────
    replacePlainArray(
      doc.getArray('change_log'),
      (parsed.change_log ?? []) as unknown as Record<string, unknown>[],
    );

    // ─── 6. Replace Spec Analysis (not commentable) ─────────────────
    replacePlainArray(
      doc.getArray('spec_analysis'),
      (parsed.spec_analysis ?? []) as unknown as Record<string, unknown>[],
    );

    // ─── 7. Heal remaining comments (safety net) ────────────────────
    result.healingResult = healAllComments(doc, alreadyHealedIds);
  });

  return result;
}

// ─── Step 0: Global Unique Exact Match ──────────────────────────────────────
// Before any fragment is cleared, build the combined flat text of the NEW
// document and re-anchor comments whose anchorText is unique across the
// entire new document.

function globalExactMatchReanchor(
  doc: Y.Doc,
  parsed: ReturnType<typeof parseArtifactYAML>,
  clientYjsState: Uint8Array | undefined,
  alreadyHealedIds: Set<string>,
): number {
  // 1. Build combined new flat text from ALL new fragments
  const newFragments = collectNewFragmentTexts(parsed, clientYjsState);
  const combinedNewText = newFragments.map((f) => f.text).join('\n');

  // 2. Collect ALL comments from the Y.Doc
  const commentsMap = doc.getMap('comments');
  const allComments: Array<{ commentMap: Y.Map<unknown>; commentId: string; anchorText: string }> = [];

  for (const [key, value] of commentsMap.entries()) {
    if (key === '_initialized') continue;
    if (!(value instanceof Y.Array)) continue;
    const arr = value as Y.Array<Y.Map<unknown>>;
    for (let i = 0; i < arr.length; i++) {
      const m = arr.get(i) as Y.Map<unknown>;
      if (!(m instanceof Y.Map)) continue;
      const anchorText = (m.get('anchorText') as string) || '';
      const commentId = (m.get('id') as string) || '';
      if (anchorText && commentId) {
        allComments.push({ commentMap: m, commentId, anchorText });
      }
    }
  }

  if (allComments.length === 0) return 0;

  // 3. Build new fragments as XmlFragments in a temp doc so we can create
  //    Yjs relative positions for re-anchoring. We need actual Y.XmlText nodes.
  const tempDoc = new Y.Doc();
  const tempFragmentInfos: Array<{
    fragmentKey: string;
    fragment: Y.XmlFragment;
    flat: FlatTextResult;
    globalOffset: number; // offset in combinedNewText
  }> = [];

  let globalOffset = 0;
  for (const nf of newFragments) {
    const frag = tempDoc.getXmlFragment(nf.fragmentKey);
    if (nf.markdown.trim().length > 0) {
      if (clientYjsState && nf.fragmentKey) {
        // Try to copy from client Y.Doc
        const clientDoc = new Y.Doc();
        Y.applyUpdate(clientDoc, clientYjsState);
        const clientFrag = clientDoc.getXmlFragment(nf.fragmentKey);
        if (clientFrag.length > 0) {
          copyYFragment(clientFrag, frag);
        } else {
          populateFragmentFromMarkdown(frag, nf.markdown);
        }
        clientDoc.destroy();
      } else {
        populateFragmentFromMarkdown(frag, nf.markdown);
      }
    }
    const flat = extractFlatText(frag);
    tempFragmentInfos.push({ fragmentKey: nf.fragmentKey, fragment: frag, flat, globalOffset });
    globalOffset += flat.text.length + 1; // +1 for the \n separator
  }

  // 4. For each comment, check if anchorText is unique in combinedNewText
  let remappedCount = 0;

  for (const { commentMap, commentId, anchorText } of allComments) {
    if (alreadyHealedIds.has(commentId)) continue;

    const firstIdx = combinedNewText.indexOf(anchorText);
    if (firstIdx === -1) continue;
    if (combinedNewText.lastIndexOf(anchorText) !== firstIdx) continue; // not unique

    // Found uniquely — determine which fragment and segment it belongs to
    for (const fi of tempFragmentInfos) {
      const localIdx = fi.flat.text.indexOf(anchorText);
      if (localIdx === -1) continue;
      if (fi.flat.text.lastIndexOf(anchorText) !== localIdx) continue;

      // Find the segment containing this position
      const seg = fi.flat.segments.find(
        (s) => localIdx >= s.start && localIdx < s.end,
      );
      if (!seg) continue;

      const localStart = localIdx - seg.start;
      const localEnd = localStart + anchorText.length;
      if (localEnd > seg.end - seg.start) continue;

      // We can't create relative positions in the temp doc and use them in
      // the real doc — they reference different Y.XmlText instances.
      // Instead, store the fragment key + offset for re-anchoring AFTER
      // the real fragment is rebuilt. For now, just mark as "will be handled"
      // and store the target info on the comment map temporarily.
      commentMap.set('_step0_fragmentKey', fi.fragmentKey);
      commentMap.set('_step0_offset', localIdx);
      commentMap.set('status', 'active');
      alreadyHealedIds.add(commentId);
      remappedCount++;

      logger.debug(
        `[reconcile] Step 0: Comment "${commentId}" (anchor: "${anchorText}") — ` +
        `GLOBAL UNIQUE MATCH in fragment "${fi.fragmentKey}" at offset ${localIdx}`,
      );
      break;
    }
  }

  tempDoc.destroy();
  return remappedCount;
}

/**
 * Collect flat text for all new fragments from the parsed YAML.
 * Returns one entry per rich-text fragment (context + each description).
 */
function collectNewFragmentTexts(
  parsed: ReturnType<typeof parseArtifactYAML>,
  clientYjsState?: Uint8Array,
): Array<{ fragmentKey: string; text: string; markdown: string }> {
  const results: Array<{ fragmentKey: string; text: string; markdown: string }> = [];

  // Context
  const contextMd = normalizeContextBlocks(parsed.context).join('\n\n');
  if (contextMd.trim().length > 0) {
    const text = getNewFlatText('context', contextMd, clientYjsState);
    results.push({ fragmentKey: 'context', text, markdown: contextMd });
  }

  // Requirements descriptions
  if (parsed.requirements) {
    for (const req of parsed.requirements) {
      const md = (req as unknown as StructuredItem).description ?? '';
      if (md.trim().length > 0) {
        const key = fragmentName('requirements', (req as unknown as StructuredItem).id, 'description');
        const text = getNewFlatText(key, md, clientYjsState);
        results.push({ fragmentKey: key, text, markdown: md });
      }
    }
  }

  // Task descriptions
  if (parsed.task_list) {
    for (const task of parsed.task_list) {
      const md = (task as unknown as StructuredItem).description ?? '';
      if (md.trim().length > 0) {
        const key = fragmentName('task_list', (task as unknown as StructuredItem).id, 'description');
        const text = getNewFlatText(key, md, clientYjsState);
        results.push({ fragmentKey: key, text, markdown: md });
      }
    }
  }

  return results;
}

/**
 * Get flat text for a new fragment — from client yjsState if available,
 * else parsed from markdown.
 */
function getNewFlatText(
  fragKey: string,
  markdown: string,
  clientYjsState?: Uint8Array,
): string {
  if (clientYjsState) {
    const clientDoc = new Y.Doc();
    Y.applyUpdate(clientDoc, clientYjsState);
    const clientFrag = clientDoc.getXmlFragment(fragKey);
    if (clientFrag.length > 0) {
      const flat = extractFlatText(clientFrag);
      clientDoc.destroy();
      return flat.text;
    }
    clientDoc.destroy();
  }
  const pmJson = markdownToPmJson(markdown);
  return extractFlatTextFromPmJson(pmJson);
}

// ─── Fragment Reconciliation (Clear-and-Rebuild) ────────────────────────────
// Generic: works for context, requirement descriptions, task descriptions,
// or any future rich-text fragment.

interface FragmentReconcileResult {
  updated: boolean;
  commentsRemapped: number;
  remappedCommentIds: string[];
}

export function reconcileFragment(
  doc: Y.Doc,
  fragKey: string,
  newMarkdown: string,
  clientYjsState?: Uint8Array,
  alreadyHealedIds?: Set<string>,
): FragmentReconcileResult {
  const fragment = doc.getXmlFragment(fragKey);
  const noResult: FragmentReconcileResult = {
    updated: false,
    commentsRemapped: 0,
    remappedCommentIds: [],
  };

  if (newMarkdown.trim().length === 0 && fragment.length === 0) return noResult;

  // 1. Extract flat text from OLD fragment
  const oldFlat = extractFlatText(fragment);

  // 2. Get new flat text
  const newFlatText = getNewFlatText(fragKey, newMarkdown, clientYjsState);

  // 3. If text content is identical, skip rebuild (but still finalize Step 0 comments)
  const textIdentical = oldFlat.text === newFlatText;
  logger.debug(
    `[reconcile] Fragment "${fragKey}": Old ${oldFlat.text.length} chars, ` +
    `New ${newFlatText.length} chars. Identical: ${textIdentical}`,
  );

  // 4. Build position map from diff
  const positionMap = textIdentical ? null : buildPositionMap(oldFlat.text, newFlatText);

  // 5. Collect comments for THIS fragment
  const commentPositions = collectFragmentCommentPositions(doc, fragKey, oldFlat);

  // 6. Map each comment through the diff (only those not already handled by Step 0)
  const mappedComments = commentPositions
    .filter((cp) => !alreadyHealedIds || !alreadyHealedIds.has(cp.commentId))
    .map((cp) => ({
      ...cp,
      mappedStart: positionMap
        ? mapPositionThroughDiff(positionMap, cp.globalStart)
        : cp.globalStart,
      mappedEnd: positionMap
        ? mapPositionThroughDiff(positionMap, cp.globalEnd)
        : cp.globalEnd,
    }));

  // 7. Clear fragment and rebuild
  if (fragment.length > 0) {
    fragment.delete(0, fragment.length);
  }

  if (clientYjsState) {
    const clientDoc = new Y.Doc();
    Y.applyUpdate(clientDoc, clientYjsState);
    const clientFrag = clientDoc.getXmlFragment(fragKey);
    if (clientFrag.length > 0) {
      copyYFragment(clientFrag, fragment);
    } else if (newMarkdown.trim().length > 0) {
      populateFragmentFromMarkdown(fragment, newMarkdown);
    }
    clientDoc.destroy();
  } else if (newMarkdown.trim().length > 0) {
    populateFragmentFromMarkdown(fragment, newMarkdown);
  }

  // 8. Extract fresh flat text from rebuilt fragment
  const freshFlat = extractFlatText(fragment);

  // 9. Finalize Step 0 comments — they were marked with _step0_fragmentKey
  //    but need actual Yjs relative positions now that the fragment is rebuilt.
  const remappedIds: string[] = [];
  finalizeStep0Comments(doc, fragKey, freshFlat, remappedIds);

  // 10. Re-anchor remaining comments via diff mapping
  logger.debug(
    `[reconcile] Fragment "${fragKey}": Re-anchoring ${mappedComments.length} comments ` +
    `via diff. Fresh text: ${freshFlat.text.length} chars, ${freshFlat.segments.length} segments`,
  );

  for (const mc of mappedComments) {
    const logPrefix = `[reconcile] Comment "${mc.commentId}" (anchor: "${mc.anchorText}")`;

    // Diff-based position mapping
    if (mc.mappedStart === null || mc.mappedEnd === null) {
      logger.debug(`${logPrefix} — SKIPPED: mapped position is null`);
      continue;
    }
    if (mc.mappedStart >= mc.mappedEnd) {
      logger.debug(`${logPrefix} — SKIPPED: empty range after mapping [${mc.mappedStart},${mc.mappedEnd}]`);
      continue;
    }

    const targetSegment = freshFlat.segments.find(
      (seg) => mc.mappedStart! >= seg.start && mc.mappedStart! < seg.end,
    );
    if (!targetSegment) {
      logger.debug(`${logPrefix} — SKIPPED: no segment for mapped position ${mc.mappedStart}`);
      continue;
    }

    const localStart = mc.mappedStart - targetSegment.start;
    const localEnd = Math.min(mc.mappedEnd - targetSegment.start, targetSegment.end - targetSegment.start);
    if (localStart < 0 || localEnd <= localStart) {
      logger.debug(`${logPrefix} — SKIPPED: invalid local range [${localStart},${localEnd}]`);
      continue;
    }

    const newStartRel = Y.createRelativePositionFromTypeIndex(targetSegment.ytext, localStart, 0);
    const newEndRel = Y.createRelativePositionFromTypeIndex(targetSegment.ytext, localEnd, -1);
    mc.commentMap.set('startRel', Y.encodeRelativePosition(newStartRel));
    mc.commentMap.set('endRel', Y.encodeRelativePosition(newEndRel));

    const delta = targetSegment.ytext.toDelta() as Array<{ insert: string }>;
    const plainText = delta.filter((op) => typeof op.insert === 'string').map((op) => op.insert).join('');
    const newAnchorText = plainText.substring(localStart, localEnd);
    if (newAnchorText.length > 0) {
      mc.commentMap.set('anchorText', newAnchorText);
    }

    logger.debug(
      `${logPrefix} — DIFF MAPPED: [${mc.globalStart},${mc.globalEnd}] → ` +
      `[${mc.mappedStart},${mc.mappedEnd}] → local [${localStart},${localEnd}] → "${newAnchorText}"`,
    );

    mc.commentMap.set('status', 'active');
    remappedIds.push(mc.commentId);
  }

  return {
    updated: true,
    commentsRemapped: remappedIds.length,
    remappedCommentIds: remappedIds,
  };
}

/**
 * Finalize Step 0 comments: find comments tagged with _step0_fragmentKey
 * matching this fragment and create real Yjs relative positions.
 */
function finalizeStep0Comments(
  doc: Y.Doc,
  fragKey: string,
  freshFlat: FlatTextResult,
  remappedIds: string[],
): void {
  const commentsMap = doc.getMap('comments');

  for (const [, value] of commentsMap.entries()) {
    if (!(value instanceof Y.Array)) continue;
    const arr = value as Y.Array<Y.Map<unknown>>;

    for (let i = 0; i < arr.length; i++) {
      const m = arr.get(i) as Y.Map<unknown>;
      if (!(m instanceof Y.Map)) continue;

      const targetKey = m.get('_step0_fragmentKey') as string | undefined;
      if (targetKey !== fragKey) continue;

      const offset = m.get('_step0_offset') as number;
      const anchorText = (m.get('anchorText') as string) || '';
      const commentId = (m.get('id') as string) || '';

      // Find the segment containing this offset
      const seg = freshFlat.segments.find(
        (s) => offset >= s.start && offset < s.end,
      );
      if (!seg) {
        logger.debug(`[reconcile] Step 0 finalize: Comment "${commentId}" — no segment at offset ${offset}`);
        continue;
      }

      const localStart = offset - seg.start;
      const localEnd = Math.min(localStart + anchorText.length, seg.end - seg.start);
      if (localEnd <= localStart) continue;

      const startRel = Y.createRelativePositionFromTypeIndex(seg.ytext, localStart, 0);
      const endRel = Y.createRelativePositionFromTypeIndex(seg.ytext, localEnd, -1);
      m.set('startRel', Y.encodeRelativePosition(startRel));
      m.set('endRel', Y.encodeRelativePosition(endRel));

      // Clean up temporary fields
      m.delete('_step0_fragmentKey');
      m.delete('_step0_offset');

      logger.debug(
        `[reconcile] Step 0 finalize: Comment "${commentId}" — anchored in "${fragKey}" ` +
        `at local [${localStart},${localEnd}]`,
      );
      remappedIds.push(commentId);
    }
  }
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

function updateMeta(
  doc: Y.Doc,
  meta: { kind: string; title: string; status?: string },
): void {
  const metaMap = doc.getMap('meta');
  metaMap.set('kind', meta.kind);
  metaMap.set('title', meta.title ?? '');
  if (meta.status) metaMap.set('status', meta.status);
}

// ─── Position Mapping via Diff ──────────────────────────────────────────────

type DiffArray = Array<[number, string]>;

function buildPositionMap(oldText: string, newText: string): DiffArray {
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupEfficiency(diffs);
  return diffs;
}

function mapPositionThroughDiff(
  diffs: DiffArray,
  oldPos: number,
): number | null {
  let oldOffset = 0;
  let newOffset = 0;

  for (const [op, text] of diffs) {
    if (op === 0) {
      if (oldOffset + text.length > oldPos) {
        return newOffset + (oldPos - oldOffset);
      }
      oldOffset += text.length;
      newOffset += text.length;
    } else if (op === -1) {
      if (oldOffset + text.length > oldPos) {
        return newOffset;
      }
      oldOffset += text.length;
    } else if (op === 1) {
      newOffset += text.length;
    }
  }

  return newOffset;
}

// ─── Comment Position Collection ────────────────────────────────────────────

interface CommentPositionInfo {
  commentMap: Y.Map<unknown>;
  commentId: string;
  anchorText: string;
  globalStart: number;
  globalEnd: number;
}

/**
 * Collect comments for a specific fragment and resolve their positions
 * to offsets in the flat text. Comments are stored under the fragment key
 * in Y.Map('comments'), but we also check all comment arrays since comments
 * may reference Y.XmlText nodes in this fragment regardless of their key.
 */
function collectFragmentCommentPositions(
  doc: Y.Doc,
  _fragKey: string,
  flatResult: FlatTextResult,
): CommentPositionInfo[] {
  const commentsMap = doc.getMap('comments');
  const result: CommentPositionInfo[] = [];

  for (const [key, value] of commentsMap.entries()) {
    if (key === '_initialized') continue;
    if (!(value instanceof Y.Array)) continue;

    const commentsArray = value as Y.Array<Y.Map<unknown>>;

    for (let i = 0; i < commentsArray.length; i++) {
      const commentMap = commentsArray.get(i) as Y.Map<unknown>;
      if (!(commentMap instanceof Y.Map)) continue;

      const startRelBytes = commentMap.get('startRel') as Uint8Array | undefined;
      const endRelBytes = commentMap.get('endRel') as Uint8Array | undefined;
      const anchorText = (commentMap.get('anchorText') as string) || '';
      const commentId = (commentMap.get('id') as string) || '';

      if (!startRelBytes || !endRelBytes) continue;

      const startRel = Y.decodeRelativePosition(startRelBytes);
      const endRel = Y.decodeRelativePosition(endRelBytes);
      const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, doc);
      const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, doc);

      if (!startAbs || !endAbs) continue;

      // Check if this comment's position falls within THIS fragment's segments
      const ytext = startAbs.type;
      const segment = flatResult.segments.find((s) => s.ytext === ytext);
      if (!segment) continue;

      const globalStart = segment.start + startAbs.index;
      const globalEnd = segment.start + endAbs.index;

      result.push({
        commentMap,
        commentId,
        anchorText,
        globalStart,
        globalEnd,
      });
    }
  }

  return result;
}

// ─── Diff Application (for Y.Text fields: title) ───────────────────────────

function applyDiff(
  ytext: Y.Text | Y.XmlText,
  oldText: string,
  newText: string,
): void {
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupEfficiency(diffs);

  let pos = 0;
  for (const [op, text] of diffs) {
    if (op === 0) {
      pos += text.length;
    } else if (op === -1) {
      ytext.delete(pos, text.length);
    } else if (op === 1) {
      ytext.insert(pos, text);
      pos += text.length;
    }
  }
}

// ─── Structured Array Reconciliation (Requirements / Tasks) ───────────────────

type StructuredItem = Record<string, unknown> & {
  id: string;
  title: string;
  description: string;
};

function reconcileStructuredArray(
  doc: Y.Doc,
  arrayName: string,
  yarray: Y.Array<unknown>,
  newItems: StructuredItem[],
  clientYjsState?: Uint8Array,
  alreadyHealedIds?: Set<string>,
): { matched: number; added: number; removed: number; commentsRemapped: number } {
  const result = { matched: 0, added: 0, removed: 0, commentsRemapped: 0 };

  // Build index of existing items by ID
  const existingById = new Map<
    string,
    { index: number; map: Y.Map<unknown> }
  >();
  for (let i = 0; i < yarray.length; i++) {
    const map = yarray.get(i) as Y.Map<unknown>;
    if (map instanceof Y.Map) {
      const id = map.get('id') as string;
      if (id) existingById.set(id, { index: i, map });
    }
  }

  const newIds = new Set(newItems.map((item) => item.id));

  // Match existing items to new items by ID
  for (const newItem of newItems) {
    const existing = existingById.get(newItem.id);
    if (existing) {
      const itemResult = reconcileStructuredItem(
        doc, arrayName, existing.map, newItem, clientYjsState, alreadyHealedIds,
      );
      result.matched++;
      result.commentsRemapped += itemResult.commentsRemapped;
    }
  }

  // Remove items not in new list (iterate in reverse)
  const indicesToRemove: number[] = [];
  const idsToRemove: string[] = [];
  for (const [id, { index }] of existingById) {
    if (!newIds.has(id)) {
      indicesToRemove.push(index);
      idsToRemove.push(id);
      result.removed++;
    }
  }
  indicesToRemove.sort((a, b) => b - a);
  for (const idx of indicesToRemove) {
    yarray.delete(idx, 1);
  }
  // Clear orphaned XmlFragments for removed items
  for (const id of idsToRemove) {
    for (const field of RICH_TEXT_FIELDS) {
      if (field === 'context') continue; // top-level, not per-item
      const frag = doc.getXmlFragment(fragmentName(arrayName, id, field));
      if (frag.length > 0) {
        frag.delete(0, frag.length);
      }
    }
  }

  // Add new items
  for (const newItem of newItems) {
    if (!existingById.has(newItem.id)) {
      const map = createStructuredItemMap(newItem);
      yarray.push([map]);
      // Populate description fragment for new items
      for (const field of RICH_TEXT_FIELDS) {
        if (field === 'context') continue;
        const value = newItem[field];
        if (typeof value === 'string' && value.trim().length > 0) {
          const frag = doc.getXmlFragment(fragmentName(arrayName, newItem.id, field));
          if (clientYjsState) {
            const clientDoc = new Y.Doc();
            Y.applyUpdate(clientDoc, clientYjsState);
            const clientFrag = clientDoc.getXmlFragment(fragmentName(arrayName, newItem.id, field));
            if (clientFrag.length > 0) {
              copyYFragment(clientFrag, frag);
            } else {
              populateFragmentFromMarkdown(frag, value);
            }
            clientDoc.destroy();
          } else {
            populateFragmentFromMarkdown(frag, value);
          }
        }
      }
      result.added++;
    }
  }

  return result;
}

function reconcileStructuredItem(
  doc: Y.Doc,
  arrayName: string,
  existingMap: Y.Map<unknown>,
  newItem: StructuredItem,
  clientYjsState?: Uint8Array,
  alreadyHealedIds?: Set<string>,
): { commentsRemapped: number } {
  let commentsRemapped = 0;

  // Title: Y.Text diff (single-line, not rich text)
  const titleYText = existingMap.get('title');
  if (titleYText instanceof Y.Text) {
    const oldTitle = titleYText.toString();
    if (oldTitle !== newItem.title) {
      applyDiff(titleYText, oldTitle, newItem.title);
    }
  }

  // Rich-text fields: reconcile as XmlFragment
  for (const field of RICH_TEXT_FIELDS) {
    if (field === 'context') continue; // top-level, handled separately
    const newValue = newItem[field];
    if (typeof newValue !== 'string') continue;

    const fragKey = fragmentName(arrayName, newItem.id, field);
    const fragResult = reconcileFragment(
      doc, fragKey, newValue, clientYjsState, alreadyHealedIds,
    );
    commentsRemapped += fragResult.commentsRemapped;
    for (const id of fragResult.remappedCommentIds) {
      alreadyHealedIds?.add(id);
    }
  }

  // Plain fields
  for (const field of [
    'status',
    'priority',
    'assignee',
    'related_requirement',
  ]) {
    if (field in newItem && newItem[field] !== undefined) {
      existingMap.set(field, newItem[field]);
    }
  }

  if ('tags' in newItem && Array.isArray(newItem.tags)) {
    const existingTags = existingMap.get('tags');
    if (existingTags instanceof Y.Array) {
      existingTags.delete(0, existingTags.length);
      for (const tag of newItem.tags as string[]) {
        existingTags.push([tag]);
      }
    } else {
      const tagsArray = new Y.Array<string>();
      for (const tag of newItem.tags as string[]) {
        tagsArray.push([tag]);
      }
      existingMap.set('tags', tagsArray);
    }
  }

  return { commentsRemapped };
}

function createStructuredItemMap(item: StructuredItem): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('id', item.id);

  const titleText = new Y.Text();
  titleText.insert(0, item.title ?? '');
  map.set('title', titleText);

  // No Y.Text for description — stored as named XmlFragment (populated by caller)

  for (const field of [
    'status',
    'priority',
    'assignee',
    'related_requirement',
  ]) {
    if (field in item && item[field] !== undefined) {
      map.set(field, item[field]);
    }
  }

  if ('tags' in item && Array.isArray(item.tags)) {
    const tagsArray = new Y.Array<string>();
    for (const tag of item.tags as string[]) {
      tagsArray.push([tag]);
    }
    map.set('tags', tagsArray);
  }

  return map;
}

// ─── Plain Array Replace (Change Log, Spec Analysis) ──────────────────────────

function replacePlainArray(
  yarray: Y.Array<unknown>,
  newItems: Record<string, unknown>[],
): void {
  yarray.delete(0, yarray.length);

  for (const item of newItems) {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(item)) {
      if (value !== undefined) {
        map.set(key, String(value));
      }
    }
    yarray.push([map]);
  }
}

// ─── Y.XmlFragment Copy (cross-doc) ─────────────────────────────────────────

function copyYFragment(
  source: Y.XmlFragment,
  target: Y.XmlFragment,
): void {
  const copies: (Y.XmlElement | Y.XmlText)[] = [];
  for (let i = 0; i < source.length; i++) {
    const child = source.get(i);
    if (child instanceof Y.XmlElement) {
      copies.push(copyYElement(child));
    } else if (child instanceof Y.XmlText) {
      const copy = new Y.XmlText();
      copy.applyDelta(child.toDelta());
      copies.push(copy);
    }
  }
  if (copies.length > 0) {
    target.insert(0, copies);
  }
}

function copyYElement(source: Y.XmlElement): Y.XmlElement {
  const copy = new Y.XmlElement(source.nodeName);

  for (const [key, value] of Object.entries(source.getAttributes())) {
    copy.setAttribute(key, value as string);
  }

  const children: (Y.XmlElement | Y.XmlText)[] = [];
  for (let i = 0; i < source.length; i++) {
    const child = source.get(i);
    if (child instanceof Y.XmlElement) {
      children.push(copyYElement(child));
    } else if (child instanceof Y.XmlText) {
      const textCopy = new Y.XmlText();
      textCopy.applyDelta(child.toDelta());
      children.push(textCopy);
    }
  }
  if (children.length > 0) {
    copy.insert(0, children);
  }

  return copy;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeContextBlocks(
  context: string | string[] | undefined,
): string[] {
  if (!context) return [];
  if (Array.isArray(context)) {
    return context.filter(
      (c) => typeof c === 'string' && c.trim().length > 0,
    );
  }
  if (typeof context === 'string' && context.trim().length > 0) {
    return [context.trim()];
  }
  return [];
}
