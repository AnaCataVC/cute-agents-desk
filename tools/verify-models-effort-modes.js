// @ts-check
/**
 * Fast unit verification for Model Selection, Reasoning Effort, and Execution Mode validation
 * across Claude Code (claude) and Antigravity CLI (agy).
 *
 * Checks:
 * 1. CLI flag generation for model, effort, and permission modes.
 * 2. Mode validation: 'write', 'plan', 'read' on both engines; 'auto' on claude only; rejection of 'auto' on agy.
 * 3. Effort validation: domain check per engine, rejecting 'xhigh'/'max' on agy.
 * 4. Model sanitization: preventing flag injection (cannot start with '-').
 * 5. Ambient fallback: when model/effort are omitted or 'default', neither flag is passed.
 * 6. Manifest persistence: model, effort, and mode saved in agent.json.
 * 7. Coordinator queue: preserving optional engine, model, effort, mode fields without breaking legacy payloads.
 *
 * Run with: node tools/verify-models-effort-modes.js
 */

require('./test-home.js');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const paths = require('../electron/paths.js');
const conv = require('../electron/conversations.js');
const { watchSpawnRequests } = require('../electron/coordinator.js');
const { validateAndSanitizeParams } = require('../electron/agent.js');

// --- 1. Validation & sanitization rules --------------------------------------------------------

function checkValidationRules() {
  // Mode validation
  assert.strictEqual(validateAndSanitizeParams({ engine: 'claude', mode: 'write' }).normMode, 'write');
  assert.strictEqual(validateAndSanitizeParams({ engine: 'claude', mode: 'plan' }).normMode, 'plan');
  assert.strictEqual(validateAndSanitizeParams({ engine: 'claude', mode: 'planning' }).normMode, 'plan');
  assert.strictEqual(validateAndSanitizeParams({ engine: 'claude', mode: 'auto' }).normMode, 'auto');
  assert.strictEqual(validateAndSanitizeParams({ engine: 'claude', mode: 'read' }).normMode, 'read');

  assert.strictEqual(validateAndSanitizeParams({ engine: 'agy', mode: 'write' }).normMode, 'write');
  assert.strictEqual(validateAndSanitizeParams({ engine: 'agy', mode: 'plan' }).normMode, 'plan');
  assert.strictEqual(validateAndSanitizeParams({ engine: 'agy', mode: 'read' }).normMode, 'read');

  // Auto mode rejected on agy
  assert.throws(() => {
    validateAndSanitizeParams({ engine: 'agy', mode: 'auto' });
  }, /el motor agy no soporta el modo "auto"/);

  // Unknown mode rejected
  assert.throws(() => {
    validateAndSanitizeParams({ engine: 'claude', mode: 'invalid-mode' });
  }, /modo no reconocido/);

  // Effort validation
  assert.strictEqual(validateAndSanitizeParams({ engine: 'claude', effort: 'max' }).normEffort, 'max');
  assert.strictEqual(validateAndSanitizeParams({ engine: 'claude', effort: 'xhigh' }).normEffort, 'xhigh');
  assert.strictEqual(validateAndSanitizeParams({ engine: 'claude', effort: 'high' }).normEffort, 'high');
  assert.strictEqual(validateAndSanitizeParams({ engine: 'agy', effort: 'high' }).normEffort, 'high');
  assert.strictEqual(validateAndSanitizeParams({ engine: 'agy', effort: 'low' }).normEffort, 'low');

  // xhigh / max rejected on agy
  assert.throws(() => {
    validateAndSanitizeParams({ engine: 'agy', effort: 'xhigh' });
  }, /el motor agy no soporta el nivel de esfuerzo "xhigh"/);

  assert.throws(() => {
    validateAndSanitizeParams({ engine: 'agy', effort: 'max' });
  }, /el motor agy no soporta el nivel de esfuerzo "max"/);

  // Model sanitization & flag injection defense
  assert.strictEqual(validateAndSanitizeParams({ engine: 'claude', model: 'sonnet' }).normModel, 'sonnet');
  assert.strictEqual(validateAndSanitizeParams({ engine: 'agy', model: 'gemini-3.8-flash-high' }).normModel, 'gemini-3.8-flash-high');

  assert.throws(() => {
    validateAndSanitizeParams({ engine: 'claude', model: '--dangerously-skip-permissions' });
  }, /nombre de modelo invalido o no permitido/);

  assert.throws(() => {
    validateAndSanitizeParams({ engine: 'agy', model: '-flag' });
  }, /nombre de modelo invalido o no permitido/);

  // Ambient defaults (default string or undefined omits)
  assert.strictEqual(validateAndSanitizeParams({ engine: 'claude', model: 'default' }).normModel, undefined);
  assert.strictEqual(validateAndSanitizeParams({ engine: 'claude', effort: 'default' }).normEffort, undefined);

  console.log('checkValidationRules OK: modos, esfuerzos y modelos validados correctamente');
}

