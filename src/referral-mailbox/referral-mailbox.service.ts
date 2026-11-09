import { emailKindOf, houseRulesForReading, kindAction, normaliseRules } from './referral-rules.util';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, ReferralEmailStatus, ReferralMailbox, ReferralMailboxProvider } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
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
import { ReferralAutomationService } from './referral-automation.service';
import { TEST_REFERRAL_SCENARIOS, buildTestReferralRaw } from './referral-test-email.util';
import { MailboxError, PROCESSED_MARK, type FetchedEmail } from './connectors/connector.types';
import { GmailConnector } from './connectors/gmail.connector';
import { ImapConnector, type ImapConfig } from './connectors/imap.connector';
import { GraphSession, microsoftAuthUrl, microsoftExchangeCode, microsoftOAuthConfig } from './connectors/microsoft.connector';
import { hashWebhookToken, newWebhookToken, parseInboundPost, webhookTokenMatches } from './connectors/inbound-webhook';
import { POLLED_PROVIDERS, ReferralConnectorsService, type RelayConfig } from './connectors/referral-connectors.service';

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'referral-mailbox');
/** Where the browser lands after connecting a mailbox. */
const ADMIN_ORIGIN = () => (process.env.ADMIN_APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const isProduction = () => (process.env.NODE_ENV ?? 'development') === 'production';

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
};

