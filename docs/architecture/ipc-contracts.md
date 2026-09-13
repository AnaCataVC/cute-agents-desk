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

Provides structured inter-agent message histories, visual timeline projection, and interactive user input injection.

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

#### `desk:timeline`
* **Direction:** Renderer $\to$ Main (Invoke / Handle)
* **Arguments:** None
* **Returns:** `Promise<TimelineData>`
* **Schema:**
  ```typescript
  interface TimelineData {
    window: string;                  // e.g. "últimos 30 min"
    ticks: string[];                 // Time markers
    lanes: Array<{
      id: string;                    // Agent identifier
      name: string;                  // Display name
      runs: Array<{
        state: 'running' | 'tool' | 'idle' | 'blocked' | 'done';
        startPct: number;            // 0 - 100% relative to window start
        widthPct: number;            // 0 - 100% relative duration
      }>;
    }>;
  }
  ```

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

## 3. Asynchronous Main-to-Renderer Push Channels

The main process broadcasts state mutations reactively to all active `BrowserWindow` instances using `webContents.send()`:

| Channel | Trigger Event | Payload Description |
| :--- | :--- | :--- |
| `desk:patch` | Agent state changes, token increments, threads, or timeline updates | Incremental state diff object applied optimistically in `ui/data.js`. |
| `desk:agent-log` | Worker or coordinator PTY output chunk | `{ agentId: string, chunk: string }` stream for live terminal views. |
| `desk:task-status` | Scheduled task execution start / completion | `{ taskId: string, status: string, timestamp: number }`. |
