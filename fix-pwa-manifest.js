// Post-build script to fix manifest.json path in dist/index.html
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const indexPath = path.join(__dirname, 'dist', 'index.html');

try {
  if (fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, 'utf8');
    // Replace hashed manifest path with root manifest.json
    const originalHtml = html;
    html = html.replace(/\/assets\/manifest-[^"']+\.json/g, '/manifest.json');
    
    if (html !== originalHtml) {
      fs.writeFileSync(indexPath, html, 'utf8');
      console.log('✅ Fixed manifest.json path in index.html');
    } else {
      console.log('ℹ️  manifest.json path already correct or not found in HTML');
    }
  } else {
    console.warn('⚠️  index.html not found in dist folder - this is OK if build failed');
    process.exit(0); // Don't fail the build if index.html doesn't exist
  }
} catch (error) {
  console.error('❌ Error fixing manifest path:', error.message);
  // Don't fail the build - this is a non-critical fix
  process.exit(0);
}
