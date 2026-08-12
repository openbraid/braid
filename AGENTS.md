# AGENTS.md

Context for AI coding agents working in this repository. Humans: this doubles as
an orientation doc — but [ARCHITECTURE.md](ARCHITECTURE.md) is the fuller
explanation and [CONTRIBUTING.md](CONTRIBUTING.md) is the workflow.

All paths here are relative to the repository root.

---

## What Braid is

A macOS desktop app for running several AI coding agents in parallel. Each unit
of work is a **workspace**: its own git branch, a git worktree per repo, an
embedded VS Code instance, and its own terminals and agent sessions — all visible
from one sidebar.

A second layer, **artifacts**, stores structured YAML (requirements, design,
spec, test plan) in a `.braid/` directory inside the user's own repository, and
configures installed agents to read and write it.

Braid does not ship an agent. It runs whichever ones the user already has.

---

## Repository layout

```
apps/desktop/     Electron app — main, preload, renderer, bundled VS Code extension
apps/server/      Optional self-hosted NestJS server (team mode). Not required.
docs/guide/       End-user documentation
```

Inside `apps/desktop/src/`:

```
main/             Electron main process (Node)
  db/             Drizzle schema + migrations; queries/ holds all SQL
  lib/            Pure utilities — no DB, no IPC, no services
  services/       Business logic — orchestrates lib + queries + other services
  repositories/   Storage seam: interfaces + Local*/Backend* implementations
  ipc/handlers/   Thin — call a service, return the result
preload/          contextBridge — exposes typed window.api
renderer/src/     React + Zustand + Tailwind
extension/        VS Code extension, auto-installed into the embedded server
shared/           Types used by more than one process (IPC channels, payloads)
```

**Layer rules, strictly enforced. No layer skips a level:**

```
ipc/handlers  →  services only
services      →  queries + lib + other services
queries       →  Drizzle only
lib           →  pure functions
```

---

## The two modes — read this before touching storage

Braid runs **local** (default; SQLite is the source of truth, no account, no
network) or **team** (a self-hosted server owns the shared entities, while local
concerns like paths and window state stay in SQLite).

`apps/desktop/src/main/repositories/index.ts` is **the only file** that binds an
interface to an implementation. Services depend on `interfaces.ts` and never
learn which mode is active.

Adding a storage-backed entity means: add the interface method, write `Local*`
and `Backend*` implementations, bind it in that one file.

> **Never branch on mode inside a service.** If you find yourself writing
> `if (isLocalMode())` outside `repositories/index.ts` or the capability
> registry, the abstraction is being bypassed.

For features that only exist with a server, use the capability registry
(`services/capabilities/`) rather than a mode check: mutations call
`assertCapability()`, reads degrade to empty, and the renderer wraps controls in
`<RequiresCapability>`. Three states must stay distinguishable — local,
team-offline, team-online.

---

## Migration code that looks like a botched rename

Braid was previously called Tracigo. Three places still reference the old name
**deliberately**, and removing them loses user data:

- `main/lib/derive-paths.ts` — `LEGACY_ARTIFACT_DIR = '.tracigo'`. Artifact
  directories live inside users' git repos and are committed, so checking out an
  older branch still produces `.tracigo/`. This must be readable **forever**.
- `main/lib/migrate-app-dir.ts` — migrates `~/.tracigo` → `~/.braid` entry by
  entry, not by renaming the directory. A whole-directory rename fails because
  the setup script creates `~/.braid/vscode-extensions` before Electron starts.
- `main/db/index.ts` — renames `tracigo.db` to `braid.db` along with its `-wal`
  and `-shm` sidecars. Skipping this opens an empty database beside the real one.

---

## Non-negotiable rules

**Database**
- All SQLite access goes through `main/db/queries/`. No SQL anywhere else.
- The renderer never touches SQLite. Main process only.
- `crypto.randomUUID()` for all domain IDs — in both modes, so promoting a local
  project to a server is an upsert, not an ID remap.
- Timestamps are `Date.now()` unix-ms integers. Never `Date` objects in the DB.

**IPC**
- The renderer talks to main only via `window.api.*`.
- Channel names and payload types live in `shared/ipc-types.ts`. No magic strings.
- No Node APIs and no `require` in the renderer.

**State**
- Zustand is the single source of truth for UI state.
- Flow is SQLite → main → IPC push → Zustand → React. Do not shortcut it.

**Paths**
- Never store worktree or repo paths in SQLite. Derive them via
  `main/lib/derive-paths.ts`. A repo is identified by its remote URL, not its
  location on disk.

**VS Code server**
- One server per project, never one per workspace.
- Switching tabs is `Webview.setBounds()`. Never reload or recreate the webview.

**Terminals**
- Terminal state lives in an in-memory Map in `services/terminal/`. Never
  persisted.
- Terminals come from VS Code's shell integration via the bundled extension.
  There is no node-pty.

**Styling**
- Tailwind only. No inline styles, no CSS modules.
- Terracotta `#c8674a` is for active states and primary CTAs only.

**General**
- Avoid `any`.
- Destructive operations need a comment explaining why they are safe.

---

## Verifying your work

```bash
npm run typecheck          # both processes
npm run lint               # linting the whole repo can OOM — prefer changed files
npm run dev                # runs the app
```

Verify by running the app, not by reasoning about it. If you could not verify
something, say so plainly rather than implying it was tested.

---

## Things that are true and easy to get wrong

- **Ports must be checked on the interface that will be bound.** Servers bind
  `127.0.0.1`; probing the IPv6 wildcard reports occupied ports as free, and the
  spawned process then dies with `EADDRINUSE` while a stale listener answers the
  readiness check.
- **Shared-token identity is self-asserted.** The token proves the caller knows a
  secret, nothing more. It is for trusted networks only — localhost, LAN, VPN,
  Tailscale. Use OIDC for anything public.
- **`did-finish-load` does not mean the renderer is subscribed.** It means the
  document parsed. Pushes sent then can be dropped.
