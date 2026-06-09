import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, '..', 'assets', 'icons');
const chefSourcePath = path.join(__dirname, '..', 'assets', 'chef-serving.png');

if (!fs.existsSync(chefSourcePath)) {
  console.error('Missing assets/chef-serving.png — the 3D chef image used for app branding.');
  process.exit(1);
}

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const bg = { r: 253, g: 251, b: 247, alpha: 1 };

/** @param {import('sharp').Sharp} pipeline @param {number} size @param {number} padding */
function fitOnCanvas(pipeline, size, padding) {
  const inner = size - padding * 2;
  return pipeline
    .resize(inner, inner, { fit: 'contain', background: bg })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: bg,
    })
    .png();
}

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('Install sharp first: npm install --save-dev sharp');
  process.exit(1);
}

fs.mkdirSync(iconsDir, { recursive: true });

const source = sharp(chefSourcePath);

for (const size of sizes) {
  const padding = Math.round(size * 0.08);
  await fitOnCanvas(source.clone(), size, padding).toFile(
    path.join(iconsDir, `icon-${size}x${size}.png`)
  );
}

await fitOnCanvas(source.clone(), 32, 2).toFile(path.join(iconsDir, 'favicon.png'));

await fitOnCanvas(source.clone(), 512, Math.round(512 * 0.14)).toFile(
  path.join(iconsDir, 'icon-512x512-maskable.png')
);

// Drop stale SVG app icons from the old flat-chef generator.
for (const name of fs.readdirSync(iconsDir)) {
  if (/^icon-\d+x\d+\.svg$/.test(name) || name === 'favicon.svg' || name === 'icon-512x512-maskable.svg') {
    fs.unlinkSync(path.join(iconsDir, name));
  }
}

console.log('Generated app icons from assets/chef-serving.png');
