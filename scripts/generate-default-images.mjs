/**
 * Builds sharp 800×600 WebP default recipe images from high-res chef masters
 * in scripts/chef-defaults/*.png (high-res sources, not deployed).
 *
 * To regenerate masters: use the same 3D chef as chef-serving.png with category
 * food on the tray, bright pastel background, landscape 3:2.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'assets', 'default-images');
const mastersDir = path.join(__dirname, 'chef-defaults');

const CANVAS = { width: 800, height: 600 };

/** @type {Record<string, string>} */
const CATEGORY_SOURCES = {
  appetizers: 'chef-default-appetizers.png',
  'main-dishes': 'chef-default-main-dishes.png',
  sides: 'chef-default-sides.png',
  salads: 'chef-default-salads.png',
  soups: 'chef-default-soups.png',
  pastries: 'chef-default-pastries.png',
  pasta: 'chef-default-pasta.png',
  meat: 'chef-default-meat.png',
  fish: 'chef-default-fish.png',
  vegetables: 'chef-default-vegetables.png',
  cakes: 'chef-default-cakes.png',
  cookies: 'chef-default-cookies.png',
  sweets: 'chef-default-sweets.png',
  desserts: 'chef-default-desserts.png',
  breads: 'chef-default-breads.png',
  other: 'chef-default-other.png',
  treats: 'chef-default-treats.png',
};

async function buildFromMaster(categoryDir, sourceFile) {
  const sourcePath = path.join(mastersDir, sourceFile);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing master: ${sourcePath}`);
  }

  const dirPath = path.join(root, categoryDir);
  fs.mkdirSync(dirPath, { recursive: true });

  const outWebp = path.join(dirPath, '1.webp');
  const outPng = path.join(dirPath, '1.png');

  await sharp(sourcePath)
    .resize(CANVAS.width, CANVAS.height, {
      fit: 'cover',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
    })
    .webp({ quality: 92, effort: 6 })
    .toFile(outWebp);

  await sharp(outWebp).png({ compressionLevel: 9 }).toFile(outPng);

  for (const stale of fs.readdirSync(dirPath)) {
    if (stale !== '1.webp' && stale !== '1.png') {
      fs.unlinkSync(path.join(dirPath, stale));
    }
  }
}

if (!fs.existsSync(mastersDir)) {
  console.error(`Missing ${mastersDir} — copy chef-default-*.png masters there first.`);
  process.exit(1);
}

for (const [dir, file] of Object.entries(CATEGORY_SOURCES)) {
  await buildFromMaster(dir, file);
  console.log(`  ✓ default-images/${dir}/1.webp`);
}

console.log('Generated sharp default images from scripts/chef-defaults/');
