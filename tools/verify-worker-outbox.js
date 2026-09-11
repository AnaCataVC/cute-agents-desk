// @ts-check
/**
 * The fourth mailbox moment: a worker sending an arbitrary, free-form message to its own
 * coordinator, of its own accord, not tied to a hook event. Registry.watchOutbox()/drainOutbox()
 * drain `<agent dir>/outbox/*.json` the same defensive way drain() drains the hook-events inbox.
 * Pure Registry logic, no PTY and no live fs.watch timing needed -- drainOutbox() is called
 * directly right after writing the file, same as verify-coordinator-status.js calls apply()
 * directly instead of waiting on a real hook.
 *
 * Run with: node tools/verify-worker-outbox.js
 */

require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const conv = require('../electron/conversations.js');
const paths = require('../electron/paths.js');
const { Registry } = require('../electron/events.js');

// Agent ids are fixed (readable, like the rest of this codebase's ids), so a prior run's
// malformed files -- deliberately left in place by drainOutbox() for a retry, same as
// watchSpawnRequests() leaves unparseable spawn requests -- would otherwise linger across runs.
for (const id of ['w1', 'w2', 'coord1']) {
  fs.rmSync(paths.agent(id).outbox, { recursive: true, force: true });
}

const conversation = conv.createConversation({ title: 'verify-outbox', cap: 3 });
const coordinatorWrites = [];
const registry = new Registry(() => {});

registry.register(
  { id: 'coord1', cwd: conv.conversationPaths(conversation.id).dir, task: 'coordina', pid: 1,
    write: (t) => coordinatorWrites.push(t), kill: () => {} },
  { conversationId: conversation.id, role: 'coordinator' },
);

// A worker spawned on the coordinator's behalf -- has somewhere to send an outbox message.
registry.register(
  { id: 'w1', cwd: 'C:/fake/repo', task: 'hace algo', pid: 2, write: () => {}, kill: () => {} },
  { conversationId: conversation.id, replyTo: 'coord1' },
);

// register() already sent the "arranco" notice for both agents once each (coord1 has no
// replyTo of its own, so only w1's counts) -- one write so far.
assert.strictEqual(coordinatorWrites.length, 1, 'solo el arranque de w1 deberia haber avisado hasta aca');

function writeOutboxFile(agentId, name, contents) {
  const { outbox } = paths.agent(agentId);
  fs.mkdirSync(outbox, { recursive: true });
  fs.writeFileSync(path.join(outbox, name), contents);
}

// A well-formed message: should reach the coordinator, tagged so it reads apart from the three
// automatic notices.
writeOutboxFile('w1', 'msg1.json', JSON.stringify({ message: 'encontre un bug en el parser' }));
registry.drainOutbox('w1');
assert.strictEqual(coordinatorWrites.length, 2, 'un mensaje bien formado deberia llegar al coordinador');
assert.match(coordinatorWrites[1], /mensaje.*encontre un bug/, 'el mensaje debe venir tageado como mensaje libre del worker');
assert.strictEqual(fs.readdirSync(paths.agent('w1').outbox).length, 0, 'el archivo actionado debe borrarse');

// Malformed JSON: must not crash the watcher, and must not produce a coordinator write.
writeOutboxFile('w1', 'bad1.json', '{ not valid json');
assert.doesNotThrow(() => registry.drainOutbox('w1'), 'un JSON invalido no debe hacer caer el drain');
assert.strictEqual(coordinatorWrites.length, 2, 'un JSON invalido no debe generar aviso al coordinador');

// Well-formed JSON, but missing the required "message" field: same treatment.
writeOutboxFile('w1', 'bad2.json', JSON.stringify({ note: 'sin campo message' }));
assert.doesNotThrow(() => registry.drainOutbox('w1'), 'un archivo sin "message" no debe hacer caer el drain');
assert.strictEqual(coordinatorWrites.length, 2, 'un archivo sin "message" no debe generar aviso al coordinador');

// A worker with NO coordinator (a bare desk:spawn call) has nowhere to send this -- not an
// error, just dropped and logged.
registry.register(
  { id: 'w2', cwd: 'C:/fake/repo2', task: 'trabajo suelto', pid: 3, write: () => {}, kill: () => {} },
  {},
);
writeOutboxFile('w2', 'msg1.json', JSON.stringify({ message: 'nadie me escucha' }));
assert.doesNotThrow(() => registry.drainOutbox('w2'), 'un worker sin coordinador no debe hacer caer el drain');
assert.strictEqual(coordinatorWrites.length, 2, 'un worker sin coordinador no debe generar aviso a nadie');

// events.jsonl is a global, append-only log shared across runs (agent ids are fixed and
// readable, not per-run uuids), so this checks the most recent matching entry, not an exact count.
const loggedLines = fs.readFileSync(paths.eventsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const dropped = loggedLines.filter((e) => e.event === 'OutboxDropped' && e.agentId === 'w2');
assert.ok(dropped.length >= 1, 'el mensaje sin coordinador debe quedar registrado como OutboxDropped');
const lastDropped = dropped[dropped.length - 1];
assert.strictEqual(lastDropped.payload.reason, 'no-coordinator');
assert.strictEqual(lastDropped.payload.message, 'nadie me escucha');

// After exited(), the real fs.watch on w1's outbox is already closed (exited() closes and
// deletes it from outboxWatchers, same as it always did for the hook-events watcher) -- so in
// production nothing drains a late write at all. What this asserts is the defensive half: even a
// direct drainOutbox() call against a dead worker's directory must not throw.
registry.exited('w1', 0);
assert.ok(!registry.outboxWatchers.has('w1'), 'exited() debe cerrar y borrar el watcher del outbox, igual que el del inbox');
writeOutboxFile('w1', 'late.json', JSON.stringify({ message: 'llego tarde' }));
assert.doesNotThrow(() => registry.drainOutbox('w1'), 'un drain manual tras exited() no debe caerse');

console.log('buzon de salida del worker OK: mensaje bien formado llega tageado, JSON invalido y sin "message" se ignoran sin caerse, sin coordinador queda logueado como OutboxDropped, sin caidas tras exited()');
// Same reason as verify-coordinator-status.js: register() leaves fs.watch instances per agent
// that would otherwise keep the process alive.
process.exit(0);
