// @ts-check
/**
 * Write-mode isolation: each write agent gets its own `git worktree`, checked out on its own
 * `agent/<id>` branch, living OUTSIDE the target repo under `~/.cute-agents-desk/wt/<id>`.
 * That is what lets two write agents run against the same repo at once without one's edits
 * landing in the other's diff, and it is what keeps a task's changes reviewable as a branch
 * instead of loose commits already mixed into whatever the human had checked out.
 *
 * No automatic cleanup here: a worktree is only ever removed by an
 * explicit `removeWorktree` call, so losing an agent's work to a stray delete is not a failure
 * mode this module can produce on its own. `listWorktrees` is the always-on inventory that makes
 * "what's still out there" answerable without hunting through `.git/worktrees`.
 *
 * Each worktree carries its own `worktree.json` manifest recording which repo it came from,
 * because at listing/removal time the caller only has an agent id, not the repo path.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { git, gitAsync } = require('./git.js');
const paths = require('./paths.js');

const WT_ROOT = path.join(paths.home, 'wt');
const MANIFEST_NAME = 'worktree.json';

/** @param {string} agentId */
function worktreeDirFor(agentId) {
  return path.join(WT_ROOT, agentId);
}

/** @param {string} task */
function slugifyTask(task) {
  return (task || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

/**
 * @param {string} agentId
 * @param {{ engine?: string, task?: string, branch?: string }} [opts]
 */
function resolveBranchName(agentId, opts = {}) {
  if (opts.branch) return opts.branch;
  if (opts.engine || opts.task) {
    const prefix = opts.engine || 'agent';
    const slug = slugifyTask(opts.task);
    return slug ? `${prefix}/${slug}-${agentId}` : `${prefix}/${agentId}`;
  }
  return `agent/${agentId}`;
}

/**
 * @param {string} repoPath
 * @param {string} agentId
 * @param {{ engine?: string, task?: string, branch?: string }} [opts]
 * @returns {string} the absolute worktree path, ready to use as the agent's cwd
 */
function createWorktree(repoPath, agentId, opts = {}) {
  try {
    git(repoPath, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    throw new Error(`"${repoPath}" no es un repo git; no se puede crear un worktree ahi`);
  }

  let baseBranch = 'main';
  try {
    const headRef = git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (headRef && headRef !== 'HEAD') {
      baseBranch = headRef;
    } else {
      try {
        const originHead = git(repoPath, ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
        if (originHead) baseBranch = originHead.replace(/^origin\//, '');
      } catch {
        baseBranch = 'main';
      }
    }
  } catch {
    baseBranch = 'main';
  }

  const branch = resolveBranchName(agentId, opts);
  const worktreeDir = worktreeDirFor(agentId);
  fs.mkdirSync(WT_ROOT, { recursive: true });

  // Defensively ignore worktree.json so it never appears in git status
  try {
    const gitDir = git(repoPath, ['rev-parse', '--git-dir']);
    const absGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(repoPath, gitDir);
    const excludeFile = path.join(absGitDir, 'info', 'exclude');
    if (fs.existsSync(excludeFile)) {
      const content = fs.readFileSync(excludeFile, 'utf8');
      if (!content.includes(MANIFEST_NAME)) {
        fs.appendFileSync(excludeFile, `\n${MANIFEST_NAME}\n`);
      }
    }
  } catch { /* best effort */ }

  git(repoPath, ['worktree', 'add', worktreeDir, '-b', branch, baseBranch]);

  /** @type {{agentId: string, repoPath: string, branch: string, baseBranch: string, createdAt: string}} */
  const manifest = {
    agentId, repoPath, branch, baseBranch, createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(worktreeDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2));

  return worktreeDir;
}

/** @param {string} agentId */
function readManifest(agentId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(worktreeDirFor(agentId), MANIFEST_NAME), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Manual "reap". No-op (not an error) if the worktree is already gone, so a double-click on the
 * reap button never surfaces as a crash.
 * @param {string} agentId
 */
function removeWorktree(agentId) {
  const worktreeDir = worktreeDirFor(agentId);
  if (!fs.existsSync(worktreeDir)) return;

  const manifest = readManifest(agentId);
  if (manifest && fs.existsSync(manifest.repoPath)) {
    try {
      git(manifest.repoPath, ['worktree', 'remove', worktreeDir, '--force']);
      return;
    } catch { /* fall through to the manual cleanup below */ }
  }

  // The repo that created it is gone, or git itself refused: remove the directory by hand and
  // ask every repo git still remembers to forget it, rather than leaving a dangling entry.
  fs.rmSync(worktreeDir, { recursive: true, force: true });
  if (manifest && fs.existsSync(manifest.repoPath)) {
    try { git(manifest.repoPath, ['worktree', 'prune']); } catch { /* best effort */ }
  }
}

/**
 * `worktree.json` itself must never count as "uncommitted work" — it is harness bookkeeping,
 * not something the agent wrote. Compares the exact filename, not just a line's tail: a real
 * file that merely ends in the same suffix (e.g. `src/other-worktree.json`) must still count.
 * @param {string} porcelain
 */
function hasRealChanges(porcelain) {
  return porcelain.split('\n').some((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // Porcelain v1: two status chars, a space, then the path (a rename adds " -> newpath").
    const filePath = trimmed.slice(2).trim().split(' -> ').pop();
    return path.basename(filePath) !== MANIFEST_NAME;
  });
}

/**
 * @returns {Promise<Array<{agentId: string, repoPath: string|null, branch: string|null, createdAt: string|null, hasUncommittedChanges: boolean, hasUnpushedCommits: boolean}>>}
 */
function listWorktrees() {
  let entries;
  try {
    entries = fs.readdirSync(WT_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return Promise.resolve([]);
  }

  // One git spawn per worktree ran serially used to block the main thread for the sum of all of
  // them; running them together, through the async git helper, keeps the app responsive while a
  // long retained-worktree list is being inspected.
  return Promise.all(entries.map(async ({ name: agentId }) => {
    const worktreeDir = worktreeDirFor(agentId);
    const manifest = readManifest(agentId);

    let hasUncommittedChanges = true; // fail toward conserving when we can't tell
    try {
      hasUncommittedChanges = hasRealChanges(await gitAsync(worktreeDir, ['status', '--porcelain']));
    } catch { /* keep the conservative default */ }

    let hasUnpushedCommits = true; // same: an unresolvable base branch reads as "assume unpushed"
    if (manifest && manifest.baseBranch) {
      try {
        const count = await gitAsync(worktreeDir, ['rev-list', `${manifest.baseBranch}..HEAD`, '--count']);
        hasUnpushedCommits = Number(count) > 0;
      } catch { /* keep the conservative default */ }
    }

    return {
      agentId,
      repoPath: manifest ? manifest.repoPath : null,
      branch: manifest ? manifest.branch : null,
      createdAt: manifest ? manifest.createdAt : null,
      hasUncommittedChanges,
      hasUnpushedCommits,
    };
  }));
}

/**
 * Safely batch-prunes clean or delivered inactive worktrees.
 * Strict invariants:
 * 1. Never removes a worktree if its agent is in runningAgentIds (running).
 * 2. Never removes a worktree if hasUncommittedChanges is true (dirty).
 * 3. Removes clean or delivered inactive worktrees via removeWorktree.
 * @param {object} [opts]
 * @param {string[]|Set<string>} [opts.runningAgentIds]
 * @param {string[]|Set<string>} [opts.deliveredIds]
 * @returns {Promise<{ totalReaped: number, reaped: string[], skipped: Array<{ agentId: string, reason: string }> }>}
 */
async function reapCleanWorktrees(opts = {}) {
  const runningSet = new Set(opts.runningAgentIds || []);
  const all = await listWorktrees();

  const reaped = [];
  const skipped = [];

  for (const wt of all) {
    if (runningSet.has(wt.agentId)) {
      skipped.push({ agentId: wt.agentId, reason: 'running' });
      continue;
    }
    if (wt.hasUncommittedChanges) {
      skipped.push({ agentId: wt.agentId, reason: 'dirty' });
      continue;
    }
    try {
      removeWorktree(wt.agentId);
      reaped.push(wt.agentId);
    } catch (err) {
      skipped.push({ agentId: wt.agentId, reason: err && err.message ? err.message : 'error' });
    }
  }

  return {
    totalReaped: reaped.length,
    reaped,
    skipped,
  };
}

module.exports = {
  createWorktree,
  removeWorktree,
  reapCleanWorktrees,
  listWorktrees,
  worktreeDirFor,
  readManifest,
};
