// @ts-check
/**
 * Static scan of ui/*.js for `${...}` template interpolations that are not HTML-escaped.
 *
 * This is a heuristic lint, not a type checker. It finds every template literal (nesting-aware),
 * decides which ones are HTML templates, and proves each of their substitutions safe or flags it.
 *
 * Which templates are checked: those whose static text contains markup (`<`, `>` or an attribute
 * opener `="`). Plain-text templates (toast messages, CSS values, ids, `${a}${b}` compositions)
 * are not reported themselves, but they are never trusted blindly either: a value built from one
 * is safe only if all of its substitutions are.
 *
 * An expression is safe when, recursively:
 *   - it is a literal, a call to `esc(...)` / `highlightLine(...)` / a numeric formatter, or a call
 *     to a function declared or imported in the same file (a render helper whose own templates are
 *     checked in the same pass);
 *   - it is a checked HTML template (its substitutions are reported on their own), or a plain-text
 *     template whose substitutions are all safe;
 *   - it can only produce a number or boolean: comparison, arithmetic, `!`, `typeof`, a numeric
 *     global (`Number`, `Math.*`), or a method like `.toFixed()` / `.includes()`;
 *   - it composes safe parts: `c ? a : b` (both branches), `a || b` / `a ?? b` (all operands),
 *     `a && b` (the last operand -- a falsy left side renders as '', 0, false or nothing), `a + b`,
 *     array/object literals, `.map(fn)` with a safe `fn`, `.join()` / `.slice()` / `.padStart()` on
 *     a safe receiver, and property access on a safe value;
 *   - it is a local variable whose every assignment in the file (`=`, `+=`, `.push(...)`, element
 *     or property writes) is itself safe -- or a name imported from another ui file where the same
 *     holds. A name bound as a function/arrow parameter, destructured, or a `for...of` variable is
 *     never trusted this way, because its value comes from the caller;
 *   - it is a name whose every JSDoc declaration in the file is `{number}` or `{boolean}`;
 *   - its leaf name is a known numeric/count field (`GLOBAL_SAFE_LEAF_NAMES`, `*Count`) or follows
 *     the `*Html` trusted-fragment naming convention;
 *   - or it matches an explicit, reasoned `ALLOWLIST` entry.
 *
 * Known limitations (a full JS parser would not have these, a regex-based one does):
 *   - Variables are tracked per file by name, not per scope: two functions declaring the same
 *     name must both assign it safely for either use to be trusted (conservative, never lenient).
 *   - Regex literals are not specially parsed; one containing an unescaped quote or backtick would
 *     confuse the tokenizer. None exist today.
 *   - A plain-text template returned from a render helper and assigned straight to innerHTML would
 *     not be reported; string building here always goes through markup templates.
 *
 * Run with: node tools/verify-ui-escaping.js
 */

const fs = require('node:fs');
const path = require('node:path');

const UI_DIR = path.join(__dirname, '..', 'ui');

/** Functions whose entire return value is already escaped or numeric -- delegating to them is safe. */
const KNOWN_SAFE_CALLABLES = new Set([
  'esc', 'highlightLine', 'shortTokens', 'fmtTokens', 'fmtCost',
]);

/** Global functions and namespaces whose results are always numbers or booleans. */
const NUMERIC_GLOBAL_CALLS = new Set(['Number', 'parseInt', 'parseFloat', 'Boolean', 'isNaN', 'isFinite']);
const NUMERIC_NAMESPACES = new Set(['Math', 'Number']);

/** Methods whose result is a number, boolean, or formatted number/date whatever the receiver holds. */
const SAFE_RESULT_METHODS = new Set([
  'toFixed', 'toPrecision', 'toLocaleTimeString', 'toLocaleDateString', 'getTime', 'getHours',
  'getMinutes', 'getDay', 'getDate', 'indexOf', 'lastIndexOf', 'includes', 'startsWith', 'endsWith',
  'some', 'every', 'has', 'test', 'findIndex',
]);

/** Methods returning only material from the receiver (plus their arguments, if listed below). */
const RECEIVER_DERIVED_METHODS = new Set([
  'join', 'slice', 'substring', 'trim', 'trimStart', 'trimEnd', 'padStart', 'padEnd', 'toUpperCase',
  'toLowerCase', 'toString', 'filter', 'concat', 'repeat', 'reverse', 'sort', 'flat', 'at', 'find',
]);
const ARG_CARRYING_METHODS = new Set(['join', 'padStart', 'padEnd', 'concat']);

/**
 * Leaf identifier/property names that are always numeric or count-like in this codebase, so the
 * rendered text can never be arbitrary -- worst case a malformed number, never markup.
 */
const GLOBAL_SAFE_LEAF_NAMES = new Set([
  'length', 'lno', 'rno', 'tick', 'i', 'idx', 'index',
  'repos', 'accounts', 'coordinators', 'running', 'maxParallel', 'blocked', 'queued',
  'tokens', 'tokenCap', 'ctxPct', 'costUsd', 'messages', 'defined', 'add', 'del',
  'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy',
  'pct', 'safePct', 'dim', 'opacity', 'min', 'max', 'day', 'h',
]);

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'with', 'return', 'typeof', 'new', 'await', 'function', 'const',
  'let', 'var', 'else', 'case', 'catch', 'do', 'in', 'of', 'this', 'true', 'false', 'null',
  'undefined', 'void', 'delete', 'instanceof', 'async', 'export', 'import', 'default', 'throw',
]);

/**
 * Explicit, reasoned exceptions. `file` scopes an entry to one ui/*.js basename (omit for any
 * file); `match` is an exact sanitized-expression string (string contents emptied, nested
 * templates collapsed to ``) or a RegExp tested against it.
 * @type {{ file?: string, match: string | RegExp, reason: string }[]}
 */
