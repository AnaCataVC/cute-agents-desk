// @ts-check
/**
 * Discovers skills installed across engines (Claude Code and Antigravity).
 *
 * Adheres strictly to the Zero-Mock principle:
 *   - Scans actual directories on disk.
 *   - Sanitizes paths to protect user PII (replaces local user home with `~`).
 *   - Depth-1 iteration without recursive descents to prevent traversal or exhaustion.
 *   - Ignores special/internal directories starting with `.` or `_` (e.g. `_podadas`, `.git`).
 *   - Degrades gracefully with `installed: false, rows: []` if an engine's directory does not exist.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readSkillFrontmatter } = require('./frontmatter.js');

/**
 * @typedef {Object} SkillRoot
 * @property {string} engine
 * @property {string} color
 * @property {string} path
 */

/**
 * Default directories where CLIs install or discover skills.
 * @param {string} [homeDir]
 * @returns {SkillRoot[]}
 */
function defaultRoots(homeDir = os.homedir()) {
  return [
    {
      engine: 'claude cli',
      color: 'var(--color-lilac)',
      path: path.join(homeDir, '.claude', 'skills'),
    },
    {
      engine: 'agy cli',
      color: 'var(--color-blue)',
      path: path.join(homeDir, '.gemini', 'config', 'skills'),
    },
    {
      engine: 'agy cli (builtin)',
      color: 'var(--color-blue)',
      path: path.join(homeDir, '.gemini', 'antigravity-cli', 'builtin', 'skills'),
    },
  ];
}

/**
 * Replaces user home with `~` and standardizes separators for UI/captures.
 * @param {string} rawPath
 * @param {string} [homeDir]
 * @returns {string}
 */
function sanitizePath(rawPath, homeDir = os.homedir()) {
  if (!rawPath) return '';
  const normTarget = path.normalize(rawPath);
  const normHome = path.normalize(homeDir);

  let sanitized = normTarget;
  if (normTarget.toLowerCase().startsWith(normHome.toLowerCase())) {
    sanitized = '~' + normTarget.slice(normHome.length);
  }
  return sanitized.replace(/\\/g, '/');
}

/**
 * Finds a SKILL.md file inside a directory, case-insensitively.
 * @param {string} dir
 * @returns {string|null}
 */
function findSkillFile(dir) {
  const directPath = path.join(dir, 'SKILL.md');
  if (fs.existsSync(directPath)) return directPath;
  try {
    const files = fs.readdirSync(dir);
    const found = files.find((f) => f.toLowerCase() === 'skill.md');
    return found ? path.join(dir, found) : null;
  } catch {
    return null;
  }
}

/**
 * Scans skill roots and extracts metadata for every discovered skill.
 * @param {SkillRoot[]} [roots]
 * @param {string} [homeDir]
 * @returns {Array<{ engine: string, color: string, path: string, installed: boolean, rows: Array<[string, string, string, string]> }>}
 */
function scanSkills(roots = defaultRoots(), homeDir = os.homedir()) {
  const result = [];

  for (const root of roots) {
    const displayPath = sanitizePath(root.path, homeDir);

    if (!fs.existsSync(root.path)) {
      result.push({
        engine: root.engine,
        color: root.color,
        path: displayPath,
        installed: false,
        rows: [],
      });
      continue;
    }

    let entries;
    try {
      entries = fs.readdirSync(root.path, { withFileTypes: true });
    } catch {
      result.push({
        engine: root.engine,
        color: root.color,
        path: displayPath,
        installed: false,
        rows: [],
      });
      continue;
    }

    /** @type {Array<[string, string, string, string]>} */
    const rows = [];

    for (const entry of entries) {
      // Exclude hidden or pruned folders early (e.g. `_podadas`, `.git`, `.agents`)
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

      const skillDir = path.join(root.path, entry.name);
      let isDir = entry.isDirectory();
      if (!isDir && typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
        try { isDir = fs.statSync(skillDir).isDirectory(); } catch { isDir = false; }
      }
      if (!isDir) continue;
      const skillFile = findSkillFile(skillDir);

      if (skillFile) {
        const fm = readSkillFrontmatter(skillFile);
        const name = fm.name || entry.name;
        const desc = fm.description || '(Sin descripción)';
        const version = fm.version || '—';
        const load = fm.load || 'a demanda';
        rows.push([name, desc, version, load]);
      } else {
        rows.push([entry.name, '(Sin SKILL.md válido)', '—', 'a demanda']);
      }
    }

    // Sort alphabetically by skill name
    rows.sort((a, b) => a[0].localeCompare(b[0]));

    result.push({
      engine: root.engine,
      color: root.color,
      path: displayPath,
      installed: true,
      rows,
    });
  }

  return result;
}

module.exports = {
  defaultRoots,
  sanitizePath,
  scanSkills,
};
