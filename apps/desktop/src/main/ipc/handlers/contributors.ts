import { Capability, Channels } from '../../../shared/ipc-types'
import { handleIpc } from '../handle-ipc'
import { apiClient } from '../../lib/api-client'
import { assertCapability, isCapabilityEnabled } from '../../services/capabilities'
import type { Contributor } from '../../../shared/ipc-types'

// Every handler here talks to a server. assertCapability turns "no server
// configured" into a structured CAPABILITY_UNAVAILABLE error with copy the
// renderer can display, instead of letting axios surface a bare ECONNREFUSED.
//
// Reads degrade to empty rather than throwing: a project simply has no
// contributors when there is no server, and the UI should render that state
// normally instead of an error.

export function registerContributorHandlers(): void {
  handleIpc<{ projectId: string }, Contributor[]>(Channels.CONTRIBUTOR_LIST, async (payload) => {
    if (!isCapabilityEnabled(Capability.Invites)) return []

    const { data } = await apiClient.get<Contributor[]>(
      `/projects/${payload.projectId}/contributors`
    )
    return data
  })

  handleIpc<{ projectId: string; email: string }, Contributor>(
    Channels.CONTRIBUTOR_INVITE,
    async (payload) => {
      assertCapability(Capability.Invites)

      const { data } = await apiClient.post<Contributor>(
        `/projects/${payload.projectId}/contributors`,
        { email: payload.email }
      )
      return data
    }
  )

  handleIpc<{ projectId: string; userId: string }, void>(
    Channels.CONTRIBUTOR_REMOVE,
    async (payload) => {
      assertCapability(Capability.Invites)

      await apiClient.delete(`/projects/${payload.projectId}/contributors/${payload.userId}`)
    }
  )
}
