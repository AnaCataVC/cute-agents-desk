// @ts-check
/**
 * Verification for delivery pipeline:
 * 1. Title, body, and author formatting.
 * 2. Uncommitted worktree changes committing under the account's identity.
 * 3. Branch pushing to origin without mutating base repository or base branch.
 * 4. Delivery record persistence in deliveries.json.
 *
 * Run with: node tools/verify-delivery.js
 */

require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const paths = require('../electron/paths.js');
const { git } = require('../electron/git.js');
const worktree = require('../electron/worktree.js');
const delivery = require('../electron/delivery.js');
const { makeDisposableRepo } = require('./test-helpers.js');

const AGENT_ID = 'deliv_test1';
const TASK = 'cachear rutas de api';

// 1. Test pure helpers
assert.strictEqual(delivery.formatPrTitle('optimizar sql'), 'feat: optimizar sql');
assert.strictEqual(delivery.formatPrTitle('fix: correcion de bug'), 'fix: correcion de bug');
assert.strictEqual(delivery.formatPrTitle('', 'chore(dwh): tags'), 'chore(dwh): tags');

const authorWithEmail = delivery.resolveAuthor({ gh: 'cata', name: 'Cata V', email: 'cata@example.com' });
assert.strictEqual(authorWithEmail.name, 'Cata V');
assert.strictEqual(authorWithEmail.email, 'cata@example.com');

const authorWithoutEmail = delivery.resolveAuthor({ gh: 'devuser' });
assert.strictEqual(authorWithoutEmail.name, 'devuser');
assert.strictEqual(authorWithoutEmail.email, 'devuser@users.noreply.github.com');

// 2. Test delivery storage
const initial = delivery.listDeliveries();
assert.ok(Array.isArray(initial));

const sample = { id: 'test-sample', agentId: 'test-sample', repo: 'toy', pr: 'PR #1 · borrador' };
delivery.saveDelivery(sample);
const updated = delivery.listDeliveries();
assert.ok(updated.some((d) => d.id === 'test-sample'));

// 3. Test end-to-end deliverAgent on disposable repo with local bare remote
const srcRepo = makeDisposableRepo('cute-test-deliv-src-');
const bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'cute-test-deliv-bare-'));
git(bareRemote, ['init', '--bare', '-q']);
git(srcRepo, ['remote', 'add', 'origin', bareRemote]);

function cleanup() {
  try { worktree.removeWorktree(AGENT_ID); } catch { /* best effort */ }
  try { fs.rmSync(srcRepo, { recursive: true, force: true }); } catch { /* best effort */ }
  try { fs.rmSync(bareRemote, { recursive: true, force: true }); } catch { /* best effort */ }
}

(async () => {
  const originalBaseBranch = git(srcRepo, ['rev-parse', '--abbrev-ref', 'HEAD']);

  // Create worktree
  const wtDir = worktree.createWorktree(srcRepo, AGENT_ID, { engine: 'claude', task: TASK });
  assert.ok(fs.existsSync(wtDir));

  // Mock agent harness files
  const agentDirs = paths.agent(AGENT_ID);
  fs.mkdirSync(agentDirs.dir, { recursive: true });
  fs.writeFileSync(agentDirs.manifest, JSON.stringify({
    id: AGENT_ID,
    cwd: srcRepo,
    worktreeCwd: wtDir,
    task: TASK,
    engine: 'claude',
    mode: 'write',
  }, null, 2));
  fs.writeFileSync(agentDirs.report, '# Reporte de prueba\nTodo salio bien.\n');

  // Introduce dirty file into worktree
  fs.writeFileSync(path.join(wtDir, 'src_routes.js'), 'export function route() { return 42; }\n');
  assert.strictEqual(git(wtDir, ['status', '--porcelain']).trim().length > 0, true, 'el worktree debe tener cambios');

  // An agent without a harness worktree (read/plan, coordinator) must be refused, never delivered
  // from the user's own checkout.
  const refused = await delivery.deliverAgent({ agentId: `${AGENT_ID}-sin-worktree` });
  assert.strictEqual(refused.ok, false, 'un agente sin worktree no debe poder entregarse');

  // Execute delivery
  const res = await delivery.deliverAgent({ agentId: AGENT_ID });
  assert.strictEqual(res.ok, true, `deliverAgent fallo: ${res.error}`);
  assert.ok(res.delivery);
  assert.strictEqual(res.delivery.agentId, AGENT_ID);
  assert.strictEqual(res.delivery.repo, path.basename(srcRepo));
  assert.ok(res.delivery.branch.startsWith('claude/cachear-rutas-de-api-'));

  // Worktree must now be clean after commit
  const wtStatus = git(wtDir, ['status', '--porcelain']);
  assert.strictEqual(wtStatus.trim(), '', 'el worktree debe haber commiteado todos sus cambios');

  // Check commit author
  const commitAuthor = git(wtDir, ['log', '-1', '--pretty=format:%an <%ae>']);
  assert.ok(commitAuthor.includes(res.delivery.author.name));

  // Branch must be pushed to bare remote
  const remoteBranches = git(bareRemote, ['branch', '--list', res.delivery.branch]);
  assert.ok(remoteBranches.includes(res.delivery.branch), 'la rama debe haber sido empujada al remoto origin');

  // Base repo must not be touched
  assert.strictEqual(git(srcRepo, ['status', '--porcelain']), '', 'el repo base debe seguir limpio');
  assert.strictEqual(git(srcRepo, ['rev-parse', '--abbrev-ref', 'HEAD']), originalBaseBranch,
    'el repo base no debe cambiar de rama');

  // Persisted in deliveries.json
  const allDelivered = delivery.listDeliveries();
  assert.ok(allDelivered.some((d) => d.agentId === AGENT_ID));

  console.log('delivery OK: autor asignado, commit de worktree, push a origin sin mutar main, y registro en deliveries.json');
})().then(() => {
  cleanup();
  process.exit(0);
}).catch((err) => {
  cleanup();
  console.error('FAIL verify-delivery:', err);
  process.exit(1);
});
