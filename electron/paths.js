'use strict';
// @ts-check
/**
 * Where the harness keeps its state. Everything under one directory, all of it plain text,
 * because the first debugging tool for this thing is a text editor.
 *
 *   ~/.cute-agents-desk/
 *     events.jsonl              append-only log of everything that happened
 *     agents/<id>/
 *       agent.json              what it was asked to do, and by whom
 *       settings.json           the hooks the harness installs for this agent
 *       events/*.json           one file per hook event, dropped by hook.js, drained by the watcher
 *       outbox/*.json           free-form messages this agent chose to send its coordinator,
 *                                dropped by the agent itself, drained by Registry.watchOutbox --
 *                                distinct from `events/` (hook events, misleadingly aliased as
 *                                "inbox" below for historical reasons)
 *       pty.log                 raw terminal output
 *       .agents/hooks.json      agy's own hook config -- agy has no --settings-equivalent flag,
 *                                it only ever reads this exact path relative to its own cwd, so
 *                                an agy agent's cwd is THIS directory, never the repo (the repo
 *                                is reached via --add-dir instead, see agent.js)
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Overridable so verify-*.js scripts can point this at a throwaway directory instead of writing
// their test conversations/agents/events into the same folder the real app reads (see
// tools/test-home.js) -- unset in production, where this is always the real home directory.
const HOME = process.env.CUTE_AGENTS_DESK_HOME || path.join(os.homedir(), '.cute-agents-desk');

/**
 * Resolves a persistent file path checking portable exe dir, project root, and user home.
 * @param {string} filename
 * @returns {string}
 */
function resolveUserDataFile(filename) {
  if (process.env.CUTE_AGENTS_DESK_HOME) {
    return path.join(HOME, filename);
  }

  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR
    || (process.versions?.electron ? path.dirname(process.execPath) : null);

  if (exeDir) {
    const exeConfig = path.join(exeDir, filename);
    if (fs.existsSync(exeConfig)) return exeConfig;
  }

  const projectConfig = path.join(__dirname, '..', filename);
  if (fs.existsSync(projectConfig)) return projectConfig;

  const homeConfig = path.join(HOME, filename);
  if (fs.existsSync(homeConfig)) return homeConfig;

  return exeDir ? path.join(exeDir, filename) : homeConfig;
}

/**
 * Atomically writes JSON data to disk with random PID/entropy to avoid collision.
 * @param {string} targetPath
 * @param {any} data
 */
function writeJsonAtomic(targetPath, data) {
  const serialized = JSON.stringify(data, null, 2);
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = path.join(targetDir, `.${path.basename(targetPath)}.${nonce}.tmp`);

  try {
    fs.writeFileSync(tmpPath, serialized, 'utf8');
    try {
      fs.renameSync(tmpPath, targetPath);
    } catch {
      // Windows rename fallback for locked files or cross-boundary devices
      fs.copyFileSync(tmpPath, targetPath);
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch { /* ignore */ }
  }
}

const paths = {
  home: HOME,
  eventsLog: path.join(HOME, 'events.jsonl'),
  agents: path.join(HOME, 'agents'),

  deliveries: path.join(HOME, 'deliveries.json'),
  reposCache: path.join(HOME, 'repos-cache.json'),
  config: path.join(HOME, 'config.json'),

  resolveUserDataFile,
  writeJsonAtomic,

  /** @param {string} id */
  agent(id) {
    const dir = path.join(HOME, 'agents', id);
    return {
      dir,
      manifest: path.join(dir, 'agent.json'),
      settings: path.join(dir, 'settings.json'),
      inbox: path.join(dir, 'events'),
      outbox: path.join(dir, 'outbox'),
      report: path.join(dir, 'report.md'),
      ptyLog: path.join(dir, 'pty.log'),
      agyHooksDir: path.join(dir, '.agents'),
      agyHooks: path.join(dir, '.agents', 'hooks.json'),
    };
  },

  /** The hook script, as an absolute path — it is spawned by the CLI, from any cwd. */
  hookScript: path.join(__dirname, 'hook.js'),

  ensure() {
    fs.mkdirSync(paths.agents, { recursive: true });
    return paths;
  },
};

module.exports = paths;
