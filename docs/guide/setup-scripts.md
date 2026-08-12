# Setup Scripts

When you create or reopen a workspace, Braid checks for a `.braid/setup.sh` file in each repository. If found, it offers to run the script — installing dependencies, building assets, or doing whatever your project needs to be ready for development.

This replaces the manual "clone the repo, now run these five commands" onboarding that every project has.

---

## How it works

1. You create or reopen a workspace
2. Braid creates the git worktree and checks for `.braid/setup.sh`
3. A toast notification appears: **"Setup script found"** with a **Run** button
4. Click **Run** — the script runs in the background. You can keep working.
5. When it finishes, you see either **"Setup complete"** or **"Setup failed"** with options to retry or view the output

The toast is non-blocking. If you don't need to run setup — you're reading artifacts, or the dependencies are already there — dismiss it or let it expire on its own.

---

## Creating a setup script

Add a `.braid/setup.sh` file to the root of your repository:

```bash
#!/bin/bash
set -e

npm install
npm run build
```

Commit it to your main branch. Every workspace created from that branch will inherit the script.

The script runs from the worktree directory, so paths are relative to your project root. Use `set -e` so the script stops on the first error — Braid reports the failure and lets you retry.

### Examples

**Node.js project:**
```bash
#!/bin/bash
set -e

npm install
npm run build
```

**Python project:**
```bash
#!/bin/bash
set -e

python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**Monorepo with build steps:**
```bash
#!/bin/bash
set -e

npm install
npm run build:shared
npm run generate:types
```

Keep the script focused on what a new worktree actually needs. Don't include one-time machine setup (installing Homebrew, configuring SSH keys) — those belong in your project's README.

---

## Multi-repo projects

For projects with multiple repositories, each repo can have its own setup script:

```
your-project/
├── frontend/
│   └── .braid/setup.sh       ← npm install && npm run build
├── backend/
│   └── .braid/setup.sh       ← pip install -r requirements.txt
```

Braid detects and runs each repo's script independently. The toast tells you which repos have setup scripts. If one repo's script fails, it stops there — successful repos aren't re-run on retry.

If only one of your repos needs setup, only that repo needs the file. Repos without `.braid/setup.sh` are skipped.

---

## When the script runs

| Event | Runs setup? |
|---|---|
| **Create workspace** | Yes, if the branch has `.braid/setup.sh` |
| **Reopen workspace** (files were removed) | Yes — the worktree is recreated fresh |
| **Reopen workspace** (files were kept) | Yes — the script may need to refresh dependencies |
| **Open existing workspace** | No — the worktree already exists on disk |

The prompt always appears as a toast. You always choose whether to run it or not.

---

## When setup fails

If the script exits with a non-zero code, the toast shows **"Setup failed"** with two options:

- **Retry** — runs the script again from the top
- **View output** — opens a scrollable panel with the full script output, copyable to clipboard

Common failure causes:
- Missing system dependencies (a tool the script needs isn't installed)
- Network issues during package installation
- Version conflicts in dependencies

The workspace is still usable after a failed setup — the git worktree exists, VS Code is open. You can fix the issue manually in the terminal and retry later, or skip setup entirely.

---

## Branches and the setup script

The setup script lives in your repository like any other file. It follows normal git branching:

- If you commit `.braid/setup.sh` to `main`, all new workspaces branched from `main` will have it
- If a workspace branch was created before the setup script was added, that branch won't have it until you merge or rebase from `main`
- You can customize the setup script on a branch if a specific workspace needs different setup

---

## Packaged app compatibility

Braid resolves your shell environment (PATH, nvm, Homebrew paths) before running the script. Tools installed via Homebrew, nvm, pyenv, or similar work the same way they do in your terminal — no special configuration needed.

---

## Next steps

- [**Workspaces**](workspaces.md) — How workspaces and worktrees work
- [**Agent integration**](agent-instruction-injection.md) — How agents discover your workspace context
