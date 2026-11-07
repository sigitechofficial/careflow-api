import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { incidentAttachmentMaxBytes } from '../incidents/incident-attachment.config';
import { uploadPath } from '../common/utils/upload-path.util';

/** Pathway documents live under uploads/specialist-pathways, which main.ts blocks from static serving —
 *  access is only via the authenticated, branch-scoped download endpoint. */
export function pathwayDocumentRoot() {
  return uploadPath('specialist-pathways', 'documents');
}

export const PATHWAY_DOCUMENT_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export const pathwayDocumentUploadOptions = {
  storage: diskStorage({
    destination: (_req: unknown, _file: unknown, cb: (err: Error | null, dest: string) => void) => {
      const root = pathwayDocumentRoot();
      if (!existsSync(root)) mkdirSync(root, { recursive: true });
      cb(null, root);
    },
    filename: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: incidentAttachmentMaxBytes() },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, ok: boolean) => void) => {
    cb(null, PATHWAY_DOCUMENT_MIME.includes(file.mimetype));
  },
};
