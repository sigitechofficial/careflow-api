/**
 * Login to local API, fetch all standard gallery rows, download remote img URLs,
 * write gallery-legacy-urls.txt, then import into uploads/care-pathway/imported.
 *
 * Env: API_BASE_URL (default http://localhost:3000)
 *      GALLERY_LOGIN_EMAIL / GALLERY_LOGIN_PASSWORD (default seed admin)
 *
 * Run: node scripts/download-gallery-from-api.mjs
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
const uploadDir = join(backendRoot, 'uploads', 'care-pathway', 'imported');

const API = (process.env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.env.GALLERY_LOGIN_EMAIL ?? 'admin@careadmin.local';
const PASSWORD = process.env.GALLERY_LOGIN_PASSWORD ?? 'Admin@12345';

function slugFromName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}`);
  const json = await res.json();
  const token = json?.data?.accessToken;
  if (!token) throw new Error('Login response missing accessToken');
  return token;
}

async function fetchAllStandard(token) {
  const all = [];
  let page = 1;
  const limit = 100;
  while (true) {
    const res = await fetch(
      `${API}/picture-gallery/standard?page=${page}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`Gallery list failed: HTTP ${res.status}`);
    const json = await res.json();
    const rows = json?.data ?? [];
    all.push(...rows);
    const total = json?.meta?.total ?? rows.length;
    if (page * limit >= total || rows.length === 0) break;
    page += 1;
  }
  return all;
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = res.body;
  if (!body) throw new Error('Empty body');
  await pipeline(body, createWriteStream(dest));
}

async function main() {
  const token = await login();
  const rows = await fetchAllStandard(token);
  const remote = rows.filter((r) => /^https?:\/\//i.test(r.fileUrl));
  console.log(`Fetched ${rows.length} standard picture(s); ${remote.length} remote URL(s).`);

  if (!remote.length) {
    console.log('No remote URLs in API — gallery already uses local /uploads paths.');
    console.log('If you have legacy img src URLs, paste them into gallery-legacy-urls.txt and run:');
    console.log('  npm run import:gallery-urls && npm run prisma:seed');
    return;
  }

  const order = existsSync(orderFile) ? JSON.parse(readFileSync(orderFile, 'utf8')) : [];
  const orderByName = new Map(order.map((r, i) => [r.name.toLowerCase(), { ...r, index: i }]));
  mkdirSync(uploadDir, { recursive: true });

  const lines = [];
  let ok = 0;
  for (const row of remote) {
    const slug = orderByName.get(row.name.toLowerCase())?.slug ?? slugFromName(row.name);
    const dest = join(uploadDir, `${slug}.png`);
    try {
      await download(row.fileUrl, dest);
      lines.push(`${row.name}|${row.fileUrl}`);
      console.log(`OK  ${row.name}`);
      ok += 1;
    } catch (e) {
      console.warn(`FAIL ${row.name}: ${e.message}`);
    }
  }

  if (lines.length) {
    writeFileSync(urlsFile, `${lines.join('\n')}\n`, 'utf8');
    console.log(`Wrote ${lines.length} line(s) to ${urlsFile} (${ok} downloaded).`);
    console.log('Run: npm run prisma:seed');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
