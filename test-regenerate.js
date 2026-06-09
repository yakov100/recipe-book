/**
 * One-off test: call regenerate-image Edge Function and write response to debug.log.
 * Run: node test-regenerate.js
 * Requires VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (or SUPABASE_URL + SUPABASE_ANON_KEY)
 * in process.env, .env.local, or .env — see .env.example.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  content.split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (!m) return;
    const key = m[1].trim();
    if (process.env[key] !== undefined) return;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

loadEnvFile(path.join(__dirname, '.env'));
loadEnvFile(path.join(__dirname, '.env.local'));

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  console.error(
    'Missing Supabase credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
      '(or SUPABASE_URL and SUPABASE_ANON_KEY) in .env.local or the environment. See .env.example.'
  );
  process.exit(1);
}

const url = supabaseUrl.replace(/\/$/, '') + '/functions/v1/regenerate-image';
const body = JSON.stringify({ recipeName: 'בדיקה', category: 'שונות' });

async function run() {
  const logPath = path.join(__dirname, 'debug.log');
  let log = `[${new Date().toISOString()}] POST ${url}\n`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anonKey },
      body,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { _raw: text.slice(0, 500) };
    }
    const summary = { success: data.success, image_path: data.image_path, error: data.error };
    if (data.image) summary.has_image_base64 = true;
    log += `HTTP ${res.status}\n`;
    log += JSON.stringify(summary, null, 2) + '\n';
    fs.writeFileSync(logPath, log, 'utf8');
    console.log('Response written to debug.log');
    console.log('HTTP', res.status);
    console.log(JSON.stringify(summary, null, 2));
  } catch (e) {
    log += `Error: ${e.message}\n`;
    fs.writeFileSync(logPath, log, 'utf8');
    console.error(e);
  }
}

run();
