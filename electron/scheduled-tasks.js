// @ts-check
/**
 * Discovers recurring tasks that Claude Desktop and Antigravity (agy) have scheduled on this
 * machine, entirely outside this harness. Read-only: this module only ever reads files another
 * app wrote, never spawns, edits or schedules anything itself.
 *
 * Claude Desktop persists its scheduled tasks as a stable JSON file inside its packaged Windows
 * userData dir (`scheduled-tasks.json`, one copy per scheduler generation: `claude-code-sessions`
 * for the local-session engine, `local-agent-mode-sessions` for the older cloud-VM engine). A
 * local task's human name/description live separately, in the `SKILL.md` frontmatter its
 * `filePath` field points at.
 *
 * Antigravity has no equivalent structured file: confirmed by direct inspection, there is no
 * manifest, sqlite table or protobuf field anywhere under `~/.gemini/` that records a task's
 * schedule. A task's cron expression only ever appears as a plaintext line in the newest `.log`
 * file under its `sidecar_data/<task>/logs/`, and its last prompt/run time only in the newest
 * file under `sidecar_data/<task>/events/`. Whether an agy task is still enabled is not
 * observable at all from what's on disk -- reported as `enabled: null`, never guessed.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function defaultRoots() {
  return {
    localAppData: process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    geminiHome: path.join(os.homedir(), '.gemini'),
  };
}

/** @param {string} dir */
function listDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
}

/** @param {string} dir @param {string} ext */
function listFiles(dir, ext) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort(); }
  catch { return []; }
}

/** @param {string} filePath */
function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

const { readSkillFrontmatter } = require('./frontmatter.js');

/**
 * @param {any} raw  one entry of a `scheduled-tasks.json`'s `scheduledTasks` array
 * @param {'local'|'cloud-vm'} mode
 * @param {string} sourcePath
 */
function normalizeClaudeTask(raw, mode, sourcePath) {
  const isSkillFile = !!raw.filePath && path.basename(raw.filePath).toLowerCase() === 'skill.md';
  const { name: fmName, description } = isSkillFile
    ? readSkillFrontmatter(raw.filePath)
    : { name: null, description: null };
  // Falls back to the folder name from the path string alone, so a task whose SKILL.md was moved
  // or deleted (or a cloud-VM task, whose filePath never points at a SKILL.md to begin with)
  // still shows something recognizable instead of just its opaque id.
  const folderName = raw.filePath ? path.basename(path.dirname(raw.filePath)) : null;
  return {
    engine: 'claude',
    mode,
    id: raw.id,
    name: fmName || folderName || raw.id,
    description: description || null,
    cronExpression: raw.cronExpression || null,
    fireAt: raw.fireAt || null,
    enabled: !!raw.enabled,
    lastRunAt: raw.lastRunAt || null,
    sourcePath,
  };
}

/** @param {{localAppData: string}} roots */
function getClaudeScheduledTasks(roots) {
  const packagesDir = path.join(roots.localAppData, 'Packages');
  const tasks = [];
  for (const pkgName of listDirs(packagesDir)) {
    // The suffix is installation-specific (a Windows package identity hash) -- never hardcode it.
    if (!pkgName.startsWith('Claude_')) continue;
    const claudeRoot = path.join(packagesDir, pkgName, 'LocalCache', 'Roaming', 'Claude');
    for (const [subsystem, mode] of /** @type {['claude-code-sessions'|'local-agent-mode-sessions', 'local'|'cloud-vm'][]} */ (
      [['claude-code-sessions', 'local'], ['local-agent-mode-sessions', 'cloud-vm']]
    )) {
      const subsystemDir = path.join(claudeRoot, subsystem);
      for (const accountId of listDirs(subsystemDir)) {
        for (const orgId of listDirs(path.join(subsystemDir, accountId))) {
          const jsonPath = path.join(subsystemDir, accountId, orgId, 'scheduled-tasks.json');
          const parsed = readJson(jsonPath);
          if (!parsed || !Array.isArray(parsed.scheduledTasks)) continue;
          for (const raw of parsed.scheduledTasks) tasks.push(normalizeClaudeTask(raw, mode, jsonPath));
        }
      }
    }
  }
  return tasks;
}

const CRON_LINE = /Scheduler started for schedule: "([^"]+)"/g;

