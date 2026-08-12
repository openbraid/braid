import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, Loader2, UserPlus, X } from 'lucide-react'
import { useUIStore } from '../../store/ui-store'
import { ipc } from '../../lib/ipc'
import type { Contributor } from '../../../../shared/ipc-types'

export function InviteContributorModal() {
  const { activeModal, modalContext, closeModal } = useUIStore()

  const open = activeModal === 'invite-contributor'
  const projectId = modalContext?.modal === 'invite-contributor' ? modalContext.projectId : undefined

  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [contributors, setContributors] = useState<Contributor[]>([])
  const [listLoading, setListLoading] = useState(false)

  // Fetch contributors when modal opens
  useEffect(() => {
    if (!open || !projectId) return
    setEmail('')
    setError(null)
    setLoading(false)
    setListLoading(true)

    ipc.contributors.list(projectId)
      .then(setContributors)
      .catch(() => setContributors([]))
      .finally(() => setListLoading(false))
  }, [open, projectId])

  async function handleInvite() {
    if (!projectId || !email.trim()) return
    setError(null)
    setLoading(true)

    try {
      const contributor = await ipc.contributors.invite(projectId, email.trim())
      setContributors((prev) => [...prev, contributor])
      setEmail('')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      const code = msg.includes('No user found')
        ? 'USER_NOT_FOUND'
        : msg.includes('already a contributor')
          ? 'ALREADY_CONTRIBUTOR'
          : null

      if (code === 'USER_NOT_FOUND') {
        setError('No user found with that email address')
      } else if (code === 'ALREADY_CONTRIBUTOR') {
        setError('This user is already a contributor')
      } else {
        setError((err as { message?: string })?.message ?? 'Failed to invite contributor')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleRemove(userId: string) {
    if (!projectId) return
    try {
      await ipc.contributors.remove(projectId, userId)
      setContributors((prev) => prev.filter((c) => c.userId !== userId))
    } catch {
      // silent — the list will be stale until next open
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && email.trim() && !loading) {
      e.preventDefault()
      handleInvite()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) closeModal() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-overlay z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] bg-surface-deep border border-border rounded-2xl shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-2">
              <UserPlus size={14} className="text-fg-secondary" />
              <Dialog.Title className="text-[15px] font-semibold text-fg">
                Contributors
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button className="text-fg-tertiary hover:text-fg-secondary transition-colors">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="px-6 pt-5 pb-6 flex flex-col gap-5">

            {/* Invite input */}
            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-semibold text-fg">Invite by email</p>
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null) }}
                  onKeyDown={handleKeyDown}
                  placeholder="teammate@company.com"
                  className={[
                    'flex-1 h-9 px-3 text-[13px] text-fg bg-surface border rounded-lg outline-none focus:border-border-strong placeholder:text-fg-tertiary transition-colors',
                    error ? 'border-error' : 'border-border'
                  ].join(' ')}
                />
                <button
                  onClick={handleInvite}
                  disabled={!email.trim() || loading}
                  className={[
                    'h-9 px-4 rounded-lg text-[13px] font-medium transition-colors',
                    email.trim() && !loading
                      ? 'bg-brand text-white hover:bg-brand-hover cursor-pointer'
                      : 'bg-surface text-fg-tertiary cursor-not-allowed'
                  ].join(' ')}
                >
                  {loading ? <Loader2 size={13} className="animate-spin" /> : 'Invite'}
                </button>
              </div>
              {error && (
                <div className="flex items-start gap-2">
                  <AlertCircle size={12} className="text-error shrink-0 mt-0.5" />
                  <p className="text-[11px] text-error">{error}</p>
                </div>
              )}
            </div>

            {/* Contributor list */}
            <div className="flex flex-col gap-2">
              <p className="text-[12px] text-fg-tertiary font-medium uppercase tracking-wide">
                Members
              </p>

              {listLoading ? (
                <div className="flex items-center gap-2 py-3 text-[12px] text-fg-tertiary">
                  <Loader2 size={13} className="animate-spin" />
                  Loading…
                </div>
              ) : contributors.length === 0 ? (
                <p className="text-[12px] text-fg-tertiary py-2">No contributors yet.</p>
              ) : (
                <div className="flex flex-col border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                  {contributors.map((c) => (
                    <div
                      key={c.userId}
                      className="flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-b-0"
                    >
                      {/* Avatar placeholder */}
                      <div className="w-6 h-6 rounded-full bg-surface-hover flex items-center justify-center text-[10px] font-bold text-fg-secondary shrink-0">
                        {(c.firstName ?? c.email).charAt(0).toUpperCase()}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-fg truncate">
                          {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email}
                        </p>
                        {c.firstName && (
                          <p className="text-[11px] text-fg-tertiary truncate">{c.email}</p>
                        )}
                      </div>

                      <span className="text-[10px] text-fg-tertiary font-medium uppercase tracking-wide shrink-0">
                        {c.role}
                      </span>

                      {c.role !== 'owner' && (
                        <button
                          onClick={() => handleRemove(c.userId)}
                          className="text-fg-tertiary hover:text-fg-secondary transition-colors shrink-0"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
