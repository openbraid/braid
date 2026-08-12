import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import simpleGit from 'simple-git'

export async function getRemoteUrl(repoPath: string): Promise<string | null> {
  try {
    const git = simpleGit(repoPath)
    const url = await git.remote(['get-url', 'origin'])
    return url ? url.trim() : null
  } catch {
    return null
  }
}

export async function listBranches(repoPath: string): Promise<string[]> {
  try {
    const git = simpleGit(repoPath)
    const result = await git.branchLocal()
    return result.all
  } catch {
    return []
  }
}

export async function detectRepos(
  folderPath: string
): Promise<Array<{ name: string; path: string; remoteUrl: string }>> {
  const results: Array<{ name: string; path: string; remoteUrl: string }> = []

  // Case A: the folder itself is a git repo
  if (existsSync(join(folderPath, '.git'))) {
    const remoteUrl = await getRemoteUrl(folderPath)
    if (remoteUrl) {
      const name = folderPath.split('/').pop() ?? folderPath
      console.log(`[git] detectRepos Case A: found repo "${name}" remoteUrl=${remoteUrl}`)
      results.push({ name, path: folderPath, remoteUrl })
    } else {
      console.warn(`[git] detectRepos Case A: folder is a git repo but has no remote URL — skipping: ${folderPath}`)
    }
    return results
  }

  // Case B: scan one level deep for subdirectories containing .git
  let entries: string[]
  try {
    entries = readdirSync(folderPath)
  } catch {
    return results
  }

  for (const entry of entries) {
    const fullPath = join(folderPath, entry)
    try {
      if (!statSync(fullPath).isDirectory()) continue
    } catch {
      continue
    }
    if (!existsSync(join(fullPath, '.git'))) continue
    const remoteUrl = await getRemoteUrl(fullPath)
    if (remoteUrl) {
      console.log(`[git] detectRepos Case B: found repo "${entry}" remoteUrl=${remoteUrl}`)
      results.push({ name: entry, path: fullPath, remoteUrl })
    } else {
      console.warn(`[git] detectRepos Case B: "${entry}" is a git repo but has no remote URL — skipping`)
    }
  }

  return results
}

export async function getDefaultBranch(repoPath: string): Promise<string> {
  try {
    const git = simpleGit(repoPath)
    const result = await git.raw(['symbolic-ref', '--short', 'HEAD'])
    const branch = result.trim()
    if (branch) {
      console.log(`[git] getDefaultBranch: ${repoPath} → "${branch}" (from HEAD)`)
      return branch
    }
  } catch {
    // fall through
  }
  const branches = await listBranches(repoPath)
  console.log(`[git] getDefaultBranch: ${repoPath} branches=${JSON.stringify(branches)}`)
  if (branches.includes('main')) return 'main'
  if (branches.includes('master')) return 'master'
  const fallback = branches[0] ?? 'main'
  console.log(`[git] getDefaultBranch: using fallback "${fallback}"`)
  return fallback
}

/**
 * Fetch a specific branch from origin so it's available locally.
 * Non-fatal — silently returns if no remote or fetch fails.
 */
export async function fetchBranch(repoPath: string, branchName: string): Promise<void> {
  try {
    const git = simpleGit(repoPath)
    await git.fetch('origin', branchName)
    console.log(`[git] fetched origin/${branchName} in ${repoPath}`)
  } catch {
    // No remote, no access, or branch doesn't exist on remote — all fine
  }
}

export async function branchExists(repoPath: string, branchName: string): Promise<boolean> {
  try {
    const git = simpleGit(repoPath)
    const result = await git.branchLocal()
    return result.all.includes(branchName)
  } catch {
    return false
  }
}

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 */
export async function listWorktrees(
  repoPath: string
): Promise<Array<{ path: string; branch: string | null; bare: boolean }>> {
  try {
    const git = simpleGit(repoPath)
    const raw = await git.raw(['worktree', 'list', '--porcelain'])
    const entries: Array<{ path: string; branch: string | null; bare: boolean }> = []
    let current: { path: string; branch: string | null; bare: boolean } | null = null

    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current) entries.push(current)
        current = { path: line.slice('worktree '.length), branch: null, bare: false }
      } else if (line === 'bare' && current) {
        current.bare = true
      } else if (line.startsWith('branch ') && current) {
        // branch refs/heads/my-branch → my-branch
        current.branch = line.slice('branch '.length).replace('refs/heads/', '')
      }
    }
    if (current) entries.push(current)
    return entries
  } catch {
    return []
  }
}

