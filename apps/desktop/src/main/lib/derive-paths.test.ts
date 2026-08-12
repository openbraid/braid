import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ─── Path derivation ─────────────────────────────────────────────────────────
//
// Two things are being protected here.
//
// 1. The legacy `.tracigo` artifact directory. It lives inside the user's git
//    repos and is committed to their branches, so it must stay readable
//    forever — checking out an older branch must not orphan its artifacts.
//    These assertions use REAL directories under a temp dir because the
//    behaviour under test is `existsSync`; a mocked fs would happily agree with
//    a wrong implementation.
//
// 2. Everything derived from homedir(). `homedir` is mocked so a test can never
//    read or write the developer's actual ~/.braid.

const home = vi.hoisted(() => ({ path: '/home-not-set' }))

// The modules import from bare 'os'; Node builtins resolve to the same module
// under either specifier, but both are mocked so neither import style escapes.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => home.path }
})
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => home.path }
})

import {
  APP_DIR,
  ARTIFACT_DIR,
  LEGACY_ARTIFACT_DIR,
  deriveArtifactDir,
  deriveArtifactFilePath,
  deriveRepoArtifactCopyDir,
  deriveRepoBraidDir,
  deriveRepoPath,
  deriveTerminalPortFilePath,
  deriveVscodeDataDir,
  deriveVscodeExtensionsDir,
  deriveVscodeSharedUserDataDir,
  deriveWorkspaceFilePath,
  deriveWorkspaceFolderPath,
  deriveWorktreePath,
  sanitizePathSegment
} from './derive-paths'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'braid-derive-paths-'))
  // A fake home under the temp root, so homedir()-based assertions are real
  // paths that still cannot touch the developer's machine.
  home.path = join(tmpRoot, 'home')
  mkdirSync(home.path, { recursive: true })
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('constants', () => {
  it('uses .braid for both app and artifact dirs and .tracigo as the legacy artifact name', () => {
    expect(APP_DIR).toBe('.braid')
    expect(ARTIFACT_DIR).toBe('.braid')
    expect(LEGACY_ARTIFACT_DIR).toBe('.tracigo')
  })
})

describe('sanitizePathSegment', () => {
  it('strips dot-dot traversal', () => {
    expect(sanitizePathSegment('..')).toBe('')
    expect(sanitizePathSegment('a..b')).toBe('ab')
  })

  it('converts path separators to hyphens so a segment cannot become two', () => {
    expect(sanitizePathSegment('org/repo')).toBe('org-repo')
    expect(sanitizePathSegment('org\\repo')).toBe('org-repo')
  })

  it('strips null bytes and leading dots', () => {
    expect(sanitizePathSegment('re\0po')).toBe('repo')
    expect(sanitizePathSegment('.hidden')).toBe('hidden')
    expect(sanitizePathSegment('...hidden')).toBe('hidden')
  })

  it('leaves an ordinary segment untouched', () => {
    expect(sanitizePathSegment('add-auth')).toBe('add-auth')
  })
})

describe('deriveWorkspaceFolderPath', () => {
  it('is <projectPath>/<sanitizedName>', () => {
    expect(deriveWorkspaceFolderPath('/projects/acme', 'add-auth')).toBe('/projects/acme/add-auth')
  })
})

describe('deriveWorktreePath', () => {
  it('single-repo: the workspace folder IS the worktree', () => {
    expect(deriveWorktreePath('/projects/acme', 'api', 'add-auth', false)).toBe(
      '/projects/acme/add-auth'
    )
  })

  it('multi-repo: nests a repo-named directory under the workspace folder', () => {
    expect(deriveWorktreePath('/projects/acme', 'api', 'add-auth', true)).toBe(
      '/projects/acme/add-auth/api'
    )
  })

  it('sanitizes the repo name so a slashed repo cannot create a nested path', () => {
    expect(deriveWorktreePath('/projects/acme', 'org/api', 'add-auth', true)).toBe(
      '/projects/acme/add-auth/org-api'
    )
  })
})

