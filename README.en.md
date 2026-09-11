<p align="center">
  <img src="assets/icon.png" alt="cute-agents-desk" width="120">
</p>

# cute-agents-desk

<p align="center">
  <img src="https://img.shields.io/badge/platform-windows-0078D6?logo=windows11&logoColor=white" alt="platform: windows">
  <img src="https://img.shields.io/badge/electron-44-47848F?logo=electron&logoColor=white" alt="electron 44">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="license: MIT"></a>
</p>

[Español](README.md) | **English**

Local dashboard for dispatching command-line agents over the machine's repos and watching each
one's progress graphically.

Every new request spins up a **coordinator**: a real CLI agent, not server code — it decides how
many parallel sessions the work is split into, opens one per agent (delegating by file, never over
the network), receives their reports and keeps global control of the task. Two engines supported:
**`claude`** (Claude Code) and **`agy`** (Antigravity CLI), each with its own hooks — the card never
guesses status by reading the terminal.

## Status

Phases 0 through 4 of the plan are done and verified live (not just with mocks):

- **Phase 0** — the full interface, a port of the approved design (`Despacho Local B`), no stray
  colors and no network requests.
- **Phase 1** — a real agent over PTY (`node-pty`), with a sanitized environment, hooks reporting
  every event, and the workspace trust dialog answered automatically only for folders the account
  registered — never one a coordinator handed it.
- **Phase 2** — real repo discovery by GitHub account, a global and per-conversation parallelism
  cap, conversations as a folder with its own coordinator.
- **Phase 3** — the full mailbox: the coordinator delegates by writing a `spawn-request`, and the
  worker reports back at three automatic moments (born, blocked, done) plus a fourth channel for
  free-form messages — all typed into the coordinator's own terminal, the only way back a session
  has.
- **Phase 4** — a write-mode task runs in its own `git worktree`, outside the repo, instead of
  mutating the shared checkout. No automatic deletion: reaping is manual, with its own card in
  Settings.

**Not built yet**: phase 5 (branch + draft PR + correct account on delivery) — so the phrase
"comes out as a branch and a PR" describes the design intent, not something that happens on its own
today.

### The two engines, in practice

`claude` and `agy` don't share a hook mechanism — each has its own, measured separately (exact
dates and versions live in the comments of `electron/agent.js`, `electron/hook.js` and
`electron/events.js`, not repeated here because they'd go stale):

| | `claude` | `agy` |
|---|---|---|
| Hook config | `--settings <file>`, any path | fixed at `<cwd>/.agents/hooks.json`, no flag |
| Process cwd | the repo (or its worktree, in write mode) | the agent's own directory in the harness — the repo comes in via `--add-dir` |
| Hook payload | snake_case (`tool_name`, `tool_input`) | camelCase (`toolCall.name`, `stepIdx`) |
| Per-worktree isolation | yes | **not yet** — a declared gap, not an oversight |
| Tokens / cost | live statusLine | no known equivalent — no token cap for agy |
| Read-only mode | denies `Edit\|Write\|NotebookEdit` (blocklist) | allows only confirmed read-only tools (allowlist) — stricter on purpose, because agy's full tool surface was never enumerated |

## Prerequisites

- **Windows 10 or 11 (64-bit)**
- **Node.js 20+** and **npm**
- **Git** configured in system `PATH`
- **GitHub CLI (`gh`)** authenticated (`gh auth status`)
- CLI Engines (at least one installed and available in `PATH`):
  - **Claude Code (`claude`)**
  - **Antigravity CLI (`agy`)**

## Run and Package

```bash
npm install
node node_modules/electron/install.js
npm start
```

The second line is needed because npm blocks postinstall scripts, so `npm install` leaves the
Electron package without its binary.

Other available commands:
- `npm run dev`: Starts the application with DevTools opened.
- `npm run smoke`: Headless window smoke test (validates rendering of 6 tabs with 0 errors).
- `npm run dist`: Builds the portable Windows executable (`CuteAgentsDesk-0.1.0-portable.exe`) and NSIS installer in `dist/`.
- `npm run icon`: Compiles the Windows application icon (`assets/icon.ico`) from `assets/icon.png`.
- `npm run rebuild`: Rebuilds native dependencies (`node-pty`) against Electron's internal headers.

## Verify

Every piece of plumbing has its own `tools/verify-*.js`, all following the same convention — live
runs against a real `claude`/`agy` only where a mock can't prove the point (phase 1, hook
isolation, read-only mode, the full `agy` engine), and pure `node:assert` unit tests for
state-machine logic (token cap, scheduler, conversations, mailbox draining).

```bash
npm test        # runs the 12 fast scripts that need no real CLI and no window, in one shot
npm run smoke   # the whole window, no agents: 6 tabs, 0 errors
```

`npm test` (`tools/verify-all.js`) runs the 12 `verify-*.js` scripts MEASURED to finish in
seconds under plain `node`. The rest need a real CLI turn and/or an Electron window — slow, real
API cost, and the window-dependent ones never finish at all in a headless shell
(`app.whenReady()` never resolves there). Those stay manual, run one at a time:

```bash
node tools/verify-phase1.js                                          # a real claude agent, end to end
node tools/verify-agy-phase1.js                                      # the same, with agy
npx electron tools/verify-read-mode.js
npx electron tools/verify-hook-isolation.js
npx electron tools/verify-coordinator-e2e.js
```

`npm run verify` still only runs `verify-phase1.js`, the oldest of the group — not the full
suite; `npm test` is, for its fast half.

## How it's built

No build step. The window loads `ui/` over an `app://` protocol instead of `file://`: the renderer
is ES modules, and `file://` gives them a null origin, so the browser rejects every `import`.
`app://` is a real origin and nothing outside the process can reach it, so there's no port or token
to guard either. Fonts live in `ui/fonts/`: nothing is fetched over the network.

