// ─── 5-Step Comment Healing Algorithm ─────────────────────────────────────────
// After reconciliation diffs are applied, checks each comment's anchor and
// attempts to recover drifted comments before marking them OUTDATED.
//
// Steps:
//   1. Exact match at resolved position
//   2. Word boundary expansion (≥70% word similarity)
//   3. Unique occurrence in same Y.Text block
//   4. Unique occurrence in ANY block (cross-block search + re-anchor)
//   5. Mark OUTDATED

import { Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { RICH_TEXT_FIELDS, fragmentName } from './constants.js';

const logger = new Logger('CommentHealing');

export interface CommentEntry {
  id: string;
  anchorText: string;
  startRel: Uint8Array; // Y.encodeRelativePosition result
  endRel: Uint8Array;
  status: 'active' | 'outdated';
  [key: string]: unknown; // other fields preserved as-is
}

export interface HealingResult {
  totalComments: number;
  active: number;
  outdated: number;
  healed: number; // comments that drifted but were recovered
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function healAllComments(
  doc: Y.Doc,
  alreadyHealedIds?: Set<string>,
): HealingResult {
  const commentsMap = doc.getMap('comments');
  const allTextTargets = collectAllTextTargets(doc);
  const result: HealingResult = { totalComments: 0, active: 0, outdated: 0, healed: 0 };

  for (const [key, value] of commentsMap.entries()) {
    if (key === '_initialized') continue;
    if (!(value instanceof Y.Array)) continue;

    const commentsArray = value as Y.Array<Y.Map<unknown>>;

    for (let i = 0; i < commentsArray.length; i++) {
      const commentMap = commentsArray.get(i) as Y.Map<unknown>;
      if (!(commentMap instanceof Y.Map)) continue;

      result.totalComments++;

      // Skip comments already re-anchored by diff-based position mapping
      const commentId = commentMap.get('id') as string;
      if (alreadyHealedIds && commentId && alreadyHealedIds.has(commentId)) {
        logger.debug(`Comment "${commentId}" — skipped (already remapped by diff)`);
        result.active++;
        continue;
      }

      const healResult = healSingleComment(doc, commentMap, allTextTargets);

      if (healResult === 'active') result.active++;
      else if (healResult === 'healed') { result.active++; result.healed++; }
      else result.outdated++;
    }
  }

  return result;
}

// ─── Single Comment Healing ───────────────────────────────────────────────────

function healSingleComment(
  doc: Y.Doc,
  commentMap: Y.Map<unknown>,
  allTextTargets: TextTarget[],
): 'active' | 'healed' | 'outdated' {
  const anchorText = commentMap.get('anchorText') as string;
  const commentId = (commentMap.get('id') as string) || 'unknown';
  const log = (msg: string) => logger.debug(`Comment "${commentId}" (anchor: "${anchorText}"): ${msg}`);

  if (!anchorText) { log('OUTDATED — no anchorText'); return 'outdated'; }

  const startRelBytes = commentMap.get('startRel');
  const endRelBytes = commentMap.get('endRel');
  if (!startRelBytes || !endRelBytes) { log('OUTDATED — no startRel/endRel'); return 'outdated'; }

  const startRel = Y.decodeRelativePosition(startRelBytes as Uint8Array);
  const endRel = Y.decodeRelativePosition(endRelBytes as Uint8Array);

  const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, doc);
  const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, doc);

  // Can't resolve — parent type deleted
  if (!startAbs || !endAbs) {
    log('Positions unresolvable (parent deleted). Trying Step 4 (cross-block search).');
    return tryCrossBlockSearch(doc, commentMap, anchorText, allTextTargets, log);
  }

  const ytext = startAbs.type;
  if (!ytext || typeof (ytext as Y.Text).toString !== 'function') {
    log('Resolved type is not Y.Text. Trying Step 4.');
    return tryCrossBlockSearch(doc, commentMap, anchorText, allTextTargets, log);
  }

  // Get plain text via toDelta (toString includes XML mark tags)
  const delta = (ytext as Y.XmlText).toDelta() as Array<{ insert: string }>;
  const fullText = delta.filter((op) => typeof op.insert === 'string').map((op) => op.insert).join('');
  const currentText = fullText.substring(startAbs.index, endAbs.index);

  log(`Step 1: Resolved to [${startAbs.index},${endAbs.index}], current text: "${currentText}"`);

  // Step 1: Exact match
  if (currentText === anchorText) {
    log('Step 1: EXACT MATCH → active');
    return 'active';
  }

  // Step 2: Word boundary expansion
  const wordSim = computeWordSimilarity(currentText, anchorText);
  log(`Step 2: Word similarity = ${wordSim.toFixed(2)} (threshold: 0.7)`);
  if (wordSim >= 0.7) {
    const { from, to } = expandToWordBoundaries(fullText, startAbs.index, endAbs.index);
    const expandedText = fullText.substring(from, to);
    if (expandedText.includes(anchorText)) {
      log(`Step 2: Found in expanded range [${from},${to}]: "${expandedText.substring(0, 50)}" → active`);
      return 'active';
    }
    log(`Step 2: Not found in expanded text: "${expandedText.substring(0, 50)}"`);
  }

  // Step 3: Unique occurrence in same block
  log(`Step 3: Searching same block (${fullText.length} chars) for unique occurrence of "${anchorText}"`);
  const sameBlockResult = findUniqueAndReanchor(
    doc,
    commentMap,
    anchorText,
    ytext as Y.Text | Y.XmlText,
    fullText,
  );
  if (sameBlockResult) { log('Step 3: Found unique in same block → healed'); return 'healed'; }
  log('Step 3: Not found uniquely in same block.');

  // Step 4: Cross-block search
  log(`Step 4: Cross-block search across ${allTextTargets.length} text targets.`);
  return tryCrossBlockSearch(doc, commentMap, anchorText, allTextTargets, log);
}

