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
try {
  const originalBranch = git(toyRepoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);

  const worktreeDir = worktree.createWorktree(toyRepoPath, AGENT_ID);
  assert.ok(fs.existsSync(worktreeDir), 'el worktree deberia existir en disco');
  assert.ok(!worktreeDir.startsWith(toyRepoPath), 'el worktree debe vivir fuera del repo base');
  assert.strictEqual(git(worktreeDir, ['rev-parse', '--abbrev-ref', 'HEAD']), `agent/${AGENT_ID}`,
    'debe quedar en su propia rama agent/<id>');

  let listed = worktree.listWorktrees();
  let entry = listed.find((w) => w.agentId === AGENT_ID);
  assert.ok(entry, 'listWorktrees debe incluir el worktree recien creado');
  assert.strictEqual(entry.repoPath, toyRepoPath);
  assert.strictEqual(entry.hasUncommittedChanges, false, 'recien creado, sin cambios propios');

  fs.writeFileSync(path.join(worktreeDir, 'nuevo.txt'), 'cambio sin commitear\n');
  listed = worktree.listWorktrees();
  entry = listed.find((w) => w.agentId === AGENT_ID);
  assert.ok(entry, 'sigue apareciendo tras el cambio');
  assert.strictEqual(entry.hasUncommittedChanges, true, 'un archivo sin commitear debe marcarse');

  worktree.removeWorktree(AGENT_ID);
  assert.ok(!fs.existsSync(worktreeDir), 'el directorio del worktree debe desaparecer');
  listed = worktree.listWorktrees();
  assert.ok(!listed.some((w) => w.agentId === AGENT_ID), 'ya no debe listarse tras el reap');

  assert.strictEqual(git(toyRepoPath, ['status', '--porcelain']), '',
    'el repo base debe seguir limpio');
  assert.strictEqual(git(toyRepoPath, ['rev-parse', '--abbrev-ref', 'HEAD']), originalBranch,
    'el repo base debe seguir en su propia rama original, sin moverse a agent/<id>');

  console.log('worktree OK: crea el worktree en agent/<id> fuera del repo, lo lista, detecta cambios sin commitear, y el reap lo borra sin tocar el repo base');
  process.exit(0);
} finally {
  try { worktree.removeWorktree(AGENT_ID); } catch { /* already gone, or never got that far */ }
  fs.rmSync(toyRepoPath, { recursive: true, force: true });
}
