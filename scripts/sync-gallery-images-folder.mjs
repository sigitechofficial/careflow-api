/**
 * Copy uploads/gallery-images/*.png → uploads/care-pathway/imported/{slug}.png
 * and write prisma/seeds/data/gallery-import-map.json
 *
 * Run: node scripts/sync-gallery-images-folder.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..');
const srcDir = join(backendRoot, 'uploads', 'gallery-images');
const destDir = join(backendRoot, 'uploads', 'care-pathway', 'imported');
const mapFile = join(backendRoot, 'prisma', 'seeds', 'data', 'gallery-import-map.json');

const SLUG_ALIASES = {
  'pressure-ulcers': 'pressure-ulcer',
  'palliative-care': 'palliative',
};

function slugFromFile(file) {
  const base = file
    .replace(/^static-content_form_/i, '')
    .replace(/\.(png|jpe?g|webp)$/i, '');
  return SLUG_ALIASES[base] ?? base;
}

function nameFromSlug(slug) {
  return slug
    .split('-')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

function main() {
  if (!existsSync(srcDir)) {
    console.error(`Missing folder: ${srcDir}`);
    process.exit(1);
  }
  mkdirSync(destDir, { recursive: true });

  const files = readdirSync(srcDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  const map = [];

  for (const file of files.sort()) {
    const slug = slugFromFile(file);
    const name = nameFromSlug(slug);
    const dest = join(destDir, `${slug}.png`);
    copyFileSync(join(srcDir, file), dest);
    map.push({ slug, name, fileUrl: `/uploads/care-pathway/imported/${slug}.png` });
  }

  writeFileSync(mapFile, JSON.stringify(map, null, 2));
  console.log(`Synced ${map.length} image(s) to care-pathway/imported/`);
  console.log(`Wrote ${mapFile}`);
  console.log('Run: npm run prisma:seed');
}

main();
