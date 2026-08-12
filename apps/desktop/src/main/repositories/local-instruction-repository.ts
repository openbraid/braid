import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { IInstructionRepository } from './interfaces'

/**
 * Reads the agent instruction text bundled with the app.
 *
 * The file is authored at src/main/services/artifact/agent_instruction.md and
 * copied into the build, so this never touches the network — agent injection is
 * a core local feature and must not depend on a server being reachable.
 */
export class LocalInstructionRepository implements IInstructionRepository {
  private cached: string | null = null

  async getAgentInstructions(): Promise<string> {
    if (this.cached !== null) return this.cached

    // Dev: __dirname is out/main, and electron-vite does not copy the markdown,
    // so fall back to the source tree. Packaged: it sits beside the bundle.
    const candidates = [
      join(__dirname, 'agent_instruction.md'),
      join(app.getAppPath(), 'src/main/services/artifact/agent_instruction.md')
    ]

    for (const path of candidates) {
      try {
        this.cached = readFileSync(path, 'utf-8')
        return this.cached
      } catch {
        // Try the next location.
      }
    }

    throw new Error(
      `Agent instruction file not found. Looked in: ${candidates.join(', ')}. ` +
        'Agent context injection cannot run without it.'
    )
  }
}
