// ─── Workspace Context Injection ─────────────────────────────────────────────
// Generates workspace.local.md and agent instruction files when a workspace
// is opened. Called from ensureWorkspaceReady() Step 6.
//
// Key principle: every location where an agent might run must have
// .braid/workspace.local.md so the agent can discover artifact paths.
// Additionally, workspace.local.md is dropped into each agent's rules
// directory so agents auto-read it at session start without any hop.

import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'fs'
import { getAgentById } from '../agents/registry'
import { deriveRepoBraidDir } from '../../lib/derive-paths'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkspaceConfig {
  workspaceId: string
  workspaceName: string
  sanitizedName: string
  projectName: string
  artifactDir: string       // absolute path to where YAML artifacts live
  isMultiRepo: boolean
  repos: Array<{ name: string; path: string }>
}

// ─── Workspace metadata file name ───────────────────────────────────────────

const WORKSPACE_LOCAL_FILE = 'workspace.local.md'

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Write workspace.local.md into:
 * 1. The primary .braid/ root
 * 2. Each repo's .braid/ (multi-repo only)
 * 3. Each agent's rules directory (so agents auto-read it at session start)
 *
 * Also updates .gitignore in every repo to exclude workspace.local.md.
 */
export function injectWorkspaceConfig(
  braidRoot: string,
  repoRoots: string[],
  isMultiRepo: boolean,
  selectedAgents: string[],
  config: WorkspaceConfig,
): void {
  const content = buildWorkspaceLocalContent(config)

  // Write to primary .braid/ root
  writeToDir(braidRoot, content)

  if (isMultiRepo) {
    for (const repoRoot of repoRoots) {
      // Write into each repo's .braid/
      writeToDir(deriveRepoBraidDir(repoRoot), content)
      ensureGitignoreEntry(repoRoot, '.braid/' + WORKSPACE_LOCAL_FILE)
    }
  } else {
    if (repoRoots[0]) {
      ensureGitignoreEntry(repoRoots[0], '.braid/' + WORKSPACE_LOCAL_FILE)
    }
  }

  // Drop into each agent's rules directory so it's auto-loaded at session start.
  // Agents that use rules directories (Claude, Copilot, Cursor, Cline, Kiro)
  // will auto-read this without needing the instruction file to tell them.
  for (const repoRoot of repoRoots) {
    for (const agentId of selectedAgents) {
      const targetDir = getAgentRulesDir(agentId, repoRoot)
      if (targetDir) {
        writeToDir(targetDir, content)
        // Gitignore the workspace metadata in agent rules dirs too
        ensureGitignoreEntry(repoRoot, targetDir.replace(repoRoot + '/', '') + '/' + WORKSPACE_LOCAL_FILE)
      }
    }
  }
}

/**
 * Write agent-specific instruction files. Each agent's writeInstruction()
 * handles its own format. For path-referencing agents (Gemini, Qwen, Aider,
 * OpenCode), also adds workspace.local.md to their read/import list.
 */
export async function injectAgentInstructions(
  braidRoot: string,
  repoRoots: string[],
  isMultiRepo: boolean,
  selectedAgents: string[],
  instructionContent: string,
): Promise<void> {
  for (const agentId of selectedAgents) {
    const agent = getAgentById(agentId)
    if (!agent) continue

    for (const repoRoot of repoRoots) {
      const localBraidDir = isMultiRepo ? deriveRepoBraidDir(repoRoot) : braidRoot
      try {
        await agent.writeInstruction(repoRoot, instructionContent, localBraidDir)
      } catch (err) {
        console.error(`[inject-context] Failed to write instruction for ${agentId} at ${repoRoot}:`, err)
      }
    }
  }
}

// ─── Agent rules directories ────────────────────────────────────────────────
// Returns the rules directory path for agents that auto-load files from it.
// Returns null for agents that don't have a rules directory.

function getAgentRulesDir(agentId: string, repoRoot: string): string | null {
  switch (agentId) {
    case 'claude':  return join(repoRoot, '.claude', 'rules')
    case 'copilot': return join(repoRoot, '.github', 'instructions')
    case 'cursor':  return join(repoRoot, '.cursor', 'rules')
    case 'cline':   return join(repoRoot, '.clinerules')
    case 'kiro':    return join(repoRoot, '.kiro', 'steering')
    default:        return null
  }
}

// ─── Internal ───────────────────────────────────────────────────────────────

function buildWorkspaceLocalContent(config: WorkspaceConfig): string {
  const repoLines = config.repos
    .map((r) => `  - **${r.name}**: \`${r.path}\``)
    .join('\n')

  return `# Braid Workspace

- **Workspace**: ${config.workspaceName}
- **Workspace ID**: ${config.workspaceId}
- **Project**: ${config.projectName}
- **Artifact directory**: \`${config.artifactDir}\`
- **Multi-repo**: ${config.isMultiRepo ? 'yes' : 'no'}
- **Repos**:
${repoLines}
`
}

function writeToDir(dir: string, content: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(join(dir, WORKSPACE_LOCAL_FILE), content, 'utf-8')
}

function ensureGitignoreEntry(dir: string, entry: string): void {
  const gitignorePath = join(dir, '.gitignore')

  if (existsSync(gitignorePath)) {
    const existing = readFileSync(gitignorePath, 'utf-8')
    if (existing.split('\n').some((line) => line.trim() === entry)) return
    appendFileSync(gitignorePath, `\n${entry}\n`, 'utf-8')
  } else {
    writeFileSync(gitignorePath, `${entry}\n`, 'utf-8')
  }
}
