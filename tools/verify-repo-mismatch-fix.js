// @ts-check
/**
 * Hermetic verification test for repository Git identity mismatch detection and resolution.
 *
 * Validates:
 * 1. inspectRepo flags an account mismatch when repo config user.email differs from account email.
 * 2. gitAsync modifies repo's local git config user.email cleanly.
 * 3. Following fix application, inspectRepo reports mismatch = false.
 * 4. ui/data.js getMismatches exposes path, currentEmail, and targetEmail.
 * 5. ui/data.js ignoreMismatch / isMismatchIgnored silences mismatch filtering.
 *
 * Run with: node tools/verify-repo-mismatch-fix.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git, gitAsync } = require('../electron/git.js');
const { inspectRepo } = require('../electron/discovery.js');

async function main() {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cute-mismatch-test-'));
  const folderRoot = path.join(tmpBase, 'workspace');
  const repoDir = path.join(folderRoot, 'sample-repo');

  fs.mkdirSync(folderRoot, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });

  try {
    // 1. Initialize a clean git repo with a mismatched email
    git(repoDir, ['init', '-q']);
    git(repoDir, ['config', 'user.email', 'wrong-dev@personal.org']);
    git(repoDir, ['config', 'user.name', 'WrongDev']);

    const account = {
      gh: 'CompanyDev',
      name: 'Company Account',
      email: 'dev@company.com',
    };

    // 2. inspectRepo should flag mismatch: true
    const inspectedInitial = await inspectRepo(repoDir, account, folderRoot);
    assert.strictEqual(inspectedInitial.mismatch, true, 'inspectRepo must detect identity mismatch initially');
    assert.strictEqual(inspectedInitial.email, 'wrong-dev@personal.org', 'inspectRepo must read current repo email');

    // 3. Apply the gitAsync identity fix
    await gitAsync(repoDir, ['config', 'user.email', account.email]);
    await gitAsync(repoDir, ['config', 'user.name', account.name]);

    // 4. Verify that the repo's git config now matches and mismatch is resolved
    const inspectedFixed = await inspectRepo(repoDir, account, folderRoot);
    assert.strictEqual(inspectedFixed.email, account.email, 'repo email should now match account email');
    assert.strictEqual(inspectedFixed.mismatch, false, 'inspectRepo must report mismatch = false after fix');

    // 5. Test UI data layer ignoreMismatch functionality
    // Dynamically import ui/data.js (ES module)
    const dataModule = await import('../ui/data.js');
    dataModule.clearIgnoredMismatches();

    // Set mock live data with a mismatch
    dataModule.setLiveRepoData({
      accounts: [{ id: 'CompanyDev', name: 'Company Account', email: 'dev@company.com' }],
      repos: [
        {
          name: 'sample-repo',
          path: repoDir,
          accountGh: 'CompanyDev',
          folder: folderRoot,
          relPath: 'sample-repo',
          subfolder: '',
          dirty: false,
          remote: null,
          email: 'wrong-dev@personal.org',
          mismatch: true,
          branch: 'main',
        },
      ],
    });

    let mismatches = dataModule.getMismatches();
    assert.strictEqual(mismatches.length, 1, 'getMismatches should find 1 mismatch');
    assert.strictEqual(mismatches[0].path, repoDir, 'mismatch item must expose full path');
    assert.strictEqual(mismatches[0].targetEmail, 'dev@company.com', 'mismatch item must expose targetEmail');

    // Ignore mismatch
    dataModule.ignoreMismatch(repoDir);
    assert.strictEqual(dataModule.isMismatchIgnored(repoDir), true, 'isMismatchIgnored should return true');

    mismatches = dataModule.getMismatches();
    assert.strictEqual(mismatches.length, 0, 'getMismatches must exclude ignored repos');

    console.log('verify-repo-mismatch-fix OK: deteccion de desajuste, resolucion con gitAsync e ignoreMismatch validados hermeticamente');
  } finally {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