// ─── Step 4: Cross-Block Search ───────────────────────────────────────────────

interface TextTarget {
  ytext: Y.Text | Y.XmlText;
  text: string;
}

function tryCrossBlockSearch(
  doc: Y.Doc,
  commentMap: Y.Map<unknown>,
  anchorText: string,
  allTextTargets: TextTarget[],
  log: (msg: string) => void,
): 'healed' | 'outdated' {
  let foundCount = 0;
  let foundTarget: TextTarget | null = null;
  let foundIndex = -1;

  for (let t = 0; t < allTextTargets.length; t++) {
    const target = allTextTargets[t];
    const idx = target.text.indexOf(anchorText);
    if (idx !== -1) {
      if (target.text.lastIndexOf(anchorText) === idx) {
        foundCount++;
        foundTarget = target;
        foundIndex = idx;
        log(`Step 4: Found in target[${t}] at offset ${idx} (text: "${target.text.substring(0, 60)}...")`);
      } else {
        foundCount += 2;
        log(`Step 4: Found MULTIPLE times in target[${t}] — ambiguous`);
      }
    }
  }

  if (foundCount === 1 && foundTarget && foundIndex !== -1) {
    reanchorComment(doc, commentMap, foundTarget.ytext, foundIndex, anchorText);
    log(`Step 4: Unique match → re-anchored → healed`);
    return 'healed';
  }

  // Step 5: OUTDATED
  log(`Step 5: OUTDATED — foundCount=${foundCount} (need exactly 1)`);
  commentMap.set('status', 'outdated');
  return 'outdated';
}

// ─── Re-Anchor Helpers ────────────────────────────────────────────────────────

function findUniqueAndReanchor(
  doc: Y.Doc,
  commentMap: Y.Map<unknown>,
  anchorText: string,
  ytext: Y.Text | Y.XmlText,
  fullText: string,
): boolean {
  const firstIdx = fullText.indexOf(anchorText);
  if (firstIdx === -1) return false;

  const lastIdx = fullText.lastIndexOf(anchorText);
  if (firstIdx !== lastIdx) return false; // Not unique

  reanchorComment(doc, commentMap, ytext, firstIdx, anchorText);
  return true;
}