@Injectable()
export class ReferralMailboxService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReferralMailboxService.name);
  /** Pending Google / Microsoft sign-ins: state → who started it (10-minute life, one use). */
  private readonly pendingStates = new Map<string, { userId: string; provider: 'GMAIL' | 'MICROSOFT'; expires: number }>();
  /** Mailboxes being checked right now (each is checked by one run at a time). */
  private readonly checking = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: ReferralExtractionService,
    private readonly crm: CrmService,
    private readonly automation: ReferralAutomationService,
    private readonly connectors: ReferralConnectorsService,
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

  private newState(userId: string, provider: 'GMAIL' | 'MICROSOFT') {
    const now = Date.now();
    for (const [k, v] of this.pendingStates) if (v.expires < now) this.pendingStates.delete(k);
    const state = randomBytes(24).toString('base64url');
    this.pendingStates.set(state, { userId, provider, expires: now + 10 * 60_000 });
    return state;
  }

  private takeState(state: string | undefined, provider: 'GMAIL' | 'MICROSOFT') {
    const pending = state ? this.pendingStates.get(state) : undefined;
    if (state) this.pendingStates.delete(state);
    return pending && pending.provider === provider && pending.expires >= Date.now() ? pending : null;
  }

  startGmailConnect(userId: string) {
    const cfg = gmailOAuthConfig();
    if (!cfg) throw new ServiceUnavailableException('Gmail is not set up. Add the GOOGLE_OAUTH_* settings to the API .env file.');
    return { data: { url: gmailAuthUrl(cfg, this.newState(userId, 'GMAIL')) } };
  }

  startMicrosoftConnect(userId: string) {
    const cfg = microsoftOAuthConfig();
    if (!cfg) {
      throw new ServiceUnavailableException('Microsoft 365 is not set up. Add the MICROSOFT_OAUTH_* settings to the API .env file.');
    }
    return { data: { url: microsoftAuthUrl(cfg, this.newState(userId, 'MICROSOFT')) } };
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
    const pending = this.takeState(state, 'GMAIL');
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
    const pending = this.takeState(state, 'MICROSOFT');
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
    const first = await this.prisma.referralMailbox.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    if (!first) throw new BadRequestException('No referrals mailbox is connected.');
    await this.updateMailbox(first.id, { labelName });
    return this.status();
  }

  /**
   * Development only: place a made-up referral (Word care plan + PDF discharge summary) in a mailbox. Nothing is
   * sent to anyone outside our own addresses. Webhook mailboxes take it as if it had been posted.
   */
  async insertTestReferral(scenario = 0, mailboxId?: string) {
    if (isProduction()) throw new NotFoundException();
    const mb = mailboxId
      ? await this.mailbox(mailboxId)
      : await this.prisma.referralMailbox.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    if (!mb) throw new BadRequestException('No referrals mailbox is connected.');
    if (!mb.isActive) throw new BadRequestException('That mailbox is turned off.');
    const { mime, subject } = await buildTestReferralRaw(mb.emailAddress, scenario);
    if (mb.provider === ReferralMailboxProvider.INBOUND_WEBHOOK) {
      const [email] = await parseInboundPost(Buffer.from(mime, 'utf8'), 'message/rfc822', null);
      const saved = await this.saveFetched(mb, email);
      if (saved) void this.readInBackground([saved]);
      return { message: `Test referral posted to ${mb.displayName ?? mb.emailAddress}: "${subject}"` };
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
        const settings = await this.prisma.referralAutomationSettings.findFirst({ select: { copyRepliesTo: true } });
        copied = (settings?.copyRepliesTo ?? []).filter((x) => x.toLowerCase().endsWith('@allforcare.co.uk'));
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

  testScenarios() {
    if (isProduction()) throw new NotFoundException();
    return { data: TEST_REFERRAL_SCENARIOS };
  }

  /* ─── checking the mailboxes ─────────────────────────────────── */

  /** Every 2 minutes while a mailbox is connected (testing; production moves to the job catalogue). */
  @Cron('*/2 * * * *', { timeZone: 'UTC' })
  async scheduledCheck() {
    if (!(await this.prisma.referralMailbox.count({ where: { isActive: true, provider: { in: POLLED_PROVIDERS } } }))) return;
    await this.checkNow().catch((e: Error) => this.logger.warn(`Referral mailbox check failed: ${e.message}`));
  }

  /** Check every connected mailbox (or one) for new emails. One mailbox failing doesn't stop the others. */
  async checkNow(mailboxId?: string) {
    const boxes = await this.prisma.referralMailbox.findMany({
      where: { isActive: true, provider: { in: POLLED_PROVIDERS }, ...(mailboxId ? { id: mailboxId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    if (!boxes.length && mailboxId) throw new BadRequestException('This mailbox is not checked: emails are posted to CareFlow.');
    if (!boxes.length) throw new BadRequestException('No referrals mailbox is connected.');
    let saved = 0;
    let busy = false;
    const errors: string[] = [];
    for (const mb of boxes) {
      const r = await this.checkMailbox(mb);
      saved += r.saved;
      busy ||= r.busy;
      if (r.error) errors.push(`${mb.displayName ?? mb.emailAddress}: ${r.error}`);
    }
    // One mailbox: its error is the answer. Several: report what was saved; each mailbox shows its own error.
    if (errors.length && errors.length === boxes.length) throw new BadRequestException(errors.join(' · '));
    return { data: { saved, read: 0, busy, errors } };
  }

  /** Save new emails and their attachments, mark them in the mailbox, then let Claude read each. */
  private async checkMailbox(mb: ReferralMailbox): Promise<{ saved: number; busy: boolean; error: string | null }> {
    if (this.checking.has(mb.id)) return { saved: 0, busy: true, error: null };
    this.checking.add(mb.id);
    let saved = 0;
    const newIds: string[] = [];
    let connector;
    try {
      connector = this.connectors.connector(mb);
      // A wide window, then only the ones not saved yet (at most 20 per check): a mailbox whose server doesn't
      // keep CareFlow's mark can't get stuck on the same old emails.
      const listed = await connector.listNew(200);
      const alreadySaved = new Set(
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
          const savedId = await this.saveFetched(mb, await connector.fetch(messageId));
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
      if (newIds.length) void this.readInBackground(newIds);
      await connector?.close().catch(() => undefined);
      this.checking.delete(mb.id);
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
  private async saveFetched(mb: ReferralMailbox, email: FetchedEmail): Promise<string | null> {
    const mailboxId = mb.id;
    if (email.fromEmail && email.fromEmail.toLowerCase() === mb.emailAddress.toLowerCase()) return null;
    const id = randomUUID();
    const dir = path.join(STORAGE_ROOT, id);
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
          select: { id: true, enquiryId: true, locationId: true },
        })
      : null;
    if (!original) return id;
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
    return null;
  }

  private async readInBackground(ids: string[]) {
    for (const id of ids) {
      await this.readEmail(id).catch((e: Error) => this.logger.warn(`Reading referral email ${id} failed: ${e.message}`));
    }
  }

  /** On start-up, read any emails left unread (for example when the API restarted while reading). */
  async onApplicationBootstrap() {
    const pending = await this.prisma.referralEmail.findMany({
      where: { status: ReferralEmailStatus.RECEIVED },
      select: { id: true },
      take: 20,
    });
    if (pending.length) void this.readInBackground(pending.map((p) => p.id));
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

  /** Claude reads the email and its attachments (also used for "Read again"). */
  async readEmail(id: string) {
    const row = await this.prisma.referralEmail.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Referral email not found');
    const files = (row.attachments as unknown as StoredAttachment[]) ?? [];
    const inputs: ExtractionAttachment[] = [];
    for (const f of files) {
      if (!f.storedName) continue;
      const data = await fs.readFile(path.join(STORAGE_ROOT, row.id, f.storedName));
      const text =
        f.mimeType === DOCX_MIME
          ? await docxToText(data).catch(() => '')
          : f.mimeType.startsWith('text/')
            ? data.toString('utf8')
            : undefined;
      inputs.push({ fileName: f.fileName, mimeType: f.mimeType, data, text });
    }
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
          status:
            row.status === ReferralEmailStatus.ENQUIRY_CREATED || row.status === ReferralEmailStatus.FOLLOW_UP
              ? row.status
              : handled
                ? ReferralEmailStatus.READ
                : ReferralEmailStatus.NOT_A_REFERRAL,
        },
      });
      if (handled && row.status !== ReferralEmailStatus.FOLLOW_UP) {
        await this.automation
          .process(id)
          .catch((err: Error) => this.logger.warn(`Referral automation for ${id} failed: ${err.message}`));
      }
      const fresh = await this.prisma.referralEmail.findUniqueOrThrow({ where: { id } });
      return { data: this.present(fresh) };
    } catch (e) {
      await this.prisma.referralEmail.update({
        where: { id },
        data: { status: ReferralEmailStatus.FAILED, error: (e as Error).message?.slice(0, 2000) ?? 'Reading failed' },
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
    return { path: path.join(STORAGE_ROOT, row.id, f.storedName), fileName: f.fileName, mimeType: f.mimeType };
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
