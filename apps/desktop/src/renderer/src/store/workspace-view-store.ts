// ─── Workspace View Store ─────────────────────────────────────────────────────
// Per-workspace UI state that persists across tab switches, component
// mounts/unmounts, and app restarts (via zustand persist to localStorage).
//
// Pattern: Map<workspaceId, WorkspaceViewState>
// Extensible: add new per-tab state as fields in WorkspaceViewState.

import { create } from 'zustand'
import { persist, type StorageValue } from 'zustand/middleware'

// ─── Types ───────────────────────────────────────────────────────────────────

export type WorkspaceTab = 'code' | 'artifacts' | 'context' | 'memory' | 'sessions'

/** Initial pipeline stages for new workspaces. Only the common ones. */
export const INITIAL_PIPELINE_STAGES: string[] = ['REQUIREMENTS', 'DESIGN', 'SPEC']

export interface ArtifactsViewState {
  expandedCards: Set<string>
  pipelineCompact: boolean
  scrollTop: number
  activeStageKind: string | null
  /** User-configured pipeline stages (ordered). Source of truth for the strip. */
  pipelineStages: string[]
  /** When set, only this artifact card is shown, filling the full content area. */
  focusedCard: string | null
}

export interface WorkspaceViewState {
  activeTab: WorkspaceTab
  artifacts: ArtifactsViewState
}

function createDefaultViewState(): WorkspaceViewState {
  return {
    activeTab: 'code',
    artifacts: {
      expandedCards: new Set(),
      pipelineCompact: false,
      scrollTop: 0,
      activeStageKind: null,
      pipelineStages: [...INITIAL_PIPELINE_STAGES],
      focusedCard: null,
    },
  }
}

// ─── Serialization (Set ↔ Array, Map ↔ entries for JSON) ─────────────────────

interface SerializedArtifactsViewState {
  expandedCards: string[]
  pipelineCompact: boolean
  scrollTop: number
  activeStageKind: string | null
  pipelineStages: string[]
  focusedCard?: string | null
}

interface SerializedWorkspaceViewState {
  activeTab: WorkspaceTab
  artifacts: SerializedArtifactsViewState
}

interface SerializedStore {
  views: Array<[string, SerializedWorkspaceViewState]>
}

function serialize(views: Map<string, WorkspaceViewState>): SerializedStore {
  const entries: Array<[string, SerializedWorkspaceViewState]> = []
  for (const [id, view] of views) {
    entries.push([id, {
      activeTab: view.activeTab,
      artifacts: {
        expandedCards: [...view.artifacts.expandedCards],
        pipelineCompact: view.artifacts.pipelineCompact,
        scrollTop: view.artifacts.scrollTop,
        activeStageKind: view.artifacts.activeStageKind,
        pipelineStages: view.artifacts.pipelineStages,
        focusedCard: view.artifacts.focusedCard,
      },
    }])
  }
  return { views: entries }
}

