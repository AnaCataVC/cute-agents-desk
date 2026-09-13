// @ts-check
/**
 * Runs every fast, self-contained verify-*.js script in one shot and prints one pass/fail line
 * per script plus a summary -- the thing missing before this: each script only documented its
 * own "Run with: ...", so checking the suite meant finding and running them one at a time.
 *
 * "Fast" here is MEASURED, not guessed from a script's name or its own header comment: these
 * complete in seconds under plain `node`, spawning no live claude/agy CLI turn and no real
 * Electron window. The excluded ones do one or both -- slow, real API cost, and (for the ones
 * needing a BrowserWindow) unable to finish at all in a headless shell, where `app.whenReady()`
 * never resolves. Those stay manual and opt-in; each still documents its own "Run with:".
 *
 * Run with: npm test
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const FAST = [
  'verify-pure-units.js',
  'verify-agent-lifecycle-mock.js',
  'verify-scheduler.js',
  'verify-trust-dialog.js',
  'verify-conversations.js',
  'verify-coordinator.js',
  'verify-coordinator-status.js',
  'verify-worker-outbox.js',
  'verify-token-cap.js',
  'verify-forced-kill.js',
  'verify-worktree-isolation.js',
  'verify-discovery.js',
  'verify-live-repo-data.mjs',
  'verify-scheduled-tasks.js',
  'verify-models-effort-modes.js',
  'verify-agy-worktree.js',
  'verify-delivery.js',
  'verify-skills.js',
  'verify-tokens-and-accounts.js',
  'verify-config.js',
  'verify-hierarchical-repo-tree.mjs',
  'verify-quotas.js',
  'verify-flows-synthesis.mjs',
  'verify-chat-input.js',
  'verify-timeline.js',
  'verify-scheduler-dag.js',
];

const MANUAL = [
  ['verify-dist-binary.js', 'node tools/verify-dist-binary.js'],
  ['verify-phase1.js', 'npm run verify'],
  ['verify-agy-phase1.js', 'node tools/verify-agy-phase1.js'],
  ['verify-read-mode.js', 'node_modules/electron/dist/electron.exe tools/verify-read-mode.js'],
  ['verify-hook-isolation.js', 'node_modules/electron/dist/electron.exe tools/verify-hook-isolation.js'],
  ['verify-coordinator-e2e.js', 'node_modules/electron/dist/electron.exe tools/verify-coordinator-e2e.js'],
];

const results = FAST.map((file) => {
  const startedAt = Date.now();
  const run = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8' });
  return { file, ok: run.status === 0, ms: Date.now() - startedAt, output: (run.stdout || '') + (run.stderr || '') };
});

for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.file.padEnd(30)} (${r.ms}ms)`);
  if (!r.ok) console.log(r.output.trim().split('\n').map((l) => `        ${l}`).join('\n'));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verify scripts OK`);
if (failed.length) console.log(`fallaron: ${failed.map((r) => r.file).join(', ')}`);

console.log(`\n${MANUAL.length} mas necesitan un CLI real o una ventana Electron -- corren aparte:`);
for (const [file, cmd] of MANUAL) console.log(`  ${file.padEnd(30)} ${cmd}`);

process.exit(failed.length ? 1 : 0);
