import { cloneElement, type ReactElement } from 'react'
import type { Capability } from '../../../../shared/ipc-types'
import { useCapability } from '../../store/capability-store'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'

type Props = {
  capability: Capability
  /**
   * The control to gate. Receives `disabled` when the capability is off, so it
   * must accept that prop — buttons and menu items do.
   */
  children: ReactElement<{ disabled?: boolean }>
  /** Render nothing at all instead of a disabled control. */
  hideWhenUnavailable?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
}

/**
 * Wraps a control that needs a server-backed capability. When unavailable the
 * control is disabled and explains why on hover.
 *
 * Every gated surface in the app goes through this component — that way the
 * disabled styling and the wording of the explanation live in one place, and
 * enabling a feature later never means hunting for tooltip copy.
 *
 *   <RequiresCapability capability={Capability.Invites}>
 *     <button onClick={invite}>Invite teammate</button>
 *   </RequiresCapability>
 */
export function RequiresCapability({
  capability,
  children,
  hideWhenUnavailable = false,
  side = 'bottom'
}: Props): ReactElement | null {
  const { enabled, reason } = useCapability(capability)

  if (enabled) return children
  if (hideWhenUnavailable) return null

  // The wrapping span is required: Radix needs a hoverable element, and a
  // disabled button emits no pointer events of its own.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-not-allowed opacity-50">
          {cloneElement(children, { disabled: true })}
        </span>
      </TooltipTrigger>
      <TooltipContent side={side}>{reason}</TooltipContent>
    </Tooltip>
  )
}
