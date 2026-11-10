import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_DELIVERY_RULES,
  HOLD_REASON_TEXT,
  decideDelivery,
  type DeliveryDecision,
  type DeliveryRules,
  type MessageAudience,
} from './message-delivery.rules';
import type { MessageChannel } from './message-kinds';

const SETTINGS_ID = 'default';
/** Settings are read on every send; each server re-reads them at most this often (a save clears it at once here). */
const CACHE_MS = 30_000;
/** Log rows are kept this long; older ones are removed now and then as new ones are written. */
export const DELIVERY_LOG_DAYS = 30;

export type DeliveryOutcome = 'SENT' | 'HELD' | 'REDIRECTED' | 'FAILED';

/** "07700 900123" → "07700 ••• 123": numbers are never stored or shown in full in the log. */
export function maskPhone(n: string): string {
  const d = n.replace(/\s+/g, '');
  return d.length <= 6 ? '•••' : `${d.slice(0, d.length - 6)}•••${d.slice(-3)}`;
}

/**
 * The one place that decides whether an email, text, WhatsApp message or push notification may go out, and the
 * record of what went out or was held back. Senders call `decide` before sending and `record` afterwards.
 * Never throws: if the settings can't be read, messages go out as before (the defaults).
 */
@Injectable()
export class MessageDeliveryService {
  private readonly logger = new Logger(MessageDeliveryService.name);
  private cache: { rules: DeliveryRules; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async rules(): Promise<DeliveryRules> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.rules;
    try {
      const row = await this.prisma.messageDeliverySettings.findUnique({ where: { id: SETTINGS_ID } });
      const rules: DeliveryRules = row
        ? {
            emailEnabled: row.emailEnabled,
            textEnabled: row.textEnabled,
            whatsappEnabled: row.whatsappEnabled,
            pushEnabled: row.pushEnabled,
            emailAudience: row.emailAudience as MessageAudience,
            textAudience: row.textAudience as MessageAudience,
            pushAudience: row.pushAudience as MessageAudience,
            allowedEmails: row.allowedEmails,
            allowedPhones: row.allowedPhones,
            disabledKinds: row.disabledKinds,
            heldEmailsTo: row.heldEmailsTo,
          }
        : DEFAULT_DELIVERY_RULES;
      this.cache = { rules, at: Date.now() };
      return rules;
    } catch (err) {
      this.logger.warn(`Message delivery settings could not be read, sending as normal: ${(err as Error).message}`);
      return this.cache?.rules ?? DEFAULT_DELIVERY_RULES;
    }
  }

  clearCache() {
    this.cache = null;
  }

  async decide(channel: MessageChannel, kind: string | undefined, recipients: string[]): Promise<DeliveryDecision & { heldEmailsTo: string | null }> {
    const rules = await this.rules();
    return { ...decideDelivery(rules, channel, kind, recipients), heldEmailsTo: channel === 'EMAIL' ? rules.heldEmailsTo : null };
  }

  /** Adds rows to the delivery log. Never fails the send that called it. */
  async record(
    channel: MessageChannel,
    kind: string,
    rows: Array<{ recipient: string; outcome: DeliveryOutcome; reason?: string | null }>,
    subject?: string | null,
  ): Promise<void> {
    if (!rows.length) return;
    const phone = channel === 'TEXT' || channel === 'WHATSAPP';
    try {
      await this.prisma.messageDeliveryLog.createMany({
        data: rows.map((r) => ({
          channel,
          kind,
          recipient: (phone ? maskPhone(r.recipient) : r.recipient).slice(0, 320),
          subject: subject?.slice(0, 300) ?? null,
          outcome: r.outcome,
          reason: r.reason?.slice(0, 500) ?? null,
        })),
      });
      // Keep the log small without a scheduled job: about one write in fifty clears rows past the retention.
      if (Math.random() < 0.02) {
        await this.prisma.messageDeliveryLog.deleteMany({ where: { at: { lt: new Date(Date.now() - DELIVERY_LOG_DAYS * 86_400_000) } } });
      }
    } catch (err) {
      this.logger.warn(`Message delivery log could not be written: ${(err as Error).message}`);
    }
  }

  /** Log rows for the held recipients of a decision. */
  heldRows(decision: DeliveryDecision) {
    return decision.held.map((h) => ({ recipient: h.recipient, outcome: 'HELD' as const, reason: HOLD_REASON_TEXT[h.reason] }));
  }
}
