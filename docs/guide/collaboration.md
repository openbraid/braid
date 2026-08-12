# Collaboration

> **⚠️ Experimental — requires a self-hosted server.**
>
> Everything on this page is off by default and unavailable in a stock install. It needs a Braid server you run yourself, and that server is early and unstable. Braid's supported default is local mode: no account, no login, no network.
>
> **You probably don't need any of this.** Artifacts are files in your repo. Read [Collaborating through git](#collaborating-through-git) below first — it covers most of what teams actually want, with nothing to operate.

## Collaborating through git

Artifacts are plain YAML files in `.braid/`, committed on your branch alongside your code. That gives you async collaboration with no extra infrastructure:

- **Review.** Your teammates read the requirements, the design, and the changelog in the same pull request as the diff. They comment on specific lines using GitHub, GitLab, or whatever you already use.
- **History.** `git log` and `git blame` on an artifact file tell you who changed a requirement, when, and in which commit.
- **Conflicts.** Two people editing the same artifact on different branches is a merge conflict in a YAML file. Resolve it the way you resolve any other one.
- **Backup and access control.** Your repo host already handles both.

For most teams this is the whole answer. The server below only adds value when several people need to be typing into the *same* artifact at the *same* moment.

## What the server adds

With a server configured, these features turn on:

| Feature | What it does |
|---|---|
| **Shared artifacts** | A server-side copy of an artifact that teammates can open without pulling your branch |
| **Live editing** | Multiple people editing one artifact simultaneously, changes appearing as they type |
| **Presence** | Seeing who else has the artifact open |
| **Comments** | Inline threaded comments anchored to selected text |
| **Artifact status** | A draft / in review / approved lifecycle on the shared copy |
| **Invites** | Adding contributors to a project by email |

Nothing else in Braid depends on the server. Workspaces, worktrees, terminals, agent tracking, session history, setup scripts, agent instruction injection, and every local artifact operation work identically with no server configured.

When a server-backed feature is unavailable, Braid tells you why rather than failing with a network error. You'll see either *"Available in team mode. Connect a server in Settings to enable."* or, if a server is configured but unreachable, *"Cannot reach the server."*

## Connecting a server

Point Braid at a server from **Settings**. Braid stores the server URL in its config file and switches from local mode to team mode. Changing modes requires restarting the app.

Local mode is the default. A config with no server URL always resolves to local mode.

## Local and shared copies

With a server connected, an artifact has two representations:

**Local** — the YAML file in your `.braid` folder. Your working copy. You and your agents edit it freely, offline, with no round trips. This is where the work happens, and it remains the source of truth.

**Shared** — a copy published to the server. Teammates can open it, edit it live, and comment on it.

Switch between them with the toggle in the artifact card header.

### Publishing

Click **Save** on an artifact card to publish your local YAML to the shared copy. Braid reconciles your changes with the live shared document rather than overwriting it, preserving comments teammates have already left.

If someone published a newer version while you were editing locally, Braid flags the conflict and lets you pull the latest before saving.

Every save creates a version, visible on the artifact card.

## Comments

Comments anchor to text you select — a paragraph in the context section, a requirement description, a task detail.

- **Add** — select text in shared mode, click the comment icon in the toolbar
- **Reply** — comments are threaded
- **Resolve** — resolved comments collapse but stay visible

Comments survive edits. When surrounding text changes, Braid re-anchors the comment to the nearest matching content. If the anchored text is deleted outright, the comment is marked outdated.

Comments live on the server, not in your repo. They do not travel with a `git push`, and they are gone if you stop running the server. Anything that needs to be permanent belongs in the artifact's `context` or `change_log`.

## Artifact status

The shared copy of an artifact carries a lifecycle status:

| Status | Meaning |
|---|---|
| **Draft** | Initial state — work in progress |
| **In Review** | Ready for team review |
| **Approved** | Reviewed and accepted |
| **Update Required** | Reviewer flagged issues to address |
| **Outdated** | Upstream changes may have invalidated this artifact |

Change it from the dropdown in the artifact header. The status pill shows who changed it last and when.

This is a server feature. In local mode, the equivalent signal is the state of the branch and the pull request.

## Contributors

With a server, a project has two roles:

- **Owner** — created the project. Can invite and remove contributors, and delete the project.
- **Contributor** — can create workspaces, edit artifacts, comment, and change statuses.

Invite someone from the project page. There are no per-workspace permissions — everyone on a project sees everything in it.

In local mode there are no accounts, no invitations, and no roles. Your identity is your `git config user.name` and `user.email`, and access to a project is access to the folder on disk.
