// @ts-check
/**
 * Proves the scheduled-tasks discovery against disposable fixtures, not this machine's real
 * Claude Desktop / Antigravity data -- a fresh clone or CI box has neither installed, and the
 * module must degrade to `[]` rather than throw when it finds neither.
 *
 * Run with: node tools/verify-scheduled-tasks.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getScheduledTasks } = require('../electron/scheduled-tasks.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cute-agents-desk-sched-'));

function cleanup() {
  fs.rmSync(root, { recursive: true, force: true });
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj));
}

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

try {
  // ---- Claude Desktop fixtures ----
  const localAppData = path.join(root, 'localappdata');
  const claudeRoot = path.join(localAppData, 'Packages', 'Claude_abc123xyz', 'LocalCache', 'Roaming', 'Claude');

  const skillPath = path.join(root, 'dot-claude', 'scheduled-tasks', 'mi-tarea', 'SKILL.md');
  writeFile(skillPath, '---\nname: mi-tarea\ndescription: Hace una cosa\n---\n\nCuerpo.\n');
  const missingSkillPath = path.join(root, 'dot-claude', 'scheduled-tasks', 'se-borro', 'SKILL.md');
  const nonSkillPath = path.join(root, 'somewhere-else', 'config.json');

  writeJson(path.join(claudeRoot, 'claude-code-sessions', 'acct1', 'org1', 'scheduled-tasks.json'), {
    scheduledTasks: [
      { id: 'task-1', cronExpression: '30 9,16 * * 1-5', enabled: true, filePath: skillPath, lastRunAt: '2026-09-10T19:31:30.898Z' },
      { id: 'task-2', cronExpression: '0 9 * * 5', enabled: false, filePath: missingSkillPath }, // SKILL.md moved/deleted
      { id: 'task-4', fireAt: 1789999999999, enabled: true }, // no filePath at all -- one-shot, nothing to correlate
    ],
  });
  writeJson(path.join(claudeRoot, 'local-agent-mode-sessions', 'acct1', 'org1', 'scheduled-tasks.json'), {
    scheduledTasks: [
      { id: 'task-3', cronExpression: '0 16 * * 1,3,5', enabled: true, filePath: nonSkillPath }, // never a SKILL.md
    ],
  });

  // ---- Antigravity fixtures ----
  const geminiHome = path.join(root, 'gemini-home');
  const agyTaskDir = path.join(geminiHome, 'antigravity', 'sidecar_data', 'update-cv');
  writeFile(path.join(agyTaskDir, 'logs', '20260101_000000.log'), '[schedule] Scheduler started for schedule: "0 0 * * 0"\n');
  writeFile(path.join(agyTaskDir, 'logs', '20260102_000000.log'), '[schedule] Scheduler started for schedule: "0 11 * * 5"\n');
  writeJson(path.join(agyTaskDir, 'events', '20260102_110230.611.json'), {
    timestampMs: '1789135350611',
    payload: { newConversation: { prompt: 'Revisa mi CV', conversationId: 'abc' } },
  });

  // ---- run ----
  const tasks = getScheduledTasks({ localAppData, geminiHome });
  const byId = Object.fromEntries(tasks.filter((t) => t.engine === 'claude').map((t) => [t.id, t]));

  assert.strictEqual(tasks.length, 5, '3 tareas locales de claude + 1 en VM de nube + 1 de agy');

  assert.strictEqual(byId['task-1'].name, 'mi-tarea', 'nombre desde el frontmatter del SKILL.md');
  assert.strictEqual(byId['task-1'].description, 'Hace una cosa');
  assert.strictEqual(byId['task-1'].mode, 'local');

  assert.strictEqual(byId['task-2'].name, 'se-borro', 'sin SKILL.md real, cae al nombre de la carpeta');
  assert.strictEqual(byId['task-2'].description, null);

  assert.strictEqual(byId['task-3'].name, 'somewhere-else', 'tarea en VM cuyo filePath no es un SKILL.md: nombre de carpeta igual');
  assert.strictEqual(byId['task-3'].mode, 'cloud-vm');

  assert.strictEqual(byId['task-4'].name, 'task-4', 'sin filePath del todo, cae al id');
  assert.strictEqual(byId['task-4'].fireAt, 1789999999999, 'tarea de una sola corrida: fireAt, no cron');

  const agy = tasks.find((t) => t.engine === 'agy');
  assert.ok(agy, 'debe encontrar la tarea de antigravity');
  assert.strictEqual(agy.cronExpression, '0 11 * * 5', 'debe usar el log mas reciente, no el mas viejo');
  assert.strictEqual(agy.description, 'Revisa mi CV', 'descripcion desde el evento mas reciente');
  assert.strictEqual(agy.enabled, null, 'no observable para agy, nunca se adivina');
  assert.ok(agy.lastRunAt, 'debe derivar lastRunAt del timestamp del evento');

  const empty = getScheduledTasks({ localAppData: path.join(root, 'no-existe'), geminiHome: path.join(root, 'tampoco') });
  assert.deepStrictEqual(empty, [], 'ninguno de los dos motores instalado -> []');

  console.log('scheduled-tasks OK: descubre tareas de claude (local y VM) y de agy, sin caerse por archivos ausentes');
  cleanup();
  process.exit(0);
} catch (err) {
  console.error(err);
  cleanup();
  process.exit(1);
}
