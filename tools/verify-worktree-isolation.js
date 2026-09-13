// @ts-check
/**
 * Proves write-mode isolation end to end against a real, throwaway git repo (not this project,
 * not anything under Archivos Trabajo): create a worktree, see it listed, dirty it, then reap it
 * and confirm the base repo never felt it.
 *
 * Run with: node tools/verify-worktree-isolation.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const worktree = require('../electron/worktree.js');
const { git } = require('../electron/git.js');
const { makeDisposableRepo } = require('./test-helpers.js');

const AGENT_ID = 'test-agent-1';

const toyRepoPath = makeDisposableRepo('cute-agents-desk-wt-toy-');

function cleanup() {
  try { worktree.removeWorktree(AGENT_ID); } catch { /* already gone, or never got that far */ }
  fs.rmSync(toyRepoPath, { recursive: true, force: true });
}

(async () => {
  const originalBranch = git(toyRepoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);

  const worktreeDir = worktree.createWorktree(toyRepoPath, AGENT_ID);
  assert.ok(fs.existsSync(worktreeDir), 'el worktree deberia existir en disco');
  assert.ok(!worktreeDir.startsWith(toyRepoPath), 'el worktree debe vivir fuera del repo base');
  assert.strictEqual(git(worktreeDir, ['rev-parse', '--abbrev-ref', 'HEAD']), `agent/${AGENT_ID}`,
    'debe quedar en su propia rama agent/<id>');

  let listed = await worktree.listWorktrees();
  let entry = listed.find((w) => w.agentId === AGENT_ID);
  assert.ok(entry, 'listWorktrees debe incluir el worktree recien creado');
  assert.strictEqual(entry.repoPath, toyRepoPath);
  assert.strictEqual(entry.hasUncommittedChanges, false, 'recien creado, sin cambios propios');

  fs.writeFileSync(path.join(worktreeDir, 'nuevo.txt'), 'cambio sin commitear\n');
  listed = await worktree.listWorktrees();
  entry = listed.find((w) => w.agentId === AGENT_ID);
  assert.ok(entry, 'sigue apareciendo tras el cambio');
  assert.strictEqual(entry.hasUncommittedChanges, true, 'un archivo sin commitear debe marcarse');

  worktree.removeWorktree(AGENT_ID);
  assert.ok(!fs.existsSync(worktreeDir), 'el directorio del worktree debe desaparecer');
  listed = await worktree.listWorktrees();
  assert.ok(!listed.some((w) => w.agentId === AGENT_ID), 'ya no debe listarse tras el reap');

  assert.strictEqual(git(toyRepoPath, ['status', '--porcelain']), '',
    'el repo base debe seguir limpio');
  assert.strictEqual(git(toyRepoPath, ['rev-parse', '--abbrev-ref', 'HEAD']), originalBranch,
    'el repo base debe seguir en su propia rama original, sin moverse a agent/<id>');

  // --- Test reapCleanWorktrees: clean vs dirty vs running --------------------------------------
  const ID_CLEAN = 'wt-batch-clean';
  const ID_DIRTY = 'wt-batch-dirty';
  const ID_RUNNING = 'wt-batch-running';

  const dirClean = worktree.createWorktree(toyRepoPath, ID_CLEAN);
  const dirDirty = worktree.createWorktree(toyRepoPath, ID_DIRTY);
  const dirRunning = worktree.createWorktree(toyRepoPath, ID_RUNNING);

  fs.writeFileSync(path.join(dirDirty, 'dirty.txt'), 'cambio pendiente\n');

  const reapRes = await worktree.reapCleanWorktrees({ runningAgentIds: [ID_RUNNING] });

  assert.strictEqual(reapRes.totalReaped, 1, 'solo debe podar el worktree limpio e inactivo');
  assert.ok(reapRes.reaped.includes(ID_CLEAN), 'debe haber podado ID_CLEAN');
  assert.ok(!fs.existsSync(dirClean), 'dirClean ya no debe existir en disco');

  assert.ok(reapRes.skipped.some((s) => s.agentId === ID_DIRTY && s.reason === 'dirty'),
    'debe haber conservado ID_DIRTY por cambios pendientes');
  assert.ok(fs.existsSync(dirDirty), 'dirDirty debe seguir existiendo intacto');

  assert.ok(reapRes.skipped.some((s) => s.agentId === ID_RUNNING && s.reason === 'running'),
    'debe haber conservado ID_RUNNING por agente vivo');
  assert.ok(fs.existsSync(dirRunning), 'dirRunning debe seguir existiendo intacto');

  // Limpieza manual de los dos conservados
  worktree.removeWorktree(ID_DIRTY);
  worktree.removeWorktree(ID_RUNNING);

  console.log('reapCleanWorktrees OK: poda worktrees limpios, pero conserva incondicionalmente agentes vivos y trabajo sucio');
  console.log('worktree OK: crea el worktree en agent/<id> fuera del repo, lo lista, detecta cambios sin commitear, y el reap lo borra sin tocar el repo base');
})().then(() => {
  // `process.exit()` never returns, so cleanup has to run before it, not after -- a `.finally()`
  // chained onto this promise would never get scheduled once the process has already exited.
  cleanup();
  process.exit(0);
}, (err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
