// ─── artifact-parser tests ───────────────────────────────────────────────────
//
// The parser sits between raw agent-authored YAML on disk and the renderer's
// structured tables. Two things matter for it:
//   1. Nothing an agent can write may throw out of `parseArtifactYaml` — bad
//      syntax has to arrive as an error string.
//   2. Extraction is best-effort: a document with validation errors still
//      yields whatever data was readable, so the editor can show the file.
//
// Fixtures use real block scalars and markdown bodies because that is the
// shape agents emit, and block scalars are exactly where naive YAML handling
// tends to break.

import { describe, it, expect } from 'vitest'
import * as yaml from 'js-yaml'
import {
  parseArtifactYaml,
  reconstructYaml,
  buildStructuredBlocks,
  validateArtifactYaml,
  type ParsedArtifact,
  type ArtifactParseResult
} from './artifact-parser'

type ParsedOk = ParsedArtifact & { errors: string[]; warnings: string[] }

/**
 * Narrow a parse result to the success branch, failing loudly with the actual
 * errors when the parse bailed — otherwise a regression shows up as an opaque
 * "cannot read property of undefined".
 */
function expectParsed(result: ArtifactParseResult): ParsedOk {
  if ('valid' in result) {
    throw new Error(`expected a parsed artifact, got failure: ${result.errors.join(' | ')}`)
  }
  return result
}

const REQUIREMENTS_YAML = `
meta:
  kind: REQUIREMENTS
  title: Braid desktop requirements
context: |
  ## Scope

  Covers the **desktop** client only.

  - Server work is tracked separately
  - See \`.braid/DESIGN.yaml\` for internals
requirements:
  - id: REQ-AUTH-1
    title: Sign in with GitHub
    status: accepted
    priority: high
    tags: [auth, onboarding]
    description: |
      The user clicks *Sign in with GitHub* and lands on the consent screen.

      Acceptance:
      - Token stored in the OS keychain
      - Failures are retryable
  - id: REQ-SYNC-1
    title: Artifacts sync to the server
    status: proposed
    priority: medium
    description: Changes under \`.braid/\` reach the server within 5s.
change_log:
  - added: REQ-SYNC-1
    removed: ""
    why: Sync used to be implicit
    affects: SPEC
`

// ─── Round-trip ──────────────────────────────────────────────────────────────

describe('parseArtifactYaml — round trip', () => {
  it('parses a valid REQUIREMENTS document into the expected shape', () => {
    const result = expectParsed(parseArtifactYaml(REQUIREMENTS_YAML))

    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.meta).toEqual({ kind: 'REQUIREMENTS', title: 'Braid desktop requirements' })

    expect(result.contextBlocks).toHaveLength(1)
    expect(result.contextBlocks[0]).toContain('## Scope')
    expect(result.contextBlocks[0]).toContain('**desktop**')

    expect(result.requirements).toHaveLength(2)
    expect(result.requirements[0].id).toBe('REQ-AUTH-1')
    expect(result.requirements[0].title).toBe('Sign in with GitHub')
    expect(result.requirements[0].status).toBe('accepted')
    expect(result.requirements[0].priority).toBe('high')
    expect(result.requirements[0].tags).toEqual(['auth', 'onboarding'])
    // The block scalar survives intact, newlines and markdown included.
    expect(result.requirements[0].description).toContain('- Token stored in the OS keychain')

    expect(result.changeLog).toHaveLength(1)
    expect(result.changeLog[0].added).toBe('REQ-SYNC-1')
    expect(result.changeLog[0].affects).toBe('SPEC')
  })

  it('parses each kind into its own section', () => {
    const spec = expectParsed(
      parseArtifactYaml(`
meta:
  kind: SPEC
  title: Sign-in spec
task_list:
  - id: TASK-1
    title: Wire the OAuth callback
    status: in_progress
    assignee: pushkar
    related_requirement: REQ-AUTH-1
    description: |
      Register the \`braid://oauth\` protocol handler.
spec_coverage:
  - requirement_id: REQ-AUTH-1
    coverage_status: partial
    gaps: Token refresh is not specced
`)
    )
    expect(spec.taskList).toHaveLength(1)
    expect(spec.taskList[0].assignee).toBe('pushkar')
    expect(spec.specCoverage[0].coverage_status).toBe('partial')

    const plan = expectParsed(
      parseArtifactYaml(`
meta:
  kind: TEST_PLAN
  title: Sign-in test plan
test_cases:
  - id: TC-1
    title: Happy path
    status: passing
test_coverage:
  - requirement_id: REQ-AUTH-1
    covered_by: TC-1
`)
    )
    expect(plan.testCases).toHaveLength(1)
    expect(plan.testCoverage).toHaveLength(1)

    const rca = expectParsed(
      parseArtifactYaml(`
meta:
  kind: RCA
  title: Sync outage
action_items:
  - id: AI-1
    title: Add a retry budget
`)
    )
    expect(rca.actionItems).toHaveLength(1)

    const security = expectParsed(
      parseArtifactYaml(`
meta:
  kind: SECURITY
  title: Auth review
security_checks:
  - id: SEC-1
    title: Tokens never hit disk in plaintext
`)
    )
    expect(security.securityChecks).toHaveLength(1)
  })

  it('survives a full YAML → parse → reconstruct → parse cycle', () => {
    const first = expectParsed(parseArtifactYaml(REQUIREMENTS_YAML))
    const rebuilt = reconstructYaml(
      first.meta,
      first.contextBlocks.join('\n\n'),
      buildStructuredBlocks(first)
    )
    const second = expectParsed(parseArtifactYaml(rebuilt))

    expect(second.meta).toEqual(first.meta)
    expect(second.requirements).toEqual(first.requirements)
    expect(second.changeLog).toEqual(first.changeLog)
    expect(second.errors).toEqual([])
  })
})

