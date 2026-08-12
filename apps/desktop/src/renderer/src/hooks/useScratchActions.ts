import { useMemo } from 'react'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTerminalStore } from '../store/terminal-store'
import { useUIStore } from '../store/ui-store'
import { useScratchStore } from '../store/scratch-store'
import { track } from '../lib/analytics'
import { ipc } from '../lib/ipc'
import type { WorkspaceTerminalEntry } from '../../../shared/ipc-types'

type ActionState = {
  enabled: boolean
  tooltip: string
  execute: (selectedText: string) => void
}

type LaunchAgentState = ActionState & {
  agentName: string | null
}

type ScratchActions = {
  sendToTerminal: ActionState
  launchAgent: LaunchAgentState
  createWorkspace: ActionState
}

/**
 * Resolves the target terminal for "Send to terminal".
 * Returns the first terminal that can accept input (idle, waiting, or shell).
 */
function findReceivableTerminal(terminals: WorkspaceTerminalEntry[]): WorkspaceTerminalEntry | null {
  const active = terminals.filter((t) => t.isActive)
  if (active.length === 0) return null

  // Prefer idle or waiting (agent finished / asking question)
  const idleOrWaiting = active.find((t) => t.status === 'idle' || t.status === 'waiting')
  if (idleOrWaiting) return idleOrWaiting

  // All are running — can't send
  return null
}

export function useScratchActions(): ScratchActions {
  const activeView = useWorkspaceStore((s) => s.activeView)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const terminals = useTerminalStore((s) => s.terminals)
  const openModal = useUIStore((s) => s.openModal)

  const workspaceTerminals = activeWorkspaceId
    ? terminals.get(activeWorkspaceId) ?? []
    : []

  const isOnWorkspace = activeView === 'workspace' && !!activeWorkspaceId

  // Resolve the projectId for the active workspace
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const projectId = activeWorkspace?.projectId ?? activeProjectId

  // Default agent from Zustand (set in Settings modal, persisted in app-state)
  const defaultAgent = useScratchStore((s) => s.defaultAgent)

  // ─── Send to terminal ──────────────────────────────────────────────────────

  const sendToTerminal = useMemo<ActionState>(() => {
    if (!isOnWorkspace) {
      return {
        enabled: false,
        tooltip: 'Open a workspace to use this action',
        execute: () => {}
      }
    }

    const target = findReceivableTerminal(workspaceTerminals)
    if (!target) {
      const hasTerminals = workspaceTerminals.some((t) => t.isActive)
      return {
        enabled: false,
        tooltip: hasTerminals
          ? 'All terminals are busy'
          : 'Open a terminal first',
        execute: () => {}
      }
    }

    return {
      enabled: true,
      tooltip: 'Send to terminal',
      execute: (text: string) => {
        ipc.terminal.writeInput(target.terminalId, text + '\r')
      }
    }
  }, [isOnWorkspace, workspaceTerminals])

  // ─── Launch with agent ─────────────────────────────────────────────────────
  // Always creates a new terminal. Only disabled if not on workspace or no default agent.

  const launchAgent = useMemo<LaunchAgentState>(() => {
    if (!isOnWorkspace || !activeWorkspaceId) {
      return {
        enabled: false,
        tooltip: 'Open a workspace to use this action',
        agentName: null,
        execute: () => {}
      }
    }

    if (!defaultAgent) {
      return {
        enabled: false,
        tooltip: 'Set a default agent in Settings',
        agentName: null,
        execute: () => {}
      }
    }

    const agentName = defaultAgent

    return {
      enabled: true,
      tooltip: `Launch with ${agentName}`,
      agentName,
      execute: async (text: string) => {
        track('scratch_agent_launched', { agent: agentName })
        await ipc.scratch.launchAgent(agentName, text, activeWorkspaceId!)
      }
    }
  }, [isOnWorkspace, activeWorkspaceId, defaultAgent])

  // ─── Create workspace & launch ──────────────────────────────────────────────
  // Always enabled. Opens the create workspace modal with context.

  const createWorkspace = useMemo<ActionState>(() => {
    return {
      enabled: true,
      tooltip: defaultAgent ? `Create workspace & launch with ${defaultAgent}` : 'Create workspace',
      execute: (text: string) => {
        // Store selected text for the modal to pick up (via Zustand set)
        useScratchStore.getState().setScratchContextForModal({
          selectedText: text,
          defaultAgent
        })
        if (projectId) {
          openModal('create-workspace', { modal: 'create-workspace', projectId, fromScratch: true })
        } else {
          openModal('create-workspace', { modal: 'create-workspace', projectId: '', fromScratch: true })
        }
      }
    }
  }, [projectId, defaultAgent, openModal])

  return { sendToTerminal, launchAgent, createWorkspace }
}
