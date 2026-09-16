// @ts-check
/**
 * Hermetic unit test for synthesizeFlows in ui/data.js.
 * Verifies that conversations, coordinators, and workers are dynamically synthesized into
 * robust flow objects for the radial SVG graph in ui/boss-graph.js.
 *
 * Run with: node tools/verify-flows-synthesis.mjs
 */

import assert from 'node:assert';
import { synthesizeFlows, setLiveAgents, setLiveConversations, getFlows } from '../ui/data.js';

function testEmptyState() {
  const flows = synthesizeFlows([], [], []);
  assert.deepStrictEqual(flows, [], 'Empty agents and conversations should return empty flows');
  console.log('testEmptyState OK');
}

function testCoordinatorWithWorkers() {
  const conversations = [
    { id: 'c-test1', title: 'Refactor Auth Subsystem', topic: 'backend security', cap: 3 },
  ];
  const agents = [
    {
      id: 'co-1',
      role: 'coordinator',
      conversationId: 'c-test1',
      state: 'thinking',
      engine: 'claude cli',
      costUsd: 0.05,
      tokens: 2500,
      tokenCap: 200000,
      cwd: 'C:/repos/auth-repo',
      repo: 'auth-repo',
      accountId: 'work-acc',
    },
    {
      id: 'w-1',
      role: 'worker',
      conversationId: 'c-test1',
      replyTo: 'co-1',
      state: 'tool',
      engine: 'claude cli',
      costUsd: 0.12,
      tokens: 15000,
      tokenCap: 50000,
      cwd: 'C:/repos/auth-repo',
      repo: 'auth-repo',
      branch: 'claude/auth-fix',
      accountId: 'work-acc',
      tool: 'Edit · src/login.ts',
      mode: 'read',
      deniedCount: 2,
      lastVerify: 'fail',
    },
    {
      id: 'w-2',
      role: 'worker',
      conversationId: 'c-test1',
      replyTo: 'co-1',
      state: 'idle',
      engine: 'claude cli',
      costUsd: 0.08,
      tokens: 8000,
      tokenCap: 50000,
      cwd: 'C:/repos/auth-repo',
      repo: 'auth-repo',
      branch: 'claude/auth-docs',
      accountId: 'work-acc',
      tool: 'turno terminado',
    },
  ];

  const flows = synthesizeFlows(agents, conversations, [{ id: 'work-acc', name: 'Work Account' }]);
  assert.strictEqual(flows.length, 1, 'Should synthesize exactly 1 flow for the conversation');

  const f = flows[0];
  assert.strictEqual(f.id, 'c-test1');
  assert.strictEqual(f.name, 'Refactor Auth Subsystem');
  assert.strictEqual(f.short, 'Refactor Auth Subsystem', 'Flow short name must match conversation title');
  assert.strictEqual(f.status, 'activo', 'Flow should be activo when an agent is thinking or tool');
  assert.strictEqual(f.roster.length, 2, 'Coordinator must be hub; roster should only include the 2 workers');
  assert.strictEqual(f.cost, 0.25, 'Total cost must sum coordinator + workers: 0.05 + 0.12 + 0.08 = 0.25');
  assert.strictEqual(f.roster[0].ctxPct, 30, 'Worker 1 context percentage: 15000 / 50000 = 30%');
  assert.strictEqual(f.roster[1].ctxPct, 16, 'Worker 2 context percentage: 8000 / 50000 = 16%');
  assert.ok(f.coordinator, 'Coordinator object must be preserved in flow');
  assert.strictEqual(f.coordinator.id, 'co-1');
  assert.strictEqual(f.coordinator.state, 'thinking');

  assert.strictEqual(f.roster[0].mode, 'read', 'mode must pass through from the raw agent');
  assert.strictEqual(f.roster[0].deniedCount, 2, 'deniedCount must pass through from the raw agent');
  assert.strictEqual(f.roster[0].lastVerify, 'fail', 'lastVerify must pass through from the raw agent');
  assert.strictEqual(f.roster[1].mode, 'write', 'mode defaults to write when the agent has none');
  assert.strictEqual(f.blocked, 2, 'blocked must sum deniedCount across roster and coordinator, not a guessed count');

  console.log('testCoordinatorWithWorkers OK');
}

