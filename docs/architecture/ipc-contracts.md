# Architectural Specifications: IPC Communication Contracts

This document specifies the Inter-Process Communication (IPC) contracts between the Electron Main process and the UI Renderer process in **Cute Agents Desk**, cataloging message channels, request payloads, response structures, and error handling invariants.

---

## 1. Design Principles & Security Model

1. **Context Isolation:** The renderer process runs with `contextIsolation: true` and `nodeIntegration: false`. No raw Node.js or Electron primitives are exposed to the DOM window.
2. **Preload Seam (`electron/preload.js`):** The renderer interacts exclusively through `window.deskApi`, a strictly scoped facade exposed via `contextBridge.exposeInMainWorld()`.
3. **Hermetic & Typed Payloads:** Payloads passed across IPC boundaries are serialized JSON-compatible primitives, validating input shapes before triggering underlying filesystem or process operations.
4. **Zero Remote Execution:** IPC invocations operate on local system files and subprocesses owned by the current user session without exposing network ports or sockets.

---

## 2. IPC Channels & Schema Catalog

### 2.1 Scheduled Tasks Subsystem

Handles configuration, background cron execution, and ad-hoc triggering of scheduled agent tasks.

#### `desk:getScheduledTasks`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** None
* **Returns:** `Promise<Array<ScheduledTask>>`
* **Schema:**
  ```typescript
  interface ScheduledTask {
    id: string;                      // Unique task identifier (e.g. "task-1741800000000")
    name: string;                    // Human-readable task label
    prompt: string;                  // Instruction sent to the dispatched agent
    repoPath: string;                // Target repository absolute canonical path
    engine: 'claude' | 'agy';        // Assigned CLI engine
    cronExpression: string;          // Standard 5-field cron or interval expression
    enabled: boolean;                // Whether the task is scheduled for background dispatch
    lastRunAt?: string | null;       // ISO 8601 timestamp of last execution
    lastStatus?: 'success' | 'failed' | 'running' | null;
  }
  ```

#### `desk:saveScheduledTask`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** `task: ScheduledTask`
* **Returns:** `Promise<{ success: boolean, task: ScheduledTask }>`
* **Invariants:**
  - Persists atomic changes to disk via `electron/scheduled-tasks.js`.
  - Dynamically registers or cancels active cron timers without requiring application restart.

#### `desk:deleteScheduledTask`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** `taskId: string`
* **Returns:** `Promise<{ success: boolean }>`

#### `desk:runScheduledTaskNow`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** `taskId: string`
* **Returns:** `Promise<{ success: boolean, executionId?: string }>`
* **Behavior:** Bypasses scheduled interval and submits an immediate dispatch request to the task scheduler.

---

### 2.2 Agent Skills Management Subsystem

Handles discovery, editing, and authoring of agent skills (`SKILL.md` documents).

#### `desk:getSkills`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** None
* **Returns:** `Promise<Array<SkillSummary>>`
* **Schema:**
  ```typescript
  interface SkillSummary {
    id: string;                      // Unique skill identifier / folder name
    name: string;                    // Declared name from YAML frontmatter
    description: string;             // Purpose and description
    path: string;                    // Absolute canonical path to SKILL.md
    scope: 'user' | 'project';       // Origin scope
    content?: string;                // Raw markdown + YAML content (when requested)
  }
  ```

#### `desk:saveSkill`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** `{ id: string, content: string, scope?: string }`
* **Returns:** `Promise<{ success: boolean, skill: SkillSummary }>`
* **Invariants:**
  - Validates YAML frontmatter integrity (`name`, `description`).
  - Writes atomically to target `SKILL.md`.
  - Re-indexes memory skill cache immediately.

#### `desk:deleteSkill`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** `skillId: string`
* **Returns:** `Promise<{ success: boolean }>`

---

### 2.3 Subscription Quotas & Usage Subsystem

Extracts official subscription limits and usage windows directly from CLI binaries.

