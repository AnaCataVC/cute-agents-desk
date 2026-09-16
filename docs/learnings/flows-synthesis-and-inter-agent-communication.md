# Learnings & Adversarial Analysis: Flow Synthesis and Inter-Agent Communication

## 1. Context & Architectural Problem

Cute Agents Desk models high-level user initiatives as autonomous **Conversations** managed by a designated CLI **Coordinator**. The Coordinator does not modify code directly; instead, it decomposes goals into discrete tasks, delegating them via filesystem queues (`spawn-requests/*.json`) to worker agents that operate inside dedicated Git worktrees.

The "Flujos" (Workflows) tab renders a radial SVG graph (`ui/boss-graph.js`) representing the coordinator at the central hub, active workers on an orbital ring, and dynamic directed curved links depicting inter-agent context passing and Directed Acyclic Graph (DAG) task prerequisites.

Prior to this hardening cycle, the workflow synthesis (`synthesizeFlows` in `ui/data.js`) and inter-agent communication plumbing suffered from several critical edge cases and architectural omissions:
1. **Coordinator Omission in Flow Object**: The coordinator agent was identified and filtered out of the worker roster, but was not attached to the synthesized `flow` object. As a consequence, the hub in the SVG graph was rendered with a static accent color regardless of the coordinator's live state (`thinking`, `tool`, `blocked`, etc.), had no hover tooltip or hit area, and could not be clicked to open its live interactive thread.
2. **False Empty State on Active Coordinator**: When a coordinator was actively running but had not yet spawned workers (or when all workers finished), `live.length` was 0, triggering a fallback empty message (*"Sin sesiones activas: todo entregado o en espera"*) and hiding the active coordinator from the graph.
3. **Empty Dependency and Handoff Links (`links: []`)**: The radial graph had complete visual rendering support for animated curved handoffs between agents, but the backend (`electron/main.js` and `electron/events.js`) dropped the `dependsOn` metadata during task dispatch, leaving `links` permanently hardcoded to `[]`.
4. **Duplicate Messages in Worker Outbox**: When workers sent free-form reports to their coordinator via their outbox queue (`paths.agent(id).outbox/*.json`), the message was logged once in `drainOutbox` and a second time inside `notifyCoordinator`, resulting in duplicate entries in the agent's chat history.
5. **Orphaned Workers Without Explicit `replyTo`**: Dispatching a worker into a conversation via IPC without an explicit `replyTo` parameter resulted in the agent having no coordinator binding, losing automatic lifecycle notices (`arranco`, `bloqueado`, `done`).

---

## 2. Adversarial Review & Red Team Edge Cases

During our adversarial stress-test review, we evaluated failure modes, race conditions, and UX ambiguities:

### 2.1 Concurrency & Re-entrant Coordinator Spawns (E-01)
* **Risk**: If a user clicked "abrir coordinador" in the conversation rail or triggered `desk:spawnCoordinator` multiple times for the same conversation ID, multiple coordinator CLI processes would be launched concurrently in the same conversation mailbox directory, corrupting task queue draining and terminal state.
* **Hardening**:
  * In `electron/main.js` (`desk:spawnCoordinator`), the handler now scans `registry.agents` for an already active coordinator in the target conversation (`conversationId && role === 'coordinator' && state !== 'done' && state !== 'failed'`). If present, it returns the existing agent ID immediately without spawning redundant processes.
  * In `ui/sidebar.js`, the conversation row dynamically detects active coordinators and renders a lilac status badge (`coordinando · ver hilo`) that opens the existing chat thread instead of displaying a redundant spawn button.

### 2.2 Worker-to-Coordinator Outbox Loop & Duplication (E-02)
* **Risk**: `drainOutbox` drained JSON files and invoked `this.recordMessage(id, 'sub', 'agente', body.message)` before delegating to `this.notifyCoordinator(agent.replyTo, id, ...)`. In turn, `notifyCoordinator` logged `this.recordMessage(workerId, 'sub', 'agente', message)`.
* **Hardening**: `drainOutbox` now branches conditionally: when `agent.replyTo` is present, `notifyCoordinator` is the single source of truth for both the coordinator's terminal write and the worker's thread history. Standalone workers without coordinators fall back to local thread logging and an `OutboxDropped` harness event.