// --- 2. Argv construction and manifest persistence ---------------------------------------------

function checkSpawnArgvAndManifest() {
  /** @type {any[]} */
  const calls = [];
  const fakeTerm = { onData() {}, onExit() {}, pid: 4567 };

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

    // 1. Claude with custom model, effort, and auto mode
    spawn({
      id: 'probe-claude-full',
      cwd: 'C:/fake-repo',
      task: 'tarea 1',
      bin: 'claude',
      model: 'opus',
      effort: 'max',
      mode: 'auto',
    });

    const cCall = calls[calls.length - 1];
    assert.ok(cCall.args.includes('--model') && cCall.args[cCall.args.indexOf('--model') + 1] === 'opus',
      'claude debe recibir --model opus');
    assert.ok(cCall.args.includes('--effort') && cCall.args[cCall.args.indexOf('--effort') + 1] === 'max',
      'claude debe recibir --effort max');
    assert.ok(cCall.args.includes('--permission-mode') && cCall.args[cCall.args.indexOf('--permission-mode') + 1] === 'auto',
      'claude debe recibir --permission-mode auto');

    const cManifest = JSON.parse(fs.readFileSync(paths.agent('probe-claude-full').manifest, 'utf8'));
    assert.strictEqual(cManifest.model, 'opus');
    assert.strictEqual(cManifest.effort, 'max');
    assert.strictEqual(cManifest.mode, 'auto');

    // 2. Claude in plan mode
    spawn({
      id: 'probe-claude-plan',
      cwd: 'C:/fake-repo',
      task: 'tarea plan',
      bin: 'claude',
      mode: 'plan',
    });
    const cPlanCall = calls[calls.length - 1];
    assert.ok(cPlanCall.args.includes('--permission-mode') && cPlanCall.args[cPlanCall.args.indexOf('--permission-mode') + 1] === 'plan',
      'claude en modo plan debe recibir --permission-mode plan');

    // 3. Agy with custom model, effort, and plan mode
    spawn({
      id: 'probe-agy-full',
      cwd: 'C:/fake-repo',
      task: 'tarea agy',
      bin: 'agy',
      model: 'gemini-3.8-flash-high',
      effort: 'medium',
      mode: 'plan',
    });

    const aCall = calls[calls.length - 1];
    assert.ok(aCall.args.includes('--model') && aCall.args[aCall.args.indexOf('--model') + 1] === 'gemini-3.8-flash-high',
      'agy debe recibir --model gemini-3.8-flash-high');
    assert.ok(aCall.args.includes('--effort') && aCall.args[aCall.args.indexOf('--effort') + 1] === 'medium',
      'agy debe recibir --effort medium');
    assert.ok(aCall.args.includes('--mode') && aCall.args[aCall.args.indexOf('--mode') + 1] === 'plan',
      'agy en modo plan debe recibir --mode plan');

    const aManifest = JSON.parse(fs.readFileSync(paths.agent('probe-agy-full').manifest, 'utf8'));
    assert.strictEqual(aManifest.model, 'gemini-3.8-flash-high');
    assert.strictEqual(aManifest.effort, 'medium');
    assert.strictEqual(aManifest.mode, 'plan');

    // 4. Ambient defaults (no model, no effort passed)
    spawn({
      id: 'probe-ambient-default',
      cwd: 'C:/fake-repo',
      task: 'tarea default',
      bin: 'claude',
    });
    const defCall = calls[calls.length - 1];
    assert.ok(!defCall.args.includes('--model'), 'sin model especificado no debe agregarse flag --model');
    assert.ok(!defCall.args.includes('--effort'), 'sin effort especificado no debe agregarse flag --effort');
    assert.ok(defCall.args.includes('--permission-mode') && defCall.args[defCall.args.indexOf('--permission-mode') + 1] === 'acceptEdits',
      'el modo por defecto para claude debe ser acceptEdits');

    console.log('checkSpawnArgvAndManifest OK: flags CLI y manifiesto persisten correctamente');
  } finally {
    Module._cache[ptyPath] = original;
  }
}

