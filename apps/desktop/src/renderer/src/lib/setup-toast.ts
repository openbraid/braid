import { toast } from 'sonner'
import { ipc } from './ipc'
import { useUIStore } from '../store/ui-store'
import { useWorkspaceStore } from '../store/workspace-store'

function getWorkspaceName(workspaceId: string): string | null {
  const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  return ws?.name || null
}

/**
 * Show a non-blocking toast prompting to run .braid/setup.sh.
 * Auto-dismisses after 30s if user doesn't interact.
 *
 * Flow: prompt → running → success/failure
 * On failure: "View output" opens the output modal.
 */
export function promptSetupToast(workspaceId: string, repoNames?: string[]): void {
  const toastId = `setup-${workspaceId}`

  const description = !repoNames || repoNames.length <= 1
    ? '.braid/setup.sh'
    : repoNames.map((r) => `${r}/.braid/`).join(', ')

  const name = getWorkspaceName(workspaceId)
  toast(name ? `Setup script found — ${name}` : 'Setup script found', {
    id: toastId,
    description,
    duration: 300_000,
    action: {
      label: 'Run',
      onClick: () => runSetup(workspaceId, toastId)
    }
  })
}

async function runSetup(workspaceId: string, toastId: string): Promise<void> {
  const name = getWorkspaceName(workspaceId)
  toast.loading(name ? `Running setup — ${name}…` : 'Running setup…', { id: toastId, duration: Infinity })

  try {
    const result = await ipc.workspaces.runSetup(workspaceId)

    if (result.success) {
      toast.success(name ? `Setup complete — ${name}` : 'Setup complete', { id: toastId, duration: 10_000 })
    } else {
      showFailure(toastId, workspaceId, result.output)
    }
  } catch (err) {
    showFailure(toastId, workspaceId, (err as Error).message)
  }
}

function showFailure(toastId: string, workspaceId: string, output: string): void {
  const name = getWorkspaceName(workspaceId)
  toast.error(name ? `Setup failed — ${name}` : 'Setup failed', {
    id: toastId,
    duration: 30_000,
    action: {
      label: 'View output',
      onClick: () => {
        useUIStore.getState().openModal('setup-script', { modal: 'setup-script', output })
      }
    },
    cancel: {
      label: 'Retry',
      onClick: () => runSetup(workspaceId, toastId)
    }
  })
}
