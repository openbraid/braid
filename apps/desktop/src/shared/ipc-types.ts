// ─── Shared IPC contract ──────────────────────────────────────────────────────
// Single source of truth for all IPC types, channel names, and payload shapes.
// Imported by renderer, preload, AND main. No imports from src/main internals.

// ─── Domain types (mirror DB schema — schema.ts is the authoritative source) ──

export type Project = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export type Repository = {
  id: string
  remoteUrl: string
  name: string
}

export type WorkspaceRepoInfo = Repository & {
  sourceBranch: string
}

export type ProjectWithRepos = Project & {
  localPath: string | null
  repos: Repository[]
}

// Runtime filesystem check — distinct from localPath (DB truth) because the
// folder may have been deleted or renamed outside Braid.
//   setup     — localPath set AND folder exists AND every repo clone exists
//   not-setup — no localPath row (project was never cloned on this machine)
//   missing   — localPath set but folder is gone, or one or more repo clones are missing
export type ProjectSetupStatus =
  | { status: 'setup'; localPath: string }
  | { status: 'not-setup' }
  | { status: 'missing'; localPath: string; missingRepoNames: string[]; localPathExists: boolean }

export const WorkspaceStatus = {
  Open: 'open',
  ClosedWithFiles: 'closed_with_files',
  ClosedClean: 'closed_clean',
  Broken: 'broken'
} as const

export type WorkspaceStatus = (typeof WorkspaceStatus)[keyof typeof WorkspaceStatus]

export const WorkspaceBrokenReasonCode = {
  MissingWorktree: 'missing_worktree', // worktree folder deleted outside Braid
  MissingProjectPath: 'missing_project_path' // project local path no longer registered
} as const

export type WorkspaceBrokenReasonCode =
  (typeof WorkspaceBrokenReasonCode)[keyof typeof WorkspaceBrokenReasonCode]

export const WorkspaceLifecycleStatus = {
  InProgress: 'in_progress',
  Blocked: 'blocked',
  OnHold: 'on_hold',
  Completed: 'completed'
} as const

export type WorkspaceLifecycleStatus =
  (typeof WorkspaceLifecycleStatus)[keyof typeof WorkspaceLifecycleStatus]

export type Workspace = {
  id: string
  projectId: string
  name: string
  sanitizedName: string
  branchName: string
  sourceBranch: string
  createdBy: string
  ownerName: string
  createdAt: number
  updatedAt: number
  lifecycleStatus: WorkspaceLifecycleStatus
  lifecycleStatusChangedByFirstName: string | null
  lifecycleStatusChangedByLastName: string | null
  lifecycleStatusChangedAt: string | null
}

export type WorkspaceWithLocal = Workspace & {
  status: WorkspaceStatus
  brokenReason: WorkspaceBrokenReasonCode | null
  lastOpenedAt: number | null
  isPinned: boolean
}

// ─── Capabilities ─────────────────────────────────────────────────────────────
// Features that may be unavailable depending on whether a server is configured
// and reachable. Components ask for a capability rather than checking mode.

export const Capability = {
  Invites: 'invites',
  Comments: 'comments',
  LiveEditing: 'live_editing',
  Presence: 'presence',
  SharedArtifacts: 'shared_artifacts',
  // Workspace name suggestion runs an LLM on the server, so it needs both a
  // server and an API key configured there.
  NameSuggestion: 'name_suggestion'
} as const

export type Capability = (typeof Capability)[keyof typeof Capability]

/** `reason` is user-facing copy — render it directly in a tooltip. */
export type CapabilityState = {
  enabled: boolean
  reason: string | null
}

export type CapabilityMap = Record<Capability, CapabilityState>

/** Where this app is reading and writing its data right now. */
export type AppModeInfo = {
  mode: 'local' | 'team'
  /** Null in local mode. */
  serverUrl: string | null
}

// ─── Branch validation (used by Create Workspace modal) ───────────────────────

export type BranchValidationResult =
  | { valid: false; reason: 'BRANCH_IN_USE'; workspaceName: string; workspaceId: string }
  | { valid: true; action: 'USE_EXISTING' }
  | { valid: true; action: 'CREATE_NEW' }

