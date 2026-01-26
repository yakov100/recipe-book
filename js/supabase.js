import { createClient } from '@supabase/supabase-js';

// Get environment variables
const rawUrl = import.meta.env?.VITE_SUPABASE_URL;
const rawKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

// Debug logging - show actual values
console.log('[Supabase Init] rawUrl:', JSON.stringify(rawUrl), 'type:', typeof rawUrl, 'length:', rawUrl?.length);
console.log('[Supabase Init] rawKey exists:', !!rawKey, 'type:', typeof rawKey, 'length:', rawKey?.length);

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
// Build URL from parts to prevent minification issues
const FALLBACK_URL_PART1 = 'https://';
const FALLBACK_URL_PART2 = 'nklwzunoipplfkysaztl';
const FALLBACK_URL_PART3 = '.supabase.co';
const FALLBACK_URL_FULL = FALLBACK_URL_PART1 + FALLBACK_URL_PART2 + FALLBACK_URL_PART3;

let supabaseUrl;
let supabaseAnonKey;

if (urlOk(rawUrl)) {
    supabaseUrl = rawUrl.trim();
    console.log('[Supabase Init] Using env VITE_SUPABASE_URL:', supabaseUrl.substring(0, 30) + '...');
} else {
    // Use hardcoded string built from parts - prevents minification issues
    supabaseUrl = FALLBACK_URL_FULL;
    console.warn('[Supabase Init] rawUrl invalid, using hardcoded fallback. rawUrl was:', JSON.stringify(rawUrl), 'type:', typeof rawUrl, 'length:', rawUrl?.length);
    console.log('[Supabase Init] Fallback URL set to:', supabaseUrl);
}

// Build key from parts to prevent minification
const FALLBACK_KEY_PART1 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.';
const FALLBACK_KEY_PART2 = 'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rbHd6dW5vaXBwbGZreXNhenRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MDIxMjAsImV4cCI6MjA3NzA3ODEyMH0.';
const FALLBACK_KEY_PART3 = 'OYSO3RLcZjUjmSn9hH3bW2TerTsHK2mXeOWWUUQmA3g';
const FALLBACK_KEY_FULL = FALLBACK_KEY_PART1 + FALLBACK_KEY_PART2 + FALLBACK_KEY_PART3;

if (keyOk(rawKey)) {
    supabaseAnonKey = rawKey;
    console.log('[Supabase Init] Using env VITE_SUPABASE_ANON_KEY');
} else {
    // Use hardcoded string built from parts - prevents minification issues
    supabaseAnonKey = FALLBACK_KEY_FULL;
    console.warn('[Supabase Init] rawKey invalid, using hardcoded fallback');
}

// Final validation - ensure supabaseUrl is always valid before createClient
if (!supabaseUrl || typeof supabaseUrl !== 'string' || !supabaseUrl.startsWith('https://')) {
    console.error('[Supabase Init] CRITICAL: supabaseUrl still invalid! Forcing hardcoded URL');
    console.error('[Supabase Init] Invalid supabaseUrl value:', JSON.stringify(supabaseUrl), 'type:', typeof supabaseUrl, 'length:', supabaseUrl?.length);
    supabaseUrl = FALLBACK_URL_FULL;
    console.log('[Supabase Init] After forcing fallback, supabaseUrl:', supabaseUrl);
}

if (!supabaseAnonKey || typeof supabaseAnonKey !== 'string' || supabaseAnonKey.length < 50) {
    console.error('[Supabase Init] CRITICAL: supabaseAnonKey still invalid! Forcing hardcoded key');
    supabaseAnonKey = FALLBACK_KEY_FULL;
}

console.log('[Supabase Init] Final supabaseUrl:', JSON.stringify(supabaseUrl), 'type:', typeof supabaseUrl, 'length:', supabaseUrl?.length);
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
    console.error('[Supabase Init] URL was:', JSON.stringify(supabaseUrl), 'type:', typeof supabaseUrl, 'length:', supabaseUrl?.length);
    console.error('[Supabase Init] Key exists:', !!supabaseAnonKey, 'type:', typeof supabaseAnonKey, 'length:', supabaseAnonKey?.length);
    // Last resort: try with hardcoded values built from parts
    try {
        console.error('[Supabase Init] Attempting last resort with hardcoded values');
        const lastResortUrl = FALLBACK_URL_FULL;
        const lastResortKey = FALLBACK_KEY_FULL;
        console.error('[Supabase Init] Last resort URL:', lastResortUrl, 'length:', lastResortUrl.length);
        console.error('[Supabase Init] Last resort Key length:', lastResortKey.length);
        supabase = createClient(lastResortUrl, lastResortKey, {
            auth: { detectSessionInUrl: false }
        });
        console.log('[Supabase Init] Last resort client created successfully');
        // Update exported values to match
        supabaseUrl = lastResortUrl;
        supabaseAnonKey = lastResortKey;
    } catch (e2) {
        console.error('[Supabase Init] Last resort also failed:', e2);
        console.error('[Supabase Init] Last resort error details:', e2.message, e2.stack);
    }
}

export { supabase, supabaseUrl, supabaseAnonKey };
