import type { IInstructionRepository } from './interfaces'
import { apiClient } from '../lib/api-client'

/**
 * Fetches the instruction text from the server, so a team can update the
 * guidance centrally without every member upgrading the desktop app.
 */
export class BackendInstructionRepository implements IInstructionRepository {
  async getAgentInstructions(): Promise<string> {
    const { data } = await apiClient.get<string>('/instructions/agent')
    return data
  }
}