### Backend (`electron/`)

| File | What it does |
|---|---|
| `main.js` | The window, the `app://` protocol, the registry of live agents and every `ipcMain.handle` |
| `preload.js` | The full surface the renderer can ask of the machine — readable at a glance |
| `agent.js` | `spawn()`: a real PTY per agent, env sanitizing, the trust dialog, each engine's hook schema |
| `hook.js` | What the CLI invokes on every event; tells each engine's payload apart and decides whether to deny a tool in read-only mode |
| `pty-env.js` | The sanitized environment — the reason launching the harness from inside a Claude session doesn't break `--resume` |
| `paths.js` | Where every harness file lives — a text editor is the first debugging tool |
| `git.js` | Safe wrapper with synchronous and asynchronous (`gitAsync`) Git operations, preventing main thread freezing during scans |
| `json-queue.js` | Core file-based JSON queue mechanics (`drainJsonQueue`, `watchJsonQueue`) for inboxes and spawn-requests |
| `tool-name.js` | Tool name normalizer between Claude Code (`snake_case`) and Antigravity (`camelCase`) |
| `events.js` | `Registry`: hook → state, the worker↔coordinator mailbox, `status.json`, the token cap |
| `worktree.js` | Per-`git worktree` isolation for write-mode tasks (`claude` only for now) |
| `scheduler.js` | The parallelism cap, global and per-conversation, enforced before any spawn |
| `conversations.js` | A conversation is a folder: `conversation.json`, `status.json`, `agents/` |
| `coordinator.js` | The coordinator's prompt and the draining of its `spawn-requests` |
| `discovery.js`, `accounts.js` | Real repo discovery by GitHub account, with mismatch detection |
| `scheduled-tasks.js` | Read-only discovery of Claude Desktop's and Antigravity's scheduled tasks on this machine |
| `toy-repo.js` | The toy repo that the live `tools/verify-*.js` scripts use |

### Frontend (`ui/`)

| File | What it is |
|---|---|
| `app.js` | State, the six tabs and a single delegated event handler |
| `data.js` | The data seam: per field, mocks until a real source exists — never both at once |
| `sidebar.js` | The real conversations sidebar |
| `tokens/` | Pastel-Tech design system tokens, plus `app.css` for the ones only this application uses |
| `app.css` | Reset, animations and shared controls |
| `esc.js` | Pure utility for safe HTML entity escaping against string injection in templates |
| `robot.js` | The robot, defined once and parameterized by state |
| `ring.js` | The token ring and its formatters |
| `repo-tree.js`, `agent-card.js`, `terminal.js` | "Agent control" tab |
| `boss-graph.js`, `timeline.js` | "Workflows" tab |
| `editor.js` | "Editor" tab: the change tree and the diff |
| `tokens-view.js` | "Usage" tab |
| `scheduled-tasks-view.js` | "Scheduled Tasks" tab: what Claude Desktop and Antigravity have scheduled, outside this harness |
| `config.js`, `dialogs.js`, `chat.js` | "Settings" tab and the dialogs, including an agent's Card/Thread/Diff panel |

### Web Showcase (`website/`)

The repository includes a standalone landing page in `website/index.html` featuring the Pastel-Tech design language and an interactive SVG automata simulation of agent state machines.

Two conventions worth respecting when editing:

- **No literal colors in JavaScript.** Every color comes from a CSS custom property. A new value
  gets named in `ui/tokens/app.css`.
- **Components are pure functions** that return an HTML string. Interaction is declared with
  `data-act` and `data-arg` attributes; actions live in `ui/app.js`.

One gotcha: inside an inline SVG, `stroke="var(--x)"` is silently ignored. It has to be written as
`style="stroke:var(--x)"`.

## Movement means something

An agent's status reads through color **and** movement, two redundant channels on purpose: what
moves is progressing, what's still is stopped. A blocked agent has a dashed red border and doesn't
animate; a graph edge with running lines is a working session. With `prefers-reduced-motion` the
whole panel stays still, and color and labels still carry the same meaning.

## Key Architectural Learnings

1. **ConPTY Environment Sanitization on Windows:** In Windows environments, invoking a CLI harness inside an existing terminal session causes child processes to inherit residual environment variables (`CLAUDE_*`). Explicitly purging these variables before `pty.spawn()` is mandatory to prevent session state corruption and silent failures on flags like `--resume`.
2. **Non-blocking Asynchronous Git Operations:** Offloading heavy repository introspection queries to asynchronous functions (`gitAsync`) ensures the Electron renderer maintains a smooth 60 FPS refresh rate, preventing large Git histories from stalling Node's main loop.
3. **Decoupled File-based IPC Mailbox:** The worker-to-coordinator messaging mechanism operates via on-disk JSON file queues (`events/` and `outbox/`). This avoids opening exposed TCP network sockets or local WebSocket ports, reducing the local attack surface to zero while offering persistence across process restarts.
4. **Allowlists vs. Denylists for AI Tool Isolation:** In read-only mode, a denylist (`Edit|Write`) suffices for tools with a closed capability set (Claude Code), but fails for engines that expose arbitrary execution capabilities (`agy`). For the latter, the only secure defense-in-depth model is strictly inverting the evaluation to a closed allowlist of verified read-only tools (`view_file`, `list_dir`, `grep_search`, `find_by_name`).
5. **Git Worktree Isolation:** When executing tasks in write mode, directly mutating the developer's working tree is unsafe. Each write agent provisions an isolated temporary worktree and branch (`agent/<id>`) in a dedicated directory, keeping the primary workspace untouched until changes are reviewed and approved.
