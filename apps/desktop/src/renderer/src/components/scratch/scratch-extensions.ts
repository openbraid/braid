// Scratch editor extensions — reuses most of the artifact editor stack
// but drops collaboration (Yjs) and comment-specific extensions.

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
import { HTMLBlock } from '../artifact-editor/extensions/html-block'
import { MermaidNodeView } from '../artifact-editor/extensions/mermaid-block'
import type { Extensions } from '@tiptap/core'

const lowlight = createLowlight(common)

export function getScratchExtensions(): Extensions {
  return [
    StarterKit.configure({ codeBlock: false, link: false }),
    CodeBlockLowlight
      .configure({ lowlight })
      .extend({
        addNodeView() {
          const mermaidView = ReactNodeViewRenderer(MermaidNodeView)
          const parentNodeView = this.parent?.()
          return (props) => {
            if (props.node.attrs.language === 'mermaid') {
              return mermaidView(props)
            }
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
  ]
}
