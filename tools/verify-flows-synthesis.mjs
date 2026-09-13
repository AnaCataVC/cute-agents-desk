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
  assert.strictEqual(f.status, 'activo', 'Flow should be activo when an agent is thinking or tool');
  assert.strictEqual(f.roster.length, 2, 'Coordinator must be hub; roster should only include the 2 workers');
  assert.strictEqual(f.cost, 0.25, 'Total cost must sum coordinator + workers: 0.05 + 0.12 + 0.08 = 0.25');
  assert.strictEqual(f.roster[0].ctxPct, 30, 'Worker 1 context percentage: 15000 / 50000 = 30%');
  assert.strictEqual(f.roster[1].ctxPct, 16, 'Worker 2 context percentage: 8000 / 50000 = 16%');

  console.log('testCoordinatorWithWorkers OK');
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
testBlockedStatePropagation();
testOrphanAgentsFlow();
testGetFlowsFallback();
console.log('All verify-flows-synthesis tests passed cleanly.');
