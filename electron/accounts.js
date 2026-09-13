// @ts-check
/**
 * Which GitHub accounts exist on this machine, and which folders belong to each.
 *
 * The account list itself is never written down: `gh auth status` is the live source (per
 * CLAUDE.md's "never write down a fact a command can answer"). What Cata does declare is the
 * folder -> account mapping, since no command can answer "which of my folders is whose" — that
 * lives in `accounts.json` and stays empty until the Configuracion tab writes it.
 */

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const paths = require('./paths.js');

/**
 * Resolves the accounts configuration path:
 * 1. Directory where the executable is installed or running from (`PORTABLE_EXECUTABLE_DIR` or `process.execPath`).
 * 2. In development or test mode: project root (`accounts.json`).
 * 3. Fallback to `~/.cute-agents-desk/accounts.json`.
 */
function getAccountsConfigPath() {
  if (process.env.CUTE_AGENTS_DESK_HOME) {
    return path.join(paths.home, 'accounts.json');
  }

  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR
    || (process.versions?.electron ? path.dirname(process.execPath) : null);

  if (exeDir) {
    const exeConfig = path.join(exeDir, 'accounts.json');
    if (fs.existsSync(exeConfig)) return exeConfig;
  }

  const projectConfig = path.join(__dirname, '..', 'accounts.json');
  if (fs.existsSync(projectConfig)) return projectConfig;

  const homeConfig = path.join(paths.home, 'accounts.json');
  if (fs.existsSync(homeConfig)) return homeConfig;

  return exeDir ? path.join(exeDir, 'accounts.json') : homeConfig;
}

/**
 * @returns {{ gh: string, active: boolean, scopes: string }[]}
 */
function listGhAccounts() {
  let out = '';
  try {
    out = execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // `gh auth status` exits non-zero when NOT logged in anywhere, but still prints to stdout/stderr
    // for accounts it does know about in mixed states — read whichever stream has content.
    const e = /** @type {any} */ (err);
    out = String(e.stdout || '') + String(e.stderr || '');
  }
  const accounts = [];
  // "  ✓ Logged in to github.com account <username> (keyring)" / "  - Active account: true"
  // / "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'"
  const lines = out.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const login = lines[i].match(/Logged in to .* account (\S+)/);
    if (!login) continue;
    const block = lines.slice(i, i + 6);
    const activeLine = block.find((l) => /Active account:/.test(l));
    const scopesLine = block.find((l) => /Token scopes:/.test(l));
    accounts.push({
      gh: login[1],
      active: /true/.test(activeLine || ''),
      scopes: (scopesLine || '').replace(/.*Token scopes:\s*/, '').replace(/'/g, ''),
    });
  }
  return accounts;
}

/** @returns {Array<{gh: string, name?: string, alias?: string, label?: string, email?: string, color?: string, folders: {path: string, depth: number}[]}>} */
function readAccountsConfig() {
  try {
    return JSON.parse(fs.readFileSync(getAccountsConfigPath(), 'utf8'));
  } catch {
    return [];
  }
}

/**
 * The accounts as the UI wants them: the declared folder mapping (the only thing worth writing
 * down) merged with what `gh auth status` says live (scopes — never worth writing down, it can
 * change on GitHub's side without this machine knowing).
 */
function buildAccounts() {
  const live = listGhAccounts();
  return readAccountsConfig().map((c) => {
    const match = live.find((g) => g.gh === c.gh);
    return {
      id: c.gh,
      name: c.name || c.alias || c.label || c.gh,
      email: c.email,
      color: c.color || 'var(--color-lilac)',
      scopes: match ? match.scopes : '(cuenta no encontrada en gh auth status)',
      folders: c.folders,
    };
  });
}

function updateAccountColor(gh, color) {
  const configPath = getAccountsConfigPath();
  const accounts = readAccountsConfig();
  const acc = accounts.find((a) => a.gh === gh);
  if (acc) {
    acc.color = color;
    try {
      fs.writeFileSync(configPath, JSON.stringify(accounts, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function addAccountFolder(gh, folderPath, depth = 2) {
  if (!gh || !folderPath) return false;
  const configPath = getAccountsConfigPath();
  const accounts = readAccountsConfig();
  const acc = accounts.find((a) => a.gh === gh);
  if (!acc) return false;
  if (!Array.isArray(acc.folders)) acc.folders = [];

  const normalized = path.resolve(folderPath).replace(/\\/g, '/');
  const existing = acc.folders.find((f) => path.resolve(f.path).replace(/\\/g, '/').toLowerCase() === normalized.toLowerCase());
  if (existing) {
    existing.path = normalized;
    existing.depth = Number(depth) || 2;
  } else {
    acc.folders.push({ path: normalized, depth: Number(depth) || 2 });
  }

  try {
    fs.writeFileSync(configPath, JSON.stringify(accounts, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function removeAccountFolder(gh, folderPath) {
  if (!gh || !folderPath) return false;
  const configPath = getAccountsConfigPath();
  const accounts = readAccountsConfig();
  const acc = accounts.find((a) => a.gh === gh);
  if (!acc || !Array.isArray(acc.folders)) return false;

  const normalized = path.resolve(folderPath).replace(/\\/g, '/').toLowerCase();
  const beforeLen = acc.folders.length;
  acc.folders = acc.folders.filter((f) => path.resolve(f.path).replace(/\\/g, '/').toLowerCase() !== normalized);
  if (acc.folders.length !== beforeLen) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(accounts, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Find the account owning a cwd based on registered account folders.
 * @param {string} [cwd]
 * @param {Array<{gh: string, folders: {path: string, depth: number}[]}>} [accounts]
 */
function accountIdForCwd(cwd, accounts = readAccountsConfig()) {
  if (!cwd || !accounts) return undefined;
  const normalized = cwd.replace(/\\/g, '/').toLowerCase();
  const owner = accounts.find((acc) => (acc.folders || [])
    .some((f) => normalized.startsWith(f.path.replace(/\\/g, '/').toLowerCase())));
  return owner?.gh;
}

module.exports = {
  listGhAccounts,
  readAccountsConfig,
  buildAccounts,
  getAccountsConfigPath,
  updateAccountColor,
  addAccountFolder,
  removeAccountFolder,
  accountIdForCwd,
};

