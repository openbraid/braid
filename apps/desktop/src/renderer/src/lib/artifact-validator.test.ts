// ─── artifact-validator tests ────────────────────────────────────────────────
//
// Agents write these YAML files, not humans, so malformed input is the normal
// case rather than the exception. These tests pin the two properties that make
// the validator useful in that setting:
//   1. It never throws — every shape of garbage comes back as a string message.
//   2. It reports *everything* wrong in one pass, so an agent can fix a file in
//      a single edit instead of round-tripping once per problem.
//
// Fixtures are written as real YAML and parsed with js-yaml rather than being
// hand-built object literals: the validator's contract is "whatever js-yaml
// produced from a file on disk", and block scalars / markdown bodies are what
// agents actually emit.

import { describe, it, expect } from 'vitest'
import * as yaml from 'js-yaml'
import { validateArtifact } from './artifact-validator'

/** Parse a YAML fixture into the shape validateArtifact expects. */
function doc(source: string): Record<string, unknown> {
  return yaml.load(source) as Record<string, unknown>
}

/** True when at least one message mentions every one of `fragments`. */
function hasMessage(messages: string[], ...fragments: string[]): boolean {
  return messages.some((m) => fragments.every((f) => m.includes(f)))
}

// ─── Meta ────────────────────────────────────────────────────────────────────

describe('meta', () => {
  it('errors when the meta block is absent entirely', () => {
    const { errors } = validateArtifact(doc(`
context: |
  Some prose with no meta block at all.
`))

    expect(hasMessage(errors, 'Missing "meta" block')).toBe(true)
  })

  it('errors when meta is present but not an object', () => {
    // An agent writing `meta: REQUIREMENTS` instead of a nested block is a
    // common shape; it must not be treated as a valid meta.
    const { errors } = validateArtifact(doc(`meta: REQUIREMENTS`))

    expect(hasMessage(errors, 'Missing "meta" block')).toBe(true)
  })

  it.each([
    ['lowercase', 'requirements'],
    ['leading digit', '1REQUIREMENTS'],
    ['hyphenated', 'TEST-PLAN'],
    ['spaced', 'TEST PLAN'],
    ['empty', '""']
  ])('errors when meta.kind is %s', (_label, kind) => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: ${kind}
  title: Something
`))

    expect(hasMessage(errors, 'meta.kind must be uppercase')).toBe(true)
  })

  it('accepts kinds with digits and underscores', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: TEST_PLAN_V2
  title: Release 2 test plan
`))

    expect(errors).toEqual([])
  })

  it('errors when meta.kind is non-string even if it looks uppercase', () => {
    // YAML `kind: [REQUIREMENTS]` parses to an array — the typeof guard catches it.
    const { errors } = validateArtifact(doc(`
meta:
  kind: [REQUIREMENTS]
  title: Something
`))

    expect(hasMessage(errors, 'meta.kind must be uppercase')).toBe(true)
  })

  it('errors when meta.kind exceeds the 50 character cap', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: ${'A'.repeat(51)}
  title: Something
`))

    expect(hasMessage(errors, 'meta.kind is too long')).toBe(true)
  })

  it.each([
    ['missing', 'meta:\n  kind: DESIGN\n'],
    ['empty string', 'meta:\n  kind: DESIGN\n  title: ""\n'],
    ['whitespace only', 'meta:\n  kind: DESIGN\n  title: "   "\n']
  ])('errors when meta.title is %s', (_label, source) => {
    const { errors } = validateArtifact(doc(source))

    expect(hasMessage(errors, 'meta.title is required')).toBe(true)
  })
})

// ─── Context ─────────────────────────────────────────────────────────────────

describe('context', () => {
  it('accepts a markdown block scalar', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: DESIGN
  title: Sync engine design
context: |
  ## Overview

  The sync engine reconciles \`.braid/\` YAML with the server.

  - Writes are debounced
  - Conflicts resolve **last-writer-wins**
`))

    expect(errors).toEqual([])
  })

  it('accepts a list of string blocks and reports the bad index only', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: DESIGN
  title: Sync engine design
context:
  - "First block"
  - 42
  - "Third block"
`))

    expect(errors).toEqual(['context[1] must be a string, not number'])
  })

  it('errors when context is a mapping rather than text', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: DESIGN
  title: Sync engine design
context:
  overview: text
`))

    expect(hasMessage(errors, 'context must be a text block')).toBe(true)
  })

  it('treats an omitted or null context as fine — it is optional', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: DESIGN
  title: Sync engine design
context:
`))

    expect(errors).toEqual([])
  })
})

// ─── Array sections ──────────────────────────────────────────────────────────

describe('array sections', () => {
  // Each restricted section is paired with a kind that permits it, so the only
  // error produced is the "must be a list" one under test.
  it.each([
    ['requirements', 'REQUIREMENTS'],
    ['task_list', 'SPEC'],
    ['spec_coverage', 'SPEC'],
    ['test_cases', 'TEST_PLAN'],
    ['test_coverage', 'TEST_PLAN'],
    ['security_checks', 'SECURITY'],
    ['action_items', 'RCA'],
    ['change_log', 'DESIGN']
  ])('errors naming %s when it is a mapping instead of a list', (section, kind) => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: ${kind}
  title: Fixture
${section}:
  first:
    id: X-1
`))

    expect(errors).toContain(`${section} must be a list, not object`)
  })

  it('errors naming the section when it is a bare string', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: REQUIREMENTS
  title: Fixture
requirements: "REQ-1, REQ-2"
`))

    expect(errors).toContain('requirements must be a list, not string')
  })

  it('stops after the shape error — it does not also report per-item problems', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: REQUIREMENTS
  title: Fixture
requirements: "REQ-1"
`))

    expect(errors).toEqual(['requirements must be a list, not string'])
  })
})