// ─── App state (mirrors lib/app-state.ts AppState) ────────────────────────────

export type AppState = {
  lastActiveWorkspaceId: string | null
  lastActiveView: 'home' | 'project' | 'workspace'
  lastActiveProjectId: string | null
  leftPanelCollapsed: boolean
  collapsedProjectIds: string[]
  openWorkspaceIds: string[]
  themeKind: 'dark' | 'light'
  dismissedArtifactIntro: boolean
  dismissedFirstWorkspaceNudge: boolean
  defaultAgent: string | null
  scratchPanelOpen: boolean
  scratchPanelWidth: number
  scratchActivePageId: string | null
  scratchOpenPageIds: string[]
}

// ─── Terminal types ───────────────────────────────────────────────────────────

export const TerminalStatus = {
  Running: 'running',
  Waiting: 'waiting',
  Idle: 'idle',
  Completed: 'completed'
} as const

export type TerminalStatus = (typeof TerminalStatus)[keyof typeof TerminalStatus]

// Keep AgentStatus as alias for backward compatibility in renderer
export const AgentStatus = TerminalStatus
export type AgentStatus = TerminalStatus

export type WorkspaceTerminalEntry = {
  id: string // DB record ID (stable across PTY respawns)
  terminalId: string // runtime PTY ID
  workspaceId: string
  label: string // user-visible name (e.g. "Terminal 1")
  displayOrder: number
  isActive: boolean
  status: TerminalStatus
  command: string | null // detected foreground process name (e.g. "claude", "npm")
  exitCode: number | null
  completedAt: number | null // timestamp when command completed (for dismiss countdown)
}

// Legacy alias — renderer components reference this
export type TerminalEntry = WorkspaceTerminalEntry

// ─── Auth types ──────────────────────────────────────────────────────────────

export type AuthProvider = 'GoogleOAuth' | 'GitHubOAuth' | 'authkit'

export type AuthUser = {
  id: string
  backendUserId: string | null
  email: string
  firstName: string | null
  lastName: string | null
  profilePictureUrl: string | null
}

// ─── Contributor types ───────────────────────────────────────────────────────

export type Contributor = {
  userId: string
  email: string
  firstName: string | null
  lastName: string | null
  picture: string | null
  role: 'owner' | 'contributor'
  addedAt: string
}

// ─── Artifact types ──────────────────────────────────────────────────────────

export const ArtifactKind = {
  Requirements: 'REQUIREMENTS',
  Design: 'DESIGN',
  Spec: 'SPEC',
  TestPlan: 'TEST_PLAN',
  Security: 'SECURITY',
  ReleaseNotes: 'RELEASE_NOTES',
  UserGuide: 'USER_GUIDE',
  Rca: 'RCA'
} as const

export type ArtifactKind = (typeof ArtifactKind)[keyof typeof ArtifactKind]

export type ArtifactMeta = {
  kind: ArtifactKind
  title: string
  status?: string
}

export type ArtifactFileEntry = {
  kind: ArtifactKind
  title: string
  fileName: string
  sizeBytes: number
}

export type ArtifactFileError = {
  fileName: string
  error: string
}

export type ArtifactListResult = {
  artifacts: ArtifactFileEntry[]
  errors: ArtifactFileError[]
  duplicateKinds: ArtifactKind[]
}

export type ServerArtifactListItem = {
  kind: string
  title: string
  status: string
  statusChangedBy: string | null
  statusChangedByFirstName: string | null
  statusChangedByLastName: string | null
  statusChangedAt: string | null
  version: number
  lastEditedBy: string | null
  updatedAt: string
}

export type ServerArtifact = {
  kind: string
  title: string
  status: string
  statusChangedBy: string | null
  statusChangedByFirstName: string | null
  statusChangedByLastName: string | null
  statusChangedAt: string | null
  version: number
  yamlContent: string
  lastEditedBy: string | null
  createdAt: string
  updatedAt: string
}

// ─── Agent session types ─────────────────────────────────────────────────────

export type AgentSession = {
  sessionId: string
  agent: string
  title: string | null
  customName: string | null
  lastUpdated: number
  resumeCommand: string | null
  directory: string
}

// ─── Project settings types ──────────────────────────────────────────────────

