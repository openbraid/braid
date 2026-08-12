import type { ReactNode } from 'react'
import type { WorkspaceTab } from '../../store/workspace-view-store'

type Props = {
  tab: WorkspaceTab
  icon: ReactNode
  label: string
  isActive: boolean
  onClick: () => void
}

export function WorkspaceTabPill({ icon, label, isActive, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 px-2 py-1 rounded-md border transition-all duration-150',
        'cursor-pointer whitespace-nowrap overflow-hidden text-[12px]',
        isActive
          ? 'border-brand text-fg'
          : 'border-border-subtle text-fg-tertiary hover:bg-surface-hover hover:text-fg-secondary'
      ].join(' ')}
    >
      <span className="shrink-0">{icon}</span>
      <span
        className={[
          'transition-all duration-150 overflow-hidden',
          isActive ? 'max-w-[80px] opacity-100' : 'max-w-0 opacity-0'
        ].join(' ')}
      >
        {label}
      </span>
    </button>
  )
}