// ─── Item arrays ─────────────────────────────────────────────────────────────

describe('item arrays', () => {
  it('errors when an item is missing an id', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: REQUIREMENTS
  title: Fixture
requirements:
  - id: REQ-1
    title: Users can sign in
  - title: Users can sign out
`))

    expect(hasMessage(errors, 'requirements[1] is missing an id')).toBe(true)
  })

  it('treats a blank id as missing', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: REQUIREMENTS
  title: Fixture
requirements:
  - id: "   "
    title: Users can sign in
`))

    expect(hasMessage(errors, 'requirements[0] is missing an id')).toBe(true)
  })

  it('skips the rest of an item once its id is missing', () => {
    // A missing id short-circuits the loop, so the absent title is NOT reported.
    // Documented here because it looks like an oversight but is deliberate:
    // without an id there is no stable label to attach further errors to.
    const { errors } = validateArtifact(doc(`
meta:
  kind: REQUIREMENTS
  title: Fixture
requirements:
  - description: no id, no title
`))

    expect(errors).toEqual([
      'requirements[0] is missing an id — every requirement must have a unique id'
    ])
  })

  it('names both indices when two items share an id', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: REQUIREMENTS
  title: Fixture
requirements:
  - id: REQ-1
    title: Users can sign in
  - id: REQ-2
    title: Users can sign out
  - id: REQ-1
    title: Duplicated by a careless agent
`))

    const duplicate = errors.find((e) => e.includes('both have id'))
    expect(duplicate).toBeDefined()
    expect(duplicate).toContain('requirements[2]')
    expect(duplicate).toContain('requirements[0]')
    expect(duplicate).toContain('"REQ-1"')
  })

  it('errors on an id containing ":"', () => {
    // ":" is reserved as a separator in comment anchors, so it cannot appear
    // inside an id without breaking anchor round-trips.
    const { errors } = validateArtifact(doc(`
meta:
  kind: REQUIREMENTS
  title: Fixture
requirements:
  - id: "REQ:1"
    title: Users can sign in
`))

    expect(hasMessage(errors, 'Requirement "REQ:1"', 'containing ":"')).toBe(true)
  })

  it('errors when an item is not an object', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: REQUIREMENTS
  title: Fixture
requirements:
  - REQ-1 users can sign in
  - id: REQ-2
    title: Users can sign out
`))

    expect(errors).toContain('requirements[0] must be an object, not string')
  })

  it('errors when an item is missing a title', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: REQUIREMENTS
  title: Fixture
requirements:
  - id: REQ-1
    description: |
      ### Sign in

      The user supplies **email** and password.
`))

    expect(errors).toContain('Requirement "REQ-1" is missing a title')
  })

  it('uses the per-section item label in messages', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: TEST_PLAN
  title: Fixture
test_cases:
  - id: TC-1
`))

    expect(errors).toContain('Test case "TC-1" is missing a title')
  })

  it('accepts a numeric id, coercing it for the uniqueness check', () => {
    // YAML turns unquoted `id: 1` into a number. The validator stringifies, so
    // the numeric 1 and the string "1" collide as duplicates.
    const { errors } = validateArtifact(doc(`
meta:
  kind: REQUIREMENTS
  title: Fixture
requirements:
  - id: 1
    title: First
  - id: "1"
    title: Also first
`))

    expect(hasMessage(errors, 'both have id "1"')).toBe(true)
  })
})

