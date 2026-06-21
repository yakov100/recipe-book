// Dev-only: flag identifiers called in a module that are neither imported,
// locally declared, nor known globals — i.e. likely missing imports.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'js/main.js';
const src = readFileSync(file, 'utf8');

const code = src
  .replace(/`(?:\\.|[^`\\])*`/gs, ' ')
  .replace(/"(?:\\.|[^"\\])*"/g, ' ')
  .replace(/'(?:\\.|[^'\\])*'/g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

const imports = new Set();
for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
  m[1].split(',').forEach((s) => {
    const n = s.trim().split(/\s+as\s+/).pop().trim();
    if (n) imports.add(n);
  });
}

const locals = new Set();
for (const m of code.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) locals.add(m[1]);
for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) locals.add(m[1]);

// Only bare calls: identifier not preceded by `.` (skip member-access methods)
const called = new Set();
for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[1]);

const known = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'console', 'alert',
  'confirm', 'document', 'window', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'Array', 'Object', 'JSON', 'Set', 'Map', 'Promise', 'String', 'Number', 'Boolean', 'parseInt',
  'parseFloat', 'fetch', 'require', 'Date', 'Math', 'URL', 'Blob', 'File', 'FileReader', 'Image',
  'MediaRecorder', 'navigator', 'location', 'history', 'super', 'typeof', 'await', 'async', 'new',
  'of', 'in', 'Tesseract', 'crypto', 'structuredClone', 'queueMicrotask',
]);

const missing = [...called].filter((n) => !imports.has(n) && !locals.has(n) && !known.has(n)).sort();
if (missing.length) {
  console.error('⚠️  Suspect calls in ' + file + ' (not imported/local/global):');
  for (const n of missing) console.error('   - ' + n);
  process.exit(2);
}
console.log('✅ ' + file + ': no unresolved function calls.');
