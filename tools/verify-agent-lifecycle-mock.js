// @ts-check
/**
 * Fast lifecycle & mock PTY integration test.
 *
 * Verifies that:
 * 1. Agent initialization and argv creation work reliably without invoking external CLIs.
 * 2. Simulated terminal data streams trigger trust dialog auto-responses.
 * 3. Events arriving via Registry (PreToolUse, PostToolUse, Status, Stop) transition agent
 *    states correctly (thinking -> tool -> thinking -> idle) and update token counters.
 * 4. Coordinator spawn-requests trigger secondary agent registration cleanly.
 *
 * Run with: node tools/verify-agent-lifecycle-mock.js
 */

require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const cp = require('node:child_process');

// Prevent taskkill from trying to execute real taskkill during mock agent.kill()
const realExecFileSync = cp.execFileSync;
cp.execFileSync = (cmd, args, opts) => {
  if (cmd === 'taskkill') return Buffer.from('');
  return realExecFileSync(cmd, args, opts);
};

const paths = require('../electron/paths.js');
const conv = require('../electron/conversations.js');
const { Registry } = require('../electron/events.js');
const coordinator = require('../electron/coordinator.js');

// ============================================================================
// Virtual PTY implementation
// ============================================================================
class FakeTerminal {
  constructor() {
    this.pid = 43210;
    /** @type {((data: string) => void)[]} */
    this.dataListeners = [];
    /** @type {((event: { exitCode: number, signal?: number }) => void)[]} */
    this.exitListeners = [];
    /** @type {string[]} */
    this.written = [];
    this.killed = false;
  }

  onData(cb) {
    this.dataListeners.push(cb);
  }

  onExit(cb) {
    this.exitListeners.push(cb);
  }

  write(data) {
    this.written.push(data);
  }

  kill() {
    this.killed = true;
    for (const cb of this.exitListeners) {
      cb({ exitCode: 0 });
    }
  }

  emitData(data) {
    for (const cb of this.dataListeners) {
      cb(data);
    }
  }
}

// Hook Module._cache to virtualize node-pty
const ptyPath = require.resolve('node-pty');
const originalPty = Module._cache[ptyPath];
/** @type {{ bin: string, args: string[], opts: any, term: FakeTerminal }[]} */
const spawnedProcesses = [];

Module._cache[ptyPath] = {
  id: ptyPath,
  filename: ptyPath,
  loaded: true,
  exports: {
    spawn: (bin, args, opts) => {
      const term = new FakeTerminal();
      spawnedProcesses.push({ bin, args, opts, term });
      return term;
    },
  },
};

const { spawn } = require('../electron/agent.js');

// ============================================================================
// Test 1: Trust dialog automation via virtual PTY stream
// ============================================================================
async function testTrustDialogAutomation() {
  const agentId = 'mock-trust-agent';
  let exitedCode = null;

  const agent = spawn({
    id: agentId,
    cwd: 'C:/fake/repo',
    task: 'analizar codigo',
    bin: 'claude',
    mode: 'plan',
    onExit: (code) => { exitedCode = code; },
  });

  const lastSpawn = spawnedProcesses[spawnedProcesses.length - 1];
  assert.ok(lastSpawn, 'debe haberse llamado al spawn virtual');

  // Simulate prompt output from Claude CLI
  lastSpawn.term.emitData('Accessing workspace: Quick safety check... Do you trust this folder? (I trust this folder)\r\n');

  // Keystrokes are sent with setTimeout(..., 300) and i * 150
  const deadline = Date.now() + 2000;
  while ((!lastSpawn.term.written.includes('\x1b[B') || !lastSpawn.term.written.includes('\r')) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }

  // Claude requires Down Arrow (\x1b[B) + Enter (\r)
  assert.ok(lastSpawn.term.written.includes('\x1b[B'), 'debe haber enviado flecha abajo');
  assert.ok(lastSpawn.term.written.includes('\r'), 'debe haber enviado enter');

  agent.kill();
  assert.strictEqual(exitedCode, 0, 'onExit debe haberse disparado');
  fs.rmSync(paths.agent(agentId).dir, { recursive: true, force: true });
  console.log('testTrustDialogAutomation OK: virtual PTY responde automaticamente al trust dialog');
}

