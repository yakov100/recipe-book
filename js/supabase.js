import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://nklwzunoipplfkysaztl.supabase.co';
const FALLBACK_ANON_KEY = 'REDACTED_SUPABASE_ANON_KEY';

const rawUrl = import.meta.env?.VITE_SUPABASE_URL;
const rawKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;
const urlOk = (v) => typeof v === 'string' && v && v !== 'undefined' && v.trim().startsWith('https://');
const keyOk = (v) => typeof v === 'string' && v.length > 50;

export const supabaseUrl = urlOk(rawUrl) ? rawUrl.trim() : FALLBACK_URL;
export const supabaseAnonKey = keyOk(rawKey) ? rawKey : FALLBACK_ANON_KEY;

let supabase = null;
try {
    if (supabaseUrl && supabaseAnonKey) {
        supabase = createClient(supabaseUrl, supabaseAnonKey, {
            auth: { detectSessionInUrl: false }
        });
    }
} catch (e) {
    console.error('Failed to create Supabase client:', e);
}

export { supabase };
