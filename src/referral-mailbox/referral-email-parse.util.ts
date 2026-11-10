import JSZip from 'jszip';
import type { GmailMessage, GmailPart } from './gmail.client';

export type ParsedAttachmentRef = {
  fileName: string;
  mimeType: string;
  size: number;
  attachmentId: string;
};

export type ParsedEmail = {
  subject: string | null;
  fromName: string | null;
  fromEmail: string | null;
  receivedAt: Date;
  bodyText: string;
  attachments: ParsedAttachmentRef[];
};

/** Attachments larger than this are listed but not downloaded or read. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function header(part: GmailPart | undefined, name: string): string | null {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value?.trim() || null;
}

/** "Jane Smith <jane@council.gov.uk>" → { name, email }. */
export function parseFromHeader(value: string | null): { name: string | null; email: string | null } {
  if (!value) return { name: null, email: null };
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return value.includes('@') ? { name: null, email: value.trim().toLowerCase() } : { name: value.trim(), email: null };
}

function decode(data: string | undefined): string {
  return data ? Buffer.from(data, 'base64url').toString('utf8') : '';
}

/** Plain text from simple HTML (used when an email has no plain-text part). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Subject, sender, date, body text and attachment list of a Gmail message. */
export function parseGmailMessage(msg: GmailMessage): ParsedEmail {
  const root = msg.payload;
  const texts: string[] = [];
  const htmls: string[] = [];
  const attachments: ParsedAttachmentRef[] = [];
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    const mime = (p.mimeType ?? '').toLowerCase();
    if (p.filename && p.body?.attachmentId) {
      attachments.push({
        fileName: p.filename,
        mimeType: mime || 'application/octet-stream',
        size: p.body.size ?? 0,
        attachmentId: p.body.attachmentId,
      });
    } else if (mime === 'text/plain') {
      texts.push(decode(p.body?.data));
    } else if (mime === 'text/html') {
      htmls.push(decode(p.body?.data));
    }
    for (const c of p.parts ?? []) walk(c);
  };
  walk(root);
  const from = parseFromHeader(header(root, 'From'));
  const dateHeader = header(root, 'Date');
  const received = msg.internalDate ? new Date(Number(msg.internalDate)) : dateHeader ? new Date(dateHeader) : new Date();
  const bodyText = (texts.join('\n').trim() || htmls.map(htmlToText).join('\n').trim()).slice(0, 100_000);
  return {
    subject: header(root, 'Subject'),
    fromName: from.name,
    fromEmail: from.email,
    receivedAt: Number.isNaN(received.getTime()) ? new Date() : received,
    bodyText,
    attachments,
  };
}

/** Text of a Word (.docx) document: paragraphs from word/document.xml. */
export async function docxToText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) return '';
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const READABLE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Treat by file extension too: some mail clients send PDFs and Word files as octet-stream. */
export function effectiveMimeType(fileName: string, mimeType: string): string {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'docx') return DOCX_MIME;
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'txt') return 'text/plain';
  return mimeType;
}
