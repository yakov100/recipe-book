/**
 * One-off test: call regenerate-image Edge Function and write response to debug.log.
 * Run: node test-regenerate.js
 * Uses VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from env or .env (parsed manually).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://nklwzunoipplfkysaztl.supabase.co';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rbHd6dW5vaXBwbGZreXNhenRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MDIxMjAsImV4cCI6MjA3NzA3ODEyMH0.OYSO3RLcZjUjmSn9hH3bW2TerTsHK2mXeOWWUUQmA3g';

const url = supabaseUrl + '/functions/v1/regenerate-image';
const body = JSON.stringify({ recipeName: 'בדיקה', category: 'שונות' });

async function run() {
  const logPath = path.join(__dirname, 'debug.log');
  let log = `[${new Date().toISOString()}] POST ${url}\n`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + anonKey },
      body
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
