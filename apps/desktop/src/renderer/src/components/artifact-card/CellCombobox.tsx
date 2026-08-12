// ─── CellCombobox ─────────────────────────────────────────────────────────────
// Inline cell editor with dropdown + type-to-filter, similar to Linear's fields.
// Uses cmdk for keyboard navigation, filtering, and selection.

import { useState, useRef, useEffect, useCallback } from 'react'
import { Command } from 'cmdk'

// ─── Types ───────────────────────────────────────────────────────────────────

interface CellComboboxProps {
  value: string
  options: string[]
  onSelect: (value: string) => void
  onClose: () => void
  readOnly?: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CellCombobox({
  value,
  options,
  onSelect,
  onClose,
  readOnly = false
}: CellComboboxProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input when popover opens
  useEffect(() => {
    if (open) {
      setSearch(value)
      // Small delay so the DOM is ready
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [open, value])

  // Close on outside click — commit whatever is in the input
  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onSelect(search.trim())
        setOpen(false)
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, search, onSelect, onClose])

  const handleOpen = useCallback(() => {
    if (!readOnly) {
      setOpen(true)
    }
  }, [readOnly])

  const handleSelectOption = useCallback(
    (selectedValue: string) => {
      onSelect(selectedValue)
      setOpen(false)
      onClose()
    },
    [onSelect, onClose]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        onClose()
      }
      if (e.key === 'Enter') {
        // If there are no matching options, commit the typed value
        // cmdk will handle Enter for matched items via onSelect
        const trimmed = search.trim()
        const hasMatch = options.some(
          (opt) => opt.toLowerCase().includes(search.toLowerCase()) && search.length > 0
        )
        if (!hasMatch || search === '') {
          e.preventDefault()
          onSelect(trimmed)
          setOpen(false)
          onClose()
        }
      }
    },
    [search, options, onSelect, onClose]
  )

  // ─── Render ──────────────────────────────────────────────────────────────

  if (!open) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="w-full text-left px-2 py-1 rounded text-[11px] text-fg-secondary hover:bg-surface-active transition-colors truncate"
      >
        {value ? value : <span className="text-fg-tertiary">&mdash;</span>}
      </button>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="w-full text-left px-2 py-1 rounded text-[11px] text-fg-secondary hover:bg-surface-active transition-colors truncate"
      >
        {value ? value : <span className="text-fg-tertiary">&mdash;</span>}
      </button>
      <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-md shadow-lg z-20 overflow-hidden">
        <Command label="Cell combobox" shouldFilter={true} loop>
          <Command.Input
            ref={inputRef}
            value={search}
            onValueChange={setSearch}
            onKeyDown={handleKeyDown}
            placeholder="Type to filter or add new..."
            className="w-full px-2 py-1.5 text-[11px] text-fg bg-transparent border-b border-border-subtle outline-none placeholder:text-fg-tertiary"
          />
          <Command.List>
            {options.map((option) => (
              <Command.Item
                key={option}
                value={option}
                onSelect={handleSelectOption}
                className={`w-full text-left px-2 py-1.5 text-[11px] transition-colors ${
                  option === value
                    ? 'bg-brand/5 text-brand'
                    : 'text-fg-secondary hover:bg-surface-hover'
                }`}
              >
                {option}
              </Command.Item>
            ))}
            <Command.Empty className="px-2 py-1.5 text-[11px] text-fg-tertiary">
              {search.trim() ? 'Press Enter to add' : 'No options'}
            </Command.Empty>
          </Command.List>
        </Command>
      </div>
    </div>
  )
}