// ─── Unknown top-level keys ──────────────────────────────────────────────────

describe('unknown top-level keys', () => {
  it('warns rather than errors — an unknown key is ignorable, not fatal', () => {
    const { errors, warnings } = validateArtifact(doc(`
meta:
  kind: DESIGN
  title: Fixture
notes: |
  Scratch notes an agent left behind.
`))

    expect(errors).toEqual([])
    expect(warnings).toEqual(['"notes" is not a recognized section — it will be ignored'])
  })

  it.each([
    ['requirments', 'requirements'],
    ['tasks', 'task_list'],
    ['changelog', 'change_log'],
    ['testcases', 'test_cases'],
    ['analysis', 'spec_coverage']
  ])('suggests the intended key for the typo %s', (typo, suggestion) => {
    const { warnings } = validateArtifact(doc(`
meta:
  kind: DESIGN
  title: Fixture
${typo}: []
`))

    expect(warnings).toContain(`"${typo}" is not recognized — did you mean "${suggestion}"?`)
  })

  it('matches suggestions case-insensitively', () => {
    const { warnings } = validateArtifact(doc(`
meta:
  kind: DESIGN
  title: Fixture
ChangeLog: []
`))

    expect(warnings).toContain('"ChangeLog" is not recognized — did you mean "change_log"?')
  })

  it('warns once per unknown key and leaves known keys alone', () => {
    const { warnings } = validateArtifact(doc(`
meta:
  kind: DESIGN
  title: Fixture
context: prose
change_log: []
owner: pushkar
version: 3
`))

    expect(warnings).toHaveLength(2)
  })
})

// ─── Kind-restricted sections ────────────────────────────────────────────────

describe('kind-restricted sections', () => {
  it.each([
    ['requirements', 'REQUIREMENTS'],
    ['task_list', 'SPEC'],
    ['spec_coverage', 'SPEC'],
    ['test_cases', 'TEST_PLAN'],
    ['test_coverage', 'TEST_PLAN'],
    ['security_checks', 'SECURITY'],
    ['action_items', 'RCA']
  ])('errors when %s appears outside a %s artifact', (section, allowedKind) => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: RELEASE_NOTES
  title: Fixture
${section}:
  - id: X-1
    title: Misplaced item
`))

    expect(hasMessage(errors, `"${section}" is only allowed in ${allowedKind} artifacts`)).toBe(true)
  })

  it('allows an empty restricted section under any kind', () => {
    // An empty list carries no content, so flagging it would only nag agents
    // that scaffold every section up front.
    const { errors } = validateArtifact(doc(`
meta:
  kind: RELEASE_NOTES
  title: Fixture
requirements: []
task_list: []
`))

    expect(errors).toEqual([])
  })

  it('still applies the restriction when the kind is a malformed string', () => {
    // The restriction check reads meta.kind raw — it does not re-apply
    // KIND_REGEX — so a bad kind yields BOTH the kind error and a "wrong kind"
    // error for every populated section. Noisy, but the messages point the
    // agent at the same fix.
    const { errors } = validateArtifact(doc(`
meta:
  kind: bogus
  title: Fixture
requirements:
  - id: REQ-1
    title: Users can sign in
`))

    expect(hasMessage(errors, 'meta.kind must be uppercase')).toBe(true)
    expect(hasMessage(errors, '"requirements" is only allowed in REQUIREMENTS artifacts')).toBe(true)
  })

  it('skips the restriction check when meta is missing entirely', () => {
    // With no kind at all there is nothing to compare against, so the only
    // error is the missing meta block.
    const { errors } = validateArtifact(doc(`
requirements:
  - id: REQ-1
    title: Users can sign in
`))

    expect(errors.some((e) => e.includes('only allowed in'))).toBe(false)
  })

  it('leaves context and change_log unrestricted', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: USER_GUIDE
  title: Fixture
context: |
  Anything goes here.
change_log:
  - added: A section
    removed: ""
    why: Users asked for it
`))

    expect(errors).toEqual([])
  })
})

