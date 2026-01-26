import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Plugin to fix manifest.json path in HTML after build
const fixManifestPathPlugin = () => {
  return {
    name: 'fix-manifest-path',
    closeBundle() {
      const indexPath = path.join(__dirname, 'dist', 'index.html');
      try {
        if (fs.existsSync(indexPath)) {
          let html = fs.readFileSync(indexPath, 'utf8');
          const originalHtml = html;
          // Replace hashed manifest path with root manifest.json
          html = html.replace(/\/assets\/manifest-[^"']+\.json/g, '/manifest.json');
          
          if (html !== originalHtml) {
            fs.writeFileSync(indexPath, html, 'utf8');
            console.log('✅ Fixed manifest.json path in index.html');
          }
        }
      } catch (error) {
        console.warn('⚠️  Could not fix manifest path:', error.message);
        // Don't fail the build
      }
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