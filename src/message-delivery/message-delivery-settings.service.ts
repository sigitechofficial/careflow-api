import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { MailService } from '../mail/mail.service';
import { TextMessageService } from '../text-messages/text-message.service';
import { FcmPushService } from '../notifications/fcm-push.service';
import { MessageDeliveryService, DELIVERY_LOG_DAYS } from './message-delivery.service';
import { MESSAGE_AUDIENCES, MESSAGE_KINDS, kindId } from './message-kinds';
import { normaliseEmail, normalisePhone, type DeliveryRules } from './message-delivery.rules';
import type { MessageDeliveryLogQueryDto, SendTestMessageDto, UpdateMessageDeliveryDto } from './dto/message-delivery.dto';

const SETTINGS_ID = 'default';
const VALID_KIND_IDS = new Set(MESSAGE_KINDS.map((k) => kindId(k.channel, k.key)));

/** Administration › Message delivery: the settings screen, the delivery log and test messages. */
@Injectable()
export class MessageDeliverySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: MessageDeliveryService,
    private readonly config: ConfigService,
    private readonly auditLogs: AuditLogsService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly texts?: TextMessageService,
    @Optional() private readonly push?: FcmPushService,
  ) {}

  /** What is set up on this server (environment, not changeable here), shown so the screen tells the whole story. */
  private environment() {
    const redirect = (this.config.get<string>('mail.redirectTo') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const textMode = this.texts?.mode ?? 'off';
    return {
      production: (process.env.NODE_ENV ?? 'development') === 'production',
      email: {
        mode: this.config.get<string>('mail.mode', 'log'),
        /** MAIL_REDIRECT_TO: every email goes to these inboxes instead (laptops and test servers). */
        redirectTo: redirect,
        bccCount: (this.config.get<string[]>('mail.bcc') ?? []).length,
      },
      text: { mode: textMode, provider: this.texts?.providerName() ?? null },
      whatsapp: { configured: false },
      push: { ready: this.push?.isReady() ?? false },
    };
  }

  private view(rules: DeliveryRules, row: { updatedAt: Date; updatedById: string | null } | null) {
    // Switches for message types that no longer exist are dropped, so they never block a save.
    const disabledKinds = rules.disabledKinds.filter((k) => VALID_KIND_IDS.has(k));
    return {
      ...rules,
      disabledKinds,
      kinds: MESSAGE_KINDS.map((k) => ({ ...k, id: kindId(k.channel, k.key), enabled: !disabledKinds.includes(kindId(k.channel, k.key)) })),
      audiences: Object.entries(MESSAGE_AUDIENCES).map(([key, a]) => ({ key, ...a })),
      environment: this.environment(),
      updatedAt: row?.updatedAt ?? null,
      updatedById: row?.updatedById ?? null,
    };
  }

  async get() {
    this.delivery.clearCache();
    const [rules, row, counts] = await Promise.all([
      this.delivery.rules(),
      this.prisma.messageDeliverySettings.findUnique({ where: { id: SETTINGS_ID }, select: { updatedAt: true, updatedById: true } }),
      this.prisma.messageDeliveryLog.groupBy({
        by: ['channel', 'kind', 'outcome'],
        where: { at: { gte: new Date(Date.now() - 86_400_000) } },
        _count: { _all: true },
      }),
    ]);
    return {
      data: {
        ...this.view(rules, row),
        last24h: counts.map((c) => ({ channel: c.channel, kind: c.kind, outcome: c.outcome, count: c._count._all })),
        logDays: DELIVERY_LOG_DAYS,
      },
    };
  }

  async update(dto: UpdateMessageDeliveryDto, userId: string, meta: RequestAuditMeta) {
    const before = { ...(await this.delivery.rules()) };
    const unknown = (dto.disabledKinds ?? []).filter((k) => !VALID_KIND_IDS.has(k));
    if (unknown.length) throw new BadRequestException(`Unknown message types: ${unknown.join(', ')}`);
    before.disabledKinds = before.disabledKinds.filter((k) => VALID_KIND_IDS.has(k));
    const data: Prisma.MessageDeliverySettingsUncheckedCreateInput = { id: SETTINGS_ID, updatedById: userId };
    for (const k of ['emailEnabled', 'textEnabled', 'whatsappEnabled', 'pushEnabled', 'emailAudience', 'textAudience', 'pushAudience'] as const) {
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k];
    }
    if (dto.allowedEmails) data.allowedEmails = [...new Set(dto.allowedEmails.map(normaliseEmail).filter(Boolean))];
    if (dto.allowedPhones) data.allowedPhones = [...new Set(dto.allowedPhones.map((p) => p.trim()).filter(Boolean))];
    if (dto.disabledKinds) data.disabledKinds = [...new Set(dto.disabledKinds)];
    if (dto.heldEmailsTo !== undefined) data.heldEmailsTo = dto.heldEmailsTo ? normaliseEmail(dto.heldEmailsTo) : null;

    // Limiting a channel with nobody on its list would hold everything back: say so instead of saving it.
    const next = { ...before, ...data } as DeliveryRules;
    if (next.emailAudience === 'ALLOWED_ONLY' && !next.allowedEmails.length) {
      throw new BadRequestException('Add at least one allowed email or domain before limiting emails to the allowed list.');
    }
    if (next.textAudience === 'ALLOWED_ONLY' && !next.allowedPhones.length) {
      throw new BadRequestException('Add at least one allowed phone number before limiting texts to the allowed list.');
    }
    if (next.pushAudience === 'ALLOWED_ONLY' && !next.allowedEmails.length) {
      throw new BadRequestException('Add at least one allowed email before limiting push notifications (carers are matched by their email).');
    }

    const { id: _id, ...updateData } = data;
    await this.prisma.messageDeliverySettings.upsert({ where: { id: SETTINGS_ID }, create: data, update: updateData });
    this.delivery.clearCache();
    const after = await this.delivery.rules();
    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.MESSAGE_DELIVERY,
      action: 'message_delivery_settings_updated',
      recordType: 'MessageDeliverySettings',
      description: 'Updated message delivery settings',
      oldValues: before as unknown as Record<string, unknown>,
      newValues: after as unknown as Record<string, unknown>,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return this.get();
  }

  async log(q: MessageDeliveryLogQueryDto) {
    const term = q.q?.trim();
    const rows = await this.prisma.messageDeliveryLog.findMany({
      where: {
        ...(q.channel ? { channel: q.channel } : {}),
        ...(q.outcome ? { outcome: q.outcome } : {}),
        ...(term
          ? {
              OR: [
                { recipient: { contains: term, mode: 'insensitive' } },
                { subject: { contains: term, mode: 'insensitive' } },
                { kind: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { at: 'desc' },
      take: q.limit ?? 100,
    });
    return { data: { items: rows } };
  }

  /** A test message through the same rules as everything else (type "Test messages"), to check delivery works. */
  async sendTest(dto: SendTestMessageDto) {
    const to = dto.to.trim();
    if (dto.channel === 'EMAIL') {
      if (!this.mail) throw new BadRequestException('Email is not set up on this server.');
      const sent = await this.mail.send({
        kind: 'test',
        to,
        subject: 'CareFlow test email',
        text: 'This is a test email from CareFlow (Administration › Message delivery). No action is needed.',
        skipBcc: true,
      });
      return { data: { message: `Test email handed to the mail service (${sent.mode}).` } };
    }
    if (dto.channel === 'TEXT') {
      if (!this.texts) throw new BadRequestException('Text messages are not set up on this server.');
      const r = await this.texts.send({ kind: 'test', to: normalisePhone(to), body: 'CareFlow test text. No action is needed.' });
      if (!r.sent) {
        const why = { OFF: 'text messages are off on this server', HELD: 'held back by these settings', INVALID_NUMBER: 'that is not a UK mobile number', TOO_LONG: 'too long', FAILED: 'the provider refused it' }[r.reason];
        throw new BadRequestException(`Test text not sent: ${why}.`);
      }
      return { data: { message: `Test text sent (${this.texts.providerName() === 'log' ? 'written to the log only: no text provider is set up' : this.texts.providerName()}).` } };
    }
    if (!this.push) throw new BadRequestException('Push notifications are not set up on this server.');
    const person = await this.prisma.employeePersonalDetail.findFirst({
      where: { email: { equals: to, mode: 'insensitive' } },
      select: { employeeId: true },
    });
    if (!person) throw new BadRequestException('No carer has that email address.');
    const report = await this.push.sendToEmployees([person.employeeId], { title: 'CareFlow test', body: 'This is a test notification. No action is needed.' }, 'test');
    const why: Record<string, string> = {
      SENT: `sent to ${report.sent} device(s)`,
      HELD: 'held back by these settings',
      NO_DEVICE_TOKEN: 'that carer has no phone signed in to the carer app',
      FIREBASE_NOT_READY: 'push is not set up on this server (no Firebase key)',
      SEND_FAILED: `Firebase refused it${report.error ? `: ${report.error}` : ''}`,
    };
    if (report.reason !== 'SENT') throw new BadRequestException(`Test notification not sent: ${why[report.reason] ?? report.reason}.`);
    return { data: { message: `Test notification ${why.SENT}.` } };
  }
}
