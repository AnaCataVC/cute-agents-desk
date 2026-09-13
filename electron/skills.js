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

    /** @type {Array<[string, string, string, string, number, string|null, string]>} */
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
        let tokenEstimate = 0;
        try {
          const stats = fs.statSync(skillFile);
          tokenEstimate = Math.ceil(stats.size / 4);
        } catch {
          tokenEstimate = 0;
        }
        rows.push([name, desc, version, load, tokenEstimate, skillFile, skillDir]);
      } else {
        rows.push([entry.name, '(Sin SKILL.md válido)', '—', 'a demanda', 0, null, skillDir]);
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

/**
 * Safely reads a SKILL.md file content up to 64 KB.
 * @param {string} filePath
 * @returns {{ content: string, error?: string }}
 */
function readSkillContent(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { content: '', error: 'Ruta no válida' };
  }
  try {
    if (!fs.existsSync(filePath)) {
      return { content: '', error: 'Archivo no encontrado' };
    }
    const stat = fs.statSync(filePath);
    const limit = 64 * 1024;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(Math.min(stat.size, limit));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    let content = buf.toString('utf8');
    if (stat.size > limit) {
      content += '\n\n... [Contenido truncado a 64 KB]';
    }
    return { content };
  } catch (err) {
    return { content: '', error: err && err.message ? err.message : String(err) };
  }
}

/**
 * Formats discovered skills into two compact, motor-segregated lists (<30 tokens per skill).
 * Avoids cross-engine hallucinations by separating Antigravity (agy) and Claude Code (claude) skills.
 * @param {Array<{ engine: string, installed: boolean, rows: Array<[string, string, string, string, number, string|null, string]> }>} skillsScan
 * @param {number} [maxPerEngine=20]
 * @returns {string}
 */
function formatCompactCatalogByEngine(skillsScan, maxPerEngine = 20) {
  if (!Array.isArray(skillsScan) || !skillsScan.length) return '';

  /** @type {Map<string, string>} */
  const agySkills = new Map();
  /** @type {Map<string, string>} */
  const claudeSkills = new Map();

  for (const root of skillsScan) {
    if (!root || !root.installed || !Array.isArray(root.rows)) continue;
    const isAgy = (root.engine || '').toLowerCase().includes('agy');
    const targetMap = isAgy ? agySkills : claudeSkills;

    for (const [name, desc, , , , skillFile] of root.rows) {
      if (!skillFile || !name || name.startsWith('(') || targetMap.has(name)) continue;
      const cleanDesc = (desc || '(Sin descripción)')
        .replace(/\r?\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const truncatedDesc = cleanDesc.length > 90 ? cleanDesc.slice(0, 87) + '...' : cleanDesc;
      targetMap.set(name, truncatedDesc);
    }
  }

  const lines = [];
  if (agySkills.size > 0 || claudeSkills.size > 0) {
    lines.push('Skills disponibles para delegar (especifica el engine adecuado en spawn-requests):');
    if (agySkills.size > 0) {
      lines.push('Para workers Antigravity (engine: "agy"):');
      let count = 0;
      for (const [name, desc] of agySkills.entries()) {
        if (++count > maxPerEngine) {
          lines.push(`  ... y ${agySkills.size - maxPerEngine} skills mas de agy`);
          break;
        }
        lines.push(`  - ${name}: ${desc}`);
      }
    }
    if (claudeSkills.size > 0) {
      lines.push('Para workers Claude Code (engine: "claude"):');
      let count = 0;
      for (const [name, desc] of claudeSkills.entries()) {
        if (++count > maxPerEngine) {
          lines.push(`  ... y ${claudeSkills.size - maxPerEngine} skills mas de claude`);
          break;
        }
        lines.push(`  - ${name}: ${desc}`);
      }
    }
  }

  return lines.join('\n');
}

module.exports = {
  defaultRoots,
  sanitizePath,
  scanSkills,
  readSkillContent,
  formatCompactCatalogByEngine,
};

