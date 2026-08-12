// ─── ArtifactsTab ─────────────────────────────────────────────────────────────
// Main artifacts view. Shows a pipeline strip at top with stage pills,
// followed by a scrollable view of artifact cards grouped by stage.
// Pipeline strip shrinks to compact mode on scroll.

import { useEffect, useState, useRef, useCallback } from 'react'
import { Layers, AlertTriangle, X } from 'lucide-react'

import { Channels, type ArtifactKind } from '../../../../shared/ipc-types'
import { useWorkspaceStore } from '../../store/workspace-store'
import { useArtifactStore } from '../../store/artifact-store'
import { useWorkspaceViewStore } from '../../store/workspace-view-store'
import { ipc } from '../../lib/ipc'
import { parseArtifactYaml } from '../../lib/artifact-parser'
import type { ParsedArtifact } from '../../lib/artifact-parser'
import { KNOWN_KIND_ORDER as _KNOWN_KIND_ORDER } from '../artifact-card/constants'

// Widen to string[] so indexOf/Set.has work with pipeline stage kinds (which can be custom strings)
const KNOWN_KIND_ORDER: string[] = _KNOWN_KIND_ORDER
import { INITIAL_PIPELINE_STAGES } from '../../store/workspace-view-store'
import { ArtifactCard } from '../artifact-card/ArtifactCard'
import { ArtifactErrorBoundary } from '../artifact-card/ArtifactErrorBoundary'
import { PipelineStrip, type PipelineStage } from './PipelineStrip'
import { StageSection } from './StageSection'
import { ConfigurePipelineModal } from './ConfigurePipelineModal'

interface ArtifactsTabProps {
  /** When provided, use this workspace. Otherwise fall back to active workspace. */
  workspaceId?: string
}

