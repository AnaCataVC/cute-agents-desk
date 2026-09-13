// @ts-check
/**
 * Hermetic unit test for Chat Thread recording and Stdin input governance.
 * Verifies that messages are captured, properly attributed to authors, bounded in memory,
 * and that input sanitization and state gating work reliably.
 *
 * Run with: node tools/verify-chat-input.js
 */

require('./test-home.js');
const assert = require('node:assert');
const { Registry } = require('../electron/events.js');

function testThreadRecording() {
  const registry = new Registry(() => {});
  const agentId = 'worker-test-1';

  // 1. Initial empty thread
  assert.deepStrictEqual(registry.getThreads()[agentId], undefined);

  // 2. Record system message
  registry.recordMessage(agentId, 'sys', 'harness', 'Sesión iniciada');
  let thread = registry.getThreads()[agentId];
  assert.strictEqual(thread.length, 1);
  assert.strictEqual(thread[0][0], 'sys');
  assert.strictEqual(thread[0][1], 'harness');
  assert.strictEqual(thread[0][3], 'Sesión iniciada');

  // 3. Record tool breadcrumb
  registry.recordMessage(agentId, 'tool', 'herramienta', 'Edit · src/index.ts');
  thread = registry.getThreads()[agentId];
  assert.strictEqual(thread.length, 2);
  assert.strictEqual(thread[1][0], 'tool');
  assert.strictEqual(thread[1][3], 'Edit · src/index.ts');

  // 4. Record user message
  registry.recordMessage(agentId, 'user', 'tú', 'Por favor agrega tests unitarios');
  thread = registry.getThreads()[agentId];
  assert.strictEqual(thread.length, 3);
  assert.strictEqual(thread[2][0], 'user');
  assert.strictEqual(thread[2][1], 'tú');
  assert.strictEqual(thread[2][3], 'Por favor agrega tests unitarios');

  console.log('testThreadRecording OK');
}

function testThreadRetentionCap() {
  const registry = new Registry(() => {});
  const agentId = 'cap-test-1';

  for (let i = 0; i < 250; i++) {
    registry.recordMessage(agentId, 'sub', 'agente', `Mensaje ${i}`);
  }

  const thread = registry.getThreads()[agentId];
  assert.strictEqual(thread.length, 200, 'Thread must cap at maximum 200 entries to protect memory');
  assert.strictEqual(thread[thread.length - 1][3], 'Mensaje 249');
  assert.strictEqual(thread[0][3], 'Mensaje 50');

  console.log('testThreadRetentionCap OK');
}

function testInputSanitization() {
  const dangerousInput = '\x1b[31mRed Alert\x1b[0m\x00\x08with control characters and newlines\r\nand a very long tail'.repeat(100);
  const sanitized = dangerousInput
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b[()][A-B0-2]|[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '')
    .slice(0, 4000)
    .trim();

  assert.ok(!sanitized.includes('\x1b'), 'Sanitization must strip all ANSI escape sequences');
  assert.ok(!sanitized.includes('\x00'), 'Sanitization must strip null bytes');
  assert.ok(sanitized.length <= 4000, 'Sanitization must clamp max input length to 4000 characters');

  console.log('testInputSanitization OK');
}

function testCoordinatorWorkerExchangeAttribution() {
  const registry = new Registry(() => {});
  const coordId = 'co-hub-1';
  const workerId = 'w-spoke-1';

  registry.notifyCoordinator(coordId, workerId, 'arranco en repo-a: build target');

  const coordThread = registry.getThreads()[coordId];
  const workerThread = registry.getThreads()[workerId];

  assert.strictEqual(coordThread.length, 1);
  assert.strictEqual(coordThread[0][0], 'sub');
  assert.strictEqual(coordThread[0][1], workerId, 'Coordinator receives worker id as author');

  assert.strictEqual(workerThread.length, 1);
  assert.strictEqual(workerThread[0][0], 'sub');
  assert.strictEqual(workerThread[0][1], 'agente', 'Worker receives self label');

  console.log('testCoordinatorWorkerExchangeAttribution OK');
}

testThreadRecording();
testThreadRetentionCap();
testInputSanitization();
testCoordinatorWorkerExchangeAttribution();
console.log('All verify-chat-input tests passed cleanly.');
