// @ts-check
/**
 * Verification for multi-repo parent workspace support in coordinator:
 * 1. Default disabled: multiRepoWorkspace is false when omitted.
 * 2. Conversations persistence: multiRepoWorkspace flag is saved and reloaded.
 * 3. Coordinator prompt generation:
 *    - With multiRepoWorkspace = false, umbrella prompt is NOT included.
 *    - With multiRepoWorkspace = true, umbrella prompt identifies sub-repositories and delegation directives.
 *
 * Run with: node tools/verify-multi-repo-workspace.js
 */

require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const conv = require('../electron/conversations.js');
const coordinator = require('../electron/coordinator.js');
const { git } = require('../electron/git.js');

// Setup temporary umbrella folder with 2 sub-repos
const umbrellaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cute-test-umbrella-'));
const subRepoA = path.join(umbrellaDir, 'service-auth');
const subRepoB = path.join(umbrellaDir, 'service-payments');

fs.mkdirSync(subRepoA, { recursive: true });
fs.mkdirSync(subRepoB, { recursive: true });

git(subRepoA, ['init', '-q']);
git(subRepoB, ['init', '-q']);

// Dummy git config to make them valid repos
git(subRepoA, ['config', 'user.email', 'test@example.com']);
git(subRepoA, ['config', 'user.name', 'Test']);
git(subRepoB, ['config', 'user.email', 'test@example.com']);
git(subRepoB, ['config', 'user.name', 'Test']);

function cleanup() {
  try { fs.rmSync(umbrellaDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

try {
  // 1. Check default disabled in createConversation
  const defaultConv = conv.createConversation({
    title: 'Default Conv',
    topic: 'Testing default settings',
    cwd: umbrellaDir,
  });
  assert.strictEqual(defaultConv.multiRepoWorkspace, false, 'multiRepoWorkspace must be false by default');

  const reloadedDefault = conv.getConversation(defaultConv.id);
  assert.strictEqual(reloadedDefault.multiRepoWorkspace, false, 'persisted conversation must keep multiRepoWorkspace = false');

  // Verify coordinator prompt with multiRepoWorkspace = false
  const promptDefault = coordinator.buildCoordinatorPrompt(defaultConv, [], { effectiveCwd: umbrellaDir });
  assert.ok(!promptDefault.includes('MODO WORKSPACE MULTI-REPO ACTIVADO'), 'Standard prompt should not contain umbrella workspace header when disabled');

  // 2. Check explicitly enabled multiRepoWorkspace
  const multiConv = conv.createConversation({
    title: 'Multi-repo Conv',
    topic: 'Testing umbrella parent folder',
    cwd: umbrellaDir,
    multiRepoWorkspace: true,
  });
  assert.strictEqual(multiConv.multiRepoWorkspace, true, 'multiRepoWorkspace must be true when explicitly passed');

  const reloadedMulti = conv.getConversation(multiConv.id);
  assert.strictEqual(reloadedMulti.multiRepoWorkspace, true, 'persisted conversation must keep multiRepoWorkspace = true');

  // Verify coordinator prompt with multiRepoWorkspace = true
  const promptMulti = coordinator.buildCoordinatorPrompt(multiConv, [], { effectiveCwd: umbrellaDir });
  assert.ok(promptMulti.includes('MODO WORKSPACE MULTI-REPO ACTIVADO:'), 'Prompt must include umbrella workspace header when enabled');
  assert.ok(promptMulti.includes('service-auth'), 'Prompt must list detected sub-repo service-auth');
  assert.ok(promptMulti.includes('service-payments'), 'Prompt must list detected sub-repo service-payments');
  assert.ok(promptMulti.includes('especifica el sub-repo correspondiente en el campo "cwd"'), 'Prompt must instruct coordinator to target child repos for write tasks');

  console.log('verify-multi-repo-workspace: all assertions passed OK');
} finally {
  cleanup();
}
