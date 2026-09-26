# Learnings: Delegation Privilege and Coordinator Polling

## 1. Context

Cute Agents Desk gives an agent a `mode` (`read`, `plan`, `write`, `auto`). Read mode is enforced
at the agent's own turn by `electron/hook.js`, which denies `Edit`/`Write`/`NotebookEdit` (claude)
or anything outside a confirmed read-only allow-list (agy). That is what makes "just look at this
repo" a mode the harness can actually promise, rather than a wish written into a task description.

A coordinator, though, is not just another agent: it is the one agent whose output is *other
processes*. Reviewing the delegation path against the way multi-session agent harnesses handle
inter-agent messaging surfaced two gaps — one a real hole in that promise, one a cost leak.

## 2. Privilege Escalation Through Delegation

### 2.1 The hole

`spawnWorker` in `electron/main.js` took the worker's mode straight from the coordinator's
spawn-request file (`mode: taskReq.mode`), with no relation to the coordinator's own mode. Every
other field on that path was already treated as untrusted — `cwd` is checked against the registered
repos, the concurrency caps are server-side ("los topes los impone el servidor") — but `mode` was
not.

So a coordinator spawned in read mode could write a spawn-request with `"mode": "write"` and get
the repo edited anyway. It did not even have to ask: `mode` is optional in the request schema, and
an absent mode defaults to `write` in `agent.js`. The read-mode lock badge stayed on the
coordinator's node in the flow graph the entire time, and its `deniedCount` stayed at zero, because
nothing the coordinator itself called was ever denied.

This is the same failure mode that cross-session agent protocols name explicitly: an agent must
never route a blocked action through a peer, because a peer performing it bypasses the decision the
user actually made. The coordinator/worker pair is that relationship, with the harness itself
spawning the peer.

### 2.2 The fix

`mayDelegate(bossMode, taskMode)` in `electron/read-mode.js` — the module that already owns "what
may write", shared with `hook.js` and `events.js` so there is one source of truth instead of three
copies of the same list. A non-writing coordinator (`read`, `plan`) may only spawn non-writing
workers; a writing coordinator (`write`, `auto`) is unrestricted. An absent task mode resolves to
`write`, matching `agent.js`, so omitting the field is not a way around the check.

Three decisions worth keeping:

* **Refused, not downgraded.** A silently downgraded worker would run, fail to edit anything, and
  report back — and the coordinator plans against `status.json`, where that is indistinguishable
  from a task that succeeded. The request is rejected through the refusal plumbing that already
  exists for caps and unregistered `cwd`s: a `SpawnRefused` note plus `pedido rechazado: ...` typed
  into the coordinator's own terminal.
* **Gated on the coordinator's path only.** `spawnWorker` serves both the coordinator's
  spawn-request file and the window's own `desk:spawn` IPC, and the latter is the user asking
  directly. A new explicit `viaCoordinator` flag marks the delegated path rather than inferring it
  from the presence of `replyTo`, which `spawnWorker` auto-resolves for orphan workers anyway.
* **Stated in the coordinator's prompt.** The prompt now says the ceiling exists and that a refused
  request should go back to the person, not be retried under another name — otherwise the
  coordinator learns about the rule only by hitting it.

## 3. Status Polling Without a Reason

`status.json` is push-updated by the harness, and each worker already reports `arranco`,
`bloqueado` and `done` straight into the coordinator's terminal. The prompt, however, only said
"leelo en vez de adivinar", which reads as an invitation to re-read it in a loop while waiting —
the most expensive possible way to wait, since every read costs the coordinator context it will
need to dispatch the next round of work, and re-reading does not make a worker finish sooner.

The prompt now states the contract in both directions: notices arrive on their own, so read the
status when a notice arrives or before making a decision, not while waiting.

## 4. Verification

`tools/verify-delegation-privilege.js` (registered in `tools/verify-all.js`, where
**all verify scripts in `npm test` pass**) covers the full `mayDelegate` truth table including the absent-mode
case, plus the `isWritingMode` classification of all four modes.

Because `spawnWorker` lives in Electron's main process and is out of reach of a plain-node test,
the script also asserts the wiring by reading `electron/main.js`: that `mayDelegate` is still
called, still guarded by `viaCoordinator`, and still marked at the spawn-request call site. Both
halves were confirmed to fail red by neutralizing the logic and the wiring separately before the
test was written into the suite — a truth table that keeps passing after someone deletes the call
it describes is worse than no test at all.