// ─── Object-entry sections ───────────────────────────────────────────────────

describe('object-entry sections', () => {
  it('errors when a change_log entry is a bare string', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: DESIGN
  title: Fixture
change_log:
  - added: Retry logic
    why: Flaky network
  - "Removed the old poller"
`))

    expect(errors).toContain('change_log[1] must be an object with fields like added, removed, why')
  })

  it('errors when a change_log entry is null', () => {
    // A trailing "- " leaves a null entry; it must not slip past the typeof
    // check (typeof null === 'object').
    const { errors } = validateArtifact(doc(`
meta:
  kind: DESIGN
  title: Fixture
change_log:
  -
`))

    expect(errors).toContain('change_log[0] must be an object with fields like added, removed, why')
  })

  it('errors when a spec_coverage entry is not an object', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: SPEC
  title: Fixture
spec_coverage:
  - REQ-1
`))

    expect(errors).toContain(
      'spec_coverage[0] must be an object with requirement_id, coverage_status, gaps'
    )
  })

  it('errors when a test_coverage entry is not an object', () => {
    const { errors } = validateArtifact(doc(`
meta:
  kind: TEST_PLAN
  title: Fixture
test_coverage:
  - 12
`))

    expect(errors).toContain('test_coverage[0] must be an object')
  })

  it('does not require id or title on object-entry sections', () => {
    // spec_coverage / test_coverage / change_log are keyed by their own fields,
    // so they go through the object check rather than validateItemArray.
    const { errors } = validateArtifact(doc(`
meta:
  kind: SPEC
  title: Fixture
spec_coverage:
  - requirement_id: REQ-1
    coverage_status: covered
    gaps: ""
`))

    expect(errors).toEqual([])
  })
})

// ─── Valid documents ─────────────────────────────────────────────────────────

