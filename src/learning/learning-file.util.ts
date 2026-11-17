import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { extname, posix, relative, resolve, sep } from 'path';
import { BadRequestException } from '@nestjs/common';
import { LearningContentType } from '@prisma/client';
import { sanitizeOriginalFilename } from '../policies/policy-upload.util';

/**
 * Lesson files (images, PDF, Word). Kept OUTSIDE the public uploads folder
 * (storage/learning-files) and served only through short-lived HMAC-signed links,
 * the same way body map videos are. Type is checked from the extension, the declared
 * type and the file's first bytes. Agreed types: PDF, DOCX, JPG/JPEG, PNG.
 */
export const LEARNING_FILE_STORAGE_DIR = posix.join(
  'storage',
  'learning-files',
);
const LINK_TTL_MS = 30 * 60 * 1000;

/** Same limit as other uploads (UPLOAD_MAX_FILE_SIZE_BYTES, 10 MB when not set). */
export function learningFileMaxBytes(): number {
  const n = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 10 * 1024 * 1024;
}

const TYPES: Record<
  string,
  {
    mime: string;
    kind: 'IMAGE' | 'PDF' | 'DOCUMENT';
    magic: (b: Buffer) => boolean;
  }
> = {
  '.pdf': {
    mime: 'application/pdf',
    kind: 'PDF',
    magic: (b) => b.subarray(0, 4).toString('latin1') === '%PDF',
  },
  '.docx': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'DOCUMENT',
    magic: (b) =>
      b.length >= 4 &&
      b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  },
  '.png': {
    mime: 'image/png',
    kind: 'IMAGE',
    magic: (b) =>
      b.length >= 8 &&
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  '.jpg': {
    mime: 'image/jpeg',
    kind: 'IMAGE',
    magic: (b) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  '.jpeg': {
    mime: 'image/jpeg',
    kind: 'IMAGE',
    magic: (b) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
};

export const LEARNING_FILE_EXTENSIONS = Object.keys(TYPES);

export type CheckedLearningFile = {
  originalName: string;
  mime: string;
  ext: string;
  kind: 'IMAGE' | 'PDF' | 'DOCUMENT';
  buffer: Buffer;
};

export function assertLearningFileUpload(
  file:
    | {
        originalname?: string;
        mimetype?: string;
        size?: number;
        buffer?: Buffer;
      }
    | undefined
    | null,
): CheckedLearningFile {
  if (!file || !file.buffer)
    throw new BadRequestException('Choose a file to upload');
  if (!file.size || file.size <= 0 || file.buffer.length === 0)
    throw new BadRequestException('The file is empty');
  const max = learningFileMaxBytes();
  if (file.size > max || file.buffer.length > max) {
    throw new BadRequestException(
      `Files can be at most ${Math.round(max / (1024 * 1024))} MB`,
    );
  }
  const originalName = sanitizeOriginalFilename(file.originalname ?? '');
  const ext = extname(originalName).toLowerCase();
  const type = TYPES[ext];
  const mime = (file.mimetype ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (!type || mime !== type.mime) {
    throw new BadRequestException(
      'Upload a PDF, a Word (.docx) document, or a JPG or PNG image',
    );
  }
  if (!type.magic(file.buffer))
    throw new BadRequestException('The file does not match its type');
  return {
    originalName,
    mime: type.mime,
    ext,
    kind: type.kind,
    buffer: file.buffer,
  };
}

/** Which lesson types a stored file can be used for. */
export function fileFitsContentType(
  mime: string,
  contentType: LearningContentType,
): boolean {
  const kind = Object.values(TYPES).find((t) => t.mime === mime)?.kind;
  if (!kind) return false;
  if (contentType === LearningContentType.IMAGE) return kind === 'IMAGE';
  if (contentType === LearningContentType.PDF) return kind === 'PDF';
  if (contentType === LearningContentType.DOCUMENT)
    return kind === 'DOCUMENT' || kind === 'PDF';
  return false;
}

export function newLearningFileStoragePath(ext: string): string {
  return posix.join(LEARNING_FILE_STORAGE_DIR, `${randomUUID()}${ext}`);
}

/** Absolute path for a stored relative path, or null when it would leave the storage folder. */
export function resolveLearningFilePath(storagePath: string): string | null {
  if (!storagePath || storagePath.includes('\0')) return null;
  const root = resolve(process.cwd(), LEARNING_FILE_STORAGE_DIR);
  const abs = resolve(process.cwd(), storagePath);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || rel.split(sep).includes('..'))
    return null;
  return abs;
}

function signingKey(): string {
  const secret = process.env.JWT_ACCESS_TOKEN_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_TOKEN_SECRET is not set');
  return `learning-file:${secret}`;
}

function signature(fileId: string, exp: number): string {
  return createHmac('sha256', signingKey())
    .update(`${fileId}:${exp}`)
    .digest('base64url');
}

/** Short-lived link for <img src> / a PDF tab. Expiry rounded so repeated reads give the same URL. */
export function signedLearningFileUrl(
  fileId: string,
  now = Date.now(),
): string {
  const step = 10 * 60 * 1000;
  const exp = Math.ceil((now + LINK_TTL_MS) / step) * step;
  return `/learning/files/${fileId}?exp=${exp}&sig=${signature(fileId, exp)}`;
}

export function verifyLearningFileSignature(
  fileId: string,
  expRaw: string | undefined,
  sig: string | undefined,
  now = Date.now(),
): boolean {
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < now || !sig) return false;
  const expected = Buffer.from(signature(fileId, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Video lessons are links only (https), e.g. YouTube unlisted, Vimeo, SharePoint. */
export function isHttpsUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const p = new URL(value).protocol;
    return p === 'https:' || p === 'http:';
  } catch {
    return false;
  }
}

/** Short-lived signed link to a certificate PDF (app browser / admin tab cannot send a bearer token). */
export function signedCertificatePdfUrl(certificateId: string, now = Date.now()): string {
  const step = 10 * 60 * 1000;
  const exp = Math.ceil((now + LINK_TTL_MS) / step) * step;
  return `/learning/certificate-pdf/${certificateId}?exp=${exp}&sig=${signature(`certificate:${certificateId}`, exp)}`;
}

export function verifyCertificatePdfSignature(
  certificateId: string,
  expRaw: string | undefined,
  sig: string | undefined,
  now = Date.now(),
): boolean {
  return verifyLearningFileSignature(`certificate:${certificateId}`, expRaw, sig, now);
}
