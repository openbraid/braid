# Contributing to Braid

Thanks for taking the time. This document covers getting a dev environment
running, the rules a change has to follow, and how to verify it.

Two other documents matter:

- [ARCHITECTURE.md](ARCHITECTURE.md) — what the pieces are and how they fit
- [docs/ENGINEERING_GUIDELINES.md](docs/ENGINEERING_GUIDELINES.md) — the full
  code conventions

Everyone participating is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

---

## Development setup

**Requirements**

- macOS on Apple Silicon — the only platform currently supported or tested
- Node.js 22 or newer
- git, configured with a name and email

**Setup**

```bash
git clone https://github.com/openbraid/braid.git && cd braid
npm install
npm run dev
```

`npm run dev` runs setup for you: `scripts/download-vscode-server.sh` fetches
the VS Code web server on first run and skips once it is present, and
`scripts/setup-extension.sh` rebuilds the bundled extension every time, so a
change under `src/extension/` is picked up by a restart.

Setup is wired into `dev` and `build` deliberately. A required step that only
runs when you remember to type it produces an app that looks broken on a fresh
clone — no editor, or a black terminal — with nothing to indicate why. Run
`npm run setup` on its own only if you want to pre-fetch without starting the
app.

This is a two-package npm workspace:

```
apps/desktop/   the Electron app — what `npm run dev` starts
apps/server/    the optional self-hosted NestJS team server
```

Install from the repo root: there is a single root lockfile, and running
`npm install` inside an app directory installs the whole workspace anyway. The
root scripts (`dev`, `build`, `typecheck`, `setup`) delegate to the right
package, so you rarely need to `cd` into one.

**Unqualified `src/…` and `scripts/…` paths in this document are relative to
`apps/desktop/`.** Anything in the server is written out in full.

Braid keeps all of its own state under `~/.braid/`. Deleting that folder resets
the app to a fresh install.

**Other useful scripts**

```bash
npm run dev                     # electron-vite dev with HMR
npm run typecheck               # node + web projects
npm run test                    # vitest, watch mode
npm run test:run                # vitest, single run
npm run db:generate             # generate a Drizzle migration from schema.ts
npm run build:mac               # packaged .app
npm run watch:embedded-terminal # rebuild the xterm frontend on change
```

---

## Where code goes

Braid is layered, and the layering is enforced by review rather than by tooling,
so please get it right the first time.

```
ipc/handlers  → services only
services      → repositories + queries + lib + other services
repositories  → queries + lib          (they ARE the storage abstraction)
queries       → Drizzle only
lib           → pure functions: no DB, no IPC, no services
```

No layer skips a level. Handlers never call queries directly. `lib/` never
imports from `services/`.

The renderer reaches the main process **only** through `window.api`, and only via
`renderer/src/lib/ipc.ts`. No Node APIs in the renderer, no `require`, no direct
`window.api` calls from components.

### Two storage modes

There are two backends and **services must not know which is active**:

- **local** — SQLite is the source of truth. No network, no account. The default.
- **team** — a self-hosted server owns the cloud entities; the local layer
  (paths, status, pins) still lives in SQLite. Experimental.

`src/main/repositories/index.ts` is the only file that binds an interface to an
implementation. Adding a storage-backed entity means: declare it in
`interfaces.ts`, write both a `Local*` and a `Backend*` implementation, bind it
in `index.ts`. Never branch on mode inside a service.

### Gating server-only features

Never write `if (mode === 'team')` in a service or a component. Declare the
feature in `Capability` (`src/shared/ipc-types.ts`), list it in `SERVER_BACKED`
(`src/main/services/capabilities/index.ts`), then:

- **Main, mutations** — `assertCapability(Capability.X)` at the top of the handler
- **Main, reads** — degrade to an empty result via `isCapabilityEnabled()`
- **Renderer** — wrap the control in `<RequiresCapability>`

Local mode, team-mode-but-offline, and available must stay distinguishable.
Worked example: `src/main/ipc/handlers/contributors.ts`.

### Other non-negotiables

- **IDs** — `crypto.randomUUID()` for every domain entity, in both modes. Never
  autoincrement.
- **Timestamps** — `Date.now()` integers. Never a `Date` object in the database.
- **Paths** — never store a worktree or repo path in SQLite. Derive it in
  `lib/derive-paths.ts`.
- **IPC** — channel names and payload types live in `src/shared/ipc-types.ts`. No
  magic strings.
- **Types** — no `any`. Use `unknown` and narrow. Explicit return types on
  exported functions. `import type` for type imports.
- **Errors** — attach a stable `code` to anything the renderer branches on. Never
  swallow an error silently.
- **Styling** — Tailwind only. No inline styles, no CSS modules.
- **Network** — nothing phones home in local mode. Analytics are opt-in and
  default to off. No hardcoded endpoints.

### Comments

Comment density in this codebase is deliberately higher than typical. Match it.
Explain **why**, not what — especially anything that looks like it could be
simplified but cannot. Services and non-trivial modules get a header banner and
two to five lines on the module's job and its constraints.

---

## Verifying a change

Before you open a PR:

```bash
npm run typecheck                          # must pass clean
npx eslint --no-cache <files you changed>  # zero errors
npm run test:run                           # if you touched anything under test
```

> **Do not run `npm run lint`.** A repo-wide lint currently runs out of memory on
> the large eslint cache. Lint only the files you touched, with `--no-cache`.
> Fixing this is a welcome contribution in its own right.

If you changed `src/main/db/schema.ts`, run `npx drizzle-kit generate` and **read
the generated SQL** before committing it. Verify it applies to both a fresh
database and an existing one — an additive migration that silently drops a column
is a data-loss bug that typechecks fine.

In your PR description, state what you verified **and what you did not**.
"Typechecks" is not "works". If you could not test a path, say so; that is
useful, not embarrassing.

---

## Commits and pull requests

- Branch from `main`.
- Keep a PR to one concern. A refactor and a behaviour change in one diff is two
  PRs.
- Write commit messages in the imperative mood, with a body explaining *why* when
  the change is not self-evident.
- Fill in the pull request template, including the "what did you verify" section.

## Licensing of contributions

There is nothing to sign. By opening a pull request you agree that your
contribution is licensed under the project's [Apache 2.0](LICENSE) license, and
that you have the right to submit it.

---

## Reporting bugs and proposing features

Use the issue templates. For a bug, the single most useful thing you can include
is the exact sequence that reproduces it plus your macOS and Braid versions. For
a feature, describe the problem you hit before the solution you have in mind.

For anything large — a new storage backend, a change to the layering, a new tab —
open an issue to discuss it before writing the code.

## Security

Do not open a public issue for a security vulnerability. Report it privately
through GitHub's "Report a vulnerability" flow on this repository.
