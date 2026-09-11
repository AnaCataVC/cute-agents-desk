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

const created = conv.createConversation({ title: 'prueba de verificacion', cap: 2 });
assert.ok(created.id, 'deberia asignar un id');
assert.strictEqual(created.cap, 2);
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

fs.rmSync(conv.conversationPaths(created.id).dir, { recursive: true, force: true });
console.log('conversaciones OK: crear, listar, leer y contar agentes vivos por conversacion');
