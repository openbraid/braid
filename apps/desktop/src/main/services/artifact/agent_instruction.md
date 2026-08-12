# Braid Workspace Instructions

You are working inside a Braid workspace. This workspace uses structured YAML artifacts to document the software development lifecycle. Read this to understand how artifacts work.

## Artifacts

Artifacts are YAML files in `.braid/<workspace-name>/` that capture requirements, designs, specs, test plans, and other SDLC documents. Each file represents one artifact.

Current artifact types: REQUIREMENTS, DESIGN, SPEC, TEST_PLAN, SECURITY, RCA, RELEASE_NOTES, USER_GUIDE.

## When to create or update artifacts

**Do not create or modify artifact YAML files unprompted.** Have a natural conversation with the user first. When you have enough clarity on the topic, offer:
- "Would you like me to formalize this into a requirements file?"
- "Should I update the design artifact with what we discussed?"

Only write to artifact files when the user explicitly confirms. Discussing a topic does not mean you should immediately create a YAML file for it.

When updating an existing artifact, always tell the user what you plan to change and get confirmation before writing.

## YAML structure

Every artifact follows this structure:

```yaml
meta:
  kind: REQUIREMENTS        # artifact type (uppercase)
  title: "Feature Name"     # short descriptive title

artifact:
  context: |
   ## Background
  
  requirements:                # array section (name varies by kind)
  - id: REQ-001             # unique ID within this artifact
    title: "Short title"
    status: proposed  
    description: |
    ## acceptance criteria

review:
  context: |
    ## Design Review

  coverage_analysis:
   - id: REQ-001             # unique ID within this artifact
    title: "Short title"
    status: covered # (partially_covered, not covered or some keyword..)  
    gap: |
    ## acceptance criteria

change_log:
  added:
  removed:
  why:
  impact:

context: |
  ## Background
  Markdown content describing the context, background, and scope.
  Supports all standard markdown: headings, lists, code blocks, tables.

requirements:                # array section (name varies by kind)
  - id: REQ-001             # unique ID within this artifact
    title: "Short title"
    status: proposed         # free-form, no enforced enum
    priority: p1             # free-form
    description: |
      Detailed markdown description with acceptance criteria.
  - id: REQ-002
    title: "Another requirement"
    status: proposed
    priority: p2
    description: |
      More details here.

change_log:
  - added: "REQ-001, REQ-002"
    removed: ""
    why: "Initial requirements from user conversation"
    affects: "None"
```

## Array sections by artifact kind

| Kind | Primary section | Common fields per item |
|---|---|---|
| REQUIREMENTS | `requirements` | id, title, status, priority, description, tags |
| DESIGN | (uses context only) | — |
| SPEC | `task_list` | id, title, status, description, related_requirement |
| TEST_PLAN | `test_cases` | id, title, status, description |
| SECURITY | `security_checks` | id, title, status, description |
| RCA | `action_items` | id, title, status, description |
| RELEASE_NOTES | (uses context only) | — |
| USER_GUIDE | (uses context only) | — |

You may add custom fields to any item — the schema is flexible. Just keep `id` and `title` on every item.

## Changelog

When you modify an artifact, add a `change_log` entry explaining what changed and why:

```yaml
change_log:
  - added: "REQ-003 guest checkout flow"
    removed: ""
    why: "User requested guest checkout based on analytics showing 40% drop-off"
    affects: "DESIGN and SPEC need guest checkout sections"
```

- `added`: what was added or changed
- `removed`: what was removed (empty string if nothing)
- `why`: rationale for the change
- `affects`: what downstream artifacts need to react to this change. Write "None" if no downstream impact. This field is optional but valuable.

## Rules

- **IDs must be unique** within an artifact (e.g., REQ-001, REQ-002). Use the pattern PREFIX-NNN.
- **Do not use colons in IDs** — it breaks YAML parsing.
- **Do not change the `meta.kind` field** of an existing artifact.
- **Do not delete artifact files** unless the user explicitly asks.
- **Do not rename ID values** of existing items — other artifacts may reference them.
- **Keep context as markdown** — it renders in a rich text editor. Use headings, lists, code blocks freely.
- **Descriptions support markdown** — same as context, rendered in rich text.

## Reading artifacts for context

Before starting work, check `.braid/<workspace-name>/` for existing artifacts. Read them to understand:
- What requirements exist and their status
- What design decisions were made
- What the current spec covers
- What test cases exist

This context prevents duplicate work and ensures consistency.

## Sample artifact

See `.braid/<workspace-name>/requirements.yaml` for a working example of the format.
