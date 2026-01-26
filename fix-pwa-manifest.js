// Post-build script to fix manifest.json path in dist/index.html
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const indexPath = path.join(__dirname, 'dist', 'index.html');

if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');
  // Replace hashed manifest path with root manifest.json
  html = html.replace(/\/assets\/manifest-[^"']+\.json/g, '/manifest.json');
  fs.writeFileSync(indexPath, html, 'utf8');
  console.log('✅ Fixed manifest.json path in index.html');
} else {
  console.error('❌ index.html not found in dist folder');
}