### 2.3 Standalone Dispatch Fallback & Auto-Resolution (E-03)
* **Risk**: In multi-agent workflows, manual task submissions from the UI (`submitQueue`) target a specific `conversationId` (`state.queueCoord`). If `replyTo` was omitted, the worker ran isolated, failing to report completion to the coordinator.
* **Hardening**: In `electron/main.js` (`spawnWorker`), if `conversationId` is provided without `replyTo`, the backend automatically resolves `replyTo` by querying the active coordinator registered in that conversation, restoring seamless communication channels.

### 2.4 Atomic Conversation Archiving & Invariant Safety (E-04)
* **Risk**: Archiving a conversation while agents are running or files are being read could lead to partial states or missing files if the directory were touched destructively.
* **Hardening**:
  * Added `archiveConversation(id)` in `electron/conversations.js` and IPC `desk:archiveConversation`.
  * The operation mutates `conversation.json` in-place, updating `status: 'archived'` and stamping `archivedAt` without modifying or deleting worktrees or session logs.
  * The "Flujos" UI view respects the `showArch` toggle, dimming archived flows and rendering an inactive grey ring without discarding metrics.

### 2.5 Denied-Call Counter Was A Guess, Not Telemetry (E-05)
* **Risk**: `flow.hooks` was computed as `(roster.length + coordinator) * 3` -- a number with no relationship to anything the harness actually observed. A coordinator with three idle workers always showed "hooks: 12" whether or not a single tool call had ever run.
* **Hardening**: `electron/read-mode.js` extracts the deny/allow verdict `hook.js` already computes for `CAD_MODE=read`, so `electron/events.js` can re-derive the same verdict from each `PreToolUse` payload and increment a real `agent.deniedCount` when it matches. `synthesizeFlows()` sums it into `flow.blocked`; `boss-graph.js`'s `metaRow` renamed the item to "bloqueados" and colors it once it's non-zero.

### 2.6 Read Mode Had No Visual Signal On The Node (E-06)
* **Risk**: A read-mode agent (`mode: 'read'`) was visually identical to a write-mode one on the ring -- the only trace of the distinction was denied-call messages buried in its own thread.
* **Hardening**: `agent.mode` (already tracked per-agent, since it also drives `CAD_MODE` at spawn) now reaches the roster and coordinator objects `synthesizeFlows()` builds. `boss-graph.js` draws a 🔒 badge on the node only when it differs from the write-mode default, so a write-mode ring stays uncluttered.

### 2.7 Verification Runs Were Indistinguishable From Any Other Tool Call (E-07)
* **Risk**: An agent invoking `npm test` looked identical to one invoking any other Bash command. There was no way to tell from the graph whether an agent had checked its own work, let alone whether that check passed.
* **Hardening**: `electron/tool-name.js` adds `isVerificationCommand()` (a regex over the Bash/`run_command` command text) and `exitCodeOf()` (reads `tool_result.exit_code` off the matching `PostToolUse` payload). The exit-code field is per Claude Code's public hooks doc, not measured against a live payload the way the `Status` shape elsewhere in this file was -- if it's ever absent or renamed, `exitCodeOf()` returns `undefined` and the badge falls back to a neutral "ran" instead of a guessed pass/fail. `events.js` correlates the two across one agent's Pre/PostToolUse pair, safe because a single CLI session never runs two tool calls concurrently. `boss-graph.js` shows ✓/✗ on the node from `agent.lastVerify`.

