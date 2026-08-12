# Engineering Guidelines

Read this with [`AGENTS.md`](../AGENTS.md). That file describes *what the product is* and the
layer rules. This one describes *how code gets written here* — the conventions a
change must follow to be mergeable.

It describes the desktop app: **unqualified `src/…` paths are relative to
`apps/desktop/`.** The server (`apps/server/`) is a NestJS codebase and follows
Nest's own module conventions, not the layering below.

This codebase is being open-sourced. Every pattern in it will be copied, by
contributors and by AI agents, many times over. A shortcut taken once becomes
the house style. Write accordingly.

---

## Layering — non-negotiable

```
ipc/handlers  → services only
services      → queries + lib + other services
queries       → Drizzle only
lib           → pure functions: no DB, no IPC, no services
repositories  → queries + lib (they ARE the storage abstraction)
```

No layer skips a level. Handlers never call queries directly. `lib/` never
imports from `services/`.

The renderer reaches main **only** through `window.api` via `lib/ipc.ts`. No
Node APIs, no `require`, no direct `window.api` calls from components.

## Storage: the two modes

There are two storage backends and services must not know which is active.

- **local** — SQLite is the source of truth. No network, no account.
- **team** — core-api owns cloud entities; the local layer (paths, status, pins)
  still lives in SQLite.

`src/main/repositories/index.ts` is **the only file** that binds an interface to
an implementation. Services depend on `interfaces.ts` and nothing else.

Adding a storage-backed entity means: add to `interfaces.ts`, write both a
`Local*` and a `Backend*` implementation, bind in `index.ts`. Never branch on
mode inside a service.

**IDs are client-generated UUIDs (`crypto.randomUUID()`) in both modes.** A local
row and its future server copy share an ID, which is what makes promoting a local
project to a server an upsert instead of an ID remap. Never use autoincrement for
a domain entity.

**Timestamps are `Date.now()` integers.** Never a `Date` object in the DB.

## Gating server-only features

Never write `if (mode === 'team')` in a component or a service.

Declare the feature in `Capability` (`shared/ipc-types.ts`), list it in
`SERVER_BACKED` (`services/capabilities/index.ts`), and then:

- **Main, mutations** — `assertCapability(Capability.X)` at the top of the
  handler. Produces a `CAPABILITY_UNAVAILABLE` error carrying user-facing copy,
  instead of a bare `ECONNREFUSED` from axios.
- **Main, reads** — degrade to an empty result via `isCapabilityEnabled()`.
  "No server" means the list is empty, not that the screen errors.
- **Renderer** — wrap the control in `<RequiresCapability>`. It disables the
  control and explains why on hover. Tooltip copy lives in the capability
  registry, never in the component.

Worked example: `src/main/ipc/handlers/contributors.ts`.

Three states must stay distinguishable — local mode, team-mode-but-offline, and
available. Collapsing the first two produces misleading UI.

## TypeScript

- No `any`. Use `unknown` and narrow. If you truly cannot type it, comment why.
- Prefer `const` object + derived union over `enum`:
  ```ts
  export const Capability = { Invites: 'invites' } as const
  export type Capability = (typeof Capability)[keyof typeof Capability]
  ```
- Every exported function has an explicit return type.
- Imports of types use `import type`.
- Renderer imports shared types by relative path (`'../../../shared/ipc-types'`),
  not an alias — match the surrounding files.

## Errors

- Attach a stable `code` to anything the renderer branches on:
  ```ts
  const err = new Error('…') as Error & { code: string }
  err.code = 'PROJECT_NAME_TAKEN'
  ```
- Distinguish transient (network) from permanent (rejected) failures. Never
  destroy user state because a request timed out — see `isTransientError` in
  `services/auth/index.ts`.
- Never swallow an error silently. If a `catch` is genuinely a no-op, say why in
  a comment.

## Destructive operations

Deleting user data needs a justification in a comment. Reconcilation logic
written for a server-authoritative world is usually **wrong** locally: remotely,
a missing record means "deleted elsewhere"; locally there is no elsewhere, so it
means a bug — and deleting on top of a bug loses data.

See the comment on `LocalWorkspaceRepository.getAll()` for the shape of this
reasoning.

## Comments

Comment density here is deliberate and higher than typical. Match it.

- Explain **why**, not what. `// increment i` is noise; `// backend is
  authoritative here, so a missing row is a real deletion` is the point.
- Non-obvious decisions get a comment. Especially: anything that looks like it
  could be simplified but cannot.
- File headers on services and non-trivial modules: a `// ─── Name ───` banner
  and 2–5 lines on the module's job and its constraints.

## Styling

Tailwind only. No inline styles, no CSS modules. Follow `design-principles.md`.
Terracotta `#c8674a` is for active states and primary CTAs only.

## Telemetry and network

- **Nothing phones home in local mode.** No analytics, no update check, no
  crash reporting without explicit opt-in.
- Analytics are **opt-in**, read from config, defaulting to off. Never opt-out.
- No new hardcoded URLs. Endpoints come from config.

## Before you call it done

```bash
npm run typecheck     # must pass clean
npx eslint --no-cache <changed files>   # zero errors; fix warnings with --fix
```

Do not run `npm run lint` across the whole repo — it currently OOMs on the
43MB eslint cache. Lint the files you touched.

If you changed `db/schema.ts`, run `npx drizzle-kit generate` and **read the
generated SQL** before committing it. Verify it applies to both a fresh database
and an existing one — an additive migration that drops a column is a data-loss
bug that typechecks fine.

State what you verified and what you did not. "Typechecks" is not "works".
