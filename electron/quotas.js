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
  let weekAllModelsUsedPct = null;
  let weekResetsAt = null;

  const mWeek = raw.match(/Current week \(all models\):\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^(\n\r]+))?/i);
  if (mWeek) {
    weekAllModelsUsedPct = parseInt(mWeek[1], 10);
    weekResetsAt = mWeek[2] ? mWeek[2].trim() : null;
  }

  const mSess = raw.match(/Current session:\s*(\d+)%\s*used/i);
  if (mSess) {
    sessionUsedPct = parseInt(mSess[1], 10);
  }

  if (sessionUsedPct === null && weekAllModelsUsedPct === null) return null;

  return {
    sessionUsedPct,
    weekAllModelsUsedPct,
    weekResetsAt,
  };
}

/**
 * Executes a CLI command with stdin ignored and strict timeout.
 * @param {string} bin
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
function execCli(bin, args, timeoutMs = 7000) {
  return new Promise((resolve) => {
    let out = '';
    let isSettled = false;

    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

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
let cachedQuotas = null;
let lastFetchedAt = 0;
let activeFetchPromise = null;

/**
 * Fetches current quota statuses for Claude and AGY.
 * @param {{forceRefresh?: boolean, timeoutMs?: number}} [opts]
 */
async function getQuotas(opts = {}) {
  const now = Date.now();
  if (!opts.forceRefresh && cachedQuotas && (now - lastFetchedAt < CACHE_TTL_MS)) {
    return cachedQuotas;
  }

  if (activeFetchPromise) {
    return activeFetchPromise;
  }

  activeFetchPromise = (async () => {
    try {
      const [claudeRaw, agyRaw] = await Promise.all([
        execCli('claude', ['-p', '/usage'], opts.timeoutMs || 8000),
        execCli('agy', ['-p', '/usage'], opts.timeoutMs || 8000),
      ]);

      const claude = parseClaudeUsage(claudeRaw);
      const agy = parseAgyUsage(agyRaw);

      cachedQuotas = {
        updatedAt: new Date().toISOString(),
        claude,
        agy,
      };
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
  getQuotas,
  CACHE_TTL_MS,
};
