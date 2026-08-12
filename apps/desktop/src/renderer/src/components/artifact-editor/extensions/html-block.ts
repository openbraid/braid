// ─── HTMLBlock extension ──────────────────────────────────────────────────────
// Preserves raw HTML blocks (details, summary, div[class], section, etc.)
// as opaque atom nodes. Prevents ProseMirror from stripping unknown HTML tags.

import { Node } from '@tiptap/core'
import DOMPurify from 'dompurify'

export const HTMLBlock = Node.create({
  name: 'htmlBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      html: {
        default: '',
        rendered: false
      }
    }
  },

  parseHTML() {
    return [
      { tag: 'details', priority: 10, getAttrs: (el) => ({ html: (el as HTMLElement).outerHTML }) },
      { tag: 'summary', priority: 10, getAttrs: (el) => ({ html: (el as HTMLElement).outerHTML }) },
      { tag: 'div[class]', priority: 10, getAttrs: (el) => ({ html: (el as HTMLElement).outerHTML }) },
      { tag: 'section', priority: 10, getAttrs: (el) => ({ html: (el as HTMLElement).outerHTML }) },
      { tag: 'aside', priority: 10, getAttrs: (el) => ({ html: (el as HTMLElement).outerHTML }) },
      { tag: 'figure', priority: 10, getAttrs: (el) => ({ html: (el as HTMLElement).outerHTML }) },
      { tag: 'figcaption', priority: 10, getAttrs: (el) => ({ html: (el as HTMLElement).outerHTML }) },
      { tag: 'nav', priority: 10, getAttrs: (el) => ({ html: (el as HTMLElement).outerHTML }) }
    ]
  },

  renderHTML({ node }) {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-type', 'html-block')
    wrapper.setAttribute('contenteditable', 'false')
    wrapper.classList.add('html-block-wrapper')
    wrapper.innerHTML = DOMPurify.sanitize(node.attrs.html)
    return { dom: wrapper }
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { html: string } }) {
          state.write(node.attrs.html)
          state.closeBlock(node)
        },
        parse: {}
      }
    }
  }
})
