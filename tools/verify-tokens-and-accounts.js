// @ts-check
/**
 * Verification test for token reactivity, usage calculation, and account color updates.
 *
 * Run with: node tools/verify-tokens-and-accounts.js
 */

const { dir } = require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const paths = require('../electron/paths.js');
const { Registry } = require('../electron/events.js');
const { updateAccountColor, readAccountsConfig, getAccountsConfigPath } = require('../electron/accounts.js');

let publishedAgents = null;
let publishedUsage = null;
const registry = new Registry((agents, usage) => {
  publishedAgents = agents;
  publishedUsage = usage;
});

const agent = {
  id: 'token-probe', cwd: 'C:/fake-repo', task: 'test-tokens', pid: 100,
  engine: 'claude',
  write: () => {},
  kill: () => {},
};
registry.register(agent, { tokenCap: 50000 });

// 1. Verify Status event updates agent tokens and triggers publish
const statusPayload = {
  event: 'Status',
  at: new Date().toISOString(),
  payload: {
    cost: { total_cost_usd: 0.15 },
    context_window: { total_input_tokens: 1200, total_output_tokens: 300, used_percentage: 15 },
  },
};

registry.apply('token-probe', statusPayload);

assert.ok(publishedAgents, 'Registry should publish on Status event');
const current = publishedAgents.find((a) => a.id === 'token-probe');
assert.strictEqual(current.tokens, 1500, 'Agent tokens should update to 1500');
assert.strictEqual(current.costUsd, 0.15, 'Agent cost should update to 0.15');

// 2. Verify getUsage aggregates active and historical tokens
const usage = registry.getUsage();
assert.strictEqual(usage.total.tokens, 1500, 'Total tokens should be 1500');
assert.strictEqual(usage.total.costUsd, 0.15, 'Total cost should be 0.15');
assert.strictEqual(usage.claude.tokens, 1500, 'Claude tokens should be 1500');
assert.ok(Array.isArray(usage.series) && usage.series.length === 24, 'Usage should include 24-hour series');
assert.ok(usage.allTime, 'Usage should include allTime metrics');
assert.strictEqual(usage.allTime.total.tokens, 1500, 'All-time total tokens should match 1500');
assert.ok(typeof usage.byAccount === 'object', 'Usage should include byAccount mapping');
assert.ok(typeof usage.byAccountAllTime === 'object', 'Usage should include byAccountAllTime mapping');

// When agent exits, usage is preserved in completedUsage
registry.exited('token-probe', 0);
const usageAfterExit = registry.getUsage();
assert.strictEqual(usageAfterExit.claude.tokens, 1500, 'Completed usage should retain tokens after agent exit');
assert.strictEqual(usageAfterExit.claude.costUsd, 0.15, 'Completed usage should retain cost after agent exit');
assert.strictEqual(usageAfterExit.allTime.claude.tokens, 1500, 'Completed all-time usage should retain tokens');


// 3. Verify updateAccountColor functionality
const configPath = getAccountsConfigPath();
const initialConfig = [
  { gh: 'TestUser', color: 'var(--color-mint)', folders: [] },
];
fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf8');

const updated = updateAccountColor('TestUser', 'var(--color-pink)');
assert.strictEqual(updated, true, 'updateAccountColor should return true for existing account');
const freshConfig = readAccountsConfig();
assert.strictEqual(freshConfig[0].color, 'var(--color-pink)', 'Config on disk should have updated color');

// Clean up agent dir
fs.rmSync(paths.agent('token-probe').dir, { recursive: true, force: true });
console.log('tokens y cuentas OK: reactividad de status, calculo de tokens y actualizacion de color validados');
process.exit(0);
