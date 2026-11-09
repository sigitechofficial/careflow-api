/**
 * Emails posted to CareFlow by an email service, instead of CareFlow fetching them:
 *  - Brevo inbound parsing (JSON with `items`; attachments fetched with the Brevo API key),
 *  - a raw email: body `message/rfc822`, or JSON `{ "raw": "<base64 or text>" }` (Cloudflare Email Workers,
 *    SendGrid "post the raw message", Mailgun `body-mime`, a script).
 * Nothing is fetched or marked later; replies go through the mailbox's relay (ZeptoMail, Brevo, SendGrid… SMTP).
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { MAX_ATTACHMENT_BYTES, effectiveMimeType, htmlToText } from '../referral-email-parse.util';
import { MailboxError, parseRawEmail, threadRoot, type FetchedEmail } from './connector.types';

const BREVO_ATTACHMENT_URL = 'https://api.brevo.com/v3/inbound/attachments/';

export const newWebhookToken = () => randomBytes(24).toString('base64url');
export const hashWebhookToken = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

export function webhookTokenMatches(token: string, storedHash: string | null): boolean {
  if (!storedHash || !token) return false;
  const a = Buffer.from(hashWebhookToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

type BrevoAddress = { Name?: string | null; Address?: string | null };
type BrevoItem = {
  Uuid?: string[] | string;
  MessageId?: string | null;
  InReplyTo?: string | null;
  From?: BrevoAddress | null;
  ReplyTo?: BrevoAddress | null;
  Subject?: string | null;
  SentAtDate?: string | null;
  RawTextBody?: string | null;
  RawHtmlBody?: string | null;
  ExtractedMarkdownMessage?: string | null;
  Headers?: Record<string, string | string[] | undefined> | null;
  Attachments?: Array<{ Name?: string; ContentType?: string; ContentLength?: number; DownloadToken?: string }> | null;
};

const header = (h: BrevoItem['Headers'], name: string): string | null => {
  if (!h) return null;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  const v = key ? h[key] : undefined;
  return (Array.isArray(v) ? v.join(' ') : v)?.trim() || null;
};

function brevoEmail(item: BrevoItem, apiKey: string | null): FetchedEmail {
  const messageId = item.MessageId?.trim() || null;
  const references = header(item.Headers, 'References');
  const uuid = Array.isArray(item.Uuid) ? item.Uuid[0] : item.Uuid;
  const sent = item.SentAtDate ? new Date(item.SentAtDate) : new Date();
  return {
    providerMessageId: messageId ?? uuid ?? `brevo-${Date.now()}`,
    threadKey: threadRoot(references, item.InReplyTo, messageId),
    subject: item.Subject?.trim() || null,
    fromName: item.From?.Name?.trim() || null,
    fromEmail: item.From?.Address?.trim().toLowerCase() || null,
    replyToEmail: item.ReplyTo?.Address?.trim().toLowerCase() || null,
    messageIdHeader: messageId,
    referencesHeader: references,
    receivedAt: Number.isNaN(sent.getTime()) ? new Date() : sent,
    bodyText: (item.RawTextBody?.trim() || (item.RawHtmlBody ? htmlToText(item.RawHtmlBody) : '') || item.ExtractedMarkdownMessage || '').slice(0, 100_000),
    attachments: (item.Attachments ?? []).map((a, i) => {
      const fileName = a.Name?.trim() || `attachment-${i + 1}`;
      const size = a.ContentLength ?? 0;
      return {
        fileName,
        mimeType: effectiveMimeType(fileName, a.ContentType || 'application/octet-stream'),
        size,
        load:
          a.DownloadToken && apiKey && size <= MAX_ATTACHMENT_BYTES
            ? async () => {
                const res = await fetch(BREVO_ATTACHMENT_URL + encodeURIComponent(a.DownloadToken!), { headers: { 'api-key': apiKey } });
                if (!res.ok) throw new MailboxError(`Brevo attachment download failed (${res.status})`);
                return Buffer.from(await res.arrayBuffer());
              }
            : undefined,
      };
    }),
  };
}

/** The emails in one webhook post. `body` is a Buffer for raw posts, or the parsed JSON. */
export async function parseInboundPost(body: unknown, contentType: string, apiKey: string | null): Promise<FetchedEmail[]> {
  const type = contentType.toLowerCase();
  if (Buffer.isBuffer(body)) {
    if (!body.length) throw new MailboxError('The post was empty.');
    return [await parseRawEmail(body, '')].map((e) => ({ ...e, providerMessageId: e.messageIdHeader ?? `raw-${hashWebhookToken(body.toString('latin1')).slice(0, 32)}` }));
  }
  if (!body || typeof body !== 'object') throw new MailboxError(`Unsupported post (${type || 'no content type'}).`);
  const b = body as { items?: BrevoItem[]; raw?: string; 'body-mime'?: string; email?: string };
  if (Array.isArray(b.items)) return b.items.map((item) => brevoEmail(item, apiKey));
  const raw = b.raw ?? b['body-mime'] ?? b.email;
  if (typeof raw === 'string' && raw.length) {
    const buf = /^[A-Za-z0-9+/=_\-\r\n]+$/.test(raw.slice(0, 200)) && !raw.includes(':') ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8');
    return parseInboundPost(buf, 'message/rfc822', apiKey);
  }
  throw new MailboxError('Unsupported post: expected Brevo inbound JSON ("items"), a raw email, or JSON with "raw".');
}
