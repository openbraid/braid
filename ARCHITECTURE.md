# Architecture

This document is for someone about to read the code. It describes what the
pieces are, how they fit together, and the rules that govern where new code
goes. For the conventions a change must follow to be mergeable, read
[docs/ENGINEERING_GUIDELINES.md](docs/ENGINEERING_GUIDELINES.md).

The repository is an npm workspace with two packages: `apps/desktop/` (the
Electron app) and `apps/server/` (the optional self-hosted team server).
**Unqualified `src/…` paths below are relative to `apps/desktop/`**; server
paths are written out in full.

---

## The shape of the app

Braid is an Electron desktop app. Three processes matter:

| Process | Role |
|---|---|
| **main** (Node.js) | Owns everything stateful: SQLite, git, child processes, the VS Code server, PTYs, HTTP to an optional team server. |
| **preload** | A `contextBridge` that exposes one typed object, `window.api`, to the renderer. |
| **renderer** (React) | UI only. No Node APIs, no filesystem, no database. |

A bundled VS Code extension and an embedded terminal frontend live alongside
them (`src/extension/`, `src/embedded-terminal/`) and talk to main over a local
HTTP/WebSocket server.

Data flows in one direction:

```
user action → window.api call → IPC handler → service → repository → storage
                                                  ↓
                          main pushes an event → Zustand store → React re-render
```

The renderer never derives state it could be told. A mutation is a request; the
resulting state arrives as a push.

---

## Core concepts

**Project** — a named container for one or more git repositories, corresponding
to a root folder on disk. A repo may belong to more than one project.

**Repository** — a git repo, identified permanently by its `remote_url`, never by
its local path. The local path is derived at runtime and stored in exactly one
place (`project_paths.local_path`). Moving the folder updates one row; everything
else recalculates.

**Workspace** — the primary unit of work: one named development context bound to
one git branch. Creating a workspace creates a git worktree per repo at
`<project_path>/<repo_name>-<branch_name>/`, generates a `.code-workspace` file
listing those worktrees, and opens VS Code against it. It also attempts to push
the new branch, but that step is **best effort only**: it is skipped when the repo
has no remote and its failure is caught and treated as non-fatal, so workspace
creation succeeds offline. Workspaces are never deleted, only closed — with the
local files kept or removed.

**Worktree** — a separate checkout of a branch in its own folder. Every
workspace, including the default one created with a project, uses a real
worktree. The user's original clone is never checked out or modified.

**Artifact** — a YAML file under `.braid/` in the user's own repo describing the
work: REQUIREMENTS, DESIGN, SPEC, TEST_PLAN and so on. Artifacts are agent
context files. They are read and written both by the app and directly by AI
agents on disk, which is why a file watcher (`services/artifact/file-watcher.ts`)
exists — the app is not the only writer.

**Session** — a past AI agent conversation, discovered by reading the agent's own
on-disk session store rather than by recording anything ourselves. See
`services/sessions/providers/`.

---

## Storage: two modes, one interface

There are two storage backends, and **no service knows which one is active**.

- **local** — SQLite is the source of truth. No network, no account. This is the
  default and the supported mode.
- **team** — a self-hosted server owns the cloud entities; the local layer still
  lives in SQLite. Experimental.

SQLite tables are split accordingly:

| Layer | Tables | Synced? |
|---|---|---|
| Cloud | `projects`, `repositories`, `project_repositories`, `workspaces`, `workspace_repos` | Yes, in team mode |
| Local | `project_paths`, `workspace_local`, `workspace_terminals`, `session_names`, `scratch_pages` | Never |

App-level UI state (open tabs, last active workspace, panel widths) is not in
SQLite at all — it lives in `~/.braid/app-state.json`.

### The repository-interface pattern

`src/main/repositories/` is the seam between services and storage.

- `interfaces.ts` declares `IProjectRepository`, `IWorkspaceRepository`,
  `IWorkspaceRepoRepository`, `IRepositoryRepository`. Every method returns a
  Promise so a synchronous SQLite implementation and an async HTTP one are
  interchangeable.
- `local-*.ts` implements each interface over Drizzle/SQLite.
- `backend-*.ts` implements each interface over the team server's HTTP API.
- `index.ts` is **the only file in the codebase that binds an interface to an
  implementation.** It reads the mode once at module load and exports singletons.

Adding a storage-backed entity means: declare it in `interfaces.ts`, write both a
`Local*` and a `Backend*` implementation, bind it in `index.ts`. Never branch on
mode inside a service.

IDs are client-generated `crypto.randomUUID()` in **both** modes. A local row and
its eventual server copy share an ID, which makes promoting a local project to a
server an upsert rather than an ID remap. Timestamps are `Date.now()` integers;
never a `Date` object in the database.

`WorkspaceWithLocal` is the join of a cloud row and its local row. The repository
layer merges them so callers see one type regardless of mode.

---

## The capability registry

Server-backed features must degrade, not explode. The mechanism is
`src/main/services/capabilities/` plus the `Capability` union in
`src/shared/ipc-types.ts`.

