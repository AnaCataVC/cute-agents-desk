// @ts-check
/**
 * Write-mode isolation: each write agent gets its own `git worktree`, checked out on its own
 * `agent/<id>` branch, living OUTSIDE the target repo under `~/.cute-agents-desk/wt/<id>`.
 * That is what lets two write agents run against the same repo at once without one's edits
 * landing in the other's diff, and it is what keeps a task's changes reviewable as a branch
 * instead of loose commits already mixed into whatever the human had checked out.
 *
 * No automatic cleanup here (see the plan's phase 7): a worktree is only ever removed by an
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
const { git } = require('./git.js');

const WT_ROOT = path.join(os.homedir(), '.cute-agents-desk', 'wt');
const MANIFEST_NAME = 'worktree.json';

/** @param {string} agentId */
function worktreeDirFor(agentId) {
  return path.join(WT_ROOT, agentId);
}

/**
 * @param {string} repoPath
 * @param {string} agentId
 * @returns {string} the absolute worktree path, ready to use as the agent's cwd
 */
function createWorktree(repoPath, agentId) {
  try {
    git(repoPath, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    throw new Error(`"${repoPath}" no es un repo git; no se puede crear un worktree ahi`);
  }

  const baseBranch = git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const worktreeDir = worktreeDirFor(agentId);
  fs.mkdirSync(WT_ROOT, { recursive: true });

  git(repoPath, ['worktree', 'add', worktreeDir, '-b', `agent/${agentId}`, baseBranch]);

  /** @type {{agentId: string, repoPath: string, branch: string, baseBranch: string, createdAt: string}} */
  const manifest = {
    agentId, repoPath, branch: `agent/${agentId}`, baseBranch, createdAt: new Date().toISOString(),
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
 * not something the agent wrote.
 * @param {string} porcelain
 */
function hasRealChanges(porcelain) {
  return porcelain.split('\n').some((line) => line.trim() && !line.trim().endsWith(MANIFEST_NAME));
}

/**
 * @returns {Array<{agentId: string, repoPath: string|null, branch: string|null, createdAt: string|null, hasUncommittedChanges: boolean, hasUnpushedCommits: boolean}>}
 */
function listWorktrees() {
  let entries;
  try {
    entries = fs.readdirSync(WT_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }

  return entries.map(({ name: agentId }) => {
    const worktreeDir = worktreeDirFor(agentId);
    const manifest = readManifest(agentId);

    let hasUncommittedChanges = true; // fail toward conserving when we can't tell
    try {
      hasUncommittedChanges = hasRealChanges(git(worktreeDir, ['status', '--porcelain']));
    } catch { /* keep the conservative default */ }

    let hasUnpushedCommits = true; // same: an unresolvable base branch reads as "assume unpushed"
    if (manifest && manifest.baseBranch) {
      try {
        const count = git(worktreeDir, ['rev-list', `${manifest.baseBranch}..HEAD`, '--count']);
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
  });
}

module.exports = { createWorktree, removeWorktree, listWorktrees, worktreeDirFor };
