// @ts-check
/**
 * MEASURED 2026-09-10: claude's and agy's workspace-trust dialogs show the same phrase but
 * default the cursor to opposite options (see agent.js's trustDialogFor doc comment). Pure
 * logic, no PTY needed — the live proof that this actually lands correctly on screen is
 * tools/verify-phase1.js for claude; agy's own live proof is blocked on the separate hooks gap.
 *
 * Run with: node tools/verify-trust-dialog.js
 */

const assert = require('node:assert');
const { trustDialogFor } = require('../electron/agent.js');

for (const bin of ['claude', 'C:\\Users\\dev\\.local\\bin\\claude.exe']) {
  const { engine, keys } = trustDialogFor(bin);
  assert.strictEqual(engine, 'claude', `"${bin}" deberia resolver a claude`);
  assert.deepStrictEqual(keys, ['\x1b[B', '\r'],
    'claude arranca en "No, exit": hace falta bajar una flecha antes de confirmar');
}

for (const bin of ['agy', 'C:\\Users\\dev\\AppData\\Local\\agy\\bin\\agy.exe']) {
  const { engine, keys } = trustDialogFor(bin);
  assert.strictEqual(engine, 'agy', `"${bin}" deberia resolver a agy`);
  assert.deepStrictEqual(keys, ['\r'],
    'agy ya arranca en "Yes, I trust this folder": bajar una flecha confirmaria "No, exit" por error');
}

// A bin nobody has wired yet must default to claude's shape, the only one actually exercised
// live today — never to agy's, which would be the wrong guess for an engine no one measured.
const unknown = trustDialogFor('some-future-cli');
assert.strictEqual(unknown.engine, 'claude');

console.log('dialogo de confianza OK: claude baja una flecha antes de confirmar, agy confirma '
  + 'directo, y un motor sin medir cae al comportamiento de claude, no al de agy');
