/**
 * Try common LogiCare / Azure blob bases for gallery PNGs.
 * Writes working URLs to prisma/seeds/data/gallery-legacy-urls.txt
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const order = JSON.parse(
  readFileSync(join(__dirname, '../prisma/seeds/data/gallery-order.json'), 'utf8'),
);

const bases = [
  'https://logicareprodnortheurop.blob.core.windows.net/careimages',
  'https://logicareprodnortheurop.blob.core.windows.net/CareImages',
  'https://logicareprodnortheurop.blob.core.windows.net/care-pathway',
  'https://logicareprodnortheurop.blob.core.windows.net/icons',
  'https://logiclea.blob.core.windows.net/careimages',
  'https://logiclea.blob.core.windows.net/CareImages',
  'https://logicare.blob.core.windows.net/careimages',
  'https://logicarestorage.blob.core.windows.net/careimages',
  'https://logicareprodnortheurop.blob.core.windows.net/carepictures',
];

function fileVariants(name) {
  const plain = name.replace(/\s+/g, '');
  const dash = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const under = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return [
    `${name}.png`,
    `${plain}.png`,
    `${dash}.png`,
    `${under}.png`,
    `${name}.jpg`,
    `${plain}.jpg`,
  ];
}

async function exists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  let bestBase = null;
  let hits = 0;

  for (const base of bases) {
    let ok = 0;
    for (const row of order.slice(0, 6)) {
      for (const file of fileVariants(row.name)) {
        const url = `${base}/${file}`;
        if (await exists(url)) {
          ok += 1;
          break;
        }
      }
    }
    console.log(`${base} -> ${ok}/6 probe hits`);
    if (ok > hits) {
      hits = ok;
      bestBase = base;
    }
  }

  if (!bestBase || hits < 2) {
    console.log('\nNo public blob base found. Paste full URLs into gallery-legacy-urls.txt');
    process.exit(1);
  }

  console.log(`\nUsing base: ${bestBase}`);
  const lines = [];
  for (const row of order) {
    let found = null;
    for (const file of fileVariants(row.name)) {
      const url = `${bestBase}/${file}`;
      if (await exists(url)) {
        found = url;
        break;
      }
    }
    if (found) lines.push(`${row.name}|${found}`);
    else console.warn(`MISS ${row.name}`);
  }

  const out = join(__dirname, '../prisma/seeds/data/gallery-legacy-urls.txt');
  writeFileSync(out, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${lines.length} URLs to ${out}`);
}

main();
