// @ts-check
/**
 * Hermetic unit test for Timeline projection and chronological state runs.
 * Verifies that state transitions are tracked chronologically, projected into percentage bars
 * relative to a rolling window, and that clock drifts and ongoing runs are handled safely.
 *
 * Run with: node tools/verify-timeline.js
 */

require('./test-home.js');
const assert = require('node:assert');
const { Registry } = require('../electron/events.js');

function testEmptyTimeline() {
  const registry = new Registry(() => {});
  const tl = registry.getTimelineData(30);

  assert.strictEqual(tl.window, 'últimos 30 min');
  assert.strictEqual(tl.ticks.length, 4);
  assert.strictEqual(tl.ticks[3], 'ahora');
  assert.deepStrictEqual(tl.lanes, []);

  console.log('testEmptyTimeline OK');
}

function testChronologicalStateRuns() {
  const registry = new Registry(() => {});
  const now = Date.now();
  const agentId = 'worker-tl-1';

  // State sequence: thinking for 5m, tool for 3m, thinking for 2m
  const t0 = now - 10 * 60 * 1000;
  const t1 = now - 5 * 60 * 1000;
  const t2 = now - 2 * 60 * 1000;

  registry.recordStateRun(agentId, 'thinking', t0);
  registry.recordStateRun(agentId, 'tool', t1);
  registry.recordStateRun(agentId, 'thinking', t2);

  const tl = registry.getTimelineData(30);
  assert.strictEqual(tl.lanes.length, 1);

  const lane = tl.lanes[0];
  assert.strictEqual(lane.agent, agentId);
  assert.strictEqual(lane.bars.length, 3, 'Must produce 3 distinct state bars');

  // Verify states in order
  assert.strictEqual(lane.bars[0][0], 'thinking');
  assert.strictEqual(lane.bars[1][0], 'tool');
  assert.strictEqual(lane.bars[2][0], 'thinking');

  // All fromPct and lenPct must be non-negative numbers
  for (const bar of lane.bars) {
    const [, fromPct, lenPct] = bar;
    assert.ok(fromPct >= 0 && fromPct <= 100, `fromPct (${fromPct}) must be within [0, 100]`);
    assert.ok(lenPct > 0 && lenPct <= 100, `lenPct (${lenPct}) must be positive`);
    assert.ok(!Number.isNaN(fromPct), 'fromPct must not be NaN');
    assert.ok(!Number.isNaN(lenPct), 'lenPct must not be NaN');
  }

  console.log('testChronologicalStateRuns OK');
}

function testWindowBoundaryClamping() {
  const registry = new Registry(() => {});
  const now = Date.now();
  const agentId = 'worker-old-1';

  // Run started 45 minutes ago (outside the 30-minute window) and ended 15 minutes ago
  const tStart = now - 45 * 60 * 1000;
  const tEnd = now - 15 * 60 * 1000;

  registry.recordStateRun(agentId, 'thinking', tStart);
  registry.recordStateRun(agentId, 'done', tEnd);

  const tl = registry.getTimelineData(30);
  assert.strictEqual(tl.lanes.length, 1);

  const lane = tl.lanes[0];
  const bar0 = lane.bars[0]; // 'thinking' bar
  assert.strictEqual(bar0[0], 'thinking');
  assert.strictEqual(bar0[1], 0, 'Runs starting before windowStart must clamp fromPct to 0%');
  assert.strictEqual(bar0[2], 50, '15 min within 30 min window must be exactly 50% length');

  console.log('testWindowBoundaryClamping OK');
}

function testMultiAgentLanes() {
  const registry = new Registry(() => {});
  const now = Date.now();

  registry.recordStateRun('coord-1', 'thinking', now - 20 * 60 * 1000);
  registry.recordStateRun('worker-a', 'tool', now - 10 * 60 * 1000);
  registry.recordStateRun('worker-b', 'blocked', now - 5 * 60 * 1000);

  const tl = registry.getTimelineData(30);
  assert.strictEqual(tl.lanes.length, 3, 'Must produce a distinct lane for each agent');
  const agents = tl.lanes.map((l) => l.agent);
  assert.ok(agents.includes('coord-1'));
  assert.ok(agents.includes('worker-a'));
  assert.ok(agents.includes('worker-b'));

  console.log('testMultiAgentLanes OK');
}

testEmptyTimeline();
testChronologicalStateRuns();
testWindowBoundaryClamping();
testMultiAgentLanes();
console.log('All verify-timeline tests passed cleanly.');
