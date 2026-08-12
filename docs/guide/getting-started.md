# Getting Started

This guide walks you through your first project, your first workspace, and your first artifact — start to finish, on your machine.

You need macOS on Apple Silicon and git configured with a name and email:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

That's your identity in Braid. There is no account to create and no server to point at.

## 1. Create a project

Open Braid and click **New Project**. Select the folder where your code lives. Braid scans for git repositories and sets up the project.

- **Single repo?** Point to the folder containing your repo.
- **Multiple repos?** Point to the parent folder. Braid detects all repos inside it.

Braid clones nothing and modifies nothing in your existing repos.

Your project appears in the sidebar. Click it to see the project page.

## 2. Create a workspace

From the project page, click **New Workspace**. Give it a name that describes the work — "payment-retry", "guest-checkout", "auth-migration".

Braid creates:
- A new git branch and a worktree for it, leaving your original clone alone
- A separate VS Code environment
- A `.braid/` folder for artifacts
- Instruction files for your AI agents

Your workspace opens automatically on the Code tab, with VS Code ready to go.

## 3. Look at the Artifacts tab

Click the **Artifacts** tab in the top bar. Braid seeds a new workspace with starter templates — typically REQUIREMENTS, DESIGN, and SPEC. These are empty shells waiting to be filled.

Everything here is reading and writing YAML files on your disk, under `.braid/<workspace>/`. You can open the same files in VS Code if you'd rather see the raw text.

## 4. Run your agent

Open a terminal in your workspace and start whichever agent you use — `claude`, `codex`, `copilot`, or any of the other supported agents.

The agent already knows about the artifact system. Braid wrote instruction files into the agent's own rules directory when the workspace opened. Verify it by asking:

> "What artifacts exist in this workspace?"

Now talk through what you're building. Discuss requirements, weigh approaches, make a decision. When something is settled, ask the agent to write it down:

> "Write this into the requirements artifact."

The agent edits the YAML file in `.braid/` directly — no MCP server, no plugin, just files. The Artifacts tab reflects the change.

## 5. Work with the artifacts

Switch back to the Artifacts tab to read what your agent wrote, rendered properly. You can:

- **Expand** any artifact to see its full content
- **Edit directly** in the UI when that's faster than asking the agent
- **Check the changelog** — every entry should say *why* the change was made, not just what changed

The changelog is the part that pays off later. When a new agent session starts next week, that's what tells it which approaches were already rejected and on what grounds.

## 6. Commit the artifacts with your code

Artifacts are files on your branch, so they ship through the same path as your code:

```bash
git add .braid src
git commit -m "Add guest checkout requirements and initial implementation"
git push
```

Open a PR as you normally would. Your reviewers get the requirements, the design, and the reasoning in the same diff as the implementation — and they can comment on the spec using the review tools they already use.

That's the whole collaboration story, and it needs no server. Braid does add an optional [self-hosted server](collaboration.md) for live co-editing and inline comments, but it's experimental and nothing here depends on it.

One thing stays out of git: `workspace.local.md` files contain absolute paths specific to your machine. Braid adds them to `.gitignore` for you.

## What's next

- [**Artifacts**](artifacts.md) — Artifact types, YAML structure, and changelog conventions
- [**Workspaces**](workspaces.md) — How workspace isolation works, multi-repo setup, lifecycle
- [**Agent integration**](agent-instruction-injection.md) — How Braid configures your AI agents automatically
- [**Setup scripts**](setup-scripts.md) — Making a fresh worktree runnable in one click