function reanchorComment(
  doc: Y.Doc,
  commentMap: Y.Map<unknown>,
  ytext: Y.Text | Y.XmlText,
  startOffset: number,
  anchorText: string,
): void {
  const endOffset = startOffset + anchorText.length;
  const newStartRel = Y.createRelativePositionFromTypeIndex(ytext, startOffset, 0);
  const newEndRel = Y.createRelativePositionFromTypeIndex(ytext, endOffset, -1);

  commentMap.set('startRel', Y.encodeRelativePosition(newStartRel));
  commentMap.set('endRel', Y.encodeRelativePosition(newEndRel));
  commentMap.set('anchorText', anchorText);
  commentMap.set('status', 'active');
}

// ─── Collect All Text Targets ─────────────────────────────────────────────────

function collectAllTextTargets(doc: Y.Doc): TextTarget[] {
  const targets: TextTarget[] = [];

  // Context: walk recursively to find ALL Y.XmlText nodes
  walkForTextTargets(doc.getXmlFragment('context'), targets);

  // Requirements and Tasks: walk named XmlFragments for rich-text fields,
  // Y.Text for plain fields (title)
  collectArrayTextTargets(doc, 'requirements', doc.getArray('requirements'), targets);
  collectArrayTextTargets(doc, 'task_list', doc.getArray('task_list'), targets);

  logger.debug(`Collected ${targets.length} text targets`);
  for (let i = 0; i < targets.length; i++) {
    logger.debug(`  target[${i}]: "${targets[i].text}"`);
  }

  return targets;
}

/** Recursively walk a Y.XmlFragment/Y.XmlElement to find all Y.XmlText leaf nodes. */
function walkForTextTargets(
  parent: Y.XmlFragment | Y.XmlElement,
  targets: TextTarget[],
): void {
  for (let i = 0; i < parent.length; i++) {
    const child = parent.get(i);
    if (child instanceof Y.XmlText) {
      const delta = child.toDelta() as Array<{ insert: string }>;
      const plainText = delta
        .filter((op) => typeof op.insert === 'string')
        .map((op) => op.insert)
        .join('');
      if (plainText.length > 0) {
        targets.push({ ytext: child, text: plainText });
      }
    } else if (child instanceof Y.XmlElement) {
      walkForTextTargets(child, targets);
    }
  }
}

function collectArrayTextTargets(
  doc: Y.Doc,
  arrayName: string,
  arr: Y.Array<unknown>,
  targets: TextTarget[],
): void {
  arr.forEach((entry) => {
    if (!(entry instanceof Y.Map)) return;
    const map = entry as Y.Map<unknown>;
    const id = map.get('id') as string;

    // Title: still Y.Text (single-line, not rich text)
    const titleYText = map.get('title');
    if (titleYText instanceof Y.Text) {
      targets.push({ ytext: titleYText, text: titleYText.toString() });
    }

    // Rich-text fields: walk named XmlFragments
    for (const field of RICH_TEXT_FIELDS) {
      if (field === 'context') continue;
      if (!id) continue;
      const frag = doc.getXmlFragment(fragmentName(arrayName, id, field));
      if (frag.length > 0) {
        walkForTextTargets(frag, targets);
      }
    }

    // Fallback: if description is still Y.Text (old format), include it
    const descYText = map.get('description');
    if (descYText instanceof Y.Text) {
      targets.push({ ytext: descYText, text: descYText.toString() });
    }
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function computeWordSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter((w) => w.length > 0));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter((w) => w.length > 0));

  if (words1.size === 0 || words2.size === 0) {
    return text1 === text2 ? 1.0 : 0.0;
  }

  let common = 0;
  for (const w of words1) {
    if (words2.has(w)) common++;
  }
  return common / Math.max(words1.size, words2.size);
}

function expandToWordBoundaries(
  text: string,
  start: number,
  end: number,
): { from: number; to: number } {
  let from = start;
  let to = end;

  while (from > 0 && !/\s/.test(text[from - 1])) from--;
  while (to < text.length && !/\s/.test(text[to])) to++;

  return { from, to };
}