const ALLOWLIST = [
  // data.STATES / data.AUTHORS / data.SKILL_STATES are literal tables of fixed labels and CSS var
  // tokens in data.js, but they reach these renderers through a `data` parameter the per-file
  // analysis cannot follow back across files.
  { file: 'agent-card.js', match: 'st.color', reason: 'STATES entry (fixed CSS var token) passed in as data.STATES' },
  { file: 'boss-graph.js', match: /^st\.(color|label)$/, reason: 'STATES entry (fixed label / CSS var token) passed in as data.STATES' },
  { file: 'chat.js', match: /^st\.(color|label)$|^st\.bg \|\| ''$/, reason: 'STATES entry (fixed label / CSS var token) passed in as data.STATES' },
  { file: 'chat.js', match: /^a\.(align|color|bg)$/, reason: 'AUTHORS entry (fixed CSS values) passed in as data.AUTHORS' },
  { file: 'chat.js', match: /^s\.(bg|color)$/, reason: 'SKILL_STATES entry (fixed CSS var tokens) passed in as data.SKILL_STATES' },

  { file: 'app.js', match: 'act', reason: 'querySelector attribute selector, not markup; the value is read back from an existing data-act attribute' },
  { file: 'boss-graph.js', match: 'state.showArch', reason: 'boolean UI toggle, only ever set by `!state.showArch` in app.js' },
  { file: 'repo-tree.js', match: 'state.filtersOpen', reason: 'boolean UI toggle, only ever set by `!state.filtersOpen` in app.js' },
  { file: 'config.js', match: 'value', reason: "settingsRow's data-on attribute, rendered only inside its `typeof value === 'boolean'` branch" },
  { file: 'dialogs.js', match: "cfg.step ?? ''", reason: 'CONFIG_META numeric step with a literal fallback, never user input' },
];

// ---------------------------------------------------------------------------------------------
// Tokenizing helpers (strings, templates, comments, balanced brackets).
// ---------------------------------------------------------------------------------------------

/** @param {string} src @param {number} i */
function skipQuoted(src, i) {
  const quote = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === quote) return i + 1;
    i++;
  }
  return i;
}

/** @param {string} src @param {number} i index of the opening backtick */
function skipTemplate(src, i) {
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i + 1;
    if (c === '$' && src[i + 1] === '{') { i = skipBracketed(src, i + 1); continue; }
    i++;
  }
  return i;
}

/**
 * If src[i] starts a string, template, or comment, returns the index just past it; otherwise i.
 * @param {string} src @param {number} i
 */
function skipNonCode(src, i) {
  const c = src[i];
  if (c === '"' || c === "'") return skipQuoted(src, i);
  if (c === '`') return skipTemplate(src, i);
  if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); return e === -1 ? src.length : e; }
  if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); return e === -1 ? src.length : e + 2; }
  return i;
}

/**
 * src[i] is an opening bracket; returns the index just past its matching closer.
 * @param {string} src @param {number} i
 */
function skipBracketed(src, i) {
  let depth = 0;
  while (i < src.length) {
    const next = skipNonCode(src, i);
    if (next !== i) { i = next; continue; }
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  return i;
}

/**
 * Calls visit(i) for each index of expr at bracket depth 0, outside strings/templates/comments.
 * Stops early when visit returns true.
 * @param {string} expr @param {(i: number) => boolean | void} visit
 */
function forEachTopLevel(expr, visit) {
  let depth = 0;
  let i = 0;
  while (i < expr.length) {
    const next = skipNonCode(expr, i);
    if (next !== i) { i = next; continue; }
    const c = expr[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && visit(i)) return;
    i++;
  }
}

/**
 * Splits expr at top-level positions accepted by `at` (which returns the separator length or 0).
 * @param {string} expr @param {(i: number) => number} at
 */
function splitTopLevel(expr, at) {
  const parts = [];
  let from = 0;
  let skipUntil = -1;
  forEachTopLevel(expr, (i) => {
    if (i < skipUntil) return;
    const len = at(i);
    if (len) { parts.push(expr.slice(from, i)); from = i + len; skipUntil = from; }
  });
  parts.push(expr.slice(from));
  return parts;
}

/** Previous non-whitespace character before index i. @param {string} s @param {number} i */
function prevChar(s, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(s[k])) k--;
  return k >= 0 ? s[k] : '';
}

/** True when an operator at i has an operand on its left, i.e. it is binary, not unary. */
function isBinaryAt(/** @type {string} */ s, /** @type {number} */ i) {
  return /[\w$)\]'"`]/.test(prevChar(s, i));
}

/**
 * Parses the template literal starting at src[start], recording it (and every template nested
 * in its substitutions) into `out`. Returns the index just past the closing backtick.
 * @typedef {{ start: number, end: number, statics: string, subs: { raw: string, index: number }[] }} Template
 * @param {string} src @param {number} start @param {Template[]} out
 */
function parseTemplate(src, start, out) {
  /** @type {Template} */
  const tpl = { start, end: start, statics: '', subs: [] };
  out.push(tpl);
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { tpl.statics += src.slice(i, i + 2); i += 2; continue; }
    if (c === '`') { i++; break; }
    if (c === '$' && src[i + 1] === '{') {
      const close = skipBracketed(src, i + 1);
      tpl.subs.push({ raw: src.slice(i + 2, close - 1), index: i });
      scanForTemplates(src, i + 2, close - 1, out);
      i = close;
      continue;
    }
    tpl.statics += c;
    i++;
  }
  tpl.end = i;
  return i;
}

/** @param {string} src @param {number} from @param {number} to @param {Template[]} out */
function scanForTemplates(src, from, to, out) {
  let i = from;
  while (i < to) {
    if (src[i] === '`') { i = parseTemplate(src, i, out); continue; }
    const next = skipNonCode(src, i);
    i = next !== i ? next : i + 1;
  }
}

