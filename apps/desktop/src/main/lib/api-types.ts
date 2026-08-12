// ─── API Response Types ──────────────────────────────────────────────────────
//
// These mirror the response DTOs from core-api. When the backend adds or
// changes a field, update these types and the compiler will flag every
// consumer that needs updating.
//
// Single source of truth for the API contract on the Electron side.

export interface ApiRepo {
  id: string
  name: string
  remoteUrl: string
}

export interface ApiProject {
  id: string
  name: string
  createdBy: string
  createdAt: string
  updatedAt: string
  repos: ApiRepo[]
}

export interface ApiWorkspaceRepo extends ApiRepo {
  sourceBranch?: string
}

export interface ApiWorkspace {
  id: string
  projectId: string
  name: string
  sanitizedName: string
  branchName: string
  sourceBranch: string
  createdBy: string
  ownerName: string
  ownerEmail: string | null
  createdAt: string
  updatedAt: string
  lifecycleStatus: string
  lifecycleStatusChangedByFirstName: string | null
  lifecycleStatusChangedByLastName: string | null
  lifecycleStatusChangedAt: string | null
  repos: ApiWorkspaceRepo[]
}

export interface ApiContributor {
  userId: string
  email: string
  name: string | null
  picture: string | null
  role: 'owner' | 'contributor'
  addedAt: string
}
