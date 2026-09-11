// @ts-check
/**
 * Verification #5 from the plan, done as a unit check instead of a live CLI run: a real agent's
 * first status render already carries tens of thousands of tokens (system prompt, tool specs,
 * cache), so hitting "warn at 80%, kill at 100%" cleanly through an actual session means either
 * guessing a cap that happens to straddle that number or burning several real turns to widen the
 * gap — expensive and flaky for what is pure state-machine logic. `Registry.enforceTokenCap`
 * takes no Electron API and no PTY, so it is exercised directly with synthetic Status reports.
 *
 * Run with: node tools/verify-token-cap.js
 */

require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const paths = require('../electron/paths.js');
const { Registry } = require('../electron/events.js');

const written = [];
const killed = [];
const registry = new Registry(() => {});
const agent = {
  id: 'probe', cwd: 'C:/fake', task: 'x', pid: 1,
  write: (t) => written.push(t),
  kill: () => killed.push(true),
};
registry.register(agent, { tokenCap: 1000 });

const statusWith = (tokens) => ({
  event: 'Status',
  at: new Date().toISOString(),
  payload: { context_window: { total_input_tokens: tokens, total_output_tokens: 0 } },
});

// Below the warning threshold: nothing happens.
registry.apply('probe', statusWith(700));
assert.strictEqual(written.length, 0, 'no deberia avisar bajo 80%');
assert.strictEqual(killed.length, 0, 'no deberia matar bajo 80%');
assert.strictEqual(registry.agents.get('probe').state, 'spawning');

// Crosses 80%: one warning, agent kept alive.
registry.apply('probe', statusWith(850));
assert.strictEqual(written.length, 1, 'deberia avisar una vez al cruzar 80%');
assert.strictEqual(killed.length, 0, 'el aviso no debe matar la sesion');

// Still above 80% on the next render: must not nag twice.
registry.apply('probe', statusWith(900));
assert.strictEqual(written.length, 1, 'no debe repetir el aviso en la misma sesion');

// Crosses 100%: killed, marked failed(token-cap).
registry.apply('probe', statusWith(1100));
assert.strictEqual(killed.length, 1, 'deberia matar la sesion al llegar a 100%');
const state = registry.agents.get('probe');
assert.strictEqual(state.state, 'failed');
assert.strictEqual(state.failReason, 'token-cap');

// A further Status after the kill must not re-trigger anything (state is already 'failed').
registry.apply('probe', statusWith(1200));
assert.strictEqual(killed.length, 1, 'no debe matar dos veces');
assert.strictEqual(written.length, 1, 'no debe avisar despues de matar');

fs.rmSync(paths.agent('probe').dir, { recursive: true, force: true });
console.log('tope de tokens OK: avisa una vez al 80%, mata al 100%, no repite ninguno de los dos');
// register() leaves an fs.watch on the agent's inbox; nothing else here keeps the loop alive,
// so without this the process just hangs instead of exiting.
process.exit(0);
