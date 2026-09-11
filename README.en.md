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

## Run

```
npm install
node node_modules/electron/install.js
npm start
```

The second line is needed because npm blocks postinstall scripts, so `npm install` leaves the
Electron package without its binary. `npm run dev` also opens DevTools.

## Verify

There's no single test suite: every piece of plumbing has its own `tools/verify-*.js`, all
following the same convention — live runs against a real `claude`/`agy` only where a mock can't
prove the point (phase 1, hook isolation, read-only mode, the full `agy` engine), and pure
`node:assert` unit tests for state-machine logic (token cap, scheduler, conversations, mailbox
draining).

```
npm run smoke                          # the whole window, no agents: 5 tabs, 0 errors
node tools/verify-phase1.js            # requires `electron`: a real claude agent end to end
node tools/verify-agy-phase1.js        # the same, with agy
node tools/verify-worktree-isolation.js
node tools/verify-worker-outbox.js
node tools/verify-forced-kill.js       # external taskkill + isolation between conversations
node tools/verify-trust-dialog.js
node tools/verify-scheduler.js
node tools/verify-conversations.js
node tools/verify-token-cap.js
node tools/verify-coordinator-status.js
node tools/verify-discovery.js         # reads the machine's real repos
```

`npm run verify` only runs `verify-phase1.js`, the oldest of the group — not the full suite.

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
| `events.js` | `Registry`: hook → state, the worker↔coordinator mailbox, `status.json`, the token cap |
| `worktree.js` | Per-`git worktree` isolation for write-mode tasks (`claude` only for now) |
| `scheduler.js` | The parallelism cap, global and per-conversation, enforced before any spawn |
| `conversations.js` | A conversation is a folder: `conversation.json`, `status.json`, `agents/` |
| `coordinator.js` | The coordinator's prompt and the draining of its `spawn-requests` |
| `discovery.js`, `accounts.js` | Real repo discovery by GitHub account, with mismatch detection |
| `toy-repo.js` | The toy repo that the live `tools/verify-*.js` scripts use |

### Frontend (`ui/`)

| File | What it is |
|---|---|
| `app.js` | State, the five tabs and a single delegated event handler |
| `data.js` | The data seam: per field, mocks until a real source exists — never both at once |
| `sidebar.js` | The real conversations sidebar |
| `tokens/` | Pastel-Tech design system tokens, plus `app.css` for the ones only this application uses |
| `app.css` | Reset, animations and shared controls |
| `robot.js` | The robot, defined once and parameterized by state |
| `ring.js` | The token ring and its formatters |
| `repo-tree.js`, `agent-card.js`, `terminal.js` | "Agent control" tab |
| `boss-graph.js`, `timeline.js` | "Workflows" tab |
| `editor.js` | "Editor" tab: the change tree and the diff |
| `tokens-view.js` | "Usage" tab |
| `config.js`, `dialogs.js`, `chat.js` | "Settings" tab and the dialogs, including an agent's Card/Thread/Diff panel |

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
