import { useEffect, useRef } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { useScratchStore } from '../../store/scratch-store'

export function ScratchSearch() {
  const searchQuery = useScratchStore((s) => s.searchQuery)
  const searchResults = useScratchStore((s) => s.searchResults)
  const search = useScratchStore((s) => s.search)
  const clearSearch = useScratchStore((s) => s.clearSearch)
  const setActivePage = useScratchStore((s) => s.setActivePage)

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focus and select all on mount so typing replaces the placeholder trigger
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  function handleSelect(pageId: string) {
    setActivePage(pageId)
    clearSearch()
  }

  return (
    <div className="flex flex-col shrink-0 border-b border-border-subtle">
      {/* Search input bar */}
      <div className="flex items-center h-10 px-3 gap-2">
        <button
          onClick={clearSearch}
          title="Back to tabs"
          className="flex items-center justify-center w-7 h-7 rounded-md text-fg-tertiary hover:text-fg-secondary hover:bg-surface-hover transition-colors shrink-0"
        >
          <ArrowLeft size={14} />
        </button>
        <Search size={13} className="text-fg-tertiary shrink-0" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search across all pages..."
          value={searchQuery}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') clearSearch()
          }}
          className="flex-1 bg-transparent text-[12px] text-fg placeholder:text-fg-tertiary outline-none"
        />
      </div>

      {/* Results */}
      {searchQuery.trim() && (
        <div className="max-h-64 overflow-y-auto">
          {searchResults.length === 0 ? (
            <div className="px-4 py-6 text-[12px] text-fg-tertiary text-center">
              No results found
            </div>
          ) : (
            searchResults.map((page) => {
              const lowerQuery = searchQuery.toLowerCase()
              const lowerText = page.textContent.toLowerCase()
              const matchIndex = lowerText.indexOf(lowerQuery)
              let snippet = ''
              if (matchIndex >= 0) {
                const start = Math.max(0, matchIndex - 30)
                const end = Math.min(page.textContent.length, matchIndex + searchQuery.length + 50)
                snippet = (start > 0 ? '...' : '') + page.textContent.slice(start, end) + (end < page.textContent.length ? '...' : '')
              }

              return (
                <button
                  key={page.id}
                  onClick={() => handleSelect(page.id)}
                  className="w-full text-left px-4 py-2.5 hover:bg-surface-hover transition-colors border-b border-border-subtle last:border-b-0"
                >
                  <div className="text-[12px] font-medium text-fg truncate">
                    {page.title || 'Untitled'}
                  </div>
                  {snippet && (
                    <div className="text-[11px] text-fg-tertiary truncate mt-1">
                      {snippet}
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
