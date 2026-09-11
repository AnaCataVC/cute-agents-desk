// @ts-check
/**
 * Walk the declared folders, find git repos, and read just enough about each to draw the tree
 * and flag the one failure mode this whole feature exists to catch: a repo whose committed
 * identity doesn't match the account its folder says it belongs to.
 */

const fs = require('node:fs');
const path = require('node:path');
const { tryGitAsync } = require('./git.js');

// Noise a folder scan should never descend into: never a repo itself, and finding one nested
// inside would either be someone else's dependency tree or this harness's own scratch space.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', '__pycache__', 'wt']);

/**
 * @param {string} dir
 * @param {number} depth  folders left to descend; a repo itself does not consume depth to look
 *   for its own worktrees or submodules, it simply stops there
 * @returns {string[]} absolute paths of repo roots (folders directly containing `.git`)
 */
function findRepos(dir, depth) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }

  if (entries.some((e) => e.isDirectory() && e.name === '.git') || fs.existsSync(path.join(dir, '.git'))) {
    return [dir];
  }
  if (depth <= 0) return [];

  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    found.push(...findRepos(path.join(dir, entry.name), depth - 1));
  }
  return found;
}

/**
 * @param {string} repoPath
 * @param {{gh: string, email?: string}} account
 * @param {string} folderRoot  the declared root this repo was found under — not its filesystem
 *   parent, which for a nested repo (depth > 1) is a different, undeclared directory the UI
 *   never grouped anything by
 */
async function inspectRepo(repoPath, account, folderRoot) {
  // Four independent git spawns per repo -- run together instead of one after another, and
  // through the async git helper so none of them blocks the Electron main thread while it waits.
  const [branch, dirty, remote, email] = await Promise.all([
    tryGitAsync(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    tryGitAsync(repoPath, ['status', '--porcelain']),
    tryGitAsync(repoPath, ['remote', 'get-url', 'origin']),
    tryGitAsync(repoPath, ['config', 'user.email']),
  ]);
  return {
    path: repoPath,
    name: path.basename(repoPath),
    accountGh: account.gh,
    folder: folderRoot,
    branch: branch || '(sin HEAD)',
    dirty: dirty !== null && dirty !== '',
    remote,
    email,
    // Undefined when either side of the comparison has no answer -- an unset git identity is a
    // separate, honest "unknown", not a false mismatch.
    mismatch: !!(account.email && email && email !== account.email),
  };
}

/**
 * @param {Array<{gh: string, email?: string, folders: {path: string, depth: number}[]}>} accounts
 * @returns {Promise<object[]>}
 */
function scanRepos(accounts) {
  const jobs = [];
  for (const account of accounts) {
    for (const folder of account.folders) {
      for (const repoPath of findRepos(folder.path, folder.depth)) {
        jobs.push(inspectRepo(repoPath, account, folder.path));
      }
    }
  }
  return Promise.all(jobs);
}

module.exports = { inspectRepo, scanRepos };
