// @ts-check
/**
 * Verification test for config.json support, schema defaults, deep merge,
 * bounds validation, prototype pollution protection, and atomic persistence.
 *
 * Run with: node tools/verify-config.js
 */

const { dir } = require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const paths = require('../electron/paths.js');
const {
  readConfig,
  writeConfig,
  updateConfigKey,
  resetConfig,
  getConfigPath,
  DEFAULT_CONFIG,
} = require('../electron/config.js');
const { Scheduler } = require('../electron/scheduler.js');

// 1. Verify path resolution in test environment
const resolvedPath = getConfigPath();
assert.strictEqual(resolvedPath, path.join(dir, 'config.json'), 'getConfigPath should point inside CUTE_AGENTS_DESK_HOME');

// 2. Verify reading when no file exists returns defaults
const initial = readConfig(true);
assert.strictEqual(initial.exec.maxParallel, 5, 'default maxParallel should be 5');
assert.strictEqual(initial.deliver.draftPR, true, 'default draftPR should be true');
assert.strictEqual(initial.engines.claude.contextCap, 200000, 'default claude contextCap should be 200k');

// 3. Verify atomic persistence with updateConfigKey
const updateRes = updateConfigKey('exec', 'maxParallel', 8);
assert.strictEqual(updateRes.ok, true, 'updateConfigKey should succeed');
assert.strictEqual(updateRes.config.exec.maxParallel, 8, 'updated config in memory should have 8');

assert.ok(fs.existsSync(resolvedPath), 'config.json should physically exist on disk');
const diskContent = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
assert.strictEqual(diskContent.exec.maxParallel, 8, 'config on disk should have maxParallel 8');

// 4. Verify deep merge resilience with partial schema
// Simulate an older config file that only specifies partial fields
const partial = {
  coordinators: {
    maxSessionsPerCoordinator: 10,
  },
  deliver: {
    draftPR: false,
  },
};
fs.writeFileSync(resolvedPath, JSON.stringify(partial, null, 2), 'utf8');

const merged = readConfig(true);
assert.strictEqual(merged.coordinators.maxSessionsPerCoordinator, 10, 'custom coordinator cap should be preserved');
assert.strictEqual(merged.deliver.draftPR, false, 'custom draftPR flag should be preserved');
// Unspecified keys must fallback to DEFAULT_CONFIG
assert.strictEqual(merged.exec.maxParallel, 5, 'missing exec.maxParallel should fallback to default 5');
assert.strictEqual(merged.engines.agy.contextCap, 200000, 'missing engine configs should fallback to defaults');

// 5. Verify Scheduler dynamic reconfiguration
const scheduler = new Scheduler({ globalCap: merged.exec.maxParallel });
assert.strictEqual(scheduler.globalCap, 5, 'Scheduler should initialize with merged config');
scheduler.globalCap = 12;
assert.strictEqual(scheduler.globalCap, 12, 'Scheduler globalCap should support dynamic updates');

// 6. Verify Prototype Pollution Protection (V-01)
const protoAttack = updateConfigKey('__proto__', 'polluted', true);
assert.strictEqual(protoAttack.ok, false, 'updateConfigKey should reject __proto__');
// @ts-ignore
assert.strictEqual(({}).polluted, undefined, 'Object prototype must not be polluted');

const constructorAttack = updateConfigKey('constructor', 'polluted', true);
assert.strictEqual(constructorAttack.ok, false, 'updateConfigKey should reject constructor');

// 7. Verify Bounds Validation & Clamping (V-02)
const underflow = updateConfigKey('exec', 'maxParallel', -50);
assert.strictEqual(underflow.ok, true, 'update should clamp lower bound');
assert.strictEqual(underflow.config.exec.maxParallel, 1, 'negative maxParallel must clamp to 1');

const overflow = updateConfigKey('exec', 'maxParallel', 9999);
assert.strictEqual(overflow.ok, true, 'update should clamp upper bound');
assert.strictEqual(overflow.config.exec.maxParallel, 20, 'overflowing maxParallel must clamp to 20');

// 8. Verify Unknown Key / Section Rejection
const unknownSection = updateConfigKey('unknownSec', 'foo', 'bar');
assert.strictEqual(unknownSection.ok, false, 'unknown section must be rejected');

const unknownKey = updateConfigKey('exec', 'unknownKey', 123);
assert.strictEqual(unknownKey.ok, false, 'unknown key in valid section must be rejected');

// 9. Verify Rapid Successive Updates (V-03 race condition guard)
for (let i = 1; i <= 5; i++) {
  const res = updateConfigKey('coordinators', 'maxSessionsPerCoordinator', i);
  assert.strictEqual(res.ok, true, `rapid update step ${i} should succeed`);
}
const freshDisk = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
assert.strictEqual(freshDisk.coordinators.maxSessionsPerCoordinator, 5, 'disk should match latest sequential update');

// 10. Verify resetConfig restores defaults
const resetResult = resetConfig();
assert.strictEqual(resetResult.deliver.draftPR, true, 'resetConfig should restore default draftPR');
const diskAfterReset = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
assert.strictEqual(diskAfterReset.deliver.draftPR, true, 'disk after reset should have default draftPR');

console.log('config.json OK: resolucion, defaults, bounds, prototype guard, atomicidad y deep merge validados');
process.exit(0);
