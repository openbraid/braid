# Workspaces

A workspace is one unit of work — a feature, a bug fix, a migration, a refactor. It gives you an isolated environment where you can work with AI agents without affecting anything else.

## What a workspace gives you

When you create a workspace, Braid sets up:

- **A git branch** — your workspace gets its own branch, created from the source branch you choose
- **A VS Code environment** — a dedicated editor instance for this work
- **An artifact folder** — `.braid/<workspace>/` where your YAML artifacts live
- **Agent configuration** — instruction files that teach your AI agents about this workspace's artifacts

Everything is isolated. Changes in one workspace don't affect another. You can have five workspaces running in parallel, each on its own branch, each with its own agents, all visible in the sidebar.

## Creating a workspace

From the project page, click **New Workspace**. You'll provide:

- **Name** — describes the work: "payment-retry", "auth-migration", "fix-checkout-bug"
- **Branch name** — defaults to the workspace name. This is the git branch.
- **Source branch** — where to branch from (typically `main`)

Braid creates git worktrees (not just branch checkouts), so your original `main` branch is never modified.

## Single-repo vs multi-repo

### Single repository
Most common setup. Your project has one repo. The workspace is a worktree of that repo.

```
your-project/
├── main-repo/                    ← original clone (untouched)
└── payment-retry/                ← workspace worktree
    ├── .braid/
    │   └── payment-retry/        ← artifacts
    │       ├── requirements.yaml
    │       └── design.yaml
    ├── .claude/rules/            ← agent instructions (auto-generated)
    └── src/                      ← your code
```

### Multiple repositories
For projects with a frontend and backend (or more). Each repo gets its own worktree inside the workspace folder. Artifacts live at the workspace level, shared across repos.

```
your-project/
├── frontend/                     ← original clone (untouched)
├── backend/                      ← original clone (untouched)
└── payment-retry/                ← workspace folder
    ├── .braid/                 ← artifacts (shared across repos)
    │   ├── requirements.yaml
    │   └── design.yaml
    ├── frontend/                 ← frontend worktree
    │   ├── .claude/rules/        ← agent instructions
    │   └── src/
    └── backend/                  ← backend worktree
        ├── .claude/rules/        ← agent instructions
        └── src/
```

In multi-repo workspaces the artifacts live above the individual repos. Braid installs a `prepare-commit-msg` hook in each worktree that copies them into the repo before your commit is written, so they end up committed alongside your code and visible in code review. The hook chains to any existing hooks (including Husky) rather than replacing them.

## Workspace lifecycle

Workspaces have a lifecycle status that reflects where the work stands:

| Status | Meaning |
|---|---|
| **In Progress** | Active development |
| **Blocked** | Waiting on something external |
| **On Hold** | Intentionally paused |
| **In Review** | Work complete, under review |
| **Completed** | Done — workspace can be closed |

Change the status from the project page. Status is stored locally with the rest of your workspace state — it's there to help you keep track of several parallel workstreams at a glance, and it needs no server.

## Opening and closing

**Opening** a workspace starts the VS Code environment and makes it available in the sidebar. You can have multiple workspaces open simultaneously.

**Closing** a workspace gives you two options:
- **Keep files** — the worktree stays on disk, ready to reopen later
- **Remove files** — cleans up the worktree. The branch stays in git, so nothing is lost.

Closed workspaces can always be reopened. The git branch and any committed artifacts remain in git either way.

## Parallel work

The sidebar shows all your open workspaces. Each workspace has its own:
- VS Code instance
- Terminal sessions with AI agents
- Artifact state

Switch between them by clicking in the sidebar. Your terminal sessions keep running in the background — you can start an agent in one workspace and check on another while it works.

## Agent sessions

Braid tracks AI agent sessions across your workspaces. When you run Claude Code, Codex, Gemini, or any supported agent in a workspace terminal, Braid discovers the session and displays it in the workspace view.

You can see:
- Which agents have been used in this workspace
- Session history with the first message as a title
- Resume commands to continue previous sessions

This gives you a clear trail of every AI interaction that contributed to the workspace.

## Next steps

- [**Artifacts**](artifacts.md) — What artifacts are and how to write them
- [**Agent integration**](agent-instruction-injection.md) — How agents discover your workspace context
- [**Getting started**](getting-started.md) — Create your first workspace