// ─── Malformed input ─────────────────────────────────────────────────────────

describe('parseArtifactYaml — malformed input', () => {
  it('surfaces a YAML syntax error instead of throwing', () => {
    // Tabs are illegal for YAML indentation; agents produce this often enough.
    const result = parseArtifactYaml('meta:\n\tkind: REQUIREMENTS\n\ttitle: Broken\n')

    expect(result).toMatchObject({ valid: false })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Invalid YAML syntax')
    expect(result.warnings).toEqual([])
  })

  it('surfaces unbalanced flow syntax as an error', () => {
    const result = parseArtifactYaml('meta: {kind: REQUIREMENTS, title: Broken\n')

    expect(result).toMatchObject({ valid: false })
    expect(result.errors[0]).toContain('Invalid YAML syntax')
  })

  it('surfaces a duplicate top-level key as an error', () => {
    const result = parseArtifactYaml(`
meta:
  kind: REQUIREMENTS
  title: One
meta:
  kind: SPEC
  title: Two
`)

    expect(result).toMatchObject({ valid: false })
    expect(result.errors[0]).toContain('Invalid YAML syntax')
  })

  it.each([
    ['empty string', ''],
    ['whitespace only', '   \n  \n'],
    ['comments only', '# just a note\n'],
    ['a scalar document', 'REQUIREMENTS\n'],
    ['an explicit null', '~\n']
  ])('rejects %s with a pointed message', (_label, source) => {
    const result = parseArtifactYaml(source)

    expect(result).toMatchObject({ valid: false })
    expect(result.errors[0]).toContain('YAML document must be an object')
  })

  it('returns validation errors without data when meta.kind is unusable', () => {
    // Without a kind there is no way to pick a renderer, so extraction is
    // skipped entirely — the caller only gets the diagnostics.
    const result = parseArtifactYaml(`
meta:
  kind: requirements
  title: Lowercase kind
requirements:
  - id: REQ-1
    title: Users can sign in
`)

    expect(result).toMatchObject({ valid: false })
    expect(result.errors.some((e) => e.includes('meta.kind must be uppercase'))).toBe(true)
    expect(result).not.toHaveProperty('requirements')
  })

  it('still extracts data when the document is valid enough to have a kind', () => {
    // Best-effort extraction: the duplicate id is reported, but both rows are
    // still handed to the renderer so the user can see and fix them.
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: REQUIREMENTS
  title: Partly broken
requirements:
  - id: REQ-1
    title: First
  - id: REQ-1
    title: Duplicate
  - just a string, not a mapping
`)
    )

    expect(result.errors.length).toBeGreaterThan(0)
    // The non-object item is dropped; the two mappings survive.
    expect(result.requirements).toHaveLength(2)
  })
})

// ─── Empty and missing sections ──────────────────────────────────────────────

describe('parseArtifactYaml — absent sections', () => {
  it('yields empty arrays, never undefined, for every unlisted section', () => {
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: DESIGN
  title: Bare minimum
`)
    )

    expect(result.contextBlocks).toEqual([])
    expect(result.requirements).toEqual([])
    expect(result.taskList).toEqual([])
    expect(result.specCoverage).toEqual([])
    expect(result.changeLog).toEqual([])
    expect(result.testCases).toEqual([])
    expect(result.securityChecks).toEqual([])
    expect(result.actionItems).toEqual([])
    expect(result.testCoverage).toEqual([])
  })

  it('treats a null section the same as an absent one', () => {
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: REQUIREMENTS
  title: Scaffolded by an agent
context:
requirements:
change_log:
`)
    )

    expect(result.contextBlocks).toEqual([])
    expect(result.requirements).toEqual([])
    expect(result.changeLog).toEqual([])
  })

  it('keeps a multi-block context list as separate strings', () => {
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: DESIGN
  title: Multi-block context
context:
  - |
    ## First block

    Prose.
  - |
    ## Second block

    More prose.
`)
    )

    expect(result.contextBlocks).toHaveLength(2)
    expect(result.contextBlocks[0]).toContain('## First block')
    expect(result.contextBlocks[1]).toContain('## Second block')
  })

  it('drops non-string entries from a context list rather than stringifying them', () => {
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: DESIGN
  title: Mixed context
context:
  - "Real prose"
  - 42
`)
    )

    expect(result.contextBlocks).toEqual(['Real prose'])
  })
})

// ─── Item field handling ─────────────────────────────────────────────────────

describe('parseArtifactYaml — item fields', () => {
  it('backfills id and title so tables never render undefined', () => {
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: REQUIREMENTS
  title: Missing fields
requirements:
  - status: proposed
`)
    )

    expect(result.requirements[0].id).toBe('')
    expect(result.requirements[0].title).toBe('')
  })

  it('leaves other optional fields absent rather than defaulting them', () => {
    // NOTE: only id and title are backfilled. description / status / priority
    // are simply missing from the object, so consumers must tolerate undefined.
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: REQUIREMENTS
  title: Missing fields
requirements:
  - id: REQ-1
    title: Sparse requirement
`)
    )

    expect(result.requirements[0]).toEqual({ id: 'REQ-1', title: 'Sparse requirement' })
    expect('description' in result.requirements[0]).toBe(false)
  })

  it('normalizes an explicitly null field to an empty string', () => {
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: REQUIREMENTS
  title: Null fields
requirements:
  - id: REQ-1
    title: Has nulls
    description:
    priority:
`)
    )

    expect(result.requirements[0].description).toBe('')
    expect(result.requirements[0].priority).toBe('')
  })

  it('stringifies scalars so the table renders uniform text', () => {
    // YAML types leak otherwise: `priority: 1` would arrive as a number and
    // `status: true` as a boolean.
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: REQUIREMENTS
  title: Scalar coercion
requirements:
  - id: 42
    title: Numeric id
    priority: 1
    status: true
`)
    )

    expect(result.requirements[0].id).toBe('42')
    expect(result.requirements[0].priority).toBe('1')
    expect(result.requirements[0].status).toBe('true')
  })

  it('preserves list fields as arrays of strings', () => {
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: REQUIREMENTS
  title: Tags
requirements:
  - id: REQ-1
    title: Tagged
    tags: [auth, 2, onboarding]
`)
    )

    expect(result.requirements[0].tags).toEqual(['auth', '2', 'onboarding'])
  })

  it('preserves unknown item fields so dynamic columns keep working', () => {
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: REQUIREMENTS
  title: Extra columns
requirements:
  - id: REQ-1
    title: Extra fields
    owner: pushkar
    due: 2026-08-01
`)
    )

    const item = result.requirements[0] as unknown as Record<string, unknown>
    expect(item.owner).toBe('pushkar')
    // An unquoted YAML date parses to a Date. It is left alone rather than
    // stringified — String(date) would write JS's "Sat Aug 01 2026 …" form back
    // into the user's file, which is neither valid YAML date syntax nor what
    // they typed.
    expect(item.due).toBeInstanceOf(Date)
  })

  it('preserves a nested mapping instead of flattening it', () => {
    // Regression: extraction used to String() every non-array value, so a
    // nested block became the literal "[object Object]" — and because the
    // result is serialised straight back to disk, the user's data was
    // destroyed on the next save.
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: REQUIREMENTS
  title: Nested field
requirements:
  - id: REQ-1
    title: Nested
    acceptance:
      given: signed out
      then: sees the sign-in button
`)
    )

    const item = result.requirements[0] as unknown as Record<string, unknown>
    expect(item.acceptance).toEqual({
      given: 'signed out',
      then: 'sees the sign-in button'
    })
  })

  it('survives a full parse -> reconstruct cycle without altering nested data', () => {
    const source = `meta:
  kind: REQUIREMENTS
  title: Round trip
context: |
  Some context.
requirements:
  - id: REQ-1
    title: Nested
    acceptance:
      given: signed out
      then: sees the sign-in button
change_log:
  - added: Retry logic
    why: Flaky network
`
    const parsed = expectParsed(parseArtifactYaml(source))
    const rebuilt = reconstructYaml(
      parsed.meta,
      parsed.contextBlocks.join('\n\n'),
      buildStructuredBlocks(parsed)
    )

    // The nested block must still be a block, not a stringified object, and the
    // changelog entry must not have grown empty id/title keys.
    expect(rebuilt).toContain('given: signed out')
    expect(rebuilt).not.toContain('[object Object]')
    expect(rebuilt).not.toContain('id: ""')
    expect(rebuilt).not.toContain("title: ''")

    // Re-parsing the rebuilt document yields the same data — the cycle is
    // stable, so repeated saves cannot drift.
    const reparsed = expectParsed(parseArtifactYaml(rebuilt))
    expect(reparsed.requirements).toEqual(parsed.requirements)
    expect(reparsed.changeLog).toEqual(parsed.changeLog)
  })
})