Three states must stay distinguishable, because collapsing any two produces
misleading UI:

1. local mode — the feature needs a server and none is configured
2. team mode, server unreachable
3. team mode, available

`getCapabilities()` returns a map from capability to `{ enabled, reason }`, where
`reason` is user-facing copy the renderer can render verbatim. Everything not
listed in `SERVER_BACKED` is always enabled.

Usage rules:

- **Main, mutations** — `assertCapability(Capability.X)` at the top of the
  handler. Produces a `CAPABILITY_UNAVAILABLE` error carrying the copy, instead
  of a bare `ECONNREFUSED` from axios.
- **Main, reads** — degrade to an empty result via `isCapabilityEnabled()`. "No
  server" means an empty list, not an error screen.
- **Renderer** — wrap the control in `<RequiresCapability>`. It disables the
  control and explains why on hover. Tooltip copy comes from the registry, never
  from the component.

Never write `if (mode === 'team')` in a service or a component.

Worked example: `src/main/ipc/handlers/contributors.ts`.

---

## The tab system

Each open workspace has its own view state (`renderer/src/store/workspace-view-store.ts`)
with an active tab:

```ts
type WorkspaceTab = 'code' | 'artifacts' | 'context' | 'memory' | 'sessions'
```

- **Code** — the embedded VS Code Web instance.
- **Artifacts** — the YAML artifact viewer/editor for `.braid/`.
- **Sessions** — discovered agent sessions for this workspace, with resume commands.
- **Context**, **Memory** — declared, largely empty surfaces.

Tab state is per workspace, not global, so switching workspaces restores the tab
you were on.

---

## The VS Code server model

