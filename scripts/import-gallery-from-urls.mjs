/**
 * Download legacy gallery icons from a URL list and register them for seeding.
 *
 * Input: prisma/seeds/data/gallery-legacy-urls.txt
 *   - One URL per line (matched to gallery-order.json by position), or
 *   - Display Name|https://full-url.png
 *
 * Output:
 *   - uploads/care-pathway/imported/{slug}.png
 *   - prisma/seeds/data/gallery-import-map.json
 *
 * Then run: npm run prisma:seed  (or npm run seed)
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..');
const dataDir = join(backendRoot, 'prisma', 'seeds', 'data');
const urlsFile = join(dataDir, 'gallery-legacy-urls.txt');
const orderFile = join(dataDir, 'gallery-order.json');
const mapFile = join(dataDir, 'gallery-import-map.json');
const uploadDir = join(backendRoot, 'uploads', 'care-pathway', 'imported');

function slugFromName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/** Map ePlan Care filenames to existing Care Admin gallery slugs. */
const SLUG_ALIASES = {
  'pressure-ulcers': 'pressure-ulcer',
  'palliative-care': 'palliative',
};

function slugFromUrl(url) {
  const file = (url.split('/').pop() ?? '').replace(/\.(png|jpe?g|webp)$/i, '');
  return SLUG_ALIASES[file] ?? file;
}

function nameFromSlug(slug) {
  return slug
    .split('-')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

function parseLines(raw) {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function parseEntry(line) {
  if (line.includes('|')) {
    const [name, url] = line.split('|').map((s) => s.trim());
    return { name, url };
  }
  return { name: null, url: line };
}

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  Referer: 'https://login.eplancare.com/',
};

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow', headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const body = res.body;
  if (!body) throw new Error(`Empty body for ${url}`);
  await pipeline(body, createWriteStream(dest));
}

async function main() {
  if (!existsSync(urlsFile)) {
    const example = join(dataDir, 'gallery-legacy-urls.example.txt');
    if (existsSync(example)) {
      const { copyFileSync } = await import('fs');
      copyFileSync(example, urlsFile);
      console.log(`Created ${urlsFile} from example. Paste your img src URLs, then run this command again.`);
    } else {
      console.error(`Missing ${urlsFile}`);
      console.error('Create gallery-legacy-urls.txt and paste your img src URLs.');
    }
    process.exit(1);
  }

  const lines = parseLines(readFileSync(urlsFile, 'utf8'));
  if (!lines.length) {
    console.log('No URLs in gallery-legacy-urls.txt yet (comments-only file).');
    console.log('Paste one URL per line, or use:  Medication|https://full-url.png');
    console.log('Gallery icons are already available via:  npm run prisma:seed');
    process.exit(0);
  }
  const order = existsSync(orderFile)
    ? JSON.parse(readFileSync(orderFile, 'utf8'))
    : [];
  const orderBySlug = new Map(order.map((r) => [r.slug, r]));

  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

  const map = [];
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < lines.length; i++) {
    const { name: inlineName, url } = parseEntry(lines[i]);
    const slug = slugFromUrl(url);
    const orderRow = orderBySlug.get(slug);
    const name = inlineName ?? orderRow?.name ?? nameFromSlug(slug);
    if (!name || !slug) {
      console.warn(`Line ${i + 1}: could not derive name/slug from URL`);
      fail += 1;
      continue;
    }
    const dest = join(uploadDir, `${slug}.png`);

    try {
      await download(url, dest);
      map.push({ slug, name, fileUrl: `/uploads/care-pathway/imported/${slug}.png` });
      console.log(`OK  ${name} -> ${slug}.png`);
      ok += 1;
    } catch (e) {
      console.warn(`FAIL ${name}: ${e.message}`);
      fail += 1;
    }
  }

  writeFileSync(mapFile, JSON.stringify(map, null, 2));
  console.log(`\nDone: ${ok} downloaded, ${fail} failed. Map: ${mapFile}`);
  console.log('Run: npm run prisma:seed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
