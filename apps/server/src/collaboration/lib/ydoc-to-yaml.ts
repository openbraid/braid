// ─── Y.Doc → YAML export ─────────────────────────────────────────────────────
// Extracts all data from a Yjs document and serializes to YAML.
// Preserves block structure: each Y.XmlElement in context becomes a separate
// context entry (array if multiple, single string if one).

import * as Y from 'yjs';
import * as yaml from 'js-yaml';
import { fragmentToMarkdown } from './markdown-to-ydoc.js';
import { RICH_TEXT_FIELDS, fragmentName } from './constants.js';

export function yDocToYaml(doc: Y.Doc): string {
  const metaMap = doc.getMap('meta');
  const contextFragment = doc.getXmlFragment('context');
  const requirementsArray = doc.getArray('requirements');
  const taskArray = doc.getArray('task_list');
  const changeLogArray = doc.getArray('change_log');
  const specArray = doc.getArray('spec_analysis');

  const result: Record<string, unknown> = {};

  // ─── Meta ───────────────────────────────────────────────────────────

  result.meta = {
    kind: metaMap.get('kind') ?? '',
    title: metaMap.get('title') ?? '',
  };

  const status = metaMap.get('status');
  if (status && status !== 'draft') {
    (result.meta as Record<string, string>).status = status as string;
  }

  // ─── Context ────────────────────────────────────────────────────────
  // Convert Y.XmlFragment (PM nodes) back to markdown using the reverse converter.

  if (contextFragment.length > 0) {
    const contextMarkdown = fragmentToMarkdown(contextFragment);
    if (contextMarkdown.trim().length > 0) {
      result.context = contextMarkdown;
    }
  }

  // ─── Requirements ───────────────────────────────────────────────────

  const requirements = extractRequirements(doc, requirementsArray, 'requirements');
  if (requirements.length > 0) {
    result.requirements = requirements;
  }

  // ─── Task List ──────────────────────────────────────────────────────

  const tasks = extractTasks(doc, taskArray, 'task_list');
  if (tasks.length > 0) {
    result.task_list = tasks;
  }

  // ─── Spec Analysis ──────────────────────────────────────────────────

  const specItems = extractPlainArray(specArray);
  if (specItems.length > 0) {
    result.spec_analysis = specItems;
  }

  // ─── Change Log ─────────────────────────────────────────────────────

  const changeLogItems = extractPlainArray(changeLogArray);
  if (changeLogItems.length > 0) {
    result.change_log = changeLogItems;
  }

  return yaml.dump(result, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
    sortKeys: false,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractRequirements(
  doc: Y.Doc,
  arr: Y.Array<unknown>,
  arrayName: string,
): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];

  arr.forEach((entry) => {
    if (!(entry instanceof Y.Map)) return;
    const reqMap = entry as Y.Map<unknown>;

    const id = reqMap.get('id') as string;
    const item: Record<string, unknown> = { id };

    const titleText = reqMap.get('title');
    item.title =
      titleText instanceof Y.Text ? titleText.toString() : String(titleText ?? '');

    item.status = reqMap.get('status') ?? 'proposed';
    item.priority = reqMap.get('priority') ?? 'p2';

    const tagsArray = reqMap.get('tags');
    if (tagsArray instanceof Y.Array && tagsArray.length > 0) {
      item.tags = tagsArray.toArray();
    }

    // Description: read from named XmlFragment if it exists, fallback to Y.Text
    item.description = readRichTextField(doc, reqMap, arrayName, id, 'description');

    items.push(item);
  });

  return items;
}

function extractTasks(
  doc: Y.Doc,
  arr: Y.Array<unknown>,
  arrayName: string,
): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];

  arr.forEach((entry) => {
    if (!(entry instanceof Y.Map)) return;
    const taskMap = entry as Y.Map<unknown>;

    const id = taskMap.get('id') as string;
    const item: Record<string, unknown> = { id };

    const titleText = taskMap.get('title');
    item.title =
      titleText instanceof Y.Text ? titleText.toString() : String(titleText ?? '');

    item.status = taskMap.get('status') ?? 'todo';

    // Description: read from named XmlFragment if it exists, fallback to Y.Text
    item.description = readRichTextField(doc, taskMap, arrayName, id, 'description');

    const relReq = taskMap.get('related_requirement');
    if (relReq) item.related_requirement = relReq;

    const assignee = taskMap.get('assignee');
    if (assignee) item.assignee = assignee;

    items.push(item);
  });

  return items;
}

/**
 * Read a rich-text field: prefer named XmlFragment, fallback to Y.Text in the map.
 * This handles both new (XmlFragment) and old (Y.Text) data gracefully.
 */
function readRichTextField(
  doc: Y.Doc,
  itemMap: Y.Map<unknown>,
  arrayName: string,
  itemId: string,
  fieldName: string,
): string {
  if (RICH_TEXT_FIELDS.has(fieldName)) {
    const frag = doc.getXmlFragment(fragmentName(arrayName, itemId, fieldName));
    if (frag.length > 0) {
      return fragmentToMarkdown(frag);
    }
  }

  // Fallback: Y.Text stored in the map (old format)
  const ytext = itemMap.get(fieldName);
  if (ytext instanceof Y.Text) return ytext.toString();
  return String(ytext ?? '');
}

function extractPlainArray(arr: Y.Array<unknown>): Record<string, string>[] {
  const items: Record<string, string>[] = [];

  arr.forEach((entry) => {
    if (!(entry instanceof Y.Map)) return;
    const map = entry as Y.Map<unknown>;
    const item: Record<string, string> = {};

    for (const [key, value] of map.entries()) {
      item[key] = String(value ?? '');
    }

    items.push(item);
  });

  return items;
}
