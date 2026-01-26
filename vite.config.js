import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  },
  // חשוב: publicDir צריך להיות 'assets' כדי ש-Vite יעתיק את התמונות ל-dist
  publicDir: 'assets',
  root: '.',
  base: '/'
});