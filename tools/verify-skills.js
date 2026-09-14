// @ts-check
/**
 * Verifies dynamic Zero-Mock skill discovery and bounded frontmatter parsing.
 *
 * Runs hermetically against disposable temp fixtures, then runs a live system smoke check
 * against real CLI directories without mutating anything.
 *
 * Run with: node tools/verify-skills.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseSkillFrontmatter } = require('../electron/frontmatter.js');
const { scanSkills, sanitizePath, defaultRoots } = require('../electron/skills.js');

// ---- 1. Frontmatter Unit Tests ----

// Simple single-line frontmatter
const fm1 = parseSkillFrontmatter(`---
name: my-skill
description: Does one simple thing
version: v2
load: always
---
# Skill Documentation
`);
assert.strictEqual(fm1.name, 'my-skill');
assert.strictEqual(fm1.description, 'Does one simple thing');
assert.strictEqual(fm1.version, 'v2');
assert.strictEqual(fm1.load, 'siempre');

// Multiline folded description
const fm2 = parseSkillFrontmatter(`---
name: folded-skill
description: >-
  This is a multiline description
  that wraps across multiple lines
  in YAML format.
---
`);
assert.strictEqual(fm2.name, 'folded-skill');
assert.strictEqual(fm2.description, 'This is a multiline description that wraps across multiple lines in YAML format.');
assert.strictEqual(fm2.version, null);
assert.strictEqual(fm2.load, 'a demanda');

// Metadata.version and always_on trigger
const fm3 = parseSkillFrontmatter(`---
name: meta-skill
description: Tests nested metadata
metadata.version: 3.1.0
always_on: true
---
`);
assert.strictEqual(fm3.name, 'meta-skill');
assert.strictEqual(fm3.version, '3.1.0');
assert.strictEqual(fm3.load, 'siempre');

// Missing / damaged frontmatter
const fmEmpty = parseSkillFrontmatter('Just markdown without frontmatter');
assert.strictEqual(fmEmpty.name, null);
assert.strictEqual(fmEmpty.description, null);
assert.strictEqual(fmEmpty.version, null);
assert.strictEqual(fmEmpty.load, 'a demanda');


// ---- 2. Hermetic scanSkills with Temp Fixtures ----

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cute-agents-desk-skills-'));

function cleanup() {
  fs.rmSync(tempHome, { recursive: true, force: true });
}

try {
  const claudeDir = path.join(tempHome, '.claude', 'skills');
  const agyDir = path.join(tempHome, '.gemini', 'config', 'skills');
  const missingDir = path.join(tempHome, '.nonexistent', 'skills');

  // Valid skill with SKILL.md
  fs.mkdirSync(path.join(claudeDir, 'test-task'), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'test-task', 'SKILL.md'), `---
name: test-task
description: A disposable test skill
version: v1
---
Content
`);

  // Folder without SKILL.md (fallback test)
  fs.mkdirSync(path.join(claudeDir, 'orphan-skill'), { recursive: true });

  // Pruned folder (must be ignored)
  fs.mkdirSync(path.join(claudeDir, '_podadas', 'archived'), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, '_podadas', 'archived', 'SKILL.md'), '---\nname: archived\n---\n');

  // Hidden folder (must be ignored)
  fs.mkdirSync(path.join(claudeDir, '.hidden-folder'), { recursive: true });

  // Empty agy dir
  fs.mkdirSync(agyDir, { recursive: true });

  const testRoots = [
    { engine: 'claude cli', color: 'var(--color-lilac)', path: claudeDir },
    { engine: 'agy cli', color: 'var(--color-blue)', path: agyDir },
    { engine: 'missing cli', color: 'var(--color-mint)', path: missingDir },
  ];

  const results = scanSkills(testRoots, tempHome);

  assert.strictEqual(results.length, 3);

  // Claude results: exactly 2 skills (test-task and orphan-skill; _podadas and .hidden-folder ignored)
  const claudeGroup = results.find((r) => r.engine === 'claude cli');
  assert.ok(claudeGroup);
  assert.strictEqual(claudeGroup.installed, true);
  assert.strictEqual(claudeGroup.path, '~/.claude/skills');
  assert.strictEqual(claudeGroup.rows.length, 2);

  const testTaskRow = claudeGroup.rows.find((r) => r[0] === 'test-task');
  assert.ok(testTaskRow);
  assert.strictEqual(testTaskRow[1], 'A disposable test skill');
  assert.strictEqual(testTaskRow[2], 'v1');
  assert.strictEqual(testTaskRow[3], 'a demanda');
  assert.ok(testTaskRow[4] > 0, 'tokenEstimate should be > 0');
  assert.strictEqual(testTaskRow[5], path.join(claudeDir, 'test-task', 'SKILL.md'));
  assert.strictEqual(testTaskRow[6], path.join(claudeDir, 'test-task'));

  const orphanRow = claudeGroup.rows.find((r) => r[0] === 'orphan-skill');
  assert.ok(orphanRow);
  assert.strictEqual(orphanRow[1], '(Sin SKILL.md válido)');
  assert.strictEqual(orphanRow[4], 0);
  assert.strictEqual(orphanRow[5], null);
  assert.strictEqual(orphanRow[6], path.join(claudeDir, 'orphan-skill'));

  // Test readSkillContent
  const { readSkillContent } = require('../electron/skills.js');
  const readRes = readSkillContent(testTaskRow[5]);
  assert.ok(readRes.content.includes('A disposable test skill'));
  assert.strictEqual(readRes.error, undefined);

  const missingRes = readSkillContent(path.join(tempHome, 'non-existent.md'));
  assert.strictEqual(missingRes.content, '');
  assert.ok(missingRes.error);

  // Agy results: installed but empty
  const agyGroup = results.find((r) => r.engine === 'agy cli');
  assert.ok(agyGroup);
  assert.strictEqual(agyGroup.installed, true);
  assert.strictEqual(agyGroup.path, '~/.gemini/config/skills');
  assert.strictEqual(agyGroup.rows.length, 0);

  // Missing dir: not installed, empty rows
  const missingGroup = results.find((r) => r.engine === 'missing cli');
  assert.ok(missingGroup);
  assert.strictEqual(missingGroup.installed, false);
  assert.strictEqual(missingGroup.path, '~/.nonexistent/skills');
  assert.strictEqual(missingGroup.rows.length, 0);

  // Test sanitizePath
  assert.strictEqual(sanitizePath(path.join(tempHome, 'test', 'sub'), tempHome), '~/test/sub');
} finally {
  cleanup();
}


// ---- 3. Live System Smoke Check ----

const liveResults = scanSkills(defaultRoots());
assert.ok(Array.isArray(liveResults), 'scanSkills must return an array');
assert.ok(liveResults.length >= 2, 'must discover at least claude and agy roots');

for (const group of liveResults) {
  assert.ok(group.path.startsWith('~'), `path must be sanitized with ~: ${group.path}`);
  assert.ok(!group.path.includes(os.homedir()), `path must not leak homedir: ${group.path}`);
  for (const row of group.rows) {
    assert.notStrictEqual(row[0], '_podadas', 'must never include _podadas');
    assert.ok(!row[0].startsWith('.'), 'must never include hidden dirs');
  }
}

console.log(`skills OK: hermetic tests pass, discovered ${liveResults.map((g) => `${g.engine} (${g.rows.length} skills)`).join(', ')}`);
