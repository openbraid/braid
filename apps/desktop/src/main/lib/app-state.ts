import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppState } from '../../shared/ipc-types'
import { ensureAppDir } from './migrate-app-dir'

export type { AppState }

const DEFAULT_STATE: AppState = {
  lastActiveWorkspaceId: null,
  lastActiveView: 'home',
  lastActiveProjectId: null,
  leftPanelCollapsed: false,
  collapsedProjectIds: [],
  openWorkspaceIds: [],
  themeKind: 'dark',
  dismissedArtifactIntro: false,
  dismissedFirstWorkspaceNudge: false,
  defaultAgent: null,
  scratchPanelOpen: false,
  scratchPanelWidth: 520,
  scratchActivePageId: null,
  scratchOpenPageIds: []
}

function getStatePath(): string {
  const dir = ensureAppDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, 'app-state.json')
}

export function getAppState(): AppState {
  const filePath = getStatePath()
  if (!existsSync(filePath)) {
    return { ...DEFAULT_STATE }
  }
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppState>
    return { ...DEFAULT_STATE, ...parsed }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function setAppState(patch: Partial<AppState>): void {
  const current = getAppState()
  const next: AppState = { ...current, ...patch }
  writeFileSync(getStatePath(), JSON.stringify(next, null, 2), 'utf-8')
}
