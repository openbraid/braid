# Agent Instruction Injection

Braid automatically configures your AI coding agents to understand your workspace artifacts. When you open a workspace, Braid writes lightweight instruction files that teach your agent — whether it's Claude Code, Codex, Copilot, or any of 13 supported agents — how to find and work with your requirements, designs, specs, and other SDLC artifacts.

No manual setup required. Your agent picks up the instructions automatically.

---

## How it works

When you open a workspace, Braid does three things:

1. **Writes a workspace metadata file** (`.braid/workspace.local.md`) containing your workspace name, project name, artifact directory path, and repository locations. This file is gitignored — it contains machine-specific paths.

2. **Writes an instruction file** in each selected agent's native format, teaching it about the artifact YAML structure, changelog conventions, and how to create or update artifacts.

3. **Drops the workspace metadata into each agent's rules directory** (where supported) so the agent reads it automatically at session start.

All of this happens silently on workspace open. Files are regenerated each time, so you always have the latest instructions.

---

## Supported agents

Braid supports 14 AI coding agents. Each uses its native instruction mechanism — no workarounds or hacks.

| Agent | How instructions are delivered | How workspace metadata is delivered |
|---|---|---|
| **Claude Code** | `.claude/rules/braid.md` | `.claude/rules/workspace.local.md` |
| **GitHub Copilot** | `.github/instructions/braid.instructions.md` | `.github/instructions/workspace.local.md` |
| **Cursor** | `.cursor/rules/braid.mdc` | `.cursor/rules/workspace.local.md` |
| **Cline** | `.clinerules/braid.md` | `.clinerules/workspace.local.md` |
| **Kiro** | `.kiro/steering/braid.md` | `.kiro/steering/workspace.local.md` |
| **Gemini CLI** | Imported via `GEMINI.md` | Imported via `GEMINI.md` |
| **Qwen Code** | Imported via `QWEN.md` | Imported via `QWEN.md` |
| **Aider** | Read list in `.aider.conf.yml` | Read list in `.aider.conf.yml` |
| **OpenCode** | Instructions array in `opencode.json` | Instructions array in `opencode.json` |
| **Codex** | Appended to `AGENTS.md` | Via instruction content |
| **Amp** | Appended to `AGENTS.md` | Via instruction content |
| **Factory Droid** | Appended to `AGENTS.md` | Via instruction content |
| **Goose** | Appended to `.goosehints` | Via instruction content |
| **Vibe** | Not supported | Not supported |

Agents in the first group (Claude through Kiro) use dedicated rules directories — Braid creates its own files there without touching any of your existing configuration.

Agents in the second group (Gemini through OpenCode) use file imports or config references — Braid appends to your existing config files if they exist, or creates them if they don't.

Agents in the third group (Codex through Goose) read project-level files like `AGENTS.md` — Braid appends its content to these files, preserving anything you've already written.

---

## Project settings

You control this feature from your project's **Settings** tab.

### Enable or disable

The **Agent Instructions** toggle controls whether Braid generates instruction files. When disabled, no files are created in new workspaces. Existing files in already-opened workspaces are not removed.

### Select your agents

Below the toggle, you'll see a list of all supported agents. Braid automatically detects which agents are installed on your machine and pre-selects them. You can:

- **Check** an agent to generate instruction files for it
- **Uncheck** an agent to stop generating files for it
- **Hit the refresh button** to re-detect installed agents (useful if you installed a new agent after creating the project)

Agents that aren't installed on your machine appear dimmed and can't be selected.

Only selected agents get instruction files. If you only use Claude Code and Copilot, only those two agents' files are generated — no clutter from agents you don't use.

---

## What the agent learns

The instruction file teaches your agent:

- **What artifacts are** — YAML files in `.braid/` that document requirements, designs, specs, test plans, and other SDLC stages
- **Where to find them** — the artifact directory path from the workspace metadata
- **YAML structure** — the `meta`, `context`, array sections (`requirements`, `task_list`, etc.), and `change_log` format
- **When to create or update** — agents are instructed to have a natural conversation first and only create or modify YAML files when you explicitly confirm
- **Changelog conventions** — how to write meaningful `why` entries that capture decision rationale, and the `affects` field for downstream impact

The workspace metadata file tells your agent:

- Which workspace and project you're working in
- Where the artifact YAML files live (absolute path)
- Whether this is a single-repo or multi-repo project
- The name and path of each repository in the workspace

---

## Multi-repo projects

For projects with multiple repositories, Braid writes instruction and metadata files into **each repository's worktree** — not just the workspace root. This way, regardless of which repo your agent is launched from, it discovers the instructions.

The artifact YAML files themselves live at the workspace level (above individual repos), and the workspace metadata file points your agent to the correct location.

---

## Files created

Here's what Braid creates in your workspace (using Claude Code as an example):

```
your-workspace/
├── .braid/
│   ├── workspace.local.md              # Workspace metadata (gitignored)
│   ├── agent_instruction.md            # Canonical instruction (only if needed by your agents)
│   └── your-branch/
│       ├── requirements.yaml           # Your artifacts
│       └── design.yaml
├── .claude/
│   └── rules/
│       ├── braid.md                   # Artifact instructions for Claude
│       └── workspace.local.md          # Workspace metadata for Claude (gitignored)
└── .gitignore                          # Updated with workspace.local.md entries
```

The `agent_instruction.md` canonical file is only created if you have agents that reference it by path (Gemini, Qwen, Aider, or OpenCode). If you only use rules-directory agents like Claude or Copilot, it's not created.

---

## What gets committed to git

| File | Committed? | Why |
|---|---|---|
| `.braid/workspace.local.md` | No | Contains machine-specific absolute paths |
| `workspace.local.md` in rules dirs | No | Same reason — gitignored automatically |
| `.claude/rules/braid.md` (and similar) | Yes | Generic instruction content, same across machines |
| `.braid/agent_instruction.md` | Yes | Generic instruction content |
| `AGENTS.md` / `.goosehints` | Yes | Appended content is generic |

Braid automatically updates your `.gitignore` to exclude `workspace.local.md` files. You don't need to do this manually.

---

## Updating instructions

When Braid releases updated artifact instructions, the new content is delivered automatically the next time you open a workspace. The instruction files are regenerated on every workspace open, so your agents always have the latest guidance.

If you want to force a refresh without closing and reopening, close the workspace and reopen it from the project page.
