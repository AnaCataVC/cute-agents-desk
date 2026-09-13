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
  const rel = path.relative(folderRoot, repoPath).replace(/\\/g, '/');
  const lastSlash = rel.lastIndexOf('/');
  const subfolder = (lastSlash !== -1 && !rel.startsWith('..')) ? rel.slice(0, lastSlash) : '';

  return {
    path: repoPath,
    name: path.basename(repoPath),
    accountGh: account.gh,
    folder: folderRoot,
    relPath: rel,
    subfolder,
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

/**
 * Recursively scans a repository directory for guidelines/documentation files (CLAUDE.md, AGENTS.md).
 * Non-blocking, limits depth to prevent event loop blocking, skips build/vendor directories, and caps results.
 * @param {string} repoPath
 * @param {number} [maxDepth=3]
 * @param {number} [maxFiles=6]
 * @returns {Promise<Array<{ relativePath: string, absolutePath: string, engine: 'claude'|'agy', scope: string, excerpt: string }>>}
 */
async function findRepoDocsAsync(repoPath, maxDepth = 3, maxFiles = 6) {
  if (!repoPath || typeof repoPath !== 'string') return [];
  const results = [];

  async function walk(currentDir, currentDepth) {
    if (results.length >= maxFiles || currentDepth > maxDepth) return;
    let entries;
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if (lower === 'claude.md' || lower === 'agents.md') {
          const rel = path.relative(repoPath, fullPath).replace(/\\/g, '/');
          const engine = lower === 'claude.md' ? 'claude' : 'agy';
          const dirName = path.dirname(rel).replace(/\\/g, '/');
          const scope = dirName === '.' ? 'raíz' : dirName;

          let excerpt = '';
          try {
            const content = await fs.promises.readFile(fullPath, 'utf8');
            const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
            excerpt = lines.slice(0, 12).join('\n').slice(0, 400);
          } catch { /* best effort */ }

          results.push({
            relativePath: rel,
            absolutePath: fullPath,
            engine,
            scope,
            excerpt,
          });
        }
      } else if (entry.isDirectory()) {
        if (entry.name.startsWith('.') && entry.name !== '.claude' && entry.name !== '.gemini') continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(fullPath, currentDepth + 1);
      }
    }
  }

  await walk(repoPath, 0);
  return results;
}

module.exports = { inspectRepo, scanRepos, findRepoDocsAsync };
