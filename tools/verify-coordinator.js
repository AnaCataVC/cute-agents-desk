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

// --- 4. buildCoordinatorPrompt with repoDocs and skills segregation ----------------------------

function checkSkillsAndRepoDocsInCoordinatorPrompt() {
  const conversation = { id: 'c000test', cap: 3 };
  const repos = [
    { name: 'my-project', accountGh: 'my-org', branch: 'main', path: 'C:/repos/my-project' },
  ];

  const fakeSkillsScan = [
    {
      engine: 'agy cli',
      installed: true,
      rows: [
        ['ami-plan-feature', 'Planificacion de features', '1.0', 'a demanda', 10, 'path/SKILL.md', 'path'],
        ['ami-audit-quality', 'Auditoria profunda de codigo', '1.0', 'a demanda', 10, 'path/SKILL.md', 'path'],
      ],
    },
    {
      engine: 'claude cli',
      installed: true,
      rows: [
        ['claude-code-review', 'Revision de codigo', '1.0', 'a demanda', 10, 'path/SKILL.md', 'path'],
      ],
    },
  ];

  const fakeRepoDocs = [
    {
      relativePath: 'CLAUDE.md',
      absolutePath: 'C:/repos/my-project/CLAUDE.md',
      engine: 'claude',
      scope: 'raíz',
      excerpt: '# Directivas Globales\nUsa Clean Code y pruebas hermeticas.',
    },
    {
      relativePath: 'packages/frontend/CLAUDE.md',
      absolutePath: 'C:/repos/my-project/packages/frontend/CLAUDE.md',
      engine: 'claude',
      scope: 'packages/frontend',
      excerpt: '# Directivas de Frontend\nUsa React y Tailwind.',
    },
  ];

  const prompt = buildCoordinatorPrompt(conversation, repos, {
    skills: fakeSkillsScan,
    repoDocs: fakeRepoDocs,
  });

  assert.ok(prompt.includes('<repo_guidelines scope="raíz"'), 'debe incluir bloque de guidelines para raíz');
  assert.ok(prompt.includes('<repo_guidelines scope="packages/frontend"'), 'debe incluir bloque de guidelines para submodulo');
  assert.ok(prompt.includes('Para workers Antigravity (engine: "agy"):'), 'debe segregar skills de agy');
  assert.ok(prompt.includes('ami-plan-feature'), 'debe listar ami-plan-feature bajo agy');
  assert.ok(prompt.includes('Para workers Claude Code (engine: "claude"):'), 'debe segregar skills de claude');
  assert.ok(prompt.includes('claude-code-review'), 'debe listar skill de claude');

  console.log('buildCoordinatorPrompt with skills and repoDocs OK: inyecta docs anidados delimitados y skills segregadas');
}

function checkSpawnCoordinatorParameters() {
  const conversation = { id: 'c000test', cap: 3 };
  const repos = [
    { name: 'my-project', accountGh: 'my-org', branch: 'main', path: 'C:/repos/my-project' },
  ];
  const { spawnCoordinator } = require('../electron/coordinator.js');
  let capturedOpts = null;
  const fakeSpawn = (opts) => {
    capturedOpts = opts;
    return { id: opts.id, pty: {}, kill() {} };
  };

  const coord = spawnCoordinator({
    conversationId: 'c000test',
    conversation,
    repos,
    spawn: fakeSpawn,
    bin: 'agy',
    model: 'gemini-3.8-flash-low',
    effort: 'low',
    mode: 'plan',
  });

  assert.ok(coord.id, 'deberia generar id de coordinador');
  assert.strictEqual(capturedOpts.bin, 'agy');
  assert.strictEqual(capturedOpts.model, 'gemini-3.8-flash-low');
  assert.strictEqual(capturedOpts.effort, 'low');
  assert.strictEqual(capturedOpts.mode, 'plan');
  assert.strictEqual(capturedOpts.worktree, false, 'nunca crea worktree en la carpeta de conversacion');

  console.log('spawnCoordinator parameters OK: propaga bin, model, effort y mode');
}

(async () => {
  await checkWatchSpawnRequests();
  checkBuildCoordinatorPrompt();
  checkSpawnSystemPromptArgs();
  checkSkillsAndRepoDocsInCoordinatorPrompt();
  checkSpawnCoordinatorParameters();
  console.log('coordinador OK: buzon de spawn-requests, prompt del coordinador, docs anidados, skills segregadas y parametros');
  process.exit(0);
})();
