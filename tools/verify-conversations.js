// @ts-check
/**
 * Conversation-as-folder: create, list, and confirm the on-disk shape is what the coordinator
 * (once it exists) and the scheduler both need to read.
 *
 * Run with: node tools/verify-conversations.js
 */

require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const conv = require('../electron/conversations.js');

const created = conv.createConversation({
  title: 'prueba de verificacion',
  cap: 2,
  engine: 'agy',
  model: 'gemini-3.8-flash-low',
  effort: 'low',
  mode: 'plan',
});
assert.ok(created.id, 'deberia asignar un id');
assert.strictEqual(created.cap, 2);
assert.strictEqual(created.engine, 'agy');
assert.strictEqual(created.model, 'gemini-3.8-flash-low');
assert.strictEqual(created.effort, 'low');
assert.strictEqual(created.mode, 'plan');
assert.ok(fs.existsSync(conv.conversationPaths(created.id).conversation));
assert.ok(fs.existsSync(conv.conversationPaths(created.id).agents), 'deberia crear su carpeta de agentes');

const fetched = conv.getConversation(created.id);
assert.deepStrictEqual(fetched, created);

const listed = conv.listConversations();
assert.ok(listed.some((c) => c.id === created.id), 'deberia aparecer en el listado');

// runningInConversation reads the registry's live agent map, not the folder -- status.json is
// for display, scheduling has to see the truth as of right now.
const fakeAgents = new Map([
  ['a1', { conversationId: created.id }],
  ['a2', { conversationId: created.id }],
  ['a3', { conversationId: 'otra-conversacion' }],
]);
assert.strictEqual(conv.runningInConversation(created.id, fakeAgents), 2);
assert.strictEqual(conv.runningInConversation('otra-conversacion', fakeAgents), 1);
assert.strictEqual(conv.runningInConversation('sin-agentes', fakeAgents), 0);

conv.writeStatus(created.id, { a1: { state: 'thinking' } });
const status = JSON.parse(fs.readFileSync(conv.conversationPaths(created.id).status, 'utf8'));
assert.deepStrictEqual(status, { a1: { state: 'thinking' } });

const archived = conv.archiveConversation(created.id);
assert.strictEqual(archived.status, 'archived');
assert.ok(archived.archivedAt);
assert.strictEqual(conv.getConversation(created.id).status, 'archived');

// deleteConversation tests
// 1. Rejects invalid or malicious id
assert.strictEqual(conv.deleteConversation('../escaped').ok, false, 'deberia rechazar path traversal');
assert.strictEqual(conv.deleteConversation('').ok, false, 'deberia rechazar id vacio');

// 2. Refuses deletion if agents are alive
const busyAgents = new Map([['live1', { conversationId: created.id, state: 'thinking' }]]);
const refuseRes = conv.deleteConversation(created.id, { agents: busyAgents });
assert.strictEqual(refuseRes.ok, false, 'deberia rechazar eliminacion con agentes vivos');
assert.ok(refuseRes.error.includes('agentes activos'));

// 3. Deletes successfully when no agents are alive
const delRes = conv.deleteConversation(created.id, { agents: new Map() });
assert.strictEqual(delRes.ok, true, 'deberia eliminar la conversacion');
assert.strictEqual(fs.existsSync(conv.conversationPaths(created.id).dir), false, 'el directorio ya no debe existir');
assert.strictEqual(conv.getConversation(created.id), null, 'getConversation debe retornar null');
assert.ok(!conv.listConversations().some((c) => c.id === created.id), 'ya no debe aparecer en listConversations');

// 4. Conversation with custom cwd
const customCwd = conv.createConversation({ title: 'con cwd', cwd: '.' });
assert.ok(customCwd.cwd, 'deberia persistir cwd');
conv.deleteConversation(customCwd.id);

console.log('conversaciones OK: crear con cwd, listar, leer, archivar, eliminar con seguridad y contar agentes vivos');
