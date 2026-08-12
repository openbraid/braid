import { useState, useEffect } from 'react'
import { Terminal, Bot, Info, X, RefreshCw, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ipc } from '../../../lib/ipc'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/Tooltip'
import { useAuthStore } from '../../../store/auth-store'
import { useUIStore } from '../../../store/ui-store'
import type { AgentListItem } from '../../../../../shared/ipc-types'

// ─── Settings tab ────────────────────────────────────────────────────────────

export function SettingsTab({ projectId }: { projectId: string }) {
  const [commands, setCommands] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)

  // Agent instruction settings
  const [artifactsEnabled, setArtifactsEnabled] = useState(true)
  const [selectedAgents, setSelectedAgents] = useState<string[]>([])
  const [allAgents, setAllAgents] = useState<AgentListItem[]>([])
  const [detectedAgents, setDetectedAgents] = useState<Set<string>>(new Set())
  const [detecting, setDetecting] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(true)

  // Ownership — only the owner sees the Danger zone. `null` = still loading;
  // `false` = not owner (hide section); `true` = show it.
  const [isOwner, setIsOwner] = useState<boolean | null>(null)
  const authUser = useAuthStore((s) => s.user)
  const openModal = useUIStore((s) => s.openModal)

  useEffect(() => {
    if (!authUser?.backendUserId) {
      setIsOwner(false)
      return
    }
    let cancelled = false
    ipc.contributors.list(projectId).then((contributors) => {
      if (cancelled) return
      const owner = contributors.find((c) => c.role === 'owner')
      setIsOwner(owner?.userId === authUser.backendUserId)
    }).catch(() => { if (!cancelled) setIsOwner(false) })
    return () => { cancelled = true }
  }, [projectId, authUser?.backendUserId])

  useEffect(() => {
    Promise.all([
      ipc.projects.getMonitoredCommands(projectId),
      ipc.projects.getSettings(projectId),
      ipc.agents.list(),
      ipc.agents.detect(),
    ]).then(async ([cmds, settings, agents, detected]) => {
      setCommands(cmds)
      setArtifactsEnabled(settings.artifactsEnabled)
      setAllAgents(agents)
      setDetectedAgents(new Set(detected))

      // Auto-select detected agents if none are selected yet (first-time setup)
      if (settings.selectedAgents.length === 0 && detected.length > 0) {
        setSelectedAgents(detected)
        try {
          await ipc.projects.updateSettings(projectId, { selectedAgents: detected })
        } catch { /* best-effort */ }
      } else {
        setSelectedAgents(settings.selectedAgents)
      }

      setLoading(false)
      setSettingsLoading(false)
    }).catch(() => {
      setLoading(false)
      setSettingsLoading(false)
    })
  }, [projectId])

  async function handleAdd() {
    const cmd = input.trim().toLowerCase()
    if (!cmd || commands.includes(cmd)) {
      setInput('')
      return
    }
    try {
      await ipc.projects.addMonitoredCommand(projectId, cmd)
      setCommands((prev) => [...prev, cmd])
      setInput('')
    } catch {
      toast('Failed to add command')
    }
  }

  async function handleRemove(cmd: string) {
    try {
      await ipc.projects.removeMonitoredCommand(projectId, cmd)
      setCommands((prev) => prev.filter((c) => c !== cmd))
    } catch {
      toast('Failed to remove command')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  // Split agents into detected (top) and not-detected (bottom)
  const detectedList = allAgents.filter((a) => detectedAgents.has(a.id))
  const notDetectedList = allAgents.filter((a) => !detectedAgents.has(a.id))

  return (
    <section className="max-w-[560px] mx-auto">
      {/* ── Monitored Commands ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Terminal size={14} className="text-fg-secondary" />
          <h2 className="text-[15px] font-semibold text-fg">Monitored Commands</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="flex items-center justify-center w-4 h-4 rounded-full text-fg-tertiary hover:text-fg-secondary transition-colors" title="About monitored commands">
                <Info size={11} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[260px]">
              <p className="text-[11px] leading-relaxed">
                Common commands like npm, yarn, cargo, docker, terraform, etc. are monitored by default.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>

        <p className="text-[12px] text-fg-secondary mb-3 ml-[22px]">
          Add project-specific commands to monitor in terminals.
        </p>

        {/* Input + Add button */}
        <div className="flex items-center gap-2 mb-2 ml-[22px]">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. cdk deploy"
            className="w-[240px] h-7 px-2.5 text-[12px] text-fg bg-surface border border-border rounded-md outline-none focus:border-brand placeholder:text-fg-tertiary transition-colors"
          />
          {input.trim() && (
            <button
              onClick={handleAdd}
              className="flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium text-fg-secondary bg-surface border border-border rounded-md hover:border-border-strong transition-colors"
            >
              <Plus size={10} />
              Add
            </button>
          )}
        </div>

        {/* Pills */}
        <div className="ml-[22px]">
          {loading ? (
            <div className="text-[11px] text-fg-tertiary">Loading...</div>
          ) : commands.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {commands.map((cmd) => (
                <div
                  key={cmd}
                  className="flex items-center gap-1 px-2 py-0.5 bg-surface border border-border rounded group"
                >
                  <span className="text-[11px] text-fg-secondary font-mono">{cmd}</span>
                  <button
                    onClick={() => handleRemove(cmd)}
                    className="flex items-center justify-center w-3 h-3 rounded text-fg-tertiary hover:text-fg transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <X size={8} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-fg-tertiary">
              No custom commands added.
            </p>
          )}
        </div>
      </div>

      {/* ── Divider ────────────────────────────────────────────────────── */}
      <div className="border-t border-border my-6" />

      {/* ── Agent Instructions ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Bot size={14} className="text-fg-secondary" />
          <h2 className="text-[15px] font-semibold text-fg">Agent Instructions</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={async () => {
                  setDetecting(true)
                  try {
                    const detected = await ipc.agents.detect()
                    setDetectedAgents(new Set(detected))
                  } catch { /* ignore */ }
                  finally { setDetecting(false) }
                }}
                disabled={detecting}
                className="flex items-center justify-center w-4 h-4 rounded-full text-fg-tertiary hover:text-fg-secondary transition-colors"
              >
                <RefreshCw size={10} className={detecting ? 'animate-spin' : ''} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[260px]">
              <p className="text-[11px] leading-relaxed">
                Re-detect which agents are installed on your machine.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>

        <p className="text-[12px] text-fg-secondary mb-3 ml-[22px]">
          Creates an instruction file in your workspace for each selected agent so it understands how to work with artifacts.
        </p>

        {/* Enable toggle */}
        <label className="flex items-center justify-between mb-3 ml-[22px] cursor-pointer select-none">
          <span className="text-[12px] font-medium text-fg">Enable artifact instructions</span>
          <button
            role="switch"
            aria-checked={artifactsEnabled}
            onClick={async () => {
              const value = !artifactsEnabled
              setArtifactsEnabled(value)
              try {
                await ipc.projects.updateSettings(projectId, { artifactsEnabled: value })
              } catch {
                setArtifactsEnabled(!value)
                toast('Failed to update setting')
              }
            }}
            className={`relative w-8 h-[18px] rounded-full transition-colors ${artifactsEnabled ? 'bg-brand' : 'bg-border'}`}
          >
            <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${artifactsEnabled ? 'left-[16px]' : 'left-[2px]'}`} />
          </button>
        </label>

        {/* Agent grid */}
        {artifactsEnabled && !settingsLoading && (
          <div className="ml-[22px]">
            {/* Detected agents — 2 column grid */}
            {detectedList.length > 0 && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                {detectedList.map((agent) => (
                  <AgentCheckbox
                    key={agent.id}
                    agent={agent}
                    isSelected={selectedAgents.includes(agent.id)}
                    isDetected
                    onToggle={async (checked) => {
                      const updated = checked
                        ? [...selectedAgents, agent.id]
                        : selectedAgents.filter((a) => a !== agent.id)
                      setSelectedAgents(updated)
                      try {
                        await ipc.projects.updateSettings(projectId, { selectedAgents: updated })
                      } catch {
                        setSelectedAgents(selectedAgents)
                        toast('Failed to update setting')
                      }
                    }}
                  />
                ))}
              </div>
            )}

            {/* Not detected agents */}
            {notDetectedList.length > 0 && (
              <>
                <p className="text-[10px] text-fg-tertiary mt-3 mb-1 uppercase tracking-wider">Not detected</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {notDetectedList.map((agent) => (
                    <AgentCheckbox
                      key={agent.id}
                      agent={agent}
                      isSelected={selectedAgents.includes(agent.id)}
                      isDetected={false}
                      onToggle={async (checked) => {
                        const updated = checked
                          ? [...selectedAgents, agent.id]
                          : selectedAgents.filter((a) => a !== agent.id)
                        setSelectedAgents(updated)
                        try {
                          await ipc.projects.updateSettings(projectId, { selectedAgents: updated })
                        } catch {
                          setSelectedAgents(selectedAgents)
                          toast('Failed to update setting')
                        }
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Danger Zone (owner-only) ───────────────────────────────────── */}
      {isOwner && (
        <>
          <div className="border-t border-border my-6" />

          <div>
            <div className="flex items-center gap-2 mb-1">
              <Trash2 size={14} className="text-error" />
              <h2 className="text-[15px] font-semibold text-fg">Danger zone</h2>
            </div>

            <p className="text-[12px] text-fg-secondary mb-3 ml-[22px]">
              Deleting a project is permanent. All workspaces, artifacts, and session history will be removed for every contributor.
            </p>

            <div className="ml-[22px]">
              <button
                onClick={() => openModal('delete-project', { modal: 'delete-project', projectId })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-error bg-error/5 border border-error/30 rounded-md hover:bg-error/10 transition-colors"
              >
                <Trash2 size={11} />
                Delete project
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

// ─── Agent checkbox row ──────────────────────────────────────────────────────

function AgentCheckbox({
  agent,
  isSelected,
  isDetected,
  onToggle,
}: {
  agent: AgentListItem
  isSelected: boolean
  isDetected: boolean
  onToggle: (checked: boolean) => void
}) {
  return (
    <label className={`flex items-center gap-2 py-1 select-none ${isDetected ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}>
      <input
        type="checkbox"
        checked={isSelected}
        disabled={!isDetected}
        onChange={(e) => onToggle(e.target.checked)}
        className="w-3 h-3 rounded border-border accent-brand disabled:opacity-50"
      />
      <span className="text-[12px] text-fg">{agent.displayName}</span>
    </label>
  )
}