// ─── change_log extraction ───────────────────────────────────────────────────

describe('change_log extraction', () => {
  it('extracts every entry with its fields', () => {
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: RELEASE_NOTES
  title: v0.4.0
change_log:
  - added: GitHub sign-in
    removed: Manual token paste
    why: |
      Onboarding friction — users had to *create a PAT* by hand.
    affects: REQUIREMENTS
  - added: ""
    removed: The legacy poller
    why: Replaced by the file watcher
`)
    )

    expect(result.changeLog).toHaveLength(2)
    expect(result.changeLog[0].added).toBe('GitHub sign-in')
    expect(result.changeLog[0].why).toContain('*create a PAT*')
    expect(result.changeLog[1].added).toBe('')
    expect(result.changeLog[1].affects).toBeUndefined()
  })

  it('does not invent id and title on change_log entries', () => {
    // Regression: the generic extractor used to backfill id/title on every
    // array section. Changelog entries have neither, so every save appended
    // two empty keys to the user's file.
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: DESIGN
  title: Fixture
change_log:
  - added: Retry logic
    why: Flaky network
`)
    )

    const entry = result.changeLog[0] as unknown as Record<string, unknown>
    expect(entry).toEqual({ added: 'Retry logic', why: 'Flaky network' })
  })

  it('skips non-object entries instead of throwing', () => {
    const result = expectParsed(
      parseArtifactYaml(`
meta:
  kind: DESIGN
  title: Fixture
change_log:
  - "Removed the old poller"
  -
  - added: Retry logic
    why: Flaky network
`)
    )

    expect(result.changeLog).toHaveLength(1)
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })
})

