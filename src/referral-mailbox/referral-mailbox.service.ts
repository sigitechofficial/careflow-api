import { emailKindOf, houseRulesForReading, kindAction, normaliseRules } from './referral-rules.util';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobHandler } from '../jobs/job-handler.registry';
import { JobRunner, runCronTick } from '../jobs/job-runner.service';
import { JobFailedWithSummaryError, jobSkipped, jobSuccess, type JobOutcome } from '../jobs/job-run.types';
import { Prisma, ReferralEmailStatus, ReferralMailbox, ReferralMailboxProvider } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { decryptFieldValue, encryptFieldValue } from '../common/utils/field-encryption.util';
import { CrmService } from '../crm/crm.service';
import { GmailSession, gmailAuthUrl, gmailExchangeCode, gmailOAuthConfig } from './gmail.client';
import { DOCX_MIME, MAX_ATTACHMENT_BYTES, docxToText } from './referral-email-parse.util';
import { ReferralExtractionService, type ExtractionAttachment, type ReferralExtraction } from './referral-extraction.service';
import { enquiryFromReferral } from './referral-to-enquiry.util';
import { newFacts, threadBody } from './referral-follow-up.util';
import { normaliseScreening, screenByRules } from './referral-screening.util';
import { ReferralAutomationService } from './referral-automation.service';
import { TEST_REFERRAL_SCENARIOS, buildTestReferralRaw } from './referral-test-email.util';
import { mayGetCopy, referralTestCopyAddresses } from './referral-test-copies.util';
import { MailService } from '../mail/mail.service';
import { uploadPath } from '../common/utils/upload-path.util';
import { MessageDeliveryService } from '../message-delivery/message-delivery.service';
import { MailboxError, PROCESSED_MARK, type FetchedEmail } from './connectors/connector.types';
import { GmailConnector } from './connectors/gmail.connector';
import { ImapConnector, type ImapConfig } from './connectors/imap.connector';
import { GraphSession, microsoftAuthUrl, microsoftExchangeCode, microsoftOAuthConfig } from './connectors/microsoft.connector';
import { hashWebhookToken, newWebhookToken, parseInboundPost, webhookTokenMatches } from './connectors/inbound-webhook';
import { POLLED_PROVIDERS, ReferralConnectorsService, type RelayConfig } from './connectors/referral-connectors.service';
import { RecruitmentInboxService } from '../hr/recruitment/inbox/recruitment-inbox.service';

/** What a mailbox is for: care referrals (CRM enquiries) or job applications (recruitment inbox). */
export const MAILBOX_PURPOSES = ['REFERRALS', 'RECRUITMENT'] as const;
export type MailboxPurpose = (typeof MAILBOX_PURPOSES)[number];
const isRecruitment = (mb: { purpose: string }) => mb.purpose === 'RECRUITMENT';

/**
 * Referral emails' attachments live in the uploads folder (a shared, persistent volume on Azure, unlike the container's
 * own disk), in an area the public /files/uploads route refuses to serve: they are only given to signed-in staff.
 */
