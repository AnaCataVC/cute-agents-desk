// @ts-check
/** Fixtures shared across the verify-*.js scripts. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git } = require('../electron/git.js');

/**
 * A disposable git repo with one commit, for a test that needs a fresh, throwaway repo per run
 * -- unlike `electron/toy-repo.js`'s shared fixture, which is persistent and reused across calls
 * at a fixed path. Caller is responsible for `fs.rmSync(dir, { recursive: true, force: true })`.
 * @param {string} [prefix]  passed to `fs.mkdtempSync`, so leftover dirs are identifiable by test
 * @returns {string} the repo's absolute path
 */
function makeDisposableRepo(prefix = 'cute-agents-desk-toy-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dir, 'README.md'), '# toy\n');
  git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.name=verify', '-c', 'user.email=verify@localhost', 'commit', '-q', '-m', 'first commit']);
  return dir;
}

module.exports = { makeDisposableRepo };
