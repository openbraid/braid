# Artifacts

Artifacts are the context files your AI agent reads. They're YAML files in the `.braid` folder of your workspace, versioned in your repo like any other source file.

They aren't documentation written after the fact. They're written *during* the work, mostly by your agent as you talk a problem through with it. The requirements you settle on, the design you pick, the tasks that fall out of it, and — critically — the reasoning behind each. That file is what the next session starts from.

## Why artifacts matter

**Context carries forward.** A session ends and its memory goes with it. The artifact doesn't. Every new agent session reads what's already been decided instead of asking you to re-explain it.

**Decisions survive.** When you choose MongoDB over Cassandra, the reasoning is in the changelog — so the next agent doesn't propose Cassandra again in three weeks.

**You can hold more work in flight.** With three agents running, the artifact is how you check what one of them decided without reconstructing the whole conversation.

**Review happens where review happens.** Artifacts are files on your branch. They show up in the pull request, next to the code they describe.

## Artifact types

Braid includes eight built-in types. Each serves a specific purpose in the development lifecycle.

### REQUIREMENTS
What needs to be built and why. Written from the user or business perspective. Contains individual requirements with acceptance criteria. This is the starting point — everything else traces back here.

### DESIGN
How it will be built at a high level. Architecture decisions, component interactions, data models, API contracts. Most importantly: trade-offs considered and why the chosen approach won. Uses the context section — no array items.

### SPEC
The detailed implementation plan. A task breakdown with specific technical steps. Each task references which requirement it implements, creating a clear link between "what" and "how."

### TEST_PLAN
Test cases that verify requirements are met. Each test case describes the scenario, expected behavior, and which requirement it covers. Written early — not after code is complete.

### SECURITY
Security considerations and checks. Threat model, attack surfaces, controls to implement. Each check describes what to verify and why it matters.

### RCA
Root cause analysis after an incident. Documents what happened, the timeline, root cause, contributing factors, and action items to prevent recurrence.

### RELEASE_NOTES
User-facing summary of what changed. Written for end users, not the engineering team.

### USER_GUIDE
Documentation for end users on how to use the feature.

### Custom types
The `kind` field can be anything. Need a DEPLOYMENT_PLAN? API_CONTRACT? ARCHITECTURE_REVIEW? Create a YAML file with that kind. The only rule: each kind must be unique within a workspace. Use uppercase with underscores.

## YAML structure

Every artifact follows the same basic structure:

```yaml
meta:
  kind: REQUIREMENTS
  title: "Guest Checkout Flow"

context: |
  ## Background

  Payment failures account for 12% of checkout abandonment. Analysis shows
  that 60% of failed payments are from first-time users who abandoned during
  account creation. Guest checkout removes this friction.

  ## Approach

  Server-side session management with 7-day cookie persistence.
  Post-purchase account creation offered but not required.

requirements:
  - id: REQ-001
    title: "Complete purchase without account"
    status: proposed
    priority: p0
    description: |
      Users can complete a purchase without creating an account.

      ## Acceptance criteria
      - Cart persists via session cookie for 7 days
      - All payment methods available to guest users
      - Order confirmation sent to provided email
      - Guest orders searchable by email in order lookup

change_log:
  - added: "REQ-001 guest checkout, REQ-002 post-purchase account creation"
    removed: ""
    why: "Analytics show 40% of users abandon at login — guest checkout removes friction for first-time buyers"
    affects: "DESIGN needs guest session handling. SPEC needs task breakdown."
```

### meta
Every artifact has a `meta` block with `kind` (uppercase, unique per workspace) and `title` (short, descriptive).

### context
Free-form markdown. The narrative section — background, scope, constraints, key decisions, trade-offs. This is where you explain the "why." Supports all standard markdown: headings, lists, code blocks, tables, images.

### Array sections
Structured items with `id`, `title`, and `description`. The section name depends on the artifact type:

| Type | Section name | Key fields per item |
|---|---|---|
| REQUIREMENTS | `requirements` | id, title, status, priority, description, tags |
| SPEC | `task_list` | id, title, status, description, related_requirement |
| TEST_PLAN | `test_cases` | id, title, status, description |
| SECURITY | `security_checks` | id, title, status, description |
| RCA | `action_items` | id, title, status, description |

