# Architecture Overview: Subsystems & Concurrency Model

This document outlines the core architecture, subsystems, data flow, and concurrency model of **Cute Agents Desk**.

---

## 1. High-Level Architectural Diagram

```
+---------------------------------------------------------------------------------+
|                               RENDERER PROCESS                                  |
|                                                                                 |
|   [UI Components: Tasks, Skills, Quotas, Repos, Config, Tokens]                |
|                                     │                                           |
|                              (window.deskApi)                                   |
+─────────────────────────────────────┼───────────────────────────────────────────+
                                      │ IPC (Invoke/Handle & desk:patch)
+─────────────────────────────────────┼───────────────────────────────────────────+
|                               MAIN PROCESS (Node.js / Electron)                 |
|                                     │                                           |
|   ┌───────────────────────────┬─────┴─────────────────────┬──────────────────┐  |
|   │ Scheduled Tasks Engine    │ Dynamic Skills Subsystem  │ Quotas Inspector │  |
|   │ (cron, task registry)     │ (frontmatter, FS watcher) │ (CLI /usage TTL) │  |
|   └─────────────┬─────────────┴───────────────────────────┴──────────────────┘  |
|                 │                                                               |
|   ┌─────────────▼────────────────────────────────────────────────────────────┐  |
|   │ Task Scheduler & Concurrency Governor (scheduler.js)                      │  |
|   │ - Enforces global parallel execution cap (maxParallel)                   │  |
|   │ - Per-conversation / coordinator limits                                  │  |
|   └─────────────┬────────────────────────────────────────────────────────────┘  |
|                 │                                                               |
|   ┌─────────────▼────────────────────────────────────────────────────────────┐  |
|   │ Process Virtualization & Orchestration                                   │  |
|   │ - node-pty child processes with sanitized environment                    │  |
|   │ - Ephemeral Git worktree isolation for write operations                  │  |
|   │ - Engine Hook injection (Claude JSON vs. Antigravity hooks.json)         │  |
|   └──────────────────────────────────────────────────────────────────────────┘  |
+---------------------------------------------------------------------------------+
```

---

## 2. Core Subsystems

### 2.1 Scheduled Tasks Engine (`electron/scheduled-tasks.js`)
* **Purpose:** Orchestrates recurring and unattended agent jobs (such as periodic security audits, dependency scans, or nightly test runs).
* **Execution & Resilience:**
  - Evaluates cron schedules using lightweight local interval clocks.
  - Verifies repository status before spawning to avoid conflicts with manual tasks.
  - Automatically isolates each run inside ephemeral worktrees to prevent dirty worktree corruption.

### 2.2 Dynamic Skills Discovery & Authoring (`electron/skills.js`)
* **Purpose:** Index and edit custom reusable skills formatted according to the standard agent specification (`SKILL.md` with YAML frontmatter).
* **Resolution Order:**
  1. Project-level skills (`<repo>/.agents/skills/*`).
  2. Global user skills (`~/.gemini/config/skills/*` or `~/.claude/skills/*`).
* **Authoring Invariants:** Edits preserve frontmatter schemas while validating syntax before committing changes to disk.

### 2.3 Subscription Quota Inspector (`electron/quotas.js`)
* **Purpose:** Surfaces genuine, non-mocked subscription usage metrics from upstream LLM providers.
* **Mechanism:**
  - Executes dry-run CLI queries (`claude -p /usage` and `agy -p /usage`).
  - Parses remaining 5-hour rolling context windows, weekly percentages, and renewal dates.
  - Employs a TTL-based cache to prevent CLI execution overhead on UI navigation.

### 2.4 Worktree Isolation & Delivery Pipeline
* **Purpose:** Guarantee zero-risk write tasks on developer machines.
* **Mechanism:**
  - Branch creation: `<engine>/<task-slug>-<id>`.
  - Atomic worktree checkout (`git worktree add`).
  - Upon successful task completion, commits with author identity tied to the associated GitHub account and opens a draft PR via `gh pr create --draft`.
  - Completed worktree trees are pruned cleanly.

### 2.5 Coordinator vs. Worker Roles & Radial Topology (`electron/coordinator.js`, `ui/boss-graph.js`)
* **Architectural Roles:**
  - **Coordinator (Hub):** A real CLI agent process operating strictly inside its conversation mailbox directory (`~/.cute-agents-desk/conversations/<id>/`). It possesses full visibility across all registered repositories and accounts. It **never modifies source code directly**; its sole responsibility is decomposing objectives, emitting atomic `spawn-requests/*.json`, and reading progress in `status.json`. This keeps its context window light and focused on orchestration.
  - **Worker Agent (Spoke):** An autonomous CLI execution process operating inside a dedicated repository or ephemeral Git worktree (`<engine>/<task>-<id>`). Each worker starts with a completely pristine, independent context window dedicated solely to completing its assigned task.
* **Subagent Hierarchy & Delegation Invariants:**
  - **Radial Star Topology (Hub-and-Spoke):** Workers do not spawn arbitrary recursive subagents. All task scheduling flows through the central Coordinator and the global `Scheduler`. Workers communicate upstream by writing structured messages to their `outbox/` queue, relayed directly into the coordinator's interactive PTY session.
  - **Privilege Ceiling (`Delegation Never Escalates Privilege`):** A coordinator running in `read` or `plan` mode cannot spawn workers with `write` permissions (`mayDelegate()` in `electron/read-mode.js`), mathematically preventing accidental code mutations in production trees.

---

## 3. Concurrency & Safety Controls

1. **Process Tree Termination on Windows:**
   Subprocesses are terminated using `taskkill /PID <pid> /T /F` to eliminate orphaned child processes when terminating long-running CLIs or handling timeouts.
2. **Atomic Config Persistence:**
   Configuration modifications use temporary unique swap files with PID and timestamp entropy before executing an atomic rename, preventing read-write collisions.
3. **Defense-in-Depth Read Mode:**
   - Claude: Intercepts and denies mutating tool calls (`Edit`, `Write`, `NotebookEdit`).
   - Antigravity: Strictly enforces an explicit whitelist of read-only tools.
