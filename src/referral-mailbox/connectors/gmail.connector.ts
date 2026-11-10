import { GmailSession, gmailOAuthConfig, gmailRefreshAccessToken } from '../gmail.client';
import { MAX_ATTACHMENT_BYTES, effectiveMimeType, parseGmailMessage } from '../referral-email-parse.util';
import { buildReplyMime, type ReplyMime } from '../referral-reply-mime.util';
import { MailboxError, PROCESSED_MARK, type FetchedEmail, type MailboxConnector, type ReplyContext } from './connector.types';

type GmailMailbox = {
  emailAddress: string;
  labelName: string;
  processedLabelId: string | null;
  refreshToken: string;
  /** When the mailbox was added to CareFlow. Reading the whole inbox starts a day before it, not from years back. */
  connectedAt?: Date;
};

/** Gmail / Google Workspace through the Gmail API (Google sign-in). Reads one label; marks with "CareFlow-read". */
export class GmailConnector implements MailboxConnector {
  private session: GmailSession | null = null;
  private processedLabelId: string | null;

  constructor(private readonly mb: GmailMailbox) {
    this.processedLabelId = mb.processedLabelId;
  }

  private async s(): Promise<GmailSession> {
    if (this.session) return this.session;
    const cfg = gmailOAuthConfig();
    if (!cfg) throw new MailboxError('Gmail is not set up on the server (GOOGLE_OAUTH_* settings).');
    this.session = new GmailSession(await gmailRefreshAccessToken(cfg, this.mb.refreshToken));
    return this.session;
  }

  /** The "CareFlow-read" label id (created the first time). */
  async processedLabel(): Promise<string> {
    if (!this.processedLabelId) this.processedLabelId = await (await this.s()).ensureLabel(PROCESSED_MARK);
    return this.processedLabelId;
  }

  async listNew(max: number) {
    const label = this.mb.labelName.trim().replace(/\s+/g, '-');
    await this.processedLabel();
    // The whole inbox: only emails from a day before the mailbox was added, so years of old mail aren't all read
    // (each read costs Claude time). A referrals label is read in full: staff put emails there on purpose.
    const since =
      label.toUpperCase() === 'INBOX' && this.mb.connectedAt ? ` after:${Math.floor(this.mb.connectedAt.getTime() / 1000) - 86_400}` : '';
    return (await this.s()).listMessageIds(`label:${label} -label:${PROCESSED_MARK}${since}`, max);
  }

  async fetch(id: string): Promise<FetchedEmail> {
    const s = await this.s();
    const msg = await s.getMessage(id);
    const parsed = parseGmailMessage(msg);
    const h = (name: string) =>
      msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value?.trim() || null;
    const replyTo = h('Reply-To');
    return {
      providerMessageId: id,
      threadKey: msg.threadId ?? null,
      subject: parsed.subject,
      fromName: parsed.fromName,
      fromEmail: parsed.fromEmail,
      replyToEmail: replyTo ? ((replyTo.match(/<([^>]+)>/)?.[1] ?? replyTo).trim().toLowerCase() || null) : null,
      messageIdHeader: h('Message-ID'),
      referencesHeader: h('References'),
      receivedAt: parsed.receivedAt,
      bodyText: parsed.bodyText,
      attachments: parsed.attachments.map((a) => ({
        fileName: a.fileName,
        mimeType: effectiveMimeType(a.fileName, a.mimeType),
        size: a.size,
        load: a.size > MAX_ATTACHMENT_BYTES ? undefined : () => s.getAttachment(id, a.attachmentId),
      })),
    };
  }

  async markRead(id: string) {
    await (await this.s()).addLabel(id, await this.processedLabel());
  }

  async send(reply: ReplyMime, ctx: ReplyContext) {
    const raw = buildReplyMime(reply);
    return (await this.s()).sendMessage(Buffer.from(raw, 'utf8').toString('base64url'), ctx.providerThreadId);
  }

  async appendTest(raw: string) {
    const s = await this.s();
    const labelId = await s.ensureLabel(this.mb.labelName.trim());
    await s.insertMessage(Buffer.from(raw, 'utf8').toString('base64url'), [labelId, 'INBOX', 'UNREAD']);
  }

  /** Sends a made-up email from the mailbox (used for copies of test referrals). */
  async sendRaw(raw: string) {
    await (await this.s()).sendMessage(Buffer.from(raw, 'utf8').toString('base64url'));
  }

  async test() {
    await (await this.s()).profileEmail();
  }

  async close() {}
}
