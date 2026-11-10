import { Injectable } from '@nestjs/common';
import { ReferralMailbox, ReferralMailboxProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptFieldValue, encryptFieldValue } from '../../common/utils/field-encryption.util';
import { GmailSession, gmailOAuthConfig, gmailRefreshAccessToken } from '../gmail.client';
import type { ReplyMime } from '../referral-reply-mime.util';
import { MailboxError, type MailboxConnector, type ReplyContext } from './connector.types';
import { GmailConnector } from './gmail.connector';
import { ImapConnector, type ImapConfig } from './imap.connector';
import { MicrosoftConnector } from './microsoft.connector';
import { sendReplyOverSmtp, testSmtp, type SmtpSettings } from './smtp.sender';

/** Relay settings kept on the mailbox (the password is stored separately, encrypted). */
export type RelayConfig = { host: string; port: number; secure: boolean; username: string; fromAddress?: string | null };

/** On first connection only recent mail is read (an Inbox can hold years of email). */
const FIRST_READ_DAYS = 14;

export const POLLED_PROVIDERS: ReferralMailboxProvider[] = [
  ReferralMailboxProvider.GMAIL,
  ReferralMailboxProvider.MICROSOFT,
  ReferralMailboxProvider.IMAP,
];

const secret = (v: string | null | undefined, what: string) => {
  if (!v) throw new MailboxError(`The ${what} for this mailbox is missing. Edit the mailbox and enter it again.`);
  return decryptFieldValue(v);
};

/** Builds the right connector for a mailbox and sends replies (from the mailbox, or through its relay). */
@Injectable()
export class ReferralConnectorsService {
  constructor(private readonly prisma: PrismaService) {}

  since(mb: ReferralMailbox) {
    return new Date(mb.createdAt.getTime() - FIRST_READ_DAYS * 86_400_000);
  }

  /** The connector that reads (and, unless a relay is set, sends for) this mailbox. Close it when done. */
  connector(mb: ReferralMailbox): MailboxConnector {
    switch (mb.provider) {
      case ReferralMailboxProvider.GMAIL:
        return new GmailConnector({
          emailAddress: mb.emailAddress,
          labelName: mb.labelName,
          processedLabelId: mb.processedLabelId,
          refreshToken: secret(mb.encryptedRefreshToken, 'Google sign-in'),
        });
      case ReferralMailboxProvider.MICROSOFT:
        return new MicrosoftConnector({
          folder: mb.labelName,
          refreshToken: secret(mb.encryptedRefreshToken, 'Microsoft sign-in'),
          since: this.since(mb),
          // Microsoft hands out a new refresh token now and then; keep the newest.
          onNewRefreshToken: async (t) => {
            await this.prisma.referralMailbox.update({ where: { id: mb.id }, data: { encryptedRefreshToken: encryptFieldValue(t) } });
          },
        });
      case ReferralMailboxProvider.IMAP:
        return new ImapConnector({
          emailAddress: mb.emailAddress,
          folder: mb.labelName,
          config: mb.config as unknown as ImapConfig,
          password: secret(mb.encryptedSecret, 'password'),
          since: this.since(mb),
        });
      default:
        throw new MailboxError('This mailbox receives emails posted to CareFlow; there is nothing to fetch.');
    }
  }

  relaySettings(mb: Pick<ReferralMailbox, 'relayConfig' | 'encryptedRelaySecret'>): SmtpSettings | null {
    const r = mb.relayConfig as unknown as RelayConfig | null;
    if (!r?.host) return null;
    return { host: r.host, port: r.port, secure: r.secure, username: r.username, fromAddress: r.fromAddress, password: secret(mb.encryptedRelaySecret, 'relay password') };
  }

  async testRelay(mb: Pick<ReferralMailbox, 'relayConfig' | 'encryptedRelaySecret'>) {
    const s = this.relaySettings(mb);
    if (!s) throw new MailboxError('No relay is set for this mailbox.');
    await testSmtp(s);
  }

  /**
   * The Message-ID, References and Reply-To to answer an email. Kept with each email when it is saved;
   * Gmail emails saved before that are looked up in Gmail.
   */
  async replyHeaders(
    mb: ReferralMailbox,
    row: { providerMessageId: string; messageIdHeader: string | null; referencesHeader: string | null; replyToEmail: string | null },
  ): Promise<{ messageIdHeader: string | null; references: string | null; replyTo: string | null }> {
    if (row.messageIdHeader || mb.provider !== ReferralMailboxProvider.GMAIL) {
      return { messageIdHeader: row.messageIdHeader, references: row.referencesHeader, replyTo: row.replyToEmail };
    }
    const cfg = gmailOAuthConfig();
    if (!cfg) throw new MailboxError('Gmail is not set up.');
    const session = new GmailSession(await gmailRefreshAccessToken(cfg, secret(mb.encryptedRefreshToken, 'Google sign-in')));
    return session.threadHeaders(row.providerMessageId);
  }

  /** Send a reply for this mailbox: through its relay when one is chosen, otherwise from the mailbox itself. */
  async send(mb: ReferralMailbox, reply: ReplyMime, ctx: ReplyContext): Promise<string | null> {
    if (mb.sendVia === 'SMTP_RELAY' || mb.provider === ReferralMailboxProvider.INBOUND_WEBHOOK) {
      const relay = this.relaySettings(mb);
      if (!relay) throw new MailboxError('Replies for this mailbox go through a relay, but no relay is set. Edit the mailbox.');
      const sent = await sendReplyOverSmtp(relay, reply);
      // IMAP mailboxes still get a copy in their Sent folder.
      if (mb.provider === ReferralMailboxProvider.IMAP) {
        const c = this.connector(mb) as ImapConnector;
        await c.saveToSent(sent.raw).finally(() => c.close());
      }
      return sent.messageId;
    }
    const c = this.connector(mb);
    try {
      return await c.send(reply, ctx);
    } finally {
      await c.close();
    }
  }
}
