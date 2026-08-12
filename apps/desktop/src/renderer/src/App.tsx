import { useEffect, useRef, useState } from 'react'
import { ipc } from './lib/ipc'
import { useProjectStore } from './store/project-store'
import { useWorkspaceStore } from './store/workspace-store'
import { useWorkspaceViewStore } from './store/workspace-view-store'
import { useTerminalStore } from './store/terminal-store'
import { useUIStore } from './store/ui-store'
import { useAuthStore } from './store/auth-store'
import { useArtifactStore } from './store/artifact-store'
import { useCommentBubbleStore } from './store/comment-bubble-store'
import { useCapabilityStore } from './store/capability-store'
import { Channels } from '../../shared/ipc-types'
import type { AuthUser } from '../../shared/ipc-types'
import { identifyUser, track, resetAnalytics } from './lib/analytics'
import { NavigationSideBar } from './components/navigation-sidebar/NavigationSideBar'
import { WorkspaceTabBar } from './components/workspace-tab-bar/WorkspaceTabBar'
import { HomePage } from './components/pages/HomePage'
import { ProjectPage } from './components/pages/ProjectPage'
import { EmptyTabPage } from './components/pages/EmptyTabPage'
import { CreateWorkspaceModal } from './components/modals/CreateWorkspaceModal'
import { CloseWorkspaceModal } from './components/modals/CloseWorkspaceModal'
import { BrokenWorkspaceModal } from './components/modals/BrokenWorkspaceModal'
import { QuitWarningModal } from './components/modals/QuitWarningModal'
import { AddProjectFlow } from './components/pages/AddProjectFlow'
import { LoginPage } from './components/pages/LoginPage'
import { AlertCircle, Keyboard, LogOut, PenLine, Settings, User } from 'lucide-react'
import { BraidMark } from './components/ui/BraidMark'
import { SettingsModal } from './components/modals/SettingsModal'
import { WorkspaceListModal } from './components/modals/WorkspaceListModal'
import { KeyboardShortcutsModal } from './components/modals/KeyboardShortcutsModal'
import { InviteContributorModal } from './components/modals/InviteContributorModal'
import { SetupOutputModal } from './components/modals/SetupScriptModal'
import { SetupProjectModal } from './components/modals/SetupProjectModal'
import { DeleteProjectModal } from './components/modals/DeleteProjectModal'
import { invalidateProject } from './lib/invalidate-project'
import { promptSetupToast } from './lib/setup-toast'
import { setupChromeShortcuts } from './lib/shortcuts'
import type { ShortcutId } from '../../shared/shortcuts'
import { Toaster } from './components/ui/Toaster'
import { ArtifactsTab } from './components/artifacts-tab/ArtifactsTab'
import { ScratchPanel } from './components/scratch/ScratchPanel'
import { useScratchStore } from './store/scratch-store'
import { SessionsTab } from './components/pages/SessionsTab'
import { toast } from 'sonner'

// ── Profile dropdown menu ────────────────────────────────────────────────────