export type ProjectSettings = {
  artifactsEnabled: boolean
  selectedAgents: string[]
}

export type AgentListItem = {
  id: string
  displayName: string
  supportsLaunch: boolean
}

// ─── Scratch types ──────────────────────────────────────────────────────────

export type ScratchPage = {
  id: string
  userId: string
  title: string
  content: string
  textContent: string
  displayOrder: number
  createdAt: number
  updatedAt: number
}

// ─── Channel names ────────────────────────────────────────────────────────────

export const Channels = {
  // Renderer → Main (invoke)
  AUTH_SIGN_IN: 'auth:sign-in',
  AUTH_SIGN_OUT: 'auth:sign-out',
  AUTH_GET_USER: 'auth:get-user',
  AUTH_GET_TOKEN: 'auth:get-token',

  PROJECT_LIST: 'project:list',
  PROJECT_SCAN_FOLDER: 'project:scan-folder',
  PROJECT_CREATE: 'project:create',
  PROJECT_DELETE: 'project:delete',
  PROJECT_GET_SETUP_STATUS: 'project:get-setup-status',
  PROJECT_SETUP_LOCALLY: 'project:setup-locally',
  PROJECT_GET_MONITORED_COMMANDS: 'project:get-monitored-commands',
  PROJECT_ADD_MONITORED_COMMAND: 'project:add-monitored-command',
  PROJECT_REMOVE_MONITORED_COMMAND: 'project:remove-monitored-command',

  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_OPEN: 'workspace:open',
  WORKSPACE_CLOSE: 'workspace:close',
  WORKSPACE_REOPEN: 'workspace:reopen',
  WORKSPACE_REPAIR: 'workspace:repair',
  WORKSPACE_VALIDATE_OPEN: 'workspace:validate-open',
  WORKSPACE_GET_BRANCHES: 'workspace:get-branches',
  WORKSPACE_GET_URL: 'workspace:get-url',
  WORKSPACE_TOGGLE_PIN: 'workspace:toggle-pin',
  WORKSPACE_UPDATE_LIFECYCLE_STATUS: 'workspace:update-lifecycle-status',
  WORKSPACE_ADD_REPO: 'workspace:add-repo',
  WORKSPACE_CHECK_SETUP: 'workspace:check-setup',
  WORKSPACE_RUN_SETUP: 'workspace:run-setup',
  WORKSPACE_SUGGEST_NAME: 'workspace:suggest-name',

  PROJECT_GET_SETTINGS: 'project:get-settings',
  PROJECT_UPDATE_SETTINGS: 'project:update-settings',

  AGENTS_DETECT: 'agents:detect',
  AGENTS_LIST: 'agents:list',

  INSTRUCTION_GET_AGENT: 'instruction:get-agent',

  CONTRIBUTOR_LIST: 'contributor:list',
  CONTRIBUTOR_INVITE: 'contributor:invite',
  CONTRIBUTOR_REMOVE: 'contributor:remove',

  ARTIFACT_LIST: 'artifact:list',
  ARTIFACT_READ: 'artifact:read',
  ARTIFACT_WRITE: 'artifact:write',
  ARTIFACT_FOLDER_INIT: 'artifact:folder-init',

  ARTIFACT_SERVER_LIST: 'artifact:server:list',
  ARTIFACT_SERVER_GET: 'artifact:server:get',
  ARTIFACT_SERVER_SAVE: 'artifact:server:save',
  ARTIFACT_SERVER_UPDATE_STATUS: 'artifact:server:update-status',
  ARTIFACT_SERVER_SYNC: 'artifact:server:sync',
  ARTIFACT_GET_SYNC_VERSION: 'artifact:get-sync-version',
  ARTIFACT_SET_SYNC_VERSION: 'artifact:set-sync-version',
  ARTIFACT_GET_COLLAB_URL: 'artifact:get-collab-url',

  SESSION_LIST: 'session:list',
  SESSION_RENAME: 'session:rename',

  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_KILL: 'terminal:kill',
  TERMINAL_RENAME: 'terminal:rename',
  TERMINAL_LIST: 'terminal:list',
  TERMINAL_WRITE_INPUT: 'terminal:write-input',

  SCRATCH_GET_PAGES: 'scratch:get-pages',
  SCRATCH_GET_PAGE: 'scratch:get-page',
  SCRATCH_CREATE_PAGE: 'scratch:create-page',
  SCRATCH_UPDATE_CONTENT: 'scratch:update-content',
  SCRATCH_UPDATE_TITLE: 'scratch:update-title',
  SCRATCH_DELETE_PAGE: 'scratch:delete-page',
  SCRATCH_REORDER_PAGES: 'scratch:reorder-pages',
  SCRATCH_SEARCH: 'scratch:search',
  SCRATCH_LAUNCH_AGENT: 'scratch:launch-agent',
  SCRATCH_DICTATION_START: 'scratch:dictation:start',
  SCRATCH_DICTATION_STOP: 'scratch:dictation:stop',

  GIT_BRANCHES: 'git:branches',
  GIT_BRANCHES_PER_REPO: 'git:branches-per-repo',
  GIT_STATUS: 'git:status',

  APP_STATE_GET: 'app:state:get',
  APP_STATE_SET: 'app:state:set',
  APP_QUIT: 'app:quit',
  APP_RELAUNCH: 'app:relaunch',

  CAPABILITIES_GET: 'capabilities:get',
  APP_MODE_GET: 'app:mode:get',
  APP_MODE_SET: 'app:mode:set',

  TELEMETRY_IS_ENABLED: 'telemetry:is-enabled',

  DIALOG_OPEN_FOLDER: 'dialog:open-folder',

  // Main → Renderer (push)
  AUTH_CHANGED: 'auth:changed',
  CAPABILITIES_CHANGED: 'capabilities:changed',

  PROJECT_CREATED: 'project:created',
  PROJECT_UPDATED: 'project:updated',
  PROJECT_DELETED: 'project:deleted',
  PROJECT_CREATE_PROGRESS: 'project:create:progress',
  PROJECT_SETUP_PROGRESS: 'project:setup:progress',
  WORKSPACE_CREATED: 'workspace:created',
  WORKSPACE_UPDATED: 'workspace:updated',
  WORKSPACE_CLOSED: 'workspace:closed',
  WORKSPACE_BROKEN: 'workspace:broken',
  WORKSPACE_CREATE_PROGRESS: 'workspace:create:progress',
  WORKSPACE_REPO_ADDED: 'workspace:repo-added',
  WORKSPACE_SETUP_AVAILABLE: 'workspace:setup-available',

  ARTIFACT_FILE_CHANGED: 'artifact:file-changed',

  TERMINAL_UPDATED: 'terminal:updated',
  GIT_STATUS_UPDATED: 'git:status:updated',

  VSCODE_SERVER_READY: 'vscode:server:ready',
  VSCODE_SERVER_CRASHED: 'vscode:server:crashed',

  APP_QUIT_WARNING: 'app:quit:warning',

  THEME_CHANGED: 'theme:changed',

  SHORTCUT_TRIGGERED: 'shortcut:triggered',

  SCRATCH_DICTATION_VOLUME: 'scratch:dictation:volume',
  SCRATCH_DICTATION_RESULT: 'scratch:dictation:result',
  SCRATCH_DICTATION_ERROR: 'scratch:dictation:error',
  SCRATCH_DICTATION_STATUS: 'scratch:dictation:status'
} as const

