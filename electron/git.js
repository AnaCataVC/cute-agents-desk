// @ts-check
/** Two ways to shell out to git, depending on whether a failure is exceptional or just "no answer". */

const { execFileSync } = require('node:child_process');

/**
 * Throws on failure -- for git calls whose result the caller actually depends on (creating or
 * removing a worktree, building a throwaway repo for a test).
 * @param {string} cwd @param {string[]} args
 */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * Swallows failure and returns `null` -- for read-only inspection where "git has no answer" (no
 * remote, no HEAD yet, not a repo) is an expected outcome, not an error. Stderr is ignored too:
 * execFileSync passes it through to this process' own stderr by default, and an expected failure
 * (checked across every scanned repo) is not worth printing.
 * @param {string} cwd @param {string[]} args
 */
function tryGit(cwd, args) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

module.exports = { git, tryGit };
