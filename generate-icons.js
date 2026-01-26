// Script to generate PWA icons
// Run with: node generate-icons.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a simple SVG icon template
const createIconSVG = (size) => {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#8B4513" rx="${size * 0.1}"/>
  <text x="50%" y="50%" font-size="${size * 0.6}" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="Arial, sans-serif">📖</text>
</svg>`;
};

// Icon sizes needed for PWA
const iconSizes = [72, 96, 128, 144, 152, 192, 384, 512];

// Ensure icons directory exists in assets folder
const iconsDir = path.join(__dirname, 'assets', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Generate PNG icons
console.log('Generating PWA icons...\n');

for (const size of iconSizes) {
  try {
    const svgContent = createIconSVG(size);
    const pngPath = path.join(iconsDir, `icon-${size}x${size}.png`);
    
    await sharp(Buffer.from(svgContent))
      .png()
      .toFile(pngPath);
    
    console.log(`✅ Created: icon-${size}x${size}.png`);
  } catch (error) {
    console.error(`❌ Error creating icon-${size}x${size}.png:`, error.message);
  }
}

console.log('\n✅ All icons generated successfully!');
