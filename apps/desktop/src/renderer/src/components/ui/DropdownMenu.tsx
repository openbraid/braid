import * as Radix from '@radix-ui/react-dropdown-menu'

export const DropdownMenu = Radix.Root
export const DropdownMenuTrigger = Radix.Trigger

export function DropdownMenuContent({
  children,
  ...props
}: Radix.DropdownMenuContentProps) {
  return (
    <Radix.Portal>
      <Radix.Content
        sideOffset={4}
        align="end"
        className="z-50 min-w-[172px] rounded-lg border border-border bg-surface-elevated shadow-lg py-1 animate-in fade-in-0 zoom-in-95 origin-top-right"
        {...props}
      >
        {children}
      </Radix.Content>
    </Radix.Portal>
  )
}

export function DropdownMenuItem({
  children,
  destructive,
  ...props
}: Radix.DropdownMenuItemProps & { destructive?: boolean }) {
  return (
    <Radix.Item
      className={[
        'flex items-center gap-2.5 px-3 py-1.5 text-[12px] outline-none cursor-pointer transition-colors select-none',
        'data-[highlighted]:bg-surface-hover',
        destructive
          ? 'text-error data-[highlighted]:text-error'
          : 'text-fg-secondary data-[highlighted]:text-fg'
      ].join(' ')}
      {...props}
    >
      {children}
    </Radix.Item>
  )
}

export function DropdownMenuSeparator() {
  return <Radix.Separator className="h-px my-1 bg-border" />
}
