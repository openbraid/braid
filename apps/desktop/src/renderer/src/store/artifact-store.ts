import { create } from 'zustand'
import type { ArtifactKind } from '../../../shared/ipc-types'
import type { ParsedArtifact } from '../lib/artifact-parser'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ArtifactMode = 'local' | 'shared'

/** Composite key for per-artifact state: `{workspaceId}:{kind}` */
function key(workspaceId: string, kind: ArtifactKind): string {
  return `${workspaceId}:${kind}`
}

// ─── Store ───────────────────────────────────────────────────────────────────

type ArtifactStore = {
  /** Parsed artifact data keyed by workspaceId:kind */
  artifacts: Map<string, ParsedArtifact>

  /** YAML source strings keyed by workspaceId:kind (for write-back) */
  yamlSources: Map<string, string>

  /** Local or Shared mode per artifact */
  modes: Map<string, ArtifactMode>

  /** Parse or load errors per artifact */
  errors: Map<string, string>

  /** Set of artifact keys currently loading */
  loading: Set<string>

  /** List of artifact kinds available per workspace */
  workspaceKinds: Map<string, ArtifactKind[]>

  /** Duplicate kinds detected per workspace */
  duplicateKinds: Map<string, ArtifactKind[]>

  /** File-level errors (invalid YAML, missing meta, etc.) keyed by workspaceId */
  fileErrors: Map<string, Array<{ fileName: string; error: string }>>

  // ─── Actions ─────────────────────────────────────────────────────────────

  setArtifact: (workspaceId: string, kind: ArtifactKind, artifact: ParsedArtifact, yamlSource: string) => void
  removeArtifact: (workspaceId: string, kind: ArtifactKind) => void
  setMode: (workspaceId: string, kind: ArtifactKind, mode: ArtifactMode) => void
  setError: (workspaceId: string, kind: ArtifactKind, error: string) => void
  clearError: (workspaceId: string, kind: ArtifactKind) => void
  setLoading: (workspaceId: string, kind: ArtifactKind, isLoading: boolean) => void
  setWorkspaceKinds: (workspaceId: string, kinds: ArtifactKind[], duplicates: ArtifactKind[]) => void
  setFileErrors: (workspaceId: string, errors: Array<{ fileName: string; error: string }>) => void
  clearWorkspace: (workspaceId: string) => void
  reset: () => void
}

export const useArtifactStore = create<ArtifactStore>((set) => ({
  artifacts: new Map(),
  yamlSources: new Map(),
  modes: new Map(),
  errors: new Map(),
  loading: new Set(),
  workspaceKinds: new Map(),
  duplicateKinds: new Map(),
  fileErrors: new Map(),

  setArtifact: (workspaceId, kind, artifact, yamlSource) =>
    set((state) => {
      const k = key(workspaceId, kind)
      const artifacts = new Map(state.artifacts)
      const yamlSources = new Map(state.yamlSources)
      const errors = new Map(state.errors)
      artifacts.set(k, artifact)
      yamlSources.set(k, yamlSource)
      errors.delete(k) // clear any previous error
      return { artifacts, yamlSources, errors }
    }),

  removeArtifact: (workspaceId, kind) =>
    set((state) => {
      const k = key(workspaceId, kind)
      const artifacts = new Map(state.artifacts)
      const yamlSources = new Map(state.yamlSources)
      artifacts.delete(k)
      yamlSources.delete(k)
      return { artifacts, yamlSources }
    }),

  setMode: (workspaceId, kind, mode) =>
    set((state) => {
      const modes = new Map(state.modes)
      modes.set(key(workspaceId, kind), mode)
      return { modes }
    }),

  setError: (workspaceId, kind, error) =>
    set((state) => {
      const errors = new Map(state.errors)
      errors.set(key(workspaceId, kind), error)
      return { errors }
    }),

  clearError: (workspaceId, kind) =>
    set((state) => {
      const errors = new Map(state.errors)
      errors.delete(key(workspaceId, kind))
      return { errors }
    }),

  setLoading: (workspaceId, kind, isLoading) =>
    set((state) => {
      const loading = new Set(state.loading)
      const k = key(workspaceId, kind)
      if (isLoading) loading.add(k)
      else loading.delete(k)
      return { loading }
    }),

  setWorkspaceKinds: (workspaceId, kinds, duplicates) =>
    set((state) => {
      const workspaceKinds = new Map(state.workspaceKinds)
      const duplicateKinds = new Map(state.duplicateKinds)
      workspaceKinds.set(workspaceId, kinds)
      duplicateKinds.set(workspaceId, duplicates)
      return { workspaceKinds, duplicateKinds }
    }),

  setFileErrors: (workspaceId, errors) =>
    set((state) => {
      const fileErrors = new Map(state.fileErrors)
      if (errors.length === 0) fileErrors.delete(workspaceId)
      else fileErrors.set(workspaceId, errors)
      return { fileErrors }
    }),

  clearWorkspace: (workspaceId) =>
    set((state) => {
      const artifacts = new Map(state.artifacts)
      const yamlSources = new Map(state.yamlSources)
      const modes = new Map(state.modes)
      const errors = new Map(state.errors)
      const loading = new Set(state.loading)
      const workspaceKinds = new Map(state.workspaceKinds)
      const duplicateKinds = new Map(state.duplicateKinds)

      // Remove all entries for this workspace
      const prefix = `${workspaceId}:`
      for (const k of artifacts.keys()) { if (k.startsWith(prefix)) artifacts.delete(k) }
      for (const k of yamlSources.keys()) { if (k.startsWith(prefix)) yamlSources.delete(k) }
      for (const k of modes.keys()) { if (k.startsWith(prefix)) modes.delete(k) }
      for (const k of errors.keys()) { if (k.startsWith(prefix)) errors.delete(k) }
      for (const k of loading) { if (k.startsWith(prefix)) loading.delete(k) }
      workspaceKinds.delete(workspaceId)
      duplicateKinds.delete(workspaceId)
      const fileErrors = new Map(state.fileErrors)
      fileErrors.delete(workspaceId)

      return { artifacts, yamlSources, modes, errors, loading, workspaceKinds, duplicateKinds, fileErrors }
    }),

  reset: () =>
    set({
      artifacts: new Map(),
      yamlSources: new Map(),
      modes: new Map(),
      errors: new Map(),
      loading: new Set(),
      workspaceKinds: new Map(),
      duplicateKinds: new Map(),
      fileErrors: new Map()
    })
}))

// ─── Selectors ───────────────────────────────────────────────────────────────

export function selectArtifact(workspaceId: string, kind: ArtifactKind): ParsedArtifact | undefined {
  return useArtifactStore.getState().artifacts.get(key(workspaceId, kind))
}

export function selectArtifactMode(workspaceId: string, kind: ArtifactKind): ArtifactMode {
  return useArtifactStore.getState().modes.get(key(workspaceId, kind)) ?? 'local'
}

export function selectArtifactError(workspaceId: string, kind: ArtifactKind): string | undefined {
  return useArtifactStore.getState().errors.get(key(workspaceId, kind))
}

export function selectArtifactLoading(workspaceId: string, kind: ArtifactKind): boolean {
  return useArtifactStore.getState().loading.has(key(workspaceId, kind))
}
