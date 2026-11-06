import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, extname, posix, relative, resolve, sep } from 'path';
import { BadRequestException } from '@nestjs/common';
import { sanitizeOriginalFilename } from '../policies/policy-upload.util';
import { uploadPath } from '../common/utils/upload-path.util';

/**
 * Files kept with CQC evidence (meeting minutes, audit reports, photos of a notice board…).
 * Same pattern as policy documents: stored outside the public uploads route, under
 * uploads/cqc-evidence/<evidenceId>/<random>.<ext>, and downloaded only through the API with
 * cqc_evidence.read and branch scope. The type is checked from the extension, the declared type
 * and the file's first bytes.
 */
export const CQC_EVIDENCE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

const TYPES: Record<string, { mime: string; magic: (b: Buffer) => boolean }> = {
  '.pdf': { mime: 'application/pdf', magic: (b) => b.subarray(0, 4).toString('latin1') === '%PDF' },
  '.doc': {
    mime: 'application/msword',
    magic: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  },
  '.docx': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    magic: (b) => b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  },
  '.xlsx': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    magic: (b) => b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  },
  '.png': {
    mime: 'image/png',
    magic: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  '.jpg': { mime: 'image/jpeg', magic: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.jpeg': { mime: 'image/jpeg', magic: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
};

export const CQC_EVIDENCE_UPLOAD_EXTENSIONS = Object.keys(TYPES);

export function cqcEvidenceUploadRoot(): string {
  return uploadPath('cqc-evidence');
}

export function cqcEvidenceMulterOptions() {
  return { limits: { fileSize: CQC_EVIDENCE_UPLOAD_MAX_BYTES, files: 1 } };
}

export type CheckedUpload = { originalName: string; mime: string; ext: string; buffer: Buffer };

export function assertCqcEvidenceUpload(
  file: { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer } | undefined | null,
): CheckedUpload {
  if (!file || !file.buffer) throw new BadRequestException('Choose a file to upload');
  if (!file.size || file.size <= 0 || file.buffer.length === 0) throw new BadRequestException('The file is empty');
  if (file.size > CQC_EVIDENCE_UPLOAD_MAX_BYTES || file.buffer.length > CQC_EVIDENCE_UPLOAD_MAX_BYTES) {
    throw new BadRequestException('Files can be at most 25 MB');
  }
  const originalName = sanitizeOriginalFilename(file.originalname ?? '');
  const ext = extname(originalName).toLowerCase();
  const type = TYPES[ext];
  const mime = (file.mimetype ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (!type || mime !== type.mime) {
    throw new BadRequestException('Upload a PDF, Word or Excel document, or a PNG or JPEG image');
  }
  if (!type.magic(file.buffer)) throw new BadRequestException('The file does not match its type');
  return { originalName, mime: type.mime, ext, buffer: file.buffer };
}

export function newCqcEvidenceStoragePath(evidenceId: string, ext: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(evidenceId)) throw new BadRequestException('Invalid storage path');
  return posix.join(evidenceId, `${randomUUID()}${ext}`);
}

export function resolveSafeCqcEvidencePath(relativePath: string): string {
  if (!relativePath || relativePath.includes('\0')) throw new BadRequestException('Invalid storage path');
  const root = resolve(cqcEvidenceUploadRoot());
  const absolute = resolve(root, relativePath);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith('..') || rel.split(sep).includes('..')) throw new BadRequestException('Invalid storage path');
  return absolute;
}

export function writeCqcEvidenceFile(relativePath: string, buffer: Buffer): void {
  const absolute = resolveSafeCqcEvidencePath(relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, buffer);
}

export function deleteCqcEvidenceFile(relativePath: string | null | undefined): void {
  if (!relativePath) return;
  try {
    const absolute = resolveSafeCqcEvidencePath(relativePath);
    if (existsSync(absolute)) unlinkSync(absolute);
  } catch {
    // An orphan file never blocks removing the attachment record.
  }
}
