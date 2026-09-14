'use strict';
// @ts-check
/**
 * Safe, bounded micro-parser for SKILL.md YAML frontmatter.
 *
 * Designed to avoid heavy external dependencies (e.g. js-yaml) while providing robust
 * extraction of standard scalar fields (name, description, version, load).
 *
 * Security & DoS containment:
 *   Reads at most 8,192 bytes from disk using fs.openSync + fs.readSync with a guaranteed
 *   try/finally descriptor close, preventing memory exhaustion when reading large files.
 */

const fs = require('node:fs');

const MAX_FRONTMATTER_BYTES = 8192;

/**
 * @param {string} text
 * @returns {{ name: string|null, description: string|null, version: string|null, load: 'siempre'|'a demanda' }}
 */
function parseSkillFrontmatter(text) {
  if (!text || typeof text !== 'string') {
    return { name: null, description: null, version: null, load: 'a demanda' };
  }

  // Strip UTF-8 Byte Order Mark if present (common in Windows/PowerShell generated files)
  const cleanText = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;

  const match = cleanText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { name: null, description: null, version: null, load: 'a demanda' };
  }

  const yamlBody = match[1];
  const lines = yamlBody.split(/\r?\n/);

  /** @type {string|null} */
  let name = null;
  /** @type {string|null} */
  let description = null;
  /** @type {string|null} */
  let version = null;
  /** @type {'siempre'|'a demanda'} */
  let load = 'a demanda';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Strip full-line comments or ignore empty lines
    if (/^\s*#/.test(line) || !line.trim()) continue;

    // name: ...
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch && !name) {
      name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
      continue;
    }

    // version: ... or metadata.version: ...
    const verMatch = line.match(/^\s*(?:metadata\.)?version:\s*(.+)$/);
    if (verMatch && !version) {
      version = verMatch[1].trim().replace(/^["']|["']$/g, '');
      continue;
    }

    // load: / trigger: / always:
    const loadMatch = line.match(/^(?:load|trigger|always|always_on):\s*(.+)$/);
    if (loadMatch) {
      const val = loadMatch[1].trim().toLowerCase();
      if (val === 'always' || val === 'siempre' || val === 'always_on' || val === 'true') {
        load = 'siempre';
      }
      continue;
    }

    // description: ... (single-line or folded/multiline)
    const descMatch = line.match(/^description:\s*(.*)$/);
    if (descMatch && !description) {
      const rawVal = descMatch[1].trim();
      if (rawVal === '>' || rawVal === '|' || rawVal === '>-' || rawVal === '|-') {
        // Collect following indented lines
        const collected = [];
        let j = i + 1;
        while (j < lines.length && (/^\s{2,}/.test(lines[j]) || !lines[j].trim())) {
          if (lines[j].trim()) collected.push(lines[j].trim());
          j++;
        }
        description = collected.join(' ');
        i = j - 1;
      } else if (rawVal) {
        description = rawVal.replace(/^["']|["']$/g, '');
      }
    }
  }

  return { name, description, version, load };
}

/**
 * Reads up to 8 KB of a file and parses its frontmatter.
 * @param {string} filePath
 * @returns {{ name: string|null, description: string|null, version: string|null, load: 'siempre'|'a demanda' }}
 */
function readSkillFrontmatter(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(MAX_FRONTMATTER_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, MAX_FRONTMATTER_BYTES, 0);
    const text = buf.toString('utf8', 0, bytesRead);
    return parseSkillFrontmatter(text);
  } catch {
    return { name: null, description: null, version: null, load: 'a demanda' };
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

module.exports = {
  MAX_FRONTMATTER_BYTES,
  parseSkillFrontmatter,
  readSkillFrontmatter,
};
