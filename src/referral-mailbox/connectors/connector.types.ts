/**
 * One connector per kind of mailbox (Gmail, Microsoft 365, IMAP/SMTP, inbound webhook). Everything after
 * "here is an email with its attachments" — saving, Claude reading it, the checks, the reply — is shared.
 */
import { simpleParser, type AddressObject } from 'mailparser';
import type { ReplyMime } from '../referral-reply-mime.util';
import { effectiveMimeType, htmlToText } from '../referral-email-parse.util';

export type FetchedAttachment = {
  fileName: string;
  mimeType: string;
  size: number;
  /** The file, or a loader when the provider downloads it separately (Gmail). */
  data?: Buffer;
  load?: () => Promise<Buffer>;
};

export type FetchedEmail = {
  providerMessageId: string;
  /** Emails in one conversation share this (Gmail thread id, Microsoft conversation id, or the first Message-ID). */
  threadKey: string | null;
  subject: string | null;
  fromName: string | null;
  fromEmail: string | null;
  replyToEmail: string | null;
  messageIdHeader: string | null;
  referencesHeader: string | null;
  receivedAt: Date;
  bodyText: string;
  attachments: FetchedAttachment[];
};

/** Where a reply goes back to: the saved email it answers. */
export type ReplyContext = { providerMessageId: string; providerThreadId: string | null };

export interface MailboxConnector {
  /** Ids of emails waiting to be saved (not yet marked as read by CareFlow), oldest first, at most `max`. */
  listNew(max: number): Promise<string[]>;
  fetch(providerMessageId: string): Promise<FetchedEmail>;
  /** Mark so it is never listed again (label, category or IMAP keyword). */
  markRead(providerMessageId: string): Promise<void>;
  /** Send a reply in the email's thread; returns the provider's id for the sent message when it gives one. */
  send(reply: ReplyMime, ctx: ReplyContext): Promise<string | null>;
  /** Put a made-up email straight into the mailbox (development test referrals). */
  appendTest?(raw: string): Promise<void>;
  /** Check the connection works; throws with a readable message when it doesn't. */
  test(): Promise<void>;
  close(): Promise<void>;
}

/** Thrown for problems staff can fix (wrong password, folder missing…). */
export class MailboxError extends Error {}

/** CareFlow marks emails it has saved with this, so they are never read twice. */
export const PROCESSED_MARK = 'CareFlow-read';
/** IMAP keywords can't contain "-" on every server; this one is safe. */
export const IMAP_PROCESSED_KEYWORD = '$CareFlowRead';

/** First message of the conversation: the first id in References, else In-Reply-To, else the email's own. */
export function threadRoot(references: string | string[] | null | undefined, inReplyTo: string | null | undefined, messageId: string | null | undefined): string | null {
  const refs = (Array.isArray(references) ? references.join(' ') : (references ?? '')).match(/<[^>]+>/g) ?? [];
  return refs[0] ?? inReplyTo?.match(/<[^>]+>/)?.[0] ?? messageId?.trim() ?? null;
}

const firstAddress = (a: AddressObject | AddressObject[] | undefined) => {
  const v = (Array.isArray(a) ? a[0] : a)?.value?.[0];
  return { name: v?.name?.trim() || null, email: v?.address?.trim().toLowerCase() || null };
};

/** A raw email (RFC 822) from IMAP, Microsoft or a webhook, in the shape the inbox saves. */
export async function parseRawEmail(raw: Buffer | string, providerMessageId: string, threadKey?: string | null): Promise<FetchedEmail> {
  const m = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
  const from = firstAddress(m.from);
  const references = Array.isArray(m.references) ? m.references.join(' ') : (m.references ?? null);
  const text = (m.text ?? '').trim() || (typeof m.html === 'string' ? htmlToText(m.html) : '');
  return {
    providerMessageId,
    threadKey: threadKey ?? threadRoot(m.references, m.inReplyTo, m.messageId),
    subject: m.subject?.trim() || null,
    fromName: from.name,
    fromEmail: from.email,
    replyToEmail: firstAddress(m.replyTo).email,
    messageIdHeader: m.messageId?.trim() || null,
    referencesHeader: references,
    receivedAt: m.date && !Number.isNaN(m.date.getTime()) ? m.date : new Date(),
    bodyText: text.slice(0, 100_000),
    // Pictures placed inside the email body (signature logos) are not attachments.
    attachments: m.attachments
      .filter((a) => !a.related || a.contentDisposition === 'attachment')
      .map((a, i) => {
        const fileName = a.filename?.trim() || `attachment-${i + 1}`;
        return { fileName, mimeType: effectiveMimeType(fileName, a.contentType || 'application/octet-stream'), size: a.size ?? a.content.length, data: a.content };
      }),
  };
}

/** The Bcc line must never reach the people who get the email; SMTP takes it in the envelope instead. */
export function stripBccHeader(raw: string): string {
  const end = raw.indexOf('\r\n\r\n');
  const head = raw.slice(0, end);
  const kept = head.split('\r\n').filter((l) => !/^bcc:/i.test(l));
  return kept.join('\r\n') + raw.slice(end);
}

/** Bare address from "Name <a@b>" or "a@b". */
export const bareAddress = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim();
