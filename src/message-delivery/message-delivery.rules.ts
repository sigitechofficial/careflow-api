import { findKind, kindId, type MessageChannel } from './message-kinds';

export type MessageAudience = 'EVERYONE' | 'ALLOWED_ONLY';

/** The delivery settings the rules need (the database row, or the defaults when there is none). */
export type DeliveryRules = {
  emailEnabled: boolean;
  textEnabled: boolean;
  whatsappEnabled: boolean;
  pushEnabled: boolean;
  emailAudience: MessageAudience;
  textAudience: MessageAudience;
  pushAudience: MessageAudience;
  /** Exact addresses ("sam@nhs.net") or whole domains ("@allforcare.co.uk"). */
  allowedEmails: string[];
  /** UK mobiles, any format; compared as +44 numbers. */
  allowedPhones: string[];
  /** "<CHANNEL>:<kind>" entries that are switched off. */
  disabledKinds: string[];
  /** Emails held back are sent here instead (subject says who they were for), so testers can see them. */
  heldEmailsTo: string | null;
};

/** No settings saved: everything is sent to everyone, as before the settings existed. */
export const DEFAULT_DELIVERY_RULES: DeliveryRules = {
  emailEnabled: true,
  textEnabled: true,
  whatsappEnabled: true,
  pushEnabled: true,
  emailAudience: 'EVERYONE',
  textAudience: 'EVERYONE',
  pushAudience: 'EVERYONE',
  allowedEmails: [],
  allowedPhones: [],
  disabledKinds: [],
  heldEmailsTo: null,
};

export type HoldReason = 'CHANNEL_OFF' | 'TYPE_OFF' | 'NOT_ALLOWED';

export const HOLD_REASON_TEXT: Record<HoldReason, string> = {
  CHANNEL_OFF: 'Sending is switched off for this channel',
  TYPE_OFF: 'This type of message is switched off',
  NOT_ALLOWED: 'Not on the allowed list (sending is limited to allowed recipients)',
};

export const normaliseEmail = (x: string) => x.trim().toLowerCase();

/** A UK mobile or landline as +44…, so "07700 900123" and "+447700900123" match. Other numbers: digits only. */
export function normalisePhone(x: string): string {
  const digits = x.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0044')) return `+${digits.slice(2)}`;
  if (digits.startsWith('44')) return `+${digits}`;
  if (digits.startsWith('0')) return `+44${digits.slice(1)}`;
  return digits;
}

export function emailAllowed(rules: Pick<DeliveryRules, 'allowedEmails'>, address: string): boolean {
  const a = normaliseEmail(address);
  return rules.allowedEmails.some((entry) => {
    const e = normaliseEmail(entry);
    return e.startsWith('@') ? a.endsWith(e) : a === e;
  });
}

export function phoneAllowed(rules: Pick<DeliveryRules, 'allowedPhones'>, number: string): boolean {
  const n = normalisePhone(number);
  return rules.allowedPhones.some((p) => normalisePhone(p) === n);
}

const channelOn = (r: DeliveryRules, c: MessageChannel) =>
  c === 'EMAIL' ? r.emailEnabled : c === 'TEXT' ? r.textEnabled : c === 'WHATSAPP' ? r.whatsappEnabled : r.pushEnabled;

/** WhatsApp follows the text message audience and phone list (both go to mobiles). */
const audienceOf = (r: DeliveryRules, c: MessageChannel) =>
  c === 'EMAIL' ? r.emailAudience : c === 'PUSH' ? r.pushAudience : r.textAudience;

export type DeliveryDecision = {
  kind: string;
  allowed: string[];
  held: Array<{ recipient: string; reason: HoldReason }>;
};

/**
 * Who a message may go to. `recipients` are email addresses (EMAIL, and PUSH, where a carer is matched by their
 * email) or phone numbers (TEXT, WHATSAPP). Recipients are kept in their original form.
 */
export function decideDelivery(
  rules: DeliveryRules,
  channel: MessageChannel,
  kindKey: string | undefined,
  recipients: string[],
): DeliveryDecision {
  const kind = findKind(channel, kindKey);
  const list = [...new Set(recipients.map((r) => r.trim()).filter(Boolean))];
  const hold = (reason: HoldReason): DeliveryDecision => ({ kind: kind.key, allowed: [], held: list.map((recipient) => ({ recipient, reason })) });
  if (!channelOn(rules, channel)) return hold('CHANNEL_OFF');
  if (rules.disabledKinds.includes(kindId(channel, kind.key))) return hold('TYPE_OFF');
  if (audienceOf(rules, channel) === 'EVERYONE' || kind.essential) return { kind: kind.key, allowed: list, held: [] };
  const ok = (r: string) => (channel === 'TEXT' || channel === 'WHATSAPP' ? phoneAllowed(rules, r) : emailAllowed(rules, r));
  return {
    kind: kind.key,
    allowed: list.filter(ok),
    held: list.filter((r) => !ok(r)).map((recipient) => ({ recipient, reason: 'NOT_ALLOWED' as const })),
  };
}