/** @param {string} logsDir */
function latestCronFromLogs(logsDir) {
  const files = listFiles(logsDir, '.log');
  if (!files.length) return null;
  let text;
  try { text = fs.readFileSync(path.join(logsDir, files[files.length - 1]), 'utf8'); } catch { return null; }
  CRON_LINE.lastIndex = 0;
  let match;
  let last = null;
  while ((match = CRON_LINE.exec(text))) last = match[1]; // last, in case the sidecar rescheduled mid-log
  return last;
}

/** @param {string} eventsDir */
function latestEvent(eventsDir) {
  const files = listFiles(eventsDir, '.json');
  if (!files.length) return null;
  return readJson(path.join(eventsDir, files[files.length - 1]));
}

/** @param {{geminiHome: string}} roots */
function getAgyScheduledTasks(roots) {
  const sidecarDir = path.join(roots.geminiHome, 'antigravity', 'sidecar_data');
  return listDirs(sidecarDir).map((name) => {
    const taskDir = path.join(sidecarDir, name);
    const event = latestEvent(path.join(taskDir, 'events'));
    return {
      engine: 'agy',
      mode: null,
      id: name,
      name,
      description: event?.payload?.newConversation?.prompt || null,
      cronExpression: latestCronFromLogs(path.join(taskDir, 'logs')),
      fireAt: null,
      enabled: null,
      lastRunAt: event?.timestampMs ? new Date(Number(event.timestampMs)).toISOString() : null,
      sourcePath: taskDir,
    };
  });
}

/**
 * @param {{localAppData?: string, geminiHome?: string}} [overrides]  for verify-*.js, to point
 *   this at a throwaway fixture directory instead of the real machine's Claude/Antigravity data
 */
function getScheduledTasks(overrides) {
  const roots = { ...defaultRoots(), ...overrides };
  return [...getClaudeScheduledTasks(roots), ...getAgyScheduledTasks(roots)];
}

/**
 * Safely reads the latest log lines or payload events for a scheduled task.
 * @param {string} sourcePath
 * @param {string} engine
 * @param {string} [taskId]
 * @returns {{ logs: string, error?: string }}
 */
function readTaskLogs(sourcePath, engine, taskId) {
  if (!sourcePath || typeof sourcePath !== 'string') {
    return { logs: '', error: 'Ruta no válida' };
  }
  try {
    if (engine === 'agy') {
      const logsDir = path.join(sourcePath, 'logs');
      const files = listFiles(logsDir, '.log');
      if (!files.length) {
        // Fallback: check events folder
        const eventsDir = path.join(sourcePath, 'events');
        const evFiles = listFiles(eventsDir, '.json');
        if (!evFiles.length) return { logs: '(No hay archivos de log ni eventos registrados para esta tarea)' };
        const lastEv = readJson(path.join(eventsDir, evFiles[evFiles.length - 1]));
        return { logs: JSON.stringify(lastEv, null, 2) };
      }
      const newestLog = path.join(logsDir, files[files.length - 1]);
      const stat = fs.statSync(newestLog);
      const maxBytes = 64 * 1024; // 64 KB tail limit
      let text = '';
      if (stat.size <= maxBytes) {
        text = fs.readFileSync(newestLog, 'utf8');
      } else {
        const fd = fs.openSync(newestLog, 'r');
        const buf = Buffer.alloc(maxBytes);
        fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
        fs.closeSync(fd);
        text = '... [Log truncado a los últimos 64 KB]\n' + buf.toString('utf8');
      }
      const lines = text.split(/\r?\n/);
      const tail = lines.slice(-60).join('\n');
      return { logs: tail || '(Archivo de log vacío)' };
    } else if (engine === 'claude') {
      if (fs.existsSync(sourcePath)) {
        const stat = fs.statSync(sourcePath);
        if (stat.isFile()) {
          const parsed = readJson(sourcePath);
          if (parsed && Array.isArray(parsed.scheduledTasks)) {
            const task = taskId ? parsed.scheduledTasks.find((t) => t.id === taskId) : parsed.scheduledTasks[0];
            return { logs: JSON.stringify(task || parsed, null, 2) };
          }
        }
      }
      return { logs: '(No hay registro de ejecución disponible en disco para esta tarea de Claude Desktop)' };
    }
    return { logs: '(Motor no soportado)' };
  } catch (err) {
    return { logs: '', error: err && err.message ? err.message : String(err) };
  }
}

module.exports = { getScheduledTasks, getClaudeScheduledTasks, getAgyScheduledTasks, readTaskLogs };

