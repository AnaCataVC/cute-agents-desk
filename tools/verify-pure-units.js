// @ts-check
/**
 * Hermetic unit test suite for core pure utility modules:
 * - electron/json-queue.js
 * - electron/frontmatter.js
 * - electron/tool-name.js
 *
 * Runs entirely in-memory or on disposable temp directories. Zero network or CLI dependencies.
 * Run with: node tools/verify-pure-units.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { drainJsonQueue, watchJsonQueue } = require('../electron/json-queue.js');
const { parseSkillFrontmatter, readSkillFrontmatter, MAX_FRONTMATTER_BYTES } = require('../electron/frontmatter.js');
const { toolNameOf } = require('../electron/tool-name.js');

// ============================================================================
// 1. Tests for toolNameOf
// ============================================================================
function testToolNameOf() {
  // Claude style (snake_case tool_name)
  assert.strictEqual(toolNameOf({ tool_name: 'Edit' }), 'Edit');
  assert.strictEqual(toolNameOf({ tool_name: 'Bash' }), 'Bash');

  // Agy style (camelCase toolCall.name)
  assert.strictEqual(toolNameOf({ toolCall: { name: 'run_command' } }), 'run_command');
  assert.strictEqual(toolNameOf({ toolCall: { name: 'replace_file_content' } }), 'replace_file_content');

  // Fallbacks and malformed inputs
  assert.strictEqual(toolNameOf(null), undefined);
  assert.strictEqual(toolNameOf(undefined), undefined);
  assert.strictEqual(toolNameOf({}), undefined);
  assert.strictEqual(toolNameOf({ other_field: 'val' }), undefined);
  assert.strictEqual(toolNameOf({ toolCall: null }), undefined);

  console.log('toolNameOf OK: resuelve nombres en formato Claude y Agy correctamente');
}

// ============================================================================
// 2. Tests for frontmatter parser (parseSkillFrontmatter & readSkillFrontmatter)
// ============================================================================
function testFrontmatterParser() {
  // UTF-8 BOM handling
  const bomText = '\uFEFF---\nname: bom-skill\ndescription: Has a UTF-8 BOM marker\n---\nBody';
  const parsedBom = parseSkillFrontmatter(bomText);
  assert.strictEqual(parsedBom.name, 'bom-skill');
  assert.strictEqual(parsedBom.description, 'Has a UTF-8 BOM marker');

  // Nested metadata.version and multiline comments
  const complexYaml = `---
# Top level comment
name: "quoted-skill"
metadata.version: '1.2.3'
always_on: true
description: |-
  A multiline description
  that preserves block structure
# Trailing comment
---
Markdown content here
`;
  const parsedComplex = parseSkillFrontmatter(complexYaml);
  assert.strictEqual(parsedComplex.name, 'quoted-skill');
  assert.strictEqual(parsedComplex.version, '1.2.3');
  assert.strictEqual(parsedComplex.load, 'siempre');
  assert.strictEqual(parsedComplex.description, 'A multiline description that preserves block structure');

  // Safe file reader bounded by MAX_FRONTMATTER_BYTES
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cute-fm-test-'));
  const testFile = path.join(tempDir, 'SKILL.md');
  const hugeFile = path.join(tempDir, 'HUGE.md');

  try {
    fs.writeFileSync(testFile, `---\nname: disk-skill\ndescription: Read from disk\nload: always\n---\n`);
    const diskParsed = readSkillFrontmatter(testFile);
    assert.strictEqual(diskParsed.name, 'disk-skill');
    assert.strictEqual(diskParsed.description, 'Read from disk');
    assert.strictEqual(diskParsed.load, 'siempre');

    // Huge file exceeding 8KB: should read up to 8192 bytes and safely parse without memory bloat
    const bigHeader = `---\nname: big-skill\ndescription: Big header\n---\n`;
    const filler = 'A'.repeat(MAX_FRONTMATTER_BYTES * 2);
    fs.writeFileSync(hugeFile, bigHeader + filler);

    const hugeParsed = readSkillFrontmatter(hugeFile);
    assert.strictEqual(hugeParsed.name, 'big-skill');
    assert.strictEqual(hugeParsed.description, 'Big header');

    // Nonexistent file should fail gracefully
    const missingParsed = readSkillFrontmatter(path.join(tempDir, 'does-not-exist.md'));
    assert.strictEqual(missingParsed.name, null);
    assert.strictEqual(missingParsed.description, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('frontmatterParser OK: gestiona BOM, comentarios, valores entrecomillados y limite DoS');
}

// ============================================================================
// 3. Tests for json-queue (drainJsonQueue & watchJsonQueue)
// ============================================================================
async function testJsonQueue() {
  const tempQueueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cute-json-queue-'));

  try {
    // Non-existent directory returns false
    assert.strictEqual(drainJsonQueue(path.join(tempQueueDir, 'nonexistent'), () => {}), false);

    // Empty directory returns false
    assert.strictEqual(drainJsonQueue(tempQueueDir, () => {}), false);

    // Write a set of valid, corrupt, and ignored files
    fs.writeFileSync(path.join(tempQueueDir, '01-valid.json'), JSON.stringify({ seq: 1, text: 'hello' }));
    fs.writeFileSync(path.join(tempQueueDir, '02-corrupt.json'), '{ invalid json content ...');
    fs.writeFileSync(path.join(tempQueueDir, '03-leave-in-place.json'), JSON.stringify({ seq: 3, keep: true }));
    fs.writeFileSync(path.join(tempQueueDir, '04-valid.json'), JSON.stringify({ seq: 4, text: 'world' }));
    fs.writeFileSync(path.join(tempQueueDir, '.hidden.json'), JSON.stringify({ seq: 0, hidden: true }));
    fs.writeFileSync(path.join(tempQueueDir, 'not-a-json.txt'), 'plain text');

    /** @type {any[]} */
    const drained = [];
    const drainResult = drainJsonQueue(tempQueueDir, (item) => {
      if (item.keep) return false; // Reject so it is left in place
      drained.push(item);
    });

    assert.strictEqual(drainResult, true, 'drainJsonQueue debe indicar que hubo procesamiento');
    assert.strictEqual(drained.length, 2, 'debe drenar exactamente los 2 items validos');
    assert.strictEqual(drained[0].seq, 1);
    assert.strictEqual(drained[1].seq, 4);

    // Check disk state after drain
    const remainingFiles = fs.readdirSync(tempQueueDir);
    assert.ok(!remainingFiles.includes('01-valid.json'), 'el archivo valido procesado debe ser eliminado');
    assert.ok(!remainingFiles.includes('04-valid.json'), 'el segundo archivo valido debe ser eliminado');
    assert.ok(remainingFiles.includes('02-corrupt.json'), 'el archivo corrupto debe permanecer para no perder trazas');
    assert.ok(remainingFiles.includes('03-leave-in-place.json'), 'el archivo rechazado por el callback debe permanecer');
    assert.ok(remainingFiles.includes('.hidden.json'), 'archivos ocultos no deben procesarse');
    assert.ok(remainingFiles.includes('not-a-json.txt'), 'archivos sin extension .json no deben tocarse');

    // Test watchJsonQueue
    let triggerCount = 0;
    const watcher = watchJsonQueue(tempQueueDir, () => {
      triggerCount++;
    });

    assert.ok(triggerCount >= 1, 'watchJsonQueue debe invocar el handler al menos una vez al iniciar');

    // Create a new item to trigger watcher
    fs.writeFileSync(path.join(tempQueueDir, '05-watch.json'), JSON.stringify({ seq: 5 }));

    const deadline = Date.now() + 2000;
    while (triggerCount < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.ok(triggerCount >= 2, 'el watcher debe dispararse al agregarse un nuevo archivo');
    watcher.close();
  } finally {
    fs.rmSync(tempQueueDir, { recursive: true, force: true });
  }

  console.log('jsonQueue OK: drena archivos ordenados, tolera JSON invalido y respeta rechazos');
}

// ============================================================================
// Main Runner
// ============================================================================
(async () => {
  testToolNameOf();
  testFrontmatterParser();
  await testJsonQueue();
  console.log('\nTodos los tests unitarios puros pasaron exitosamente.');
  process.exit(0);
})().catch((err) => {
  console.error('\nFallo en tests unitarios:', err);
  process.exit(1);
});