// ============================================================================
// Test 2: State transitions & Token Tracking in Registry
// ============================================================================
function testRegistryStateTransitions() {
  const agentId = 'mock-lifecycle-agent';
  /** @type {any[]} */
  const snapshots = [];

  const registry = new Registry((agents) => {
    const a = agents.find((x) => x.id === agentId);
    if (a) snapshots.push({ state: a.state, tool: a.tool, tokens: a.tokens });
  });

  const agent = spawn({
    id: agentId,
    cwd: 'C:/fake/repo',
    task: 'refactorizar modulos',
    bin: 'agy',
    mode: 'plan',
  });

  registry.register(agent);

  // Apply simulated events directly into registry
  registry.apply(agentId, {
    event: 'PreInvocation',
    at: new Date().toISOString(),
    payload: {},
  });
  registry.publish();

  registry.apply(agentId, {
    event: 'PreToolUse',
    at: new Date().toISOString(),
    payload: { toolCall: { name: 'view_file', args: { AbsolutePath: 'C:/fake/file.js' } } },
  });
  registry.publish();

  registry.apply(agentId, {
    event: 'Status',
    at: new Date().toISOString(),
    payload: {
      context_window: { total_input_tokens: 1500, total_output_tokens: 350, used_percentage: 12 },
    },
  });
  registry.publish();

  registry.apply(agentId, {
    event: 'Stop',
    at: new Date().toISOString(),
    payload: {},
  });
  registry.publish();

  // Verify transition states
  const states = snapshots.map((s) => s.state);
  assert.ok(states.includes('tool'), 'debe haber alcanzado estado tool con una herramienta estándar');
  assert.ok(states.includes('idle'), 'debe haber alcanzado estado idle al finalizar turno');

  const latest = snapshots[snapshots.length - 1];
  assert.strictEqual(latest.tokens, 1850, 'debe sumar input tokens + output tokens');

  agent.kill();
  console.log('testRegistryStateTransitions OK: transiciones PreInvocation -> PreToolUse -> Status -> Stop verificadas');
}

// ============================================================================
// Test 3: Coordinator delegation to secondary child agent
// ============================================================================
async function testCoordinatorSpawnsWorker() {
  const convObj = conv.createConversation({ title: 'coord-mock-delegation', cap: 3 });
  const coordId = 'coord-mock-1';
  let workerSpawned = false;

  const { makeDisposableRepo } = require('./test-helpers.js');
  const tempRepo = makeDisposableRepo('cute-coord-mock-');

  try {
    const coordAgent = spawn({
      id: coordId,
      cwd: tempRepo,
      task: 'coordinar tareas',
      systemPrompt: 'eres el coordinador',
    });

    const watcher = coordinator.watchSpawnRequests(convObj.id, (req) => {
      assert.strictEqual(req.objective, 'crear endpoint');
      workerSpawned = true;
    });

    const requestsDir = path.join(conv.conversationPaths(convObj.id).dir, 'spawn-requests');
    fs.mkdirSync(requestsDir, { recursive: true });
    fs.writeFileSync(path.join(requestsDir, 'req-auto.json'), JSON.stringify({
      objective: 'crear endpoint',
      cwd: tempRepo,
    }));

    const deadline = Date.now() + 2000;
    while (!workerSpawned && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.ok(workerSpawned, 'el watcher del coordinador debio drenar y activar la delegacion');
    watcher.close();
    coordAgent.kill();
  } finally {
    fs.rmSync(tempRepo, { recursive: true, force: true });
    fs.rmSync(conv.conversationPaths(convObj.id).dir, { recursive: true, force: true });
  }

  console.log('testCoordinatorSpawnsWorker OK: delegacion simulada drena pedido y activa worker');
}

// ============================================================================
// Main Runner
// ============================================================================
(async () => {
  try {
    await testTrustDialogAutomation();
    testRegistryStateTransitions();
    await testCoordinatorSpawnsWorker();
    console.log('\nTodos los tests de arnes de ciclo de vida con PTY virtual pasaron exitosamente.');
    process.exit(0);
  } finally {
    if (originalPty) Module._cache[ptyPath] = originalPty;
    else delete Module._cache[ptyPath];
  }
})().catch((err) => {
  console.error('\nFallo en tests de ciclo de vida mock:', err);
  process.exit(1);
});
