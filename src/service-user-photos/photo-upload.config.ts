import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';

export function photoUploadRoot() {
  return join(process.cwd(), process.env.UPLOAD_BASE_PATH ?? 'uploads', 'service-users', 'photos');
}

export function photoMaxBytes() {
  const explicit = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 0);
  if (explicit > 0) return explicit;
  const mb = Number(process.env.MAX_UPLOAD_FILE_SIZE_MB ?? 10);
  return (Number.isFinite(mb) ? mb : 10) * 1024 * 1024;
}

export function ensurePhotoDir() {
  const root = photoUploadRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

export const serviceUserPhotoUploadOptions = {
  storage: diskStorage({
    destination: (_req: unknown, _file: unknown, cb: (err: Error | null, dest: string) => void) => {
      cb(null, ensurePhotoDir());
    },
    filename: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: photoMaxBytes() },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, ok: boolean) => void) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
};
