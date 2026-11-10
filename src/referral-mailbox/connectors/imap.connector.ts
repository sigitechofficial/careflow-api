import { ImapFlow } from 'imapflow';
import type { ReplyMime } from '../referral-reply-mime.util';
import { IMAP_PROCESSED_KEYWORD, MailboxError, parseRawEmail, type FetchedEmail, type MailboxConnector } from './connector.types';
import { sendReplyOverSmtp, testSmtp, type SmtpSettings } from './smtp.sender';

/** IMAP/SMTP settings kept on the mailbox (passwords are stored separately, encrypted). */
export type ImapConfig = {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  /** Folder to put a copy of sent replies in; found automatically when empty. */
  sentFolder?: string | null;
};

type ImapMailbox = { emailAddress: string; folder: string; config: ImapConfig; password: string; since: Date };

/** Readable reason for a failed IMAP login or command. */
export function imapErrorMessage(e: unknown): string {
  const err = e as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string };
  if (err.authenticationFailed || /auth/i.test(err.responseText ?? '')) return 'The IMAP server did not accept the username or password.';
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND')
    return `Could not reach the IMAP server (${err.code}). Check the server name and port.`;
  if (err.code === 'NoConnection') return 'The IMAP connection closed. Check the server name, port and security setting.';
  return `IMAP: ${err.responseText || err.message || String(e)}`;
}

/**
 * Any mailbox reachable by IMAP (read) and SMTP (send): cPanel hosting, GoDaddy Workspace Email, Zoho Mail, IONOS…
 * Ids are "uidValidity:uid". Saved emails get the $CareFlowRead keyword; the database record also stops repeats
 * on servers that don't keep keywords.
 */
export class ImapConnector implements MailboxConnector {
  private client: ImapFlow | null = null;

  constructor(private readonly mb: ImapMailbox) {}

  private async c(): Promise<ImapFlow> {
    if (this.client?.usable) return this.client;
    const cfg = this.mb.config;
    const client = new ImapFlow({
      host: cfg.imapHost,
      port: cfg.imapPort,
      secure: cfg.imapSecure,
      auth: { user: cfg.username, pass: this.mb.password },
      logger: false,
      // Local test servers use self-signed certificates; real hosts are checked.
      tls: { rejectUnauthorized: !/^(localhost|127\.0\.0\.1)$/i.test(cfg.imapHost) },
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
    });
    // A dropped connection must not crash the API.
    client.on('error', () => undefined);
    try {
      await client.connect();
    } catch (e) {
      throw new MailboxError(imapErrorMessage(e));
    }
    this.client = client;
    return client;
  }

  private async inFolder<T>(folder: string, fn: (c: ImapFlow, uidValidity: string) => Promise<T>): Promise<T> {
    const c = await this.c();
    let lock;
    try {
      lock = await c.getMailboxLock(folder);
    } catch (e) {
      throw new MailboxError(`The folder "${folder}" was not found in this mailbox. ${imapErrorMessage(e)}`);
    }
    try {
      const mailbox = c.mailbox;
      const uidValidity = mailbox && typeof mailbox === 'object' ? String(mailbox.uidValidity) : '0';
      return await fn(c, uidValidity);
    } finally {
      lock.release();
    }
  }

  private splitId(id: string): { uidValidity: string; uid: number } {
    const [uidValidity, uid] = id.split(':');
    return { uidValidity, uid: Number(uid) };
  }

  async listNew(max: number) {
    return this.inFolder(this.mb.folder, async (c, uidValidity) => {
      const uids = (await c.search({ since: this.mb.since, unKeyword: IMAP_PROCESSED_KEYWORD }, { uid: true })) || [];
      // The newest `max`, oldest first. On servers that don't keep keywords, emails already saved keep coming
      // back here; taking the newest means new mail is still reached (the caller skips ones already saved).
      return uids
        .sort((a, b) => a - b)
        .slice(-max)
        .map((uid) => `${uidValidity}:${uid}`);
    });
  }

  async fetch(id: string): Promise<FetchedEmail> {
    const { uid, uidValidity } = this.splitId(id);
    return this.inFolder(this.mb.folder, async (c, current) => {
      if (current !== uidValidity) throw new MailboxError('The folder was rebuilt on the server; check again to read it afresh.');
      const msg = await c.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
      if (!msg || !msg.source) throw new MailboxError(`Email ${uid} is no longer in "${this.mb.folder}".`);
      const email = await parseRawEmail(msg.source, id);
      // The server's arrival time is more reliable than the sender's Date header.
      if (msg.internalDate) email.receivedAt = new Date(msg.internalDate);
      return email;
    });
  }

  async markRead(id: string) {
    const { uid } = this.splitId(id);
    await this.inFolder(this.mb.folder, async (c) => {
      // Servers that refuse custom keywords still don't repeat: the email is already saved in CareFlow.
      await c.messageFlagsAdd(String(uid), [IMAP_PROCESSED_KEYWORD], { uid: true }).catch(() => false);
    });
  }

  private smtp(): SmtpSettings {
    const cfg = this.mb.config;
    return { host: cfg.smtpHost, port: cfg.smtpPort, secure: cfg.smtpSecure, username: cfg.username, password: this.mb.password };
  }

  /** The Sent folder: the one set on the mailbox, else the folder the server marks as Sent. */
  private async sentFolder(): Promise<string | null> {
    if (this.mb.config.sentFolder?.trim()) return this.mb.config.sentFolder.trim();
    const list = await (await this.c()).list();
    return (
      list.find((f) => f.specialUse === '\\Sent')?.path ??
      list.find((f) => /^(inbox[./])?sent( items| messages)?$/i.test(f.path))?.path ??
      null
    );
  }

  /** Put a copy of a sent email in the Sent folder, so staff see it in their mail program. */
  async saveToSent(raw: string) {
    const folder = await this.sentFolder().catch(() => null);
    if (!folder) return;
    await (await this.c()).append(folder, raw, ['\\Seen']).catch(() => undefined);
  }

  async send(reply: ReplyMime) {
    const sent = await sendReplyOverSmtp(this.smtp(), reply);
    await this.saveToSent(sent.raw);
    return sent.messageId;
  }

  async appendTest(raw: string) {
    const c = await this.c();
    await c.append(this.mb.folder, raw, []).catch((e: unknown) => {
      throw new MailboxError(imapErrorMessage(e));
    });
  }

  /** Signs in to IMAP, opens the folder, and signs in to SMTP. */
  async test() {
    await this.inFolder(this.mb.folder, async () => undefined);
    await testSmtp(this.smtp());
  }

  /** The mailbox's folders, Inbox first; Sent, Drafts, Junk and Trash left out. */
  async listFolders() {
    const list = await (await this.c()).list();
    const skip = new Set(['\\Sent', '\\Drafts', '\\Junk', '\\Trash', '\\All', '\\Archive', '\\Flagged']);
    const folders = list
      .filter((f) => !(f.specialUse && skip.has(f.specialUse)) && !f.flags?.has('\\Noselect'))
      .map((f) => ({ name: f.path, ...(f.path.toUpperCase() === 'INBOX' ? { hint: 'Every email that arrives' } : {}) }));
    return folders.sort((a, b) => (a.name.toUpperCase() === 'INBOX' ? -1 : b.name.toUpperCase() === 'INBOX' ? 1 : a.name.localeCompare(b.name)));
  }

  async close() {
    const c = this.client;
    this.client = null;
    if (c) await c.logout().catch(() => c.close());
  }
}
