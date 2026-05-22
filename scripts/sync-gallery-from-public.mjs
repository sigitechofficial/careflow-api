/**
 * Copy Figma standard icons from care-admin/public into backend uploads.
 * Run: node scripts/sync-gallery-from-public.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..');
const srcDir = join(backendRoot, '..', 'care-admin', 'public', 'care-plan-icons', 'standard');
const destDir = join(backendRoot, 'uploads', 'care-pathway', 'standard');

if (!existsSync(srcDir)) {
  console.error(`Source not found: ${srcDir}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
const files = readdirSync(srcDir).filter((f) => f.endsWith('.svg'));
let copied = 0;
for (const file of files) {
  copyFileSync(join(srcDir, file), join(destDir, file));
  copied += 1;
}
console.log(`Synced ${copied} SVG(s) to uploads/care-pathway/standard/`);
