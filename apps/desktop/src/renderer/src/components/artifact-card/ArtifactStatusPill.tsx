// ─── ArtifactStatusPill ───────────────────────────────────────────────────────
// Displays the artifact-level lifecycle status as a colored pill in the header.
// Click to open a dropdown to change status. Calls API immediately on selection.
//
// Statuses: draft, in_review, approved, update_required, outdated

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

// ─── Status config ───────────────────────────────────────────────────────────

export const ARTIFACT_STATUSES = [
  { value: 'draft', label: 'Draft', dotClass: 'bg-fg-tertiary' },
  { value: 'in_review', label: 'In Review', dotClass: 'bg-warning' },
  { value: 'approved', label: 'Approved', dotClass: 'bg-success' },
  { value: 'update_required', label: 'Update Required', dotClass: 'bg-error' },
  { value: 'outdated', label: 'Outdated', dotClass: 'bg-warning' },
] as const

export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number]['value']

const STATUS_MAP = new Map<string, typeof ARTIFACT_STATUSES[number]>(ARTIFACT_STATUSES.map((s) => [s.value, s]))

function getStatusConfig(status: string) {
  return STATUS_MAP.get(status) ?? ARTIFACT_STATUSES[0] // fallback to draft
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface ArtifactStatusPillProps {
  status: string
  statusChangedByFirstName?: string | null
  statusChangedByLastName?: string | null
  statusChangedAt?: string | null
  onStatusChange: (status: ArtifactStatus) => void
  disabled?: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ArtifactStatusPill({
  status,
  statusChangedByFirstName,
  statusChangedByLastName,
  statusChangedAt,
  onStatusChange,
  disabled = false,
}: ArtifactStatusPillProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const config = getStatusConfig(status)

  // Position the dropdown below the pill button
  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
    })
  }, [])

  // Recalculate on open, and on scroll/resize while open
  useEffect(() => {
    if (!open) return
    updatePosition()

    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function handleSelect(value: ArtifactStatus) {
    setOpen(false)
    if (value !== status) {
      onStatusChange(value)
    }
  }

  // Format "2h ago" / "3d ago" from ISO string
  function formatTimeAgo(isoString: string): string {
    const diff = Date.now() - new Date(isoString).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {/* Pill button */}
      <button
        ref={buttonRef}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`
          flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium
          border transition-colors
          ${disabled ? 'opacity-50 cursor-default' : 'cursor-pointer hover:bg-surface-hover'}
          border-border-subtle text-fg-secondary
        `}
      >
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dotClass}`} />
        {config.label}
        {!disabled && <ChevronDown size={10} className="text-fg-tertiary" />}
      </button>

      {/* Dropdown — portaled to body to escape overflow-clip */}
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed w-48 bg-surface border border-border rounded-md shadow-lg z-50 overflow-hidden"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {ARTIFACT_STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => handleSelect(s.value)}
              className={`
                w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 transition-colors
                ${s.value === status
                  ? 'bg-brand/5 text-brand font-medium'
                  : 'text-fg-secondary hover:bg-surface-hover'
                }
              `}
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${s.dotClass}`} />
              {s.label}
            </button>
          ))}

          {/* Footer: who changed it last */}
          {(statusChangedByFirstName || statusChangedByLastName) && (
            <div className="px-3 py-2 border-t border-border-subtle text-[10px] text-fg-tertiary">
              Set by {[statusChangedByFirstName, statusChangedByLastName].filter(Boolean).join(' ')}
              {statusChangedAt && ` · ${formatTimeAgo(statusChangedAt)}`}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