export type Channel = (typeof Channels)[keyof typeof Channels]

// ─── Invoke payload / response map ───────────────────────────────────────────

export type ScannedRepo = {
  name: string
  path: string
  remoteUrl: string
}

export type InvokeMap = {
  [Channels.AUTH_SIGN_IN]: {
    payload: { provider: AuthProvider }
    response: { success: boolean; error?: string }
  }
  [Channels.AUTH_SIGN_OUT]: { payload: void; response: { success: boolean; error?: string } }
  [Channels.AUTH_GET_USER]: { payload: void; response: AuthUser | null }
  [Channels.AUTH_GET_TOKEN]: { payload: void; response: string | null }

  [Channels.PROJECT_LIST]: { payload: void; response: ProjectWithRepos[] }
  [Channels.PROJECT_GET_MONITORED_COMMANDS]: { payload: { projectId: string }; response: string[] }
  [Channels.PROJECT_ADD_MONITORED_COMMAND]: {
    payload: { projectId: string; command: string }
    response: void
  }
  [Channels.PROJECT_REMOVE_MONITORED_COMMAND]: {
    payload: { projectId: string; command: string }
    response: void
  }
  [Channels.PROJECT_SCAN_FOLDER]: {
    payload: { localPath: string }
    response: ScannedRepo[]
  }
  [Channels.PROJECT_CREATE]: {
    payload: {
      name: string
      localPath: string
      repos: Array<{ name: string; remoteUrl: string }>
    }
    response: ProjectWithRepos
  }
  [Channels.PROJECT_GET_SETUP_STATUS]: {
    payload: { projectId: string }
    response: ProjectSetupStatus
  }
  [Channels.PROJECT_SETUP_LOCALLY]: {
    payload: { projectId: string; parentFolder: string }
    response: ProjectWithRepos
  }
  [Channels.PROJECT_DELETE]: {
    payload: { projectId: string }
    response: { id: string; name: string }
  }

  [Channels.PROJECT_GET_SETTINGS]: {
    payload: { projectId: string }
    response: ProjectSettings
  }
  [Channels.PROJECT_UPDATE_SETTINGS]: {
    payload: { projectId: string; artifactsEnabled?: boolean; selectedAgents?: string[] }
    response: ProjectSettings
  }

  [Channels.AGENTS_DETECT]: { payload: void; response: string[] }
  [Channels.AGENTS_LIST]: { payload: void; response: AgentListItem[] }

  [Channels.INSTRUCTION_GET_AGENT]: { payload: void; response: string }

  [Channels.WORKSPACE_LIST]: { payload: void; response: WorkspaceWithLocal[] }
  [Channels.WORKSPACE_CREATE]: {
    payload: {
      projectId: string
      name: string
      branchName: string
      sourceBranch: string
      repos?: Array<{ repoId: string; sourceBranch?: string }>
    }
    response: WorkspaceWithLocal
  }
  [Channels.WORKSPACE_ADD_REPO]: {
    payload: { workspaceId: string; repoId: string }
    response: WorkspaceWithLocal
  }
  [Channels.WORKSPACE_OPEN]: { payload: { workspaceId: string }; response: void }
  [Channels.WORKSPACE_CLOSE]: {
    payload: { workspaceId: string; removeFiles: boolean }
    response: void
  }
  [Channels.WORKSPACE_REOPEN]: { payload: { workspaceId: string }; response: void }
  [Channels.WORKSPACE_REPAIR]: { payload: { workspaceId: string }; response: void }
  [Channels.WORKSPACE_VALIDATE_OPEN]: { payload: void; response: void }
  [Channels.WORKSPACE_GET_BRANCHES]: {
    payload: { projectId: string }
    // Branch names not tied to any existing workspace — safe to use in Create Workspace dropdown
    response: string[]
  }
  [Channels.WORKSPACE_GET_URL]: {
    payload: { workspaceId: string }
    response: string | null
  }
  [Channels.WORKSPACE_TOGGLE_PIN]: {
    payload: { workspaceId: string; isPinned: boolean }
    response: void
  }
  [Channels.WORKSPACE_UPDATE_LIFECYCLE_STATUS]: {
    payload: { workspaceId: string; lifecycleStatus: WorkspaceLifecycleStatus }
    response: void
  }

  [Channels.WORKSPACE_CHECK_SETUP]: {
    payload: { workspaceId: string }
    response: { hasSetupScript: boolean; repoNames: string[] }
  }
  [Channels.WORKSPACE_RUN_SETUP]: {
    payload: { workspaceId: string }
    response: { success: boolean; output: string }
  }
  [Channels.WORKSPACE_SUGGEST_NAME]: {
    payload: { text: string }
    response: { name: string }
  }

  [Channels.CONTRIBUTOR_LIST]: {
    payload: { projectId: string }
    response: Contributor[]
  }
  [Channels.CONTRIBUTOR_INVITE]: {
    payload: { projectId: string; email: string }
    response: Contributor
  }
  [Channels.CONTRIBUTOR_REMOVE]: {
    payload: { projectId: string; userId: string }
    response: void
  }

  [Channels.ARTIFACT_LIST]: {
    payload: { workspaceId: string }
    response: ArtifactListResult
  }
  [Channels.ARTIFACT_READ]: {
    payload: { workspaceId: string; kind: ArtifactKind }
    response: { yamlContent: string; meta: ArtifactMeta } | null
  }
  [Channels.ARTIFACT_WRITE]: {
    payload: { workspaceId: string; kind: ArtifactKind; yamlContent: string }
    response: { success: boolean; error?: string }
  }
  [Channels.ARTIFACT_FOLDER_INIT]: {
    payload: { workspaceId: string }
    response: { braidDir: string; seededArtifacts: ArtifactKind[] }
  }

  [Channels.ARTIFACT_SERVER_LIST]: {
    payload: { workspaceId: string }
    response: ServerArtifactListItem[]
  }
  [Channels.ARTIFACT_SERVER_GET]: {
    payload: { workspaceId: string; kind: string }
    response: ServerArtifact
  }
  [Channels.ARTIFACT_SERVER_SAVE]: {
    payload: {
      workspaceId: string
      kind: string
      yamlContent: string
      title?: string
      expectedVersion?: number
      yjsState?: string
    }
    response: ServerArtifact
  }
  [Channels.ARTIFACT_SERVER_UPDATE_STATUS]: {
    payload: { workspaceId: string; kind: string; status: string }
    response: ServerArtifact
  }
  [Channels.ARTIFACT_SERVER_SYNC]: {
    payload: { workspaceId: string; kind: string }
    response: ServerArtifact
  }
  [Channels.ARTIFACT_GET_SYNC_VERSION]: {
    payload: { workspaceId: string; kind: string }
    response: { version: number; yamlContent: string | null } | null
  }
  [Channels.ARTIFACT_SET_SYNC_VERSION]: {
    payload: { workspaceId: string; kind: string; version: number; yamlContent?: string }
    response: void
  }
  [Channels.ARTIFACT_GET_COLLAB_URL]: {
    payload: { workspaceId: string; kind: string }
    response: { url: string; token: string }
  }

  [Channels.SESSION_LIST]: {
    payload: { workspaceId: string }
    response: AgentSession[]
  }
  [Channels.SESSION_RENAME]: {
    payload: { sessionId: string; agent: string; name: string }
    response: void
  }

  [Channels.TERMINAL_CREATE]: {
    payload: { workspaceId: string }
    response: WorkspaceTerminalEntry
  }
  [Channels.TERMINAL_KILL]: { payload: { id: string }; response: void }
  [Channels.TERMINAL_RENAME]: { payload: { id: string; label: string }; response: void }
  [Channels.TERMINAL_LIST]: {
    payload: { workspaceId: string }
    response: WorkspaceTerminalEntry[]
  }
  [Channels.TERMINAL_WRITE_INPUT]: {
    payload: { terminalId: string; data: string }
    response: void
  }

  [Channels.SCRATCH_GET_PAGES]: { payload: void; response: ScratchPage[] }
  [Channels.SCRATCH_GET_PAGE]: { payload: { id: string }; response: ScratchPage | null }
  [Channels.SCRATCH_CREATE_PAGE]: { payload: { title?: string }; response: ScratchPage }
  [Channels.SCRATCH_UPDATE_CONTENT]: {
    payload: { id: string; content: string; textContent: string }
    response: void
  }
  [Channels.SCRATCH_UPDATE_TITLE]: { payload: { id: string; title: string }; response: void }
  [Channels.SCRATCH_DELETE_PAGE]: { payload: { id: string }; response: void }
  [Channels.SCRATCH_REORDER_PAGES]: { payload: { orderedIds: string[] }; response: void }
  [Channels.SCRATCH_SEARCH]: { payload: { query: string }; response: ScratchPage[] }
  [Channels.SCRATCH_LAUNCH_AGENT]: {
    payload: { agentId: string; prompt: string; workspaceId: string }
    response: { success: boolean }
  }
  [Channels.SCRATCH_DICTATION_START]: {
    payload: void
    response: { success: boolean; error?: string }
  }
  [Channels.SCRATCH_DICTATION_STOP]: { payload: { cancel: boolean }; response: void }

  [Channels.GIT_BRANCHES]: { payload: { projectId: string }; response: string[] }
  [Channels.GIT_BRANCHES_PER_REPO]: {
    payload: { projectId: string }
    response: Array<{ repoId: string; repoName: string; branches: string[] }>
  }
  [Channels.GIT_STATUS]: {
    payload: { workspaceId: string }
    response: { changedFiles: number }
  }

  [Channels.APP_STATE_GET]: { payload: void; response: AppState }
  [Channels.APP_STATE_SET]: { payload: Partial<AppState>; response: void }
  [Channels.APP_QUIT]: { payload: void; response: void }
  [Channels.APP_RELAUNCH]: { payload: void; response: void }
  [Channels.CAPABILITIES_GET]: { payload: void; response: CapabilityMap }
  [Channels.APP_MODE_GET]: { payload: void; response: AppModeInfo }
  [Channels.APP_MODE_SET]: {
    payload: { serverUrl: string | null; serverToken: string | null }
    response: { ok: true } | { ok: false; error: string }
  }

  // Analytics are opt-in. The renderer must ask before initialising any SDK —
  // a false here means nothing is loaded and nothing is sent.
  [Channels.TELEMETRY_IS_ENABLED]: { payload: void; response: boolean }

  [Channels.DIALOG_OPEN_FOLDER]: { payload: void; response: string | null }
}

