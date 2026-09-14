# Testing Architecture & Authoring Guidelines

This document details the testing architecture of **Cute Agents Desk**, the classification of existing test suites, and step-by-step authoring guidelines for creating and registering new tests while preserving application stability, execution speed, and environment isolation.

---

## 1. Test Pyramid & Design Philosophy

The testing framework is split into two primary tiers:

1. **Automated Fast Suite (`FAST` - `npm test`):**
   - Executes under plain `node` in seconds.
   - **100% hermetic**: never spawns real CLI agents (`claude`, `agy`) and incurs zero API token costs.
   - Never instantiates interactive Electron windows (`BrowserWindow`).
   - Uses ephemeral Git test repositories (`makeDisposableRepo`) and temporary environment overrides (`CUTE_AGENTS_DESK_HOME`).
2. **Isolation & Packaged Binary Suite (`MANUAL`):**
   - Requires live agent turns, graphical Electron windows, or validation of compiled distribution executables (`dist/`).

---

## 2. Test Inventory

### Fast Tier (`npm test` / `tools/verify-all.js` - 28 Scripts)
| Script | Scope & Verification Target |
| :--- | :--- |
| `verify-pure-units.js` | Pure unit tests: `toolNameOf`, `frontmatter.js` (UTF-8 BOM handling, DoS safety bounds) and JSON mailboxes (`json-queue.js`). |
| `verify-agent-lifecycle-mock.js` | In-memory virtual PTY harness: trust dialog automation, `Registry` state transitions, token calculations, and coordinator child delegation. |
| `verify-scheduler.js` | Task scheduling, concurrency ceilings, and FIFO wait queues. |
| `verify-trust-dialog.js` | Trust prompt regex matching and per-engine keystroke sequences. |
| `verify-conversations.js` | Conversation creation, serialization, and per-thread worker limits. |
| `verify-coordinator.js` | Mailbox `spawn-requests` draining, prompt synthesis, and additive `spawn()` flags. |
| `verify-coordinator-status.js` | Agent states reflected in `status.json` and coordinator notifications. |
| `verify-worker-outbox.js` | Worker outbox message relay to parent coordinator PTY. |
| `verify-token-cap.js` | Token threshold detection and automated agent termination. |
| `verify-forced-kill.js` | External process termination via `taskkill` and transition to `failed`. |
| `verify-worktree-isolation.js` | Git worktree directory and branch isolation under write tasks. |
| `verify-discovery.js` | Automated discovery of local Git repositories and active branches. |
| `verify-live-repo-data.mjs` | Integration of live account identities and repository metadata. |
| `verify-scheduled-tasks.js` | Cron expressions and recurring background task scheduling. |
| `verify-models-effort-modes.js` | CLI model selection, reasoning effort levels, and permission mode validation across engines. |
| `verify-agy-worktree.js` | Engine-specific worktree isolation and hook directory configuration for Antigravity CLI. |
| `verify-delivery.js` | Packaging, commits under account identity, and Pull Request delivery pipeline. |
| `verify-skills.js` | Dynamic zero-mock discovery of agent skills across configuration folders. |
| `verify-tokens-and-accounts.js` | Account credential schema validation from `accounts.json`. |
| `verify-config.js` | Schema validation, default settings, and thread-safe persistence. |
| `verify-config-ui.js` | Interactive configuration controls, edit modal schema, CSS and toast save feedback. |
| `verify-hierarchical-repo-tree.mjs` | Hierarchical account and repository tree structure in UI. |
| `verify-quotas.js` | Subscription quota parsers and TTL cache for `claude -p /usage` and `agy -p /usage`. |
| `verify-flows-synthesis.mjs` | Workflow state synthesis, active coordinator preservation, and inter-agent dependency DAG links. |
| `verify-chat-input.js` | Live interactive terminal PTY input injection and sanitization. |
| `verify-scheduler-dag.js` | Dependency graph validation and topological worker dispatch. |
| `verify-external-editor.js` | External editor resolution (VS Code / Antigravity IDE / System), account preferences, and path privacy. |
| `verify-syntax-highlight.js` | Lightweight diff tokenization, language auto-detection, XSS prevention, and high-volume performance. |

### Isolation & Packaged Binary Tier (`MANUAL`)
| Script | Execution Command | When to Run |
| :--- | :--- | :--- |
| `verify-dist-binary.js` | `node tools/verify-dist-binary.js` | Run after `npm run dist` to verify that the packaged desktop binary in `dist/win-unpacked/` launches cleanly. |
| `verify-claude-live.js` | `npm run verify:claude` (or `npm run verify`) | End-to-end integration test with a live Claude Code agent in a real PTY. |
| `verify-agy-live.js` | `npm run verify:agy` | End-to-end integration test with a live Antigravity CLI agent. |
| `verify-read-mode.js` | `npx electron tools/verify-read-mode.js` | Verifies that read-only mode denies filesystem writes via runtime hooks. |
| `verify-hook-isolation.js` | `npx electron tools/verify-hook-isolation.js` | Verifies hook isolation across concurrent agents. |
| `verify-coordinator-e2e.js` | `npx electron tools/verify-coordinator-e2e.js` | End-to-end multi-agent coordination with live CLI processes. |

---

## 3. Authoring Guidelines for New Tests

When adding new features or fixing bugs, adhere strictly to the following invariants:

### Rule 1: HOME Directory Isolation
Any test script interacting with `electron/paths.js`, `conversations.js`, `events.js`, or `agent.js` **MUST** require `tools/test-home.js` on the **very first line**:
```javascript
// @ts-check
require('./test-home.js'); // Redirects HOME to an isolated ephemeral temp directory
const assert = require('node:assert');
```
*Rationale:* Prevents test execution from polluting `~/.cute-agents-desk` on the host machine.

### Rule 2: Ephemeral Git Repositories
Never run destructive Git operations on real project folders or assume a clean working tree.
- Use `makeDisposableRepo()` for isolated Git testing:
```javascript
const { makeDisposableRepo } = require('./test-helpers.js');
const repoPath = makeDisposableRepo('cute-test-feature-');
try {
  // Execute test git operations...
} finally {
  fs.rmSync(repoPath, { recursive: true, force: true });
}
```

### Rule 3: PTY Virtualization & Mocks
To test process orchestration without invoking native OS binaries or burning tokens:
- Virtualize `node-pty` in Node's module cache:
```javascript
const Module = require('node:module');
const ptyPath = require.resolve('node-pty');
const originalPty = Module._cache[ptyPath];

Module._cache[ptyPath] = {
  id: ptyPath,
  filename: ptyPath,
  loaded: true,
  exports: {
    spawn: (bin, args, opts) => ({
      pid: 1234,
      onData(cb) {},
      onExit(cb) {},
      write(data) {},
      kill() {},
    }),
  },
};
```
- Always restore `Module._cache[ptyPath] = originalPty` in a `finally` block.

### Rule 4: Registration in `tools/verify-all.js`
1. If the script runs in plain `node` in under 5 seconds, add it to the `FAST` array:
```javascript
const FAST = [
  'verify-your-new-test.js',
  // ...
];
```
2. If it requires a graphical Electron window or live CLI authentication, register it under `MANUAL`.

### Rule 5: Mandatory Pre-Commit Quality Gate
Before submitting or committing changes, execute:
```powershell
npm test
```
The test suite must report `28/28 verify scripts OK` (or higher) with zero failures.
