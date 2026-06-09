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
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed === 'undefined') return false;
  // Legacy anon JWT (eyJ…) or Supabase publishable keys (sb_publishable_…, ~46 chars)
  return trimmed.startsWith('sb_publishable_') || trimmed.startsWith('eyJ');
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
    if (supabaseAnonKey.startsWith('sb_publishable_')) {
      console.warn(
        '[Supabase Init] מפתח publishable (sb_publishable_…) לא מאומת כ-JWT ב-Edge Functions (verify_jwt). ' +
          'יצירת/החלפת תמונות ו-AI עלולים להיכשל ב-401. השתמש במפתח anon הישן (eyJ…) ב-VITE_SUPABASE_ANON_KEY.'
      );
    }
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

/** @param {string} functionName */
function edgeFunctionUrl(functionName) {
  const base = (supabaseUrl || '').replace(/\/$/, '');
  return `${base}/functions/v1/${functionName}`;
}

/**
 * @param {string} functionName
 * @param {Record<string, unknown>} body
 * @returns {Promise<{ data: unknown; error: import('@supabase/supabase-js').FunctionsError | null }>}
 */
async function invokeEdgeFunction(functionName, body) {
  if (!supabase) {
    return { data: null, error: { message: 'Supabase not configured' } };
  }
  return supabase.functions.invoke(functionName, { body });
}

/**
 * Headers for raw fetch() to Edge Functions (e.g. when AbortSignal is required).
 * @returns {Record<string, string>}
 */
function edgeFunctionHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${supabaseAnonKey}`,
    apikey: supabaseAnonKey ?? '',
  };
}

export { supabase, supabaseUrl, supabaseAnonKey, edgeFunctionUrl, edgeFunctionHeaders, invokeEdgeFunction };
