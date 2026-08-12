import { useState, useCallback, useEffect, useRef } from 'react'
import type { ArtifactKind } from '../../../../shared/ipc-types'
import { SERVER_POLL_INTERVAL_MS, SAVED_INDICATOR_DURATION_MS } from '../artifact-editor/editor-constants'
import { useArtifactStore } from '../../store/artifact-store'
import { parseArtifactYaml, reconstructYaml, buildStructuredBlocks } from '../../lib/artifact-parser'
import { track } from '../../lib/analytics'
import type { ParsedArtifact } from '../../lib/artifact-parser'
import { ipc } from '../../lib/ipc'
import { createYjsStateFromArtifact } from '../../lib/create-yjsstate'
import type { TabId } from './constants'

interface ArtifactCardOptions {
  defaultExpanded?: boolean
  /** Controlled expanded state — overrides internal state when provided */
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

export function useArtifactCardState(workspaceId: string, kind: ArtifactKind, options: ArtifactCardOptions = {}) {
  const { defaultExpanded = false, expanded: controlledExpanded, onExpandedChange } = options
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)

  // Controlled or uncontrolled
  const expanded = controlledExpanded ?? internalExpanded
  const setExpanded = useCallback((value: boolean) => {
    if (onExpandedChange) onExpandedChange(value)
    else setInternalExpanded(value)
  }, [onExpandedChange])
  const [activeTab, setActiveTab] = useState<TabId>('content')
  const [mode, setMode] = useState<'local' | 'shared'>('local')
  const [saving, setSaving] = useState(false)
  const [serverSaved, setServerSaved] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const serverSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Version tracking ────────────────────────────────────────────────────
  const [baseVersion, setBaseVersionRaw] = useState<number | null>(null)
  const baseVersionRef = useRef<number | null>(null)
  const [baseYamlContent, setBaseYamlContent] = useState<string | null>(null)
  const [serverConflict, setServerConflict] = useState(false)
  const [newerVersionAvailable, setNewerVersionAvailable] = useState(false)
  const [notSharedYet, setNotSharedYet] = useState(false)

  // ─── Artifact status (server-managed) ──────────────────────────────────
  const [artifactStatus, setArtifactStatus] = useState<string>('draft')
  const [statusChangedBy, setStatusChangedBy] = useState<string | null>(null)
  const [statusChangedByFirstName, setStatusChangedByFirstName] = useState<string | null>(null)
  const [statusChangedByLastName, setStatusChangedByLastName] = useState<string | null>(null)
  const [statusChangedAt, setStatusChangedAt] = useState<string | null>(null)

  /** Update base version + YAML content. Persists to sync-state.json. */
  const setBaseVersion = useCallback((version: number, yamlContent?: string) => {
    setBaseVersionRaw(version)
    baseVersionRef.current = version
    if (yamlContent !== undefined) setBaseYamlContent(yamlContent)
    ipc.artifacts.setSyncVersion(workspaceId, kind, version, yamlContent)
  }, [workspaceId, kind])

