# Projects

A project in Braid represents a software system — your codebase, your repositories, and all the workspaces where features get built.

## Creating a project

Click **New Project** from the home screen. You'll:

1. **Name it** — something that identifies the system: "payment-platform", "mobile-app", "api-gateway"
2. **Select a folder** — point to where your code lives on your machine
3. **Confirm repositories** — Braid scans the folder and detects git repos. For a single-repo project, that's one repo. For multi-repo, it finds all repos in the folder.

Braid clones nothing and modifies nothing in your existing repos. It creates worktrees (lightweight git checkouts) for each workspace, leaving your main branches untouched.

Projects are local. Creating one needs no account and no network — Braid records it in a database on your machine.

## Single-repo vs multi-repo

**Single-repo** is the most common setup. One project, one repository. Each workspace gets a worktree of that repo.

**Multi-repo** is for projects that span multiple repositories — a frontend and a backend, a service and its shared library, a monorepo with multiple deployable packages. Braid groups them under one project so your workspaces span all repos at once.

You don't configure this — Braid detects it based on how many repos are in your project folder.

## Sharing a project with someone

There's nothing to share. A project is a folder of git repos plus the artifacts committed inside them. A teammate clones the repos the way they always have, points their own Braid at the folder, and gets the same project with the same artifacts.

If you're running the optional [team server](collaboration.md), you can additionally invite contributors by email and have Braid clone the repos for them on setup. That's experimental and not required.

## Project settings

The project **Settings** tab has three sections:

### Monitored Commands
Add project-specific terminal commands to monitor (e.g., `cdk deploy`, `nx build`). Default commands like npm, yarn, cargo, docker are always active. See [Terminals](terminals.md) for more.

### Agent Instructions
Toggle whether Braid generates instruction files for AI agents, and select which agents to configure. See [Agent Integration](agent-instruction-injection.md) for the full guide.

### Danger Zone
You can permanently delete a project. This removes Braid's record of its workspaces and history. Your git repositories and any committed artifacts are not touched.

## What lives where

```
your-project-folder/
├── main-repo/              ← your original clone (untouched by Braid)
├── feature-auth/           ← workspace worktree (created by Braid)
├── fix-checkout-bug/       ← another workspace worktree
└── ...
```

Braid never modifies your original repository clones. All workspace activity happens in separate worktrees that Braid creates and manages.
