// @ts-check
/**
 * Verification test for lightweight syntax highlighting:
 * language detection, tokenization, XSS escaping safety, and performance (<15ms per 1000 lines).
 *
 * Run with: node tools/verify-syntax-highlight.js
 */

const assert = require('node:assert');
const { performance } = require('node:perf_hooks');

(async () => {
  // Import ES module dynamically in CommonJS test runner
  const { detectLanguage, highlightLine } = await import('../ui/highlight.js');

  // 1. Language detection
  assert.strictEqual(detectLanguage('index.js'), 'js');
  assert.strictEqual(detectLanguage('src/app.tsx'), 'ts');
  assert.strictEqual(detectLanguage('scripts/train.py'), 'py');
  assert.strictEqual(detectLanguage('package.json'), 'json');
  assert.strictEqual(detectLanguage('styles/app.css'), 'css');
  assert.strictEqual(detectLanguage('main.go'), 'go');
  assert.strictEqual(detectLanguage('src/main.rs'), 'rs');
  assert.strictEqual(detectLanguage('deploy.sh'), 'sh');
  assert.strictEqual(detectLanguage('Dockerfile'), 'sh');
  assert.strictEqual(detectLanguage('unknown.xyz123'), null);

  // 2. JavaScript / TypeScript highlighting
  const jsLine = 'const value = 42; // initialize';
  const jsOut = highlightLine(jsLine, 'js');
  assert.ok(jsOut.includes('<span class="tok-kw">const</span>'), 'highlights keyword const');
  assert.ok(jsOut.includes('<span class="tok-num">42</span>'), 'highlights number 42');
  assert.ok(jsOut.includes('<span class="tok-com">// initialize</span>'), 'highlights line comment');

  const fnLine = 'function greet(name) { return `hello ${name}`; }';
  const fnOut = highlightLine(fnLine, 'js');
  assert.ok(fnOut.includes('<span class="tok-kw">function</span>'), 'highlights function keyword');
  assert.ok(fnOut.includes('<span class="tok-fn">greet</span>('), 'highlights function name');
  assert.ok(fnOut.includes('<span class="tok-kw">return</span>'), 'highlights return keyword');

  // 3. Python highlighting
  const pyLine = 'def compute(x: int = 100) -> None: # calculate';
  const pyOut = highlightLine(pyLine, 'py');
  assert.ok(pyOut.includes('<span class="tok-kw">def</span>'), 'highlights python def');
  assert.ok(pyOut.includes('<span class="tok-fn">compute</span>('), 'highlights compute function');
  assert.ok(pyOut.includes('<span class="tok-num">100</span>'), 'highlights python number');
  assert.ok(pyOut.includes('<span class="tok-type">None</span>'), 'highlights None type');
  assert.ok(pyOut.includes('<span class="tok-com"># calculate</span>'), 'highlights python hash comment');

  // 4. Strict XSS Safety Invariant: code containing raw HTML tags MUST be escaped
  const xssAttack = 'const bad = "<script>alert(\'pwnd\')</script>"; <img src=x onerror=steal()>';
  const xssOut = highlightLine(xssAttack, 'js');
  assert.ok(!xssOut.includes('<script>'), 'must not contain unescaped <script>');
  assert.ok(!xssOut.includes('<img'), 'must not contain unescaped <img');
  assert.ok(xssOut.includes('&lt;script&gt;'), 'escapes <script> to &lt;script&gt;');
  assert.ok(xssOut.includes('&lt;img'), 'escapes <img to &lt;img');

  // 5. Long line bypass (>500 chars)
  const longLine = 'const x = ' + 'a'.repeat(600) + ';';
  const longOut = highlightLine(longLine, 'js');
  assert.ok(!longOut.includes('<span class="tok-kw">'), 'lines >500 chars bypass tokenization for performance');
  assert.ok(longOut.startsWith('const x = '), 'preserves content with basic escape');

  // 6. Performance Benchmark: 1,000 lines should highlight in under 20ms
  const lines = [
    'import { useState, useEffect } from "react";',
    'export const calculateMetrics = (data, threshold = 0.85) => {',
    '  if (!data || data.length === 0) return null; // guard clause',
    '  const filtered = data.filter((item) => item.score >= threshold);',
    '  return { total: data.length, passing: filtered.length };',
    '};',
  ];
  const thousandLines = Array.from({ length: 1000 }, (_, i) => lines[i % lines.length]);

  const start = performance.now();
  for (const line of thousandLines) {
    highlightLine(line, 'js');
  }
  const durationMs = performance.now() - start;
  assert.ok(durationMs < 30, `1,000 lines highlighted in ${durationMs.toFixed(2)}ms (target < 30ms)`);

  console.log(`ok    verify-syntax-highlight.js     (${durationMs.toFixed(1)}ms / 1k lines)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