  // ─── Store access ────────────────────────────────────────────────────────
  const artifactKey = `${workspaceId}:${kind}`
  const artifact = useArtifactStore((s) => s.artifacts.get(artifactKey))
  const currentYaml = useArtifactStore((s) => s.yamlSources.get(artifactKey))
  const error = useArtifactStore((s) => s.errors.get(artifactKey))
  const isLoading = useArtifactStore((s) => s.loading.has(artifactKey))
  const setArtifact = useArtifactStore((s) => s.setArtifact)
  const setError = useArtifactStore((s) => s.setError)

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (serverSavedTimerRef.current) clearTimeout(serverSavedTimerRef.current)
    }
  }, [])

  // ─── Mount: read persisted base version, then load content ─────────────
  useEffect(() => {
    async function init() {
      useArtifactStore.getState().setLoading(workspaceId, kind, true)
      try {
        const persisted = await ipc.artifacts.getSyncVersion(workspaceId, kind)
        if (persisted !== null) {
          setBaseVersionRaw(persisted.version)
          baseVersionRef.current = persisted.version
          if (persisted.yamlContent) setBaseYamlContent(persisted.yamlContent)
        }

        if (mode === 'shared') {
          await loadFromServer()
        } else {
          await loadFromDisk()
        }
      } finally {
        useArtifactStore.getState().setLoading(workspaceId, kind, false)
      }
    }
    init()
  }, [workspaceId, kind, mode])

  // ─── Polling: detect newer server version ─────────────────────────────
  useEffect(() => {
    if (mode !== 'local') return

    const checkServerVersion = async () => {
      const base = baseVersionRef.current
      if (base === null) return
      try {
        const result = await ipc.artifacts.serverGet(workspaceId, kind)
        if (result.version > base) {
          setNewerVersionAvailable(true)
        }
      } catch {
        // Server unreachable — ignore
      }
    }

    // TODO: Replace with WebSocket push notifications when scaling.
    const interval = setInterval(checkServerVersion, SERVER_POLL_INTERVAL_MS)
    window.addEventListener('focus', checkServerVersion)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', checkServerVersion)
    }
  }, [workspaceId, kind, mode])

  // ─── Data loading ────────────────────────────────────────────────────────

  async function loadFromDisk() {
    try {
      const result = await ipc.artifacts.read(workspaceId, kind)
      if (!result) return

      const parsed = parseArtifactYaml(result.yamlContent)
      if ('valid' in parsed && parsed.valid === false) {
        setError(workspaceId, kind, parsed.errors.join('\n'))
        return
      }

      // Show errors and warnings in banner, but still load the artifact
      const messages = [
        ...parsed.errors,
        ...parsed.warnings.map((w) => `⚠ ${w}`),
      ]
      if (messages.length > 0) {
        setError(workspaceId, kind, messages.join('\n'))
      } else {
        useArtifactStore.getState().clearError(workspaceId, kind)
      }
      setArtifact(workspaceId, kind, parsed as ParsedArtifact, result.yamlContent)
    } catch (err) {
      const message = (err as { message?: string })?.message ?? String(err)
      setError(workspaceId, kind, message)
    }
  }

  async function loadFromServer() {
    try {
      const result = await ipc.artifacts.serverGet(workspaceId, kind)
      setServerConflict(false)
      setNotSharedYet(false)

      // Update artifact-level status from server
      if (result.status) setArtifactStatus(result.status)
      if (result.statusChangedBy !== undefined) setStatusChangedBy(result.statusChangedBy)
      if (result.statusChangedByFirstName !== undefined) setStatusChangedByFirstName(result.statusChangedByFirstName)
      if (result.statusChangedByLastName !== undefined) setStatusChangedByLastName(result.statusChangedByLastName)
      if (result.statusChangedAt !== undefined) setStatusChangedAt(result.statusChangedAt)

      const parsed = parseArtifactYaml(result.yamlContent)
      if ('valid' in parsed && parsed.valid === false) {
        setError(workspaceId, kind, parsed.errors.join('\n'))
        return
      }

      const messages = [
        ...parsed.errors,
        ...parsed.warnings.map((w) => `⚠ ${w}`),
      ]
      if (messages.length > 0) {
        setError(workspaceId, kind, messages.join('\n'))
      } else {
        useArtifactStore.getState().clearError(workspaceId, kind)
      }
      setArtifact(workspaceId, kind, parsed as ParsedArtifact, result.yamlContent)
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'ARTIFACT_NOT_FOUND') {
        setNotSharedYet(true)
        return
      }
      const message = (err as { message?: string })?.message ?? String(err)
      setError(workspaceId, kind, message)
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  async function pullLatest() {
    try {
      const result = await ipc.artifacts.serverSync(workspaceId, kind)
      setBaseVersion(result.version, result.yamlContent)
      setNewerVersionAvailable(false)
      setServerConflict(false)
      await loadFromDisk()
    } catch {
      await loadFromDisk()
    }
  }

  async function writeYaml(yamlContent: string) {
    const result = await ipc.artifacts.write(workspaceId, kind, yamlContent)
    if (result.success) {
      track('artifact_edited', { kind })
      await loadFromDisk()
    } else {
      console.error(`[artifact-card] Write failed for ${kind}:`, result.error)
    }
    return result
  }

  async function saveToServer(forceOverwrite = false) {
    if (!artifact) return
    setSaving(true)
    setServerSaved(false)

    try {
      const yamlContent = reconstructYaml(
        artifact.meta,
        artifact.contextBlocks.join('\n\n'),
        buildStructuredBlocks(artifact)
      )

      const yjsState = createYjsStateFromArtifact(artifact)

      const result = await ipc.artifacts.serverSave(workspaceId, kind, yamlContent, {
        title: artifact.meta.title,
        expectedVersion: forceOverwrite ? undefined : (baseVersion ?? undefined),
        yjsState,
      })

      setBaseVersion(result.version, result.yamlContent)
      setNewerVersionAvailable(false)
      setServerConflict(false)
      showServerSavedIndicator()
      await pullLatest()
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'ARTIFACT_VERSION_CONFLICT') {
        setServerConflict(true)
      } else {
        const message = (err as { message?: string })?.message ?? String(err)
        console.error(`[artifact-card] Server save failed for ${kind}:`, message)
        setError(workspaceId, kind, `Save failed: ${message}`)
      }
    } finally {
      setSaving(false)
    }
  }

  function showServerSavedIndicator() {
    setServerSaved(true)
    if (serverSavedTimerRef.current) clearTimeout(serverSavedTimerRef.current)
    serverSavedTimerRef.current = setTimeout(() => setServerSaved(false), SAVED_INDICATOR_DURATION_MS)
  }

  // ─── Content change handlers ─────────────────────────────────────────────

  const handleContentChange = useCallback(
    async (markdown: string) => {
      if (!artifact || mode !== 'local') return
      const yaml = reconstructYaml(artifact.meta, markdown, buildStructuredBlocks(artifact))
      await writeYaml(yaml)
    },
    [artifact, workspaceId, kind, mode]
  )

  /** Generic array change handler for StructuredTable in Local mode */
  const handleArrayChange = useCallback(
    async (arrayName: string, items: Record<string, unknown>[]) => {
      if (!artifact || mode !== 'local') return
      const yaml = reconstructYaml(
        artifact.meta,
        artifact.contextBlocks.join('\n\n'),
        buildStructuredBlocks(artifact, { [arrayName]: items }),
      )
      await writeYaml(yaml)
    },
    [artifact, workspaceId, kind, mode]
  )

  async function updateStatus(newStatus: string) {
    const prevStatus = artifactStatus
    // Optimistic update
    setArtifactStatus(newStatus)
    try {
      await ipc.artifacts.serverUpdateStatus(workspaceId, kind, newStatus)
      // Reload to get statusChangedBy/At from server
      loadFromServer()
    } catch {
      // Revert on failure
      setArtifactStatus(prevStatus)
    }
  }

  async function saveTitle(newTitle: string) {
    if (!artifact) return
    setEditingTitle(false)
    if (newTitle === artifact.meta.title) return
    const updatedMeta = { ...artifact.meta, title: newTitle }
    const yaml = reconstructYaml(updatedMeta, artifact.contextBlocks.join('\n\n'), buildStructuredBlocks(artifact))
    await writeYaml(yaml)
  }

  function startEditingTitle() {
    setTitleDraft(artifact?.meta.title ?? '')
    setEditingTitle(true)
    requestAnimationFrame(() => titleInputRef.current?.focus())
  }

  return {
    // State
    expanded, setExpanded,
    activeTab, setActiveTab,
    mode, setMode,
    saving,
    serverSaved,
    editingTitle, setEditingTitle,
    titleDraft, setTitleDraft,
    titleInputRef,
    baseVersion,
    serverConflict, setServerConflict,
    newerVersionAvailable, setNewerVersionAvailable,
    notSharedYet,
    // hasLocalChanges: true when local YAML differs from the base (server) YAML.
    // null baseYamlContent = never synced → treat as "has changes" if content exists.
    hasLocalChanges: baseYamlContent === null
      ? (!!artifact && !!currentYaml)
      : (currentYaml !== baseYamlContent),
    artifact,
    error,
    isLoading,
    artifactStatus,
    statusChangedBy,
    statusChangedByFirstName,
    statusChangedByLastName,
    statusChangedAt,

    // Actions
    pullLatest,
    saveToServer,
    handleContentChange,
    handleArrayChange,
    updateStatus,
    saveTitle,
    startEditingTitle,
    reload: mode === 'shared' ? loadFromServer : loadFromDisk,
  }
}
