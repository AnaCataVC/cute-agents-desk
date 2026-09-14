// @ts-check
/**
 * Verification #3 from the plan: read mode. Ask the agent to edit a file explicitly, and confirm
 * the hook denies it and the repo's working tree stays clean — not "the agent chose not to
 * edit", but "it could not have".
 *
 * Run with: node_modules/electron/dist/electron.exe tools/verify-read-mode.js
 */

require('./test-home.js');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app } = require('electron');
const { Registry } = require('../electron/events.js');
const { spawn } = require('../electron/agent.js');
const { toyRepo } = require('../electron/toy-repo.js');
const paths = require('../electron/paths.js');

const TASK = 'Agrega al final de README.md una linea que diga "no deberia poder escribir esto". Nada mas.';
const DEADLINE_MS = 180000;

function gitStatus(cwd) {
  return execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim();
}

app.whenReady().then(() => {
  const cwd = toyRepo();
  const startedAt = new Date().toISOString();
  const readmeBefore = fs.readFileSync(path.join(cwd, 'README.md'), 'utf8');
  // The toy repo is reused across verification scripts and isn't guaranteed clean going in
  // (verify-claude-live resets the file's content but never commits) — so the bar is "no new dirt
  // from this run", not "empty", which would fail on leftovers this script had no part in.
  const statusBefore = gitStatus(cwd);
  const seen = [];
  let done = false;

  const registry = new Registry((agents) => {
    const a = agents[0];
    if (!a) return;
    const line = `${a.state} · ${a.tool}`;
    if (seen[seen.length - 1] !== line) {
      seen.push(line);
      console.log(`  ${a.state.padEnd(9)} ${a.tool}`);
    }
    if (a.state === 'idle' && !done) setTimeout(() => agent.kill(), 1500);
  });

  console.log(`repo:    ${cwd} (status antes: "${statusBefore || '(limpio)'}")`);
  console.log('estados:');

  let agent;
  try {
    agent = spawn({ id: 'verify-read', cwd, task: TASK, mode: 'read', onExit: (code) => finish(code) });
  } catch (err) {
    console.error(`no se pudo lanzar el PTY: ${err.message}`);
    app.exit(1);
    return;
  }
  registry.register(agent);

  const timer = setTimeout(() => { agent.kill(); }, DEADLINE_MS);

  function finish(code) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    registry.exited('verify-read', code);

    const events = fs.readFileSync(paths.eventsLog, 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l)).filter((e) => e.agentId === 'verify-read' && e.at >= startedAt);
    const editAttempts = events.filter((e) => e.event === 'PreToolUse'
      && /^(Edit|Write|NotebookEdit)$/.test(e.payload?.tool_name || '')).length;
    const readmeAfter = fs.readFileSync(path.join(cwd, 'README.md'), 'utf8');
    const statusAfter = gitStatus(cwd);

    console.log('\nresultado');
    console.log(`  intentos de escritura vistos: ${editAttempts}`);
    console.log(`  README cambio:                ${readmeBefore === readmeAfter ? 'no' : 'SI'}`);
    console.log(`  git status quedo igual:       ${statusBefore === statusAfter ? 'si' : `NO ("${statusBefore}" -> "${statusAfter}")`}`);

    const ok = editAttempts > 0 && readmeBefore === readmeAfter && statusBefore === statusAfter;
    console.log(ok
      ? '\nmodo lectura OK: lo intento y el hook lo nego; el repo sigue limpio'
      : '\nmodo lectura NO cumple');
    app.exit(ok ? 0 : 1);
  }
});
