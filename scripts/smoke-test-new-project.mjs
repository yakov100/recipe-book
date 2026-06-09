/**
 * Smoke tests for dedicated Supabase project after split.
 * Usage: node scripts/smoke-test-new-project.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const credPath = join(__dirname, '..', 'backups', 'split-credentials.env');

function loadEnvFile(path) {
  const env = {};
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const cred = loadEnvFile(credPath);
const anon = createClient(cred.NEW_URL, cred.NEW_ANON);
const admin = createClient(cred.NEW_URL, cred.NEW_SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name}: ${detail}`);
}

async function main() {
  const { count: settingsCount, error: se } = await admin
    .from('recipe_book_settings')
    .select('*', { count: 'exact', head: true });
  if (se) fail('recipe_book_settings', se.message);
  else pass('recipe_book_settings rows', String(settingsCount));

  const { count: convCount, error: ce } = await admin
    .from('chat_conversations')
    .select('*', { count: 'exact', head: true });
  if (ce) fail('chat_conversations', ce.message);
  else pass('chat_conversations rows', String(convCount));

  const { data: buckets, error: be } = await admin.storage.listBuckets();
  if (be) fail('storage buckets', be.message);
  else if (buckets?.some((b) => b.name === 'recipe-images')) pass('recipe-images bucket');
  else fail('recipe-images bucket', 'missing');

  const { data: objects, error: oe } = await admin.storage.from('recipe-images').list('', { limit: 5 });
  if (oe) fail('storage list', oe.message);
  else pass('storage objects sample', String(objects?.length ?? 0));

  const { error: rpcErr } = await anon.rpc('get_public_recipe', {
    recipe_id: '00000000-0000-0000-0000-000000000000',
  });
  if (rpcErr && !rpcErr.message.includes('0 rows')) fail('get_public_recipe RPC', rpcErr.message);
  else pass('get_public_recipe RPC callable');

  const fnUrl = `${cred.NEW_URL}/functions/v1/recipe-ai`;
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: cred.NEW_ANON,
      Authorization: `Bearer ${cred.NEW_ANON}`,
    },
    body: JSON.stringify({ messages: [], recipes: [] }),
  });
  if (res.status === 401) pass('recipe-ai JWT gate', '401 without user session (expected)');
  else if (res.ok) pass('recipe-ai', `HTTP ${res.status}`);
  else fail('recipe-ai', `HTTP ${res.status}`);

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    process.exitCode = 1;
    console.error(`\n${failed.length} check(s) failed`);
  } else {
    console.log(`\nAll ${results.length} checks passed`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
