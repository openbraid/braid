import { useState, useRef, useEffect } from 'react'
import {
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Loader2,
  Check,
  RefreshCw,
  MessageSquare,
  MoreHorizontal,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import type { UseAutoSaveResult } from '../../hooks/useAutoSave'
import { KIND_CONFIG } from './constants'
import { ArtifactStatusPill, type ArtifactStatus } from './ArtifactStatusPill'
import type { ArtifactKind } from '../../../../shared/ipc-types'

type ArtifactCardHeaderProps = {
  kind: ArtifactKind
  title: string
  expanded: boolean
  onToggleExpand: () => void
  mode: 'local' | 'shared'
  onSetMode: (mode: 'local' | 'shared') => void
  saving: boolean
  serverSaved: boolean
  autoSave: UseAutoSaveResult
  isLoading: boolean
  isShared: boolean
  onToggleCommentPanel: () => void
  onPullLatest: () => void
  onSave: () => void
  onReload: () => void
  focused: boolean
  onToggleFocus: () => void
  artifactExists: boolean
  hasValidationErrors: boolean
  hasLocalChanges: boolean
  // Artifact status
  artifactStatus: string
  statusChangedByFirstName?: string | null
  statusChangedByLastName?: string | null
  statusChangedAt?: string | null
  onStatusChange: (status: ArtifactStatus) => void
  // Title editing
  editingTitle: boolean
  titleDraft: string
  titleInputRef: React.RefObject<HTMLInputElement | null>
  onTitleDraftChange: (v: string) => void
  onSaveTitle: (v: string) => void
  onCancelEditTitle: () => void
  onStartEditTitle: () => void
}

export function ArtifactCardHeader({
  kind,
  title,
  expanded,
  onToggleExpand,
  mode,
  onSetMode,
  saving,
  serverSaved,
  autoSave,
  isLoading,
  isShared,
  onToggleCommentPanel,
  onPullLatest,
  onSave,
  onReload,
  focused,
  onToggleFocus,

  artifactExists,
  hasValidationErrors,
  hasLocalChanges,
  artifactStatus,
  statusChangedByFirstName,
  statusChangedByLastName,
  statusChangedAt,
  onStatusChange,
  editingTitle,
  titleDraft,
  titleInputRef,
  onTitleDraftChange,
  onSaveTitle,
  onCancelEditTitle,
  onStartEditTitle,
}: ArtifactCardHeaderProps) {
  const config = KIND_CONFIG[kind] ?? KIND_CONFIG.REQUIREMENTS

  return (
    <div
      className={`h-10 flex items-center gap-2 px-3 select-none transition-colors bg-surface z-10 ${
        focused ? '' : 'cursor-pointer hover:bg-surface-hover'
      }`}
      onClick={focused ? undefined : onToggleExpand}
    >
      {/* Back arrow (focus mode) or chevron (normal mode) */}
      {focused ? (
        <button
          className="p-0.5 text-fg-tertiary hover:text-fg transition-colors rounded"
          onClick={(e) => { e.stopPropagation(); onToggleFocus() }}
          title="Exit focus (Esc)"
        >
          <ArrowLeft size={14} />
        </button>
      ) : (
        <span className="text-fg-tertiary">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      )}

      {/* Kind icon */}
      <span className="text-fg-secondary shrink-0">{config.icon}</span>

      {/* Title */}
      {editingTitle ? (
        <input
          ref={titleInputRef}
          value={titleDraft}
          onChange={(e) => onTitleDraftChange(e.target.value)}
          onBlur={() => onSaveTitle(titleDraft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSaveTitle(titleDraft)
            if (e.key === 'Escape') onCancelEditTitle()
          }}
          onClick={(e) => e.stopPropagation()}
          className="text-[13px] font-medium text-fg bg-transparent outline-none border-b border-brand px-0 py-0 min-w-[120px]"
          placeholder={config.label}
        />
      ) : (
        <span
          className="text-[13px] font-medium text-fg truncate cursor-text"
          onClick={(e) => { e.stopPropagation(); onStartEditTitle() }}
          title="Click to edit title"
        >
          {title}
        </span>
      )}

      {/* Artifact lifecycle status — only in Shared mode (team review workflow) */}
      {artifactExists && isShared && (
        <ArtifactStatusPill
          status={artifactStatus}
          statusChangedByFirstName={statusChangedByFirstName}
          statusChangedByLastName={statusChangedByLastName}
          statusChangedAt={statusChangedAt}
          onStatusChange={onStatusChange}
        />
      )}

      <div className="flex-1" />

      {/* Save indicator */}
      {isShared ? (
        <>
          {autoSave.status === 'saved' && (
            <span className="flex items-center gap-1 text-[10px] text-success">
              <Check size={10} /> Saved
            </span>
          )}
        </>
      ) : (
        <>
          {serverSaved && !saving && (
            <span className="flex items-center gap-1 text-[10px] text-success">
              <Check size={10} /> Saved to shared
            </span>
          )}
        </>
      )}

      {isLoading && (
        <Loader2 size={12} className="text-fg-tertiary animate-spin" />
      )}

      {/* Local / Shared toggle */}
      <div
        className="flex items-center text-[11px] border border-border rounded-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className={`px-2 py-0.5 transition-colors ${
            mode === 'local'
              ? 'bg-brand/15 text-brand font-medium'
              : 'text-fg-tertiary hover:text-fg-secondary'
          }`}
          onClick={() => onSetMode('local')}
        >
          Local
        </button>
        <button
          className={`px-2 py-0.5 transition-colors ${
            mode === 'shared'
              ? 'bg-brand/15 text-brand font-medium'
              : 'text-fg-tertiary hover:text-fg-secondary'
          }`}
          onClick={() => onSetMode('shared')}
        >
          Shared
        </button>
      </div>

      {/* Pull latest + Save buttons (Local mode) */}
      {mode === 'local' && (
        <>
          <button
            className="px-2 py-0.5 text-[11px] text-fg-secondary hover:text-fg transition-colors"
            onClick={(e) => { e.stopPropagation(); onPullLatest() }}
            title="Pull the latest shared version to your local copy"
          >
            Pull latest
          </button>
          <button
            className="px-2 py-0.5 text-[11px] font-medium bg-fg text-fg-inverse rounded hover:opacity-90 transition-opacity disabled:opacity-30"
            onClick={(e) => { e.stopPropagation(); onSave() }}
            disabled={saving || !artifactExists || hasValidationErrors || !hasLocalChanges}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </>
      )}

      {/* 3-dot menu */}
      <OverflowMenu
        isShared={isShared}
        focused={focused}
        onToggleCommentPanel={onToggleCommentPanel}
        onReload={onReload}
        onToggleFocus={onToggleFocus}
      />

    </div>
  )
}

// ─── Overflow menu ──────────────────────────────────────────────────────────

function OverflowMenu({
  isShared,
  focused,
  onToggleCommentPanel,
  onReload,
  onToggleFocus,
}: {
  isShared: boolean
  focused: boolean
  onToggleCommentPanel: () => void
  onReload: () => void
  onToggleFocus: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        className="p-1 text-fg-tertiary hover:text-fg-secondary transition-colors"
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        title="More actions"
      >
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-surface-elevated border border-border rounded-md shadow-lg z-30 py-1">
          <button
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors ${
              isShared
                ? 'text-fg-secondary hover:bg-surface-hover hover:text-fg'
                : 'text-fg-tertiary opacity-50 cursor-not-allowed'
            }`}
            disabled={!isShared}
            onClick={(e) => {
              e.stopPropagation()
              if (isShared) { onToggleCommentPanel(); setOpen(false) }
            }}
          >
            <MessageSquare size={12} />
            Comments
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-fg-secondary hover:bg-surface-hover hover:text-fg text-left transition-colors"
            onClick={(e) => { e.stopPropagation(); onReload(); setOpen(false) }}
          >
            <RefreshCw size={12} />
            Refresh
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-fg-secondary hover:bg-surface-hover hover:text-fg text-left transition-colors"
            onClick={(e) => { e.stopPropagation(); onToggleFocus(); setOpen(false) }}
          >
            {focused ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            {focused ? 'Exit focus' : 'Focus mode'}
          </button>
        </div>
      )}
    </div>
  )
}
