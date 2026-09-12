// @ts-check
/**
 * Delivery Pipeline:
 * Commits pending worktree changes under the repository's registered account identity,
 * pushes the task branch to remote `origin` without mutating `main`, creates a Draft PR
 * via `gh pr create --draft` linking the agent report, and persists the delivery record.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const paths = require('./paths.js');
const { git } = require('./git.js');
const { readAccountsConfig, listGhAccounts } = require('./accounts.js');
const { worktreeDirFor, readManifest: readWorktreeManifest } = require('./worktree.js');

/**
 * @returns {Array<Record<string, any>>}
 */
function listDeliveries() {
  try {
    return JSON.parse(fs.readFileSync(paths.deliveries, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * @param {Record<string, any>} delivery
 */
function saveDelivery(delivery) {
  const all = listDeliveries();
  const idx = all.findIndex((d) => d.id === delivery.id || d.agentId === delivery.agentId);
  if (idx >= 0) {
    all[idx] = delivery;
  } else {
    all.push(delivery);
  }
  fs.writeFileSync(paths.deliveries, JSON.stringify(all, null, 2));
}

/**
 * Finds the account assigned to the repo folder.
 * @param {string} repoPath
 */
function findAccountForRepo(repoPath) {
  const accounts = readAccountsConfig();
  if (!accounts || accounts.length === 0) {
    const live = listGhAccounts();
    const active = live.find((a) => a.active) || live[0];
    return active ? { id: active.gh, gh: active.gh, email: '' } : null;
  }

  const normRepo = path.resolve(repoPath).toLowerCase().replace(/\\/g, '/');
  let bestMatch = null;
  let bestLen = -1;

  for (const acc of accounts) {
    for (const f of acc.folders || []) {
      const normFolder = path.resolve(f.path).toLowerCase().replace(/\\/g, '/');
      if (normRepo === normFolder || normRepo.startsWith(normFolder + '/')) {
        if (normFolder.length > bestLen) {
          bestLen = normFolder.length;
          bestMatch = acc;
        }
      }
    }
  }

  return bestMatch || accounts[0];
}

/**
 * @param {Record<string, any>|null} account
 */
function resolveAuthor(account) {
  const gh = account?.gh || account?.id || 'CuteAgentsDesk';
  const name = account?.name || gh;
  const email = account?.email || `${gh}@users.noreply.github.com`;
  return { name, email };
}

/**
 * Safely fetches scoped auth token for an account via `gh auth token -u <account>`.
 * @param {string} accountId
 */
function getAccountGhToken(accountId) {
  if (!accountId) return null;
  try {
    const out = execFileSync('gh', ['auth', 'token', '-u', accountId], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} [task]
 * @param {string} [customTitle]
 */
function formatPrTitle(task, customTitle) {
  if (customTitle && customTitle.trim()) return customTitle.trim();
  const t = (task || '').trim();
  if (/^(feat|fix|chore|docs|refactor|test|style|perf)(\(.*\))?:/i.test(t)) {
    return t;
  }
  return t ? `feat: ${t}` : 'feat: actualización desde agente de Cute Agents Desk';
}

/**
 * @param {object} o
 * @param {string} o.agentId
 * @param {string} [o.task]
 * @param {string} [o.engine]
 * @param {string} [o.model]
 * @param {string} [o.effort]
 * @param {string} [o.filesChanged]
 * @param {string} [o.reportUrl]
 * @param {boolean} [o.isDraft]
 */
function formatPrBody({ agentId, task, engine, model, effort, filesChanged, reportUrl, isDraft }) {
  const parts = [
    '## Cute Agents Desk · Entrega de Tarea',
    '',
    `**Agente:** \`${agentId}\`  `,
    `**Motor:** \`${engine || 'desconocido'}\`  `,
    model ? `**Modelo:** \`${model}\`  ` : null,
    effort ? `**Nivel de razonamiento:** \`${effort}\`  ` : null,
    task ? `**Tarea:** ${task}  ` : null,
    reportUrl ? `**Reporte de sesión:** [Ver reporte local](${reportUrl})  ` : null,
    '',
    '### Resumen de Archivos Modificados',
    '```',
    filesChanged || '(sin cambios en el diff)',
    '```',
    '',
    '---',
    `*Este Pull Request fue creado automáticamente${isDraft !== false ? ' en modo borrador (draft)' : ''} por Cute Agents Desk.*`,
  ].filter(Boolean);

  return parts.join('\n');
}

/**
 * Delivers an agent's work: commits dirty files, pushes branch to origin, and opens a draft PR.
 * @param {object} opts
 * @param {string} opts.agentId
 * @param {string} [opts.commitMessage]
 * @param {string} [opts.prTitle]
 * @param {string} [opts.prBody]
 * @param {boolean} [opts.draftPR]
 * @returns {Promise<{ ok: true, delivery: Record<string, any> } | { ok: false, error: string }>}
 */
async function deliverAgent(opts) {
  const { agentId } = opts;
  if (!agentId) return { ok: false, error: 'agentId es requerido' };

  let agentManifest = null;
  try {
    agentManifest = JSON.parse(fs.readFileSync(paths.agent(agentId).manifest, 'utf8'));
  } catch { /* agent.json may not exist if spawned without manifest */ }

  const worktreeDir = agentManifest?.worktreeCwd || worktreeDirFor(agentId);
  if (!fs.existsSync(worktreeDir)) {
    return { ok: false, error: `El worktree para el agente "${agentId}" no existe en disco` };
  }

  const wtManifest = readWorktreeManifest(agentId);
  const repoPath = wtManifest?.repoPath || agentManifest?.cwd;
  if (!repoPath) {
    return { ok: false, error: `No se pudo determinar el repositorio base para "${agentId}"` };
  }

  const baseBranch = wtManifest?.baseBranch || 'main';
  let branch = wtManifest?.branch;
  if (!branch) {
    try {
      branch = git(worktreeDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    } catch {
      branch = `agent/${agentId}`;
    }
  }

  const account = findAccountForRepo(repoPath);
  const author = resolveAuthor(account);
  const task = agentManifest?.task || '';
  const engine = agentManifest?.engine || 'claude';
  const commitMsg = opts.commitMessage || formatPrTitle(task, opts.prTitle);

  // 1. Commit any uncommitted worktree changes
  const statusPorcelain = git(worktreeDir, ['status', '--porcelain']);
  const dirtyLines = statusPorcelain.split('\n').filter((l) => l.trim() && !l.includes('worktree.json'));

  if (dirtyLines.length > 0) {
    git(worktreeDir, ['add', '-A']);
    try {
      git(worktreeDir, ['reset', 'HEAD', '--', 'worktree.json']);
    } catch { /* ignore if not staged */ }

    git(worktreeDir, [
      '-c', `user.name=${author.name}`,
      '-c', `user.email=${author.email}`,
      'commit', '-m', commitMsg,
    ], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
      },
    });
  }

  // 2. Obtain commit SHA & stat
  let commitSha = '';
  try {
    commitSha = git(worktreeDir, ['rev-parse', 'HEAD']);
  } catch { /* best effort */ }

  let filesChanged = '';
  try {
    filesChanged = git(worktreeDir, ['diff', '--stat', `${baseBranch}...HEAD`]) || dirtyLines.join('\n');
  } catch {
    filesChanged = dirtyLines.join('\n');
  }

  // 3. Push to remote origin
  let hasRemote = true;
  try {
    git(worktreeDir, ['remote', 'get-url', 'origin']);
  } catch {
    hasRemote = false;
  }

  let prUrl = null;
  let prNumber = null;
  const token = getAccountGhToken(account?.gh || account?.id);
  const subprocessEnv = { ...process.env };
  if (token) {
    subprocessEnv.GH_TOKEN = token;
    subprocessEnv.GITHUB_TOKEN = token;
  }

  if (hasRemote) {
    try {
      git(worktreeDir, ['push', '-u', 'origin', branch], { env: subprocessEnv });
    } catch (pushErr) {
      return { ok: false, error: `Error al empujar la rama a origin: ${pushErr.message}` };
    }

    // 4. Create Pull Request
    const title = formatPrTitle(task, opts.prTitle);
    const isDraft = opts.draftPR !== undefined ? Boolean(opts.draftPR) : true;
    const reportPath = paths.agent(agentId).report;
    const body = opts.prBody || formatPrBody({
      agentId,
      task,
      engine,
      model: agentManifest?.model,
      effort: agentManifest?.effort,
      filesChanged,
      reportUrl: fs.existsSync(reportPath) ? `file:///${reportPath.replace(/\\/g, '/')}` : undefined,
      isDraft,
    });

    try {
      const prArgs = ['pr', 'create'];
      if (isDraft) prArgs.push('--draft');
      prArgs.push(
        '--head', branch,
        '--base', baseBranch,
        '--title', title,
        '--body', body,
      );

      const out = execFileSync('gh', prArgs, {
        cwd: worktreeDir,
        encoding: 'utf8',
        env: subprocessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const match = out.match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/);
      if (match) {
        prUrl = match[0];
        prNumber = parseInt(match[1], 10);
      } else {
        prUrl = out.trim();
      }
    } catch (prErr) {
      const errMsg = (prErr.stderr || prErr.stdout || prErr.message || '').toString();
      // If PR already exists, fetch it via `gh pr view`
      if (errMsg.includes('already exists')) {
        try {
          const viewOut = execFileSync('gh', ['pr', 'view', branch, '--json', 'url,number'], {
            cwd: worktreeDir, encoding: 'utf8', env: subprocessEnv, stdio: ['ignore', 'pipe', 'ignore'],
          });
          const parsed = JSON.parse(viewOut);
          prUrl = parsed.url;
          prNumber = parsed.number;
        } catch {
          return { ok: false, error: `El PR ya existe pero no se pudo consultar: ${errMsg}` };
        }
      } else if (errMsg.includes('known GitHub host') || errMsg.includes('none of the git remotes')) {
        // Non-GitHub remote (e.g. local bare fixture during tests or offline)
        prUrl = null;
      } else {
        return { ok: false, error: `Error al crear el PR en GitHub: ${errMsg}` };
      }
    }
  }

  const deliveryRecord = {
    id: agentId,
    agentId,
    repo: path.basename(repoPath),
    repoPath,
    worktreeDir,
    branch,
    baseBranch,
    accountId: account?.id || account?.gh || 'local',
    author,
    commitSha,
    pr: prNumber ? `PR #${prNumber} · borrador` : (hasRemote ? 'borrador' : 'local (sin origin)'),
    prNumber,
    prUrl,
    reportUrl: fs.existsSync(paths.agent(agentId).report) ? paths.agent(agentId).report : null,
    status: 'draft',
    deliveredAt: new Date().toISOString(),
  };

  saveDelivery(deliveryRecord);
  return { ok: true, delivery: deliveryRecord };
}

module.exports = {
  deliverAgent,
  listDeliveries,
  saveDelivery,
  findAccountForRepo,
  resolveAuthor,
  formatPrTitle,
  formatPrBody,
};
