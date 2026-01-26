import { createClient } from '@supabase/supabase-js';

// Get environment variables
const rawUrl = import.meta.env?.VITE_SUPABASE_URL;
const rawKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

// Debug logging
console.log('[Supabase Init] rawUrl:', rawUrl, 'type:', typeof rawUrl);
console.log('[Supabase Init] rawKey exists:', !!rawKey, 'type:', typeof rawKey);

// Validation functions
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

// Determine final values - use hardcoded strings directly, not constants
let supabaseUrl;
let supabaseAnonKey;

if (urlOk(rawUrl)) {
    supabaseUrl = rawUrl.trim();
    console.log('[Supabase Init] Using env VITE_SUPABASE_URL');
} else {
    // Use hardcoded string directly - prevents minification issues
    supabaseUrl = 'https://nklwzunoipplfkysaztl.supabase.co';
    console.warn('[Supabase Init] rawUrl invalid, using hardcoded fallback. rawUrl was:', rawUrl, 'type:', typeof rawUrl);
}

if (keyOk(rawKey)) {
    supabaseAnonKey = rawKey;
    console.log('[Supabase Init] Using env VITE_SUPABASE_ANON_KEY');
} else {
    // Use hardcoded string directly - prevents minification issues
    supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rbHd6dW5vaXBwbGZreXNhenRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MDIxMjAsImV4cCI6MjA3NzA3ODEyMH0.OYSO3RLcZjUjmSn9hH3bW2TerTsHK2mXeOWWUUQmA3g';
    console.warn('[Supabase Init] rawKey invalid, using hardcoded fallback');
}

// Final validation - ensure supabaseUrl is always valid before createClient
if (!supabaseUrl || typeof supabaseUrl !== 'string' || !supabaseUrl.startsWith('https://')) {
    console.error('[Supabase Init] CRITICAL: supabaseUrl still invalid! Forcing hardcoded URL');
    supabaseUrl = 'https://nklwzunoipplfkysaztl.supabase.co';
}

if (!supabaseAnonKey || typeof supabaseAnonKey !== 'string' || supabaseAnonKey.length < 50) {
    console.error('[Supabase Init] CRITICAL: supabaseAnonKey still invalid! Forcing hardcoded key');
    supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rbHd6dW5vaXBwbGZreXNhenRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MDIxMjAsImV4cCI6MjA3NzA3ODEyMH0.OYSO3RLcZjUjmSn9hH3bW2TerTsHK2mXeOWWUUQmA3g';
}

console.log('[Supabase Init] Final supabaseUrl:', supabaseUrl);
console.log('[Supabase Init] Final supabaseAnonKey exists:', !!supabaseAnonKey, 'length:', supabaseAnonKey?.length);

// Create Supabase client - URL and key are guaranteed to be valid at this point
let supabase = null;
try {
    // Final check before createClient
    if (!supabaseUrl || typeof supabaseUrl !== 'string' || !supabaseUrl.startsWith('https://')) {
        throw new Error('supabaseUrl is invalid: ' + supabaseUrl);
    }
    if (!supabaseAnonKey || typeof supabaseAnonKey !== 'string' || supabaseAnonKey.length < 50) {
        throw new Error('supabaseAnonKey is invalid');
    }
    
    const urlPreview = supabaseUrl.substring(0, 30) + '...';
    console.log('[Supabase Init] Creating client with URL:', urlPreview);
    
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { detectSessionInUrl: false }
    });
    
    console.log('[Supabase Init] Client created successfully');
} catch (e) {
    console.error('[Supabase Init] Failed to create Supabase client:', e);
    console.error('[Supabase Init] URL was:', supabaseUrl, 'type:', typeof supabaseUrl, 'length:', supabaseUrl?.length);
    console.error('[Supabase Init] Key exists:', !!supabaseAnonKey, 'type:', typeof supabaseAnonKey, 'length:', supabaseAnonKey?.length);
    // Last resort: try with hardcoded values directly
    try {
        console.error('[Supabase Init] Attempting last resort with hardcoded values');
        supabase = createClient(
            'https://nklwzunoipplfkysaztl.supabase.co',
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rbHd6dW5vaXBwbGZreXNhenRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MDIxMjAsImV4cCI6MjA3NzA3ODEyMH0.OYSO3RLcZjUjmSn9hH3bW2TerTsHK2mXeOWWUUQmA3g',
            { auth: { detectSessionInUrl: false } }
        );
        console.log('[Supabase Init] Last resort client created successfully');
        // Update exported values to match
        supabaseUrl = 'https://nklwzunoipplfkysaztl.supabase.co';
        supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rbHd6dW5vaXBwbGZreXNhenRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MDIxMjAsImV4cCI6MjA3NzA3ODEyMH0.OYSO3RLcZjUjmSn9hH3bW2TerTsHK2mXeOWWUUQmA3g';
    } catch (e2) {
        console.error('[Supabase Init] Last resort also failed:', e2);
    }
}

export { supabase, supabaseUrl, supabaseAnonKey };
