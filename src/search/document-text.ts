import { readFile, stat } from 'fs/promises';
import { extname } from 'path';

/** Larger files are not read (the text would rarely be searched and reading costs memory). */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
/** Text kept per document: plenty for finding it, small enough for the database. */
export const MAX_DOCUMENT_TEXT = 200_000;
const READ_TIMEOUT_MS = 20_000;

type PdfParse = (data: Buffer, options?: { max?: number }) => Promise<{ text: string }>;
type Mammoth = { extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }> };

const kindOf = (fileName: string, mimeType?: string | null) => {
  const ext = extname(fileName).toLowerCase();
  const mime = (mimeType ?? '').toLowerCase();
  if (ext === '.pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === '.docx' || mime.includes('wordprocessingml')) return 'docx';
  if (['.txt', '.csv', '.md', '.rtf'].includes(ext) || mime.startsWith('text/')) return 'text';
  return null;
};

const tidy = (s: string) =>
  s
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, MAX_DOCUMENT_TEXT);

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), READ_TIMEOUT_MS))]);
}

/**
 * The text inside a document (PDF, Word .docx, plain text), for searching. null when the type is not readable
 * (images, old .doc, spreadsheets) or the file is too large; '' when readable but empty (e.g. a scanned PDF).
 */
export async function readDocumentText(absPath: string, fileName: string, mimeType?: string | null): Promise<string | null> {
  const kind = kindOf(fileName, mimeType);
  if (!kind) return null;
  const info = await stat(absPath);
  if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES) return null;
  const data = await readFile(absPath);
  if (kind === 'text') return tidy(data.toString('utf8'));
  if (kind === 'pdf') {
    // The library file itself: the package index runs a self-test when loaded on its own.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse/lib/pdf-parse.js') as PdfParse;
    return tidy((await withTimeout(pdfParse(new Uint8Array(data) as unknown as Buffer, { max: 200 }))).text ?? '');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth') as Mammoth;
  return tidy((await withTimeout(mammoth.extractRawText({ buffer: data }))).value ?? '');
}
