import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://nklwzunoipplfkysaztl.supabase.co';
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rbHd6dW5vaXBwbGZreXNhenRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MDIxMjAsImV4cCI6MjA3NzA3ODEyMH0.OYSO3RLcZjUjmSn9hH3bW2TerTsHK2mXeOWWUUQmA3g';

const rawUrl = import.meta.env?.VITE_SUPABASE_URL;
const rawKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

// Debug logging
console.log('[Supabase Init] rawUrl:', rawUrl, 'type:', typeof rawUrl);
console.log('[Supabase Init] rawKey exists:', !!rawKey, 'type:', typeof rawKey);

const urlOk = (v) => {
  if (v === undefined || v === null) return false;
  if (typeof v !== 'string') return false;
  const trimmed = v.trim();
  return trimmed && trimmed !== 'undefined' && trimmed.startsWith('https://');
};
const keyOk = (v) => {
  if (v === undefined || v === null) return false;
  if (typeof v !== 'string') return false;
  return v.length > 50;
};

const urlOkResult = urlOk(rawUrl);
const keyOkResult = keyOk(rawKey);
console.log('[Supabase Init] urlOk result:', urlOkResult);
console.log('[Supabase Init] keyOk result:', keyOkResult);

let supabaseUrl = urlOk(rawUrl) ? rawUrl.trim() : FALLBACK_URL;
let supabaseAnonKey = keyOk(rawKey) ? rawKey : FALLBACK_ANON_KEY;

console.log('[Supabase Init] Final supabaseUrl:', supabaseUrl);
console.log('[Supabase Init] Final supabaseAnonKey exists:', !!supabaseAnonKey);

// Final validation - ensure supabaseUrl is always valid before createClient
if (!supabaseUrl || typeof supabaseUrl !== 'string' || !supabaseUrl.startsWith('https://')) {
    console.warn('[Supabase Init] Invalid supabaseUrl detected, forcing fallback:', supabaseUrl);
    supabaseUrl = FALLBACK_URL;
}

let supabase = null;
try {
    if (supabaseUrl && supabaseAnonKey) {
        console.log('[Supabase Init] Creating client with URL:', supabaseUrl.substring(0, 30) + '...');
        supabase = createClient(supabaseUrl, supabaseAnonKey, {
            auth: { detectSessionInUrl: false }
        });
        console.log('[Supabase Init] Client created successfully');
    } else {
        console.error('[Supabase Init] Missing URL or key - URL:', !!supabaseUrl, 'Key:', !!supabaseAnonKey);
    }
} catch (e) {
    console.error('[Supabase Init] Failed to create Supabase client:', e);
    console.error('[Supabase Init] URL was:', supabaseUrl);
    console.error('[Supabase Init] Key exists:', !!supabaseAnonKey);
}

export { supabase, supabaseUrl, supabaseAnonKey };
