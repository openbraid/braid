// Settings modal — minimal, modern settings interface.
// Opened via the settings gear icon in the title bar.

import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, Moon, Sun } from 'lucide-react'
import { TeamServerSection } from './TeamServerSection'
import { useUIStore } from '../../store/ui-store'
import { useScratchStore } from '../../store/scratch-store'
import { ipc } from '../../lib/ipc'
import type { AgentListItem } from '../../../../shared/ipc-types'

type ThemeKind = 'dark' | 'light'

export function SettingsModal() {
  const { activeModal, closeModal } = useUIStore()
  const open = activeModal === 'settings'

  const [themeKind, setThemeKind] = useState<ThemeKind>('dark')
  const defaultAgent = useScratchStore((s) => s.defaultAgent)
  const setDefaultAgent = useScratchStore((s) => s.setDefaultAgent)
  const [allAgents, setAllAgents] = useState<AgentListItem[]>([])
  const [detectedAgents, setDetectedAgents] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    Promise.all([ipc.app.getState(), ipc.agents.list(), ipc.agents.detect()]).then(
      ([state, agents, detected]) => {
        setThemeKind(state.themeKind ?? 'dark')
        setAllAgents(agents)
        setDetectedAgents(new Set(detected))
      }
    )
  }, [open])

  function handleThemeSelect(kind: ThemeKind) {
    setThemeKind(kind)
    ipc.app.setState({ themeKind: kind })
    applyRendererTheme(kind)
  }

  function handleDefaultAgentChange(agentId: string) {
    setDefaultAgent(agentId || null)
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) closeModal()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
          <Dialog.Content className="w-full max-w-[480px] bg-surface-deep border border-border rounded-2xl shadow-2xl overflow-hidden focus:outline-none">
            <div className="flex items-center px-5 pt-4 pb-4 border-b border-border">
              <Dialog.Title className="text-[14px] font-semibold text-fg">Settings</Dialog.Title>
            </div>

            <div className="px-5 py-4 flex flex-col gap-5">
              {/* Theme row */}
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-fg-secondary">Theme</span>
                <div className="flex gap-2">
                  <ThemeOption
                    kind="dark"
                    label="Dark"
                    icon={<Moon size={13} />}
                    isActive={themeKind === 'dark'}
                    onClick={() => handleThemeSelect('dark')}
                  />
                  <ThemeOption
                    kind="light"
                    label="Light"
                    icon={<Sun size={13} />}
                    isActive={themeKind === 'light'}
                    onClick={() => handleThemeSelect('light')}
                  />
                </div>
              </div>

              {/* Default Agent */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[13px] text-fg-secondary">Default agent</span>
                  <p className="text-[11px] text-fg-tertiary mt-0.5">
                    Used by Scratch to launch agents
                  </p>
                </div>
                <div className="relative">
                  <select
                    value={defaultAgent ?? ''}
                    onChange={(e) => handleDefaultAgentChange(e.target.value)}
                    className="appearance-none pl-3 pr-7 py-1.5 rounded-lg bg-surface border border-border text-[12px] text-fg outline-none focus:border-brand transition-colors cursor-pointer"
                  >
                    <option value="">None</option>
                    {allAgents.map((agent) => {
                      const isDetected = detectedAgents.has(agent.id)
                      const canLaunch = agent.supportsLaunch
                      const disabled = !isDetected || !canLaunch
                      const suffix = !isDetected
                        ? ' (not installed)'
                        : !canLaunch
                          ? ' (no CLI launch)'
                          : ''
                      return (
                        <option key={agent.id} value={agent.id} disabled={disabled}>
                          {agent.displayName}
                          {suffix}
                        </option>
                      )
                    })}
                  </select>
                  <ChevronDown
                    size={11}
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-tertiary"
                  />
                </div>
              </div>
              <TeamServerSection />
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ThemeOption({
  label,
  icon,
  isActive,
  onClick
}: {
  kind: string
  label: string
  icon: React.ReactNode
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all cursor-pointer
        ${
          isActive
            ? 'border-brand bg-brand-subtle text-brand'
            : 'border-border text-fg-tertiary hover:border-border-strong hover:text-fg-secondary'
        }
      `}
    >
      {icon}
      {label}
    </button>
  )
}

function applyRendererTheme(kind: 'dark' | 'light') {
  if (kind === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}
