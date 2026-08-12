import { useEffect, useState } from 'react'
import { HardDrive, Cloud } from 'lucide-react'
import { ipc } from '../../lib/ipc'
import type { AppModeInfo } from '../../../../shared/ipc-types'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'

/**
 * Shows where the app is currently reading and writing data.
 *
 * Small on purpose — an icon in the bottom bar, detail on hover. It exists
 * because "my projects disappeared" is the obvious reaction to switching modes,
 * and without a visible marker there is nothing in the UI that answers it.
 */
export function ModeIndicator({ collapsed }: { collapsed: boolean }): React.JSX.Element | null {
  const [info, setInfo] = useState<AppModeInfo | null>(null)

  useEffect(() => {
    ipc.appMode.get().then(setInfo)
  }, [])

  if (!info) return null

  const isLocal = info.mode === 'local'
  const Icon = isLocal ? HardDrive : Cloud

  // Hostname alone — the full URL with scheme and port is too long for a
  // sidebar this narrow, and the tooltip carries the exact value anyway.
  let host = ''
  if (info.serverUrl) {
    try {
      host = new URL(info.serverUrl).host
    } catch {
      host = info.serverUrl
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1.5 h-7 px-1.5 rounded text-fg-tertiary cursor-default select-none">
          <Icon size={13} className="shrink-0" />
          {!collapsed && <span className="text-[11px] truncate">{isLocal ? 'Local' : host}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">
        {isLocal ? (
          <>
            Local — everything is stored on this machine.
            <br />
            No account, no server.
          </>
        ) : (
          <>
            Team — projects and workspaces come from
            <br />
            {info.serverUrl}
          </>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