// ─── structuredBlocks / snake_case keys ──────────────────────────────────────

describe('buildStructuredBlocks', () => {
  it('maps camelCase fields onto snake_case YAML keys', () => {
    const artifact: ParsedArtifact = {
      meta: { kind: 'SPEC', title: 'Fixture' },
      contextBlocks: [],
      requirements: [],
      taskList: [{ id: 'TASK-1', title: 'Ship it', status: 'todo', description: '' }],
      specCoverage: [{ requirement_id: 'REQ-1', coverage_status: 'covered', gaps: '' }],
      changeLog: [{ added: 'x', removed: '', why: 'because' }],
      testCases: [],
      securityChecks: [],
      actionItems: [],
      testCoverage: []
    }

    const blocks = buildStructuredBlocks(artifact)

    expect(Object.keys(blocks).sort()).toEqual(['change_log', 'spec_coverage', 'task_list'])
  })

  it('omits empty sections so reconstructed YAML stays clean', () => {
    const empty = expectParsed(parseArtifactYaml('meta:\n  kind: DESIGN\n  title: Bare\n'))

    expect(buildStructuredBlocks(empty)).toEqual({})
  })

  it('lets an override replace a section by its snake_case key', () => {
    const parsed = expectParsed(parseArtifactYaml(REQUIREMENTS_YAML))
    const blocks = buildStructuredBlocks(parsed, {
      requirements: [{ id: 'REQ-NEW', title: 'Replaced' }]
    })

    expect(blocks.requirements).toEqual([{ id: 'REQ-NEW', title: 'Replaced' }])
    // Untouched sections come from the artifact.
    expect(blocks.change_log).toHaveLength(1)
  })

  it('lets an empty override drop a section entirely', () => {
    const parsed = expectParsed(parseArtifactYaml(REQUIREMENTS_YAML))
    const blocks = buildStructuredBlocks(parsed, { requirements: [] })

    expect(blocks.requirements).toBeUndefined()
  })
})

