// ─── Create complete Y.Doc from YAML ─────────────────────────────────────────
// Builds a full Y.Doc with ALL artifact data:
//   - Context + description fields: via Tiptap + Collaboration (normalized)
//   - Meta, titles, structured fields: plain Y.Map/Y.Array/Y.Text
//
// Rich-text fields (description, context) are stored as named Y.XmlFragments:
//   - context → doc.getXmlFragment('context')
//   - requirement description → doc.getXmlFragment('requirements:{id}:description')
//   - task description → doc.getXmlFragment('task_list:{id}:description')

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlock } from '@tiptap/extension-code-block'
import { Image } from '@tiptap/extension-image'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Markdown } from 'tiptap-markdown'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import type { ParsedArtifact } from './artifact-parser'

/**
 * Create a complete Y.Doc from a parsed artifact.
 * All rich-text fields are Tiptap-normalized via Collaboration extension.
 * Returns base64-encoded yjsState for sending over HTTP.
 */
export function createYjsStateFromArtifact(artifact: ParsedArtifact): string {
  const ydoc = new Y.Doc()

  // ─── Context: Tiptap + Collaboration ─────────────────────────────
  const contextMarkdown = artifact.contextBlocks.join('\n\n')
  if (contextMarkdown.trim().length > 0) {
    populateFragmentViaTiptap(ydoc, 'context', contextMarkdown)
  }

  // ─── Meta ────────────────────────────────────────────────────────
  const metaMap = ydoc.getMap('meta')
  metaMap.set('kind', artifact.meta.kind)
  metaMap.set('title', artifact.meta.title ?? '')
  metaMap.set('status', artifact.meta.status ?? 'draft')

  // ─── Requirements ────────────────────────────────────────────────
  const reqArray = ydoc.getArray('requirements')
  for (const req of artifact.requirements) {
    const reqMap = new Y.Map()
    reqMap.set('id', req.id ?? '')

    const titleText = new Y.Text()
    titleText.insert(0, req.title ?? '')
    reqMap.set('title', titleText)

    reqMap.set('status', req.status ?? 'proposed')
    reqMap.set('priority', req.priority ?? 'p2')

    // Description: named XmlFragment (not Y.Text)
    const descMd = req.description ?? ''
    if (descMd.trim().length > 0) {
      populateFragmentViaTiptap(ydoc, `requirements:${req.id}:description`, descMd)
    }

    if (req.tags && req.tags.length > 0) {
      const tagsArray = new Y.Array<string>()
      for (const tag of req.tags) {
        tagsArray.push([tag])
      }
      reqMap.set('tags', tagsArray)
    }

    reqArray.push([reqMap])
  }

  // ─── Tasks ───────────────────────────────────────────────────────
  const taskArray = ydoc.getArray('task_list')
  for (const task of artifact.taskList) {
    const taskMap = new Y.Map()
    taskMap.set('id', task.id ?? '')

    const titleText = new Y.Text()
    titleText.insert(0, task.title ?? '')
    taskMap.set('title', titleText)

    taskMap.set('status', task.status ?? 'todo')

    // Description: named XmlFragment (not Y.Text)
    const descMd = task.description ?? ''
    if (descMd.trim().length > 0) {
      populateFragmentViaTiptap(ydoc, `task_list:${task.id}:description`, descMd)
    }

    if (task.related_requirement) taskMap.set('related_requirement', task.related_requirement)
    if (task.assignee) taskMap.set('assignee', task.assignee)

    taskArray.push([taskMap])
  }

  // ─── Change Log ──────────────────────────────────────────────────
  const changeLogArray = ydoc.getArray('change_log')
  for (const entry of artifact.changeLog) {
    const entryMap = new Y.Map()
    for (const [key, value] of Object.entries(entry)) {
      if (value !== undefined) entryMap.set(key, String(value))
    }
    changeLogArray.push([entryMap])
  }

  // ─── Generic array sections ─────────────────────────────────────
  const genericSections: Array<[string, Record<string, unknown>[]]> = [
    ['spec_coverage', artifact.specCoverage],
    ['test_cases', artifact.testCases],
    ['security_checks', artifact.securityChecks],
    ['action_items', artifact.actionItems],
    ['test_coverage', artifact.testCoverage],
  ]
  for (const [arrayName, items] of genericSections) {
    if (!items || items.length === 0) continue
    const arr = ydoc.getArray(arrayName)
    for (const item of items) {
      const itemMap = new Y.Map()
      for (const [key, value] of Object.entries(item)) {
        if (value !== undefined) itemMap.set(key, String(value))
      }
      arr.push([itemMap])
    }
  }

  // ─── Comments (empty) ───────────────────────────────────────────
  ydoc.getMap('comments')

  // Encode
  const state = Y.encodeStateAsUpdate(ydoc)
  const base64 = btoa(String.fromCharCode(...state))
  ydoc.destroy()

  return base64
}

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Populate a named Y.XmlFragment with Tiptap-normalized PM nodes from markdown.
 * Creates a temporary Editor with Collaboration, sets content, destroys editor.
 */
function populateFragmentViaTiptap(ydoc: Y.Doc, fragmentField: string, markdown: string): void {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false, undoRedo: false }),
      CodeBlock,
      Markdown.configure({
        html: true,
        breaks: true,
        tightLists: true,
        bulletListMarker: '-',
      }),
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Collaboration.configure({
        document: ydoc,
        field: fragmentField,
      }),
    ],
    content: '',
  })

  editor.commands.setContent(markdown)
  editor.destroy()
}
