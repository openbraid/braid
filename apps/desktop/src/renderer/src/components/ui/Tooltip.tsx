import * as RadixTooltip from '@radix-ui/react-tooltip'

export const TooltipProvider = RadixTooltip.Provider
export const Tooltip = RadixTooltip.Root
export const TooltipTrigger = RadixTooltip.Trigger

export function TooltipContent({
  children,
  side = 'right',
  ...props
}: RadixTooltip.TooltipContentProps) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        side={side}
        sideOffset={6}
        className="z-50 rounded-md border border-border bg-surface-elevated px-2 py-1 text-[11px] text-fg shadow-md animate-in fade-in-0 zoom-in-95"
        {...props}
      >
        {children}
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  )
}
