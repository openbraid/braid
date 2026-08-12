import { useState, useEffect, useCallback, useRef } from 'react'
import { Copy, Check, RefreshCw, Pencil } from 'lucide-react'
import { ipc } from '../../lib/ipc'
import { track } from '../../lib/analytics'
import { formatRelativeTime } from '../../lib/format'
import { DataTable, type ColumnDef } from '../common/DataTable'
import type { AgentSession } from '../../../../shared/ipc-types'

// ─── Copy helpers ───────────────────────────────────────────────────────────

function useCopyFeedback() {
  const [copied, setCopied] = useState(false)
  const copy = (text: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    ipc.clipboard.copy(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return { copied, copy }
}

function CopyButton({ text, onCopy }: { text: string; onCopy?: () => void }) {
  const { copied, copy } = useCopyFeedback()
  return (
    <button
      onClick={(e) => { copy(text, e); onCopy?.() }}
      className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-fg-secondary hover:text-fg bg-surface border border-border hover:border-border-strong rounded-md transition-colors whitespace-nowrap"
    >
      {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy resume'}
    </button>
  )
}

function CopyableSessionId({ sessionId }: { sessionId: string }) {
  const { copied, copy } = useCopyFeedback()
  return (
    <div className="flex items-center gap-1 min-w-0">
      <span className="text-[11px] text-fg-secondary font-mono truncate" title={sessionId}>{sessionId}</span>
      <button
        onClick={(e) => copy(sessionId, e)}
        className="shrink-0 text-fg-tertiary hover:text-fg-secondary transition-colors"
        title="Copy session ID"
      >
        {copied ? <Check size={10} className="text-success" /> : <Copy size={10} />}
      </button>
    </div>
  )
}

// ─── Inline editable name cell ──────────────────────────────────────────────

function EditableNameCell({
  session,
  onRename,
}: {
  session: AgentSession
  onRename: (sessionId: string, agent: string, name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const displayName = session.customName || session.title || null

  function startEditing(e: React.MouseEvent) {
    e.stopPropagation()
    setDraft(displayName ?? '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function save() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== displayName) {
      onRename(session.sessionId, session.agent, trimmed)
    }
    setEditing(false)
  }

  function cancel() {
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); save() }
    if (e.key === 'Escape') { e.preventDefault(); cancel() }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="w-full text-[12px] text-fg bg-transparent border-b border-brand outline-none py-0"
        placeholder="Name this session..."
      />
    )
  }

  return (
    <div className="group/name flex items-center gap-1.5 min-w-0" onDoubleClick={startEditing}>
      {displayName ? (
        <span className="text-[12px] text-fg truncate" title={displayName}>{displayName}</span>
      ) : (
        <span className="text-[12px] text-fg-tertiary italic truncate">Unnamed session</span>
      )}
      <button
        onClick={startEditing}
        className="shrink-0 opacity-0 group-hover/name:opacity-100 text-fg-tertiary hover:text-fg-secondary transition-opacity"
      >
        <Pencil size={10} />
      </button>
    </div>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SessionsTab({ workspaceId }: { workspaceId: string }) {
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await ipc.sessions.list(workspaceId)
      setSessions(result)
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { load().then(() => track('session_list_viewed')) }, [load])

  const handleRename = useCallback(async (sessionId: string, agent: string, name: string) => {
    // Optimistic update
    setSessions((prev) =>
      prev.map((s) =>
        s.sessionId === sessionId && s.agent === agent ? { ...s, customName: name } : s
      )
    )
    try {
      await ipc.sessions.rename(sessionId, agent, name)
    } catch {
      // Revert on failure
      load()
    }
  }, [load])

  const columns: ColumnDef<AgentSession>[] = [
    {
      id: 'sessionId',
      header: 'Session ID',
      width: '160px',
      sortFn: (row) => row.sessionId,
      cell: (row) => <CopyableSessionId sessionId={row.sessionId} />,
    },
    {
      id: 'name',
      header: 'Name',
      sortFn: (row) => row.customName || row.title || '',
      cell: (row) => (
        <EditableNameCell session={row} onRename={handleRename} />
      ),
    },
    {
      id: 'agent',
      header: 'Agent',
      width: '120px',
      sortFn: (row) => row.agent,
      cell: (row) => (
        <span className="text-[12px] text-fg-secondary">{row.agent}</span>
      ),
    },
    {
      id: 'lastUpdated',
      header: 'Last Updated',
      width: '120px',
      align: 'right',
      sortFn: (row) => row.lastUpdated,
      cell: (row) => (
        <span className="text-[12px] text-fg-tertiary">{formatRelativeTime(row.lastUpdated)}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      width: '140px',
      align: 'right',
      cell: (row) => row.resumeCommand ? <CopyButton text={row.resumeCommand} onCopy={() => track('session_resumed', { agent: row.agent })} /> : null,
    },
  ]

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[13px] font-semibold text-fg">Agent Sessions</h2>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-fg-secondary hover:text-fg bg-surface border border-border hover:border-border-strong rounded-md transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center">
          <span className="text-[13px] text-fg-tertiary">Loading sessions...</span>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={sessions}
          rowKey={(s) => `${s.sessionId}::${s.agent}`}
          defaultSortId="lastUpdated"
          defaultSortDesc
          emptyState={
            <div className="py-16 text-center">
              <p className="text-[13px] text-fg-tertiary">No agent sessions found for this workspace</p>
            </div>
          }
        />
      )}
    </div>
  )
}