Braid embeds a web build of VS Code (`reh-web`) rather than shelling out to a
local VS Code install. `scripts/download-vscode-server.sh` fetches it at setup
time — it is not committed. Two flavours are supported: Microsoft's build, which
is the default and the one verified against Braid's bundled extension, and
[VSCodium](https://vscodium.com) via `BRAID_VSCODE_FLAVOR=vscodium`, which is the
redistributable one. The app spawns `bin/code-server` either way; VSCodium's
differently-named binary is symlinked to that path by the script.

- **One server process per project**, never per workspace. All workspaces in a
  project point at the same server through different `.code-workspace` files.
- Ports are allocated through `lib/port-manager.ts`, which wraps
  `get-port-please` with a set of ports already handed out in this run.
- Each server also gets a terminal WebSocket/HTTP port, written to a file the
  bundled extension reads so it knows where to connect back.
- Server lifecycle is `starting → ready → crashed`, tracked in
  `services/vscode-server/index.ts`, which exposes `getOrStartServer`,
  `startServer`, `stopServer`.
- User data lives at `~/.braid/vscode-data/`; extensions are shared across
  projects at `~/.braid/vscode-extensions/`.
- **Switching tabs is `Webview.setBounds()`** to show or hide the view. The
  webview is never reloaded or recreated on a tab switch, and the server never
  restarts.

---

## Terminals and the agent state machine

Terminals are PTYs owned by main (`services/terminal/pty-manager.ts`, on
`@lydell/node-pty`) and rendered by an xterm.js frontend in
`src/embedded-terminal/`. The service is deliberately split so that the
interesting part is pure:

| File | Job |
|---|---|
| `pty-manager.ts` | spawn / write / kill PTYs |
| `fg-monitor.ts` | poll the foreground process of each PTY |
| `shell-integration.ts` | parse shell-integration escape sequences (command started/completed, exit codes) |
| `state-machine.ts` | **all** state transitions — no Electron imports, pure logic |
| `express-server.ts` | local HTTP/WS endpoint the extension and terminal frontend connect to |
| `index.ts` | orchestration only; wires the above together and pushes over IPC |

Only *monitored* commands produce a status on a workspace card. The state machine
classifies them in two families:

- **Interactive** (the coding agents: `claude`, `codex`, `aider`, `gemini`,
  `goose`, `droid`, `cursor-agent`, `amp`, `copilot`, `qwen`, `opencode`,
  `cline`, `kiro-cli`, `vibe`, …) — detected by output-gap. Output within the
  last 3.3 s means `running`; 3.3 s of silence means `idle`, or `waiting` when
  the tail of the output looks like a question to the user.
- **Non-interactive** (npm, cargo, go, make, docker, terraform, kubectl, …, plus
  per-project custom commands from settings) — `running` while the foreground
  process is not the shell, `completed` with an exit code when it returns.

States are `running | waiting | idle | completed` (`TerminalStatus` in
`shared/ipc-types.ts`). A workspace card's status is derived from all of its
terminals.

Live terminal state is an in-memory Map and is never persisted. Only the terminal
*records* (label, display order) live in `workspace_terminals` so a layout
survives a restart. Closing a workspace clears its terminal state immediately.

---

## Agents

`src/main/services/agents/` has one module per supported agent plus a
`registry.ts`. Each module knows three things: how to detect that the agent is
installed, where its rules/instruction directory lives, and how to write into it
without clobbering the user's own configuration.

On workspace open, Braid writes an instruction file describing the artifact
format into each selected agent's native location, plus a gitignored
`workspace.local.md` carrying machine-specific paths. Agents that use a rules
directory (Claude Code, Copilot, Cursor, Cline, Kiro) get their own file; agents
that read a project-level file (Codex, Amp, Factory, Goose) get an appended
section; agents that support imports or a config read-list (Gemini, Qwen, Aider,
OpenCode) get a reference to a canonical instruction file.

Adding an agent is a new file in this folder plus a registry entry. It should
touch nothing else.

---

## Directory structure

Folder names are fixed conventions; the files inside them are flexible.

```
src/
├── main/                          ← Electron main process (Node.js)
│   ├── index.ts                   ← entry, BrowserWindow, lifecycle, native menu
│   ├── db/
│   │   ├── schema.ts              ← Drizzle table definitions
│   │   ├── index.ts               ← client, connection, migrations on startup
│   │   └── queries/               ← one file per domain — no SQL outside this folder
│   ├── repositories/              ← storage abstraction: interfaces + local/backend impls
│   ├── lib/                       ← pure utilities, no side effects
│   │   ├── app-mode.ts            ← config + local/team resolution
│   │   ├── app-state.ts           ← ~/.braid/app-state.json
│   │   ├── derive-paths.ts        ← worktree/repo/vscode-data path derivation
│   │   ├── port-manager.ts        ← allocate/release ports
│   │   └── git.ts                 ← simple-git wrappers
│   ├── services/                  ← business logic: orchestrate lib + repositories + services
│   │   ├── agents/                ← one module per supported agent + registry
│   │   ├── artifact/              ← YAML read/write, templates, file watcher
│   │   ├── auth/                  ← team mode only
│   │   ├── capabilities/          ← the capability registry
│   │   ├── sessions/              ← agent session discovery, one provider per agent
│   │   ├── terminal/              ← PTYs, fg monitor, state machine, local server
│   │   ├── vscode-server/         ← spawn/reuse/kill one server per project
│   │   ├── workspace/             ← open/close/reopen, webview lifecycle, context injection
│   │   └── worktree/              ← create/validate/remove worktrees, .code-workspace
│   └── ipc/
│       └── handlers/              ← one file per domain, thin: call a service, return
│
├── preload/                       ← contextBridge → typed window.api
│
├── renderer/src/
│   ├── App.tsx                    ← sidebar + right panel shell
│   ├── store/                     ← Zustand, one store per domain, no cross-store imports
│   ├── components/                ← left panel, tab bar, artifact editor, modals, pages
│   ├── hooks/
│   └── lib/ipc.ts                 ← the only place that touches window.api
│
├── shared/                        ← types used by main and renderer
│   └── ipc-types.ts               ← channel names + payload types. No magic strings.
│
├── extension/                     ← bundled VS Code extension
└── embedded-terminal/             ← xterm.js terminal frontend
```

---

## Layer rules — non-negotiable

```
ipc/handlers  → services only
services      → repositories + queries + lib + other services
repositories  → queries + lib          (they ARE the storage abstraction)
queries       → Drizzle only
lib           → pure functions: no DB, no IPC, no services
```

No layer skips a level. Handlers never call queries directly. `lib/` never
imports from `services/`.

The renderer reaches main **only** through `window.api`, and only via
`renderer/src/lib/ipc.ts`. No Node APIs, no `require`, no direct `window.api`
calls from components.

Other hard rules:

- **Paths** — never store a worktree path or repo path in SQLite. Derive it in
  `lib/derive-paths.ts`.
- **IDs** — `crypto.randomUUID()` for every domain entity, in both modes. Never
  autoincrement.
- **Timestamps** — `Date.now()` integers.
- **IPC** — channel names and payload types live in `shared/ipc-types.ts`.
- **State** — Zustand is the single source of truth for UI state. Server data
  never lives in component state.
- **Styling** — Tailwind only. No inline styles, no CSS modules.
- **Types** — no `any`; use `unknown` and narrow. Explicit return types on
  exported functions.
- **Network** — nothing phones home in local mode. Analytics are opt-in and
  default to off. Endpoints come from config, never hardcoded.

---

## Tech stack

```
Runtime         Electron, Node.js, macOS (Apple Silicon)
Frontend        React + TypeScript + Vite (electron-vite)
Styling         Tailwind CSS
State           Zustand (renderer only)
Database        SQLite via Drizzle ORM (main process only)
Config          ~/.braid/  (app-state.json, vscode-data/, vscode-extensions/)
Git             simple-git
Editor          VS Code reh-web (fetched at setup, not committed)
Terminals       @lydell/node-pty + xterm.js, shell integration
IPC             contextBridge + ipcMain/ipcRenderer, typed
Artifacts       js-yaml; TipTap for rich editing; Yjs for team-mode co-editing
Tests           Vitest
```
