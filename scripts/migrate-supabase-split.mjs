/**
 * One-time migration: shared Supabase → dedicated recipe-book project.
 * Reads credentials from backups/split-credentials.env (gitignored).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const credPath = join(repoRoot, 'backups', 'split-credentials.env');

function loadEnvFile(path) {
  const env = {};
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/\r$/, '');
  }
  return env;
}

const OLD_URL = 'https://nklwzunoipplfkysaztl.supabase.co';
const cred = loadEnvFile(credPath);
const oldAdmin = createClient(OLD_URL, cred.OLD_SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const newAdmin = createClient(cred.NEW_URL, cred.NEW_SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** @param {import('@supabase/supabase-js').SupabaseClient} client */
async function listAllUsers(client) {
  const users = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) break;
    page += 1;
  }
  return users;
}

/** @returns {Promise<Map<string, string>>} oldUserId → newUserId */
async function syncUsersByEmail() {
  const oldUsers = await listAllUsers(oldAdmin);
  const recipeUserIds = new Set();

  const { data: settings } = await oldAdmin.from('recipe_book_settings').select('user_id');
  settings?.forEach((r) => recipeUserIds.add(r.user_id));
  const { data: convs } = await oldAdmin.from('chat_conversations').select('user_id');
  convs?.forEach((r) => recipeUserIds.add(r.user_id));

  const map = new Map();
  for (const oldId of recipeUserIds) {
    const oldUser = oldUsers.find((u) => u.id === oldId);
    if (!oldUser?.email) {
      console.warn(`Skip user ${oldId}: no email`);
      continue;
    }
    const email = oldUser.email;
    const { data: existing } = await newAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    let newUser = existing?.users?.find((u) => u.email === email);
    if (!newUser) {
      const { data: created, error } = await newAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: oldUser.user_metadata ?? {},
        app_metadata: { provider: 'google', providers: ['google'] },
      });
      if (error) throw new Error(`createUser ${email}: ${error.message}`);
      newUser = created.user;
      console.log(`Created auth user: ${email} → ${newUser.id}`);
    } else {
      console.log(`Existing auth user: ${email} → ${newUser.id}`);
    }
    map.set(oldId, newUser.id);
  }
  return map;
}

async function migrateTables(userMap) {
  const backupDir = join(repoRoot, 'backups', 'pre-split-20250609');
  mkdirSync(backupDir, { recursive: true });

  const { data: settings, error: se } = await oldAdmin.from('recipe_book_settings').select('*');
  if (se) throw se;
  writeFileSync(join(backupDir, 'recipe_book_settings.json'), JSON.stringify(settings, null, 2));

  const { data: conversations, error: ce } = await oldAdmin.from('chat_conversations').select('*');
  if (ce) throw ce;
  writeFileSync(join(backupDir, 'chat_conversations.json'), JSON.stringify(conversations, null, 2));

  const { data: messages, error: me } = await oldAdmin.from('chat_messages').select('*');
  if (me) throw me;
  writeFileSync(join(backupDir, 'chat_messages.json'), JSON.stringify(messages, null, 2));

  const newSettings = (settings ?? []).map((row) => ({
    ...row,
    user_id: userMap.get(row.user_id) ?? row.user_id,
  }));
  if (newSettings.length) {
    const { error } = await newAdmin.from('recipe_book_settings').upsert(newSettings);
    if (error) throw error;
    console.log(`Migrated recipe_book_settings: ${newSettings.length}`);
  }

  const newConversations = (conversations ?? []).map((row) => ({
    ...row,
    user_id: userMap.get(row.user_id) ?? row.user_id,
  }));
  if (newConversations.length) {
    const { error } = await newAdmin.from('chat_conversations').upsert(newConversations);
    if (error) throw error;
    console.log(`Migrated chat_conversations: ${newConversations.length}`);
  }

  if (messages?.length) {
    const { error } = await newAdmin.from('chat_messages').upsert(messages);
    if (error) throw error;
    console.log(`Migrated chat_messages: ${messages.length}`);
  }
}

async function migrateStorage() {
  const bucket = 'recipe-images';
  let offset = 0;
  const limit = 100;
  let copied = 0;
  let failed = 0;

  for (;;) {
    const { data: list, error } = await oldAdmin.storage.from(bucket).list('', {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    if (!list?.length) break;

    for (const item of list) {
      if (item.id === null && item.metadata === null) {
        // folder — recurse one level
        const { data: nested } = await oldAdmin.storage.from(bucket).list(item.name, { limit: 1000 });
        for (const nestedItem of nested ?? []) {
          const path = `${item.name}/${nestedItem.name}`;
          await copyObject(path);
        }
        continue;
      }
      await copyObject(item.name);
    }

    if (list.length < limit) break;
    offset += limit;
  }

  async function copyObject(path) {
    const { data: blob, error: dlErr } = await oldAdmin.storage.from(bucket).download(path);
    if (dlErr) {
      console.warn(`Download failed ${path}:`, dlErr.message);
      failed += 1;
      return;
    }
    const { error: upErr } = await newAdmin.storage.from(bucket).upload(path, blob, {
      upsert: true,
      contentType: blob.type || 'image/jpeg',
    });
    if (upErr) {
      console.warn(`Upload failed ${path}:`, upErr.message);
      failed += 1;
      return;
    }
    copied += 1;
    if (copied % 10 === 0) console.log(`Storage copied: ${copied}`);
  }

  console.log(`Storage migration done. copied=${copied} failed=${failed}`);
}

async function main() {
  console.log('Syncing auth users by email...');
  const userMap = await syncUsersByEmail();
  console.log('User map:', Object.fromEntries(userMap));

  console.log('Migrating tables...');
  await migrateTables(userMap);

  console.log('Migrating storage...');
  await migrateStorage();

  writeFileSync(
    join(repoRoot, 'backups', 'pre-split-20250609', 'user_id_map.json'),
    JSON.stringify(Object.fromEntries(userMap), null, 2)
  );
  console.log('Migration complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
