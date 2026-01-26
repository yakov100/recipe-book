import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Plugin to fix manifest.json path in HTML
const fixManifestPathPlugin = () => {
  return {
    name: 'fix-manifest-path',
    transformIndexHtml(html) {
      // Replace hashed manifest path with root manifest.json
      return html.replace(/\/assets\/manifest-[^"']+\.json/g, '/manifest.json');
    }
  };
};

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
  base: '/',
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'manifest.json',
          dest: '.'
        },
        {
          src: 'sw.js',
          dest: '.'
        }
      ]
    }),
    fixManifestPathPlugin()
  ]
});