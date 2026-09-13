// @ts-check
/**
 * Verification test for external editor resolution, account preference persistence,
 * arguments safety (zero shell injection), and path privacy invariants.
 *
 * Run with: node tools/verify-external-editor.js
 */

const { dir } = require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveEditor, openInEditor } = require('../electron/editor.js');
const {
  readAccountsConfig,
  updateAccountEditor,
  buildAccounts,
  getAccountsConfigPath,
} = require('../electron/accounts.js');

// 1. Path privacy check on source files: zero hardcoded local user profiles
const editorSource = fs.readFileSync(path.join(__dirname, '../electron/editor.js'), 'utf8');
assert.ok(!/C:\\Users\\[a-zA-Z0-9_-]+\\/i.test(editorSource), 'electron/editor.js must not contain hardcoded user paths');

// 2. Editor resolution
const vs = resolveEditor('vscode');
assert.ok(vs && vs.name === 'Visual Studio Code', 'vscode choice resolves to Visual Studio Code');
assert.ok(vs.bin, 'vscode has a resolved binary path or cli name');

const agy = resolveEditor('antigravity');
assert.ok(agy && agy.name === 'Antigravity IDE', 'antigravity choice resolves to Antigravity IDE');
assert.ok(agy.bin, 'antigravity has a resolved binary path or cli name');

const sys = resolveEditor('system');
assert.strictEqual(sys.name, 'Explorador del sistema', 'system choice resolves to system file manager');
assert.strictEqual(sys.bin, 'system', 'system binary is set to system');

// 3. Accounts editor preference persistence in hermetic home
const accountsFile = getAccountsConfigPath();
const testAccounts = [
  {
    gh: 'test-user-1',
    email: 'user1@example.com',
    color: 'var(--color-lilac)',
    folders: [{ path: path.join(dir, 'repo1'), depth: 2 }],
  },
  {
    gh: 'test-user-2',
    email: 'user2@example.com',
    color: 'var(--color-mint)',
    editor: 'vscode',
    folders: [{ path: path.join(dir, 'repo2'), depth: 2 }],
  },
];
fs.writeFileSync(accountsFile, JSON.stringify(testAccounts, null, 2), 'utf8');

// Default editor should be 'vscode' when not specified
let built = buildAccounts();
const acc1 = built.find((a) => a.id === 'test-user-1');
assert.strictEqual(acc1?.editor, 'vscode', 'account without editor defaults to vscode in buildAccounts');

// Update account 1 to antigravity
const updateOk = updateAccountEditor('test-user-1', 'antigravity');
assert.strictEqual(updateOk, true, 'updateAccountEditor returns true on success');

built = buildAccounts();
const acc1Updated = built.find((a) => a.id === 'test-user-1');
assert.strictEqual(acc1Updated?.editor, 'antigravity', 'updated account reflects antigravity');

// Verify disk content
const onDisk = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
const diskAcc1 = onDisk.find((a) => a.gh === 'test-user-1');
assert.strictEqual(diskAcc1.editor, 'antigravity', 'persisted accounts.json contains editor: antigravity');

// 4. openInEditor validation
(async () => {
  // Missing targetPath
  // @ts-ignore
  const errNoTarget = await openInEditor({});
  assert.strictEqual(errNoTarget.ok, false, 'openInEditor fails when targetPath is missing');

  // Non-existent targetPath
  const errMissingPath = await openInEditor({ targetPath: path.join(dir, 'does-not-exist') });
  assert.strictEqual(errMissingPath.ok, false, 'openInEditor fails for non-existent path');

  // Valid targetPath with system editor mock
  const validDir = path.join(dir, 'test-wt-dir with spaces');
  fs.mkdirSync(validDir, { recursive: true });

  let shellOpened = null;
  const mockShell = {
    openPath: async (p) => {
      shellOpened = p;
      return '';
    },
  };

  const sysRes = await openInEditor({
    targetPath: validDir,
    editorChoice: 'system',
    shell: mockShell,
  });

  assert.strictEqual(sysRes.ok, true, 'openInEditor succeeds with mock shell');
  assert.strictEqual(shellOpened, path.resolve(validDir), 'mock shell received resolved target path');

  console.log('ok    verify-external-editor.js');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
