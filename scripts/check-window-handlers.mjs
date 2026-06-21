#!/usr/bin/env node
/**
 * Guard for the main.js → modules refactor.
 *
 * Every inline `on*="fn(...)"` in index.html and every `onXXX="fn(...)"` that
 * appears inside JS string literals (innerHTML templates) must resolve to a
 * global function. A global function is one that is either:
 *   - assigned via `window.fn =` somewhere under js/, or
 *   - defined inline in index.html's <script> blocks (e.g. toggleDarkMode).
 *
 * Run: node scripts/check-window-handlers.mjs
 * Exit code 1 if any handler is unresolved.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      out.push(...walk(full));
    } else if (entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const htmlPath = join(root, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
const jsFiles = walk(join(root, 'js'));
const jsSources = jsFiles.map((f) => readFileSync(f, 'utf8'));
const allJs = jsSources.join('\n');

// 1. Collect every handler name referenced in an on*="name(" attribute,
//    from index.html AND from JS innerHTML templates.
const handlerRe = /on[a-z]+\s*=\s*["'`]\s*([A-Za-z_$][\w$]*)\s*\(/g;
const referenced = new Set();
for (const src of [html, allJs]) {
  let m;
  while ((m = handlerRe.exec(src)) !== null) referenced.add(m[1]);
}

// Pseudo-identifiers that are JS keywords, not handler functions.
const ignore = new Set(['if', 'for', 'while', 'return', 'function', 'event', 'this', 'document', 'window']);

// 2. Collect globals: window.fn = ...  AND functions defined in index.html scripts.
const globals = new Set();
let g;
const winRe = /window\.([A-Za-z_$][\w$]*)\s*=/g;
while ((g = winRe.exec(allJs)) !== null) globals.add(g[1]);
// functions declared inside index.html <script> blocks (e.g. toggleDarkMode)
const htmlFnRe = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
while ((g = htmlFnRe.exec(html)) !== null) globals.add(g[1]);

// 3. Report.
const missing = [...referenced].filter((name) => !ignore.has(name) && !globals.has(name)).sort();

if (missing.length) {
  console.error('❌ Unresolved inline handlers (no window.* or inline definition):');
  for (const name of missing) console.error('   - ' + name);
  console.error('\nReferenced handlers: ' + referenced.size + ', resolved globals: ' + globals.size);
  process.exit(1);
}

console.log('✅ All ' + [...referenced].filter((n) => !ignore.has(n)).length +
  ' inline handlers resolve to a global. (globals defined: ' + globals.size + ')');
