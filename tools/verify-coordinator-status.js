// @ts-check
/**
 * The two gaps left explicitly open after the coordinator+sidebar slice: status.json was never
 * written from live registry state (a coordinator reading it would see the empty object from
 * creation), and the worker->coordinator half of the mailbox didn't exist (only
 * coordinator->worker, via spawn-requests). Both are pure Registry logic, no PTY needed.
 *
 * Run with: node tools/verify-coordinator-status.js
 */

require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const conv = require('../electron/conversations.js');
const { Registry } = require('../electron/events.js');

const conversation = conv.createConversation({ title: 'verify-status', cap: 3 });
const coordinatorWrites = [];
const registry = new Registry(() => {});

// The coordinator: a fake handle whose write() just records what it was told, same as a real
// PTY's write() would push characters at the running CLI session.
registry.register(
  { id: 'coord1', cwd: conv.conversationPaths(conversation.id).dir, task: 'coordina', pid: 1,
    write: (t) => coordinatorWrites.push(t), kill: () => {} },
  { conversationId: conversation.id, role: 'coordinator' },
);

// A worker spawned on the coordinator's behalf.
registry.register(
  { id: 'w1', cwd: 'C:/fake/repo', task: 'hace algo', pid: 2, write: () => {}, kill: () => {} },
  { conversationId: conversation.id, replyTo: 'coord1' },
);

// Moment 1: spawned. register() itself should have already notified.
assert.strictEqual(coordinatorWrites.length, 1, 'deberia avisar al coordinador apenas nace el worker');
assert.match(coordinatorWrites[0], /w1.*arranco/, 'el aviso debe nombrar al worker y decir que arranco');

// status.json should already reflect the worker, even before anything else happens.
let status = JSON.parse(fs.readFileSync(conv.conversationPaths(conversation.id).status, 'utf8'));
assert.ok(status.w1, 'w1 deberia aparecer en status.json apenas se registra');
assert.strictEqual(status.w1.state, 'spawning');
// The coordinator itself has a conversationId too, so it shows up in its own status.json --
// that's fine, a coordinator seeing itself listed is not wrong, just extra information.
assert.ok(status.coord1);

// Moment 2: blocked. A real Notification hook event, same shape hook.js would report.
// apply() itself never publishes -- drain() batches several apply() calls per watch trigger and
// publishes once at the end -- so a direct call here has to do the same to see status.json update.
registry.apply('w1', { event: 'Notification', at: new Date().toISOString(), payload: { message: 'esperando aprobacion' } });
registry.publish();
assert.strictEqual(coordinatorWrites.length, 2, 'deberia avisar al coordinador cuando el worker queda bloqueado');
assert.match(coordinatorWrites[1], /w1.*bloqueado/);

status = JSON.parse(fs.readFileSync(conv.conversationPaths(conversation.id).status, 'utf8'));
assert.strictEqual(status.w1.state, 'blocked', 'status.json debe reflejar el estado mas reciente, no solo el de creacion');

// A routine PreToolUse with an always-ask tool sets state to 'approval', which the plan does NOT
// count as "bloqueado" (that's a normal part of a turn, not the worker being stuck) -- must not
// trigger a second notification for the same reason.
registry.apply('w1', { event: 'PreToolUse', at: new Date().toISOString(), payload: { tool_name: 'Bash', tool_input: { command: 'echo hi' } } });
registry.publish();
assert.strictEqual(coordinatorWrites.length, 2, 'un PreToolUse de aprobacion rutinaria no debe avisar como si estuviera bloqueado');

// Moment 3: done.
registry.exited('w1', 0);
assert.strictEqual(coordinatorWrites.length, 3, 'deberia avisar al coordinador cuando el worker termina');
assert.match(coordinatorWrites[2], /w1.*done/);

status = JSON.parse(fs.readFileSync(conv.conversationPaths(conversation.id).status, 'utf8'));
assert.strictEqual(status.w1.state, 'done');

// A coordinator that has already exited must not throw when a worker still tries to report --
// register() already deleted its handle at that point (same map exited() deletes from).
registry.handles.delete('coord1');
assert.doesNotThrow(() => registry.notifyCoordinator('coord1', 'w2', 'algo'), 'un coordinador ya salido no debe hacer caer nada');

// A conversation folder deleted out from under a lingering exited agent's record must not crash
// the next publish() for anyone else -- the exact scenario noted as a risk while wiring this in.
fs.rmSync(conv.conversationPaths(conversation.id).dir, { recursive: true, force: true });
assert.doesNotThrow(() => registry.publish(), 'publish() no debe reventar si la carpeta de una conversacion ya no existe');

registry.exited('coord1', 0);
console.log('status.json y aviso al coordinador OK: tres momentos automaticos, sin doble aviso en aprobacion rutinaria, sin caerse con carpeta borrada');
// Same reason as verify-token-cap.js: register() leaves an fs.watch per agent, and exited()
// closes each one's own -- but nothing here otherwise keeps the loop alive, so this just makes
// the exit deterministic instead of relying on every watcher having been paired off correctly.
process.exit(0);
