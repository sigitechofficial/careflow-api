import { randomUUID } from 'crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, extname, join, posix, relative, resolve, sep } from 'path';
import { BadRequestException } from '@nestjs/common';

export const POLICY_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export const POLICY_UPLOAD_MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': POLICY_UPLOAD_MIME.pdf,
  '.doc': POLICY_UPLOAD_MIME.doc,
  '.docx': POLICY_UPLOAD_MIME.docx,
};

const PDF_MAGIC = Buffer.from('%PDF');
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export type PolicyUploadKind = {
  ext: '.pdf' | '.doc' | '.docx';
  mime: string;
};

export function policyUploadRoot(): string {
  return join(
    process.cwd(),
    process.env.UPLOAD_BASE_PATH ?? 'uploads',
    'policies',
  );
}

export function policyUploadMulterOptions() {
  return {
    limits: { fileSize: POLICY_UPLOAD_MAX_BYTES, files: 1 },
  };
}

export function sanitizeOriginalFilename(originalName: string): string {
  const base = originalName.replace(/\\/g, '/').split('/').pop() ?? 'document';
  const cleaned = base
    .replace(/[<>:"|?*]/g, '_')
    .split('')
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim();
  const sliced = cleaned.slice(0, 200);
  return sliced || 'document';
}

export function newPolicyStorageRelativePath(
  documentId: string,
  versionId: string,
  ext: string,
): string {
  return posix.join(documentId, versionId, `${randomUUID()}${ext}`);
}

export function resolveSafePolicyPath(relativePath: string): string {
  if (!relativePath || relativePath.includes('\0')) {
    throw new BadRequestException('Invalid storage path');
  }
  const root = resolve(policyUploadRoot());
  const absolute = resolve(root, relativePath);
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || rel === '..' || absolute === root) {
    throw new BadRequestException('Invalid storage path');
  }
  if (rel.split(sep).some((part) => part === '..')) {
    throw new BadRequestException('Invalid storage path');
  }
  return absolute;
}

export function writeStoredPolicyFile(
  relativePath: string,
  buffer: Buffer,
): string {
  const absolute = resolveSafePolicyPath(relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, buffer);
  return absolute;
}

export function copyStoredPolicyFile(
  fromRelative: string,
  toRelative: string,
): void {
  const fromAbs = resolveSafePolicyPath(fromRelative);
  const toAbs = resolveSafePolicyPath(toRelative);
  if (!existsSync(fromAbs)) {
    throw new BadRequestException('Source document file is missing');
  }
  mkdirSync(dirname(toAbs), { recursive: true });
  copyFileSync(fromAbs, toAbs);
}

export function deleteStoredPolicyFile(
  relativePath: string | null | undefined,
): void {
  if (!relativePath) return;
  try {
    const absolute = resolveSafePolicyPath(relativePath);
    if (existsSync(absolute)) unlinkSync(absolute);
  } catch {
    // Never fail a draft mutation because an orphan file could not be removed.
  }
}

function assertSafeStorageSegment(value: string): void {
  if (
    !value ||
    value.includes('\0') ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('..') ||
    value === '.' ||
    value === '..'
  ) {
    throw new BadRequestException('Invalid storage path');
  }
}

export function policyStoragePathBelongsToVersion(
  relativePath: string | null | undefined,
  documentId: string,
  versionId: string,
): boolean {
  if (!relativePath) return false;
  const normalised = relativePath.replace(/\\/g, '/');
  if (normalised.includes('\0') || normalised.split('/').includes('..')) {
    return false;
  }
  const expectedPrefix = `${documentId}/${versionId}/`;
  return normalised.startsWith(expectedPrefix) && normalised.length > expectedPrefix.length;
}

export function deletePolicyVersionUploadDir(
  documentId: string,
  versionId: string,
): void {
  assertSafeStorageSegment(documentId);
  assertSafeStorageSegment(versionId);
  const root = resolve(policyUploadRoot());
  const absolute = resolve(root, documentId, versionId);
  const rel = relative(root, absolute);
  if (
    rel.startsWith('..') ||
    rel === '..' ||
    rel.split(sep).some((part) => part === '..') ||
    !rel.startsWith(documentId)
  ) {
    throw new BadRequestException('Invalid storage path');
  }
  if (existsSync(absolute)) {
    rmSync(absolute, { recursive: true, force: true });
  }
  const documentDir = resolve(root, documentId);
  const documentRel = relative(root, documentDir);
  if (
    documentRel.startsWith('..') ||
    documentRel === '..' ||
    documentRel.split(sep).some((part) => part === '..')
  ) {
    return;
  }
  if (existsSync(documentDir)) {
    try {
      rmdirSync(documentDir);
    } catch {
      // Directory still contains other version folders.
    }
  }
}

export function contentDisposition(fileName: string, inline: boolean): string {
  const fallback = sanitizeOriginalFilename(fileName).replace(/"/g, '');
  const encoded = encodeURIComponent(fileName);
  const kind = inline ? 'inline' : 'attachment';
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function assertPolicyUploadFile(
  file:
    | {
        originalname?: string;
        mimetype?: string;
        size?: number;
        buffer?: Buffer;
      }
    | undefined
    | null,
): { kind: PolicyUploadKind; originalName: string; buffer: Buffer } {
  if (!file || !file.buffer) {
    throw new BadRequestException('Malformed file');
  }
  if (!file.size || file.size <= 0 || file.buffer.length === 0) {
    throw new BadRequestException('Empty file');
  }
  if (
    file.size > POLICY_UPLOAD_MAX_BYTES ||
    file.buffer.length > POLICY_UPLOAD_MAX_BYTES
  ) {
    throw new BadRequestException('File too large');
  }

  const originalName = sanitizeOriginalFilename(file.originalname ?? '');
  const ext = extname(originalName).toLowerCase();
  const expectedMime = MIME_BY_EXT[ext];
  if (!expectedMime) {
    throw new BadRequestException('Unsupported file type');
  }

  const mime = (file.mimetype ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (mime !== expectedMime) {
    throw new BadRequestException('Unsupported file type');
  }

  if (!matchesMagic(file.buffer, ext)) {
    throw new BadRequestException('Malformed file');
  }

  return {
    kind: { ext: ext as PolicyUploadKind['ext'], mime: expectedMime },
    originalName,
    buffer: file.buffer,
  };
}

function matchesMagic(buffer: Buffer, ext: string): boolean {
  if (ext === '.pdf') return buffer.subarray(0, 4).equals(PDF_MAGIC);
  if (ext === '.doc')
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(OLE_MAGIC);
  if (ext === '.docx')
    return buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP_MAGIC);
  return false;
}