function deserialize(data: SerializedStore): Map<string, WorkspaceViewState> {
  const map = new Map<string, WorkspaceViewState>()
  if (!data?.views) return map
  for (const [id, sv] of data.views) {
    map.set(id, {
      activeTab: sv.activeTab ?? 'code',
      artifacts: {
        expandedCards: new Set(sv.artifacts?.expandedCards ?? []),
        pipelineCompact: sv.artifacts?.pipelineCompact ?? false,
        scrollTop: sv.artifacts?.scrollTop ?? 0,
        activeStageKind: sv.artifacts?.activeStageKind ?? null,
        pipelineStages: sv.artifacts?.pipelineStages ?? [...INITIAL_PIPELINE_STAGES],
        focusedCard: sv.artifacts?.focusedCard ?? null,
      },
    })
  }
  return map
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface WorkspaceViewStore {
  views: Map<string, WorkspaceViewState>

  setActiveTab: (workspaceId: string, tab: WorkspaceTab) => void

  expandCard: (workspaceId: string, kind: string) => void
  collapseCard: (workspaceId: string, kind: string) => void
  toggleCard: (workspaceId: string, kind: string) => void
  setPipelineCompact: (workspaceId: string, compact: boolean) => void
  setScrollTop: (workspaceId: string, scrollTop: number) => void
  setActiveStageKind: (workspaceId: string, kind: string | null) => void
  setPipelineStages: (workspaceId: string, stages: string[]) => void
  setFocusedCard: (workspaceId: string, kind: string | null) => void

  clearWorkspace: (workspaceId: string) => void
  reset: () => void
}

function getOrCreate(views: Map<string, WorkspaceViewState>, workspaceId: string): WorkspaceViewState {
  return views.get(workspaceId) ?? createDefaultViewState()
}

function updateView(
  state: { views: Map<string, WorkspaceViewState> },
  workspaceId: string,
  updater: (view: WorkspaceViewState) => WorkspaceViewState,
): { views: Map<string, WorkspaceViewState> } {
  const views = new Map(state.views)
  views.set(workspaceId, updater(getOrCreate(views, workspaceId)))
  return { views }
}

export const useWorkspaceViewStore = create<WorkspaceViewStore>()(
  persist(
    (set) => ({
      views: new Map(),

      setActiveTab: (workspaceId, tab) =>
        set((state) => updateView(state, workspaceId, (v) => ({ ...v, activeTab: tab }))),

      expandCard: (workspaceId, kind) =>
        set((state) => updateView(state, workspaceId, (v) => {
          const expandedCards = new Set(v.artifacts.expandedCards)
          expandedCards.add(kind)
          return { ...v, artifacts: { ...v.artifacts, expandedCards } }
        })),

      collapseCard: (workspaceId, kind) =>
        set((state) => updateView(state, workspaceId, (v) => {
          const expandedCards = new Set(v.artifacts.expandedCards)
          expandedCards.delete(kind)
          return { ...v, artifacts: { ...v.artifacts, expandedCards } }
        })),

      toggleCard: (workspaceId, kind) =>
        set((state) => updateView(state, workspaceId, (v) => {
          const expandedCards = new Set(v.artifacts.expandedCards)
          if (expandedCards.has(kind)) expandedCards.delete(kind)
          else expandedCards.add(kind)
          return { ...v, artifacts: { ...v.artifacts, expandedCards } }
        })),

      setPipelineCompact: (workspaceId, compact) =>
        set((state) => updateView(state, workspaceId, (v) => ({
          ...v, artifacts: { ...v.artifacts, pipelineCompact: compact },
        }))),

      setScrollTop: (workspaceId, scrollTop) =>
        set((state) => updateView(state, workspaceId, (v) => ({
          ...v, artifacts: { ...v.artifacts, scrollTop },
        }))),

      setActiveStageKind: (workspaceId, kind) =>
        set((state) => updateView(state, workspaceId, (v) => ({
          ...v, artifacts: { ...v.artifacts, activeStageKind: kind },
        }))),

      setPipelineStages: (workspaceId, stages) =>
        set((state) => updateView(state, workspaceId, (v) => ({
          ...v, artifacts: { ...v.artifacts, pipelineStages: stages },
        }))),

      setFocusedCard: (workspaceId, kind) =>
        set((state) => updateView(state, workspaceId, (v) => ({
          ...v, artifacts: { ...v.artifacts, focusedCard: kind },
        }))),

      clearWorkspace: (workspaceId) =>
        set((state) => {
          const views = new Map(state.views)
          views.delete(workspaceId)
          return { views }
        }),

      reset: () => set({ views: new Map() }),
    }),
    {
      name: 'braid-workspace-views',
      storage: {
        getItem: (name): StorageValue<WorkspaceViewStore> | null => {
          const raw = localStorage.getItem(name)
          if (!raw) return null
          try {
            const parsed = JSON.parse(raw)
            return {
              state: { ...parsed.state, views: deserialize(parsed.state) },
              version: parsed.version,
            }
          } catch {
            return null
          }
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify({
            state: serialize(value.state.views),
            version: value.version,
          }))
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    },
  ),
)
