import { defineConfig } from 'vite';

const FALLBACK_URL = 'https://nklwzunoipplfkysaztl.supabase.co';
const FALLBACK_ANON_KEY = 'REDACTED_SUPABASE_ANON_KEY';

export default defineConfig({
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  },
  publicDir: false,
  root: '.',
  base: '/',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
      process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_URL.trim() && process.env.VITE_SUPABASE_URL !== 'undefined'
        ? process.env.VITE_SUPABASE_URL.trim()
        : FALLBACK_URL
    ),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
      process.env.VITE_SUPABASE_ANON_KEY && typeof process.env.VITE_SUPABASE_ANON_KEY === 'string' && process.env.VITE_SUPABASE_ANON_KEY.length > 50
        ? process.env.VITE_SUPABASE_ANON_KEY
        : FALLBACK_ANON_KEY
    )
  }
});