describe('valid documents', () => {
  it('accepts a full REQUIREMENTS artifact', () => {
    const { errors, warnings } = validateArtifact(doc(`
meta:
  kind: REQUIREMENTS
  title: Braid desktop requirements
context: |
  ## Scope

  Covers the **desktop** client only. Server work is tracked separately.
requirements:
  - id: REQ-AUTH-1
    title: Sign in with GitHub
    status: accepted
    priority: high
    tags: [auth, onboarding]
    description: |
      The user clicks *Sign in with GitHub* and is redirected to the OAuth
      consent screen.

      Acceptance:
      - Token is stored in the OS keychain
      - Failure shows a retryable error
  - id: REQ-SYNC-1
    title: Artifacts sync to the server
    status: proposed
    priority: medium
    description: Changes under \`.braid/\` reach the server within 5s.
change_log:
  - added: REQ-SYNC-1
    removed: ""
    why: Sync was implicit before
    affects: SPEC
`))

    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('accepts a full DESIGN artifact', () => {
    const { errors, warnings } = validateArtifact(doc(`
meta:
  kind: DESIGN
  title: Artifact sync design
context: |
  ### Approach

  Watch \`.braid/\` with chokidar, debounce writes, push through IPC.
change_log:
  - added: Debounce window
    removed: Immediate write
    why: Editors emit bursts of change events
`))

    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('accepts a full SPEC artifact', () => {
    const { errors, warnings } = validateArtifact(doc(`
meta:
  kind: SPEC
  title: Sign-in spec
context: Implementation plan for REQ-AUTH-1.
task_list:
  - id: TASK-1
    title: Wire the OAuth callback
    status: in_progress
    assignee: pushkar
    related_requirement: REQ-AUTH-1
    description: |
      Register the \`braid://oauth\` protocol handler and exchange the code.
  - id: TASK-2
    title: Persist the token
    status: todo
spec_coverage:
  - requirement_id: REQ-AUTH-1
    coverage_status: partial
    gaps: Token refresh is not specced
`))

    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('accepts a full TEST_PLAN artifact', () => {
    const { errors, warnings } = validateArtifact(doc(`
meta:
  kind: TEST_PLAN
  title: Sign-in test plan
context: |
  Manual and automated coverage for the sign-in flow.
test_cases:
  - id: TC-AUTH-1
    title: Happy path sign in
    status: passing
    description: |
      1. Click **Sign in with GitHub**
      2. Approve consent
      3. Expect the workspace list
  - id: TC-AUTH-2
    title: Consent denied
    status: failing
test_coverage:
  - requirement_id: REQ-AUTH-1
    covered_by: TC-AUTH-1, TC-AUTH-2
`))

    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('accepts a full RELEASE_NOTES artifact', () => {
    const { errors, warnings } = validateArtifact(doc(`
meta:
  kind: RELEASE_NOTES
  title: v0.4.0
context: |
  ## Highlights

  - GitHub sign-in
  - Faster artifact sync
change_log:
  - added: GitHub sign-in
    removed: Manual token paste
    why: Onboarding friction
`))

    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })
})

// ─── Accumulation ────────────────────────────────────────────────────────────

describe('single-pass accumulation', () => {
  it('reports every distinct problem, not just the first', () => {
    // The whole point of the validator: an agent fixes the file once.
    const { errors, warnings } = validateArtifact(doc(`
meta:
  kind: REQUIREMENTS
requirements:
  - id: REQ-1
    title: Users can sign in
  - id: REQ-1
    title: Users can sign in again
  - id: "REQ:2"
  - title: No id here
task_list:
  - id: TASK-1
    title: Ship it
change_log: "not a list"
notes: leftover scratch
`))

    // meta.title
    expect(hasMessage(errors, 'meta.title is required')).toBe(true)
    // duplicate id
    expect(hasMessage(errors, 'both have id "REQ-1"')).toBe(true)
    // colon in id
    expect(hasMessage(errors, 'containing ":"')).toBe(true)
    // missing title on REQ:2
    expect(hasMessage(errors, 'Requirement "REQ:2" is missing a title')).toBe(true)
    // missing id
    expect(hasMessage(errors, 'requirements[3] is missing an id')).toBe(true)
    // task_list not allowed in REQUIREMENTS
    expect(hasMessage(errors, '"task_list" is only allowed in SPEC artifacts')).toBe(true)
    // change_log wrong shape
    expect(errors).toContain('change_log must be a list, not string')
    // unknown key stays a warning
    expect(warnings).toContain('"notes" is not a recognized section — it will be ignored')

    expect(errors.length).toBeGreaterThanOrEqual(7)
  })

  it('survives a document whose every section is the wrong type', () => {
    const { errors } = validateArtifact({
      meta: 5,
      context: 12,
      requirements: 'x',
      task_list: 1,
      test_cases: true,
      security_checks: 'y',
      action_items: 2,
      spec_coverage: 'z',
      test_coverage: false,
      change_log: 3
    })

    // No throw, and each section contributed its own message.
    expect(errors.length).toBeGreaterThanOrEqual(10)
  })

  it('returns empty results for an empty object rather than throwing', () => {
    const { errors, warnings } = validateArtifact({})

    expect(hasMessage(errors, 'Missing "meta" block')).toBe(true)
    expect(warnings).toEqual([])
  })
})
