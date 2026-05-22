import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const PALETTE = [
  '#0ea5e9',
  '#14b8a6',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#22c55e',
  '#ef4444',
  '#6366f1',
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colorForSlug(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h + slug.charCodeAt(i) * 13) % PALETTE.length;
  return PALETTE[h]!;
}

/** Simple vector glyph inside the tile (white on coloured background). */
function glyphForSlug(slug: string): string {
  const s = slug.toLowerCase();
  if (s.includes('medication') || s.includes('pill')) {
    return '<rect x="22" y="26" width="28" height="20" rx="10" fill="#fff"/><line x1="30" y1="36" x2="42" y2="36" stroke="#0ea5e9" stroke-width="3" stroke-linecap="round"/>';
  }
  if (s.includes('continence') || s.includes('drink')) {
    return '<path d="M36 18c-8 12-14 18-14 26a14 14 0 0 0 28 0c0-8-6-14-14-26z" fill="#fff"/>';
  }
  if (s.includes('infection') || s.includes('health')) {
    return '<circle cx="36" cy="36" r="14" fill="#fff"/><path d="M36 28v16M28 36h16" stroke="#0ea5e9" stroke-width="3" stroke-linecap="round"/>';
  }
  if (s.includes('pain') || s.includes('pressure')) {
    return '<path d="M36 20l4 10h10l-8 6 3 10-9-6-9 6 3-10-8-6h10z" fill="#fff"/>';
  }
  if (s.includes('mobility') || s.includes('exercise') || s.includes('physio')) {
    return '<circle cx="28" cy="46" r="6" fill="#fff"/><circle cx="44" cy="46" r="6" fill="#fff"/><path d="M28 46h16M34 30l6 8" stroke="#fff" stroke-width="4" stroke-linecap="round"/>';
  }
  if (s.includes('bed') || s.includes('sleep') || s.includes('palliative')) {
    return '<path d="M14 44h44v8H14zM20 36h18v8H20zM42 32h12v12H42z" fill="#fff"/>';
  }
  if (s.includes('home') || s.includes('care')) {
    return '<path d="M36 16L14 34v22h44V34L36 16z" fill="#fff"/><rect x="30" y="38" width="12" height="18" fill="#0ea5e9"/>';
  }
  if (s.includes('food') || s.includes('cook') || s.includes('lunch') || s.includes('breakfast') || s.includes('nutrition')) {
    return '<ellipse cx="36" cy="40" rx="18" ry="10" fill="#fff"/><path d="M22 40h28" stroke="#0ea5e9" stroke-width="2"/>';
  }
  if (s.includes('psycholog') || s.includes('culture') || s.includes('religion')) {
    return '<circle cx="36" cy="30" r="10" fill="#fff"/><path d="M20 52c4-10 12-14 16-14s12 4 16 14" fill="#fff"/>';
  }
  if (s.includes('family') || s.includes('carer') || s.includes('social') || s.includes('activit')) {
    return '<circle cx="28" cy="32" r="7" fill="#fff"/><circle cx="44" cy="32" r="7" fill="#fff"/><path d="M18 54c6-8 14-12 18-12s12 4 18 12" fill="#fff"/>';
  }
  if (s.includes('doctor') || s.includes('hearing') || s.includes('arm')) {
    return '<rect x="30" y="22" width="12" height="28" rx="3" fill="#fff"/><circle cx="36" cy="18" r="6" fill="#fff"/>';
  }
  // Default: care clipboard
  return '<rect x="22" y="18" width="28" height="36" rx="4" fill="#fff"/><path d="M28 28h16M28 36h12M28 44h14" stroke="#0ea5e9" stroke-width="2.5" stroke-linecap="round"/>';
}

export function buildStandardIconSvg(displayName: string, slug: string): string {
  const color = colorForSlug(slug);
  const glyph = glyphForSlug(slug);
  const label = escapeXml(displayName);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" role="img" aria-label="${label}">
  <rect width="72" height="72" rx="12" fill="${color}"/>
  <g>${glyph}</g>
</svg>`;
}

export function standardIconUploadDir(): string {
  const base = process.env.UPLOAD_BASE_PATH ?? 'uploads';
  return join(process.cwd(), base, 'care-pathway', 'standard');
}

/** Write SVG files for gallery / form icons (idempotent). */
export function ensureStandardIconFiles(
  names: string[],
  slugFn: (name: string) => string,
): void {
  const dir = standardIconUploadDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  for (const name of names) {
    const slug = slugFn(name);
    writeStandardIconFile(slug, name);
  }
}

export function writeStandardIconFile(slug: string, displayName: string): void {
  const dir = standardIconUploadDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${slug}.svg`);
  writeFileSync(filePath, buildStandardIconSvg(displayName, slug), 'utf8');
}
