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

/** @param {number} size */
function circleMaskPng(size) {
  const radius = size / 2;
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="none"/>
    <circle cx="${radius}" cy="${radius}" r="${radius}" fill="white"/>
  </svg>`;
  return Buffer.from(svg);
}

/** @param {number} size @param {number} chefDiameter */
function ringBackgroundPng(size, chefDiameter) {
  const radius = size / 2;
  const chefRadius = chefDiameter / 2;
  const center = radius;
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="ring" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#93c5fd"/>
        <stop offset="100%" stop-color="#a7f3d0"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="none"/>
    <circle cx="${center}" cy="${center}" r="${radius}" fill="url(#ring)"/>
    <circle cx="${center}" cy="${center}" r="${chefRadius + 1}" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="${Math.max(1, Math.round(size * 0.045))}"/>
  </svg>`;
  return Buffer.from(svg);
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

/**
 * Circular app icon matching .header-logo-icon — gradient ring + round chef photo.
 * @param {import('sharp').Sharp} chefSource
 * @param {number} size
 * @param {{ maskable?: boolean }} options
 */
async function createCircularAppIcon(chefSource, size, options = {}) {
  const maskable = options.maskable === true;
  const chefScale = maskable ? 0.62 : 0.78;
  const chefDiameter = Math.round(size * chefScale);
  const inset = Math.round((size - chefDiameter) / 2);
  const zoom = 1.15;

  const chefBuffer = await chefSource
    .clone()
    .resize(Math.round(chefDiameter * zoom), Math.round(chefDiameter * zoom), {
      fit: 'cover',
      position: 'centre',
    })
    .resize(chefDiameter, chefDiameter, {
      fit: 'cover',
      position: 'north',
    })
    .composite([
      {
        input: await sharp(circleMaskPng(chefDiameter)).png().toBuffer(),
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();

  const ringBuffer = await sharp(ringBackgroundPng(size, chefDiameter)).png().toBuffer();

  const composited = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: ringBuffer, top: 0, left: 0 },
      { input: chefBuffer, top: inset, left: inset },
    ])
    .png()
    .toBuffer();

  return sharp(composited)
    .composite([
      {
        input: await sharp(circleMaskPng(size)).png().toBuffer(),
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();
}

for (const size of sizes) {
  const iconBuffer = await createCircularAppIcon(source, size);
  await sharp(iconBuffer).toFile(path.join(iconsDir, `icon-${size}x${size}.png`));
}

const faviconBuffer = await createCircularAppIcon(source, 32);
await sharp(faviconBuffer).toFile(path.join(iconsDir, 'favicon.png'));

const maskableBuffer = await createCircularAppIcon(source, 512, { maskable: true });
await sharp(maskableBuffer).toFile(path.join(iconsDir, 'icon-512x512-maskable.png'));

for (const name of fs.readdirSync(iconsDir)) {
  if (/^icon-\d+x\d+\.svg$/.test(name) || name === 'favicon.svg' || name === 'icon-512x512-maskable.svg') {
    fs.unlinkSync(path.join(iconsDir, name));
  }
}

console.log('Generated circular app icons from assets/chef-serving.png');
