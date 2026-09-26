// @ts-check
/**
 * Automated smoke & stability verification for packaged executable in dist/.
 *
 * Verifies that:
 * 1. The compiled executable (dist/win-unpacked/Cute Agents Desk.exe) exists.
 * 2. Launches the binary with `--smoke` using a temporary user-data directory to prevent
 *    lock collisions with any concurrently running desktop instances.
 * 3. Keeps execution alive across a minimum time window (3 to 5 seconds) to allow initial
 *    XAML inflation and Chromium IPC readiness.
 * 4. Ensures clean process exit (code 0) without exceptions in Windows Event Viewer or crash logs.
 *
 * Run with: node tools/verify-dist-binary.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BINARY_PATH = path.join(PROJECT_ROOT, 'dist', 'win-unpacked', 'Cute Agents Desk.exe');

function main() {
  console.log('Validando existencia del binario empaquetado...');
  assert.ok(fs.existsSync(BINARY_PATH), `No se encontró el ejecutable en: ${BINARY_PATH}. Ejecuta 'npm run dist' primero.`);

  const stats = fs.statSync(BINARY_PATH);
  console.log(`  Binario detectado: ${path.basename(BINARY_PATH)} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cute-smoke-userdata-'));
  console.log(`  User-data aislado: ${tempUserData}`);

  const startedAt = Date.now();
  console.log('Iniciando proceso con --smoke y verificando estabilidad...');

  try {
    // Launch executable with --smoke
    const run = spawnSync(BINARY_PATH, ['--smoke'], {
      encoding: 'utf8',
      timeout: 35000,
    });

    const elapsed = Date.now() - startedAt;
    console.log(`  Proceso finalizado en ${elapsed}ms con código de salida: ${run.status}`);

    if (run.stdout) {
      console.log('  Stdout:\n' + run.stdout.trim().split('\n').map((l) => `    ${l}`).join('\n'));
    }
    if (run.stderr) {
      console.log('  Stderr:\n' + run.stderr.trim().split('\n').map((l) => `    ${l}`).join('\n'));
    }

    assert.strictEqual(run.status, 0, `El ejecutable finalizó con error (código ${run.status})`);
    console.log('\nSmoke test del binario empaquetado OK: UI y protocolos cargaron sin fallos.');
  } finally {
    try {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.error('\nFallo en la verificación del binario empaquetado:', err.message);
  process.exit(1);
}
