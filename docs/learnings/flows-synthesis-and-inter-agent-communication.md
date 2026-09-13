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

---

## 3. Implementation Blueprint

### 3.1 Data Contracts & Synthesis
* `flow.coordinator`: Preserves `{ id, state, tokens, tokenCap, ctxPct, costUsd, tool, task, engine }`.
* `flow.short`: Normalized to `conv.title || conv.id`, preventing undefined string interpolation in dialog pickers.
* `flow.links`: Derived dynamically by correlating `worker.dependsOn` arrays with sibling agent IDs in the conversation roster, emitting `[depId, worker.id]` tuples for SVG bezier curve generation.
* `fromLive.messages`: Reflects `liveThreads[a.id]?.length || 0`, providing accurate real-time counts on agent cards.

### 3.2 UI & SVG Radial Graph Enhancements
* **Dynamic Hub Robot**: In `ui/boss-graph.js`, the central hub robot dynamically reflects the coordinator's state color (`coordSkin.color`) and opacity.
* **Interactive Hub Tooltip**: A transparent hit area (`r=32`) intercepts clicks on the hub, opening a dedicated tooltip with real-time tokens, context consumption percentage, and a direct button to view the coordinator's interactive thread (`openChat`).
* **Active Coordinator Display**: `detailCard` renders the radial graph whenever `live.length > 0` OR when `flow.coordinator` is in an active state (`LIVE.includes(coord.state)`).
* **Flow Actions**: `archive` invokes `window.desk.archiveConversation(flowId)`, while `closeIdle` safely halts dormant worker sessions (`state === 'idle' || state === 'done'`) in that flow.

---

## 4. Verification & Testing

All enhancements are verified via fast, hermetic unit tests passing under plain `node`:
* `tools/verify-flows-synthesis.mjs`: Tests empty state, coordinator preservation, `short` title extraction, DAG-to-links synthesis, blocked state propagation, and orphan agent dispatch.
* `tools/verify-worker-outbox.js`: Verifies outbox draining, coordinator notification tagging, single-record thread deduplication, and resilient handling of exited agents.
* `tools/verify-conversations.js`: Verifies conversation creation, retrieval, active agent counts, status persistence, and atomic archiving.
* Total test suite pass rate: **26/26 verification scripts OK** (`npm test`).
