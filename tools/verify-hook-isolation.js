// @ts-check
/**
 * Verification #2 from the plan: a probe agent that only proves the harness's hooks fire and
 * the machine's personal ones (precheck.ps1, delegate-nudge.ps1, ...) do not.
 *
 * Those six live in the GLOBAL `~/.claude/settings.json`, which every Claude Code session on
 * this machine loads regardless of `--settings` — `--settings` adds the harness's hooks, it does
 * not replace the user's. So the personal scripts still get invoked; what has to hold is that
 * each one's own CAD_AGENT_ID guard turns that invocation into a no-op before it does anything.
 * The check below is for the strongest of those side effects: delegate-nudge writes a per-session
 * counter file the first time it is NOT guarded, so its absence after several qualifying tool
 * calls is direct evidence the guard held, not just a read of the source.
 *
 * Run with: node_modules/electron/dist/electron.exe tools/verify-hook-isolation.js
 */

require('./test-home.js');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app } = require('electron');
const { Registry } = require('../electron/events.js');
const { spawn } = require('../electron/agent.js');
const { toyRepo } = require('../electron/toy-repo.js');
const paths = require('../electron/paths.js');

// Several Bash calls, well past delegate-nudge's threshold of 10, so an unguarded copy would
// have fired by the time the turn ends.
const TASK = 'Corre estos 11 comandos de bash, uno por uno, sin agruparlos: '
  + Array.from({ length: 11 }, (_, i) => `echo paso-${i}`).join(' ; luego ') + '. Nada mas.';
const DEADLINE_MS = 180000;
const STATE_DIR = path.join(os.homedir(), '.claude', 'hooks', 'state');

app.whenReady().then(() => {
  const cwd = toyRepo();
  const startedAt = new Date().toISOString();
  const before = fs.existsSync(STATE_DIR) ? new Set(fs.readdirSync(STATE_DIR)) : new Set();
  const seen = [];
  let done = false;
  let sessionId;

  const registry = new Registry((agents) => {
    const a = agents[0];
    if (!a) return;
    if (a.sessionId) sessionId = a.sessionId;
    const line = `${a.state} · ${a.tool}`;
    if (seen[seen.length - 1] !== line) {
      seen.push(line);
      console.log(`  ${a.state.padEnd(9)} ${a.tool}`);
    }
    if (a.state === 'idle' && !done) setTimeout(() => agent.kill(), 1500);
  });

  console.log(`repo:    ${cwd}`);
  console.log('estados:');

  let agent;
  try {
    agent = spawn({ id: 'verify-iso', cwd, task: TASK, onExit: (code) => finish(code) });
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
    registry.exited('verify-iso', code);

    const events = fs.readFileSync(paths.eventsLog, 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l)).filter((e) => e.agentId === 'verify-iso' && e.at >= startedAt);
    const bashCalls = events.filter((e) => e.event === 'PreToolUse' && e.payload?.tool_name === 'Bash').length;

    const after = fs.existsSync(STATE_DIR) ? fs.readdirSync(STATE_DIR) : [];
    const newStateFiles = after.filter((f) => !before.has(f));
    // delegate-nudge names its file by session id; if the probe's own session shows up, the
    // guard did not hold for at least one of the calls.
    const leaked = sessionId ? newStateFiles.some((f) => f.includes(sessionId)) : newStateFiles.length > 0;

    console.log('\nresultado');
    console.log(`  llamadas Bash del harness vistas: ${bashCalls}`);
    console.log(`  session_id reportado por el CLI:  ${sessionId || '(no llego un Status con session_id)'}`);
    console.log(`  archivos nuevos en hooks/state/:  ${newStateFiles.length ? newStateFiles.join(', ') : '(ninguno)'}`);

    const ok = bashCalls >= 5 && !leaked;
    console.log(ok
      ? '\naislamiento OK: los hooks del harness vieron las llamadas y delegate-nudge no dejo rastro'
      : '\naislamiento NO cumple');
    app.exit(ok ? 0 : 1);
  }
});
