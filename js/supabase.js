import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://nklwzunoipplfkysaztl.supabase.co';
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rbHd6dW5vaXBwbGZreXNhenRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MDIxMjAsImV4cCI6MjA3NzA3ODEyMH0.OYSO3RLcZjUjmSn9hH3bW2TerTsHK2mXeOWWUUQmA3g';

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
