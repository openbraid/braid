// ─── Workspace Lifecycle Status ──────────────────────────────────────────────
// Single source of truth for lifecycle status values in core-api.
// Mirrors WorkspaceLifecycleStatus in apps/desktop/src/shared/ipc-types.ts.

export const WorkspaceLifecycleStatus = {
  InProgress: 'in_progress',
  Blocked: 'blocked',
  OnHold: 'on_hold',
  Completed: 'completed',
} as const;

export type WorkspaceLifecycleStatus =
  (typeof WorkspaceLifecycleStatus)[keyof typeof WorkspaceLifecycleStatus];
