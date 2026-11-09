/** Building the reply email: formatted HTML with a plain-text copy, attachments (the quotation PDF), Cc/Bcc. */
import { randomUUID } from 'crypto';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text (as Claude drafts it) → simple HTML: paragraphs, line breaks, and "- " / "1. " lists. */
export function textToHtml(text: string): string {
  const blocks = text.replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${escapeHtml(l.replace(/^\s*[-•*]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        return `<ol>${lines.map((l) => `<li>${escapeHtml(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
      }
      return `<p>${lines.map(escapeHtml).join('<br>')}</p>`;
    })
    .join('');
}

/** HTML → readable plain text (the text/plain part of the email, and the enquiry history note). */
export function htmlToPlain(html: string): string {
  let n = 0;
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<\s*ol[^>]*>/gi, () => {
      n = 0;
      return '\n';
    })
    .replace(/<\s*li[^>]*>/gi, (m, offset: number, all: string) => {
      const inOl = all.lastIndexOf('<ol', offset) > all.lastIndexOf('<ul', offset);
      return inOl ? `\n${++n}. ` : '\n- ';
    })
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|table|tr)\s*>/gi, '\n\n')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_m, href: string, label: string) =>
      label.replace(/<[^>]+>/g, '') === href ? href : `${label} (${href})`,
    )
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Keep formatting from the editor but drop anything active (scripts, event handlers, javascript: links, frames). */
export function sanitizeReplyHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*(javascript|vbscript|data):[^"']*\2/gi, '$1="#"')
    .trim();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/(.{76})/g, '$1\r\n');
const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

export type ReplyMime = {
  from: string;
  /** Where the referrer's answer should go, when the sender address is not the mailbox (a relay's own sender). */
  replyTo?: string | null;
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  inReplyTo: string | null;
  references: string | null;
  text: string;
  html: string;
  attachments: Array<{ filename: string; contentType: string; content: Buffer }>;
};

/** RFC 822 message: multipart/mixed { multipart/alternative { text, html }, attachments… }. */
export function buildReplyMime(m: ReplyMime): string {
  const mixed = `mixed-${randomUUID()}`;
  const alt = `alt-${randomUUID()}`;
  const htmlDoc = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${m.html}</body></html>`;
  // Gmail adds these itself; SMTP servers and Microsoft need them in the message.
  const domain = (m.from.match(/@([^>\s]+)/)?.[1] ?? 'careflow.local').toLowerCase();
  const lines = [
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    `From: ${m.from}`,
    ...(m.replyTo ? [`Reply-To: ${m.replyTo}`] : []),
    `To: ${m.to}`,
    ...(m.cc.length ? [`Cc: ${m.cc.join(', ')}`] : []),
    ...(m.bcc.length ? [`Bcc: ${m.bcc.join(', ')}`] : []),
    `Subject: ${encodeWord(m.subject)}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references ? [`References: ${m.references}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(m.text),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(htmlDoc),
    `--${alt}--`,
  ];
  for (const a of m.attachments) {
    const name = a.filename.replace(/["\r\n]/g, '');
    lines.push(
      `--${mixed}`,
      `Content-Type: ${a.contentType}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      b64(a.content),
    );
  }
  lines.push(`--${mixed}--`, '');
  return lines.join('\r\n');
}