/** A template is HTML (and so reported) when its static text holds markup. */
function isHtmlTemplate(/** @type {Template} */ tpl) {
  return /[<>]|="/.test(tpl.statics);
}

/**
 * Same-length copy of src with string contents, comments and template static text blanked, so
 * binding regexes only ever match real code (template substitutions stay visible).
 * @param {string} src
 */
function maskNonCode(src) {
  const out = src.split('');
  const blank = (/** @type {number} */ a, /** @type {number} */ b) => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  const walk = (/** @type {number} */ from, /** @type {number} */ to) => {
    let i = from;
    while (i < to) {
      const c = src[i];
      if (c === '`') {
        let j = i + 1;
        while (j < to) {
          if (src[j] === '\\') { blank(j, j + 2); j += 2; continue; }
          if (src[j] === '`') { j++; break; }
          if (src[j] === '$' && src[j + 1] === '{') {
            const close = skipBracketed(src, j + 1);
            walk(j + 2, close - 1);
            j = close;
            continue;
          }
          blank(j, j + 1);
          j++;
        }
        i = j;
        continue;
      }
      const next = skipNonCode(src, i);
      if (next !== i) {
        if (c === '/') blank(i, next); else blank(i + 1, next - 1);
        i = next;
        continue;
      }
      i++;
    }
  };
  walk(0, src.length);
  return out.join('');
}

/** Index where the expression starting at src[i] ends (statement boundary or enclosing closer). */
function readExpressionEnd(/** @type {string} */ src, /** @type {number} */ i) {
  let depth = 0;
  let lastSignificant = '=';
  while (i < src.length) {
    const next = skipNonCode(src, i);
    if (next !== i) {
      if (src[i] !== '/') lastSignificant = 'x';
      i = next;
      continue;
    }
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return i; depth--; }
    else if (depth === 0 && (c === ';' || c === ',')) return i;
    else if (depth === 0 && c === '\n') {
      const rest = /^\s*(\S)(\S?)/.exec(src.slice(i, i + 200));
      const nextStartsOperator = rest && /[?:.+\-*/%|&<>]/.test(rest[1])
        && !(rest[1] === '/' && (rest[2] === '/' || rest[2] === '*'));
      if (!/[=+\-*/%?:|&<>(,.]/.test(lastSignificant) && !nextStartsOperator) return i;
    }
    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }
  return i;
}

/** Collapses string contents and nested templates, for allowlist matching and reporting. */
function sanitize(/** @type {string} */ expr) {
  let outText = '';
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    const next = skipNonCode(expr, i);
    if (next !== i) {
      if (c === '"' || c === "'") outText += c + c;
      else if (c === '`') outText += '``';
      i = next;
      continue;
    }
    outText += c;
    i++;
  }
  return outText.trim();
}

// ---------------------------------------------------------------------------------------------
// Classifier.
// ---------------------------------------------------------------------------------------------

/**
 * `pos` is the source index names are resolved from; `shadowed` holds the parameters of an
 * arrow being classified inline, which never resolve to an outer binding.
 * `isSafeNamespaceMember` answers for `ns.NAME` when `ns` is an `import * as ns` of a ui file
 * (null when it is not such a namespace).
 * @typedef {{ file: string, content: string, pos: number, shadowed: Set<string>, callables: Set<string>,
 *             isSafeName: (name: string) => boolean,
 *             isSafeNamespaceMember: (ns: string, name: string) => boolean | null,
 *             allowUsed: Set<object> }} Ctx
 */

