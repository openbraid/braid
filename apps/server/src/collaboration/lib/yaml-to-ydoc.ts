// ─── YAML → Y.Doc conversion ─────────────────────────────────────────────────
// Converts a YAML artifact string into a Yjs document with the structure:
//   meta:          Y.Map (kind, title, status)
//   context:       Y.XmlFragment (proper ProseMirror nodes via server-side Tiptap)
//   requirements:  Y.Array<Y.Map> with Y.Text for title/description
//   task_list:     Y.Array<Y.Map> with Y.Text for title/description
//   change_log:    Y.Array<Y.Map> (plain strings, not commentable)
//   spec_analysis: Y.Array<Y.Map> (plain strings, not commentable)
//   comments:      Y.Map (initialized empty)

import * as Y from 'yjs';
import * as yaml from 'js-yaml';
import { populateFragmentFromMarkdown } from './markdown-to-ydoc.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArtifactMeta {
  kind: string;
  title: string;
  status?: string;
}

interface RequirementItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  description: string;
  tags?: string[];
}

interface TaskItem {
  id: string;
  title: string;
  status: string;
  description: string;
  related_requirement?: string;
  assignee?: string;
}

interface ChangeLogEntry {
  added?: string;
  removed?: string;
  why?: string;
  impact?: string;
  date?: string;
  summary?: string;
  rationale?: string;
  author?: string;
}

interface SpecAnalysisItem {
  requirement_id: string;
  coverage_status: string;
  gaps: string;
}

export interface ParsedArtifactYAML {
  meta: ArtifactMeta;
  context?: string | string[];
  requirements?: RequirementItem[];
  task_list?: TaskItem[];
  change_log?: ChangeLogEntry[];
  spec_analysis?: SpecAnalysisItem[];
}

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parseArtifactYAML(yamlString: string): ParsedArtifactYAML {
  const parsed = yaml.load(yamlString) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('YAML document must be an object');
  }
  if (!parsed.meta || typeof parsed.meta !== 'object') {
    throw new Error('Missing required "meta" block');
  }

  return parsed as unknown as ParsedArtifactYAML;
}

// ─── Convert ──────────────────────────────────────────────────────────────────

export function yamlToYDoc(yamlString: string): Y.Doc {
  const parsed = parseArtifactYAML(yamlString);
  const doc = new Y.Doc();

  doc.transact(() => {
    // ─── Meta ─────────────────────────────────────────────────────────
    const metaMap = doc.getMap('meta');
    metaMap.set('kind', parsed.meta.kind);
    metaMap.set('title', parsed.meta.title ?? '');
    metaMap.set('status', parsed.meta.status ?? 'draft');

    // ─── Context ──────────────────────────────────────────────────────
    // Server-side markdown → PM nodes via markdown-it + @tiptap/html.
    // Creates proper ProseMirror-compatible Y.XmlElement nodes directly.
    const contextFragment = doc.getXmlFragment('context');

    const contextBlocks = normalizeContextBlocks(parsed.context);
    if (contextBlocks.length > 0) {
      populateFragmentFromMarkdown(contextFragment, contextBlocks.join('\n\n'));
    }

    // ─── Requirements ─────────────────────────────────────────────────
    const requirementsArray = doc.getArray('requirements');

    if (parsed.requirements) {
      for (const req of parsed.requirements) {
        const reqMap = new Y.Map();
        reqMap.set('id', req.id ?? '');

        const titleText = new Y.Text();
        titleText.insert(0, req.title ?? '');
        reqMap.set('title', titleText);

        reqMap.set('status', req.status ?? 'proposed');
        reqMap.set('priority', req.priority ?? 'p2');

        const descText = new Y.Text();
        descText.insert(0, req.description ?? '');
        reqMap.set('description', descText);

        if (req.tags && req.tags.length > 0) {
          const tagsArray = new Y.Array<string>();
          for (const tag of req.tags) {
            tagsArray.push([tag]);
          }
          reqMap.set('tags', tagsArray);
        }

        requirementsArray.push([reqMap]);
      }
    }

    // ─── Task List ────────────────────────────────────────────────────
    const taskArray = doc.getArray('task_list');

    if (parsed.task_list) {
      for (const task of parsed.task_list) {
        const taskMap = new Y.Map();
        taskMap.set('id', task.id ?? '');

        const titleText = new Y.Text();
        titleText.insert(0, task.title ?? '');
        taskMap.set('title', titleText);

        taskMap.set('status', task.status ?? 'todo');

        const descText = new Y.Text();
        descText.insert(0, task.description ?? '');
        taskMap.set('description', descText);

        if (task.related_requirement) {
          taskMap.set('related_requirement', task.related_requirement);
        }
        if (task.assignee) {
          taskMap.set('assignee', task.assignee);
        }

        taskArray.push([taskMap]);
      }
    }

    // ─── Change Log (plain strings, not commentable) ──────────────────
    const changeLogArray = doc.getArray('change_log');

    if (parsed.change_log) {
      for (const entry of parsed.change_log) {
        const entryMap = new Y.Map();
        for (const [key, value] of Object.entries(entry)) {
          if (value !== undefined) {
            entryMap.set(key, String(value));
          }
        }
        changeLogArray.push([entryMap]);
      }
    }

    // ─── Spec Analysis (plain strings, not commentable) ───────────────
    const specArray = doc.getArray('spec_analysis');

    if (parsed.spec_analysis) {
      for (const item of parsed.spec_analysis) {
        const itemMap = new Y.Map();
        itemMap.set('requirement_id', item.requirement_id ?? '');
        itemMap.set('coverage_status', item.coverage_status ?? 'missing');
        itemMap.set('gaps', item.gaps ?? '');
        specArray.push([itemMap]);
      }
    }

    // ─── Comments (empty initially) ───────────────────────────────────
    doc.getMap('comments');
  });

  return doc;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeContextBlocks(context: string | string[] | undefined): string[] {
  if (!context) return [];
  if (Array.isArray(context)) {
    return context.filter((c) => typeof c === 'string' && c.trim().length > 0);
  }
  if (typeof context === 'string' && context.trim().length > 0) {
    return [context.trim()];
  }
  return [];
}
