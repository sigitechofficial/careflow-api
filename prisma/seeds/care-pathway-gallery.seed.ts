import { CarePictureType, PrismaClient } from '@prisma/client';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ensureStandardIconFiles,
  standardIconUploadDir,
  writeStandardIconFile,
} from './care-pathway-icon-svg.util';

export type GalleryIconSeed = { name: string; slug: string; category?: string };

/** Core gallery tiles (legacy LogiCare standard set). */
export const CORE_GALLERY_ICONS: GalleryIconSeed[] = [
  { name: 'Access', slug: 'access' },
  { name: 'Action', slug: 'action' },
  { name: 'Activities', slug: 'activities' },
  { name: 'Afternoon', slug: 'afternoon' },
  { name: 'Arm', slug: 'arm' },
  { name: 'Bath', slug: 'bath' },
  { name: 'Bed', slug: 'bed' },
  { name: 'Breakfast', slug: 'breakfast' },
  { name: 'Care at home', slug: 'care-at-home' },
  { name: 'Care plan', slug: 'care-plan' },
  { name: 'Carer', slug: 'carer' },
  { name: 'Continence', slug: 'continence' },
  { name: 'Cooking', slug: 'cooking' },
  { name: 'Culture', slug: 'culture' },
  { name: 'Doctor', slug: 'doctor' },
  { name: 'Drinks', slug: 'drinks' },
  { name: 'Exercise', slug: 'exercise' },
  { name: 'Family care', slug: 'family-care' },
  { name: 'Health', slug: 'health' },
  { name: 'Hearing', slug: 'hearing' },
  { name: 'Home', slug: 'home' },
  { name: 'Hygiene', slug: 'hygiene' },
  { name: 'Infection', slug: 'infection' },
  { name: 'Lunch', slug: 'lunch' },
  { name: 'Medication', slug: 'medication' },
  { name: 'Mobility', slug: 'mobility' },
  { name: 'Morning', slug: 'morning' },
  { name: 'Pain', slug: 'pain' },
  { name: 'Palliative', slug: 'palliative' },
  { name: 'Personal-washing', slug: 'personal-washing' },
  { name: 'Pets', slug: 'pets' },
  { name: 'Physiotherapy', slug: 'physiotherapy' },
  { name: 'Pressure-ulcer', slug: 'pressure-ulcer' },
  { name: 'Privacy', slug: 'privacy' },
  { name: 'Psychology', slug: 'psychology' },
  { name: 'Religion', slug: 'religion' },
];

/** Pathway checklist / action icons shown in legacy gallery grids. */
export const PATHWAY_GALLERY_ICONS: GalleryIconSeed[] = [
  { name: 'Final Days', slug: 'final-days', category: 'Checklists' },
  { name: 'Home First Checklist', slug: 'home-first', category: 'Checklists' },
  { name: 'Maintenance Checks', slug: 'maintenance', category: 'Checklists' },
  { name: 'Meal', slug: 'meal', category: 'Checklists' },
  { name: 'Mouth Care', slug: 'mouth-care', category: 'Checklists' },
  { name: 'Night Duties', slug: 'night-duties', category: 'Checklists' },
  { name: 'Nutrition', slug: 'nutrition', category: 'Checklists' },
  { name: 'Personal Care', slug: 'personal-care', category: 'Checklists' },
  { name: 'Psychological', slug: 'psychological', category: 'Checklists' },
  { name: 'Skin Integrity', slug: 'skin', category: 'Checklists' },
  { name: 'Sleeping and Night', slug: 'sleep', category: 'Checklists' },
  { name: 'Social Activities', slug: 'social', category: 'Checklists' },
  { name: 'Out reach', slug: 'outreach', category: 'Actions' },
  { name: 'Laundry and cleaning', slug: 'laundry', category: 'Actions' },
  { name: 'Welfare Check', slug: 'welfare', category: 'Actions' },
  { name: 'Domestic Visit', slug: 'domestic', category: 'Actions' },
  { name: 'Tea Visit', slug: 'tea', category: 'Actions' },
  { name: 'AM Visit', slug: 'am', category: 'Actions' },
  { name: 'Visit Plan', slug: 'visit-plan', category: 'General' },
  { name: 'Observation', slug: 'observation', category: 'General' },
  { name: 'Absence', slug: 'absence', category: 'General' },
];

export const ALL_GALLERY_ICONS: GalleryIconSeed[] = [
  ...CORE_GALLERY_ICONS,
  ...PATHWAY_GALLERY_ICONS.filter(
    (extra) => !CORE_GALLERY_ICONS.some((c) => c.slug === extra.slug),
  ),
];

