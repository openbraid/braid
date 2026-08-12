// ─── Active repository instances ──────────────────────────────────────────────
//
// THIS IS THE ONLY FILE that binds services to a storage backend.
// All services depend on interfaces, not implementations.
//
//   local mode → SQLite is the source of truth. No network, no account.
//   team mode  → core-api is the source of truth for cloud entities; the
//                local layer (paths, status, pins) still comes from SQLite.
//
// Mode is resolved once at module load. Switching requires an app restart.

import { isLocalMode } from '../lib/app-mode'

import { LocalProjectRepository } from './local-project-repository'
import { LocalWorkspaceRepository } from './local-workspace-repository'
import { LocalWorkspaceRepoRepository } from './local-workspace-repo-repository'
import { LocalRepositoryRepository } from './local-repository-repository'
import { LocalInstructionRepository } from './local-instruction-repository'

import { BackendProjectRepository } from './backend-project-repository'
import { BackendWorkspaceRepository } from './backend-workspace-repository'
import { BackendWorkspaceRepoRepository } from './backend-workspace-repo-repository'
import { BackendRepositoryRepository } from './backend-repository-repository'
import { BackendInstructionRepository } from './backend-instruction-repository'

export type {
  IProjectRepository,
  IWorkspaceRepository,
  IWorkspaceRepoRepository,
  IRepositoryRepository,
  IInstructionRepository
} from './interfaces'

const local = isLocalMode()

export const projectRepo = local ? new LocalProjectRepository() : new BackendProjectRepository()
export const workspaceRepo = local
  ? new LocalWorkspaceRepository()
  : new BackendWorkspaceRepository()
export const workspaceRepoRepo = local
  ? new LocalWorkspaceRepoRepository()
  : new BackendWorkspaceRepoRepository()
export const repositoryRepo = local
  ? new LocalRepositoryRepository()
  : new BackendRepositoryRepository()
export const instructionRepo = local
  ? new LocalInstructionRepository()
  : new BackendInstructionRepository()
