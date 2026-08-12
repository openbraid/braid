import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useScratchStore } from '../../store/scratch-store'
import { track } from '../../lib/analytics'

export function ScratchTabBar() {
  const pages = useScratchStore((s) => s.pages)
  const openPageIds = useScratchStore((s) => s.openPageIds)
  const activePageId = useScratchStore((s) => s.activePageId)
  const setActivePage = useScratchStore((s) => s.setActivePage)
  const openPage = useScratchStore((s) => s.openPage)
  const closePage = useScratchStore((s) => s.closePage)
  const createPage = useScratchStore((s) => s.createPage)
  const deletePage = useScratchStore((s) => s.deletePage)
  const undoDelete = useScratchStore((s) => s.undoDelete)
  const updateTitle = useScratchStore((s) => s.updateTitle)
  const openSearch = useScratchStore((s) => s.openSearch)

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ pageId: string; x: number; y: number } | null>(null)
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const dropdownRef = useRef<HTMLDivElement>(null)
  const contextRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeTabRef = useRef<HTMLButtonElement>(null)

  // Open pages resolved against actual page data
  const openPages = openPageIds
    .map((id) => pages.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p)

  // Closed pages (not open as tabs) — shown in + dropdown
  const closedPages = pages.filter((p) => !openPageIds.includes(p.id))

  // Scroll active tab into view when it changes
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activePageId])

  // Horizontal scroll via mouse wheel
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        el!.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    if (!dropdownOpen && !contextMenu) return
    function handleClick(e: MouseEvent) {
      if (dropdownOpen && dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
      if (contextMenu && contextRef.current && !contextRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [dropdownOpen, contextMenu])

  async function handleNewPage() {
    setDropdownOpen(false)
    await createPage()
    track('scratch_page_created')
    // Scroll to end after new tab renders
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: 'smooth' })
    })
  }

  function handleDelete(pageId: string) {
    setContextMenu(null)
    setDropdownOpen(false)
    const page = pages.find((p) => p.id === pageId)
    const title = page?.title || 'Untitled'
    deletePage(pageId)
    toast(`"${title}" deleted`, {
      action: { label: 'Undo', onClick: () => undoDelete() },
      duration: 5000
    })
  }

  function handleDoubleClick(pageId: string, currentTitle: string) {
    setRenamingPageId(pageId)
    setRenameValue(currentTitle)
    setTimeout(() => renameInputRef.current?.select(), 0)
  }

  function commitRename() {
    if (renamingPageId && renameValue.trim()) {
      updateTitle(renamingPageId, renameValue.trim())
    }
    setRenamingPageId(null)
  }

  function handleContextMenu(e: React.MouseEvent, pageId: string) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ pageId, x: e.clientX, y: e.clientY })
  }

  return (
    <div className="flex items-center h-10 shrink-0 border-b border-border-subtle">
      {/* Scrollable tab area */}
      <div
        ref={scrollRef}
        className="flex-1 flex items-center gap-1 px-3 overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: 'none' }}
      >
        {openPages.map((page) => {
          const isActive = page.id === activePageId
          const label = page.title || 'Untitled'

          if (renamingPageId === page.id) {
            return (
              <div key={page.id} className="flex items-center h-7 shrink-0">
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenamingPageId(null)
                  }}
                  className="w-28 h-6 px-1.5 text-[12px] text-fg bg-surface border border-brand rounded outline-none"
                />
              </div>
            )
          }

          return (
            <button
              key={page.id}
              ref={isActive ? activeTabRef : undefined}
              onClick={() => setActivePage(page.id)}
              onDoubleClick={() => handleDoubleClick(page.id, page.title)}
              onContextMenu={(e) => handleContextMenu(e, page.id)}
              title={`${label} (double-click to rename)`}
              className={[
                'group flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-md text-[12px] shrink-0 transition-colors',
                isActive
                  ? 'bg-surface-active text-fg font-medium'
                  : 'text-fg-secondary hover:text-fg hover:bg-surface-hover'
              ].join(' ')}
            >
              <span className={['truncate max-w-[120px]', !page.title ? 'italic text-fg-tertiary' : ''].join(' ')}>
                {label}
              </span>
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); closePage(page.id) }}
                className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded hover:bg-surface-hover shrink-0"
              >
                <X size={9} />
              </span>
            </button>
          )
        })}
      </div>

      {/* Fixed buttons — always visible */}
      <div className="flex items-center gap-0.5 px-2 shrink-0 border-l border-border-subtle">
        {/* + button */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            title="New page"
            className="flex items-center justify-center w-7 h-7 rounded-md text-fg-tertiary hover:text-fg-secondary hover:bg-surface-hover transition-colors"
          >
            <Plus size={14} />
          </button>

          {dropdownOpen && (
            <div className="absolute top-full right-0 mt-1.5 w-56 bg-surface-elevated border border-border rounded-lg shadow-lg z-50 py-1.5 max-h-80 overflow-y-auto">
              <button
                onClick={handleNewPage}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-fg hover:bg-surface-hover transition-colors"
              >
                <Plus size={12} className="text-fg-secondary" />
                New page
              </button>

              {closedPages.length > 0 && (
                <>
                  <div className="border-t border-border-subtle my-1.5 mx-2" />
                  <div className="px-3 pb-1 pt-0.5">
                    <span className="text-[10px] font-medium text-fg-tertiary uppercase tracking-wider">Closed pages</span>
                  </div>
                  {closedPages.map((page) => (
                    <DropdownPageRow
                      key={page.id}
                      page={page}
                      onSelect={() => { openPage(page.id); setDropdownOpen(false) }}
                      onDelete={() => handleDelete(page.id)}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Search button */}
        <button
          onClick={openSearch}
          title="Search pages"
          className="flex items-center justify-center w-7 h-7 rounded-md text-fg-tertiary hover:text-fg-secondary hover:bg-surface-hover transition-colors"
        >
          <Search size={14} />
        </button>
      </div>

      {/* Right-click context menu — portal to escape panel z-index */}
      {contextMenu && createPortal(
        <div
          ref={contextRef}
          className="fixed bg-surface-elevated border border-border rounded-lg shadow-lg py-1 w-40"
          style={{ left: contextMenu.x, top: contextMenu.y, zIndex: 9999 }}
        >
          <button
            onClick={() => {
              const page = pages.find((p) => p.id === contextMenu.pageId)
              handleDoubleClick(contextMenu.pageId, page?.title ?? '')
              setContextMenu(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
          >
            <Pencil size={12} />
            Rename
          </button>
          <button
            onClick={() => { closePage(contextMenu.pageId); setContextMenu(null) }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
          >
            <X size={12} />
            Close
          </button>
          <button
            onClick={() => handleDelete(contextMenu.pageId)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-400 hover:text-red-300 hover:bg-surface-hover transition-colors"
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}

// ─── Dropdown page row ──────────────────────────────────────────────────────

function DropdownPageRow({
  page,
  onSelect,
  onDelete
}: {
  page: { id: string; title: string }
  onSelect: () => void
  onDelete: () => void
}) {
  return (
    <div className="group flex items-center hover:bg-surface-hover transition-colors">
      <button
        onClick={onSelect}
        className="flex-1 text-left px-3 py-1.5 text-[12px] text-fg-secondary hover:text-fg truncate"
      >
        {page.title || 'Untitled'}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="hidden group-hover:flex items-center justify-center w-6 h-6 mr-1 rounded text-fg-tertiary hover:text-red-400 transition-colors"
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}