/**
 * Check if a .git file (not directory) points back to the given repo's .git/worktrees/ folder.
 * Worktrees have a `.git` *file* containing `gitdir: /path/to/repo/.git/worktrees/<name>`.
 * If it points to our repo, this is a stale leftover from a pruned worktree — safe to remove.
 */
function isStaleWorktreeDir(dotGitPath: string, repoPath: string): boolean {
  try {
    const stat = statSync(dotGitPath)
    // Real .git directory = a full clone, NOT a worktree leftover — don't touch it
    if (stat.isDirectory()) return false

    // .git file — read the gitdir pointer
    const content = readFileSync(dotGitPath, 'utf-8').trim()
    if (!content.startsWith('gitdir:')) return false

    const gitdir = content.slice('gitdir:'.length).trim()
    const repoGitWorktrees = join(repoPath, '.git', 'worktrees')
    return gitdir.startsWith(repoGitWorktrees)
  } catch {
    return false
  }
}

export async function createWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  sourceBranch: string | null
): Promise<void> {
  console.log(`[git] createWorktree: repoPath=${repoPath} worktreePath=${worktreePath} branch=${branchName} sourceBranch=${sourceBranch ?? 'null (use existing)'}`)
  const git = simpleGit(repoPath)
  // Prune stale worktree registrations before adding — prevents "already registered
  // but missing" errors when a worktree folder was deleted outside of Braid.
  await git.raw(['worktree', 'prune']).catch(() => { /* non-fatal */ })

  // Check if a valid worktree already exists at the target path
  if (existsSync(worktreePath)) {
    const worktrees = await listWorktrees(repoPath)
    const existing = worktrees.find((wt) => wt.path === worktreePath)

    if (existing && existing.branch === branchName) {
      console.log(`[git] createWorktree: worktree already exists at ${worktreePath} on branch ${branchName} — reusing`)
      return
    }

    if (existing && existing.branch !== branchName) {
      throw new Error(
        `Worktree path "${worktreePath}" already exists but is on branch "${existing.branch}", expected "${branchName}"`
      )
    }

    // Directory exists but not registered as a worktree.
    // Check if it's a stale worktree leftover (has .git file pointing to parent repo)
    // — if so, safe to auto-clean and recreate.
    const dotGitPath = join(worktreePath, '.git')
    if (existsSync(dotGitPath) && isStaleWorktreeDir(dotGitPath, repoPath)) {
      console.log(`[git] createWorktree: stale worktree directory at ${worktreePath} — removing and recreating`)
      rmSync(worktreePath, { recursive: true, force: true })
    } else {
      throw new Error(
        `Directory "${worktreePath}" already exists but is not a registered git worktree. Remove it manually or choose a different workspace name.`
      )
    }
  }

  // Check if the branch is already checked out in a different worktree
  const worktrees = await listWorktrees(repoPath)
  const branchInUse = worktrees.find((wt) => wt.branch === branchName && wt.path !== worktreePath)
  if (branchInUse) {
    throw new Error(
      `Branch "${branchName}" is already checked out in worktree "${branchInUse.path}". Cannot create another worktree for the same branch.`
    )
  }

  try {
    if (sourceBranch !== null) {
      await git.raw(['worktree', 'add', '-b', branchName, worktreePath, sourceBranch])
    } else {
      await git.raw(['worktree', 'add', worktreePath, branchName])
    }
    console.log(`[git] createWorktree: success`)
  } catch (err) {
    console.error(`[git] createWorktree: FAILED`, err)
    throw err
  }
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  if (!existsSync(worktreePath)) return
  try {
    const git = simpleGit(repoPath)
    await git.raw(['worktree', 'remove', '--force', worktreePath])
  } catch {
    // already gone or unregistered — not an error
  }
}

export async function pruneWorktrees(repoPath: string): Promise<void> {
  try {
    const git = simpleGit(repoPath)
    await git.raw(['worktree', 'prune'])
  } catch {
    // non-fatal
  }
}

export async function pushBranch(repoPath: string, branchName: string): Promise<void> {
  const git = simpleGit(repoPath)
  await git.raw(['push', '-u', 'origin', branchName])
}

/**
 * Sanitize a free-text name into a valid git branch name segment.
 * - lowercase
 * - spaces → hyphens
 * - strip chars that aren't alphanumeric, hyphen, slash, or dot
 * - collapse multiple consecutive hyphens
 * - trim leading/trailing hyphens
 */
export function sanitizeBranchName(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '') // only alphanumeric and hyphens — no slashes or dots
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}
