import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';

/** Attachments live outside any web-served static root — access is only via the
 *  authenticated, permission-checked download endpoint. */
export function incidentAttachmentRoot() {
  return join(
    process.cwd(),
    process.env.UPLOAD_BASE_PATH ?? 'uploads',
    'incidents',
    'attachments',
  );
}

export function incidentAttachmentMaxBytes() {
  const explicit = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 0);
  if (explicit > 0) return explicit;
  const mb = Number(process.env.MAX_UPLOAD_FILE_SIZE_MB ?? 15);
  return (Number.isFinite(mb) ? mb : 15) * 1024 * 1024;
}

export function ensureIncidentAttachmentDir() {
  const root = incidentAttachmentRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
];

export const incidentAttachmentUploadOptions = {
  storage: diskStorage({
    destination: (
      _req: unknown,
      _file: unknown,
      cb: (err: Error | null, dest: string) => void,
    ) => {
      cb(null, ensureIncidentAttachmentDir());
    },
    filename: (
      _req: unknown,
      file: Express.Multer.File,
      cb: (err: Error | null, name: string) => void,
    ) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: incidentAttachmentMaxBytes() },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    cb: (err: Error | null, ok: boolean) => void,
  ) => {
    cb(null, ALLOWED_MIME.includes(file.mimetype));
  },
};
