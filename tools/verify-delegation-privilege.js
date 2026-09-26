'use strict';
// @ts-check
/**
 * A coordinator must not be able to delegate more privilege than it holds. The decision itself is
 * `delegationRefusal` in electron/read-mode.js; main.js's spawnWorker is the single place that calls it,
 * on the coordinator's spawn-request path only.
 */
require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mayDelegate, isWritingMode, delegationRefusal } = require('../electron/read-mode.js');

// Which modes can touch files at all: `auto` is write with fewer prompts, so it counts.
assert.strictEqual(isWritingMode('write'), true);
assert.strictEqual(isWritingMode('auto'), true);
assert.strictEqual(isWritingMode('read'), false);
assert.strictEqual(isWritingMode('plan'), false);
// An absent mode is write, matching agent.js's own default -- a read-mode coordinator that simply
// omits "mode" would otherwise get a writing worker for free.
assert.strictEqual(isWritingMode(undefined), true);

// A writing coordinator delegates anything.
for (const task of ['write', 'auto', 'plan', 'read', undefined]) {
  assert.strictEqual(mayDelegate('write', task), true, `write -> ${task}`);
  assert.strictEqual(mayDelegate('auto', task), true, `auto -> ${task}`);
}

// A non-writing coordinator delegates only non-writing work.
for (const boss of ['read', 'plan']) {
  assert.strictEqual(mayDelegate(boss, 'read'), true, `${boss} -> read`);
  assert.strictEqual(mayDelegate(boss, 'plan'), true, `${boss} -> plan`);
  assert.strictEqual(mayDelegate(boss, 'write'), false, `${boss} -> write`);
  assert.strictEqual(mayDelegate(boss, 'auto'), false, `${boss} -> auto`);
  assert.strictEqual(mayDelegate(boss, undefined), false, `${boss} -> (sin modo)`);
}

// agent.js lowercases a mode before validating it, so the gate must compare the same canonical
// form: otherwise "Write" or "AUTO" passes the gate and then runs as a writing worker anyway.
for (const task of ['Write', 'AUTO', ' write ', 'Auto']) {
  assert.strictEqual(isWritingMode(task), true, `"${task}" es escritura`);
  assert.strictEqual(mayDelegate('read', task), false, `read -> "${task}"`);
  assert.notStrictEqual(delegationRefusal({ mode: 'read' }, task), null, `refusal read -> "${task}"`);
}
assert.strictEqual(mayDelegate(' READ ', 'Plan'), true);
assert.strictEqual(mayDelegate('WRITE', 'write'), true);

// The refusal helper: null lets the spawn through, a string is the reason given back.
assert.strictEqual(delegationRefusal({ mode: 'write' }, 'auto'), null);
assert.strictEqual(delegationRefusal({ mode: 'plan' }, 'read'), null);
assert.match(delegationRefusal({ mode: 'plan' }, undefined), /modo plan.*modo write/);
// A coordinator missing from the registry fails closed: its mode cannot be checked.
assert.strictEqual(typeof delegationRefusal(undefined, 'read'), 'string');
assert.strictEqual(typeof delegationRefusal(null, 'read'), 'string');

// The gate is worth nothing if nobody calls it, and spawnWorker lives inside Electron's main
// process, out of reach of a plain-node test. So assert the wiring by reading it: the call must
// exist, and it must be reached only from the coordinator's own request path.
const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
// The refusal must be computed from the registry lookup itself (so a missing coordinator reaches
// the helper and fails closed) and must actually end the spawn with that reason.
assert.match(
  main,
  /const reason = delegationRefusal\(registry\.agents\.get\(replyTo\), mode\);\s*if \(reason\) \{[\s\S]*?return \{ error: reason \};/,
  'spawnWorker ya no devuelve el rechazo de delegationRefusal',
);
assert.match(main, /mode = normalizeMode\(mode\);[\s\S]*?delegationRefusal/, 'spawnWorker ya no normaliza el modo antes del gate');
assert.match(main, /viaCoordinator && replyTo/, 'el gate dejo de restringirse al camino del coordinador');
assert.match(main, /viaCoordinator: true/, 'watchSpawnRequests ya no marca el pedido como del coordinador');

console.log('OK verify-delegation-privilege: un coordinador en modo lectura o plan no puede delegar tareas de escritura (ni omitiendo "mode"), un coordinador de escritura delega cualquier modo, y el gate sigue cableado en spawnWorker solo para el camino del coordinador.');
process.exit(0);