### 2.8 Dependency-Blocked And Cascade-Failed Tasks Never Existed In The Graph (E-08)
* **Risk**: `Scheduler`'s `pendingQueue` and fail-fast cascade (`onTaskFailed`, tested in `verify-scheduler-dag.js`) are real logic, but a task still waiting on a dependency -- or aborted before its dependency ever finished -- never got an agent record. It was invisible everywhere except a text note dropped into the coordinator's own thread.
* **Hardening**: `Scheduler.spawnedIds` tracks which task ids actually got `spawnFn` called, so the new `Scheduler.snapshot()` can return only the ones that never did (state `pending` or cascade-`failed`). `electron/main.js` publishes that snapshot, with a conversation id attached from a side table (`Scheduler` itself is conversation-agnostic), as a `dag` field on `desk:patch`. `synthesizeFlows()` turns each entry into a ghost roster item (`state: 'queued'` or `'failed'`) placed in the flow it belongs to -- rendered by the existing parked row, no new SVG needed since a ghost never has a live PTY or thread. A `failed` state, real or ghost, now also flips `flow.status` to `'bloqueado'`, which it never did before.

---

## 3. Implementation Blueprint

### 3.1 Data Contracts & Synthesis
* `flow.coordinator`: Preserves `{ id, state, tokens, tokenCap, ctxPct, costUsd, tool, task, engine, mode, deniedCount, lastVerify }`.
* `flow.short`: Normalized to `conv.title || conv.id`, preventing undefined string interpolation in dialog pickers.
* `flow.links`: Derived dynamically by correlating `worker.dependsOn` arrays with sibling agent IDs in the conversation roster, emitting `[depId, worker.id]` tuples for SVG bezier curve generation.
* `flow.blocked`: Sum of `deniedCount` across roster and coordinator -- real read-mode denials, not the `roster.length*3` guess it replaced (§2.5).
* Roster items also carry `mode`, `deniedCount`, `lastVerify` per agent (§2.6, §2.7), and may be ghost entries synthesized from `dag` with no live agent behind them at all (§2.8).
* `fromLive.messages`: Reflects `liveThreads[a.id]?.length || 0`, providing accurate real-time counts on agent cards.

### 3.2 UI & SVG Radial Graph Enhancements
* **Dynamic Hub Robot**: In `ui/boss-graph.js`, the central hub robot dynamically reflects the coordinator's state color (`coordSkin.color`) and opacity.
* **Interactive Hub Tooltip**: A transparent hit area (`r=32`) intercepts clicks on the hub, opening a dedicated tooltip with real-time tokens, context consumption percentage, and a direct button to view the coordinator's interactive thread (`openChat`).
* **Active Coordinator Display**: `detailCard` renders the radial graph whenever `live.length > 0` OR when `flow.coordinator` is in an active state (`LIVE.includes(coord.state)`).
* **Flow Actions**: `archive` invokes `window.desk.archiveConversation(flowId)`, while `closeIdle` safely halts dormant worker sessions (`state === 'idle' || state === 'done'`) in that flow.

---

## 4. Verification & Testing

All enhancements are verified via fast, hermetic unit tests passing under plain `node`:
* `tools/verify-flows-synthesis.mjs`: Tests empty state, coordinator preservation, `short` title extraction, DAG-to-links synthesis, blocked state propagation, orphan agent dispatch, `mode`/`deniedCount`/`lastVerify` passthrough, `flow.blocked` aggregation, and ghost-task synthesis from `dag` (queued, cascade-failed, and conversation isolation between the two).
* `tools/verify-scheduler-dag.js`: Tests sequential/diamond dependency resolution, DFS cycle detection, fail-fast cascades, and `Scheduler.snapshot()` excluding any task id that actually spawned (queued or cascade-failed only).
* `tools/verify-worker-outbox.js`: Verifies outbox draining, coordinator notification tagging, single-record thread deduplication, and resilient handling of exited agents.
* `tools/verify-conversations.js`: Verifies conversation creation, retrieval, active agent counts, status persistence, and atomic archiving.
* Total test suite pass rate: **28/28 verification scripts OK** (`npm test`).
