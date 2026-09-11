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

/**
 * Only the two scalar fields this feature needs -- a real YAML parser would be overkill for
 * `name:`/`description:` and nothing in this repo already depends on one.
 * @param {string} filePath
 */
function readSkillFrontmatter(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch { return { name: null, description: null }; }
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return { name: null, description: null };
  const grab = (/** @type {string} */ key) => {
    const m = fm[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  };
  return { name: grab('name'), description: grab('description') };
}

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

module.exports = { getScheduledTasks, getClaudeScheduledTasks, getAgyScheduledTasks };
