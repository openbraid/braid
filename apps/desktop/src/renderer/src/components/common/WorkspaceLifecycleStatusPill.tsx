// ─── WorkspaceLifecycleStatusPill ─────────────────────────────────────────────
// Displays the workspace lifecycle status (active / completed) as a pill.
// Click to open a dropdown to change status. Used in ProjectPage table,
// WorkspaceCard dropdown, and WorkspaceListModal.

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import type { WorkspaceLifecycleStatus } from '../../../../shared/ipc-types'
import { formatRelativeTime } from '../../lib/format'

// ─── Status config ───────────────────────────────────────────────────────────

const LIFECYCLE_STATUSES = [
  { value: 'in_progress' as const, label: 'In Progress', dotClass: 'bg-brand' },
  { value: 'blocked' as const, label: 'Blocked', dotClass: 'bg-error' },
  { value: 'on_hold' as const, label: 'On Hold', dotClass: 'bg-warning' },
  { value: 'completed' as const, label: 'Completed', dotClass: 'bg-success' },
] as const

const STATUS_MAP = new Map(LIFECYCLE_STATUSES.map((s) => [s.value, s]))

export function getLifecycleStatusConfig(status: string) {
  return STATUS_MAP.get(status as WorkspaceLifecycleStatus) ?? LIFECYCLE_STATUSES[0]
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface WorkspaceLifecycleStatusPillProps {
  status: WorkspaceLifecycleStatus
  changedByFirstName?: string | null
  changedByLastName?: string | null
  changedAt?: string | null
  onStatusChange: (status: WorkspaceLifecycleStatus) => void
  disabled?: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export function WorkspaceLifecycleStatusPill({
  status,
  changedByFirstName,
  changedByLastName,
  changedAt,
  onStatusChange,
  disabled = false,
}: WorkspaceLifecycleStatusPillProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const config = getLifecycleStatusConfig(status)

  // Position the dropdown below the pill button
  const DROPDOWN_WIDTH = 176 // w-44 = 11rem = 176px

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const left = Math.min(rect.left, window.innerWidth - DROPDOWN_WIDTH)
    setDropdownPos({
      top: rect.bottom + 4,
      left,
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

  function handleSelect(value: WorkspaceLifecycleStatus) {
    setOpen(false)
    if (value !== status) {
      onStatusChange(value)
    }
  }

  return (
    <>
      {/* Pill button — only stops propagation on the button itself */}
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation()
          if (!disabled) setOpen(!open)
        }}
        disabled={disabled}
        className={`
          flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap
          border transition-colors
          ${disabled ? 'opacity-50 cursor-default' : 'cursor-pointer hover:bg-surface-hover'}
          border-border-subtle text-fg-secondary
        `}
      >
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dotClass}`} />
        {config.label}
        {!disabled && <ChevronDown size={10} className="text-fg-tertiary" />}
      </button>

      {/* Dropdown — portaled to body to escape overflow clipping */}
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed w-44 bg-surface border border-border rounded-md shadow-lg z-50 overflow-hidden"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {LIFECYCLE_STATUSES.map((s) => (
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
          {(changedByFirstName || changedByLastName) && (
            <div className="px-3 py-2 border-t border-border-subtle text-[10px] text-fg-tertiary">
              Set by {[changedByFirstName, changedByLastName].filter(Boolean).join(' ')}
              {changedAt && ` · ${formatRelativeTime(new Date(changedAt).getTime())}`}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