function ProfileMenu({ user }: { user: AuthUser | null }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={menuRef} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center w-7 h-7 rounded text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
      >
        {user?.profilePictureUrl ? (
          <img src={user.profilePictureUrl} alt="" className="w-5 h-5 rounded-full" />
        ) : (
          <User size={15} />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-8 w-56 bg-surface-elevated border border-border rounded-lg shadow-lg py-1 z-50">
          <div className="px-3 py-2 border-b border-border-subtle">
            <p className="text-[13px] text-fg font-medium truncate">
              {user?.firstName ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}` : 'User'}
            </p>
            <p className="text-[12px] text-fg-secondary truncate">{user?.email}</p>
          </div>
          <button
            onClick={() => {
              setOpen(false)
              window.open('https://github.com/openbraid/braid/issues/new', '_blank')
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
          >
            <AlertCircle size={14} />
            Report a bug
          </button>
          <button
            onClick={() => {
              setOpen(false)
              ipc.auth.signOut()
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

// ── Auth gate — checks token, renders login or authenticated app ─────────────

function App(): React.JSX.Element {
  const { isLoading: authLoading, isAuthenticated, setUser, setError } = useAuthStore()
  const setCapabilities = useCapabilityStore((s) => s.setCapabilities)

  useEffect(() => {
    ipc.auth.getUser().then((user) => {
      setUser(user)
      if (user) identifyUser(user.id, { firstName: user.firstName })
    })

    ipc.capabilities.get().then(setCapabilities)

    const unsubCapabilities = ipc.on(Channels.CAPABILITIES_CHANGED, setCapabilities)

    const unsubAuth = ipc.on(Channels.AUTH_CHANGED, ({ user, error }) => {
      if (error) {
        setError(error)
      } else {
        if (user === null) {
          // Clear all renderer state before LoginPage renders
          useWorkspaceStore.getState().reset()
          useProjectStore.getState().reset()
          useArtifactStore.getState().reset()
          useWorkspaceViewStore.getState().reset()
          useUIStore.getState().reset()
          useTerminalStore.getState().reset()
          useCommentBubbleStore.getState().reset()
          resetAnalytics()
        } else {
          identifyUser(user.id, { firstName: user.firstName })
        }
        setUser(user)
      }
    })

    return () => {
      unsubAuth()
      unsubCapabilities()
    }
  }, [setUser, setError, setCapabilities])

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-page">
        <BraidMark size={32} className="animate-pulse" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginPage />
  }

  return <AuthenticatedApp />
}

// ── Main app — only mounts after auth is confirmed ───────────────────────────

function AuthenticatedApp(): React.JSX.Element {
  const user = useAuthStore((s) => s.user)
  const projects = useProjectStore((s) => s.projects)
  const setProjects = useProjectStore((s) => s.setProjects)
  const { setWorkspaces, setOpenTabIds, setActiveWorkspace, addWorkspace, updateWorkspace, setActiveView, setActiveProjectId, setWorkspaceUrl, setGitStatus, openTab, closeTab, initializeTab } =
    useWorkspaceStore()
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const openTabIds = useWorkspaceStore((s) => s.openTabIds)
  const initializedTabIds = useWorkspaceStore((s) => s.initializedTabIds)
  const workspaceUrls = useWorkspaceStore((s) => s.workspaceUrls)
  const { setTerminals, clearWorkspace } = useTerminalStore()
  const { setLeftPanelCollapsed, openModal, activeModal } = useUIStore()

  const activeView = useWorkspaceStore((s) => s.activeView)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const activeTab = useWorkspaceViewStore((s) =>
    activeWorkspaceId ? (s.views.get(activeWorkspaceId)?.activeTab ?? 'code') : 'code'
  )

  // Keep ref so event listeners always read current value without re-registering.
  const activeWorkspaceIdRef = useRef<string | null>(null)
  activeWorkspaceIdRef.current = activeWorkspaceId

  // Gate persistence effects until first hydration is complete
  const hydratedRef = useRef(false)

  // Track whether first-workspace nudge has been shown (loaded from app state on hydration)
  const firstWorkspaceNudgeDismissedRef = useRef(false)

  // Track webview elements for auto-focus
  const webviewRefs = useRef<Map<string, HTMLWebViewElement>>(new Map())

  // Fetch and cache the VS Code URL for a workspace
  async function loadWorkspaceUrl(workspaceId: string): Promise<void> {
    console.log(`[App] loadWorkspaceUrl: fetching URL for workspace ${workspaceId}`)
    try {
      const url = await ipc.workspaces.getUrl(workspaceId)
      console.log(`[App] loadWorkspaceUrl: workspace=${workspaceId} url=${url ?? '(null)'}`)
      if (url) setWorkspaceUrl(workspaceId, url)
    } catch (err) {
      console.error(`[App] loadWorkspaceUrl: failed for workspace ${workspaceId}`, err)
    }
  }

  // ── Keyboard shortcut handler ────────────────────────────────────────────
  // Wrapped in a ref so the handler identity never changes — prevents listener
  // re-attachment on re-renders. The ref always points to the latest closure.
  const handleShortcutRef = useRef<(id: ShortcutId) => void>(() => {})
  handleShortcutRef.current = (id: ShortcutId) => {
    // Read latest state directly from Zustand (not React refs) — getState() is
    // synchronous and always current, even if React hasn't re-rendered yet.
    const { sidebarOrder, activeWorkspaceId: active } = useWorkspaceStore.getState()
    const { projects } = useProjectStore.getState()

    // Flatten sidebar order across all projects in display order —
    // this matches exactly what the user sees in the sidebar.
    const flatOrder: string[] = []
    for (const project of projects) {
      flatOrder.push(...(sidebarOrder.get(project.id) ?? []))
    }

    console.log('[shortcut]', id, { active, flatOrder: flatOrder.length, sidebarOrderKeys: [...sidebarOrder.keys()] })

    switch (id) {
      case 'workspace.next-tab': {
        if (flatOrder.length === 0) { console.log('[shortcut] BAIL: flatOrder empty'); break }
        const idx = flatOrder.indexOf(active ?? '')
        const next = flatOrder[(idx + 1) % flatOrder.length]
        console.log('[shortcut] next', { idx, nextIdx: (idx + 1) % flatOrder.length, next: next?.slice(0, 8) })
        if (next) setActiveWorkspace(next)
        break
      }
      case 'workspace.prev-tab': {
        if (flatOrder.length === 0) { console.log('[shortcut] BAIL: flatOrder empty'); break }
        const idx = flatOrder.indexOf(active ?? '')
        const prev = flatOrder[(idx - 1 + flatOrder.length) % flatOrder.length]
        console.log('[shortcut] prev', { idx, prevIdx: (idx - 1 + flatOrder.length) % flatOrder.length, prev: prev?.slice(0, 8) })
        if (prev) setActiveWorkspace(prev)
        break
      }
      case 'workspace.close':
        if (active) {
          openModal('close-workspace', { modal: 'close-workspace', workspaceId: active })
        }
        break
      case 'workspace.new':
        openModal('create-workspace')
        break
      case 'workspace.list':
        openModal('workspace-list')
        break
      case 'scratch.toggle':
        useScratchStore.getState().togglePanel()
        break
    }
  }

  // Chrome shortcuts (document keydown) — for shortcuts that only need chrome context.
  // 'global' scope shortcuts (next/prev/close) are handled by Electron Menu accelerators
  // which fire at the browser level regardless of focus context.
  useEffect(() => {
    const handler = (id: ShortcutId) => handleShortcutRef.current(id)
    return setupChromeShortcuts(handler)
  }, [])

  useEffect(() => {
    // ── Hydrate from main process ──────────────────────────────────────────
    async function hydrate(): Promise<void> {
      const [projectsResult, workspacesResult, appStateResult] = await Promise.allSettled([
        ipc.projects.list(),
        ipc.workspaces.list(),
        ipc.app.getState()
      ])

      const projects = projectsResult.status === 'fulfilled' ? projectsResult.value : []
      const allWorkspaces = workspacesResult.status === 'fulfilled' ? workspacesResult.value : []
      const appState = appStateResult.status === 'fulfilled'
        ? appStateResult.value
        : { leftPanelCollapsed: false, collapsedProjectIds: [], openWorkspaceIds: [], lastActiveWorkspaceId: null, lastActiveView: 'home' as const, lastActiveProjectId: null, themeKind: 'dark' as const, dismissedArtifactIntro: false, dismissedFirstWorkspaceNudge: false, defaultAgent: null, scratchPanelOpen: false, scratchPanelWidth: 520, scratchActivePageId: null, scratchOpenPageIds: [] }

      if (projectsResult.status === 'rejected') {
        toast('Failed to load projects')
        console.error('[hydrate] projects failed:', projectsResult.reason)
      }
      if (workspacesResult.status === 'rejected') {
        toast('Failed to load workspaces')
        console.error('[hydrate] workspaces failed:', workspacesResult.reason)
      }

      setProjects(projects)
      setWorkspaces(allWorkspaces)
      setLeftPanelCollapsed(appState.leftPanelCollapsed)
      useUIStore.getState().setCollapsedProjectIds(appState.collapsedProjectIds ?? [])

      // Restore Scratch panel state (loadPages handles openPageIds + activePageId from app-state)
      const scratchStore = useScratchStore.getState()
      if (appState.scratchPanelOpen) scratchStore.openPanel()
      if (appState.scratchPanelWidth) scratchStore.setPanelWidth(appState.scratchPanelWidth)

      // Apply persisted theme
      if (appState.themeKind === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }

      // Filter app-state against real DB workspaces to discard stale IDs
      const existingIds = new Set(allWorkspaces.map((w) => w.id))
      const validOpenIds = appState.openWorkspaceIds.filter((id) => existingIds.has(id))
      setOpenTabIds(validOpenIds)

      // Restore the last active view — workspace takes priority, then project, then dashboard.
      const lastActiveWs = allWorkspaces.find((w) => w.id === appState.lastActiveWorkspaceId)
      if (lastActiveWs && lastActiveWs.status === 'open') {
        setActiveWorkspace(lastActiveWs.id)
        initializeTab(lastActiveWs.id)
        loadWorkspaceUrl(lastActiveWs.id)
      } else if (appState.lastActiveView === 'project' && appState.lastActiveProjectId) {
        const projectExists = projects.some((p) => p.id === appState.lastActiveProjectId)
        if (projectExists) {
          setActiveView('project')
          setActiveProjectId(appState.lastActiveProjectId)
        }
      }
      // else: activeView stays 'home' (dashboard)

      firstWorkspaceNudgeDismissedRef.current = appState.dismissedFirstWorkspaceNudge
      hydratedRef.current = true
      track('app_opened')
    }

    hydrate()

    // ── Push event listeners ───────────────────────────────────────────────
    const unsubWorkspaceCreated = ipc.on(Channels.WORKSPACE_CREATED, (workspace) => {
      addWorkspace(workspace)
      openTab(workspace.id)
      setActiveWorkspace(workspace.id)
      initializeTab(workspace.id)
      loadWorkspaceUrl(workspace.id)

      // One-time nudge to discover the Artifacts tab
      if (!firstWorkspaceNudgeDismissedRef.current) {
        firstWorkspaceNudgeDismissedRef.current = true
        ipc.app.setState({ dismissedFirstWorkspaceNudge: true })
        toast('Your workspace is ready. Head to the Artifacts tab to define requirements and plans with your AI agents.', {
          duration: 8000
        })
      }
    })

    const unsubWorkspaceUpdated = ipc.on(Channels.WORKSPACE_UPDATED, (workspace) => {
      updateWorkspace(workspace.id, workspace)
      // Only refresh URL for already-initialized workspaces (webview is mounted)
      if (useWorkspaceStore.getState().initializedTabIds.has(workspace.id)) {
        loadWorkspaceUrl(workspace.id)
      }
    })

    const unsubWorkspaceClosed = ipc.on(Channels.WORKSPACE_CLOSED, ({ workspaceId }) => {
      updateWorkspace(workspaceId, { status: 'closed_clean' })
      clearWorkspace(workspaceId)
      closeTab(workspaceId)

      // If this was the active workspace, navigate to the most recently visited remaining open tab.
      // Prefer same project first, then fall back globally.
      if (activeWorkspaceIdRef.current === workspaceId) {
        const { openTabIds, workspaces } = useWorkspaceStore.getState()
        const closedProjectId = workspaces.find((ws) => ws.id === workspaceId)?.projectId

        const remaining = openTabIds
          .filter((id) => id !== workspaceId)
          .map((id) => workspaces.find((ws) => ws.id === id))
          .filter((ws): ws is NonNullable<typeof ws> => ws != null && ws.status === 'open')
          .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))

        const sameProject = remaining.filter((ws) => ws.projectId === closedProjectId)
        const fallback = sameProject.length > 0 ? sameProject[0] : remaining[0]

        if (fallback) {
          setActiveWorkspace(fallback.id)
        } else if (closedProjectId) {
          setActiveView('project')
          setActiveProjectId(closedProjectId)
        } else {
          setActiveView('home')
        }
      }
    })

    const unsubWorkspaceBroken = ipc.on(Channels.WORKSPACE_BROKEN, ({ workspaceId }) => {
      track('workspace_broken', { workspace_id: workspaceId })
      updateWorkspace(workspaceId, { status: 'broken' })
      if (activeWorkspaceIdRef.current === workspaceId) {
        const brokenProjectId = useWorkspaceStore.getState().workspaces.find((ws) => ws.id === workspaceId)?.projectId
        if (brokenProjectId) {
          setActiveView('project')
          setActiveProjectId(brokenProjectId)
        } else {
          setActiveView('home')
        }
      }
    })

    const prevTerminals = new Map<string, Set<string>>()
    const prevAgentStatuses = new Map<string, string>()

    const unsubTerminalUpdated = ipc.on(Channels.TERMINAL_UPDATED, ({ workspaceId, terminals }) => {
      // Track new terminals
      const prevIds = prevTerminals.get(workspaceId) ?? new Set()
      for (const t of terminals) {
        if (!prevIds.has(t.terminalId)) {
          track('terminal_created')
        }
        // Track agent launched / completed transitions
        const prevStatus = prevAgentStatuses.get(t.terminalId)
        if (t.command && t.status === 'running' && prevStatus !== 'running') {
          track('agent_launched', { agent: t.command })
        }
        if (t.command && t.status === 'completed' && prevStatus !== 'completed') {
          track('agent_completed', { agent: t.command, exit_code: t.exitCode })
        }
        if (t.command) prevAgentStatuses.set(t.terminalId, t.status)
      }
      prevTerminals.set(workspaceId, new Set(terminals.map((t) => t.terminalId)))

      setTerminals(workspaceId, terminals)
    })

    const unsubQuitWarning = ipc.on(Channels.APP_QUIT_WARNING, (context) => {
      openModal('quit-warning', { modal: 'quit-warning', ...context })
    })

    const unsubSetupAvailable = ipc.on(Channels.WORKSPACE_SETUP_AVAILABLE, ({ workspaceId }) => {
      promptSetupToast(workspaceId)
    })

    const unsubVscodeCrashed = ipc.on(Channels.VSCODE_SERVER_CRASHED, () => {
      track('vscode_server_crashed')
    })

    const unsubGitStatus = ipc.on(Channels.GIT_STATUS_UPDATED, ({ workspaceId, changedFiles }) => {
      setGitStatus(workspaceId, changedFiles)
    })

    const unsubThemeChanged = ipc.on(Channels.THEME_CHANGED, ({ kind }) => {
      if (kind === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    })

    // Global shortcuts pushed from Electron Menu accelerators (main process).
    // These fire regardless of whether chrome or VS Code webview has focus.
    const unsubShortcut = ipc.on(Channels.SHORTCUT_TRIGGERED, ({ shortcutId }) => {
      handleShortcutRef.current(shortcutId as ShortcutId)
    })

    const unsubProjectUpdated = ipc.on(Channels.PROJECT_UPDATED, (project) => {
      const store = useProjectStore.getState()
      store.updateProject(project)
      // Re-check filesystem truth — main just mutated project_paths and/or cloned repos.
      store.refreshSetupStatus(project.id)
    })

    const unsubProjectDeleted = ipc.on(Channels.PROJECT_DELETED, ({ projectId, name }) => {
      invalidateProject(projectId, name, 'deleted')
    })

    // ── Focus-sync: catch projects deleted by a teammate while we were idle ──
    // There's no server → client push from core-api. When the window regains
    // focus we refetch the project list and invalidate anything that vanished.
    // Debounced to 2s so rapid alt-tab doesn't spam the API.
    let lastFocusSyncAt = 0
    async function syncProjectsOnFocus(): Promise<void> {
      const now = Date.now()
      if (now - lastFocusSyncAt < 2000) return
      lastFocusSyncAt = now
      try {
        const fresh = await ipc.projects.list()
        const freshIds = new Set(fresh.map((p) => p.id))
        const current = useProjectStore.getState().projects
        for (const stale of current) {
          if (!freshIds.has(stale.id)) {
            invalidateProject(stale.id, stale.name, 'deleted')
          }
        }
      } catch { /* transient failures are fine — retry on next focus */ }
    }
    window.addEventListener('focus', syncProjectsOnFocus)

    return () => {
      unsubWorkspaceCreated()
      unsubWorkspaceUpdated()
      unsubWorkspaceClosed()
      unsubWorkspaceBroken()
      unsubTerminalUpdated()
      unsubQuitWarning()
      unsubSetupAvailable()
      unsubVscodeCrashed()
      unsubGitStatus()
      unsubThemeChanged()
      unsubShortcut()
      unsubProjectUpdated()
      unsubProjectDeleted()
      window.removeEventListener('focus', syncProjectsOnFocus)
    }
  }, [
    setProjects,
    setWorkspaces,
    setOpenTabIds,
    setActiveWorkspace,
    setLeftPanelCollapsed,
    addWorkspace,
    updateWorkspace,
    setTerminals,
    clearWorkspace,
    closeTab,
    initializeTab,
    openModal,
    setActiveView,
    setActiveProjectId,
    setWorkspaceUrl,
    setGitStatus
  ])

  // Lazy initialization — triggered by any workspace switch (click, keyboard, Electron menu).
  // All switching paths go through setActiveWorkspace, which updates activeWorkspaceId.
  useEffect(() => {
    if (!activeWorkspaceId) return
    const { initializedTabIds: current } = useWorkspaceStore.getState()
    if (current.has(activeWorkspaceId)) return

    // First visit to this workspace — mount its webview and start the VS Code server
    const id = activeWorkspaceId
    initializeTab(id)
    loadWorkspaceUrl(id)
  }, [activeWorkspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus the active webview so VS Code title bar appears focused (black, not gray)
  useEffect(() => {
    if (activeView === 'workspace' && activeTab === 'code' && activeWorkspaceId) {
      const wv = webviewRefs.current.get(activeWorkspaceId)
      if (wv) {
        // Small delay to ensure the webview is visible before focusing
        requestAnimationFrame(() => wv.focus())
      }
    }
  }, [activeView, activeTab, activeWorkspaceId])

  // Tier 1: one-shot background scan after mount.
  useEffect(() => {
    ipc.workspaces.validateOpen().catch(() => { /* non-fatal */ })
  }, [])

  // Persist navigation state to app-state.json so it can be restored on next launch.
  // Gated by hydratedRef to avoid overwriting persisted state with defaults on mount.
  useEffect(() => {
    if (!hydratedRef.current) return
    ipc.app.setState({ lastActiveView: activeView, lastActiveProjectId: activeProjectId })
  }, [activeView, activeProjectId])

  useEffect(() => {
    if (!hydratedRef.current) return
    ipc.app.setState({ lastActiveWorkspaceId: activeWorkspaceId })
  }, [activeWorkspaceId])

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-page">
      {/* Title bar — macOS hiddenInset traffic lights + user/settings controls */}
      <div
        className="h-[38px] w-full shrink-0 bg-surface border-b border-border-subtle flex items-center justify-end px-3 gap-1"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <button
          onClick={() => openModal('keyboard-shortcuts')}
          className="flex items-center justify-center w-7 h-7 rounded text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Keyboard size={15} />
        </button>
        <button
          onClick={() => useScratchStore.getState().togglePanel()}
          className="flex items-center justify-center w-7 h-7 rounded text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="Scratch"
        >
          <PenLine size={15} />
        </button>
        <button
          onClick={() => openModal('settings')}
          className="flex items-center justify-center w-7 h-7 rounded text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Settings size={15} />
        </button>
        <ProfileMenu user={user} />
      </div>

      {/* Main content — sidebar + right panel */}
      <div className="flex flex-1 min-h-0">
        {projects.length > 0 && <NavigationSideBar />}

        {/* Right panel — blurred when a modal is open */}
        <div className={['flex-1 min-w-0 flex flex-col bg-page transition-[filter] duration-150', activeModal ? 'blur-sm' : ''].join(' ')}>
          {activeView === 'workspace' && <WorkspaceTabBar />}

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative select-text">
            {activeView === 'home' && <HomePage />}
            {activeView === 'project' && <ProjectPage />}
            {activeView === 'workspace' && activeTab !== 'code' && activeTab !== 'artifacts' && activeTab !== 'context' && activeTab !== 'sessions' && (
              <EmptyTabPage tab={activeTab} />
            )}

            {/* Artifacts tab — mounted per workspace on first visit, kept alive
                via display:none to preserve editor state and scroll position. */}
            {openTabIds.filter((id) => initializedTabIds.has(id)).map((wsId) => {
              const isVisible = activeView === 'workspace' && activeTab === 'artifacts' && wsId === activeWorkspaceId
              return (
                <div
                  key={`artifacts-${wsId}`}
                  className="absolute inset-0 flex flex-col"
                  style={{ display: isVisible ? 'flex' : 'none' }}
                >
                  <ArtifactsTab workspaceId={wsId} />
                </div>
              )
            })}

            {/* Context tab — placeholder, future feature */}

            {/* Sessions tab — native React, shown when sessions tab is active */}
            {activeView === 'workspace' && activeTab === 'sessions' && activeWorkspaceId && (
              <div className="absolute inset-0 flex flex-col">
                <SessionsTab workspaceId={activeWorkspaceId} />
              </div>
            )}

            {/* Loading state — shown while active workspace's VS Code server is starting */}
            {activeView === 'workspace' && activeTab === 'code' && activeWorkspaceId && !workspaceUrls.has(activeWorkspaceId) && (
              <div className="absolute inset-0 flex items-center justify-center bg-page">
                <span className="text-fg-secondary text-sm">Loading workspace...</span>
              </div>
            )}

            {/* Webviews — only mounted for initialized workspaces (lazy on first visit) */}
            {openTabIds.filter((id) => initializedTabIds.has(id)).map((wsId) => {
              const url = workspaceUrls.get(wsId)
              const isVisible = activeView === 'workspace' && activeTab === 'code' && wsId === activeWorkspaceId
              return url ? (
                <webview
                  key={wsId}
                  ref={(el: HTMLWebViewElement | null) => {
                    if (el) webviewRefs.current.set(wsId, el)
                    else webviewRefs.current.delete(wsId)
                  }}
                  src={url}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: isVisible ? 'flex' : 'none',
                    border: 'none'
                  }}
                />
              ) : null
            })}
          </div>
        </div>
      </div>

      {/* Scratch panel — fixed overlay on right edge */}
      <ScratchPanel />

      {/* Modals — rendered outside layout flow via Radix Dialog portals */}
      {activeModal === 'add-project' && (
        <div className="fixed inset-0 z-50 bg-overlay flex items-center justify-center">
          <AddProjectFlow onClose={() => useUIStore.getState().closeModal()} />
        </div>
      )}
      {activeModal === 'create-workspace' && <CreateWorkspaceModal />}
      {activeModal === 'close-workspace' && <CloseWorkspaceModal />}
      {activeModal === 'broken-workspace' && <BrokenWorkspaceModal />}
      {activeModal === 'quit-warning' && <QuitWarningModal />}
      {activeModal === 'settings' && <SettingsModal />}
      {activeModal === 'workspace-list' && <WorkspaceListModal />}
      {activeModal === 'keyboard-shortcuts' && <KeyboardShortcutsModal />}
      {activeModal === 'invite-contributor' && <InviteContributorModal />}
      {activeModal === 'setup-script' && <SetupOutputModal />}
      {activeModal === 'setup-project' && <SetupProjectModal />}
      {activeModal === 'delete-project' && <DeleteProjectModal />}

      <Toaster />
    </div>
  )
}

export default App
