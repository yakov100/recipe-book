import { defineConfig } from 'vite';

const FALLBACK_URL = 'https://nklwzunoipplfkysaztl.supabase.co';
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rbHd6dW5vaXBwbGZreXNhenRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MDIxMjAsImV4cCI6MjA3NzA3ODEyMH0.OYSO3RLcZjUjmSn9hH3bW2TerTsHK2mXeOWWUUQmA3g';

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