/** @param {string} expr @param {Ctx} ctx @param {number} [depth] @returns {boolean} */
function classify(expr, ctx, depth = 0) {
  if (depth > 60) return false;
  const next = (/** @type {string} */ e) => classify(e, ctx, depth + 1);
  // Comments stay in: every scan below skips them, and keeping the text verbatim lets an arrow
  // body be located in the file.
  let e = expr.trim();
  while (e.startsWith('//') || e.startsWith('/*')) e = e.slice(skipNonCode(e, 0)).trim();
  while (e.startsWith('(') && skipBracketed(e, 0) === e.length) e = e.slice(1, -1).trim();
  if (!e) return true;

  const sanitized = sanitize(e);
  for (const entry of ALLOWLIST) {
    if (entry.file && entry.file !== ctx.file) continue;
    const isMatch = typeof entry.match === 'string' ? entry.match === sanitized : entry.match.test(sanitized);
    if (isMatch) { ctx.allowUsed.add(entry); return true; }
  }

  // Arrow function (only meaningful as a `.map(...)` callback): safe when its expression body is.
  let arrowAt = -1;
  forEachTopLevel(e, (i) => { if (e[i] === '=' && e[i + 1] === '>') { arrowAt = i; return true; } });
  if (arrowAt !== -1) {
    const body = e.slice(arrowAt + 2).trim();
    // Located in the file, the body resolves its names from inside the arrow's own scope (so its
    // parameters and locals get their real bindings); otherwise its parameters are just unknown.
    const bodyAt = ctx.content.indexOf(body, ctx.pos);
    if (bodyAt !== -1) {
      if (!body.startsWith('{')) return classify(body, { ...ctx, pos: bodyAt }, depth + 1);
      return returnExpressions(body, bodyAt).every(({ text, pos }) => classify(text, { ...ctx, pos }, depth + 1));
    }
    const shadowed = new Set([...ctx.shadowed, ...identifiersIn(e.slice(0, arrowAt))]);
    return !body.startsWith('{') && classify(body, { ...ctx, shadowed }, depth + 1);
  }

  const ternary = splitTernary(e);
  if (ternary) return next(ternary.a) && next(ternary.b);

  const orParts = splitTopLevel(e, (i) => (
    (e.startsWith('||', i) || e.startsWith('??', i)) && e[i + 2] !== '=' ? 2 : 0));
  if (orParts.length > 1) return orParts.every(next);

  const andParts = splitTopLevel(e, (i) => (e.startsWith('&&', i) ? 2 : 0));
  if (andParts.length > 1) return next(andParts[andParts.length - 1]);

  let isComparison = false;
  forEachTopLevel(e, (i) => {
    const c = e[i];
    if ((c === '<' || c === '>') && e[i - 1] !== '=') isComparison = true;
    else if ((c === '=' || c === '!') && e[i + 1] === '=') isComparison = true;
    else if (/\b(instanceof|in)\s/.test(e.slice(i, i + 11)) && !/[\w$]/.test(e[i - 1] || '')) isComparison = true;
    return isComparison;
  });
  if (isComparison) return true;

  const plusParts = splitTopLevel(e, (i) => (
    e[i] === '+' && e[i + 1] !== '+' && e[i + 1] !== '=' && e[i - 1] !== '+' && isBinaryAt(e, i) ? 1 : 0));
  if (plusParts.length > 1) return plusParts.every(next);

  let isArithmetic = false;
  forEachTopLevel(e, (i) => {
    if (/[-*/%]/.test(e[i]) && e[i + 1] !== '=' && isBinaryAt(e, i)) isArithmetic = true;
    return isArithmetic;
  });
  if (isArithmetic) return true;

  if (/^(!|-|\+|typeof\s|void\s)/.test(e)) return true;
  if (/^await\s/.test(e)) return next(e.slice(5));
  if (/^new\s+Date\s*\(/.test(e)) return true;

  return classifyChain(e, ctx, depth);
}

/**
 * Every `return` expression in a block body (nested functions included, which only ever makes the
 * verdict stricter), with its absolute source position.
 * @param {string} block @param {number} base absolute index of block[0]
 */
function returnExpressions(block, base) {
  const masked = maskNonCode(block);
  return [...masked.matchAll(/\breturn\b/g)].map((m) => {
    const from = m.index + 'return'.length;
    return { text: block.slice(from, readExpressionEnd(block, from)), pos: base + from };
  });
}

/** Splits `cond ? a : b` at its top-level `?` and matching `:` (nested ternaries supported). */
function splitTernary(/** @type {string} */ expr) {
  let qAt = -1;
  forEachTopLevel(expr, (i) => {
    if (expr[i] === '?' && expr[i + 1] !== '.' && expr[i + 1] !== '?' && expr[i - 1] !== '?') { qAt = i; return true; }
  });
  if (qAt === -1) return null;
  const rest = expr.slice(qAt + 1);
  let pending = 0;
  let colonAt = -1;
  forEachTopLevel(rest, (i) => {
    const c = rest[i];
    if (c === '?' && rest[i + 1] !== '.' && rest[i + 1] !== '?' && rest[i - 1] !== '?') pending++;
    else if (c === ':') { if (pending === 0) { colonAt = i; return true; } pending--; }
  });
  if (colonAt === -1) return null;
  return { a: rest.slice(0, colonAt), b: rest.slice(colonAt + 1) };
}

/** @param {string} tplText @param {Ctx} ctx @param {number} depth */
function isSafeTemplate(tplText, ctx, depth) {
  /** @type {Template[]} */
  const parsed = [];
  parseTemplate(tplText, 0, parsed);
  const tpl = parsed[0];
  if (isHtmlTemplate(tpl)) return true; // reported on its own in the main pass
  return tpl.subs.every((s) => classify(s.raw, ctx, depth + 1));
}

/** Splits the inside of a bracket pair on top-level commas, dropping empty trailing parts. */
function listItems(/** @type {string} */ inner) {
  return splitTopLevel(inner, (i) => (inner[i] === ',' ? 1 : 0))
    .map((p) => p.trim().replace(/^\.\.\./, ''))
    .filter(Boolean);
}

/** A `.map(...)` callback is safe when it's a known render helper or an arrow with a safe body. */
function isSafeCallback(/** @type {string} */ arg, /** @type {Ctx} */ ctx, /** @type {number} */ depth) {
  const t = arg.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(t)) return ctx.callables.has(t);
  return classify(t, ctx, depth + 1);
}

/** @param {string} name */
function isSafeLeafName(name) {
  return GLOBAL_SAFE_LEAF_NAMES.has(name) || /Html$/.test(name) || /Count$/i.test(name);
}

/**
 * Classifies a primary expression followed by `.prop`, `?.prop`, `[i]` and call segments.
 * @param {string} e @param {Ctx} ctx @param {number} depth
 */
