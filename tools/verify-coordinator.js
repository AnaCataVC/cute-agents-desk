// @ts-check
/**
 * Unit check for the coordinator slice, no PTY -- a live CLI would actually have to decide to
 * write a spawn-request file to prove this works, which is exactly the flaky, expensive path the
 * other verify-* scripts in this repo already avoid for pure logic. Three things are checked:
 *
 *  1. `watchSpawnRequests` drains a request file a real coordinator CLI would have written by
 *     hand -- fs.watch is async, so this polls for the callback instead of assuming a fixed delay
 *     -- and deletes it afterward (an actioned request must not sit around to be re-drained).
 *  2. `buildCoordinatorPrompt` produces a prompt that actually carries the repo names and the
 *     conversation's own cap, since that's the only way the coordinator learns either.
 *  3. `spawn()`'s new `systemPrompt` option reaches the CLI's argv as `--append-system-prompt`,
 *     and the default (no systemPrompt) still argues nothing was added -- the backward-compat
 *     requirement from the plan.
 *
 * Run with: node tools/verify-coordinator.js
 */

require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const conv = require('../electron/conversations.js');
const { buildCoordinatorPrompt, watchSpawnRequests } = require('../electron/coordinator.js');

// --- 1. watchSpawnRequests drains a hand-written request file, then deletes it ------------------

async function checkWatchSpawnRequests() {
  const conversation = conv.createConversation({ title: 'prueba coordinador', cap: 2 });
  const dir = conv.conversationPaths(conversation.id).dir;
  const requestsDir = path.join(dir, 'spawn-requests');

  /** @type {object[]} */
  const seen = [];
  const watcher = watchSpawnRequests(conversation.id, (req) => seen.push(req));

  assert.ok(fs.existsSync(requestsDir), 'deberia crear la carpeta de spawn-requests si no existia');

  const requestFile = path.join(requestsDir, 'req-1.json');
  const written = { objective: 'arregla el bug de X', cwd: 'C:/repos/toy-repo', mode: 'write' };
  fs.writeFileSync(requestFile, JSON.stringify(written));

  // fs.watch is async; poll instead of assuming a fixed delay.
  const deadline = Date.now() + 3000;
  while (seen.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }

  assert.strictEqual(seen.length, 1, 'deberia haber drenado exactamente un pedido');
  assert.deepStrictEqual(seen[0], written, 'el pedido entregado debe tener la forma exacta escrita');
  assert.ok(!fs.existsSync(requestFile), 'el archivo de pedido debe borrarse una vez actuado');

  watcher.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('watchSpawnRequests OK: drena un pedido escrito a mano y borra el archivo actuado');
}

// --- 2. buildCoordinatorPrompt carries the repos and the cap ------------------------------------

function checkBuildCoordinatorPrompt() {
  const conversation = { id: 'c000abc', cap: 4 };
  const repos = [
    { name: 'icarus-api', accountGh: 'work-account', branch: 'main', path: 'C:/work/icarus-api' },
    { name: 'cute-agents-desk', accountGh: 'personal-account', branch: 'main', path: 'C:/repos/cute-agents-desk' },
  ];
  const prompt = buildCoordinatorPrompt(conversation, repos);

  assert.ok(prompt.includes('icarus-api'), 'debe listar el nombre de cada repo');
  assert.ok(prompt.includes('cute-agents-desk'), 'debe listar el nombre de cada repo');
  assert.ok(prompt.includes('4'), 'debe mencionar el tope de la conversacion');
  assert.ok(/spawn-requests/.test(prompt), 'debe explicar el protocolo del buzon');
  console.log('buildCoordinatorPrompt OK: incluye los repos y el tope de la conversacion');
}

// --- 3. spawn()'s systemPrompt reaches argv as --append-system-prompt --------------------------

function checkSpawnSystemPromptArgs() {
  /** @type {any[]} */
  const calls = [];
  const fakeTerm = {
    onData() {},
    onExit() {},
    pid: 1234,
  };

  // node-pty is required lazily inside agent.js's spawn(), so it can be stubbed via the module
  // cache without touching the real native module.
  const ptyPath = require.resolve('node-pty');
  const original = Module._cache[ptyPath];
  Module._cache[ptyPath] = {
    id: ptyPath,
    filename: ptyPath,
    loaded: true,
    exports: { spawn: (bin, args, opts) => { calls.push({ bin, args, opts }); return fakeTerm; } },
  };

  try {
    const { spawn } = require('../electron/agent.js');

    spawn({ id: 'probe-default', cwd: 'C:/fake', task: 'haz algo' });
    assert.ok(!calls[0].args.includes('--append-system-prompt'),
      'sin systemPrompt, el default debe seguir siendo identico a hoy');

    spawn({ id: 'probe-prompt', cwd: 'C:/fake', task: 'haz algo', systemPrompt: 'eres el coordinador' });
    const idx = calls[1].args.indexOf('--append-system-prompt');
    assert.ok(idx !== -1, 'con systemPrompt, debe agregar --append-system-prompt');
    assert.strictEqual(calls[1].args[idx + 1], 'eres el coordinador', 'debe pasar el prompt tal cual');
  } finally {
    if (original) Module._cache[ptyPath] = original; else delete Module._cache[ptyPath];
    fs.rmSync(require('../electron/paths.js').agent('probe-default').dir, { recursive: true, force: true });
    fs.rmSync(require('../electron/paths.js').agent('probe-prompt').dir, { recursive: true, force: true });
  }
  console.log('spawn() systemPrompt OK: agrega --append-system-prompt solo cuando se pide, default sin cambios');
}

(async () => {
  await checkWatchSpawnRequests();
  checkBuildCoordinatorPrompt();
  checkSpawnSystemPromptArgs();
  console.log('coordinador OK: buzon de spawn-requests, prompt del coordinador, y systemPrompt aditivo en spawn()');
  process.exit(0);
})();