#### `desk:getQuotas`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** None
* **Returns:** `Promise<QuotaReport>`
* **Schema:**
  ```typescript
  interface QuotaReport {
    timestamp: number;               // Fetch unix timestamp
    claude?: {
      weeklyTokensUsed?: number;
      weeklyPercent?: number;        // e.g. 45.2 (%)
      fiveHourPercent?: number;      // 5-hour rolling limit consumption (%)
      resetAt?: string;              // ISO timestamp of quota replenishment
      rawStatus?: string;
    };
    agy?: {
      weeklyPercent?: number;
      resetAt?: string;
      rawStatus?: string;
    };
  }
  ```
* **Performance Guarantee:** Enforces a TTL cache (e.g. 5 minutes) to avoid spawning costly and slow CLI inspection subprocesses on every tab navigation.

---

### 2.4 Configuration & Account Management

#### `desk:updateConfig`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** `{ section: string, key: string, value: any }`
* **Returns:** `Promise<{ success: boolean, config: object }>`
* **Invariants:**
  - Protected against Prototype Pollution (`__proto__`, `constructor`, `prototype`).
  - Numerical inputs are clamped within safe operational bounds (`validateAndSanitize`).

#### `desk:setAccountColor`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** `{ accountId: string, color: string }`
* **Returns:** `Promise<{ success: boolean }>`
* **Behavior:** Persists choice to `accounts.json` and updates in-memory cache without triggering expensive repository rescanning.

---

### 2.5 Worktrees & Delivery Pipeline

#### `desk:reapCleanWorktrees`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** None
* **Returns:** `Promise<{ totalReaped: number, reaped: string[], skipped: Array<{ agentId: string, reason: string }> }>`
* **Invariants:**
  - Strictly preserves running agents (`skipped: 'running'`).
  - Strictly preserves worktrees with uncommitted changes (`hasUncommittedChanges === true`, `skipped: 'dirty'`).
  - Safely prunes clean or delivered inactive worktrees without leaving dangling references in `.git/worktrees`.

### 2.6 Agent Interaction, Threads & Task DAG Subsystem

Provides structured inter-agent message histories and interactive user input injection.

#### `desk:threads`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** None
* **Returns:** `Promise<Record<string, Array<ThreadMessage>>>`
* **Schema:**
  ```typescript
  interface ThreadMessage {
    id: string;                      // Message identifier
    who: string;                     // Sender label (e.g. "tú", "trabajador", "coordinador")
    kind: 'user' | 'agent' | 'event' | 'tool';
    text: string;                    // Sanitized message content
    time: string;                    // HH:MM timestamp
  }
  ```

#### `dag` (pushed inside `desk:patch`, not its own channel)
* **Direction:** Main $\to$ Renderer (pushed as a field on `desk:patch`)
* **Trigger:** `Scheduler.enqueueTask()` queuing a dependency-blocked task, or `Scheduler.onTaskCompleted()` / `onTaskFailed()` releasing or cascading one.
* **Schema:**
  ```typescript
  interface DagEntry {
    id: string;                      // task id, the same id a future agent would register under
    state: 'pending' | 'failed';     // tasks that ran (even if they later failed) are excluded --
                                      // they already have a real agent record, this is only for
                                      // the part of the DAG that never got one
    dependsOn: string[];
    conversationId: string;          // which coordinator queued it, from a side table in main.js
                                      // (Scheduler itself is conversation-agnostic)
  }
  ```
* **Consumption:** `ui/data.js`'s `synthesizeFlows()` renders each entry as a ghost roster item (`state: 'queued'` or `'failed'`) in its owning flow, shown in `boss-graph.js`'s parked row since it never has a live PTY or thread.

