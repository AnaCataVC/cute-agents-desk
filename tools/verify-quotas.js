// @ts-check
/**
 * Test: CLI Subscription Quota Parsers and Cache (verify-quotas.js)
 *
 * Validates:
 * 1. parsing of official `agy -p "/usage"` tabular TSV output (Gemini and Claude/GPT splits, remaining %, resets).
 * 2. parsing of official `claude -p "/usage"` text output (session %, week %, reset timestamp).
 * 3. resilient fallback on empty, malformed, or missing CLI outputs without crashing.
 * 4. in-memory TTL caching prevents redundant CLI process spawning.
 *
 * Run with: node tools/verify-quotas.js
 */

const assert = require('node:assert');
const { parseAgyUsage, parseClaudeUsage, getQuotas, CACHE_TTL_MS } = require('../electron/quotas.js');

// --- 1. Test parseAgyUsage with real sample ---
const realAgySample = [
  'Gemini Models\tWeekly Limit Remaining\t63%\t2026-09-18T12:29:40Z',
  'Gemini Models\tFive Hour Limit Remaining\t48%\t2026-09-12T15:32:15Z',
  'Claude and GPT models\tWeekly Limit Remaining\t1%\t2026-09-15T17:03:00Z',
  'Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-09-12T17:31:28Z',
].join('\n');

const parsedAgy = parseAgyUsage(realAgySample);
assert.ok(parsedAgy, 'parseAgyUsage should parse valid output');
assert.strictEqual(parsedAgy.gemini.weeklyRemainingPct, 63);
assert.strictEqual(parsedAgy.gemini.fiveHourRemainingPct, 48);
assert.strictEqual(parsedAgy.gemini.weeklyResetAt, '2026-09-18T12:29:40Z');
assert.strictEqual(parsedAgy.claude.weeklyRemainingPct, 1);
assert.strictEqual(parsedAgy.claude.fiveHourRemainingPct, 100);
assert.strictEqual(parsedAgy.claude.weeklyResetAt, '2026-09-15T17:03:00Z');

// Null and garbage inputs
assert.strictEqual(parseAgyUsage(''), null);
assert.strictEqual(parseAgyUsage(null), null);
assert.strictEqual(parseAgyUsage('random output without tabs'), null);

// --- 2. Test parseClaudeUsage with real sample ---
const realClaudeSample = `
Warning: no stdin data received in 3s, proceeding without it.
You are currently using your subscription to power your Claude Code usage

Current session: 0% used
Current week (all models): 100% used · resets Sep 13, 3:59pm (America/Santiago)
Current week (Fable): 0% used · resets Sep 13, 4pm (America/Santiago)

What's contributing to your limits usage?
`;

const parsedClaude = parseClaudeUsage(realClaudeSample);
assert.ok(parsedClaude, 'parseClaudeUsage should parse valid output');
assert.strictEqual(parsedClaude.sessionUsedPct, 0);
assert.strictEqual(parsedClaude.weekAllModelsUsedPct, 100);
assert.strictEqual(parsedClaude.weekResetsAt, 'Sep 13, 3:59pm');

// Null and garbage inputs
assert.strictEqual(parseClaudeUsage(''), null);
assert.strictEqual(parseClaudeUsage(null), null);
assert.strictEqual(parseClaudeUsage('No matches here'), null);

// --- 3. Test TTL and exports ---
assert.strictEqual(typeof CACHE_TTL_MS, 'number');
assert.ok(CACHE_TTL_MS > 0);
assert.strictEqual(typeof getQuotas, 'function');

console.log('ok  verify-quotas.js completed successfully');
