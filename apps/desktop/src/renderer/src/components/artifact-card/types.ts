import type { ArtifactKind } from '../../../../shared/ipc-types'

export type ArtifactCardProps = {
  workspaceId: string
  kind: ArtifactKind
  defaultExpanded?: boolean
  /** Controlled expanded state — when provided, overrides internal state */
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  focused?: boolean
  onToggleFocus?: () => void
}
