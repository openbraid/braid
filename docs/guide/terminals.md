# Terminals & Agent Sessions

Every workspace in Braid has its own terminals — isolated from other workspaces, tracked in the sidebar, with built-in awareness of AI agents and build tools.

## Terminal basics

Open a new terminal with **⌘T** (when a terminal is focused in VS Code). Each terminal runs in the workspace's worktree directory, so your commands operate on the correct branch and files.

Terminals persist across tab switches. Start Claude in one workspace, switch to another, and your Claude session keeps running. The sidebar shows the status of every active terminal.

## Agent tracking

When you run an AI coding agent in a terminal, Braid detects it automatically. The workspace card in the sidebar shows a status pill:

- **Running** — the agent is actively producing output
- **Waiting** — output stopped and the agent asked you a question
- **Idle** — output stopped with no question pending
- **Completed** — a build or command exited (auto-dismisses after 5 seconds)

This is the point of the sidebar when several agents are going at once: you can see which one needs you without cycling through tabs.

This works with 14 supported agents:

| Agent | Command |
|---|---|
| Claude Code | `claude` |
| Codex | `codex` |
| GitHub Copilot | `copilot` |
| Cursor Agent | `cursor-agent` |
| Cline | `cline` |
| Gemini CLI | `gemini` |
| Aider | `aider` |
| Goose | `goose` |
| Amp | `amp` |
| Kiro | `kiro-cli` |
| OpenCode | `opencode` |
| Factory Droid | `droid` |
| Qwen Code | `qwen` |
| Vibe | `vibe` |

No configuration needed — Braid recognizes these commands when you type them.

## Build tool monitoring

Beyond AI agents, Braid monitors common development commands: npm, yarn, pnpm, cargo, go, make, docker, terraform, kubectl, git, and 30+ more. When a build runs, you see its status in the sidebar without switching tabs.

### Custom monitored commands

If your project uses tools Braid doesn't monitor by default (e.g., `cdk deploy`, `nx build`), add them in project settings:

1. Go to the project page → **Settings** tab
2. Under **Monitored Commands**, type the command and press Enter
3. The command is now tracked in all workspace terminals

## Session history

Braid discovers past AI agent sessions from your machine. When you open a workspace, the sessions panel shows previous conversations that happened in this workspace's directory — across all supported agents.

Each session shows:
- **Agent name** — which agent was used
- **Title** — the first message from the conversation
- **Last active** — when the session was last updated
- **Resume command** — click to resume the session in a new terminal

This means you never lose track of past agent work. Even if you closed the terminal weeks ago, the session is still discoverable.

### Renaming sessions

Sessions default to showing the first message as their title. To give a session a more meaningful name, right-click and rename it. Renamed sessions keep their custom name across app restarts.

## Launching agents with a prompt

For supported agents, Braid can launch an agent with an initial prompt directly. This is useful when you want to kick off work without manually typing the first message.

## Terminal shortcuts

| Shortcut | Action |
|---|---|
| **⌘T** | New terminal (when terminal is focused) |
| **⌘D** | Start dictation (when terminal is focused) |
| **F2** | Rename current terminal |
