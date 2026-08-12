import { Channels } from '../../../shared/ipc-types'
import type { AppState, AuthProvider, ArtifactKind, WorkspaceLifecycleStatus, ProjectSettings, PushMap } from '../../../shared/ipc-types'

export type { AppState }

// Typed wrappers around window.api. Components and hooks import from here only —
// never call window.api directly.

export const ipc = {
  auth: {
    signIn: (provider: AuthProvider) =>
      window.api.invoke(Channels.AUTH_SIGN_IN, { provider }),
    signOut: () => window.api.invoke(Channels.AUTH_SIGN_OUT),
    getUser: () => window.api.invoke(Channels.AUTH_GET_USER),
    getToken: () => window.api.invoke(Channels.AUTH_GET_TOKEN)
  },

  capabilities: {
    get: () => window.api.invoke(Channels.CAPABILITIES_GET)
  },

  appMode: {
    get: () => window.api.invoke(Channels.APP_MODE_GET),
    set: (serverUrl: string | null, serverToken: string | null) =>
      window.api.invoke(Channels.APP_MODE_SET, { serverUrl, serverToken })
  },

  telemetry: {
    isEnabled: () => window.api.invoke(Channels.TELEMETRY_IS_ENABLED)
  },

  projects: {
    list: () => window.api.invoke(Channels.PROJECT_LIST),
    scanFolder: (localPath: string) =>
      window.api.invoke(Channels.PROJECT_SCAN_FOLDER, { localPath }),
    create: (payload: { name: string; localPath: string; repos: Array<{ name: string; remoteUrl: string }> }) =>
      window.api.invoke(Channels.PROJECT_CREATE, payload),
    getSetupStatus: (projectId: string) =>
      window.api.invoke(Channels.PROJECT_GET_SETUP_STATUS, { projectId }),
    setupLocally: (projectId: string, parentFolder: string) =>
      window.api.invoke(Channels.PROJECT_SETUP_LOCALLY, { projectId, parentFolder }),
    delete: (projectId: string) =>
      window.api.invoke(Channels.PROJECT_DELETE, { projectId }),
    getMonitoredCommands: (projectId: string) =>
      window.api.invoke(Channels.PROJECT_GET_MONITORED_COMMANDS, { projectId }),
    addMonitoredCommand: (projectId: string, command: string) =>
      window.api.invoke(Channels.PROJECT_ADD_MONITORED_COMMAND, { projectId, command }),
    removeMonitoredCommand: (projectId: string, command: string) =>
      window.api.invoke(Channels.PROJECT_REMOVE_MONITORED_COMMAND, { projectId, command }),
    getSettings: (projectId: string) =>
      window.api.invoke(Channels.PROJECT_GET_SETTINGS, { projectId }),
    updateSettings: (projectId: string, settings: Partial<ProjectSettings>) =>
      window.api.invoke(Channels.PROJECT_UPDATE_SETTINGS, { projectId, ...settings })
  },

  agents: {
    detect: () => window.api.invoke(Channels.AGENTS_DETECT),
    list: () => window.api.invoke(Channels.AGENTS_LIST)
  },

  instructions: {
    getAgent: () => window.api.invoke(Channels.INSTRUCTION_GET_AGENT)
  },

  workspaces: {
    list: () => window.api.invoke(Channels.WORKSPACE_LIST),
    create: (payload: { projectId: string; name: string; branchName: string; sourceBranch: string; repos?: Array<{ repoId: string; sourceBranch?: string }> }) =>
      window.api.invoke(Channels.WORKSPACE_CREATE, payload),
    addRepo: (workspaceId: string, repoId: string) =>
      window.api.invoke(Channels.WORKSPACE_ADD_REPO, { workspaceId, repoId }),
    open: (workspaceId: string) =>
      window.api.invoke(Channels.WORKSPACE_OPEN, { workspaceId }),
    close: (workspaceId: string, removeFiles: boolean) =>
      window.api.invoke(Channels.WORKSPACE_CLOSE, { workspaceId, removeFiles }),
    reopen: (workspaceId: string) =>
      window.api.invoke(Channels.WORKSPACE_REOPEN, { workspaceId }),
    repair: (workspaceId: string) =>
      window.api.invoke(Channels.WORKSPACE_REPAIR, { workspaceId }),
    validateOpen: () =>
      window.api.invoke(Channels.WORKSPACE_VALIDATE_OPEN),
    getBranches: (projectId: string) =>
      window.api.invoke(Channels.WORKSPACE_GET_BRANCHES, { projectId }),
    getUrl: (workspaceId: string) =>
      window.api.invoke(Channels.WORKSPACE_GET_URL, { workspaceId }),
    togglePin: (workspaceId: string, isPinned: boolean) =>
      window.api.invoke(Channels.WORKSPACE_TOGGLE_PIN, { workspaceId, isPinned }),
    updateLifecycleStatus: (workspaceId: string, lifecycleStatus: WorkspaceLifecycleStatus) =>
      window.api.invoke(Channels.WORKSPACE_UPDATE_LIFECYCLE_STATUS, { workspaceId, lifecycleStatus }),
    checkSetup: (workspaceId: string) =>
      window.api.invoke(Channels.WORKSPACE_CHECK_SETUP, { workspaceId }),
    runSetup: (workspaceId: string) =>
      window.api.invoke(Channels.WORKSPACE_RUN_SETUP, { workspaceId }),
    suggestName: (text: string) =>
      window.api.invoke(Channels.WORKSPACE_SUGGEST_NAME, { text })
  },

  contributors: {
    list: (projectId: string) =>
      window.api.invoke(Channels.CONTRIBUTOR_LIST, { projectId }),
    invite: (projectId: string, email: string) =>
      window.api.invoke(Channels.CONTRIBUTOR_INVITE, { projectId, email }),
    remove: (projectId: string, userId: string) =>
      window.api.invoke(Channels.CONTRIBUTOR_REMOVE, { projectId, userId })
  },

  artifacts: {
    // Local file operations
    list: (workspaceId: string) =>
      window.api.invoke(Channels.ARTIFACT_LIST, { workspaceId }),
    read: (workspaceId: string, kind: ArtifactKind) =>
      window.api.invoke(Channels.ARTIFACT_READ, { workspaceId, kind }),
    write: (workspaceId: string, kind: ArtifactKind, yamlContent: string) =>
      window.api.invoke(Channels.ARTIFACT_WRITE, { workspaceId, kind, yamlContent }),
    initFolder: (workspaceId: string) =>
      window.api.invoke(Channels.ARTIFACT_FOLDER_INIT, { workspaceId }),

    // Server operations (Shared mode)
    serverList: (workspaceId: string) =>
      window.api.invoke(Channels.ARTIFACT_SERVER_LIST, { workspaceId }),
    serverGet: (workspaceId: string, kind: string) =>
      window.api.invoke(Channels.ARTIFACT_SERVER_GET, { workspaceId, kind }),
    serverSave: (workspaceId: string, kind: string, yamlContent: string, options?: { title?: string; expectedVersion?: number; yjsState?: string }) =>
      window.api.invoke(Channels.ARTIFACT_SERVER_SAVE, { workspaceId, kind, yamlContent, ...options }),
    serverUpdateStatus: (workspaceId: string, kind: string, status: string) =>
      window.api.invoke(Channels.ARTIFACT_SERVER_UPDATE_STATUS, { workspaceId, kind, status }),
    serverSync: (workspaceId: string, kind: string) =>
      window.api.invoke(Channels.ARTIFACT_SERVER_SYNC, { workspaceId, kind }),
    getSyncVersion: (workspaceId: string, kind: string) =>
      window.api.invoke(Channels.ARTIFACT_GET_SYNC_VERSION, { workspaceId, kind }),
    setSyncVersion: (workspaceId: string, kind: string, version: number, yamlContent?: string) =>
      window.api.invoke(Channels.ARTIFACT_SET_SYNC_VERSION, { workspaceId, kind, version, yamlContent }),
    getCollabUrl: (workspaceId: string, kind: string) =>
      window.api.invoke(Channels.ARTIFACT_GET_COLLAB_URL, { workspaceId, kind })
  },

  sessions: {
    list: (workspaceId: string) =>
      window.api.invoke(Channels.SESSION_LIST, { workspaceId }),
    rename: (sessionId: string, agent: string, name: string) =>
      window.api.invoke(Channels.SESSION_RENAME, { sessionId, agent, name }),
  },

  terminal: {
    writeInput: (terminalId: string, data: string) =>
      window.api.invoke(Channels.TERMINAL_WRITE_INPUT, { terminalId, data })
  },

  scratch: {
    getPages: () => window.api.invoke(Channels.SCRATCH_GET_PAGES),
    getPage: (id: string) => window.api.invoke(Channels.SCRATCH_GET_PAGE, { id }),
    createPage: (title?: string) => window.api.invoke(Channels.SCRATCH_CREATE_PAGE, { title }),
    updateContent: (id: string, content: string, textContent: string) =>
      window.api.invoke(Channels.SCRATCH_UPDATE_CONTENT, { id, content, textContent }),
    updateTitle: (id: string, title: string) =>
      window.api.invoke(Channels.SCRATCH_UPDATE_TITLE, { id, title }),
    deletePage: (id: string) => window.api.invoke(Channels.SCRATCH_DELETE_PAGE, { id }),
    reorderPages: (orderedIds: string[]) =>
      window.api.invoke(Channels.SCRATCH_REORDER_PAGES, { orderedIds }),
    search: (query: string) => window.api.invoke(Channels.SCRATCH_SEARCH, { query }),
    launchAgent: (agentId: string, prompt: string, workspaceId: string) =>
      window.api.invoke(Channels.SCRATCH_LAUNCH_AGENT, { agentId, prompt, workspaceId }),
    dictationStart: () => window.api.invoke(Channels.SCRATCH_DICTATION_START),
    dictationStop: (cancel = false) => window.api.invoke(Channels.SCRATCH_DICTATION_STOP, { cancel })
  },

  git: {
    branches: (projectId: string) =>
      window.api.invoke(Channels.GIT_BRANCHES, { projectId }),
    branchesPerRepo: (projectId: string) =>
      window.api.invoke(Channels.GIT_BRANCHES_PER_REPO, { projectId }),
    status: (workspaceId: string) =>
      window.api.invoke(Channels.GIT_STATUS, { workspaceId })
  },

  app: {
    getState: () => window.api.invoke(Channels.APP_STATE_GET),
    setState: (patch: Partial<AppState>) =>
      window.api.invoke(Channels.APP_STATE_SET, patch),
    quit: () => window.api.invoke(Channels.APP_QUIT),
    relaunch: () => window.api.invoke(Channels.APP_RELAUNCH)
  },

  dialog: {
    openFolder: () => window.api.invoke(Channels.DIALOG_OPEN_FOLDER)
  },

  clipboard: {
    copy: (text: string) => window.api.copyToClipboard(text),
  },

  on: <C extends keyof PushMap>(channel: C, listener: (payload: PushMap[C]) => void): (() => void) =>
    window.api.on(channel, listener)
}
