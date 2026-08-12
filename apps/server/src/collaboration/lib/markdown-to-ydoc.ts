// ─── Server-side Markdown → Y.XmlFragment ────────────────────────────────────
// Converts markdown to proper ProseMirror-compatible Y.XmlFragment nodes
// on the server, using markdown-it + @tiptap/html/server generateJSON.
//
// Uses @tiptap/html/server which internally uses happy-dom for Node.js
// HTML parsing. No manual DOM shim needed.
//
// This eliminates the _pendingContext workaround — the server now creates
// the same node structure that Tiptap's Collaboration extension expects.

import * as Y from 'yjs';
import MarkdownIt from 'markdown-it';
import { generateJSON } from '@tiptap/html/server';
import StarterKit from '@tiptap/starter-kit';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Image } from '@tiptap/extension-image';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

// ─── Markdown-it instance (reused across calls) ─────────────────────────────

const md = new MarkdownIt({ html: true, breaks: true, linkify: true });

// ─── Server-side Tiptap extensions ──────────────────────────────────────────
// Must match client extensions in useYjsEditor.ts / ArtifactEditor.tsx.
// Excludes: HTMLBlock (client-only atom node), Collaboration, comment decorations.

function getServerExtensions() {
  return [
    StarterKit.configure({ codeBlock: false }),
    CodeBlock,
    Image,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
  ];
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: PmMark[];
}

interface PmMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TextSegment {
  ytext: Y.XmlText;
  start: number; // inclusive offset in flat text
  end: number; // exclusive offset in flat text
}

