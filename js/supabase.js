import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env?.VITE_SUPABASE_URL;
const rawKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

const urlOk = (v) => {
  if (v === undefined || v === null) return false;
  if (typeof v !== 'string') return false;
  const trimmed = v.trim();
  return trimmed.length > 0 && trimmed !== 'undefined' && trimmed.startsWith('https://');
};

const keyOk = (v) => {
  if (v === undefined || v === null) return false;
  if (typeof v !== 'string') return false;
  return v.trim().length > 50;
};

/** @type {string | null} */
let supabaseUrl = urlOk(rawUrl) ? rawUrl.trim() : null;

/** @type {string | null} */
let supabaseAnonKey = keyOk(rawKey) ? rawKey.trim() : null;

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let supabase = null;

if (supabaseUrl && supabaseAnonKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { detectSessionInUrl: false },
    });
  } catch (e) {
    console.error('[Supabase Init] Failed to create client:', e);
    supabaseUrl = null;
    supabaseAnonKey = null;
    supabase = null;
  }
} else {
  console.error(
    '[Supabase Init] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Set them in .env.local (local dev) or Vercel env vars (production build). See .env.example.'
  );
}

export { supabase, supabaseUrl, supabaseAnonKey };
