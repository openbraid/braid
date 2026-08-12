// ─── Code block NodeView ─────────────────────────────────────────────────────
// Renders ALL code blocks. Mermaid blocks get live SVG rendering.
// Other languages render as plain styled code blocks.

import { useCallback, useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import { Code2, Eye } from 'lucide-react'

let mermaidInitialized = false

function getCSSVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

async function initMermaid() {
  if (mermaidInitialized) return
  const mermaid = (await import('mermaid')).default

  // Derive theme from CSS custom properties (design tokens) so it respects dark/light mode
  const isDark = document.documentElement.classList.contains('dark')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isDark ? 'dark' : 'default',
    themeVariables: {
      primaryColor: getCSSVar('--color-brand', '#c8674a'),
      primaryTextColor: getCSSVar('--color-fg', '#d4d4d4'),
      primaryBorderColor: getCSSVar('--color-border-strong', '#555555'),
      lineColor: getCSSVar('--color-fg-secondary', '#8a8a8a'),
      secondaryColor: getCSSVar('--color-surface-active', '#252528'),
      tertiaryColor: getCSSVar('--color-surface-secondary', '#1a1a1b'),
      background: getCSSVar('--color-page', '#1e1e1e'),
      mainBkg: getCSSVar('--color-surface-active', '#252528'),
      nodeBorder: getCSSVar('--color-border-strong', '#555555'),
      clusterBkg: getCSSVar('--color-surface-secondary', '#1a1a1b'),
      clusterBorder: getCSSVar('--color-border', '#2e2e2f'),
      titleColor: getCSSVar('--color-fg', '#d4d4d4'),
      edgeLabelBackground: getCSSVar('--color-page', '#1e1e1e')
    }
  })
  mermaidInitialized = true
}

/** NodeView for mermaid code blocks only. Renders live SVG diagrams. */
export function MermaidNodeView({ node, editor }: NodeViewProps) {
  return <MermaidRenderer node={node} editor={editor} />
}

/** @deprecated Use MermaidNodeView instead. Kept for backward compat. */
export const CodeBlockNodeView = MermaidNodeView

function MermaidRenderer({ node, editor }: { node: NodeViewProps['node']; editor: NodeViewProps['editor'] }) {
  const [svgHtml, setSvgHtml] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [showSource, setShowSource] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const renderCountRef = useRef(0)

  const content = node.textContent

  const renderDiagram = useCallback(async (source: string) => {
    if (!source.trim()) {
      setSvgHtml('')
      setError('')
      return
    }

    try {
      await initMermaid()
      const mermaid = (await import('mermaid')).default
      // Fresh ID on every render — mermaid's internal state goes stale
      // when the previous SVG element is removed from the DOM (e.g. toggling to source view).
      renderCountRef.current += 1
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}-${renderCountRef.current}`
      const { svg } = await mermaid.render(id, source)
      setSvgHtml(svg)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render diagram')
      setSvgHtml('')
    }
  }, [])

  useEffect(() => {
    if (!showSource) {
      renderDiagram(content)
    }
  }, [content, showSource, renderDiagram])

  const isEditable = editor.isEditable

  return (
    <NodeViewWrapper className="my-3">
      <div className="border border-border rounded-lg overflow-hidden bg-surface-secondary">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle">
          <span className="text-[11px] text-fg-tertiary font-medium">mermaid</span>
          {isEditable && (
            <button
              onClick={() => setShowSource(!showSource)}
              className="p-1 rounded hover:bg-surface-hover text-fg-tertiary hover:text-fg-secondary transition-colors"
            >
              {showSource
                ? <Eye size={12} />
                : <Code2 size={12} />
              }
            </button>
          )}
        </div>

        {/* Content */}
        {showSource ? (
          <div className="p-3">
            <NodeViewContent as="div" className="text-[12px] font-mono text-fg bg-transparent outline-none whitespace-pre" />
          </div>
        ) : error ? (
          <div className="p-3 text-[12px] text-error">{error}</div>
        ) : svgHtml ? (
          <div
            ref={containerRef}
            className="p-3 flex justify-center [&_svg]:max-w-[70%] [&_svg]:max-h-[400px]"
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        ) : (
          <div className="p-3 text-[12px] text-fg-tertiary">Empty diagram</div>
        )}
      </div>
    </NodeViewWrapper>
  )
}