#### `desk:sendInput`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** `{ agentId: string, text: string }`
* **Returns:** `Promise<{ ok: boolean, error?: string }>`
* **Invariants:**
  - Strict ANSI escape sequence stripping (`/\x1b\[[0-9;?]*[a-zA-Z].../`).
  - Text length capped at 4000 characters.
  - Rejection with friendly error when the target agent is actively running a tool (`state === 'tool'`).
  - Automatic routing to coordinator PTY when interacting with worker agents possessing a `replyTo` relationship.

---

### 2.7 Conversations & Workflow Coordination Subsystem

Manages high-level conversation scopes, coordinator lifecycle, and atomic state archiving.

#### `desk:conversations`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** None
* **Returns:** `Promise<Array<Conversation>>`
* **Schema:**
  ```typescript
  interface Conversation {
    id: string;                      // e.g. "c000abc"
    title: string;                   // Human-readable initiative label
    topic?: string;                  // Scope or repository focus
    cap: number;                     // Max simultaneous workers (e.g. 3)
    cwd?: string;                    // Working directory override for coordinator execution
    engine?: string;                 // e.g. "claude" | "agy"
    model?: string;                  // Model alias or ID
    effort?: string;                 // Reasoning effort budget
    mode?: string;                   // "write" | "plan" | "read"
    createdAt: string;               // ISO 8601 timestamp
    status: 'active' | 'archived';
    archivedAt?: string;
  }
  ```

#### `desk:createConversation`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** `{ title: string, topic?: string, cap?: number, engine?: string, model?: string, effort?: string, mode?: string, cwd?: string }`
* **Returns:** `Promise<Conversation>`
* **Behavior:** Initializes directory structure `<appData>/conversations/<id>/`, creates `conversation.json`, and initializes empty `status.json`. Persists optional custom working directory (`cwd`).

#### `desk:archiveConversation`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** `id: string`
* **Returns:** `Promise<Conversation | { error: string }>`
* **Invariants:**
  - Non-destructive atomic update of `conversation.json`.
  - Sets `status: 'archived'` and timestamps `archivedAt`.

#### `desk:deleteConversation`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** `id: string`
* **Returns:** `Promise<{ ok: boolean, error?: string }>`
* **Invariants:**
  - Strict ID sanitization (`/^[a-zA-Z0-9_-]+$/`) preventing Path Traversal vulnerabilities.
  - Path containment check ensuring targeted directory is strictly within `<appData>/conversations/`.
  - Safety barrier: unconditionally refuses deletion if active agent processes are running in the conversation (`runningInConversation > 0`).
  - Recursively and permanently purges the conversation folder from disk upon confirmation.

#### `desk:spawnCoordinator`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** `{ conversationId: string, bin?: string, engine?: string, model?: string, effort?: string, mode?: string, cwd?: string }`
* **Returns:** `Promise<string | { error: string }>`
* **Invariants:**
  - Idempotent: returns existing active coordinator agent ID if already running in `conversationId`.
  - Gates spawn against global scheduler concurrency.
  - Refuses execution if conversation is archived (`status === 'archived'`).
  - Spawns coordinator with PTY cwd set to custom `cwd` if valid or fallback to conversation mailbox, wiring filesystem queues (`spawn-requests/`).

---

## 3. Asynchronous Main-to-Renderer Push Channels

The main process broadcasts state mutations reactively to all active `BrowserWindow` instances using `webContents.send()`:

| Channel | Trigger Event | Payload Description |
| :--- | :--- | :--- |
| `desk:patch` | Agent state changes, token increments, threads updates, or Scheduler DAG changes | Incremental state diff object applied optimistically in `ui/data.js`. Agent records also carry `mode`, `deniedCount` (read-mode calls the hook actually denied) and `lastVerify` (`'pass'\|'fail'\|'ran'\|null`, from the last test/verify command's exit code); an optional `dag` field carries queued/cascade-failed tasks (see §2.6). |
| `desk:agent-log` | Worker or coordinator PTY output chunk | `{ agentId: string, chunk: string }` stream for live terminal views. |
| `desk:task-status` | Scheduled task execution start / completion | `{ taskId: string, status: string, timestamp: number }`. |
