// @ts-check
/**
 * Unit check for the global parallelism cap. Pure logic, no PTY -- proving "the 6th spawn gets
 * refused" through a live Electron run would mean actually keeping 5 real CLI sessions alive at
 * once, which is exactly the kind of cost a cap exists to avoid spending just to test the cap.
 *
 * Run with: node tools/verify-scheduler.js
 */

const assert = require('node:assert');
const { Scheduler, DEFAULT_GLOBAL_CAP } = require('../electron/scheduler.js');

const scheduler = new Scheduler({ globalCap: 3 });

assert.strictEqual(scheduler.canSpawn(0).ok, true);
assert.strictEqual(scheduler.canSpawn(2).ok, true);
const refused = scheduler.canSpawn(3);
assert.strictEqual(refused.ok, false, 'a la cuota exacta debe rechazar, no esperar a pasarse');
assert.ok(/3\/3/.test(refused.reason), 'el motivo debe decir cuanto hay y cual es el tope');
assert.strictEqual(scheduler.canSpawn(4).ok, false, 'sobre la cuota tambien rechaza');

assert.strictEqual(new Scheduler().globalCap, DEFAULT_GLOBAL_CAP, 'sin config, usa el default documentado');

// Per-conversation cap: refuses on its own count against its own cap, independent of the global
// count -- plenty of global room left, but this conversation is still full.
const roomy = new Scheduler({ globalCap: 100 });
assert.strictEqual(roomy.canSpawn(10, { cap: 2, running: 2 }).ok, false,
  'lleno cupo de conversacion debe rechazar aunque el global tenga espacio de sobra');
assert.strictEqual(roomy.canSpawn(10, { cap: 2, running: 1 }).ok, true);
// The global cap still applies even when the conversation itself has room.
assert.strictEqual(scheduler.canSpawn(3, { cap: 10, running: 0 }).ok, false,
  'el tope global debe seguir rechazando aunque la conversacion tenga cupo');

console.log(`scheduler OK: acepta bajo el tope, rechaza en el tope y sobre el tope (default ${DEFAULT_GLOBAL_CAP}), y el tope por conversacion es independiente del global`);
