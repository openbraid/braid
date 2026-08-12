<!--
Thanks for the contribution. Keep a PR to one concern — a refactor and a
behaviour change in one diff is two PRs.
-->

## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem being solved. Link the issue if there is one: Fixes #123 -->

## What did you verify?

<!--
Be specific, and be honest about the gaps. "Typechecks" is not "works".
Say what you actually exercised and what you could not.

Example:
  Verified: created a 2-repo project, opened a workspace, confirmed both
  worktrees appear in the .code-workspace file. Ran two agents in parallel and
  watched the sidebar status pills.
  Not verified: team mode (no server running), workspace close with "remove
  files", anything on an Intel Mac.
-->

**Verified:**

**Not verified:**

## Checks

- [ ] `npm run typecheck` passes clean
- [ ] `npx eslint --no-cache <changed files>` reports zero errors
      <!-- Do not run repo-wide `npm run lint` — it currently OOMs. -->
- [ ] `npm run test:run` passes, or no tests were affected
- [ ] Layering is respected: handlers → services → repositories/queries/lib, no level skipped
- [ ] No `if (mode === 'team')` branching — server-only features go through the capability registry
- [ ] If `db/schema.ts` changed: migration generated with `npx drizzle-kit generate`, generated SQL read, and verified against both a fresh and an existing database
- [ ] Nothing new phones home in local mode

## Screenshots or recording

<!-- For any user-visible change. Delete this section otherwise. -->

## Licensing

- [ ] I wrote this contribution or otherwise have the right to submit it, and
      I agree to license it under the project's [Apache 2.0](../LICENSE) license.
