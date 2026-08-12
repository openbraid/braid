# Braid

## The problem

You have three agents running. One is refactoring the payment module. One is writing tests for a feature you specced yesterday. One is halfway through a migration you started this morning and can no longer fully remember.

Every one of them is fast. Together they are a mess. You context-switch between terminal windows trying to remember which branch each one is on, what you told it, and what it decided. When a session ends, the reasoning goes with it — the trade-offs you talked through, the approach you rejected, the constraint that made you pick the boring option. Tomorrow you re-explain all of it to a fresh session.

The bottleneck stopped being how fast code gets written. It's how much context you can hold across parallel agents.

## What Braid does

Braid gives every piece of work its own **workspace** — its own git branch and worktree, its own VS Code, its own terminals and agent sessions. Five workspaces run in parallel and you see all of them in one sidebar: which agent is running, which is waiting on you, which finished.

Inside each workspace live **artifacts**: YAML files in your repo under `.braid/` that hold the spec for the work. Requirements, design, task breakdown, test plan — and a changelog that records *why* each decision was made.

Artifacts are agent context files. Braid writes instruction files for your agent when the workspace opens, so the agent finds them, reads them at session start, and updates them as decisions get made. A new session doesn't start from zero. It starts from the file.

## It runs locally

Braid is a desktop app. No account, no login, no server. It works with your network off.

Your identity comes from `git config user.name` and `user.email` — the same identity already on every commit you make. Nothing to sign up for.

Artifacts are files in your repo, so they go where your code goes. Commit them on your branch, open a PR, and your teammates get the spec and the reasoning in the same review as the diff. That is real async collaboration and it needs no server at all — just git.

There is an optional [team server](collaboration.md) that adds live co-editing, comments, and presence on top. It is self-hosted and experimental. Nothing described anywhere else in these docs needs it.

## Core concepts

### Projects
A project is your codebase — one git repository or several grouped together. Point Braid at a folder and it finds the repos.

### Workspaces
A workspace is one unit of work: a feature, a bug fix, a refactor. Its own branch, its own worktree, its own VS Code, its own agent sessions. Your original clone is never touched.

[Learn more about workspaces →](workspaces.md)

### Artifacts
YAML files in `.braid/<workspace>/`. Requirements, design, spec, test plan — each capturing not just what was decided but why. Your agent reads and writes them directly from disk.

[Learn more about artifacts →](artifacts.md)

### Agent integration
Braid configures 14 AI coding agents (Claude Code, Codex, Copilot, Cursor, and more) to find your artifacts. No MCP server, no plugin, no authentication. Open a workspace and the instruction files are there.

[Learn more about agent integration →](agent-instruction-injection.md)

## Requirements

macOS on Apple Silicon. Other platforms aren't supported yet.

## Next steps

- [**Getting started**](getting-started.md) — Your first project, workspace, and artifact
- [**Projects**](projects.md) — Setting up projects, single vs multi-repo
- [**Workspaces**](workspaces.md) — Isolation, branches, parallel work, lifecycle
- [**Artifacts**](artifacts.md) — Types, YAML structure, changelog, traceability
- [**Agent integration**](agent-instruction-injection.md) — How agents auto-discover your artifacts
- [**Terminals & sessions**](terminals.md) — Agent tracking, build monitoring, session history
- [**Setup scripts**](setup-scripts.md) — Getting a new worktree ready to run
- [**Collaboration**](collaboration.md) — Experimental: live editing and comments via a self-hosted server
- [**Keyboard shortcuts**](keyboard-shortcuts.md) — All shortcuts at a glance
