import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname } from 'path';
import { uploadPath } from '../common/utils/upload-path.util';

const UPLOAD_SEGMENTS = ['service-users', 'initial-assessments'] as const;

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_MIME = new Set(['application/pdf', ...IMAGE_MIME]);

export function initialAssessmentUploadRoot(submissionId: string) {
  return uploadPath(...UPLOAD_SEGMENTS, submissionId);
}

/**
 * Recorded conversations and their transcripts. Kept apart from the other attachments because this
 * folder is never served as static files (see main.ts): only the permission-checked endpoint reads it.
 */
export const IA_CONVERSATION_UPLOAD_SEGMENT = 'initial-assessment-conversations';

export function initialAssessmentConversationRoot(submissionId: string) {
  const root = uploadPath(IA_CONVERSATION_UPLOAD_SEGMENT, submissionId);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

export function initialAssessmentUploadMaxBytes() {
  const explicit = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 0);
  if (explicit > 0) return explicit;
  const mb = Number(process.env.MAX_UPLOAD_FILE_SIZE_MB ?? 10);
  return (Number.isFinite(mb) ? mb : 10) * 1024 * 1024;
}

export function initialAssessmentFilePublicUrl(submissionId: string, fileName: string) {
  return `/uploads/${UPLOAD_SEGMENTS.join('/')}/${submissionId}/${fileName}`;
}

export function ensureInitialAssessmentUploadDir(submissionId: string) {
  const root = initialAssessmentUploadRoot(submissionId);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

export function initialAssessmentUploadMulterOptions(submissionId: string) {
  return {
    storage: diskStorage({
      destination: (_req: unknown, _file: Express.Multer.File, cb: (e: Error | null, dest: string) => void) => {
        cb(null, ensureInitialAssessmentUploadDir(submissionId));
      },
      filename: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, name: string) => void) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `ia-${unique}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: initialAssessmentUploadMaxBytes() },
    fileFilter: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, ok: boolean) => void) => {
      if (!DOCUMENT_MIME.has(file.mimetype)) {
        cb(new BadRequestException('Allowed: JPEG, PNG, WebP, PDF.'), false);
        return;
      }
      cb(null, true);
    },
  };
}

export function initialAssessmentUploadMulterOptionsFromRequest() {
  return {
    storage: diskStorage({
      destination: (req: { params?: { submissionId?: string } }, _file: Express.Multer.File, cb: (e: Error | null, dest: string) => void) => {
        const submissionId = req.params?.submissionId;
        if (!submissionId) {
          cb(new BadRequestException('submissionId is required'), '');
          return;
        }
        cb(null, ensureInitialAssessmentUploadDir(submissionId));
      },
      filename: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, name: string) => void) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `ia-${unique}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: initialAssessmentUploadMaxBytes() },
    fileFilter: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, ok: boolean) => void) => {
      if (!DOCUMENT_MIME.has(file.mimetype)) {
        cb(new BadRequestException('Allowed: JPEG, PNG, WebP, PDF.'), false);
        return;
      }
      cb(null, true);
    },
  };
}

export function isImageMime(mimeType: string) {
  return IMAGE_MIME.has(mimeType);
}