function classifyChain(e, ctx, depth) {
  const next = (/** @type {string} */ x) => classify(x, ctx, depth + 1);
  let i = 0;
  let safe = false;
  let isNamespace = false;
  /** @type {string | null} */
  let lastName = null;
  let hasProperty = false;
  const c0 = e[0];

  if (c0 === '(' || c0 === '[' || c0 === '{') {
    const end = skipBracketed(e, 0);
    const inner = e.slice(1, end - 1);
    if (c0 === '(') safe = next(inner);
    else if (c0 === '[') safe = listItems(inner).every(next);
    else {
      safe = listItems(inner).every((item) => {
        let colonAt = -1;
        forEachTopLevel(item, (k) => { if (item[k] === ':') { colonAt = k; return true; } });
        return next(colonAt === -1 ? item : item.slice(colonAt + 1));
      });
    }
    i = end;
  } else if (c0 === '"' || c0 === "'") {
    i = skipQuoted(e, 0);
    safe = true;
  } else if (c0 === '`') {
    i = skipTemplate(e, 0);
    safe = isSafeTemplate(e.slice(0, i), ctx, depth);
  } else if (/\d/.test(c0)) {
    const m = /^\d[\d._]*(e[+-]?\d+)?/i.exec(e);
    i = m ? m[0].length : 1;
    safe = true;
  } else {
    const m = /^[A-Za-z_$][\w$]*/.exec(e);
    if (!m) return false;
    const name = m[0];
    i = name.length;
    lastName = name;
    const afterWs = e.slice(i).match(/^\s*/)[0].length;
    if (e[i + afterWs] === '(') {
      const end = skipBracketed(e, i + afterWs);
      const args = listItems(e.slice(i + afterWs + 1, end - 1));
      if (ctx.callables.has(name) || NUMERIC_GLOBAL_CALLS.has(name)) safe = true;
      else if (name === 'String') safe = args.every(next);
      i = end;
    } else if (NUMERIC_NAMESPACES.has(name)) {
      safe = true;
      isNamespace = true;
    } else if (ctx.isSafeNamespaceMember(name, '') !== null && /^\s*\.\s*[A-Za-z_$][\w$]*(?!\s*[\w$(])/.test(e.slice(i))) {
      // `ns.EXPORT` of a namespace-imported ui file: as safe as that file's own binding.
      const member = /^\s*\.\s*([A-Za-z_$][\w$]*)/.exec(e.slice(i));
      i += member[0].length;
      lastName = member[1];
      hasProperty = true;
      safe = ctx.isSafeNamespaceMember(name, member[1]) === true;
    } else {
      // A local/imported function used as a value (e.g. a view table) is only ever safe to call.
      safe = /^(true|false|null|undefined|NaN|Infinity)$/.test(name) || ctx.isSafeName(name)
        || (!ctx.shadowed.has(name) && ctx.callables.has(name));
    }
  }

  while (i < e.length) {
    while (/\s/.test(e[i])) i++;
    if (i >= e.length) break;
    let optional = false;
    if (e.startsWith('?.', i)) { optional = true; i += 2; }
    if (e[i] === '[') {
      i = skipBracketed(e, i);
      lastName = null;
      continue;
    }
    if (e[i] === '(') {
      // Calling a computed value: safe only when that value is itself a safe function (a render
      // helper, or an arrow whose body was proven safe); a call never makes an unsafe value safe.
      i = skipBracketed(e, i);
      lastName = null;
      continue;
    }
    if (e[i] === '.' || optional) {
      if (e[i] === '.') i++;
      const m = /^\s*([A-Za-z_$][\w$]*)/.exec(e.slice(i));
      if (!m) return false;
      const prop = m[1];
      i += m[0].length;
      lastName = prop;
      hasProperty = true;
      const afterWs = e.slice(i).match(/^\s*/)[0].length;
      if (e[i + afterWs] === '(') {
        const end = skipBracketed(e, i + afterWs);
        const args = listItems(e.slice(i + afterWs + 1, end - 1));
        i = end;
        if (isNamespace || SAFE_RESULT_METHODS.has(prop)) safe = true;
        else if (prop === 'map' || prop === 'flatMap') safe = args.length > 0 && isSafeCallback(args[0], ctx, depth);
        else if (RECEIVER_DERIVED_METHODS.has(prop)) safe = safe && (!ARG_CARRYING_METHODS.has(prop) || args.every(next));
        else safe = false;
        isNamespace = false;
      }
      continue;
    }
    return false; // trailing syntax this heuristic does not model
  }

  // The naming convention only speaks for properties (`s.accounts`, `u.rowsHtml`); a bare local
  // name is judged by what is assigned to it instead.
  return safe || (hasProperty && lastName !== null && isSafeLeafName(lastName));
}

// ---------------------------------------------------------------------------------------------
// Per-file binding analysis.
// ---------------------------------------------------------------------------------------------

/** @param {string} text */
function identifiersIn(text) {
  return (text.match(/[A-Za-z_$][\w$]*/g) || []).filter((n) => !KEYWORDS.has(n));
}

/**
 * @typedef {{ start: number, end: number }} Scope
 * @typedef {{ name: string, scope: Scope, external: boolean, rhs: { text: string, pos: number }[] }} Binding
 */

/**
 * Declares a function's parameters. For a named, non-exported function that the file only ever
 * calls directly (never passes around as a value), each parameter is bound to the arguments of
 * its call sites -- positional, or by property for a destructured `{ a, b }` object parameter --
 * plus its default value, so a render helper that receives pre-built HTML is proven safe at
 * every caller instead of trusted blindly. Anything else is external.
 * @param {{ name: string | undefined, scope: Scope, params: string }} fn
 * @param {Scope} declScope the scope the function's name is declared in; calls are looked up there
 * @param {string} src @param {string} masked
 * @param {(name: string, scope: Scope, external: boolean) => Binding | null} declare
 */
function declareParams(fn, declScope, src, masked, declare) {
  const calls = fn.name ? directCallArgs(fn.name, declScope, src, masked) : null;
  const items = splitTopLevel(fn.params, (i) => (fn.params[i] === ',' ? 1 : 0)).map((p) => p.trim()).filter(Boolean);
  items.forEach((item, position) => {
    const [pattern, defaultValue] = splitDefault(item);
    const bindParam = (/** @type {string} */ name, /** @type {(args: string[]) => string | null | undefined} */ pick) => {
      const b = declare(name, fn.scope, !calls);
      if (!b || !calls) return;
      if (defaultValue !== undefined) b.rhs.push({ text: defaultValue, pos: fn.scope.start });
      for (const call of calls) {
        const value = pick(call.args);
        if (value === null) { b.external = true; return; }
        if (value !== undefined) b.rhs.push({ text: value, pos: call.pos });
      }
    };
    if (/^[A-Za-z_$][\w$]*$/.test(pattern)) {
      bindParam(pattern, (args) => args[position]);
    } else if (pattern.startsWith('{')) {
      for (const prop of listItems(pattern.slice(1, -1))) {
        const [target, propDefault] = splitDefault(prop);
        const [key, alias] = target.split(':').map((t) => t.trim());
        bindParam(alias || key, (args) => {
          const arg = args[position];
          if (arg === undefined) return propDefault;
          if (!arg.startsWith('{')) return null;
          const found = listItems(arg.slice(1, -1)).find((p) => p.split(':')[0].trim() === key);
          if (!found) return propDefault;
          return found.includes(':') ? found.slice(found.indexOf(':') + 1) : found;
        });
      }
    } else {
      for (const name of identifiersIn(pattern)) declare(name, fn.scope, true);
    }
  });
}

/** Splits `name = default` at its top-level `=`; the default is undefined when absent. */
function splitDefault(/** @type {string} */ item) {
  let eqAt = -1;
  forEachTopLevel(item, (i) => {
    if (item[i] === '=' && item[i + 1] !== '=' && item[i + 1] !== '>' && !/[=!<>]/.test(item[i - 1] || '')) { eqAt = i; return true; }
  });
  return eqAt === -1 ? [item.trim(), undefined] : [item.slice(0, eqAt).trim(), item.slice(eqAt + 1).trim()];
}

/**
 * Argument lists of every direct `name(...)` call in the file, or null when the function escapes
 * direct-call analysis: exported, referenced as a value, or called with a spread argument.
 * @param {string} name @param {Scope} range @param {string} src @param {string} masked
 */
function directCallArgs(name, range, src, masked) {
  if (new RegExp(`\\bexport\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\b`).test(masked)) return null;
  const calls = [];
  for (const m of masked.matchAll(new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g'))) {
    if (m.index < range.start || m.index >= range.end) continue;
    const before = masked.slice(Math.max(0, m.index - 12), m.index);
    if (/\b(?:function\s*\*?|const|let|var)\s+$/.test(before)) continue;
    const ws = masked.slice(m.index + name.length).match(/^\s*/)[0].length;
    const open = m.index + name.length + ws;
    if (masked[open] !== '(') return null;
    const inner = src.slice(open + 1, skipBracketed(src, open) - 1);
    const args = splitTopLevel(inner, (i) => (inner[i] === ',' ? 1 : 0)).map((a) => a.trim());
    if (args.length && args[args.length - 1] === '') args.pop();
    if (args.some((a) => a.startsWith('...'))) return null;
    calls.push({ args, pos: m.index });
  }
  return calls.length ? calls : null;
}

/**
 * When the arrow starting at `open` is the callback of `recv.map(` / `.forEach(` / `.filter(` /
 * ..., returns `[recv]` (the receiver's source text: an identifier chain, possibly with calls,
 * indexes or a parenthesized head); otherwise null.
 * @param {string} src @param {string} masked @param {number} open
 */
function iterationReceiver(src, masked, open) {
  const head = masked.slice(Math.max(0, open - 60), open);
  const method = /\.\s*(?:map|flatMap|forEach|filter|find|some|every)\s*\(\s*$/.exec(head);
  if (!method) return null;
  const end = open - (head.length - method.index);
  let k = end - 1;
  while (k >= 0) {
    while (k >= 0 && /\s/.test(masked[k])) k--;
    const c = masked[k];
    if (c === ')' || c === ']') {
      const opener = c === ')' ? '(' : '[';
      let depth = 0;
      for (; k >= 0; k--) {
        if (masked[k] === c) depth++;
        else if (masked[k] === opener && --depth === 0) break;
      }
      k--;
      continue;
    }
    if (/[\w$]/.test(c || '')) {
      while (k >= 0 && /[\w$]/.test(masked[k])) k--;
      if (masked[k] === '.') { k--; if (masked[k] === '?') k--; continue; }
      break;
    }
    break;
  }
  const receiver = src.slice(k + 1, end).trim();
  return receiver && !KEYWORDS.has(receiver) ? [null, receiver] : null;
}

/** Innermost scope containing index. @param {Scope[]} scopes @param {number} index */
function innermostScope(scopes, index) {
  let best = scopes[0];
  for (const s of scopes) {
    if (s.start <= index && index < s.end && s.end - s.start < best.end - best.start) best = s;
  }
  return best;
}

/**
 * Builds function scopes and the bindings declared in each: `const/let/var` locals (with the
 * right-hand sides later written to them) and externally bound names (parameters, destructuring,
 * loop variables). A callback parameter of `recv.map(...)` / `.forEach` / `.filter` / ... is not
 * external: it is derived from `recv`, so it is exactly as safe as the receiver.
 * @param {string} src @param {string} masked
 */
function collectBindings(src, masked) {
  /** @type {Scope[]} */
  const scopes = [{ start: 0, end: src.length + 1 }];
  /** @type {Binding[]} */
  const bindings = [];
  const declare = (/** @type {string} */ name, /** @type {Scope} */ scope, /** @type {boolean} */ external) => {
    if (KEYWORDS.has(name)) return null;
    let b = bindings.find((x) => x.name === name && x.scope === scope);
    if (!b) { b = { name, scope, external, rhs: [] }; bindings.push(b); }
    b.external = b.external || external;
    return b;
  };
  const declareAll = (/** @type {string} */ text, /** @type {Scope} */ scope, /** @type {boolean} */ external) => (
    identifiersIn(text).map((n) => declare(n, scope, external)).filter((b) => b !== null));

  const bodyEnd = (/** @type {number} */ from) => {
    let k = from;
    while (/\s/.test(src[k] || '')) k++;
    return src[k] === '{' ? skipBracketed(src, k) : readExpressionEnd(src, k);
  };

  /** @type {{ name: string | undefined, declAt: number, scope: Scope, params: string }[]} */
  const functions = [];
  for (const m of masked.matchAll(/\bfunction\b\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = skipBracketed(masked, open);
    const scope = { start: open, end: bodyEnd(close) };
    scopes.push(scope);
    functions.push({ name: m[1], declAt: m.index, scope, params: src.slice(open + 1, close - 1) });
  }
  // Method shorthand (`name(params) {`) and `catch (err) {`.
  for (const m of masked.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/g)) {
    if (['if', 'for', 'while', 'switch', 'with', 'function'].includes(m[1])) continue;
    if (/\bfunction\s*$/.test(masked.slice(Math.max(0, m.index - 12), m.index))) continue;
    const open = m.index + m[0].indexOf('(');
    const scope = { start: open, end: bodyEnd(open + m[2].length + 2) };
    scopes.push(scope);
    declareAll(m[2], scope, true);
  }
  for (const m of masked.matchAll(/=>/g)) {
    let k = m.index - 1;
    while (k >= 0 && /\s/.test(masked[k])) k--;
    let open = k;
    if (masked[k] === ')') {
      let depth = 0;
      for (; open >= 0; open--) {
        if (masked[open] === ')') depth++;
        else if (masked[open] === '(' && --depth === 0) break;
      }
    } else {
      const id = /([A-Za-z_$][\w$]*)$/.exec(masked.slice(0, k + 1));
      if (!id) continue;
      open = k + 1 - id[1].length;
    }
    const scope = { start: open, end: bodyEnd(m.index + 2) };
    scopes.push(scope);
    const callee = iterationReceiver(src, masked, open);
    if (callee) {
      // First parameter: an element of the receiver; second: its numeric index; third: the receiver.
      const params = masked[k] === ')' ? masked.slice(open + 1, k) : masked.slice(open, k + 1);
      splitTopLevel(params, (i) => (params[i] === ',' ? 1 : 0)).forEach((param, position) => {
        const source = position === 1 ? '0' : callee[1];
        for (const b of declareAll(param, scope, false)) b.rhs.push({ text: source, pos: open - 1 });
      });
    } else {
      const named = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?$/.exec(masked.slice(Math.max(0, open - 200), open));
      const params = masked[k] === ')' ? src.slice(open + 1, k) : src.slice(open, k + 1);
      functions.push({ name: named ? named[1] : undefined, declAt: open - 1, scope, params });
    }
  }
  for (const fn of functions) declareParams(fn, innermostScope(scopes, fn.declAt), src, masked, declare);

  for (const m of masked.matchAll(/\b(?:const|let|var)\s*([[{])/g)) {
    const open = m.index + m[0].length - 1;
    declareAll(masked.slice(open, skipBracketed(masked, open)), innermostScope(scopes, m.index), true);
  }
  for (const m of masked.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(\s+(?:of|in)\b)?/g)) {
    declare(m[1], innermostScope(scopes, m.index), !!m[2]);
  }

  /** Resolves `name` as seen from index `pos` to its binding, innermost scope first. */
  const resolve = (/** @type {string} */ name, /** @type {number} */ pos) => {
    /** @type {Binding | null} */
    let found = null;
    for (const b of bindings) {
      if (b.name !== name || !(b.scope.start <= pos && pos < b.scope.end)) continue;
      if (!found || b.scope.end - b.scope.start < found.scope.end - found.scope.start) found = b;
    }
    return found;
  };

  // Writes: `name = v`, `name += v`, `name ||= v`, `name.a[b] = v`, `name.push(v, ...)`.
  for (const m of masked.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)/g)) {
    const name = m[1];
    if (KEYWORDS.has(name)) continue;
    let i = m.index + name.length;
    for (;;) {
      while (/\s/.test(masked[i] || '')) i++;
      if (masked[i] === '.' && masked[i + 1] !== '.') {
        const prop = /^\.\s*([A-Za-z_$][\w$]*)/.exec(masked.slice(i));
        if (!prop) break;
        const afterProp = i + prop[0].length;
        const ws = masked.slice(afterProp).match(/^\s*/)[0].length;
        if ((prop[1] === 'push' || prop[1] === 'unshift') && masked[afterProp + ws] === '(') {
          const end = skipBracketed(src, afterProp + ws);
          const b = resolve(name, m.index);
          if (b) for (const arg of listItems(src.slice(afterProp + ws + 1, end - 1))) b.rhs.push({ text: arg, pos: m.index });
          break;
        }
        i = afterProp;
        continue;
      }
      if (masked[i] === '[') { i = skipBracketed(src, i); continue; }
      break;
    }
    const op = /^(\+=|\|\|=|\?\?=|=(?![=>]))/.exec(masked.slice(i));
    if (op) {
      const from = i + op[0].length;
      const b = resolve(name, m.index);
      if (b) b.rhs.push({ text: src.slice(from, readExpressionEnd(src, from)), pos: from });
    }
  }

  return { bindings, resolve };
}

/** @param {string} content */
function scopedCallableNames(content) {
  const names = new Set(KNOWN_SAFE_CALLABLES);
  for (const m of content.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  for (const m of content.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  for (const m of content.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Names whose every JSDoc declaration in the file (`@param {number} o.size`, or an inline
 * `@type {boolean}` annotation on a parameter) is a number or boolean type. A caller-provided value is trusted
 * only through this contract, which `// @ts-check` holds callers to.
 * @param {string} content
 */
function jsdocNumericNames(content) {
  /** @type {Map<string, boolean>} */
  const numericByName = new Map();
  const record = (/** @type {string} */ type, /** @type {string} */ dotted) => {
    const name = dotted.split('.').pop();
    const isNumeric = /^\s*\??(number|boolean)(\s*\|\s*(number|boolean|undefined|null))*\s*=?\s*$/.test(type);
    numericByName.set(name, (numericByName.get(name) ?? true) && isNumeric);
  };
  for (const m of content.matchAll(/@param\s*\{([^}]*)\}\s*\[?([A-Za-z_$][\w$.]*)/g)) record(m[1], m[2]);
  for (const m of content.matchAll(/\/\*\*\s*@type\s*\{([^}]*)\}\s*\*\/\s*([A-Za-z_$][\w$]*)/g)) record(m[1], m[2]);
  return new Set([...numericByName].filter(([, isNumeric]) => isNumeric).map(([name]) => name));
}

/**
 * Maps each locally imported name to its source ui file and exported name (`*` for a namespace).
 * @param {string} content
 */
function importedNames(content) {
  /** @type {Map<string, { file: string, name: string }>} */
  const map = new Map();
  for (const m of content.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]\.\/([\w.-]+)['"]/g)) {
    map.set(m[1], { file: m[2], name: '*' });
  }
  for (const m of content.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/([\w.-]+)['"]/g)) {
    for (const part of m[1].split(',')) {
      const [exported, local] = part.trim().split(/\s+as\s+/).map((s) => s.trim());
      if (exported) map.set(local || exported, { file: m[2], name: exported });
    }
  }
  return map;
}

/**
 * @typedef {{ file: string, content: string, templates: Template[], ctx: Ctx,
 *             exportsSafe: (name: string) => boolean }} FileAnalysis
 * @type {Map<string, FileAnalysis | null>} null while in progress, so import cycles resolve as unsafe
 */
const analyses = new Map();

/**
 * @param {string} file basename in `dir`
 * @param {string} [content] source text; read from `dir` when omitted
 * @param {string} [dir]
 * @returns {FileAnalysis | null}
 */
function analyzeFile(file, content, dir = UI_DIR) {
  const key = content === undefined ? path.join(dir, file) : `<inline>${file}`;
  if (analyses.has(key)) return analyses.get(key);
  analyses.set(key, null);
  const full = path.join(dir, file);
  if (content === undefined) {
    if (!fs.existsSync(full)) return null;
    content = fs.readFileSync(full, 'utf8');
  }

  const { bindings, resolve } = collectBindings(content, maskNonCode(content));
  const imports = importedNames(content);
  const numericParams = jsdocNumericNames(content);
  /** @type {Set<Binding>} */
  const safeBindings = new Set();
  /** @type {Ctx} */
  const ctx = {
    file,
    content,
    pos: 0,
    shadowed: new Set(),
    callables: scopedCallableNames(content),
    isSafeName(name) {
      if (this.shadowed.has(name)) return false;
      const binding = resolve(name, this.pos);
      if (binding) return safeBindings.has(binding) || (binding.external && numericParams.has(name));
      const imported = imports.get(name);
      if (!imported || imported.name === '*') return false;
      const source = analyzeFile(imported.file, undefined, dir);
      return !!source && source.exportsSafe(imported.name);
    },
    isSafeNamespaceMember(ns, name) {
      const imported = imports.get(ns);
      if (!imported || imported.name !== '*' || this.shadowed.has(ns) || resolve(ns, this.pos)) return null;
      if (!name) return false;
      const source = analyzeFile(imported.file, undefined, dir);
      return !!source && source.exportsSafe(name);
    },
    allowUsed: new Set(),
  };

  // Least fixed point: a binding becomes trusted only once every value written to it is proven
  // safe; external bindings never are (outside the JSDoc numeric contract above).
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of bindings) {
      if (safeBindings.has(b) || b.external) continue;
      if (b.rhs.every(({ text, pos }) => classify(text, { ...ctx, pos }))) { safeBindings.add(b); changed = true; }
    }
  }

  /** @type {Template[]} */
  const templates = [];
  scanForTemplates(content, 0, content.length, templates);
  const exportsSafe = (/** @type {string} */ name) => {
    const b = resolve(name, 0);
    return !!b && b.scope.start === 0 && safeBindings.has(b);
  };
  const analysis = { file, content, templates, ctx, exportsSafe };
  analyses.set(key, analysis);
  return analysis;
}

/**
 * Returns the unescaped interpolations of one ui file's HTML templates.
 * @param {string} file basename, used for ALLOWLIST scoping and import resolution
 * @param {string} [content] inline source (fixtures); read from ui/ when omitted
 */
function findUnescaped(file, content) {
  const analysis = analyzeFile(file, content);
  if (!analysis) return [];
  const findings = [];
  for (const tpl of analysis.templates) {
    if (!isHtmlTemplate(tpl)) continue;
    for (const sub of tpl.subs) {
      if (classify(sub.raw, { ...analysis.ctx, pos: sub.index })) continue;
      const line = analysis.content.slice(0, sub.index).split('\n').length;
      findings.push({ file, line, expr: sanitize(sub.raw) });
    }
  }
  return findings;
}

function main() {
  const files = fs.readdirSync(UI_DIR).filter((f) => f.endsWith('.js'));
  const findings = files.flatMap((file) => findUnescaped(file));

  const used = new Set();
  for (const a of analyses.values()) if (a) for (const entry of a.ctx.allowUsed) used.add(entry);
  const unused = ALLOWLIST.filter((entry) => !used.has(entry));

  if (findings.length || unused.length) {
    if (findings.length) {
      console.error(`verify-ui-escaping FAILED: ${findings.length} unescaped interpolation(s) found:\n`);
      for (const f of findings) console.error(`  ${f.file}:${f.line}  \${${f.expr}}`);
      console.error('\nWrap the value in esc(...), or add a reasoned entry to ALLOWLIST in this file.');
    }
    for (const entry of unused) console.error(`verify-ui-escaping FAILED: stale ALLOWLIST entry ${entry.file || '*'} ${entry.match}`);
    process.exit(1);
  }

  console.log('verify-ui-escaping OK: every ui/*.js template interpolation is escaped, structurally safe, or an explicit reasoned exception.');
  process.exit(0);
}

module.exports = { findUnescaped };

if (require.main === module) main();
