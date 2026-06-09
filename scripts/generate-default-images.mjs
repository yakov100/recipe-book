import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'assets', 'default-images');

const categories = {
  breads: { label: 'לחם', colors: ['#D4A574', '#C4956A', '#B88560'] },
  soups: { label: 'מרק', colors: ['#E8A87C', '#D9986A', '#CA8858'] },
  'main-dishes': { label: 'מנה עיקרית', colors: ['#C97C5D', '#B86E50', '#A76043'] },
  sides: { label: 'תוספת', colors: ['#8FB996', '#7FA986', '#6F9976'] },
  salads: { label: 'סלט', colors: ['#7CB87A', '#6CA86A', '#5C985A'] },
  other: { label: 'מתכון', colors: ['#A7C7E7', '#97B7D7', '#87A7C7'] },
  cakes: { label: 'עוגה', colors: ['#E8B4BC', '#D8A4AC', '#C8949C'] },
  desserts: { label: 'קינוח', colors: ['#D4A5D9', '#C495C9', '#B485B9'] },
};

function svg(label, bg, variant) {
  const yOffset = variant * 12;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600" role="img" aria-label="${label}">
  <rect width="800" height="600" fill="${bg}"/>
  <circle cx="400" cy="${260 + yOffset}" r="72" fill="rgba(255,255,255,0.25)"/>
  <ellipse cx="400" cy="${380 + yOffset}" rx="120" ry="28" fill="rgba(255,255,255,0.18)"/>
  <text x="400" y="${430 + yOffset}" text-anchor="middle" font-family="Heebo,Segoe UI,sans-serif" font-size="36" font-weight="600" fill="rgba(255,255,255,0.92)">${label}</text>
</svg>`;
}

for (const [dir, { label, colors }] of Object.entries(categories)) {
  const dirPath = path.join(root, dir);
  fs.mkdirSync(dirPath, { recursive: true });
  colors.forEach((color, i) => {
    fs.writeFileSync(path.join(dirPath, `${i + 1}.svg`), svg(label, color, i));
  });
}

console.log('Generated default-images SVG placeholders in assets/default-images/');