function repoRoot(): string {
  return join(__dirname, '..', '..', '..');
}

function careAdminStandardIconsDir(): string {
  return join(repoRoot(), 'care-admin', 'public', 'care-plan-icons', 'standard');
}

function importedIconsDir(): string {
  const base = process.env.UPLOAD_BASE_PATH ?? 'uploads';
  return join(process.cwd(), base, 'care-pathway', 'imported');
}

function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/** Prefer imported PNGs, then standard assets, then generated SVG. */
export function resolveGalleryPictureUrl(slug: string, displayName = slug): string {
  const standardDir = standardIconUploadDir();
  const importedDir = importedIconsDir();

  for (const dir of [importedDir, standardDir]) {
    const folder = dir.endsWith('imported') ? 'imported' : 'standard';
    for (const ext of ['.png', '.webp', '.jpg', '.jpeg', '.svg']) {
      const abs = join(dir, `${slug}${ext}`);
      if (existsSync(abs)) {
        return `/uploads/care-pathway/${folder}/${slug}${ext}`;
      }
    }
  }

  const generated = join(standardDir, `${slug}.svg`);
  if (!existsSync(generated)) {
    writeStandardIconFile(slug, displayName);
  }
  return `/uploads/care-pathway/standard/${slug}.svg`;
}

function resolveIconFile(slug: string, displayName: string): { fileUrl: string; absPath: string } {
  const fileUrl = resolveGalleryPictureUrl(slug, displayName);
  const absPath = join(process.cwd(), fileUrl.replace(/^\//, ''));
  return { fileUrl, absPath };
}

/** Copy Figma / frontend standard SVGs into backend uploads when present. */
export function syncCareAdminStandardIconsToUploads(): number {
  const srcDir = careAdminStandardIconsDir();
  if (!existsSync(srcDir)) return 0;

  const destDir = standardIconUploadDir();
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  let copied = 0;
  for (const file of readdirSync(srcDir)) {
    if (!file.endsWith('.svg')) continue;
    const from = join(srcDir, file);
    const to = join(destDir, file);
    copyFileSync(from, to);
    copied += 1;
  }
  return copied;
}

type ImportMapRow = { slug: string; name: string; fileUrl: string };

function loadImportedGalleryIcons(): GalleryIconSeed[] {
  const mapFile = join(__dirname, 'data', 'gallery-import-map.json');
  if (!existsSync(mapFile)) return [];
  const rows = JSON.parse(readFileSync(mapFile, 'utf8')) as ImportMapRow[];
  return rows
    .filter((r) => r.slug && r.fileUrl)
    .map((r) => ({ name: r.name, slug: r.slug, category: 'General' }));
}

/** Imported PNG map (gallery-images) plus pathway icons not covered by the map. */
function buildGalleryIconList(): GalleryIconSeed[] {
  const imported = loadImportedGalleryIcons();
  if (!imported.length) return ALL_GALLERY_ICONS;
  const importedSlugs = new Set(imported.map((i) => i.slug));
  const pathwayExtras = ALL_GALLERY_ICONS.filter((i) => !importedSlugs.has(i.slug));
  return [...imported, ...pathwayExtras];
}

export async function seedCarePictureGallery(prisma: PrismaClient): Promise<void> {
  syncCareAdminStandardIconsToUploads();

  const galleryIcons = buildGalleryIconList();

  const names = galleryIcons.map((i) => i.name);
  ensureStandardIconFiles(names, slugFromName);

  for (const icon of galleryIcons) {
    const slug = icon.slug || slugFromName(icon.name);
    const { fileUrl } = resolveIconFile(slug, icon.name);

    const existing = await prisma.carePicture.findFirst({
      where: {
        type: CarePictureType.STANDARD,
        deletedAt: null,
        OR: [{ name: icon.name }, { fileUrl: { endsWith: `/${slug}.png` } }],
      },
    });

    if (existing) {
      const legacyRemote = /^https?:\/\//i.test(existing.fileUrl);
      if (legacyRemote || existing.fileUrl !== fileUrl || existing.name !== icon.name) {
        await prisma.carePicture.update({
          where: { id: existing.id },
          data: {
            name: icon.name,
            fileUrl,
            isStandard: true,
            category: icon.category ?? existing.category ?? 'General',
          },
        });
      }
      continue;
    }

    await prisma.carePicture.create({
      data: {
        name: icon.name,
        type: CarePictureType.STANDARD,
        fileUrl,
        isStandard: true,
        category: icon.category ?? 'General',
      },
    });
  }
}