// ─── Push event payload map (Main → Renderer) ─────────────────────────────────

export type ProjectCreateProgressStep = {
  label: string
  status: 'active' | 'done' | 'error'
  detail?: string
}

export type PushMap = {
  [Channels.AUTH_CHANGED]: { user: AuthUser | null; error?: string }
  [Channels.CAPABILITIES_CHANGED]: CapabilityMap

  [Channels.PROJECT_CREATED]: ProjectWithRepos
  [Channels.PROJECT_UPDATED]: ProjectWithRepos
  [Channels.PROJECT_DELETED]: { projectId: string; name: string }
  [Channels.PROJECT_CREATE_PROGRESS]: ProjectCreateProgressStep
  [Channels.PROJECT_SETUP_PROGRESS]: ProjectCreateProgressStep
  [Channels.WORKSPACE_CREATED]: WorkspaceWithLocal
  [Channels.WORKSPACE_UPDATED]: WorkspaceWithLocal
  [Channels.WORKSPACE_CLOSED]: { workspaceId: string }
  [Channels.WORKSPACE_BROKEN]: { workspaceId: string }
  [Channels.WORKSPACE_CREATE_PROGRESS]: ProjectCreateProgressStep
  [Channels.WORKSPACE_REPO_ADDED]: WorkspaceWithLocal
  [Channels.WORKSPACE_SETUP_AVAILABLE]: { workspaceId: string }
  [Channels.ARTIFACT_FILE_CHANGED]: { workspaceId: string; kind: ArtifactKind; fileName: string }

  [Channels.TERMINAL_UPDATED]: { workspaceId: string; terminals: WorkspaceTerminalEntry[] }
  [Channels.GIT_STATUS_UPDATED]: { workspaceId: string; changedFiles: number }
  [Channels.VSCODE_SERVER_READY]: { projectId: string; port: number }
  [Channels.VSCODE_SERVER_CRASHED]: { projectId: string }
  [Channels.APP_QUIT_WARNING]: {
    activeTerminals: Array<{
      workspaceName: string
      command: string
      status: 'running' | 'waiting'
    }>
    uncommittedWorkspaces: Array<{ workspaceName: string; repoName: string; changedFiles: number }>
  }
  [Channels.THEME_CHANGED]: { kind: 'dark' | 'light' }
  [Channels.SHORTCUT_TRIGGERED]: { shortcutId: string }
  [Channels.SCRATCH_DICTATION_VOLUME]: { levels: number[] }
  [Channels.SCRATCH_DICTATION_RESULT]: { text: string }
  [Channels.SCRATCH_DICTATION_ERROR]: { error: string }
  [Channels.SCRATCH_DICTATION_STATUS]: { message: string }
}