describe('reconstructYaml', () => {
  it('emits meta, context, and snake_case sections in order', () => {
    const out = reconstructYaml(
      { kind: 'SPEC', title: 'Sign-in spec' },
      '## Plan\n\nImplement REQ-AUTH-1.\n',
      { task_list: [{ id: 'TASK-1', title: 'Wire the callback', status: 'todo' }] }
    )
    const round = yaml.load(out) as Record<string, unknown>

    expect(round.meta).toEqual({ kind: 'SPEC', title: 'Sign-in spec' })
    expect(round.context).toContain('## Plan')
    expect(round.task_list).toEqual([{ id: 'TASK-1', title: 'Wire the callback', status: 'todo' }])
    // sortKeys is off, so meta leads the file — agents diff these by hand.
    expect(Object.keys(round)).toEqual(['meta', 'context', 'task_list'])
  })

  it('drops a blank context and empty sections', () => {
    const out = reconstructYaml({ kind: 'DESIGN', title: 'Bare' }, '   \n', { task_list: [] })
    const round = yaml.load(out) as Record<string, unknown>

    expect(Object.keys(round)).toEqual(['meta'])
  })

  it('drops empty arrays but keeps empty strings on an item', () => {
    const out = reconstructYaml({ kind: 'REQUIREMENTS', title: 'Fixture' }, '', {
      requirements: [{ id: 'REQ-1', title: 'Kept', tags: [], description: '' }]
    })
    const round = yaml.load(out) as Record<string, unknown>

    expect(round.requirements).toEqual([{ id: 'REQ-1', title: 'Kept', description: '' }])
  })

  it('produces output that parses back cleanly', () => {
    const out = reconstructYaml({ kind: 'REQUIREMENTS', title: 'Fixture' }, '## Scope\n', {
      requirements: [{ id: 'REQ-1', title: 'Round trips', description: 'Line one\nLine two\n' }]
    })

    const result = expectParsed(parseArtifactYaml(out))
    expect(result.errors).toEqual([])
    expect(result.requirements[0].description).toBe('Line one\nLine two\n')
  })
})

// ─── validateArtifactYaml ────────────────────────────────────────────────────

describe('validateArtifactYaml', () => {
  it('reports valid for a clean document', () => {
    expect(validateArtifactYaml(REQUIREMENTS_YAML)).toEqual({
      valid: true,
      errors: [],
      warnings: []
    })
  })

  it('reports invalid but still valid:true-free for warnings only', () => {
    // Warnings never block a save — only errors do.
    const result = validateArtifactYaml(`
meta:
  kind: DESIGN
  title: Fixture
notes: leftover
`)

    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(1)
  })

  it('reports invalid for a document with errors', () => {
    const result = validateArtifactYaml(`
meta:
  kind: REQUIREMENTS
  title: Fixture
requirements:
  - title: No id
`)

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('reports invalid for unparseable YAML', () => {
    const result = validateArtifactYaml('meta:\n\tkind: X\n')

    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Invalid YAML syntax')
  })
})
