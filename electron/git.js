'use strict';
// @ts-check
/** Two ways to shell out to git, depending on whether a failure is exceptional or just "no answer". */

const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

/**
 * Throws on failure -- for git calls whose result the caller actually depends on (creating or
 * removing a worktree, building a throwaway repo for a test).
 * @param {string} cwd @param {string[]} args @param {object} [opts]
 */
function git(cwd, args, opts = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', ...opts }).trim();
}

/**
 * Swallows failure and returns `null` -- for read-only inspection where "git has no answer" (no
 * remote, no HEAD yet, not a repo) is an expected outcome, not an error. Stderr is ignored too:
 * execFileSync passes it through to this process' own stderr by default, and an expected failure
 * (checked across every scanned repo) is not worth printing.
 * @param {string} cwd @param {string[]} args @param {object} [opts]
 */
function tryGit(cwd, args, opts = {}) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim(); }
  catch { return null; }
}

/**
 * Non-blocking twins of the two above, for callers that run many of these per scan
 * (`discovery.js`, `worktree.js`'s `listWorktrees`) and must not freeze the Electron main thread
 * for the sum of every git spawn. execFile never inherits stdio to this process, so there is no
 * `stdio` option to repeat here the way `tryGit` needs one.
 * @param {string} cwd @param {string[]} args
 */
async function gitAsync(cwd, args) {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout.trim();
}

/** @param {string} cwd @param {string[]} args */
async function tryGitAsync(cwd, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return null;
  }
}

module.exports = { git, tryGit, gitAsync, tryGitAsync };