describe('deriveRepoPath', () => {
  it('is <projectPath>/<repoName>, sanitized', () => {
    expect(deriveRepoPath('/projects/acme', 'api')).toBe('/projects/acme/api')
    // '..' is stripped, then the leftover separator becomes a hyphen.
    expect(deriveRepoPath('/projects/acme', '../escape')).toBe('/projects/acme/-escape')
  })
})

describe('deriveArtifactDir', () => {
  // Layout under test: <projectPath>/<sanitizedName>/ is the workspace folder.
  const name = 'add-auth'
  let projectPath: string
  let base: string

  beforeEach(() => {
    projectPath = join(tmpRoot, 'projects')
    base = join(projectPath, name)
    mkdirSync(base, { recursive: true })
  })

  it('single-repo: namespaces artifacts by workspace name inside .braid', () => {
    expect(deriveArtifactDir(projectPath, name, false)).toBe(join(base, '.braid', name))
  })

  it('multi-repo: puts artifacts at the workspace level, above the repos', () => {
    expect(deriveArtifactDir(projectPath, name, true)).toBe(join(base, '.braid'))
  })

  it('uses .braid when only .braid exists', () => {
    mkdirSync(join(base, '.braid'), { recursive: true })
    expect(deriveArtifactDir(projectPath, name, true)).toBe(join(base, '.braid'))
  })

  it('uses the legacy .tracigo when only .tracigo exists', () => {
    mkdirSync(join(base, '.tracigo'), { recursive: true })
    expect(deriveArtifactDir(projectPath, name, true)).toBe(join(base, '.tracigo'))
  })

  it('prefers .braid when BOTH exist', () => {
    mkdirSync(join(base, '.braid'), { recursive: true })
    mkdirSync(join(base, '.tracigo'), { recursive: true })
    expect(deriveArtifactDir(projectPath, name, true)).toBe(join(base, '.braid'))
  })

  it('returns the current .braid path when NEITHER exists, so it can be created', () => {
    expect(deriveArtifactDir(projectPath, name, true)).toBe(join(base, '.braid'))
  })

  it('single-repo: adopts the legacy dir only when this workspace is namespaced inside it', () => {
    // The check is on <base>/.tracigo/<name>, not merely on <base>/.tracigo —
    // a legacy dir holding only some other workspace must not be adopted.
    mkdirSync(join(base, '.tracigo', 'other-workspace'), { recursive: true })
    expect(deriveArtifactDir(projectPath, name, false)).toBe(join(base, '.braid', name))

    mkdirSync(join(base, '.tracigo', name), { recursive: true })
    expect(deriveArtifactDir(projectPath, name, false)).toBe(join(base, '.tracigo', name))
  })
})

describe('deriveRepoArtifactCopyDir', () => {
  let worktree: string

  beforeEach(() => {
    worktree = join(tmpRoot, 'worktree')
    mkdirSync(worktree, { recursive: true })
  })

  it('is <worktree>/.braid/<sanitizedName> when nothing exists yet', () => {
    expect(deriveRepoArtifactCopyDir(worktree, 'add-auth')).toBe(
      join(worktree, '.braid', 'add-auth')
    )
  })

  it('falls back to the legacy copy dir when only it exists', () => {
    mkdirSync(join(worktree, '.tracigo', 'add-auth'), { recursive: true })
    expect(deriveRepoArtifactCopyDir(worktree, 'add-auth')).toBe(
      join(worktree, '.tracigo', 'add-auth')
    )
  })

  it('prefers .braid when both exist', () => {
    mkdirSync(join(worktree, '.braid', 'add-auth'), { recursive: true })
    mkdirSync(join(worktree, '.tracigo', 'add-auth'), { recursive: true })
    expect(deriveRepoArtifactCopyDir(worktree, 'add-auth')).toBe(
      join(worktree, '.braid', 'add-auth')
    )
  })
})