DESIGN, RELEASE_NOTES, and USER_GUIDE use the context section only.

Custom fields are welcome on any item — the schema is flexible. Just keep `id` and `title` on every item.

### change_log
An append-only log of what changed in this artifact. Each entry has:

- **added** — what was added or changed
- **removed** — what was removed (empty string if nothing)
- **why** — the reasoning behind the change
- **affects** — what downstream artifacts need to react (optional, "None" if no impact)

## The changelog — capturing decisions

The changelog is the most valuable part of an artifact. It preserves the reasoning that would otherwise be lost in conversation history.

### Writing good `why` entries

The `why` field should capture the actual reasoning — the data, the trade-off, the insight from the conversation. Not just what happened, but why it matters.

**Weak:**
```yaml
why: "Added per user request"
```

**Better:**
```yaml
why: "Analytics show 40% of users abandon at login — guest checkout removes this friction for first-time buyers while keeping account creation as a post-purchase option"
```

**Weak:**
```yaml
why: "Changed database approach"
```

**Better:**
```yaml
why: "Switched from Redis to encrypted cookies for session storage after staging incident revealed Redis connection pool exhaustion under concurrent token refresh (100K+ sessions)"
```

### The `affects` field

When a change in one artifact has implications for others, note it:

```yaml
affects: "DESIGN needs guest session handling section. TEST_PLAN needs guest checkout flow coverage."
```

This creates traceability — when someone reads the DESIGN artifact and wonders why it needs updating, the REQUIREMENTS changelog tells them exactly what changed and why.

## Why YAML files in your repo

Artifacts are plain YAML files that live in your git repository — not in a database you don't control, not behind an API, not in a proprietary format.

This is a deliberate choice:

**No lock-in.** Your artifacts are files in your repo. If you stop using Braid tomorrow, everything stays. Read them, edit them, process them with any tool you want.

**No MCP server needed.** Your AI agents read and write artifacts directly from the filesystem. Claude Code, Codex, Copilot — they all work with files natively. No plugin to install, no server to run, no authentication to configure.

**No account, no network.** Editing an artifact is writing a file. It works offline, and Braid never needs to phone home to let you do it.

**You own the data.** Artifacts get committed and pushed to your GitHub, GitLab, or Bitbucket — wherever your code lives. They go through your code review process. They're backed up with your repo. They're subject to your access controls.

**Any agent, any editor.** Because they're just files, they work with every tool in your stack. `grep` them, `diff` them, write scripts against them. They're not trapped inside a UI.

## Working with other people

Because artifacts are committed files, collaboration is just git. Commit the artifact on your branch with the code it describes, open a pull request, and your reviewers read the requirements and the reasoning in the same diff. Two people editing the same artifact on different branches is an ordinary merge conflict in a YAML file.

That covers async review, history, and blame with nothing to run.

If you want several people typing into the same artifact at the same moment — live editing, presence, inline comments, a review status on a shared copy — that's the optional self-hosted server. It's experimental, off by default, and everything on this page works without it. See [Collaboration](collaboration.md).

Either way the file in your repo stays the source of truth.

## Cross-artifact traceability

Artifacts in a workspace are connected:

- **REQUIREMENTS → DESIGN**: The design should reference specific requirement IDs
- **REQUIREMENTS → SPEC**: Each task in the spec links to the requirement it implements via `related_requirement`
- **REQUIREMENTS → TEST_PLAN**: Test cases map to requirements to ensure coverage
- **Any upstream change**: When REQUIREMENTS changes after DESIGN is already written, the changelog `affects` field flags what has to catch up

This is what makes artifacts usable as agent context rather than just documentation. An agent picking up the SPEC can follow `related_requirement` back to what it's implementing, and the `affects` entries tell it which artifacts have drifted out of date.

## Next steps

- [**Getting started**](getting-started.md) — Create your first artifact
- [**Agent integration**](agent-instruction-injection.md) — How your AI agents read and write artifacts automatically
- [**Workspaces**](workspaces.md) — How workspace isolation works
