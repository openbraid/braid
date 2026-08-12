# Braid — Artifact Instructions

You are working inside a Braid workspace. A workspace is an isolated development environment for a single feature, bug fix, or initiative — it has its own git branch, its own code, and its own set of artifacts.

## What are artifacts

Artifacts are structured documents that capture every stage of building software — requirements, designs, specs, test plans, and more. They live as YAML files in the `.braid` folder.

Their purpose is to preserve decisions and context that would otherwise be lost between conversations, handoffs, and team members. When you write an artifact, you're not just documenting — you're creating a shared source of truth that other agents, engineers, PMs, and QA will read and build on.

Write artifacts with that audience in mind. Be specific. Capture the reasoning behind decisions, not just the decisions themselves.

## Your workspace

Read `.braid/workspace.local.md` for details about this workspace — the project name, workspace name, artifact directory path, and repository locations. This file tells you where to find and write artifacts.

If this workspace already has artifacts, read them before starting work. Understand what requirements exist, what design decisions were made, and what the current state is. This prevents duplicate work and contradictory decisions.

## When to create or update artifacts

**Do not create or modify artifact files unprompted.** Follow this pattern:

1. Have a natural conversation — discuss the problem, explore approaches, clarify requirements
2. When you have enough clarity, offer: *"Should I formalize this into a requirements artifact?"* or *"Want me to update the design with what we discussed?"*
3. Wait for confirmation before writing any files
4. When updating an existing artifact, explain what you plan to change before doing it

This matters because artifacts are reviewed by the team. Premature or unexpected changes create noise.

## How to write good artifacts

### Context section
The context section is the narrative — background, scope, constraints, and key decisions. Write it as markdown that a new team member could read and understand the full picture. Include:
- Why this work is being done (the business or user need)
- Key technical constraints or dependencies
- Decisions that were made and the alternatives considered
- Links or references to related systems

Bad: *"This feature adds payment retry."*
Good: *"Payment failures account for 12% of checkout abandonment. We're adding automatic retry with exponential backoff. We considered client-side retry but rejected it because the payment gateway's idempotency keys expire after 5 minutes, making server-side retry the only reliable approach."*

### Item descriptions
Each item in an array section (requirements, tasks, test cases) should have a description detailed enough to act on. For requirements, include acceptance criteria. For tasks, include what "done" looks like.

Bad: *"Support guest checkout"*
Good: *"Users can complete a purchase without creating an account. Cart persists via session cookie for 7 days. On purchase completion, offer optional account creation with pre-filled details. Guest orders appear in order lookup by email."*

### Changelog — capturing decisions
The changelog is the most valuable part of an artifact. It preserves decisions that would otherwise be lost in conversation history.

The `why` field should capture the actual reasoning — the data, the trade-off, the conversation insight — not just "user requested this."

Bad:
```yaml
why: "Added per user request"
```

Good:
```yaml
why: "Analytics show 40% of users abandon at login — guest checkout removes this friction for first-time buyers while keeping account creation as a post-purchase upsell"
```

The `affects` field (optional) describes what downstream artifacts need to react to this change:
```yaml
affects: "DESIGN needs guest session handling section. TEST_PLAN needs guest checkout flow coverage."
```

Write "None" if the change has no downstream impact.

## Artifact types and their purpose

**REQUIREMENTS** — What needs to be built and why. Written from the user/business perspective. Contains requirements with acceptance criteria. This is the starting point — everything else traces back here.

**DESIGN** — How it will be built at a high level. Architecture decisions, component interactions, data models, API contracts, trade-offs considered. Uses the context section primarily. This is not a file level change detail. SPEC is used for file level change detail.  

**SPEC** — Detailed implementation plan. Task breakdown with specific technical steps. Each task should reference which requirement it addresses.

**TEST_PLAN** — Test cases that verify the requirements are met. Each test case describes the scenario, input, expected output, and which requirement it covers.

**SECURITY** — Security considerations, threat model, checks to perform. Each check describes what to verify and why it matters.

**RCA** — Root cause analysis after an incident. Documents what happened, why, the root cause, and action items to prevent recurrence.

**RELEASE_NOTES** — User-facing summary of what changed. Written for the end user, not the engineering team.

**USER_GUIDE** — Documentation for end users on how to use the feature.

**Custom types** — The `kind` field can be anything. If your team needs a DEPLOYMENT_PLAN, ARCHITECTURE_REVIEW, or API_CONTRACT artifact, just create a YAML file with that kind. The only rule: each kind must be unique within a workspace. Use uppercase with underscores.

## Local and shared modes

Artifacts start as local YAML files in your workspace — you and your agents edit them freely. When ready, the user saves to share with the team. The artifact becomes a live collaborative document where PMs, engineers, QA, and leads can edit together in real-time, leave comments on specific sections, and review changes. One workspace, one shared layer for everyone involved in delivering the feature.

## YAML structure

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

  - id: REQ-002
    title: "Post-purchase account creation"
    status: proposed
    priority: p1
    description: |
      After completing a guest purchase, users are offered optional
      account creation with pre-filled details from their order.

change_log:
  - added: "REQ-001 guest checkout, REQ-002 post-purchase account creation"
    removed: ""
    why: "Analytics show 40% of users abandon at login — guest checkout removes this friction for first-time buyers"
    affects: "DESIGN needs guest session handling. SPEC needs task breakdown for session management and payment flow."
```

### Array sections by artifact type

| Type | Section name | Key fields per item |
|---|---|---|
| REQUIREMENTS | `requirements` | id, title, status, priority, description, tags |
| SPEC | `task_list` | id, title, status, description, related_requirement |
| TEST_PLAN | `test_cases` | id, title, status, description |
| SECURITY | `security_checks` | id, title, status, description |
| RCA | `action_items` | id, title, status, description |

DESIGN, RELEASE_NOTES, and USER_GUIDE use the context section only — no array sections.

Custom fields are welcome on any item. Always include `id` and `title`.

## Rules

- **IDs must be unique** within an artifact. Use PREFIX-NNN (REQ-001, TASK-001).
- **No colons in IDs** — breaks YAML parsing.
- **Do not change `meta.kind`** of an existing artifact.
- **Do not delete artifact files** unless the user explicitly asks.
- **Do not rename existing IDs** — other artifacts may reference them.
- **Context and descriptions are markdown** — use headings, lists, code blocks, tables.
- **Always add a changelog entry** when modifying an artifact.
- When editing .braid/*.yaml files in VS Code, word wrap is enabled for YAML. Write context and description fields as continuous long lines — the editor will soft-wrap them. 
- **create plan in spec** - when you use your plan mode, create plan in spec.yaml or design.yaml as appropriate.

## Cross-artifact awareness

Artifacts in a workspace are connected. When working on one, be aware of others:

- Writing DESIGN? Reference specific requirement IDs from REQUIREMENTS.
- Writing SPEC tasks? Link each task to the requirement it implements via `related_requirement`.
- Updating REQUIREMENTS after DESIGN exists? Note in the changelog `affects` field that design may need updating.
- Creating TEST_PLAN? Map test cases to requirements to ensure coverage.

This traceability is what makes artifacts valuable as a team tool — every decision connects back to why it was made.
