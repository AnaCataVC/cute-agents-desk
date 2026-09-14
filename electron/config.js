'use strict';
// @ts-check
/**
 * Application Configuration Module (config.json)
 *
 * Hardened configuration store providing schema defaults, deep merge, prototype pollution
 * protection, bounds validation, concurrent write queueing, and atomic disk replacement.
 */

const fs = require('node:fs');
const paths = require('./paths.js');

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** @type {Record<string, any>} */
const DEFAULT_CONFIG = {
  coordinators: {
    maxSessionsPerCoordinator: 3,
    defaultEngine: 'claude cli',
    askBeforeSpawning: false,
    allowAgentLinks: false,
    reuseCoordinatorSameRepo: true,
    reportInterval: 'herramienta',
    archiveOnDeliver: true,
    idleTimeoutMinutes: 15,
  },
  exec: {
    maxParallel: 5,
    blockedTimeoutMinutes: 5,
    requirePushApproval: true,
    requireBashApproval: true,
    autoApproveReads: true,
  },
  deliver: {
    draftPR: true,
    blockPushToMain: true,
    attachReportToPR: true,
    singlePRPerRepo: true,
    prTitleTemplate: '<tipo>: <tarea>',
  },
  perf: {
    maxMountedTerminals: 1,
    terminalScrollbackLines: 2000,
    cardRefreshIntervalMs: 1000,
    statusAnimations: true,
    eventLogRotationMb: 50,
  },
  advanced: {
    harnessDir: '~/.cute-agents-desk',
    worktreesOutsideRepo: true,
    sanitizeClaudeEnv: true,
    isolateAgentConfig: true,
    serializeRemoteOps: true,
    reconcileOnStartup: true,
    windowProtocol: 'app://desk',
    singleInstance: true,
  },
  engines: {
    claude: {
      name: 'Claude Code',
      command: 'claude',
      hooks: 'full',
      hooksLabel: 'hooks completos',
      contextCap: 200000,
      warnAtPercent: 80,
      branchPrefix: 'claude/',
    },
    agy: {
      name: 'Antigravity CLI',
      command: 'agy',
      hooks: 'full',
      hooksLabel: 'hooks completos',
      contextCap: 200000,
      warnAtPercent: 80,
      branchPrefix: 'agy/',
    },
  },
};

/** @type {Record<string, any> | null} */
let cachedConfig = null;

/**
 * Deep clone an object safely without prototype pollution.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Deeply merge source into target while explicitly guarding against prototype pollution.
 * @param {Record<string, any>} target
 * @param {Record<string, any>} source
 * @returns {Record<string, any>}
 */