describe('deriveRepoBraidDir', () => {
  let repoRoot: string

  beforeEach(() => {
    repoRoot = join(tmpRoot, 'repo')
    mkdirSync(repoRoot, { recursive: true })
  })

  it('uses .braid when only .braid exists', () => {
    mkdirSync(join(repoRoot, '.braid'))
    expect(deriveRepoBraidDir(repoRoot)).toBe(join(repoRoot, '.braid'))
  })

  it('uses .tracigo when only .tracigo exists — an older branch keeps working', () => {
    mkdirSync(join(repoRoot, '.tracigo'))
    expect(deriveRepoBraidDir(repoRoot)).toBe(join(repoRoot, '.tracigo'))
  })

  it('prefers .braid when BOTH exist', () => {
    mkdirSync(join(repoRoot, '.braid'))
    mkdirSync(join(repoRoot, '.tracigo'))
    expect(deriveRepoBraidDir(repoRoot)).toBe(join(repoRoot, '.braid'))
  })

  it('returns the current .braid path when NEITHER exists, so new repos adopt it', () => {
    expect(deriveRepoBraidDir(repoRoot)).toBe(join(repoRoot, '.braid'))
  })

  it('re-resolves on every call rather than caching a stale answer', () => {
    expect(deriveRepoBraidDir(repoRoot)).toBe(join(repoRoot, '.braid'))
    mkdirSync(join(repoRoot, '.tracigo'))
    expect(deriveRepoBraidDir(repoRoot)).toBe(join(repoRoot, '.tracigo'))
  })
})

describe('homedir-derived paths', () => {
  it('deriveWorkspaceFilePath names the file after the workspace when given one', () => {
    expect(deriveWorkspaceFilePath('proj-1', 'add-auth')).toBe(
      join(home.path, '.braid', 'workspaces', 'proj-1', 'add-auth.code-workspace')
    )
  })

  it('deriveWorkspaceFilePath falls back to the project id', () => {
    expect(deriveWorkspaceFilePath('proj-1')).toBe(
      join(home.path, '.braid', 'workspaces', 'proj-1', 'proj-1.code-workspace')
    )
  })

  it('deriveVscodeDataDir is per project', () => {
    expect(deriveVscodeDataDir('proj-1')).toBe(join(home.path, '.braid', 'vscode-data', 'proj-1'))
  })

  it('deriveVscodeExtensionsDir is shared across projects', () => {
    expect(deriveVscodeExtensionsDir()).toBe(join(home.path, '.braid', 'vscode-extensions'))
  })

  it('deriveVscodeSharedUserDataDir is shared across projects', () => {
    expect(deriveVscodeSharedUserDataDir()).toBe(join(home.path, '.braid', 'vscode-user-data'))
  })

  it('deriveTerminalPortFilePath is keyed by the vscode port', () => {
    expect(deriveTerminalPortFilePath(41234)).toBe(
      join(home.path, '.braid', 'terminal-ports', '41234.json')
    )
  })

  it('follows homedir if it changes, rather than capturing it at import time', () => {
    home.path = join(tmpRoot, 'other-home')
    expect(deriveVscodeExtensionsDir()).toBe(join(tmpRoot, 'other-home', '.braid', 'vscode-extensions'))
  })
})

describe('deriveArtifactFilePath', () => {
  it('lowercases the kind and appends .yaml', () => {
    expect(deriveArtifactFilePath('/repo/.braid/add-auth', 'Requirements')).toBe(
      '/repo/.braid/add-auth/requirements.yaml'
    )
  })

  it('sanitizes the kind so it cannot escape the artifact dir', () => {
    // Dot-dot pairs are stripped first, then the leftover separators become
    // hyphens — the result is always a single flat filename.
    expect(deriveArtifactFilePath('/repo/.braid', '../../etc/passwd')).toBe(
      '/repo/.braid/--etc-passwd.yaml'
    )
  })
})
