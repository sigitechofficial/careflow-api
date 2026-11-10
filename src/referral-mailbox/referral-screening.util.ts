/**
 * Screening: decides whether a new email is worth a full read by Claude, before any money is spent on it.
 * Free rules first; only emails the rules can't place get a quick, very cheap check (sender, subject and the first
 * lines, by the smallest model). Emails screened out are still saved and shown ("Filtered out"), never read.
 */

export type ScreeningMode = 'OFF' | 'RULES' | 'RULES_AND_AI';

export type ScreeningSettings = {
  /** OFF: every email is read in full. RULES: free rules only (unclear emails are read). RULES_AND_AI: unclear emails get the quick check. */
  mode: ScreeningMode;
  /** Always brought in: addresses ("gp@nhs.net"), domains ("@croydon.gov.uk") or domain endings (".nhs.uk", ".gov.uk"). */
  trustedSenders: string[];
  /** Never brought in (same forms). */
  blockedSenders: string[];
};

export const DEFAULT_SCREENING: ScreeningSettings = {
  mode: 'RULES_AND_AI',
  // Public bodies that send referrals: the NHS and councils.
  trustedSenders: ['@nhs.net', '.nhs.uk', '.gov.uk'],
  blockedSenders: [],
};

export function normaliseScreening(raw: unknown): ScreeningSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ScreeningSettings>;
  const list = (v: unknown, fallback: string[]) =>
    Array.isArray(v)
      ? [...new Set(v.map((x) => String(x).trim().toLowerCase()).filter((x) => /^(@|\.)?[^\s@]+(@[^\s@]+)?$/.test(x) && x.length <= 200))].slice(0, 300)
      : fallback;
  return {
    mode: r.mode === 'OFF' || r.mode === 'RULES' || r.mode === 'RULES_AND_AI' ? r.mode : DEFAULT_SCREENING.mode,
    trustedSenders: list(r.trustedSenders, DEFAULT_SCREENING.trustedSenders),
    blockedSenders: list(r.blockedSenders, DEFAULT_SCREENING.blockedSenders),
  };
}

/** "sam@nhs.net" matches "sam@nhs.net", "@nhs.net" and ".net"; "x@croydon.gov.uk" matches ".gov.uk". */
export function senderMatches(address: string, entries: string[]): string | null {
  const a = address.trim().toLowerCase();
  const domain = a.split('@')[1] ?? '';
  for (const e of entries) {
    if (e.includes('@') && !e.startsWith('@') ? a === e : e.startsWith('@') ? domain === e.slice(1) : e.startsWith('.') ? domain.endsWith(e) || `.${domain}` === e : domain === e) {
      return e;
    }
  }
  return null;
}

/** Senders that are machines, not people. */
const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|alerts?|newsletters?|news|marketing|promotions?|updates|digest|automated|system)([+._-].*)?@/i;

/** Subjects that are never a care referral. */
const JUNK_SUBJECT =
  /\b(newsletter|webinar|unsubscribe|security alert|sign[- ]?in (code|attempt)|verification code|verify your|confirm your (email|account)|password (reset|changed)|your (receipt|order|invoice|statement|subscription)|order confirmation|delivery (update|notification)|% off|black friday|cyber monday|free trial|limited time|special offer|livestream|account (was )?recovered)\b/i;

/** Words that make an email about someone's care (subject or body). */
const CARE_WORDS =
  /\b(referr(al|ed|ing)|care package|package of care|poc|home ?care|domiciliary|discharge|carer|care worker|personal care|visits? (a|per) day|double[- ]up|care plan|care needs|support plan|reablement|respite|live[- ]in care|end of life|fast[- ]?track|chc|social worker|brokerage|commission(ing|er)|my (mum|mom|mother|dad|father|husband|wife|nan|gran)|elderly|dementia|mobility|hoist|medication support|quote|how much (do|does|would)|your (rates|prices|charges))\b/i;

export type RuleVerdict = { decision: 'BRING' | 'SKIP' | 'UNSURE'; reason: string };

/**
 * The free rules, in order: trusted senders and people we already deal with are always brought in; blocked and
 * automated senders and junk subjects are skipped; care words bring an email in; anything else is unsure.
 */
export function screenByRules(
  email: { fromEmail: string | null; subject: string | null; bodyText: string },
  settings: ScreeningSettings,
  ctx: { knownSender: boolean },
): RuleVerdict {
  if (settings.mode === 'OFF') return { decision: 'BRING', reason: 'Screening is off' };
  const from = (email.fromEmail ?? '').trim().toLowerCase();
  const subject = email.subject ?? '';
  const start = (email.bodyText ?? '').slice(0, 3000);
  const trusted = from ? senderMatches(from, settings.trustedSenders) : null;
  if (trusted) return { decision: 'BRING', reason: `Trusted sender (${trusted})` };
  if (ctx.knownSender) return { decision: 'BRING', reason: 'Has written to us about care before' };
  const blocked = from ? senderMatches(from, settings.blockedSenders) : null;
  if (blocked) return { decision: 'SKIP', reason: `Blocked sender (${blocked})` };
  const care = CARE_WORDS.test(subject) || CARE_WORDS.test(start);
  if (from && AUTOMATED_SENDER.test(from) && !care) return { decision: 'SKIP', reason: 'Automated sender (no-reply, notifications…)' };
  if (JUNK_SUBJECT.test(subject) && !CARE_WORDS.test(subject)) return { decision: 'SKIP', reason: 'Subject is a newsletter, alert, receipt or offer' };
  if (care) return { decision: 'BRING', reason: 'Mentions care' };
  if (/\bunsubscribe\b/i.test(start) || /\bunsubscribe\b/i.test(email.bodyText ?? '')) return { decision: 'SKIP', reason: 'Mailing list (has an unsubscribe link)' };
  return { decision: 'UNSURE', reason: 'No clear sign either way' };
}