export const REFERRAL_UPLOAD_AREA = 'referral-mailbox';
const storageRoot = () => uploadPath(REFERRAL_UPLOAD_AREA);
/** Where attachments were saved before they moved to the uploads folder; still read from. */
const LEGACY_STORAGE_ROOT = path.join(process.cwd(), 'storage', 'referral-mailbox');
/** A saved attachment's file: the uploads folder, or the old folder for emails saved before the move. */
async function storedFile(emailId: string, storedName: string): Promise<string> {
  const current = path.join(storageRoot(), emailId, storedName);
  const legacy = path.join(LEGACY_STORAGE_ROOT, emailId, storedName);
  const exists = (f: string) => fs.access(f).then(() => true, () => false);
  return (await exists(current)) || !(await exists(legacy)) ? current : legacy;
}
/** Where the browser lands after connecting a mailbox. */
const ADMIN_ORIGIN = () => (process.env.ADMIN_APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const isProduction = () => (process.env.NODE_ENV ?? 'development') === 'production';
/** A referral read (and acted on) that later emails in its thread are added to. */
const THREAD_READ_STATUSES: ReferralEmailStatus[] = [ReferralEmailStatus.READ, ReferralEmailStatus.ENQUIRY_CREATED];
type ReferralEmailRow = NonNullable<Awaited<ReturnType<PrismaService['referralEmail']['findUnique']>>>;
const hashOAuthState = (state: string) => createHash('sha256').update(state).digest('hex');
/** How long one mailbox check may hold its lock before another process may take over (a stopped process). */
const CHECK_LOCK_MS = 10 * 60_000;
/** Automatic tries after a failed read: 5 minutes, 30 minutes, then 2 hours later. */
export const READ_RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

type StoredAttachment = { fileName: string; mimeType: string; size: number; storedName: string | null; skippedReason?: string };

export type ImapMailboxInput = ImapConfig & {
  displayName?: string | null;
  emailAddress: string;
  folder?: string | null;
  password: string;
  defaultLocationId?: string | null;
};

export type RelayInput = RelayConfig & { password?: string | null };

export type MailboxUpdateInput = {
  displayName?: string | null;
  labelName?: string;
  defaultLocationId?: string | null;
  /** IMAP mailboxes: new settings; the password only when it changes. */
  imap?: Partial<ImapConfig> & { password?: string | null };
  sendVia?: 'MAILBOX' | 'SMTP_RELAY';
  relay?: RelayInput | null;
  /** Inbound webhook: the Brevo API key (to download attachments). */
  apiKey?: string | null;
  /** REFERRALS or RECRUITMENT. */
  purpose?: MailboxPurpose;
};

@Injectable()
export class ReferralMailboxService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReferralMailboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: ReferralExtractionService,
    private readonly crm: CrmService,
    private readonly automation: ReferralAutomationService,
    private readonly connectors: ReferralConnectorsService,
    private readonly recruitmentInbox: RecruitmentInboxService,
    @Optional() private readonly jobRunner?: JobRunner,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly delivery?: MessageDeliveryService,
  ) {}

  /* ─── mailboxes ──────────────────────────────────────────────── */

  /** A mailbox for the screen: settings without any password, token or key. */
  private presentMailbox(mb: ReferralMailbox, locations: Map<string, string>) {
    const imap = mb.provider === ReferralMailboxProvider.IMAP ? (mb.config as unknown as ImapConfig | null) : null;
    const relay = mb.relayConfig as unknown as RelayConfig | null;
    return {
      id: mb.id,
      provider: mb.provider,
      emailAddress: mb.emailAddress,
      displayName: mb.displayName,
      labelName: mb.labelName,
      purpose: mb.purpose as MailboxPurpose,
      defaultLocationId: mb.defaultLocationId,
      defaultLocationName: mb.defaultLocationId ? (locations.get(mb.defaultLocationId) ?? null) : null,
      isActive: mb.isActive,
      lastCheckedAt: mb.lastCheckedAt,
      lastError: mb.lastError,
      createdAt: mb.createdAt,
      imap: imap
        ? { ...imap, hasPassword: Boolean(mb.encryptedSecret) }
        : null,
      sendVia: mb.sendVia as 'MAILBOX' | 'SMTP_RELAY',
      relay: relay?.host ? { ...relay, hasPassword: Boolean(mb.encryptedRelaySecret) } : null,
      webhook:
        mb.provider === ReferralMailboxProvider.INBOUND_WEBHOOK
          ? { path: `/referral-mailbox/inbound/${mb.id}/`, hasApiKey: Boolean(mb.encryptedSecret) }
          : null,
    };
  }

  async status() {
    // Switched-on mailboxes first, then turned-off ones (kept so they can be turned back on). Removed ones are hidden.
    const rows = await this.prisma.referralMailbox.findMany({
      where: { removedAt: null },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    const locIds = rows.map((r) => r.defaultLocationId).filter((x): x is string => Boolean(x));
    const locations = new Map(
      (locIds.length ? await this.prisma.location.findMany({ where: { id: { in: locIds } }, select: { id: true, name: true } }) : []).map(
        (l) => [l.id, l.name],
      ),
    );
    const mailboxes = rows.map((r) => this.presentMailbox(r, locations));
    return {
      data: {
        gmailConfigured: Boolean(gmailOAuthConfig()),
        microsoftConfigured: Boolean(microsoftOAuthConfig()),
        aiConfigured: Boolean(process.env.AI_API_KEY?.trim()),
        // Outside production replies go to the mailbox itself (and the copy addresses), never to the sender.
        testMode: !isProduction(),
        /** The first switched-on mailbox (kept for older screens). */
        mailbox: mailboxes.find((m) => m.isActive) ?? null,
        mailboxes,
      },
    };
  }

  private async mailbox(id: string) {
    const mb = await this.prisma.referralMailbox.findFirst({ where: { id, removedAt: null } });
    if (!mb) throw new NotFoundException('Mailbox not found');
    return mb;
  }

  /**
   * A Google / Microsoft sign-in in progress, kept in the database (10-minute life, used once) so a restart or a
   * second API process can finish it. Only a hash of the state is stored.
   */
  private async newState(userId: string, provider: 'GMAIL' | 'MICROSOFT') {
    await this.prisma.referralOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const state = randomBytes(24).toString('base64url');
    await this.prisma.referralOAuthState.create({
      data: { stateHash: hashOAuthState(state), provider, userId, expiresAt: new Date(Date.now() + 10 * 60_000) },
    });
    return state;
  }

  private async takeState(state: string | undefined, provider: 'GMAIL' | 'MICROSOFT') {
    if (!state) return null;
    // Deleting it is what makes it single-use: of two callbacks with the same state only one gets the row.
    const pending = await this.prisma.referralOAuthState.delete({ where: { stateHash: hashOAuthState(state) } }).catch(() => null);
    return pending && pending.provider === provider && pending.expiresAt.getTime() >= Date.now() ? { userId: pending.userId } : null;
  }

  async startGmailConnect(userId: string) {
    const cfg = gmailOAuthConfig();
    if (!cfg) throw new ServiceUnavailableException('Gmail is not set up. Add the GOOGLE_OAUTH_* settings to the API .env file.');
    return { data: { url: gmailAuthUrl(cfg, await this.newState(userId, 'GMAIL')) } };
  }

  async startMicrosoftConnect(userId: string) {
    const cfg = microsoftOAuthConfig();
    if (!cfg) {
      throw new ServiceUnavailableException('Microsoft 365 is not set up. Add the MICROSOFT_OAUTH_* settings to the API .env file.');
    }
    return { data: { url: microsoftAuthUrl(cfg, await this.newState(userId, 'MICROSOFT')) } };
  }

  /** Add the mailbox, or switch it back on with the new sign-in if it was connected before. */
  private async saveSignedInMailbox(
    provider: ReferralMailboxProvider,
    emailAddress: string,
    refreshToken: string,
    userId: string,
    extra: { processedLabelId?: string | null; labelName?: string } = {},
  ) {
    const existing = await this.prisma.referralMailbox.findFirst({ where: { provider, emailAddress }, select: { id: true } });
    const data = {
      encryptedRefreshToken: encryptFieldValue(refreshToken),
      isActive: true,
      removedAt: null,
      lastError: null,
      connectedById: userId,
      ...(extra.processedLabelId !== undefined ? { processedLabelId: extra.processedLabelId } : {}),
    };
    if (existing) await this.prisma.referralMailbox.update({ where: { id: existing.id }, data });
    else await this.prisma.referralMailbox.create({ data: { ...data, provider, emailAddress, labelName: extra.labelName ?? 'Referrals' } });
  }

  /** Google sends the browser back here. Returns where to send the browser next. */
  async finishGmailConnect(code: string | undefined, state: string | undefined, error: string | undefined): Promise<string> {
    const back = (q: string) => `${ADMIN_ORIGIN()}/crm/referral-inbox?${q}`;
    const pending = await this.takeState(state, 'GMAIL');
    if (error) return back('gmail=cancelled');
    if (!code || !pending) return back('gmail=expired');
    const cfg = gmailOAuthConfig();
    if (!cfg) return back('gmail=not-configured');
    try {
      const tokens = await gmailExchangeCode(cfg, code);
      if (!tokens.refreshToken) return back('gmail=no-offline-access');
      const session = new GmailSession(tokens.accessToken);
      const emailAddress = (await session.profileEmail()).toLowerCase();
      const processedLabelId = await session.ensureLabel(PROCESSED_MARK);
      await this.saveSignedInMailbox(ReferralMailboxProvider.GMAIL, emailAddress, tokens.refreshToken, pending.userId, { processedLabelId });
      return back('gmail=connected');
    } catch (e) {
      this.logger.warn(`Gmail connect failed: ${(e as Error).message}`);
      return back('gmail=failed');
    }
  }

  /** Microsoft sends the browser back here. */
  async finishMicrosoftConnect(code: string | undefined, state: string | undefined, error: string | undefined): Promise<string> {
    const back = (q: string) => `${ADMIN_ORIGIN()}/crm/referral-inbox?${q}`;
    const pending = await this.takeState(state, 'MICROSOFT');
    if (error) return back(`microsoft=${error === 'access_denied' ? 'cancelled' : 'failed'}`);
    if (!code || !pending) return back('microsoft=expired');
    const cfg = microsoftOAuthConfig();
    if (!cfg) return back('microsoft=not-configured');
    try {
      const tokens = await microsoftExchangeCode(cfg, code);
      if (!tokens.refreshToken) return back('microsoft=no-offline-access');
      const me = await new GraphSession(tokens.accessToken).me();
      if (!me.email) return back('microsoft=no-mailbox');
      await this.saveSignedInMailbox(ReferralMailboxProvider.MICROSOFT, me.email, tokens.refreshToken, pending.userId);
      return back('microsoft=connected');
    } catch (e) {
      this.logger.warn(`Microsoft connect failed: ${(e as Error).message}`);
      return back('microsoft=failed');
    }
  }

  /** Add an IMAP/SMTP mailbox (cPanel, GoDaddy Workspace, Zoho…). The connection is tested before it is saved. */
  async addImap(userId: string, dto: ImapMailboxInput) {
    const emailAddress = dto.emailAddress.trim().toLowerCase();
    const folder = dto.folder?.trim() || 'INBOX';
    const config: ImapConfig = {
      imapHost: dto.imapHost.trim(),
      imapPort: dto.imapPort,
      imapSecure: dto.imapSecure,
      smtpHost: dto.smtpHost.trim(),
      smtpPort: dto.smtpPort,
      smtpSecure: dto.smtpSecure,
      username: dto.username.trim(),
      sentFolder: dto.sentFolder?.trim() || null,
    };
    const c = new ImapConnector({ emailAddress, folder, config, password: dto.password, since: new Date() });
    try {
      await c.test();
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    } finally {
      await c.close();
    }
    const existing = await this.prisma.referralMailbox.findFirst({
      where: { provider: ReferralMailboxProvider.IMAP, emailAddress },
      select: { id: true },
    });
    const data = {
      displayName: dto.displayName?.trim() || null,
      labelName: folder,
      defaultLocationId: dto.defaultLocationId || null,
      config: config as unknown as Prisma.InputJsonValue,
      encryptedSecret: encryptFieldValue(dto.password),
      isActive: true,
      removedAt: null,
      lastError: null,
      connectedById: userId,
    };
    const mb = existing
      ? await this.prisma.referralMailbox.update({ where: { id: existing.id }, data })
      : await this.prisma.referralMailbox.create({ data: { ...data, provider: ReferralMailboxProvider.IMAP, emailAddress } });
    return { message: `${emailAddress} connected`, data: { id: mb.id } };
  }

  /**
   * Add a mailbox that an email service posts to (Brevo inbound parsing, or raw emails). Returns the address to
   * paste into the service; its secret part is shown this once only.
   */
  async addWebhook(userId: string, dto: { displayName?: string | null; emailAddress: string; apiKey?: string | null; defaultLocationId?: string | null }) {
    const token = newWebhookToken();
    const mb = await this.prisma.referralMailbox.create({
      data: {
        provider: ReferralMailboxProvider.INBOUND_WEBHOOK,
        emailAddress: dto.emailAddress.trim().toLowerCase(),
        displayName: dto.displayName?.trim() || null,
        defaultLocationId: dto.defaultLocationId || null,
        labelName: 'Posted to CareFlow',
        encryptedSecret: dto.apiKey?.trim() ? encryptFieldValue(dto.apiKey.trim()) : null,
        webhookTokenHash: hashWebhookToken(token),
        sendVia: 'SMTP_RELAY',
        connectedById: userId,
      },
    });
    return {
      message: 'Webhook mailbox added. Copy the address now: it is not shown again.',
      data: { id: mb.id, path: `/referral-mailbox/inbound/${mb.id}/${token}` },
    };
  }

  async newWebhookAddress(id: string) {
    const mb = await this.mailbox(id);
    if (mb.provider !== ReferralMailboxProvider.INBOUND_WEBHOOK) throw new BadRequestException('Only webhook mailboxes have an address.');
    const token = newWebhookToken();
    await this.prisma.referralMailbox.update({ where: { id }, data: { webhookTokenHash: hashWebhookToken(token) } });
    return { message: 'New address made; the old one stops working now.', data: { id, path: `/referral-mailbox/inbound/${id}/${token}` } };
  }

  async updateMailbox(id: string, dto: MailboxUpdateInput) {
    const mb = await this.mailbox(id);
    const data: Prisma.ReferralMailboxUpdateInput = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName?.trim() || null;
    if (dto.labelName !== undefined) {
      const name = dto.labelName.trim();
      if (!name) throw new BadRequestException('Enter the label or folder to read.');
      data.labelName = name;
    }
    if (dto.defaultLocationId !== undefined) data.defaultLocationId = dto.defaultLocationId || null;
    if (dto.purpose !== undefined) data.purpose = dto.purpose;
    if (dto.apiKey !== undefined) data.encryptedSecret = dto.apiKey?.trim() ? encryptFieldValue(dto.apiKey.trim()) : null;

    if (dto.imap) {
      if (mb.provider !== ReferralMailboxProvider.IMAP) throw new BadRequestException('Only IMAP mailboxes have IMAP settings.');
      const config = { ...(mb.config as unknown as ImapConfig), ...dto.imap } as ImapConfig & { password?: string | null };
      const password = dto.imap.password?.trim() ? dto.imap.password : null;
      delete config.password;
      data.config = config as unknown as Prisma.InputJsonValue;
      if (password) data.encryptedSecret = encryptFieldValue(password);
    }

    if (dto.relay !== undefined) {
      if (dto.relay === null) {
        data.relayConfig = Prisma.DbNull;
        data.encryptedRelaySecret = null;
      } else {
        const { password, ...relay } = dto.relay;
        if (!relay.host?.trim() || !relay.username?.trim() || !relay.port) throw new BadRequestException('Enter the relay server, port and username.');
        data.relayConfig = { ...relay, host: relay.host.trim(), username: relay.username.trim(), fromAddress: relay.fromAddress?.trim() || null } as unknown as Prisma.InputJsonValue;
        if (password?.trim()) data.encryptedRelaySecret = encryptFieldValue(password);
        else if (!mb.encryptedRelaySecret) throw new BadRequestException('Enter the relay password or API key.');
      }
    }
    if (dto.sendVia !== undefined) {
      if (mb.provider === ReferralMailboxProvider.INBOUND_WEBHOOK && dto.sendVia !== 'SMTP_RELAY') {
        throw new BadRequestException('A webhook mailbox can only send replies through a relay.');
      }
      data.sendVia = dto.sendVia;
    }
    const updated = await this.prisma.referralMailbox.update({ where: { id }, data });
    if (updated.sendVia === 'SMTP_RELAY' && !updated.relayConfig) {
      await this.prisma.referralMailbox.update({ where: { id }, data: { lastError: 'Replies are set to go through a relay, but no relay is set.' } });
    }
    return this.status();
  }

  /** Signs in to the mailbox (and its relay when it has one) without reading anything. */
  /** The labels or folders a mailbox can read, for the picker (webhook mailboxes have none). */
  async mailboxFolders(id: string) {
    const mb = await this.mailbox(id);
    if (!POLLED_PROVIDERS.includes(mb.provider)) return { data: { folders: [], current: mb.labelName } };
    const c = this.connectors.connector(mb);
    try {
      const folders = c.listFolders ? await c.listFolders() : [];
      return { data: { folders, current: mb.labelName } };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    } finally {
      await c.close();
    }
  }

  /** Make a label or folder in the mailbox, then list them again. */
  async createMailboxFolder(id: string, name: string) {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean || clean.length > 100 || /[\\"]/.test(clean)) throw new BadRequestException('Enter a label name of up to 100 characters (no quotes or backslashes).');
    const mb = await this.mailbox(id);
    if (!POLLED_PROVIDERS.includes(mb.provider)) throw new BadRequestException('This mailbox receives posted emails: it has no labels or folders.');
    const c = this.connectors.connector(mb);
    try {
      if (!c.createFolder) throw new BadRequestException('Labels can’t be made in this kind of mailbox.');
      await c.createFolder(clean);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(`The label could not be made: ${(e as Error).message}`);
    } finally {
      await c.close();
    }
    return this.mailboxFolders(id);
  }

  async testMailbox(id: string) {
    const mb = await this.mailbox(id);
    const results: string[] = [];
    try {
      if (POLLED_PROVIDERS.includes(mb.provider)) {
        const c = this.connectors.connector(mb);
        try {
          await c.test();
        } finally {
          await c.close();
        }
        results.push(mb.provider === ReferralMailboxProvider.IMAP ? 'IMAP and SMTP sign-in work' : 'Sign-in works and the folder was found');
      }
      if (mb.relayConfig) {
        await this.connectors.testRelay(mb);
        results.push('the relay accepts the sign-in');
      }
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    return { message: results.length ? `${results.join('; ')}.` : 'Nothing to test: this mailbox receives posted emails.' };
  }

  /**
   * Turn a mailbox off (or all of them): it is not read and webhook posts are refused, but its settings, password
   * and sign-in are kept so it can be turned back on. Emails already saved stay, and replies to them can still go.
   */
  async disconnect(id?: string) {
    await this.prisma.referralMailbox.updateMany({ where: { isActive: true, removedAt: null, ...(id ? { id } : {}) }, data: { isActive: false } });
    return { message: id ? 'Mailbox turned off' : 'Mailboxes turned off' };
  }

  /** Turn a mailbox back on. Its connection is checked first, so a broken one isn't silently switched on. */
  async turnOn(id: string) {
    const mb = await this.mailbox(id);
    if (mb.isActive) return { message: 'The mailbox is already on' };
    if (POLLED_PROVIDERS.includes(mb.provider)) {
      const c = this.connectors.connector(mb);
      try {
        await c.test();
      } catch (e) {
        const reason = (e as Error).message;
        throw new BadRequestException(
          mb.provider === ReferralMailboxProvider.IMAP ? `It can't be turned on: ${reason}` : `It can't be turned on: ${reason} Sign in again with "Add a mailbox".`,
        );
      } finally {
        await c.close();
      }
    } else if (!mb.webhookTokenHash) {
      throw new BadRequestException('This webhook mailbox has no address; make a new one first.');
    }
    await this.prisma.referralMailbox.update({ where: { id }, data: { isActive: true, lastError: null } });
    return { message: 'Mailbox turned on' };
  }

  /**
   * Remove a mailbox: it is switched off and its sign-in, password, relay password and webhook address are wiped.
   * Emails already read stay in the inbox. Adding the same address again brings it back.
   */
  async remove(id: string) {
    await this.mailbox(id);
    await this.prisma.referralMailbox.update({
      where: { id },
      data: {
        isActive: false,
        removedAt: new Date(),
        encryptedRefreshToken: null,
        encryptedSecret: null,
        encryptedRelaySecret: null,
        webhookTokenHash: null,
      },
    });
    return { message: 'Mailbox removed' };
  }

  /** Older screens: change the label of the first mailbox. */
  async updateLabel(labelName: string) {
    const first = await this.prisma.referralMailbox.findFirst({ where: { isActive: true, purpose: 'REFERRALS' }, orderBy: { createdAt: 'asc' } });
    if (!first) throw new BadRequestException('No referrals mailbox is connected.');
    await this.updateMailbox(first.id, { labelName });
    return this.status();
  }

  /**
   * Place a made-up referral (Word care plan + PDF discharge summary) in a mailbox. Webhook mailboxes take it as if it
   * had been posted. On the live system only a Super Admin may: the made-up senders use .test addresses, which can't
   * exist, and replies to them always go to the mailbox itself (referral-automation sendReply).
   */
  async insertTestReferral(scenario = 0, mailboxId?: string, user?: { roles?: string[] }) {
    this.assertTestReferralsAllowed(user);
    const mb = mailboxId
      ? await this.mailbox(mailboxId)
      : await this.prisma.referralMailbox.findFirst({ where: { isActive: true, purpose: 'REFERRALS' }, orderBy: { createdAt: 'asc' } });
    if (!mb) throw new BadRequestException('No referrals mailbox is connected.');
    if (isRecruitment(mb)) throw new BadRequestException('That mailbox is for recruitment, not referrals.');
    if (!mb.isActive) throw new BadRequestException('That mailbox is turned off.');
    const built = await buildTestReferralRaw(mb.emailAddress, scenario);
    const { mime, subject } = built;
    if (mb.provider === ReferralMailboxProvider.INBOUND_WEBHOOK) {
      const [email] = await parseInboundPost(Buffer.from(mime, 'utf8'), 'message/rfc822', null);
      const saved = await this.saveFetched(mb, email);
      if (saved) void this.readInBackground([saved]);
      // The same made-up email goes to the people who get copies, through the app's mail service.
      const copied = await this.testCopyRecipients(mb.emailAddress);
      if (copied.length && this.mail) {
        await this.mail
          .send({ kind: 'referral-test-copies',
            to: copied,
            subject: `[TEST referral copy] ${subject}`,
            text: `From: ${built.fromName} <${built.fromEmail}>\nTo: ${mb.emailAddress}\n\n${built.body}`,
            attachments: built.files,
            skipBcc: true,
          })
          .catch((e: Error) => this.logger.warn(`Test referral copy to ${copied.join(', ')} failed: ${e.message}`));
      }
      return {
        message: `Test referral posted to ${mb.displayName ?? mb.emailAddress}: "${subject}"${copied.length ? `; a copy was sent to ${copied.join(', ')}` : ''}`,
      };
    }
    const c = this.connectors.connector(mb);
    try {
      if (!c.appendTest) {
        throw new BadRequestException('Test referrals can’t be placed in this kind of mailbox. Send an email to it instead.');
      }
      await c.appendTest(mime);
      // Gmail: the same made-up email also goes to the people who get copies of replies (our own addresses only),
      // so they see exactly what CareFlow read.
      let copied: string[] = [];
      if (c instanceof GmailConnector) {
        copied = await this.testCopyRecipients(mb.emailAddress);
        // Administration › Message delivery can switch these copies off or limit them like any email.
        if (this.delivery && copied.length) {
          const d = await this.delivery.decide('EMAIL', 'referral-test-copies', copied);
          await this.delivery.record('EMAIL', d.kind, this.delivery.heldRows(d), `[TEST referral copy] ${subject}`);
          await this.delivery.record('EMAIL', d.kind, d.allowed.map((recipient) => ({ recipient, outcome: 'SENT' as const })), `[TEST referral copy] ${subject}`);
          copied = d.allowed;
        }
        for (const to of copied) {
          const copy = await buildTestReferralRaw(to, scenario, { subjectPrefix: '[TEST referral copy]' });
          await c.sendRaw(copy.mime).catch((e: Error) => this.logger.warn(`Test referral copy to ${to} failed: ${e.message}`));
        }
      }
      return {
        message: `Test referral placed in ${mb.emailAddress}: "${subject}"${copied.length ? `; a copy was sent to ${copied.join(', ')}` : ''}`,
      };
    } catch (e) {
      if (e instanceof MailboxError) throw new BadRequestException(e.message);
      throw e;
    } finally {
      await c.close();
    }
  }

  /** Who gets a copy of a test referral: the reply-copy addresses allowed while testing, plus REFERRAL_TEST_COPY_TO. */
  private async testCopyRecipients(mailboxAddress: string): Promise<string[]> {
    const settings = await this.prisma.referralAutomationSettings.findFirst({ select: { copyRepliesTo: true } });
    const all = [...(settings?.copyRepliesTo ?? []).map((x) => x.trim().toLowerCase()), ...referralTestCopyAddresses()];
    const own = mailboxAddress.trim().toLowerCase();
    return [...new Set(all)].filter((x) => x !== own && mayGetCopy(x));
  }

  testScenarios(user?: { roles?: string[] }) {
    this.assertTestReferralsAllowed(user);
    return { data: TEST_REFERRAL_SCENARIOS };
  }

  /** Test referrals: anyone with crm.manage outside production; only a Super Admin on the live system. */
  private assertTestReferralsAllowed(user?: { roles?: string[] }) {
    if (isProduction() && !user?.roles?.includes('Super Admin')) throw new NotFoundException();
  }

  /* ─── checking the mailboxes ─────────────────────────────────── */

  /** In-process timer (CRON_MODE=internal); with CRON_MODE=external Azure calls the job instead. */
  @Cron('*/2 * * * *', { timeZone: 'UTC' })
  async scheduledCheck() {
    await runCronTick(this.jobRunner, 'referral-mailbox-check', () => this.runScheduledCheck());
  }

  /**
   * The "Referral mailbox check" job (admin → System jobs): check every connected mailbox for new emails, then try
   * again the reads that failed and are due. JobRunner makes it run once per 2-minute period across API processes,
   * and each mailbox has its own lock, so "Check now" and the job can't check the same mailbox at once.
   */
  @JobHandler('referral-mailbox-check')
  async runScheduledCheck(): Promise<JobOutcome> {
    const retried = await this.retryDueReads();
    const boxes = await this.polledMailboxes();
    if (!boxes.length) return retried ? jobSuccess({ mailboxes: 0, retried }) : jobSkipped('No mailbox to check', { retried });
    const r = await this.checkBoxes(boxes);
    const summary = { mailboxes: boxes.length, saved: r.saved, busy: r.busy, failed: r.errors.length, retried };
    if (r.errors.length === boxes.length) throw new JobFailedWithSummaryError(r.errors.join(' · ').slice(0, 1000), summary);
    return jobSuccess(summary);
  }

  private polledMailboxes(mailboxId?: string) {
    return this.prisma.referralMailbox.findMany({
      where: { isActive: true, removedAt: null, provider: { in: POLLED_PROVIDERS }, ...(mailboxId ? { id: mailboxId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Check every connected mailbox (or one) for new emails ("Check now"). One mailbox failing doesn't stop the others. */
  async checkNow(mailboxId?: string) {
    const boxes = await this.polledMailboxes(mailboxId);
    if (!boxes.length && mailboxId) throw new BadRequestException('This mailbox is not checked: emails are posted to CareFlow.');
    if (!boxes.length) throw new BadRequestException('No referrals mailbox is connected.');
    const { saved, busy, errors } = await this.checkBoxes(boxes);
    // One mailbox: its error is the answer. Several: report what was saved; each mailbox shows its own error.
    if (errors.length && errors.length === boxes.length) throw new BadRequestException(errors.join(' · '));
    return { data: { saved, read: 0, busy, errors } };
  }

  private async checkBoxes(boxes: ReferralMailbox[]) {
    let saved = 0;
    let busy = false;
    const errors: string[] = [];
    for (const mb of boxes) {
      const r = await this.checkMailbox(mb);
      saved += r.saved;
      busy ||= r.busy;
      if (r.error) errors.push(`${mb.displayName ?? mb.emailAddress}: ${r.error}`);
    }
    return { saved, busy, errors };
  }

  /**
   * Reads to try again: failed ones whose next try is due, and ones left "Being read" for over 15 minutes (the
   * process stopped while reading). Each is claimed with a conditional update, so two processes never take the same one.
   */
  async retryDueReads(): Promise<number> {
    const now = new Date();
    const due = await this.prisma.referralEmail.findMany({
      where: {
        // A turned-off mailbox is never read, retries included: turning it off stops all Claude use for it.
        mailbox: { isActive: true },
        OR: [
          { status: { in: [ReferralEmailStatus.FAILED, ReferralEmailStatus.FOLLOW_UP] }, nextReadAt: { lte: now } },
          { status: ReferralEmailStatus.RECEIVED, updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
        ],
      },
      orderBy: { receivedAt: 'asc' },
      select: { id: true, status: true, nextReadAt: true, updatedAt: true },
      take: 5,
    });
    const claimed: string[] = [];
    for (const d of due) {
      const won = await this.prisma.referralEmail.updateMany({
        where:
          d.status === ReferralEmailStatus.RECEIVED
            ? { id: d.id, status: d.status, updatedAt: d.updatedAt }
            : { id: d.id, status: d.status, nextReadAt: d.nextReadAt },
        // A failed read shows "Being read" (RECEIVED) while the next try runs; a follow-up keeps its status.
        data: d.status === ReferralEmailStatus.FAILED ? { status: ReferralEmailStatus.RECEIVED, nextReadAt: null } : { nextReadAt: null },
      });
      if (won.count) claimed.push(d.id);
    }
    if (claimed.length) void this.readInBackground(claimed);
    return claimed.length;
  }

  /** Save new emails and their attachments, mark them in the mailbox, then let Claude read each. */
  private async checkMailbox(mb: ReferralMailbox): Promise<{ saved: number; busy: boolean; error: string | null }> {
    // The lock lives in the database so it holds across API processes; a lock left by a stopped process runs out.
    const now = new Date();
    const lock = await this.prisma.referralMailbox.updateMany({
      where: { id: mb.id, OR: [{ checkLockedUntil: null }, { checkLockedUntil: { lt: now } }] },
      data: { checkLockedUntil: new Date(now.getTime() + CHECK_LOCK_MS) },
    });
    if (!lock.count) return { saved: 0, busy: true, error: null };
    let saved = 0;
    const newIds: string[] = [];
    let connector;
    try {
      connector = this.connectors.connector(mb);
      // A wide window, then only the ones not saved yet (at most 20 per check): a mailbox whose server doesn't
      // keep CareFlow's mark can't get stuck on the same old emails.
      const listed = await connector.listNew(200);
      // Recruitment mailboxes keep their emails in the recruitment inbox.
      const alreadySaved = isRecruitment(mb)
        ? await this.recruitmentInbox.savedIds(mb.id, listed)
        : new Set(
            (
              await this.prisma.referralEmail.findMany({
                where: { mailboxId: mb.id, providerMessageId: { in: listed } },
                select: { providerMessageId: true },
              })
            ).map((r) => r.providerMessageId),
          );
      // Saved but still unmarked ones are marked again (a few per check), in case marking failed last time.
      const ids = [...listed.filter((x) => !alreadySaved.has(x)).slice(0, 20), ...listed.filter((x) => alreadySaved.has(x)).slice(0, 20)];
      for (const messageId of ids) {
        const exists = alreadySaved.has(messageId);
        if (!exists) {
          const fetched = await connector.fetch(messageId);
          const savedId = isRecruitment(mb) ? await this.recruitmentInbox.save(mb, fetched) : await this.saveFetched(mb, fetched);
          if (savedId) newIds.push(savedId);
          saved += 1;
        }
        await connector.markRead(messageId);
      }
      await this.prisma.referralMailbox.update({
        where: { id: mb.id },
        data: {
          lastCheckedAt: new Date(),
          lastError: null,
          ...(connector instanceof GmailConnector ? { processedLabelId: await connector.processedLabel() } : {}),
        },
      });
      return { saved, busy: false, error: null };
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      await this.prisma.referralMailbox.update({ where: { id: mb.id }, data: { lastCheckedAt: new Date(), lastError: message.slice(0, 2000) } });
      this.logger.warn(`Checking ${mb.emailAddress} failed: ${message}`);
      return { saved, busy: false, error: message };
    } finally {
      // Claude reads in the background so "Check now" returns straight away; the inbox shows "Being read".
      if (newIds.length) {
        if (isRecruitment(mb)) this.recruitmentInbox.readInBackground(newIds);
        else void this.readInBackground(newIds);
      }
      await connector?.close().catch(() => undefined);
      await this.prisma.referralMailbox
        .update({ where: { id: mb.id }, data: { checkLockedUntil: null } })
        .catch((e: Error) => this.logger.warn(`Unlocking ${mb.emailAddress} failed: ${e.message}`));
    }
  }

  /** An email service posting to a webhook mailbox. The secret in the address is checked against its hash. */
  async ingestInbound(mailboxId: string, token: string, body: unknown, contentType: string) {
    const mb = await this.prisma.referralMailbox.findFirst({
      where: { id: mailboxId, isActive: true, provider: ReferralMailboxProvider.INBOUND_WEBHOOK },
    });
    // The same answer whether the mailbox or the secret is wrong.
    if (!mb || !webhookTokenMatches(token, mb.webhookTokenHash)) throw new NotFoundException();
    const apiKey = mb.encryptedSecret ? this.decryptOrNull(mb.encryptedSecret) : null;
    let emails: FetchedEmail[];
    try {
      emails = await parseInboundPost(body, contentType, apiKey);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const ids: string[] = [];
    if (isRecruitment(mb)) {
      for (const email of emails) {
        const id = await this.recruitmentInbox.save(mb, email);
        if (id) ids.push(id);
      }
      await this.prisma.referralMailbox.update({ where: { id: mb.id }, data: { lastCheckedAt: new Date(), lastError: null } });
      if (ids.length) this.recruitmentInbox.readInBackground(ids);
      return { message: `Received ${emails.length} email${emails.length === 1 ? '' : 's'}`, data: { saved: ids.length } };
    }
    for (const email of emails) {
      const exists = await this.prisma.referralEmail.findUnique({
        where: { mailboxId_providerMessageId: { mailboxId: mb.id, providerMessageId: email.providerMessageId } },
        select: { id: true },
      });
      if (exists) continue;
      const id = await this.saveFetched(mb, email);
      if (id) ids.push(id);
    }
    await this.prisma.referralMailbox.update({ where: { id: mb.id }, data: { lastCheckedAt: new Date(), lastError: null } });
    if (ids.length) void this.readInBackground(ids);
    return { message: `Received ${emails.length} email${emails.length === 1 ? '' : 's'}`, data: { saved: ids.length } };
  }

  private decryptOrNull(v: string) {
    try {
      return decryptFieldValue(v);
    } catch {
      return null;
    }
  }

  /**
   * Save one email and its attachments. Returns the id to read with Claude, or null when there is nothing to read:
   * our own sent replies are skipped, and a later email in a referral's thread is linked to it as a follow-up.
   */
  /**
   * Emails CareFlow itself sent, which come back when a mailbox reads its whole inbox: from this or another referral
   * mailbox, from the app's own sender (MAIL_FROM), or a test reply or test copy (their subjects are ours alone).
   * They are marked as read in the mailbox but never saved or read by Claude.
   */
  private async isOwnEmail(mb: ReferralMailbox, email: FetchedEmail): Promise<boolean> {
    const subject = (email.subject ?? '').trim();
    if (/^\[TEST – would go to /.test(subject) || /^\[TEST referral copy\]/.test(subject) || /^\[Held – for /.test(subject)) return true;
    const from = email.fromEmail?.trim().toLowerCase();
    if (!from) return false;
    if (from === mb.emailAddress.toLowerCase()) return true;
    const appSender = (process.env.MAIL_FROM ?? '').match(/<([^>]+)>/)?.[1] ?? process.env.MAIL_FROM ?? '';
    if (appSender.trim().toLowerCase() === from) return true;
    const other = await this.prisma.referralMailbox.count({ where: { emailAddress: { equals: from, mode: 'insensitive' } } });
    return other > 0;
  }

  private async saveFetched(mb: ReferralMailbox, email: FetchedEmail): Promise<string | null> {
    const mailboxId = mb.id;
    if (await this.isOwnEmail(mb, email)) return null;
    const id = randomUUID();
    const dir = path.join(storageRoot(), id);
    const attachments: StoredAttachment[] = [];
    for (const a of email.attachments) {
      if (a.size > MAX_ATTACHMENT_BYTES) {
        attachments.push({ fileName: a.fileName, mimeType: a.mimeType, size: a.size, storedName: null, skippedReason: 'Over 20 MB' });
        continue;
      }
      const data = a.data ?? (a.load ? await a.load().catch(() => null) : null);
      if (!data) {
        attachments.push({ fileName: a.fileName, mimeType: a.mimeType, size: a.size, storedName: null, skippedReason: 'Could not be downloaded' });
        continue;
      }
      await fs.mkdir(dir, { recursive: true });
      const storedName = `${randomUUID()}${path.extname(a.fileName).slice(0, 10)}`;
      await fs.writeFile(path.join(dir, storedName), data);
      attachments.push({ fileName: a.fileName, mimeType: a.mimeType, size: data.length, storedName });
    }
    await this.prisma.referralEmail.create({
      data: {
        id,
        mailboxId,
        providerMessageId: email.providerMessageId,
        providerThreadId: email.threadKey,
        messageIdHeader: email.messageIdHeader,
        referencesHeader: email.referencesHeader,
        replyToEmail: email.replyToEmail,
        fromName: email.fromName,
        fromEmail: email.fromEmail,
        subject: email.subject,
        receivedAt: email.receivedAt,
        bodyText: email.bodyText,
        attachments: attachments as unknown as Prisma.InputJsonValue,
      },
    });

    // A reply in the thread of a referral we already have (e.g. the referrer answering our questions).
    const original = email.threadKey
      ? await this.prisma.referralEmail.findFirst({
          where: { mailboxId, providerThreadId: email.threadKey, id: { not: id }, status: { not: ReferralEmailStatus.FOLLOW_UP } },
          orderBy: { receivedAt: 'asc' },
          select: { id: true, enquiryId: true, locationId: true, status: true, extraction: true },
        })
      : null;
    if (!original) return this.screenNew(id, email);
    await this.prisma.referralEmail.update({
      where: { id },
      data: { status: ReferralEmailStatus.FOLLOW_UP, enquiryId: original.enquiryId, locationId: original.locationId },
    });
    if (original.enquiryId) {
      const files = attachments.map((a) => a.fileName);
      await this.prisma.enquiryEvent.create({
        data: {
          enquiryId: original.enquiryId,
          action: 'Referrer replied by email',
          note: [
            `From ${email.fromName ? `${email.fromName} <${email.fromEmail}>` : (email.fromEmail ?? 'unknown')}`,
            email.subject ?? '',
            files.length ? `Attachments: ${files.join(', ')}` : '',
            '',
            email.bodyText,
          ]
            .filter((x, i) => x || i === 3)
            .join('\n')
            .slice(0, 4000),
          userId: null,
        },
      });
    }
    // The referral is read again with this reply, so new facts (an answer to our questions) reach the checks.
    return original.extraction && THREAD_READ_STATUSES.includes(original.status) ? id : null;
  }

  /**
   * Screening, before any money is spent on a new email: free rules, then (for unclear emails) the quick check.
   * Screened out: kept as "not a referral" with the reason and never read; staff can still read it. Returns the id
   * to read in full, or null.
   */
  private async screenNew(id: string, email: FetchedEmail): Promise<string | null> {
    const row = await this.prisma.referralAutomationSettings.findFirst({ select: { screening: true } });
    const settings = normaliseScreening(row?.screening);
    const from = email.fromEmail?.trim();
    const knownSender = from
      ? (await this.prisma.referralEmail.count({
          where: {
            id: { not: id },
            fromEmail: { equals: from, mode: 'insensitive' },
            status: { in: [ReferralEmailStatus.READ, ReferralEmailStatus.ENQUIRY_CREATED, ReferralEmailStatus.FOLLOW_UP] },
          },
        })) > 0
      : false;
    const rule = screenByRules(email, settings, { knownSender });
    let result: { decision: 'BRING' | 'SKIP'; reason: string; by: 'RULE' | 'AI'; costUsd?: number };
    if (rule.decision !== 'UNSURE') result = { decision: rule.decision, reason: rule.reason, by: 'RULE' };
    else if (settings.mode === 'RULES_AND_AI' && process.env.AI_API_KEY?.trim()) {
      const ai = await this.extraction.screen(email).catch((e: Error) => {
        this.logger.warn(`Quick check of referral email ${id} failed, reading it in full: ${e.message}`);
        return null;
      });
      result = ai
        ? { decision: ai.aboutCare ? 'BRING' : 'SKIP', reason: ai.reason, by: 'AI', costUsd: ai.costUsd }
        : { decision: 'BRING', reason: 'The quick check failed, so it is read in full', by: 'RULE' };
    } else result = { decision: 'BRING', reason: rule.reason, by: 'RULE' };
    await this.prisma.referralEmail.update({
      where: { id },
      data: {
        screening: { ...result, at: new Date().toISOString() } as Prisma.InputJsonValue,
        ...(result.costUsd ? { extractionCostUsd: result.costUsd } : {}),
        ...(result.decision === 'SKIP' ? { status: ReferralEmailStatus.NOT_A_REFERRAL } : {}),
      },
    });
    return result.decision === 'BRING' ? id : null;
  }

  private async readInBackground(ids: string[]) {
    for (const id of ids) {
      await this.readEmail(id).catch((e: Error) => this.logger.warn(`Reading referral email ${id} failed: ${e.message}`));
    }
  }

  /** On start-up, read any emails left unread (for example when the API restarted while reading). */
  async onApplicationBootstrap() {
    // Left "Being read" by the last run (a few minutes' grace in case another process is reading them right now).
    const pending = await this.prisma.referralEmail.findMany({
      where: { status: ReferralEmailStatus.RECEIVED, updatedAt: { lt: new Date(Date.now() - 5 * 60_000) }, mailbox: { isActive: true } },
      select: { id: true, updatedAt: true },
      take: 20,
    });
    const mine: string[] = [];
    for (const p of pending) {
      const won = await this.prisma.referralEmail.updateMany({
        where: { id: p.id, status: ReferralEmailStatus.RECEIVED, updatedAt: p.updatedAt },
        data: { nextReadAt: null },
      });
      if (won.count) mine.push(p.id);
    }
    if (mine.length) void this.readInBackground(mine);
    // Read but never checked (the API stopped between Claude reading it and the checks): finish those too.
    const unchecked = await this.prisma.referralEmail.findMany({
      where: {
        status: ReferralEmailStatus.READ,
        decision: null,
        enquiryId: null,
        createdAt: { gte: new Date(Date.now() - 2 * 86_400_000) },
      },
      select: { id: true },
      take: 20,
    });
    if (unchecked.length) {
      void (async () => {
        for (const u of unchecked) {
          await this.automation.process(u.id).catch((e: Error) => this.logger.warn(`Referral automation for ${u.id} failed: ${e.message}`));
        }
      })();
    }
  }

  /** The saved attachments of an email, as Claude reads them (Word and text files as their text). */
  private async attachmentInputs(row: { id: string; attachments: Prisma.JsonValue }): Promise<ExtractionAttachment[]> {
    const inputs: ExtractionAttachment[] = [];
    for (const f of (row.attachments as unknown as StoredAttachment[]) ?? []) {
      if (!f.storedName) continue;
      const data = await fs.readFile(await storedFile(row.id, f.storedName));
      const text =
        f.mimeType === DOCX_MIME
          ? await docxToText(data).catch(() => '')
          : f.mimeType.startsWith('text/')
            ? data.toString('utf8')
            : undefined;
      inputs.push({ fileName: f.fileName, mimeType: f.mimeType, data, text });
    }
    return inputs;
  }

  /** Claude reads the email and its attachments (also used for "Read again"). */
  async readEmail(id: string) {
    const row = await this.prisma.referralEmail.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Referral email not found');
    if (row.status === ReferralEmailStatus.FOLLOW_UP) return this.readFollowUp(row);
    const inputs = await this.attachmentInputs(row);
    try {
      const settingsRow = await this.prisma.referralAutomationSettings.findFirst({ select: { rules: true } });
      const rules = normaliseRules(settingsRow?.rules);
      const result = await this.extraction.extract({
        subject: row.subject,
        fromName: row.fromName,
        fromEmail: row.fromEmail,
        receivedAt: row.receivedAt,
        bodyText: row.bodyText,
        attachments: inputs,
        houseRules: houseRulesForReading(rules),
      });
      // Complaints, safeguarding concerns, news about our own clients…: staff need to see them, so they are checked too.
      const forStaff = kindAction(rules, emailKindOf(result.extraction)) === 'STAFF';
      const handled = (result.extraction.isReferral || forStaff) && kindAction(rules, emailKindOf(result.extraction)) !== 'IGNORE';
      const updated = await this.prisma.referralEmail.update({
        where: { id },
        data: {
          extraction: result.extraction as unknown as Prisma.InputJsonValue,
          extractionModel: result.model,
          extractionCostUsd: (row.extractionCostUsd ?? 0) + result.costUsd,
          error: null,
          readAttempts: 0,
          nextReadAt: null,
          status:
            row.status === ReferralEmailStatus.ENQUIRY_CREATED
              ? row.status
              : handled
                ? ReferralEmailStatus.READ
                : ReferralEmailStatus.NOT_A_REFERRAL,
        },
      });
      if (handled) {
        await this.automation
          .process(id)
          .catch((err: Error) => this.logger.warn(`Referral automation for ${id} failed: ${err.message}`));
      }
      const fresh = await this.prisma.referralEmail.findUniqueOrThrow({ where: { id } });
      return { data: this.present(fresh) };
    } catch (e) {
      const message = (e as Error).message ?? 'Reading failed';
      const attempts = row.readAttempts + 1;
      // A refusal won't change on a second try; anything else (network, overloaded, timeout) is tried again later.
      const delay = /declined/i.test(message) ? undefined : READ_RETRY_DELAYS_MS[attempts - 1];
      await this.prisma.referralEmail.update({
        where: { id },
        data: {
          status: ReferralEmailStatus.FAILED,
          error: message.slice(0, 2000),
          readAttempts: attempts,
          nextReadAt: delay ? new Date(Date.now() + delay) : null,
        },
      });
      throw e;
    }
  }

  /**
   * A later email in a referral's thread (usually the referrer answering our questions): the referral is read again
   * together with every later email in its thread, what changed is noted on the enquiry, and the checks, decision
   * and draft reply are worked out again. A reply that has already gone stays as it was.
   */
  private async readFollowUp(row: ReferralEmailRow) {
    const original = row.providerThreadId
      ? await this.prisma.referralEmail.findFirst({
          where: { mailboxId: row.mailboxId, providerThreadId: row.providerThreadId, status: { not: ReferralEmailStatus.FOLLOW_UP } },
          orderBy: { receivedAt: 'asc' },
        })
      : null;
    if (!original?.extraction || !THREAD_READ_STATUSES.includes(original.status)) {
      // Nothing read to add it to: it stays linked to the thread for staff.
      return { data: this.present(row) };
    }
    try {
      const later = await this.prisma.referralEmail.findMany({
        where: { mailboxId: row.mailboxId, providerThreadId: row.providerThreadId, status: ReferralEmailStatus.FOLLOW_UP },
        orderBy: { receivedAt: 'asc' },
        take: 10,
      });
      const inputs = await this.attachmentInputs(original);
      for (const f of later) inputs.push(...(await this.attachmentInputs(f)));
      const settingsRow = await this.prisma.referralAutomationSettings.findFirst({ select: { rules: true } });
      const result = await this.extraction.extract({
        subject: original.subject,
        fromName: original.fromName,
        fromEmail: original.fromEmail,
        receivedAt: original.receivedAt,
        bodyText: threadBody(original.bodyText, later),
        attachments: inputs,
        houseRules: houseRulesForReading(normaliseRules(settingsRow?.rules)),
      });
      const before = original.extraction as unknown as ReferralExtraction;
      // The thread is still about the same referral even if the reply on its own reads like a question.
      const after: ReferralExtraction = { ...result.extraction, isReferral: before.isReferral, emailKind: before.emailKind ?? result.extraction.emailKind };
      const facts = newFacts(before, after);
      await this.prisma.referralEmail.update({
        where: { id: original.id },
        data: { extraction: after as unknown as Prisma.InputJsonValue, extractionModel: result.model },
      });
      await this.prisma.referralEmail.update({
        where: { id: row.id },
        data: { extractionCostUsd: (row.extractionCostUsd ?? 0) + result.costUsd, error: null, readAttempts: 0, nextReadAt: null },
      });
      if (original.enquiryId) {
        await this.prisma.enquiryEvent.create({
          data: {
            enquiryId: original.enquiryId,
            action: 'Referral read again with the referrer\'s reply',
            note: (facts.length ? ['New or changed:', ...facts.map((f) => `• ${f}`)] : ['Nothing new for the referral details.'])
              .concat(after.missingInformation?.length ? ['', `Still missing: ${after.missingInformation.join('; ')}`] : [])
              .join('\n')
              .slice(0, 4000),
            userId: null,
          },
        });
      }
      await this.automation
        .process(original.id)
        .catch((err: Error) => this.logger.warn(`Referral automation for ${original.id} failed: ${err.message}`));
      const fresh = await this.prisma.referralEmail.findUniqueOrThrow({ where: { id: row.id } });
      return { data: this.present(fresh) };
    } catch (e) {
      // It stays a follow-up (so it isn't read as a new referral); the next try is scheduled like any failed read.
      const message = (e as Error).message ?? 'Reading failed';
      const attempts = row.readAttempts + 1;
      const delay = /declined/i.test(message) ? undefined : READ_RETRY_DELAYS_MS[attempts - 1];
      await this.prisma.referralEmail.update({
        where: { id: row.id },
        data: { error: message.slice(0, 2000), readAttempts: attempts, nextReadAt: delay ? new Date(Date.now() + delay) : null },
      });
      throw e;
    }
  }

  /* ─── the inbox ──────────────────────────────────────────────── */

  private present(row: {
    id: string;
    mailboxId?: string;
    fromName: string | null;
    fromEmail: string | null;
    subject: string | null;
    receivedAt: Date;
    status: ReferralEmailStatus;
    attachments: Prisma.JsonValue;
    extraction: Prisma.JsonValue | null;
    extractionModel: string | null;
    extractionCostUsd: number | null;
    error: string | null;
    enquiryId: string | null;
    nextReadAt?: Date | null;
    screening?: Prisma.JsonValue | null;
    bodyText?: string;
    locationId?: string | null;
    checks?: Prisma.JsonValue | null;
    decision?: string | null;
    decisionReasons?: string[];
    replySubject?: string | null;
    replyText?: string | null;
    replySentAt?: Date | null;
    replySentTo?: string | null;
    replyError?: string | null;
    replyHtml?: string | null;
    replyCopiedTo?: string[];
    quotationId?: string | null;
    quotationVersionId?: string | null;
    rateSource?: string | null;
  }) {
    const files = ((row.attachments as unknown as StoredAttachment[]) ?? []).map((f, index) => ({
      index,
      fileName: f.fileName,
      mimeType: f.mimeType,
      size: f.size,
      available: Boolean(f.storedName),
      skippedReason: f.skippedReason ?? null,
    }));
    return {
      id: row.id,
      mailboxId: row.mailboxId ?? null,
      fromName: row.fromName,
      fromEmail: row.fromEmail,
      subject: row.subject,
      receivedAt: row.receivedAt.toISOString(),
      status: row.status,
      attachments: files,
      extraction: (row.extraction as unknown as ReferralExtraction | null) ?? null,
      extractionModel: row.extractionModel,
      extractionCostUsd: row.extractionCostUsd,
      error: row.error,
      /** When the next automatic try of a failed read is due (null = none). */
      nextReadAt: row.nextReadAt?.toISOString() ?? null,
      /** Why the email was (or wasn't) read in full: { decision, reason, by RULE | AI }. */
      screening: row.screening ?? null,
      enquiryId: row.enquiryId,
      locationId: row.locationId ?? null,
      checks: (row.checks as unknown as Array<{ key: string; label: string; result: string; detail: string }> | null) ?? null,
      decision: row.decision ?? null,
      decisionReasons: row.decisionReasons ?? [],
      replySubject: row.replySubject ?? null,
      replyText: row.replyText ?? null,
      replySentAt: row.replySentAt?.toISOString() ?? null,
      replySentTo: row.replySentTo ?? null,
      replyError: row.replyError ?? null,
      replyHtml: row.replyHtml ?? null,
      replyCopiedTo: row.replyCopiedTo ?? [],
      quotationId: row.quotationId ?? null,
      quotationVersionId: row.quotationVersionId ?? null,
      rateSource: row.rateSource ?? null,
      ...(row.bodyText !== undefined ? { bodyText: row.bodyText } : {}),
    };
  }

  async list(status?: string, enquiryId?: string) {
    const where: Prisma.ReferralEmailWhereInput = enquiryId ? { enquiryId } :
      status === 'open'
        ? {
            // Waiting for a person: not yet handled, or a reply still waiting to be sent (e.g. a decline held for a manager).
            OR: [
              { status: { in: [ReferralEmailStatus.RECEIVED, ReferralEmailStatus.READ, ReferralEmailStatus.FAILED, ReferralEmailStatus.NOT_A_REFERRAL, ReferralEmailStatus.FOLLOW_UP] } },
              { status: { not: ReferralEmailStatus.DISMISSED }, replyText: { not: null }, replySentAt: null },
            ],
          }
        : status && status in ReferralEmailStatus
          ? { status: status as ReferralEmailStatus }
          : {};
    const rows = await this.prisma.referralEmail.findMany({ where, orderBy: { receivedAt: 'desc' }, take: 200 });
    const enquiryIds = rows.map((r) => r.enquiryId).filter((x): x is string => Boolean(x));
    const enquiries = enquiryIds.length
      ? await this.prisma.enquiry.findMany({ where: { id: { in: enquiryIds } }, select: { id: true, referenceNumber: true } })
      : [];
    const ref = new Map(enquiries.map((e) => [e.id, e.referenceNumber]));
    return {
      data: rows.map((r) => ({ ...this.present(r), enquiryReference: r.enquiryId ? (ref.get(r.enquiryId) ?? null) : null })),
    };
  }

  async get(id: string) {
    const row = await this.prisma.referralEmail.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Referral email not found');
    return { data: this.present(row) };
  }

  /** A stored attachment, for signed-in staff only. */
  async attachmentFile(id: string, index: number) {
    const row = await this.prisma.referralEmail.findUnique({ where: { id }, select: { id: true, attachments: true } });
    const f = ((row?.attachments as unknown as StoredAttachment[]) ?? [])[index];
    if (!row || !f?.storedName) throw new NotFoundException('Attachment not found');
    return { path: await storedFile(row.id, f.storedName), fileName: f.fileName, mimeType: f.mimeType };
  }

  /** The text of a Word attachment, so staff can read it on screen (browsers can't show .docx). */
  async attachmentText(id: string, index: number) {
    const f = await this.attachmentFile(id, index);
    if (f.mimeType !== DOCX_MIME && !/\.docx$/i.test(f.fileName)) {
      throw new BadRequestException('Only Word (.docx) attachments can be shown as text.');
    }
    const text = await docxToText(await fs.readFile(f.path)).catch(() => '');
    return { data: { fileName: f.fileName, text } };
  }

  async createEnquiry(actor: RequestUser, id: string, locationId: string, meta?: RequestAuditMeta) {
    const row = await this.prisma.referralEmail.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Referral email not found');
    if (row.enquiryId) throw new BadRequestException('An enquiry has already been created from this email.');
    const extraction = row.extraction as unknown as ReferralExtraction | null;
    if (!extraction) throw new BadRequestException('This email has not been read yet. Use "Read again" first.');
    const dto = enquiryFromReferral(extraction, row, locationId);
    const created = await this.crm.create(actor, dto, meta);
    const enquiry = created.data as { id: string; referenceNumber: string };
    await this.prisma.referralEmail.update({
      where: { id },
      data: { status: ReferralEmailStatus.ENQUIRY_CREATED, enquiryId: enquiry.id, handledById: actor.id, handledAt: new Date() },
    });
    return { message: `Enquiry ${enquiry.referenceNumber} created`, data: { enquiryId: enquiry.id, referenceNumber: enquiry.referenceNumber } };
  }

  async dismiss(actor: RequestUser, id: string) {
    const row = await this.prisma.referralEmail.findUnique({ where: { id }, select: { id: true, enquiryId: true, status: true } });
    if (!row) throw new NotFoundException('Referral email not found');
    if (row.enquiryId && row.status !== ReferralEmailStatus.FOLLOW_UP) throw new BadRequestException('An enquiry was created from this email; manage it in the CRM.');
    await this.prisma.referralEmail.update({
      where: { id },
      data: { status: ReferralEmailStatus.DISMISSED, handledById: actor.id, handledAt: new Date() },
    });
    return { message: 'Dismissed' };
  }
}
