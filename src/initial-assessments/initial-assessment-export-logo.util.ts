import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

async function readUploadAsDataUri(relativeUrl: string | null | undefined): Promise<string | null> {
  const raw = relativeUrl?.trim();
  if (!raw) return null;
  if (/^data:/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return null;

  const pathPart = raw.startsWith('/') ? raw.slice(1) : raw;
  if (!pathPart.startsWith('uploads/')) return null;

  const localPath = join(process.cwd(), pathPart);
  if (!existsSync(localPath)) return null;

  const ext = extname(localPath).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) return null;

  try {
    const buf = await readFile(localPath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Inline organisation logo for self-contained HTML exports (iframe preview, offline save). */
export async function embedOrganisationLogoForExport(
  ...urls: (string | null | undefined)[]
): Promise<string | null> {
  for (const url of urls) {
    const dataUri = await readUploadAsDataUri(url);
    if (dataUri) return dataUri;
  }
  return null;
}
