import { createHmac, timingSafeEqual } from 'crypto';
import * as path from 'path';

/** Private storage root for body map videos — never under the public /uploads mount. */
export const BODY_MAP_VIDEO_STORAGE_DIR = path.join('storage', 'body-map-videos');
/** Multer writes here first; files are moved into place only after validation. */
export const BODY_MAP_VIDEO_INCOMING_DIR = path.join(BODY_MAP_VIDEO_STORAGE_DIR, '_incoming');

export const BODY_MAP_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const BODY_MAP_VIDEO_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
/** 60 s limit plus slack — camera apps stop a little after the limit. */
export const BODY_MAP_VIDEO_MAX_DURATION_MS = 62_000;
export const BODY_MAP_VIDEOS_PER_RECORD = 1;
/** Admin links to the files are signed and expire after this long. */
export const BODY_MAP_VIDEO_URL_TTL_MS = 60 * 60 * 1000;

export type BodyMapVideoFileKind = 'video' | 'thumbnail';

export type BodyMapVideoApi = {
  id: string;
  originalName: string | null;
  mimeType: string;
  fileSize: number;
  durationMs: number | null;
  source: string | null;
  createdAt: string;
  videoUrl: string;
  thumbnailUrl: string | null;
};

/** MP4 / MOV / 3GP all start with an ISO-BMFF `ftyp` box. */
export function detectVideoFormat(head: Buffer | undefined): { mimeType: string; ext: string } | null {
  if (!head || head.length < 12) return null;
  if (head.toString('latin1', 4, 8) !== 'ftyp') return null;
  const brand = head.toString('latin1', 8, 12);
  if (brand === 'qt  ') return { mimeType: 'video/quicktime', ext: '.mov' };
  if (brand.startsWith('3g')) return { mimeType: 'video/3gpp', ext: '.3gp' };
  return { mimeType: 'video/mp4', ext: '.mp4' };
}

export function detectThumbnailFormat(head: Buffer | undefined): { mimeType: string; ext: string } | null {
  if (!head || head.length < 8) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mimeType: 'image/jpeg', ext: '.jpg' };
  if (head.toString('latin1', 1, 4) === 'PNG') return { mimeType: 'image/png', ext: '.png' };
  return null;
}

/** Keeps a display name safe for headers / UI: no path parts or control chars, max 200 chars. */
export function sanitizeVideoOriginalName(raw: string | undefined | null): string | null {
  const base = String(raw ?? '')
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return base ? base.slice(0, 200) : null;
}

/** Absolute path for a stored relative path, or null when it escapes the private root. */
export function resolveBodyMapVideoAbsolutePath(storagePath: string): string | null {
  const root = path.resolve(process.cwd(), BODY_MAP_VIDEO_STORAGE_DIR);
  const abs = path.resolve(process.cwd(), storagePath);
  return abs.startsWith(root + path.sep) ? abs : null;
}

function signingKey(): string {
  const secret = process.env.JWT_ACCESS_TOKEN_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_TOKEN_SECRET is not set');
  return `body-map-video:${secret}`;
}

function signature(videoId: string, kind: BodyMapVideoFileKind, exp: number): string {
  return createHmac('sha256', signingKey()).update(`${videoId}:${kind}:${exp}`).digest('base64url');
}

/** Short-lived link the admin can put straight into <video src> / <img src> (supports Range). */
export function signedBodyMapVideoUrl(
  videoId: string,
  kind: BodyMapVideoFileKind,
  now = Date.now(),
): string {
  // Round expiry up to the next 10 min so repeated reads give a stable URL (browser cache).
  const step = 10 * 60 * 1000;
  const exp = Math.ceil((now + BODY_MAP_VIDEO_URL_TTL_MS) / step) * step;
  return `/body-map/videos/${videoId}/${kind}?exp=${exp}&sig=${signature(videoId, kind, exp)}`;
}

export function verifyBodyMapVideoSignature(
  videoId: string,
  kind: BodyMapVideoFileKind,
  expRaw: string | undefined,
  sig: string | undefined,
  now = Date.now(),
): boolean {
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < now || !sig) return false;
  const expected = Buffer.from(signature(videoId, kind, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function mapBodyMapVideo(row: {
  id: string;
  originalName: string | null;
  mimeType: string;
  fileSize: number;
  durationMs: number | null;
  source: string | null;
  thumbnailPath: string | null;
  createdAt: Date;
}): BodyMapVideoApi {
  return {
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    durationMs: row.durationMs,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    videoUrl: signedBodyMapVideoUrl(row.id, 'video'),
    thumbnailUrl: row.thumbnailPath ? signedBodyMapVideoUrl(row.id, 'thumbnail') : null,
  };
}