export interface FlatTextResult {
  text: string;
  segments: TextSegment[];
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse markdown string into ProseMirror JSON using markdown-it + @tiptap/html.
 */
export function markdownToPmJson(markdown: string): PmNode {
  const html = md.render(markdown);
  return generateJSON(html, getServerExtensions()) as PmNode;
}

/**
 * Populate a Y.XmlFragment with proper ProseMirror nodes parsed from markdown.
 * Clears existing content first.
 */
export function populateFragmentFromMarkdown(
  fragment: Y.XmlFragment,
  markdown: string,
): void {
  const pmJson = markdownToPmJson(markdown);

  // Clear existing content
  if (fragment.length > 0) {
    fragment.delete(0, fragment.length);
  }

  // Convert PM JSON nodes → Y.XmlElement/Y.XmlText and insert
  if (pmJson.content) {
    const children = pmJson.content.map((node) => pmNodeToYXml(node));
    fragment.insert(0, children);
  }
}

/**
 * Extract flat text from a Y.XmlFragment, tracking which Y.XmlText node
 * owns which character range. Used for diff-based comment re-anchoring.
 */
export function extractFlatText(fragment: Y.XmlFragment): FlatTextResult {
  const segments: TextSegment[] = [];
  let text = '';

  walkYFragment(fragment, segments, { offset: 0 }, (t) => {
    text += t;
  });

  return { text, segments };
}

/**
 * Extract flat text from a ProseMirror JSON tree.
 * Used to get comparable plain text from new markdown for diffing.
 */
export function extractFlatTextFromPmJson(pmJson: PmNode): string {
  let text = '';
  walkPmJson(pmJson, (t) => {
    text += t;
  });
  return text;
}

// ─── PM JSON → Y.Xml Conversion ────────────────────────────────────────────

/**
 * Recursively convert a ProseMirror JSON node into Y.XmlElement or Y.XmlText.
 *
 * Text nodes use applyDelta with mark attributes matching @tiptap/y-tiptap format:
 *   { insert: "text", attributes: { bold: {}, italic: {}, link: { href: "..." } } }
 */
function pmNodeToYXml(node: PmNode): Y.XmlElement | Y.XmlText {
  if (node.type === 'text') {
    return pmTextToYXmlText(node);
  }

  const element = new Y.XmlElement(node.type);

  // Set attributes (level, language, checked, etc.)
  // Values must be stored as native types (not JSON strings) to match
  // how @tiptap/y-tiptap stores them — see createTypeFromElementNode.
  if (node.attrs) {
    for (const [key, value] of Object.entries(node.attrs)) {
      if (value !== null && value !== undefined) {
        element.setAttribute(key, value as string);
      }
    }
  }

  // Convert children — merge consecutive text nodes into a single Y.XmlText
  if (node.content) {
    const children = buildYChildren(node.content);
    if (children.length > 0) {
      element.insert(0, children);
    }
  }

  return element;
}

/**
 * Build Y.Xml children from PM JSON content array.
 * Consecutive text nodes are merged into a single Y.XmlText with delta formatting,
 * matching how @tiptap/y-tiptap represents inline content.
 */
function buildYChildren(
  pmNodes: PmNode[],
): (Y.XmlElement | Y.XmlText)[] {
  const result: (Y.XmlElement | Y.XmlText)[] = [];
  let textRun: PmNode[] = [];

  const flushTextRun = () => {
    if (textRun.length > 0) {
      result.push(mergeTextNodesToYXmlText(textRun));
      textRun = [];
    }
  };

  for (const node of pmNodes) {
    if (node.type === 'text') {
      textRun.push(node);
    } else {
      flushTextRun();
      result.push(pmNodeToYXml(node) as Y.XmlElement);
    }
  }
  flushTextRun();

  return result;
}

/**
 * Merge consecutive PM text nodes into a single Y.XmlText using applyDelta.
 * This matches @tiptap/y-tiptap's createTypeFromTextNodes behavior.
 */
function mergeTextNodesToYXmlText(textNodes: PmNode[]): Y.XmlText {
  const ytext = new Y.XmlText();

  const delta = textNodes.map((node) => {
    const entry: { insert: string; attributes?: Record<string, unknown> } = {
      insert: node.text || '',
    };

    if (node.marks && node.marks.length > 0) {
      const attributes: Record<string, unknown> = {};
      for (const mark of node.marks) {
        attributes[mark.type] = mark.attrs || {};
      }
      entry.attributes = attributes;
    }

    return entry;
  });

  ytext.applyDelta(delta);
  return ytext;
}

/**
 * Convert a single PM text node to Y.XmlText (for standalone text nodes).
 */
function pmTextToYXmlText(node: PmNode): Y.XmlText {
  return mergeTextNodesToYXmlText([node]);
}

// ─── Flat Text Extraction ───────────────────────────────────────────────────

/**
 * Recursively walk a Y.XmlFragment/Y.XmlElement, collecting text from
 * all Y.XmlText leaf nodes. Tracks segment boundaries for position mapping.
 */
function walkYFragment(
  parent: Y.XmlFragment | Y.XmlElement,
  segments: TextSegment[],
  state: { offset: number },
  append: (text: string) => void,
): void {
  for (let i = 0; i < parent.length; i++) {
    const child = parent.get(i);

    if (child instanceof Y.XmlText) {
      // Use toDelta() to get plain text (character count only).
      // toString() returns XML-tagged text ("<bold>text</bold>") which
      // inflates the length. createRelativePositionFromTypeIndex uses
      // character indices, so we must match that.
      const delta = child.toDelta() as Array<{ insert: string }>;
      const plainText = delta
        .filter((op) => typeof op.insert === 'string')
        .map((op) => op.insert)
        .join('');
      if (plainText.length > 0) {
        segments.push({
          ytext: child,
          start: state.offset,
          end: state.offset + plainText.length,
        });
        append(plainText);
        state.offset += plainText.length;
      }
    } else if (child instanceof Y.XmlElement) {
      walkYFragment(child, segments, state, append);
    }

    // Add newline separator between block-level siblings (not after the last one)
    if (i < parent.length - 1) {
      const next = parent.get(i + 1);
      // Add separator between block-level elements, not between inline text
      if (
        (child instanceof Y.XmlElement || next instanceof Y.XmlElement) &&
        !(child instanceof Y.XmlText && next instanceof Y.XmlText)
      ) {
        append('\n');
        state.offset++;
      }
    }
  }
}

/**
 * Recursively walk PM JSON tree, extracting plain text.
 * Must produce the same flat text structure as walkYFragment
 * so diffs between old and new are comparable.
 */
function walkPmJson(
  node: PmNode,
  append: (text: string) => void,
  isRoot = true,
): void {
  if (node.type === 'text') {
    append(node.text || '');
    return;
  }

  if (node.content) {
    for (let i = 0; i < node.content.length; i++) {
      walkPmJson(node.content[i], append, false);

      // Add newline separator between block-level siblings
      if (i < node.content.length - 1) {
        const curr = node.content[i];
        const next = node.content[i + 1];
        if (curr.type !== 'text' || next.type !== 'text') {
          append('\n');
        }
      }
    }
  }
}

// ─── Y.XmlFragment → Markdown ──────────────────────────────────────────────
// Reverse converter: takes ProseMirror-compatible Y.XmlElement nodes and
// produces clean markdown. Used to keep yamlContent in sync with yjsState.

/**
 * Convert a Y.XmlFragment (containing PM-compatible nodes) back to markdown.
 */
export function fragmentToMarkdown(fragment: Y.XmlFragment): string {
  const lines: string[] = [];
  for (let i = 0; i < fragment.length; i++) {
    const child = fragment.get(i);
    if (child instanceof Y.XmlElement) {
      lines.push(elementToMd(child, ''));
    } else if (child instanceof Y.XmlText) {
      lines.push(ytextToInlineMd(child));
    }
  }
  return lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function elementToMd(el: Y.XmlElement, indent: string): string {
  const tag = el.nodeName;

  switch (tag) {
    case 'heading': {
      const level = Number(el.getAttribute('level')) || 1;
      return `${'#'.repeat(level)} ${collectInlineMd(el)}`;
    }
    case 'paragraph':
      return collectInlineMd(el);

    case 'bulletList':
      return listToMd(el, indent, 'bullet');

    case 'orderedList': {
      const start = Number(el.getAttribute('start')) || 1;
      return listToMd(el, indent, 'ordered', start);
    }
    case 'taskList':
      return listToMd(el, indent, 'task');

    case 'listItem':
    case 'taskItem':
      return collectBlockChildrenMd(el, indent);

    case 'codeBlock': {
      const lang = (el.getAttribute('language') as string) || '';
      return '```' + lang + '\n' + collectPlainTextMd(el) + '\n```';
    }
    case 'blockquote': {
      const inner = collectBlockChildrenMd(el, '');
      return inner.split('\n').map((line) => '> ' + line).join('\n');
    }
    case 'horizontalRule':
      return '---';

    case 'image': {
      const src = (el.getAttribute('src') as string) || '';
      const alt = (el.getAttribute('alt') as string) || '';
      const title = el.getAttribute('title') as string | undefined;
      return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
    }
    case 'table':
      return tableToMd(el);

    case 'hardBreak':
      return '\n';

    default:
      return collectBlockChildrenMd(el, indent);
  }
}

/** Collect inline content (with mark formatting) from element children. */
function collectInlineMd(el: Y.XmlElement): string {
  let result = '';
  for (let i = 0; i < el.length; i++) {
    const child = el.get(i);
    if (child instanceof Y.XmlText) {
      result += ytextToInlineMd(child);
    } else if (child instanceof Y.XmlElement) {
      if (child.nodeName === 'hardBreak') {
        result += '\n';
      } else if (child.nodeName === 'image') {
        result += elementToMd(child, '');
      } else {
        result += collectPlainTextMd(child);
      }
    }
  }
  return result;
}

/** Convert Y.XmlText delta (with mark attributes) to formatted markdown. */
function ytextToInlineMd(ytext: Y.XmlText): string {
  const delta = ytext.toDelta() as Array<{
    insert: string;
    attributes?: Record<string, Record<string, string>>;
  }>;
  let result = '';

  for (const op of delta) {
    if (typeof op.insert !== 'string') continue;
    let text = op.insert;
    const attrs = op.attributes || {};

    if (attrs.code) {
      text = '`' + text + '`';
    } else {
      if (attrs.strike) text = '~~' + text + '~~';
      if (attrs.link) {
        const href = (attrs.link as unknown as { href: string }).href || '';
        text = '[' + text + '](' + href + ')';
      }
      if (attrs.bold && attrs.italic) {
        text = '***' + text + '***';
      } else if (attrs.bold) {
        text = '**' + text + '**';
      } else if (attrs.italic) {
        text = '*' + text + '*';
      }
    }

    result += text;
  }
  return result;
}

/** Convert a list element to markdown with proper prefixes and indentation. */
function listToMd(
  listEl: Y.XmlElement,
  indent: string,
  type: 'bullet' | 'ordered' | 'task',
  startNum = 1,
): string {
  const items: string[] = [];
  let num = startNum;

  for (let i = 0; i < listEl.length; i++) {
    const item = listEl.get(i);
    if (!(item instanceof Y.XmlElement)) continue;

    let prefix: string;
    if (type === 'task') {
      prefix = item.getAttribute('checked') ? '- [x] ' : '- [ ] ';
    } else if (type === 'ordered') {
      prefix = `${num}. `;
      num++;
    } else {
      prefix = '- ';
    }

    const parts: string[] = [];
    for (let j = 0; j < item.length; j++) {
      const child = item.get(j);
      if (child instanceof Y.XmlElement) {
        if (['bulletList', 'orderedList', 'taskList'].includes(child.nodeName)) {
          parts.push('\n' + elementToMd(child, indent + '  '));
        } else if (child.nodeName === 'paragraph') {
          parts.push(collectInlineMd(child));
        } else {
          parts.push(elementToMd(child, indent));
        }
      } else if (child instanceof Y.XmlText) {
        parts.push(ytextToInlineMd(child));
      }
    }

    const firstParagraph = parts[0] || '';
    const rest = parts.slice(1).join('\n');
    let itemStr = indent + prefix + firstParagraph;
    if (rest) itemStr += rest;
    items.push(itemStr);
  }

  return items.join('\n');
}

/** Convert a table element to markdown. */
function tableToMd(tableEl: Y.XmlElement): string {
  const rows: string[][] = [];

  for (let i = 0; i < tableEl.length; i++) {
    const row = tableEl.get(i);
    if (!(row instanceof Y.XmlElement) || row.nodeName !== 'tableRow') continue;

    const cells: string[] = [];
    for (let j = 0; j < row.length; j++) {
      const cell = row.get(j);
      if (!(cell instanceof Y.XmlElement)) continue;
      let cellText = '';
      for (let k = 0; k < cell.length; k++) {
        const child = cell.get(k);
        if (child instanceof Y.XmlElement && child.nodeName === 'paragraph') {
          cellText += collectInlineMd(child);
        }
      }
      cells.push(cellText);
    }
    rows.push(cells);
  }

  if (rows.length === 0) return '';

  const lines: string[] = [];
  lines.push('| ' + rows[0].join(' | ') + ' |');
  lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |');
  for (let i = 1; i < rows.length; i++) {
    lines.push('| ' + rows[i].join(' | ') + ' |');
  }
  return lines.join('\n');
}

/** Collect block-level children joined with double newlines. */
function collectBlockChildrenMd(el: Y.XmlElement, indent: string): string {
  const parts: string[] = [];
  for (let i = 0; i < el.length; i++) {
    const child = el.get(i);
    if (child instanceof Y.XmlElement) {
      parts.push(elementToMd(child, indent));
    } else if (child instanceof Y.XmlText) {
      parts.push(ytextToInlineMd(child));
    }
  }
  return parts.join('\n\n');
}

/** Collect plain text (no formatting). Used for code blocks. */
function collectPlainTextMd(el: Y.XmlElement): string {
  let result = '';
  for (let i = 0; i < el.length; i++) {
    const child = el.get(i);
    if (child instanceof Y.XmlText) {
      result += child.toString();
    } else if (child instanceof Y.XmlElement) {
      if (child.nodeName === 'hardBreak') {
        result += '\n';
      } else {
        result += collectPlainTextMd(child);
      }
    }
  }
  return result;
}