// --- 3. Coordinator queue preserves new fields --------------------------------------------------

async function checkCoordinatorQueueForwarding() {
  const conversation = conv.createConversation({ title: 'coord-params-test', cap: 3 });
  const dir = conv.conversationPaths(conversation.id).dir;
  const requestsDir = path.join(dir, 'spawn-requests');

  /** @type {object[]} */
  const seen = [];
  const watcher = watchSpawnRequests(conversation.id, (req) => seen.push(req));

  const written = {
    objective: 'auditoria de seguridad',
    cwd: 'C:/repos/toy-repo',
    mode: 'plan',
    engine: 'agy',
    model: 'claude-sonnet-4-6',
    effort: 'high',
  };

  const requestFile = path.join(requestsDir, 'req-params.json');
  fs.writeFileSync(requestFile, JSON.stringify(written));

  const deadline = Date.now() + 3000;
  while (seen.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }

  assert.strictEqual(seen.length, 1, 'deberia haber drenado la peticion con parametros');
  assert.deepStrictEqual(seen[0], written, 'debe preservar engine, model, effort y mode');

  watcher.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('checkCoordinatorQueueForwarding OK: buzon del coordinador preserva parametros opcionales');
}

// --- 4. UI constants exist and match engine requirements ---------------------------------------

async function checkUIConstants() {
  const uiData = await import('../ui/data.js');
  assert.ok(uiData.ENGINE_MODELS && uiData.ENGINE_MODELS.claude && uiData.ENGINE_MODELS.agy,
    'ui/data.js debe exportar ENGINE_MODELS para claude y agy');
  assert.ok(uiData.ENGINE_EFFORTS && uiData.ENGINE_EFFORTS.claude && uiData.ENGINE_EFFORTS.agy,
    'ui/data.js debe exportar ENGINE_EFFORTS para claude y agy');
  assert.ok(uiData.ENGINE_MODES && uiData.ENGINE_MODES.claude && uiData.ENGINE_MODES.agy,
    'ui/data.js debe exportar ENGINE_MODES para claude y agy');

  // Verify auto is only in claude modes, not agy
  assert.ok(uiData.ENGINE_MODES.claude.some((m) => m.id === 'auto'), 'claude debe incluir modo auto');
  assert.ok(!uiData.ENGINE_MODES.agy.some((m) => m.id === 'auto'), 'agy no debe incluir modo auto');

  // Verify xhigh and max are only in claude efforts, not agy
  assert.ok(uiData.ENGINE_EFFORTS.claude.includes('max') && uiData.ENGINE_EFFORTS.claude.includes('xhigh'));
  assert.ok(!uiData.ENGINE_EFFORTS.agy.includes('max') && !uiData.ENGINE_EFFORTS.agy.includes('xhigh'));

  console.log('checkUIConstants OK: constantes exportadas en ui/data.js validadas para claude y agy');
}

async function main() {
  checkValidationRules();
  checkSpawnArgvAndManifest();
  await checkCoordinatorQueueForwarding();
  await checkUIConstants();
  console.log('\nTodas las verificaciones de modelo, esfuerzo y modo pasaron exitosamente.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
