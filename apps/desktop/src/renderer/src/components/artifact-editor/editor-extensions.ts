// ─── Shared editor extensions ────────────────────────────────────────────────
// Single source of truth for the Tiptap extension list used by both
// the local editor (Local mode) and the Yjs editor (Shared mode).

import { ReactNodeViewRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { Image } from '@tiptap/extension-image'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Link } from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import { HTMLBlock } from './extensions/html-block'
import { MermaidNodeView } from './extensions/mermaid-block'
import { SearchHighlight } from './extensions/search-highlight'
import { PendingCommentHighlight } from './extensions/pending-comment-highlight'
import type { Extensions } from '@tiptap/core'

// lowlight with common languages: c, cpp, csharp, css, diff, go, graphql,
// ini, java, javascript, json, kotlin, less, lua, makefile, markdown,
// objectivec, perl, php, php-template, python, r, ruby, rust, scss, shell,
// sql, swift, typescript, vbnet, wasm, xml, yaml
const lowlight = createLowlight(common)

/** Base extensions shared by all ArtifactEditor instances. */
export function getBaseExtensions(): Extensions {
  return [
    StarterKit.configure({ codeBlock: false, link: false }),
    CodeBlockLowlight
      .configure({ lowlight })
      .extend({
        addNodeView() {
          // Mermaid blocks: live SVG via custom React NodeView.
          // All other languages: lowlight's default syntax highlighting.
          const mermaidView = ReactNodeViewRenderer(MermaidNodeView)
          const parentNodeView = this.parent?.()
          return (props) => {
            if (props.node.attrs.language === 'mermaid') {
              return mermaidView(props)
            }
            // Delegate to lowlight's built-in NodeView for syntax highlighting
            return parentNodeView?.(props) as any
          }
        }
      }),
    Markdown.configure({
      html: true,
      breaks: true,
      tightLists: true,
      bulletListMarker: '-'
    }),
    Image,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: 'text-brand underline cursor-pointer' },
    }),
    HTMLBlock,
    SearchHighlight,
    PendingCommentHighlight,
  ]
}