function testCoordinatorLinksFromDependsOn() {
  const conversations = [{ id: 'c-dag', title: 'DAG Pipeline', cap: 3 }];
  const agents = [
    { id: 'co-dag', role: 'coordinator', conversationId: 'c-dag', state: 'thinking' },
    { id: 'w-a', role: 'worker', conversationId: 'c-dag', state: 'done' },
    { id: 'w-b', role: 'worker', conversationId: 'c-dag', state: 'tool', dependsOn: ['w-a'] },
  ];

  const flows = synthesizeFlows(agents, conversations, []);
  assert.strictEqual(flows.length, 1);
  assert.deepStrictEqual(flows[0].links, [['w-a', 'w-b']], 'Links must be synthesized from dependsOn');
  console.log('testCoordinatorLinksFromDependsOn OK');
}

function testDagGhostTasks() {
  const conversations = [{ id: 'c-dag2', title: 'DAG with queue', cap: 3 }];
  const agents = [
    { id: 'co-dag2', role: 'coordinator', conversationId: 'c-dag2', state: 'idle' },
    { id: 'w-done', role: 'worker', conversationId: 'c-dag2', state: 'done' },
  ];
  const dag = [
    { id: 'w-queued', state: 'pending', dependsOn: ['w-done'], conversationId: 'c-dag2' },
    { id: 'w-aborted', state: 'failed', dependsOn: ['w-queued'], conversationId: 'c-dag2' },
    { id: 'other-conv-task', state: 'pending', dependsOn: [], conversationId: 'some-other-conv' },
  ];

  const flows = synthesizeFlows(agents, conversations, [], dag);
  assert.strictEqual(flows.length, 1);
  const f = flows[0];

  const queued = f.roster.find((r) => r.id === 'w-queued');
  assert.ok(queued, 'A pending Scheduler task must appear as a ghost roster entry');
  assert.strictEqual(queued.state, 'queued', 'A pending task is shown as queued, not idle');

  const aborted = f.roster.find((r) => r.id === 'w-aborted');
  assert.ok(aborted, 'A cascade-failed task that never spawned must still appear');
  assert.strictEqual(aborted.state, 'failed');

  assert.strictEqual(f.status, 'bloqueado', 'A failed ghost task must flip the flow to bloqueado');
  assert.ok(!f.roster.some((r) => r.id === 'other-conv-task'), 'A task from a different conversation must not leak in');

  console.log('testDagGhostTasks OK');
}

function testBlockedStatePropagation() {
  const conversations = [{ id: 'c-blocked', title: 'Blocked Flow', cap: 2 }];
  const agents = [
    {
      id: 'w-blocked',
      conversationId: 'c-blocked',
      state: 'blocked',
      tokens: 5000,
      tokenCap: 10000,
      costUsd: 0.02,
      cwd: 'C:/repos/repo-x',
      repo: 'repo-x',
    },
  ];

  const flows = synthesizeFlows(agents, conversations, []);
  assert.strictEqual(flows.length, 1);
  assert.strictEqual(flows[0].status, 'bloqueado', 'Blocked agent must transition flow to bloqueado');
  console.log('testBlockedStatePropagation OK');
}

function testOrphanAgentsFlow() {
  const agents = [
    {
      id: 'standalone-1',
      state: 'thinking',
      tokens: 1000,
      tokenCap: 20000,
      costUsd: 0.01,
      cwd: 'C:/repos/repo-y',
      repo: 'repo-y',
    },
  ];

  const flows = synthesizeFlows(agents, [], []);
  assert.strictEqual(flows.length, 1, 'Standalone agent must generate ad-hoc direct dispatch flow');
  assert.strictEqual(flows[0].id, 'direct-dispatch');
  assert.strictEqual(flows[0].roster.length, 1);
  assert.strictEqual(flows[0].status, 'activo');
  console.log('testOrphanAgentsFlow OK');
}

function testGetFlowsFallback() {
  setLiveConversations([{ id: 'c-live', title: 'Live Conversation', cap: 2 }]);
  setLiveAgents([
    {
      id: 'a-live',
      conversationId: 'c-live',
      state: 'thinking',
      tokens: 2000,
      tokenCap: 10000,
      costUsd: 0.03,
      cwd: 'C:/repos/repo-z',
      repo: 'repo-z',
    },
  ]);

  const flows = getFlows();
  assert.strictEqual(flows.length, 1);
  assert.strictEqual(flows[0].id, 'c-live');
  assert.strictEqual(flows[0].name, 'Live Conversation');
  assert.strictEqual(flows[0].status, 'activo');
  console.log('testGetFlowsFallback OK');
}

testEmptyState();
testCoordinatorWithWorkers();
testCoordinatorLinksFromDependsOn();
testDagGhostTasks();
testBlockedStatePropagation();
testOrphanAgentsFlow();
testGetFlowsFallback();
console.log('All verify-flows-synthesis tests passed cleanly.');
