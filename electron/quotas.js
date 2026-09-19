'use strict';
// @ts-check
/**
 * Quota & Subscription Limits Module
 *
 * Runs `claude -p "/usage"` and `agy -p "/usage"` non-interactively with strict timeouts,
 * parses official quota / rate-limit percentages, and caches results to avoid saturating
 * the CLI processes.
 */

const { spawn } = require('node:child_process');

/**
 * Parses raw tabular output from `agy -p "/usage"`
 * @param {string} raw
 */
function parseAgyUsage(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const lines = raw.split('\n');
  const res = {
    gemini: { weeklyRemainingPct: null, fiveHourRemainingPct: null, weeklyResetAt: null, fiveHourResetAt: null },
    claude: { weeklyRemainingPct: null, fiveHourRemainingPct: null, weeklyResetAt: null, fiveHourResetAt: null },
  };

  for (const line of lines) {
    const parts = line.split('\t').map((p) => p.trim());
    if (parts.length >= 3) {
      const modelGroup = parts[0].toLowerCase();
      const limitType = parts[1].toLowerCase();
      const numMatch = parts[2].match(/(\d+)%/);
      const remPct = numMatch ? parseInt(numMatch[1], 10) : null;
      const resetAt = parts[3] || null;

      const target = modelGroup.includes('gemini') ? res.gemini : res.claude;
      if (limitType.includes('week')) {
        target.weeklyRemainingPct = remPct;
        if (resetAt) target.weeklyResetAt = resetAt;
      } else if (limitType.includes('five') || limitType.includes('5-hour') || limitType.includes('5 hour')) {
        target.fiveHourRemainingPct = remPct;
        if (resetAt) target.fiveHourResetAt = resetAt;
      }
    }
  }

  const hasAny = res.gemini.weeklyRemainingPct !== null || res.claude.weeklyRemainingPct !== null;
  return hasAny ? res : null;
}

/**
 * Parses raw text output from `claude -p "/usage"`
 * @param {string} raw
 */
function parseClaudeUsage(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let sessionUsedPct = null;
  let sessionResetsAt = null;
  let weekAllModelsUsedPct = null;
  let weekResetsAt = null;

  const mWeek = raw.match(/Current week \(all models\):\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^(\n\r]+))?/i);
  if (mWeek) {
    weekAllModelsUsedPct = parseInt(mWeek[1], 10);
    weekResetsAt = mWeek[2] ? mWeek[2].trim() : null;
  }

  const mSess = raw.match(/Current session:\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^(\n\r]+))?/i);
  if (mSess) {
    sessionUsedPct = parseInt(mSess[1], 10);
    sessionResetsAt = mSess[2] ? mSess[2].trim() : null;
  }

  if (sessionUsedPct === null && weekAllModelsUsedPct === null) return null;

  return {
    sessionUsedPct,
    sessionResetsAt,
    weekAllModelsUsedPct,
    weekResetsAt,
  };
}

/**
 * Executes a CLI command with stdin closed immediately and strict timeout.
 * @param {string} bin
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
function execCli(bin, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let out = '';
    let isSettled = false;

    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    try { child.stdin?.end(); } catch { /* ignore */ }

    const timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        if (process.platform === 'win32' && child.pid) {
          try {
            require('node:child_process').execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
          } catch { /* already exited */ }
        }
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        resolve('');
      }
    }, timeoutMs);

    child.stdout?.on('data', (d) => { out += d; });
    child.on('error', () => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        resolve('');
      }
    });

    child.on('close', () => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        resolve(out);
      }
    });
  });
}

const CACHE_TTL_MS = 60 * 1000;
const FORCE_REFRESH_COOLDOWN_MS = 10 * 1000;
let cachedQuotas = null;
let lastFetchedAt = 0;
let activeFetchPromise = null;

/**
 * Fetches Claude Code quota or authentication status.
 * Checks `claude auth status --json` first to avoid hanging or timing out when not logged in.
 * @param {number} [usageTimeoutMs]
 * @param {number} [authTimeoutMs]
 */
async function fetchClaudeUsage(usageTimeoutMs = 20000, authTimeoutMs = 5000) {
  try {
    const authRaw = await execCli('claude', ['auth', 'status', '--json'], authTimeoutMs);
    if (authRaw) {
      try {
        const auth = JSON.parse(authRaw);
        if (auth && auth.loggedIn === false) {
          return {
            notLoggedIn: true,
            sessionUsedPct: null,
            sessionResetsAt: null,
            weekAllModelsUsedPct: null,
            weekResetsAt: null,
          };
        }
      } catch {
        // If not JSON, continue to /usage
      }
    }

    const usageRaw = await execCli('claude', ['-p', '/usage'], usageTimeoutMs);
    return parseClaudeUsage(usageRaw);
  } catch {
    return null;
  }
}

const updateListeners = new Set();

function notifyUpdate(quotas) {
  for (const listener of updateListeners) {
    try { listener(quotas); } catch { /* ignore */ }
  }
}

/**
 * Fetches current quota statuses for Claude and AGY.
 * @param {{forceRefresh?: boolean, timeoutMs?: number}} [opts]
 * @param {(quotas: object) => void} [onUpdate]
 */
async function getQuotas(opts = {}, onUpdate = null) {
  if (typeof onUpdate === 'function') {
    updateListeners.add(onUpdate);
  }

  const now = Date.now();
  if (cachedQuotas) {
    if (!opts.forceRefresh && (now - lastFetchedAt < CACHE_TTL_MS)) {
      if (typeof onUpdate === 'function') {
        try { onUpdate(cachedQuotas); } catch { /* ignore */ }
      }
      return cachedQuotas;
    }
    if (opts.forceRefresh && (now - lastFetchedAt < FORCE_REFRESH_COOLDOWN_MS)) {
      if (typeof onUpdate === 'function') {
        try { onUpdate(cachedQuotas); } catch { /* ignore */ }
      }
      return cachedQuotas;
    }
  }

  if (activeFetchPromise) {
    return activeFetchPromise;
  }

  activeFetchPromise = (async () => {
    try {
      let currentResult = cachedQuotas ? { ...cachedQuotas } : {
        updatedAt: new Date().toISOString(),
        claude: null,
        agy: null,
      };

      const pClaude = fetchClaudeUsage(opts.timeoutMs || 22000, 5000).then((claude) => {
        currentResult = {
          ...currentResult,
          updatedAt: new Date().toISOString(),
          claude,
        };
        cachedQuotas = currentResult;
        lastFetchedAt = Date.now();
        notifyUpdate(currentResult);
        return claude;
      });

      const pAgy = execCli('agy', ['-p', '/usage'], opts.timeoutMs || 18000).then((agyRaw) => {
        const agy = parseAgyUsage(agyRaw);
        currentResult = {
          ...currentResult,
          updatedAt: new Date().toISOString(),
          agy,
        };
        cachedQuotas = currentResult;
        lastFetchedAt = Date.now();
        notifyUpdate(currentResult);
        return agy;
      });

      await Promise.all([pClaude, pAgy]);
      cachedQuotas = currentResult;
      lastFetchedAt = Date.now();
      return cachedQuotas;
    } finally {
      activeFetchPromise = null;
    }
  })();

  return activeFetchPromise;
}

module.exports = {
  parseAgyUsage,
  parseClaudeUsage,
  fetchClaudeUsage,
  getQuotas,
  CACHE_TTL_MS,
};
