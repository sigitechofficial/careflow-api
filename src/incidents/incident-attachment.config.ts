import { extname } from 'path';
import { existsSync, mkdirSync, promises as fsp } from 'fs';
import { diskStorage } from 'multer';
import { uploadPath } from '../common/utils/upload-path.util';

/** Attachments live outside any web-served static root — access is only via the
 *  authenticated, permission-checked download endpoint. */
export function incidentAttachmentRoot() {
  return uploadPath('incidents',
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

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** True when the file's leading bytes match the declared MIME type (client-declared types can't be trusted). */
export function incidentAttachmentBytesMatchType(bytes: Buffer, mimeType: string): boolean {
  const b = bytes.subarray(0, 16);
  const ascii = (start: number, end: number) => b.subarray(start, end).toString('latin1');
  switch (mimeType) {
    case 'image/jpeg':
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png':
      return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'image/heic':
      return b.length >= 12 && ascii(4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(8, 12));
    case 'application/pdf':
      return b.length >= 5 && ascii(0, 5) === '%PDF-';
    default:
      return false;
  }
}

/** Same check for a file already written to disk (multer disk storage). */
export async function incidentAttachmentContentMatchesType(
  filePath: string,
  mimeType: string,
): Promise<boolean> {
  const handle = await fsp.open(filePath, 'r');
  try {
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, 16, 0);
    return incidentAttachmentBytesMatchType(head.subarray(0, bytesRead), mimeType);
  } finally {
    await handle.close();
  }
}

/** Image types the carer app may attach to an incident, with the extension stored on disk. */
export const CARER_INCIDENT_PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

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
