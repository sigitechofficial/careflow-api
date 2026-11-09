import * as nodemailer from 'nodemailer';
import { buildReplyMime, type ReplyMime } from '../referral-reply-mime.util';
import { MailboxError, bareAddress, stripBccHeader } from './connector.types';

/** An SMTP server: the mailbox's own (IMAP hosts) or a relay (ZeptoMail, Brevo, SendGrid, Mailgun…). */
export type SmtpSettings = {
  host: string;
  port: number;
  /** true = TLS from the start (465); false = STARTTLS on 587/25. */
  secure: boolean;
  username: string;
  password: string;
  /** Sender address the relay accepts (a verified address/domain); defaults to the mailbox address. */
  fromAddress?: string | null;
};

const transport = (s: SmtpSettings) =>
  nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: { user: s.username, pass: s.password },
    // Local test servers use self-signed certificates; real hosts are checked.
    tls: { rejectUnauthorized: !/^(localhost|127\.0\.0\.1)$/i.test(s.host) },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });

/** Readable reason for a failed SMTP login or send. */
export function smtpErrorMessage(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; message?: string };
  if (err.code === 'EAUTH' || err.responseCode === 535) return 'The SMTP server did not accept the username or password.';
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ESOCKET' || err.code === 'ENOTFOUND')
    return `Could not reach the SMTP server (${err.code}). Check the server name and port.`;
  return `SMTP: ${err.message ?? String(e)}`;
}

export async function testSmtp(s: SmtpSettings): Promise<void> {
  const t = transport(s);
  try {
    await t.verify();
  } catch (e) {
    throw new MailboxError(smtpErrorMessage(e));
  } finally {
    t.close();
  }
}

/**
 * Send a reply over SMTP. The Bcc line is taken out of the message and the Bcc addresses go in the envelope only,
 * so the people who get it never see them. Returns the message as sent (for a copy in the Sent folder).
 */
export async function sendReplyOverSmtp(s: SmtpSettings, reply: ReplyMime): Promise<{ raw: string; messageId: string | null }> {
  const from = s.fromAddress?.trim() || bareAddress(reply.from);
  const fromHeader = s.fromAddress?.trim() ? reply.from.replace(/<[^>]+>/, `<${from}>`) : reply.from;
  // Sent as the relay's own address: the referrer's answer must still come back to the mailbox.
  const mailboxAddress = bareAddress(reply.from);
  const raw = buildReplyMime({
    ...reply,
    from: fromHeader,
    replyTo: reply.replyTo ?? (from.toLowerCase() !== mailboxAddress.toLowerCase() ? mailboxAddress : null),
  });
  const t = transport(s);
  try {
    const info = await t.sendMail({
      envelope: { from, to: [reply.to, ...reply.cc, ...reply.bcc].map(bareAddress) },
      raw: stripBccHeader(raw),
    });
    return { raw, messageId: (info.messageId as string | undefined) ?? null };
  } catch (e) {
    throw new MailboxError(smtpErrorMessage(e));
  } finally {
    t.close();
  }
}