export function ArtifactsTab({ workspaceId: propWorkspaceId }: ArtifactsTabProps = {}) {
  const [configureOpen, setConfigureOpen] = useState(false)
  const [showArtifactIntro, setShowArtifactIntro] = useState(false)

  // Load dismiss state once on mount
  useEffect(() => {
    ipc.app.getState().then((state) => {
      if (!state.dismissedArtifactIntro) setShowArtifactIntro(true)
    })
  }, [])

  const storeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const activeWorkspaceId = propWorkspaceId ?? storeWorkspaceId

  // ─── Per-workspace view state from store (persists across tab switches) ─
  // Read individual fields via stable selectors to avoid re-render loops.
  // Use getState() for imperative writes (event handlers, callbacks).
  const expandedCards = useWorkspaceViewStore((s) =>
    activeWorkspaceId ? (s.views.get(activeWorkspaceId)?.artifacts.expandedCards ?? null) : null
  ) ?? new Set<string>()
  const pipelineCompact = useWorkspaceViewStore((s) =>
    activeWorkspaceId ? (s.views.get(activeWorkspaceId)?.artifacts.pipelineCompact ?? false) : false
  )
  const activeStageKind = useWorkspaceViewStore((s) =>
    activeWorkspaceId ? (s.views.get(activeWorkspaceId)?.artifacts.activeStageKind ?? null) : null
  )
  const savedScrollTop = useWorkspaceViewStore((s) =>
    activeWorkspaceId ? (s.views.get(activeWorkspaceId)?.artifacts.scrollTop ?? 0) : 0
  )
  const storedPipelineStages = useWorkspaceViewStore((s) =>
    activeWorkspaceId ? (s.views.get(activeWorkspaceId)?.artifacts.pipelineStages ?? null) : null
  )
  const focusedCard = useWorkspaceViewStore((s) =>
    activeWorkspaceId ? (s.views.get(activeWorkspaceId)?.artifacts.focusedCard ?? null) : null
  )
  const workspaceKinds = useArtifactStore((s) =>
    activeWorkspaceId ? s.workspaceKinds.get(activeWorkspaceId) : undefined
  )
  const duplicateKinds = useArtifactStore((s) =>
    activeWorkspaceId ? s.duplicateKinds.get(activeWorkspaceId) : undefined
  )
  const fileErrors = useArtifactStore((s) =>
    activeWorkspaceId ? s.fileErrors.get(activeWorkspaceId) : undefined
  )

  const setWorkspaceKinds = useArtifactStore((s) => s.setWorkspaceKinds)
  const setFileErrors = useArtifactStore((s) => s.setFileErrors)
  const setArtifact = useArtifactStore((s) => s.setArtifact)
  const setError = useArtifactStore((s) => s.setError)

  // Refs for scroll spy
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const stageRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // ─── Data loading ────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeWorkspaceId) return
    loadArtifacts(activeWorkspaceId)
  }, [activeWorkspaceId])

  useEffect(() => {
    const unsub = ipc.on(Channels.ARTIFACT_FILE_CHANGED, async ({ workspaceId, kind }) => {
      if (workspaceId !== activeWorkspaceId) return
      loadArtifacts(workspaceId)
      if (!kind) return
      try {
        const result = await ipc.artifacts.read(workspaceId, kind)
        if (!result) return
        const parsed = parseArtifactYaml(result.yamlContent)
        if ('valid' in parsed && parsed.valid === false) {
          setError(workspaceId, kind, parsed.errors.join('; '))
          return
        }
        useArtifactStore.getState().clearError(workspaceId, kind)
        setArtifact(workspaceId, kind, parsed as ParsedArtifact, result.yamlContent)
      } catch (err) {
        console.error(`[artifacts-tab] Failed to reload ${kind}:`, err)
      }
    })
    return () => unsub()
  }, [activeWorkspaceId, setArtifact, setError])

  async function loadArtifacts(workspaceId: string) {
    try {
      await ipc.artifacts.initFolder(workspaceId)
      const result = await ipc.artifacts.list(workspaceId)
      const diskKinds = result.artifacts.map((a) => a.kind)
      const diskKindSet = new Set(diskKinds)

      // Kinds that were in the store but no longer on disk — check server before dropping
      const existingKinds = useArtifactStore.getState().workspaceKinds.get(workspaceId) ?? []
      const removedFromDisk = existingKinds.filter((k) => !diskKindSet.has(k))

      let serverKinds: string[] = []
      if (removedFromDisk.length > 0) {
        try {
          const serverList = await ipc.artifacts.serverList(workspaceId)
          const serverKindSet = new Set(serverList.map((a) => a.kind))
          serverKinds = removedFromDisk.filter((k) => serverKindSet.has(k))
        } catch {
          // Server unreachable — keep removed kinds to avoid accidental data loss
          serverKinds = removedFromDisk
        }
      }

      const finalKinds = [...new Set([...diskKinds, ...serverKinds])] as ArtifactKind[]
      setWorkspaceKinds(workspaceId, finalKinds, result.duplicateKinds)
      setFileErrors(workspaceId, result.errors)
    } catch (err) {
      console.error('[artifacts-tab] Failed to load artifacts:', err)
    }
  }

  // ─── Pipeline stages computation ─────────────────────────────────────
  // Source of truth: stored pipelineStages per workspace.
  // Known kinds not in the config get inserted at their natural SDLC position.
  // Unknown/custom kinds get appended at the end.

  const kindsWithContent = new Set<string>(workspaceKinds ?? [])
  const knownKindSet = new Set<string>(KNOWN_KIND_ORDER)

  const pipelineStages: PipelineStage[] = (() => {
    const configuredStages = storedPipelineStages ?? INITIAL_PIPELINE_STAGES
    const seen = new Set<string>()
    const stages: PipelineStage[] = []

    // Start with configured stages in their saved order
    for (const kind of configuredStages) {
      if (seen.has(kind)) continue
      seen.add(kind)
      stages.push({ kind, hasContent: kindsWithContent.has(kind) })
    }

    // Insert known kinds that have artifacts but aren't configured —
    // place them at their natural SDLC position relative to existing stages
    const unconfiguredKnown: string[] = []
    if (workspaceKinds) {
      for (const kind of workspaceKinds) {
        if (seen.has(kind)) continue
        if (knownKindSet.has(kind)) {
          unconfiguredKnown.push(kind)
        }
      }
    }

    for (const kind of unconfiguredKnown) {
      const naturalIndex = KNOWN_KIND_ORDER.indexOf(kind)
      // Find the best insertion point: after the last configured stage
      // whose natural index is less than this kind's
      let insertAt = 0
      for (let i = 0; i < stages.length; i++) {
        const stageNatural = KNOWN_KIND_ORDER.indexOf(stages[i].kind)
        if (stageNatural !== -1 && stageNatural < naturalIndex) {
          insertAt = i + 1
        }
      }
      stages.splice(insertAt, 0, { kind, hasContent: true })
      seen.add(kind)
    }

    // Append unknown/custom kinds at the end
    if (workspaceKinds) {
      for (const kind of workspaceKinds) {
        if (seen.has(kind)) continue
        seen.add(kind)
        stages.push({ kind, hasContent: true })
      }
    }

    return stages
  })()

  // ─── Scroll spy ──────────────────────────────────────────────────────

  // Use getState() for imperative writes — avoids re-render dependency
  const writeView = useCallback(() => useWorkspaceViewStore.getState(), [])

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container || !activeWorkspaceId) return

    const store = writeView()

    if (!userExpandedRef.current) {
      store.setPipelineCompact(activeWorkspaceId, container.scrollTop > 40)
    }

    store.setScrollTop(activeWorkspaceId, container.scrollTop)

    // Scroll spy: find which stage section is most visible
    let closestKind: string | null = null
    let closestDistance = Infinity

    for (const [kind, el] of stageRefs.current.entries()) {
      const rect = el.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const distance = Math.abs(rect.top - containerRect.top)
      if (distance < closestDistance) {
        closestDistance = distance
        closestKind = kind
      }
    }

    store.setActiveStageKind(activeWorkspaceId, closestKind)
  }, [activeWorkspaceId, writeView])

  const userExpandedRef = useRef(false)

  function handlePipelineExpand() {
    if (!activeWorkspaceId) return
    userExpandedRef.current = true
    useWorkspaceViewStore.getState().setPipelineCompact(activeWorkspaceId, false)
    setTimeout(() => { userExpandedRef.current = false }, 2000)
  }

  // Attach scroll listener
  // Re-run when focusedCard changes because the scroll container unmounts/remounts
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [handleScroll, focusedCard])

  // Restore scroll position only on initial mount or workspace switch
  const hasRestoredRef = useRef<string | null>(null)
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !activeWorkspaceId) return
    if (hasRestoredRef.current === activeWorkspaceId) return // already restored for this workspace
    hasRestoredRef.current = activeWorkspaceId
    if (savedScrollTop > 0) {
      container.scrollTop = savedScrollTop
    }
  }, [activeWorkspaceId, savedScrollTop])

  // ─── Stage click → smooth scroll + expand card ──────────────────────

  function scrollToStage(kind: string) {
    if (!activeWorkspaceId) return
    // Expand first, then scroll after React renders the expanded card
    useWorkspaceViewStore.getState().expandCard(activeWorkspaceId, kind)
    // Double rAF: first for React commit, second for browser layout
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = stageRefs.current.get(kind)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      })
    })
  }

  function setSectionRef(kind: string) {
    return (el: HTMLDivElement | null) => {
      if (el) stageRefs.current.set(kind, el)
      else stageRefs.current.delete(kind)
    }
  }

  // ─── Configure pipeline ──────────────────────────────────────────────

  function handlePipelineSave(stages: string[]) {
    if (!activeWorkspaceId) return
    useWorkspaceViewStore.getState().setPipelineStages(activeWorkspaceId, stages)
  }

  // ─── Render ──────────────────────────────────────────────────────────

  if (!activeWorkspaceId) {
    return <EmptyState message="Select a workspace to view artifacts" />
  }

  const hasDuplicates = duplicateKinds && duplicateKinds.length > 0
  const hasFileErrors = fileErrors && fileErrors.length > 0

  // ─── Focus mode: single card fills the entire area ─────────────────
  const exitFocus = useCallback(() => {
    if (activeWorkspaceId) useWorkspaceViewStore.getState().setFocusedCard(activeWorkspaceId, null)
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!focusedCard) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitFocus()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [focusedCard, exitFocus])

  if (focusedCard) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <ArtifactErrorBoundary kind={focusedCard as ArtifactKind}>
          <ArtifactCard
            workspaceId={activeWorkspaceId}
            kind={focusedCard as ArtifactKind}
            expanded
            onExpandedChange={() => {}}
            focused
            onToggleFocus={exitFocus}
          />
        </ArtifactErrorBoundary>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Artifact intro banner — above pipeline strip, outside scroll area */}
      {showArtifactIntro && <ArtifactIntroBanner />}

      {/* Pipeline strip — pinned at top, shrinks on scroll */}
      <PipelineStrip
        stages={pipelineStages}
        activeStageKind={activeStageKind}
        compact={pipelineCompact}
        onStageClick={scrollToStage}
        onConfigureClick={() => setConfigureOpen(true)}
        onExpand={handlePipelineExpand}
      />

      {/* Scrollable content area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {/* Error banners */}
        {hasFileErrors && fileErrors!.map((fe, i) => (
          <div key={i} className="mx-3 mt-3 rounded-lg px-3 py-2.5 flex items-start gap-2.5 bg-surface border border-error">
            <AlertTriangle size={13} className="text-error shrink-0 mt-0.5" />
            <div className="text-[12px] text-fg-secondary">
              <span className="font-medium text-fg">{fe.fileName}</span>: {fe.error}
            </div>
          </div>
        ))}

        {hasDuplicates && (
          <div className="mx-3 mt-3 rounded-lg px-3 py-2.5 flex items-start gap-2.5 bg-surface border border-error">
            <AlertTriangle size={13} className="text-error shrink-0 mt-0.5" />
            <div className="text-[12px] text-fg-secondary">
              Multiple artifacts of the same kind found:{' '}
              <span className="font-medium text-fg">{duplicateKinds!.join(', ')}</span>.
              Please remove duplicates from the .braid folder.
            </div>
          </div>
        )}

        {/* Stage sections with artifact cards */}
        <div className="flex flex-col gap-0 p-3">
          {pipelineStages.map((stage) => {
            const stageCards = workspaceKinds?.filter((k) => k === stage.kind) ?? []
            const isEmpty = stageCards.length === 0

            return (
              <div key={stage.kind}>
                <StageSection
                  kind={stage.kind}
                  isEmpty={isEmpty}
                  sectionRef={setSectionRef(stage.kind)}
                />
                {stageCards.map((kind) => (
                  <div key={kind} className="mt-4">
                    <ArtifactErrorBoundary kind={kind}>
                      <ArtifactCard
                        workspaceId={activeWorkspaceId}
                        kind={kind}
                        expanded={expandedCards.has(kind)}
                        onExpandedChange={(exp) => {
                          const store = useWorkspaceViewStore.getState()
                          if (exp) store.expandCard(activeWorkspaceId, kind)
                          else store.collapseCard(activeWorkspaceId, kind)
                        }}
                        onToggleFocus={() => {
                          const store = useWorkspaceViewStore.getState()
                          store.expandCard(activeWorkspaceId, kind)
                          store.setFocusedCard(activeWorkspaceId, kind)
                        }}
                      />
                    </ArtifactErrorBoundary>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* Configure pipeline modal */}
      <ConfigurePipelineModal
        open={configureOpen}
        onClose={() => setConfigureOpen(false)}
        currentStages={pipelineStages.map((s) => s.kind)}
        kindsWithContent={kindsWithContent}
        onSave={handlePipelineSave}
      />
    </div>
  )
}

// ─── Artifact intro banner ──────────────────────────────────────────────────

function ArtifactIntroBanner() {
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  function handleDismiss() {
    setVisible(false)
  }

  function handleDismissPermanently() {
    setVisible(false)
    ipc.app.setState({ dismissedArtifactIntro: true })
  }

  return (
    <div className="mx-3 mt-2 mb-1 rounded-lg bg-surface border border-border-subtle overflow-hidden overflow-y-auto max-h-[50vh] shrink-0 select-text">
      <div className="px-5 pt-4 pb-4">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-[14px] font-semibold text-fg">
            Artifacts — one place for everything your team builds
          </h3>
          <button
            onClick={handleDismiss}
            className="shrink-0 text-fg-tertiary hover:text-fg transition-colors select-none"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-3 space-y-3 text-[13px] text-fg-secondary leading-relaxed">
          <p>
            When you work on a feature, context lives everywhere — requirements in one tool, design decisions in another,
            specs in someone's head, QA plans nowhere. Every handoff loses information.
          </p>
          <p>
            Artifacts bring it all into one shared layer. PMs define requirements, engineers write designs and specs,
            QA builds test plans — all in the same workspace, all connected, all traceable.
          </p>
          <p>
            Your AI agents read and write artifacts directly from the .braid folder in your workspace — no MCP server,
            no plugins, no configuration. They work out of the box with Claude Code, Codex, Copilot, and 10+ other agents.
          </p>
          <p>
            When you're ready to share with your team, just hit save. Your artifact becomes a live document — teammates
            can edit together in real-time, leave comments on specific sections, and review changes. Everything stays in sync.
          </p>
        </div>

        <div className="mt-4">
          <h4 className="text-[13px] font-medium text-fg mb-2">How it works</h4>
          <ul className="space-y-1.5 text-[13px] text-fg-secondary">
            <li className="flex gap-2">
              <span className="text-fg-tertiary shrink-0">—</span>
              Start a conversation with your agent about what you're building
            </li>
            <li className="flex gap-2">
              <span className="text-fg-tertiary shrink-0">—</span>
              When ready, ask the agent to formalize decisions into an artifact
            </li>
            <li className="flex gap-2">
              <span className="text-fg-tertiary shrink-0">—</span>
              Save to share with your team — instant live collaboration
            </li>
            <li className="flex gap-2">
              <span className="text-fg-tertiary shrink-0">—</span>
              Every change captures what changed and why — no decision gets lost in a chat thread
            </li>
          </ul>
        </div>

        <div className="mt-5 flex items-center gap-4">
          <button
            onClick={handleDismissPermanently}
            className="text-[12px] font-medium text-brand hover:text-brand-hover transition-colors select-none"
          >
            Love it, don't show me again
          </button>
          <button
            onClick={handleDismiss}
            className="text-[12px] text-fg-tertiary hover:text-fg-secondary transition-colors select-none"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2">
      <Layers size={28} className="text-fg-tertiary opacity-40" />
      <span className="text-[13px] font-medium text-fg-secondary">{message}</span>
      {detail && (
        <span className="text-[12px] text-fg-tertiary">{detail}</span>
      )}
    </div>
  )
}
