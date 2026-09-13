// @ts-check
/**
 * Lightweight static syntax highlighting for diff lines.
 *
 * Designed specifically for diff inspection:
 * - 100% Vanilla ESM, 0 external dependencies, <10 KB footprint.
 * - Strict XSS safety: all tokens are individually escaped via esc().
 * - Fast path: skips lines over 500 characters or unknown formats.
 */

import { esc } from './esc.js';

const EXT_TO_LANG = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
  ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'ts',
  py: 'py', pyw: 'py',
  json: 'json', jsonc: 'json',
  html: 'html', htm: 'html', svg: 'html',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  go: 'go',
  rs: 'rs',
  sh: 'sh', bash: 'sh', zsh: 'sh', ps1: 'sh',
  yml: 'yaml', yaml: 'yaml',
  md: 'md', markdown: 'md',
  sql: 'sql',
};

const JS_KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
  'for', 'function', 'from', 'if', 'import', 'in', 'instanceof', 'let', 'new',
  'of', 'return', 'super', 'switch', 'throw', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'yield',
]);

const JS_TYPES = new Set([
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'this',
  'boolean', 'number', 'string', 'symbol', 'object', 'any', 'void', 'never', 'unknown',
]);

const PY_KEYWORDS = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def',
  'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if',
  'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
  'return', 'try', 'while', 'with', 'yield',
]);

const PY_TYPES = new Set(['True', 'False', 'None', 'self', 'cls']);

const GO_KEYWORDS = new Set([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
  'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
  'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var',
]);

const RS_KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else',
  'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop',
  'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self',
  'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while',
]);

/**
 * Resolves the language identifier from a file path.
 * @param {string} [filePath]
 * @returns {string|null}
 */
export function detectLanguage(filePath) {
  if (!filePath) return null;
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) {
    const base = filePath.toLowerCase().split(/[/\\]/).pop() || '';
    if (base === 'dockerfile') return 'sh';
    if (base === 'makefile') return 'sh';
    return null;
  }
  const ext = filePath.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext] || null;
}

/**
 * Highlights a single line of source code for diff display.
 * @param {string} rawText The unescaped text of the line.
 * @param {string} [langOrPath] Language ID (e.g. 'js', 'py') or file path.
 * @returns {string} HTML-escaped and syntax-tokenized string.
 */
export function highlightLine(rawText, langOrPath) {
  if (!rawText) return '';
  if (rawText.length > 500) return esc(rawText);

  const lang = (langOrPath && langOrPath.includes('.')) ? detectLanguage(langOrPath) : (langOrPath || null);
  if (!lang) return esc(rawText);

  // Line-level comments
  if (lang === 'js' || lang === 'ts' || lang === 'go' || lang === 'rs') {
    const trim = rawText.trimStart();
    if (trim.startsWith('//') || trim.startsWith('/*')) {
      return `<span class="tok-com">${esc(rawText)}</span>`;
    }
  } else if (lang === 'py' || lang === 'sh' || lang === 'yaml') {
    const trim = rawText.trimStart();
    if (trim.startsWith('#')) {
      return `<span class="tok-com">${esc(rawText)}</span>`;
    }
  }

  // Tokenize line using regex match segments
  // 1: comments (//... or #...)
  // 2: strings ("...", '...', `...`)
  // 3: numbers (\b\d+(\.\d+)?\b)
  // 4: words/identifiers ([A-Za-z_$][A-Za-z0-9_$]*)
  const TOKEN_REGEX = /(\/\/[^\n]*|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b)|([a-zA-Z_$][a-zA-Z0-9_$]*)/g;

  let out = '';
  let lastIndex = 0;
  let match;

  while ((match = TOKEN_REGEX.exec(rawText)) !== null) {
    const [full, comment, str, num, ident] = match;
    const matchIndex = match.index;

    // Plain text between tokens (whitespace, operators, punctuation)
    if (matchIndex > lastIndex) {
      out += esc(rawText.slice(lastIndex, matchIndex));
    }
    lastIndex = matchIndex + full.length;

    if (comment) {
      out += `<span class="tok-com">${esc(comment)}</span>`;
      break; // Comment extends to end of line
    } else if (str) {
      out += `<span class="tok-str">${esc(str)}</span>`;
    } else if (num) {
      out += `<span class="tok-num">${esc(num)}</span>`;
    } else if (ident) {
      if (lang === 'py') {
        if (PY_KEYWORDS.has(ident)) {
          out += `<span class="tok-kw">${esc(ident)}</span>`;
        } else if (PY_TYPES.has(ident)) {
          out += `<span class="tok-type">${esc(ident)}</span>`;
        } else if (rawText[lastIndex] === '(') {
          out += `<span class="tok-fn">${esc(ident)}</span>`;
        } else {
          out += esc(ident);
        }
      } else if (lang === 'go') {
        if (GO_KEYWORDS.has(ident)) {
          out += `<span class="tok-kw">${esc(ident)}</span>`;
        } else if (rawText[lastIndex] === '(') {
          out += `<span class="tok-fn">${esc(ident)}</span>`;
        } else {
          out += esc(ident);
        }
      } else if (lang === 'rs') {
        if (RS_KEYWORDS.has(ident)) {
          out += `<span class="tok-kw">${esc(ident)}</span>`;
        } else if (rawText[lastIndex] === '(' || rawText[lastIndex] === '!') {
          out += `<span class="tok-fn">${esc(ident)}</span>`;
        } else {
          out += esc(ident);
        }
      } else {
        // Default (JS, TS, JSON, etc.)
        if (JS_KEYWORDS.has(ident)) {
          out += `<span class="tok-kw">${esc(ident)}</span>`;
        } else if (JS_TYPES.has(ident)) {
          out += `<span class="tok-type">${esc(ident)}</span>`;
        } else if (rawText[lastIndex] === '(') {
          out += `<span class="tok-fn">${esc(ident)}</span>`;
        } else {
          out += esc(ident);
        }
      }
    }
  }

  if (lastIndex < rawText.length) {
    out += esc(rawText.slice(lastIndex));
  }

  return out;
}