function deepMerge(target, source) {
  const result = clone(target);
  if (!source || typeof source !== 'object') return result;

  for (const [key, value] of Object.entries(source)) {
    if (FORBIDDEN_KEYS.has(key)) continue;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge(result[key] || {}, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Validates and sanitizes config key-value pairs against schema and bounds.
 * @param {string} section
 * @param {string} key
 * @param {any} value
 * @returns {{ valid: boolean, sanitizedValue?: any, error?: string }}
 */
function validateAndSanitize(section, key, value) {
  if (FORBIDDEN_KEYS.has(section) || FORBIDDEN_KEYS.has(key)) {
    return { valid: false, error: 'Propiedad no permitida (prototype guard)' };
  }

  if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, section)) {
    return { valid: false, error: `Sección desconocida: ${section}` };
  }

  const defaultSection = DEFAULT_CONFIG[section];
  if (!Object.prototype.hasOwnProperty.call(defaultSection, key)) {
    return { valid: false, error: `Clave desconocida en sección ${section}: ${key}` };
  }

  const expectedType = typeof defaultSection[key];

  if (expectedType === 'boolean') {
    return { valid: true, sanitizedValue: Boolean(value) };
  }

  if (expectedType === 'number') {
    const num = Number(value);
    if (Number.isNaN(num)) {
      return { valid: false, error: `Valor numérico inválido para ${section}.${key}` };
    }

    let clamped = num;
    if (section === 'exec' && key === 'maxParallel') {
      clamped = Math.max(1, Math.min(20, Math.round(num)));
    } else if (section === 'exec' && key === 'blockedTimeoutMinutes') {
      clamped = Math.max(1, Math.min(60, Math.round(num)));
    } else if (section === 'coordinators' && key === 'maxSessionsPerCoordinator') {
      clamped = Math.max(1, Math.min(10, Math.round(num)));
    } else if (section === 'coordinators' && key === 'idleTimeoutMinutes') {
      clamped = Math.max(1, Math.min(120, Math.round(num)));
    } else if (section === 'perf' && key === 'maxMountedTerminals') {
      clamped = Math.max(1, Math.min(5, Math.round(num)));
    } else if (section === 'perf' && key === 'terminalScrollbackLines') {
      clamped = Math.max(100, Math.min(10000, Math.round(num)));
    } else if (section === 'perf' && key === 'cardRefreshIntervalMs') {
      clamped = Math.max(250, Math.min(10000, Math.round(num)));

    } else if (section === 'perf' && key === 'eventLogRotationMb') {
      clamped = Math.max(1, Math.min(500, Math.round(num)));
    }

    return { valid: true, sanitizedValue: clamped };
  }

  if (expectedType === 'string') {
    return { valid: true, sanitizedValue: String(value).slice(0, 500) };
  }

  return { valid: true, sanitizedValue: value };
}

/**
 * Resolves the configuration file path:
 * 1. Environment override `CUTE_AGENTS_DESK_HOME`
 * 2. Directory of portable executable if config.json exists
 * 3. Project root in development if config.json exists
 * 4. Fallback to `~/.cute-agents-desk/config.json`
 */
function getConfigPath() {
  return paths.resolveUserDataFile('config.json');
}

/**
 * Reads and merges persisted config with default schema.
 * Uses in-memory cache when fresh to prevent disk read-modify-write race conditions.
 * @param {boolean} [forceReload]
 * @returns {typeof DEFAULT_CONFIG}
 */
function readConfig(forceReload = false) {
  if (cachedConfig && !forceReload) {
    return clone(cachedConfig);
  }

  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      cachedConfig = deepMerge(DEFAULT_CONFIG, parsed);
      return clone(cachedConfig);
    }
  } catch {
    // Return defaults on corrupt or unreadable files
  }

  cachedConfig = clone(DEFAULT_CONFIG);
  return clone(cachedConfig);
}

/**
 * Atomically writes configuration to disk with random PID/entropy to avoid collision.
 * @param {Record<string, any>} config
 * @returns {boolean}
 */
function writeConfig(config) {
  const configPath = getConfigPath();
  try {
    paths.writeJsonAtomic(configPath, config);
    cachedConfig = deepMerge(DEFAULT_CONFIG, config);
    return true;
  } catch {
    return false;
  }
}

/**
 * Updates a specific key inside a configuration section with bounds validation and sanitization.
 * @param {string} section
 * @param {string} key
 * @param {any} value
 * @returns {{ ok: boolean, config: typeof DEFAULT_CONFIG, error?: string }}
 */
function updateConfigKey(section, key, value) {
  const validation = validateAndSanitize(section, key, value);
  if (!validation.valid) {
    return { ok: false, config: readConfig(), error: validation.error };
  }

  const current = readConfig();
  if (!current[section]) {
    current[section] = {};
  }
  current[section][key] = validation.sanitizedValue;
  const ok = writeConfig(current);
  return { ok, config: current };
}

/**
 * Resets configuration to default schema.
 * @returns {typeof DEFAULT_CONFIG}
 */
function resetConfig() {
  const defaults = clone(DEFAULT_CONFIG);
  writeConfig(defaults);
  cachedConfig = clone(DEFAULT_CONFIG);
  return defaults;
}

module.exports = {
  DEFAULT_CONFIG,
  getConfigPath,
  readConfig,
  writeConfig,
  updateConfigKey,
  resetConfig,
  deepMerge,
  validateAndSanitize,
};
