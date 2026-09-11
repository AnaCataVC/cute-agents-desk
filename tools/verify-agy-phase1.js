// @ts-check
/**
 * The agy counterpart to verify-phase1.js: one real `agy` session, on a toy repo, through the
 * actual harness (agent.js's spawn() + events.js's Registry, same pairing main.js uses), not a
 * standalone probe script. Confirms the schema/cwd fix (agyHooksFor, effectiveCwd = the harness's
 * own agent dir, --add-dir for the real repo) actually produces real, parseable hook events end
 * to end -- the same gate `--smoke` and verify-phase1.js already give claude.
 *
 * Deliberately narrower than verify-phase1.js: no worktree isolation exists for agy yet (see
 * agent.js's comment on that), and there is no known statusLine-equivalent for agy, so token
 * tracking is not asserted here -- both are known, reported gaps, not oversights.
 *
 * Run with: node tools/verify-agy-phase1.js
 */

require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const { spawn } = require('../electron/agent.js');
const { Registry } = require('../electron/events.js');
const paths = require('../electron/paths.js');
const { makeDisposableRepo } = require('./test-helpers.js');

async function main() {
  // Deliberately not `electron/toy-repo.js`'s shared toyRepo(): that one is a persistent fixture
  // reused across calls at a fixed path, and this test needs a fresh, disposable repo per run.
  const repo = makeDisposableRepo('cad-agy-toy-');
  const id = 'verify-agy';
  const startedAt = new Date().toISOString();
  fs.rmSync(paths.agent(id).dir, { recursive: true, force: true }); // a fresh workspace path each run

  let done = false;
  const registry = new Registry(() => {});

  await new Promise((resolve) => {
    const agent = spawn({
      id,
      cwd: repo,
      task: 'Lee el archivo README.md con tu herramienta de lectura de archivos y dime que dice. No edites nada.',
      mode: 'read',
      bin: 'agy',
      onExit: (code) => { if (!done) { done = true; registry.exited(id, code); resolve(undefined); } },
    });
    registry.register(agent);
    // Interactive session never exits on its own after one turn -- same reason verify-phase1.js
    // kills claude 1.5s after 'idle': give it a real window to actually run the tool, then end
    // the session ourselves. agy took noticeably longer than claude to settle on the right path
    // in manual runs, so this window is generous on purpose.
    setTimeout(() => { if (!done) { done = true; agent.kill(); resolve(undefined); } }, 75000);
  });

  const events = fs.readFileSync(paths.eventsLog, 'utf8').trim().split('\n')
    .map((l) => JSON.parse(l))
    .filter((e) => e.agentId === id && e.at >= startedAt);
  const kinds = events.map((e) => e.event);

  assert.ok(events.length > 0, 'debe haber al menos un evento real de agy en events.jsonl');
  assert.ok(kinds.includes('PreToolUse'), `esperaba PreToolUse entre: ${kinds.join(', ')}`);

  const preToolUse = events.find((e) => e.event === 'PreToolUse');
  assert.ok(preToolUse.payload?.toolCall?.name, 'el payload de agy debe traer toolCall.name (camelCase, no tool_name)');

  const manifest = JSON.parse(fs.readFileSync(paths.agent(id).manifest, 'utf8'));
  assert.strictEqual(manifest.engine, 'agy');
  assert.strictEqual(manifest.worktreeCwd, paths.agent(id).dir,
    'agy corre en su propio directorio del harness, no en el repo -- --add-dir es lo que le da acceso al repo');

  assert.ok(fs.existsSync(paths.agent(id).agyHooks), 'debe haber escrito .agents/hooks.json en el cwd real del agente');
  const hooksFile = JSON.parse(fs.readFileSync(paths.agent(id).agyHooks, 'utf8'));
  assert.ok(hooksFile['cad-hooks']?.PreToolUse, 'el schema debe ser el de agy (nombre de hook arbitrario, no {"hooks": ...})');

  console.log(`agy verify OK: ${events.length} eventos reales (${[...new Set(kinds)].join(', ')}), `
    + 'toolCall.name en camelCase, cwd efectivo es el directorio del harness, hooks.json con el schema correcto');

  fs.rmSync(repo, { recursive: true, force: true });
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
