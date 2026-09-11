// @ts-check
/**
 * Verification for agy engine worktree isolation and semantic branch naming.
 *
 * Confirms that:
 * 1. `createWorktree` with engine 'agy' creates a dedicated branch `agy/<task-slug>-<id>`
 *    outside the base repository.
 * 2. `worktree.json` is excluded and does not pollute `git status`.
 * 3. Changes made inside the worktree remain completely isolated from the base repository.
 * 4. `listWorktrees` tracks the worktree and `removeWorktree` cleans it up cleanly.
 *
 * Run with: node tools/verify-agy-worktree.js
 */

require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { git } = require('../electron/git.js');
const worktree = require('../electron/worktree.js');
const { toyRepo } = require('../electron/toy-repo.js');

const toyRepoPath = toyRepo();
const AGENT_ID = 'agywt1';
const TASK = 'optimizar rutas de cache';

function cleanup() {
  try { worktree.removeWorktree(AGENT_ID); } catch { /* best effort */ }
  try { fs.rmSync(toyRepoPath, { recursive: true, force: true }); } catch { /* best effort */ }
}

(async () => {
  const originalBranch = git(toyRepoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);

  const worktreeDir = worktree.createWorktree(toyRepoPath, AGENT_ID, { engine: 'agy', task: TASK });
  assert.ok(fs.existsSync(worktreeDir), 'el worktree de agy debe existir en disco');
  assert.ok(!worktreeDir.startsWith(toyRepoPath), 'el worktree de agy debe vivir fuera del repo base');

  const branch = git(worktreeDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  assert.ok(branch.startsWith('agy/optimizar-rutas-de-cache-'), `la rama debe tener prefijo agy y slug de tarea, recibio: ${branch}`);

  // worktree.json must be excluded and not show up as untracked in git status
  const status = git(worktreeDir, ['status', '--porcelain']);
  assert.strictEqual(status.trim(), '', 'el worktree recien creado debe estar limpio (worktree.json ignorado)');

  let listed = await worktree.listWorktrees();
  let entry = listed.find((w) => w.agentId === AGENT_ID);
  assert.ok(entry, 'listWorktrees debe incluir el worktree de agy');
  assert.strictEqual(entry.repoPath, toyRepoPath);
  assert.strictEqual(entry.hasUncommittedChanges, false);

  // Write a file in the worktree
  fs.writeFileSync(path.join(worktreeDir, 'nuevo-archivo-agy.js'), 'console.log("hola agy");\n');
  listed = await worktree.listWorktrees();
  entry = listed.find((w) => w.agentId === AGENT_ID);
  assert.strictEqual(entry.hasUncommittedChanges, true, 'debe detectar el cambio sin commitear en el worktree de agy');

  // Verify base repo checkout is 100% clean and untouched
  assert.strictEqual(git(toyRepoPath, ['status', '--porcelain']), '', 'el repo base no debe tener cambios');
  assert.strictEqual(git(toyRepoPath, ['rev-parse', '--abbrev-ref', 'HEAD']), originalBranch,
    'el repo base debe permanecer en su rama original');

  // Reap cleanup
  worktree.removeWorktree(AGENT_ID);
  assert.ok(!fs.existsSync(worktreeDir), 'el directorio del worktree debe desaparecer tras el reap');
  listed = await worktree.listWorktrees();
  assert.ok(!listed.some((w) => w.agentId === AGENT_ID), 'ya no debe listarse tras el reap');

  console.log('agy worktree OK: rama agy/<slug>-<id> aislada, worktree.json excluido, y repo base protegido');
})().then(() => {
  cleanup();
  process.exit(0);
}).catch((err) => {
  cleanup();
  console.error('FAIL verify-agy-worktree:', err);
  process.exit(1);
});
