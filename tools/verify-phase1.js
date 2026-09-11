// @ts-check
/**
 * The live agent gate: launch a real agent on the toy repo and prove the plumbing works, without
 * a window and without anyone watching a screen.
 *
 * What it has to prove, from the plan:
 *   1. the CLI actually starts under a PTY inside Electron (this is where a node-pty built for
 *      the wrong ABI fails, and it fails loudly here instead of as a blank card);
 *   2. the hooks report, so the state moves on its own;
 *   3. the agent still writes its own transcript — which is the only way to know the CLAUDE_*
 *      stripping worked. Run this from inside a Claude Code session and it is a real
 *      counter-proof: without the stripping, the child adopts this session and saves nothing.
 *
 * Run with: npm run verify
 */

require('./test-home.js');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { app } = require('electron');
const { Registry } = require('../electron/events.js');
const { spawn } = require('../electron/agent.js');
const { toyRepo } = require('../electron/toy-repo.js');
const paths = require('../electron/paths.js');
const worktree = require('../electron/worktree.js');

const TASK = 'Lee README.md y agrega al final una linea que diga "probado". Nada mas.';
const DEADLINE_MS = 180000;

/**
 * Transcripts live in a folder named after the cwd. The dot counts as a separator too, so
 * `C:\Users\dev\.cute-agents-desk\toy-repo` becomes `C--Users-dev--cute-agents-desk-toy-repo`
 * — measured, not guessed: reading `~/.claude/projects` is what corrected this.
 */
function transcriptDir(cwd) {
  const slug = cwd.replace(/[\\/:.]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug);
}

function countTranscripts(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).length; } catch { return 0; }
}

app.whenReady().then(() => {
  const cwd = toyRepo();
  // Default mode is 'write', so this agent now runs inside its own worktree, not `cwd` itself
  // (see electron/worktree.js) -- the path is deterministic from the agent id, so it can be
  // predicted before spawn() creates it. The worktree and its branch survive between runs (no
  // automatic cleanup, by design), so both are torn down here first or `git worktree add` would
  // refuse the second run outright.
  const effectiveCwd = worktree.worktreeDirFor('verify');
  worktree.removeWorktree('verify');
  try { execFileSync('git', ['branch', '-D', 'agent/verify'], { cwd, stdio: 'ignore' }); } catch { /* first run, no branch yet */ }

  const transcripts = transcriptDir(effectiveCwd);
  const before = countTranscripts(transcripts);
  // The worktree is created fresh from the base branch on every run, so its README always
  // starts at HEAD -- no reset needed the way a shared, persistent cwd would have.
  const readmePath = path.join(effectiveCwd, 'README.md');
  const seen = [];
  // Declared up here because the registry's callback fires during `register()`, before the
  // bottom half of this function has run.
  let done = false;
  // The log is append-only and every run uses the same agent id, so only the entries newer than
  // this instant belong to this run.
  const startedAt = new Date().toISOString();

  const registry = new Registry((agents) => {
    const a = agents[0];
    if (!a) return;
    const line = `${a.state} · ${a.tool}`;
    if (seen[seen.length - 1] !== line) {
      seen.push(line);
      console.log(`  ${a.state.padEnd(9)} ${a.tool}${a.tokens ? ` · ${a.tokens} tok` : ''}`);
    }
    // An interactive session does not end when the task ends: it reports `Stop` and sits waiting
    // for the next prompt, exactly as it would for a person. So the turn ending is the signal to
    // judge, and closing the session is the harness's job.
    if (a.state === 'idle' && !done) setTimeout(() => agent.kill(), 1500);
  });

  console.log(`repo:       ${cwd}`);
  console.log(`transcripts: ${transcripts} (${before} antes)`);
  console.log('estados:');

  let agent;
  try {
    agent = spawn({
      id: 'verify',
      cwd,
      task: TASK,
      onExit: (code) => finish(code),
      onNotice: (kind, detail) => {
        registry.note('verify', kind, detail);
        console.log(`  harness    ${kind}`);
      },
    });
  } catch (err) {
    console.error(`\nno se pudo lanzar el PTY: ${err.message}`);
    console.error('si dice NODE_MODULE_VERSION, node-pty esta compilado para node y no para electron:');
    console.error('  npx @electron/rebuild -f -w node-pty');
    app.exit(1);
    return;
  }
  registry.register(agent);

  const timer = setTimeout(() => {
    console.error(`\nsin terminar a los ${DEADLINE_MS / 1000}s; matando la sesion`);
    agent.kill();
  }, DEADLINE_MS);

  function finish(code) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    registry.exited('verify', code);

    const after = countTranscripts(transcripts);
    const events = fs.readFileSync(paths.eventsLog, 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l)).filter((e) => e.agentId === 'verify' && e.at >= startedAt);
    const kinds = [...new Set(events.map((e) => e.event))];
    const readme = fs.readFileSync(readmePath, 'utf8');

    console.log('\nresultado');
    console.log(`  eventos:     ${events.length} (${kinds.join(', ')})`);
    console.log(`  transcript:  ${before} -> ${after}`);
    console.log(`  README:      ${readme.includes('probado') ? 'la linea quedo escrita' : 'sin cambios'}`);
    console.log(`  salida:      codigo ${code} (la sesion la cierra el harness al terminar el turno)`);

    const ok = events.length > 0
      && kinds.includes('PreToolUse')
      && kinds.includes('Stop')
      && readme.includes('probado')
      && after > before;
    console.log(ok ? '\nverify-agent OK' : '\nverify-agent NO cumple');
    app.exit(ok ? 0 : 1);
  }
});
