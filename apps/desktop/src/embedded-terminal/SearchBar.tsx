import React, { useRef, useEffect, useCallback, useState } from 'react'
import type { SearchAddon } from '@xterm/addon-search'

type Props = {
  searchAddon: SearchAddon
  onClose: () => void
  themeKind: 'dark' | 'light'
}

const DECORATIONS = {
  dark: {
    matchBackground: '#515c6a',
    matchBorder: 'transparent',
    matchOverviewRuler: '#515c6a',
    activeMatchBackground: '#c8674a',
    activeMatchBorder: 'transparent',
    activeMatchColorOverviewRuler: '#c8674a'
  },
  light: {
    matchBackground: '#d4aa70',
    matchBorder: 'transparent',
    matchOverviewRuler: '#d4aa70',
    activeMatchBackground: '#c8674a',
    activeMatchBorder: 'transparent',
    activeMatchColorOverviewRuler: '#c8674a'
  }
} as const

export function SearchBar({ searchAddon, onClose, themeKind }: Props): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const queryRef = useRef('')
  const [resultIndex, setResultIndex] = useState(-1)
  const [resultCount, setResultCount] = useState(0)

  useEffect(() => {
    inputRef.current?.focus()

    const disposable = searchAddon.onDidChangeResults((e) => {
      setResultIndex(e.resultIndex)
      setResultCount(e.resultCount)
    })

    return () => disposable.dispose()
  }, [searchAddon])

  const decorations = DECORATIONS[themeKind]

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    queryRef.current = e.target.value
    if (e.target.value) {
      searchAddon.findNext(e.target.value, { incremental: true, decorations })
    } else {
      searchAddon.clearDecorations()
      setResultIndex(-1)
      setResultCount(0)
    }
  }, [searchAddon, decorations])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      searchAddon.clearDecorations()
      onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        searchAddon.findPrevious(queryRef.current, { decorations })
      } else {
        searchAddon.findNext(queryRef.current, { decorations })
      }
    }
  }, [searchAddon, onClose, decorations])

  const isDark = themeKind === 'dark'

  const barStyle: React.CSSProperties = {
    position: 'absolute',
    top: 4,
    right: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 8px',
    borderRadius: 6,
    backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0',
    border: `1px solid ${isDark ? '#444' : '#ccc'}`,
    zIndex: 10,
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
  }

  const inputStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: isDark ? '#e0e0e0' : '#1a1a1a',
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 12,
    width: 180
  }

  const countStyle: React.CSSProperties = {
    color: isDark ? '#666' : '#999',
    fontSize: 11,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    whiteSpace: 'nowrap'
  }

  const btnStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: isDark ? '#999' : '#666',
    cursor: 'pointer',
    padding: '2px 4px',
    fontSize: 13,
    lineHeight: 1,
    borderRadius: 3
  }

  return (
    <div style={barStyle}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Find..."
        style={inputStyle}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {resultCount > 0 && (
        <span style={countStyle}>{resultIndex + 1}/{resultCount}</span>
      )}
      {queryRef.current && resultCount === 0 && (
        <span style={{ ...countStyle, color: isDark ? '#c55' : '#c33' }}>0</span>
      )}
      <button
        style={btnStyle}
        title="Previous (Shift+Enter)"
        onClick={() => searchAddon.findPrevious(queryRef.current, { decorations })}
      >
        &#x25B2;
      </button>
      <button
        style={btnStyle}
        title="Next (Enter)"
        onClick={() => searchAddon.findNext(queryRef.current, { decorations })}
      >
        &#x25BC;
      </button>
      <button
        style={btnStyle}
        title="Close (Esc)"
        onClick={() => { searchAddon.clearDecorations(); onClose() }}
      >
        &#x2715;
      </button>
    </div>
  )
}
