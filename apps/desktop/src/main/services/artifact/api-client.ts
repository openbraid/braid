// ─── Artifact API client ─────────────────────────────────────────────────────
// Calls core-api artifact endpoints. Uses the shared apiClient (auto-attaches JWT).

import { apiClient } from '../../lib/api-client'

// ─── Response types (match core-api DTOs) ────────────────────────────────────

export type ApiArtifactListItem = {
  kind: string
  title: string
  status: string
  version: number
  lastEditedBy: string | null
  updatedAt: string
}

export type ApiArtifact = {
  kind: string
  title: string
  status: string
  version: number
  yamlContent: string
  lastEditedBy: string | null
  createdAt: string
  updatedAt: string
}

// ─── API calls ───────────────────────────────────────────────────────────────

export async function listArtifactsFromServer(
  workspaceId: string
): Promise<ApiArtifactListItem[]> {
  const { data } = await apiClient.get<ApiArtifactListItem[]>(
    `/workspaces/${workspaceId}/artifacts`
  )
  return data
}

export async function getArtifactFromServer(
  workspaceId: string,
  kind: string
): Promise<ApiArtifact> {
  const { data } = await apiClient.get<ApiArtifact>(
    `/workspaces/${workspaceId}/artifacts/${kind}`
  )
  return data
}

export async function saveArtifactToServer(
  workspaceId: string,
  kind: string,
  yamlContent: string,
  options?: { title?: string; expectedVersion?: number; yjsState?: string }
): Promise<ApiArtifact> {
  const { data } = await apiClient.put<ApiArtifact>(
    `/workspaces/${workspaceId}/artifacts/${kind}`,
    {
      yamlContent,
      title: options?.title,
      expectedVersion: options?.expectedVersion,
      yjsState: options?.yjsState,
    }
  )
  return data
}

export async function updateArtifactStatusOnServer(
  workspaceId: string,
  kind: string,
  status: string
): Promise<ApiArtifact> {
  const { data } = await apiClient.patch<ApiArtifact>(
    `/workspaces/${workspaceId}/artifacts/${kind}/status`,
    { status }
  )
  return data
}

export async function deleteArtifactFromServer(
  workspaceId: string,
  kind: string
): Promise<void> {
  await apiClient.delete(`/workspaces/${workspaceId}/artifacts/${kind}`)
}
