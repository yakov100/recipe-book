/**
 * One-time helper: export chef-default-*.png masters for existing categories
 * from deployed 1.webp assets when PNG masters are missing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mastersDir = path.join(__dirname, 'chef-defaults');
const assetsRoot = path.join(__dirname, '..', 'assets', 'default-images');

const FROM_WEBP = {
  breads: 'breads',
  soups: 'soups',
  'main-dishes': 'main-dishes',
  sides: 'sides',
  salads: 'salads',
  other: 'other',
  cakes: 'cakes',
  desserts: 'desserts',
};

fs.mkdirSync(mastersDir, { recursive: true });

for (const [masterKey, folder] of Object.entries(FROM_WEBP)) {
  const out = path.join(mastersDir, `chef-default-${masterKey}.png`);
  if (fs.existsSync(out)) continue;
  const webp = path.join(assetsRoot, folder, '1.webp');
  if (!fs.existsSync(webp)) {
    console.warn(`Skip ${masterKey}: no ${webp}`);
    continue;
  }
  await sharp(webp)
    .resize(1536, 1024, { fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`  ✓ ${path.basename(out)} (from webp)`);
}
