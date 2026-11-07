import { randomInt } from 'crypto';

/**
 * The 4-week contact rule and sampling (Phase 2 part 2). Nobody is sent a survey within 4 weeks of
 * their last survey contact, unless the survey is exempt (library timing.contactRule, or the
 * organisation's choice with a reason) or a manager sends it anyway with a reason. Pure helpers;
 * SurveyContactRuleService does the database work.
 */
export const CONTACT_RULE_DAYS = 28;
/** Held-back people are sent the survey on their free day only if it stays open at least this long. */
export const HELD_BACK_MIN_DAYS_LEFT = 3;
export const SAMPLING_MIN_PERCENT = 5;
export const SAMPLING_MAX_PERCENT = 100;

/**
 * What happens to someone held back: DELAY (default) sends it on their free day if the survey is still open;
 * SKIP does not send it to them at all this time (recorded as not sent). Routine and sampled surveys skip
 * (staff priority tier 4: supervision feedback, on-call, training Part B).
 */
export type WhenHeld = 'DELAY' | 'SKIP';
export type SurveyContactRule = { holdBack: boolean; countsAsContact: boolean; whenHeld: WhenHeld; reason: string | null };
export type ContactRuleSource = 'SURVEY' | 'LIBRARY' | 'DEFAULT';
export type SurveySampling = { percent: number };
/** The survey a rule is worked out for: its audience and anonymity set the default. */
export type RuleSubject = { targetKind?: string | null; isAnonymous?: boolean | null };
/** The library's rule: its words (reason) say why it differs from the default. */
export type LibraryContactRule = { holdBack: boolean; countsAsContact: boolean; whenHeld: WhenHeld; reason: string | null };

/** Linked parts sent together (library timing.sentWith) never hold each other back when sent this close. */
export const SENT_WITH_DAYS = 7;

/**
 * The default when neither the survey nor the library says otherwise. Named surveys, and every survey to
 * people we support: both on. Anonymous staff surveys follow the planned all-staff calendar (one longer
 * all-staff survey a month, never two open at once): the 4-week rule is for named staff surveys only
 * (decision file contact-frequency.md, "Staff"), so they neither hold anyone back nor count as a contact.
 */
export function defaultContactRule(subject?: RuleSubject): SurveyContactRule & { calendar: boolean } {
  if (subject?.targetKind === 'EMPLOYEE' && subject.isAnonymous) {
    return { holdBack: false, countsAsContact: false, whenHeld: 'DELAY', reason: null, calendar: true };
  }
  return { holdBack: true, countsAsContact: true, whenHeld: 'DELAY', reason: null, calendar: false };
}

function readWhenHeld(v: unknown): WhenHeld | null {
  if (v === undefined || v === null) return 'DELAY';
  const t = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return t === 'SKIP' ? 'SKIP' : t === 'DELAY' ? 'DELAY' : null;
}

/** The library's rule for a ready-made survey (libraryMeta.timing.contactRule), or null when it has none. */
export function libraryContactRule(libraryMeta: unknown): LibraryContactRule | null {
  const timing = (libraryMeta as { timing?: { contactRule?: unknown } } | null)?.timing;
  const r = timing?.contactRule as { holdBack?: unknown; countsAsContact?: unknown; whenHeld?: unknown; reason?: unknown } | undefined;
  if (!r || typeof r.holdBack !== 'boolean' || typeof r.countsAsContact !== 'boolean') return null;
  return {
    holdBack: r.holdBack,
    countsAsContact: r.countsAsContact,
    whenHeld: readWhenHeld(r.whenHeld) ?? 'DELAY',
    reason: typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim() : null,
  };
}

/** Library references this survey is sent with as linked parts (libraryMeta.timing.sentWith). */
export function librarySentWith(libraryMeta: unknown): string[] {
  const v = (libraryMeta as { timing?: { sentWith?: unknown } } | null)?.timing?.sentWith;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

function storedRule(raw: unknown): SurveyContactRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.holdBack !== 'boolean' || typeof r.countsAsContact !== 'boolean') return null;
  return {
    holdBack: r.holdBack,
    countsAsContact: r.countsAsContact,
    whenHeld: readWhenHeld(r.whenHeld) ?? 'DELAY',
    reason: typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim() : null,
  };
}

/**
 * The rule a survey follows. `owner` holds the settings (a repeating survey's periods use their
 * source survey's); `libraryMeta` is the ready-made survey's details (the catalogue survey's, found by
 * libraryReference). The survey's own setting wins, then the library's, then the default (both on;
 * anonymous staff surveys: neither, see defaultContactRule).
 */
export function effectiveContactRule(
  owner: { contactRule?: unknown } & RuleSubject,
  libraryMeta?: unknown,
): SurveyContactRule & { source: ContactRuleSource } {
  const own = storedRule(owner.contactRule);
  if (own) return { ...own, source: 'SURVEY' };
  const lib = libraryContactRule(libraryMeta);
  if (lib) return { ...lib, source: 'LIBRARY' };
  const { calendar: _calendar, ...def } = defaultContactRule(owner);
  return { ...def, source: 'DEFAULT' };
}

/**
 * Check a change to a survey's rule (any survey, including a copy started from a ready-made template:
 * e.g. hold-back switched back on for a follow-up copy the library exempts). A setting that differs
 * from the default (the library's, else the survey's default) needs a reason (5–300 characters). null =
 * back to the default.
 */
export function checkContactRuleInput(
  input: unknown,
  libraryMeta: unknown,
  subject?: RuleSubject,
): { ok: true; rule: SurveyContactRule | null } | { ok: false; message: string } {
  if (input === null) return { ok: true, rule: null };
  if (!input || typeof input !== 'object') return { ok: false, message: 'Choose how the 4-week rule applies to this survey.' };
  const r = input as Record<string, unknown>;
  if (typeof r.holdBack !== 'boolean' || typeof r.countsAsContact !== 'boolean') {
    return { ok: false, message: 'Choose how the 4-week rule applies to this survey.' };
  }
  const whenHeld = readWhenHeld(r.whenHeld);
  if (!whenHeld) return { ok: false, message: 'Choose whether people held back are sent it later or not at all.' };
  const reason = typeof r.reason === 'string' ? r.reason.trim() : '';
  if (reason.length > 300) return { ok: false, message: 'Keep the reason under 300 characters.' };
  const base = libraryContactRule(libraryMeta) ?? defaultContactRule(subject);
  // whenHeld only matters while people are held back.
  const effWhen = r.holdBack ? whenHeld : base.whenHeld;
  if (r.holdBack === base.holdBack && r.countsAsContact === base.countsAsContact && effWhen === base.whenHeld) return { ok: true, rule: null };
  if (reason.length < 5) {
    return {
      ok: false,
      message: !r.holdBack && base.holdBack
        ? 'Say why people surveyed in the last 4 weeks should be sent this survey too.'
        : 'Say why this survey should follow the 4-week rule differently from usual.',
    };
  }
  return { ok: true, rule: { holdBack: r.holdBack, countsAsContact: r.countsAsContact, whenHeld: effWhen, reason } };
}

/** Repeats this often or more need a reason: periods of one series never hold each other back. */
export const SHORT_REPEATS = ['WEEKLY'] as const;
export function isShortRepeat(recurrence: string | null | undefined): boolean {
  return Boolean(recurrence && (SHORT_REPEATS as readonly string[]).includes(recurrence));
}
/** The reason kept for a short repeat (contactRule.repeatReason), or null. */
export function storedRepeatReason(raw: unknown): string | null {
  const v = (raw as { repeatReason?: unknown } | null)?.repeatReason;
  return typeof v === 'string' && v.trim().length >= 5 ? v.trim() : null;
}
/** The library's reason for a short repeat (timing.repeatReason), or null. */
export function libraryRepeatReason(libraryMeta: unknown): string | null {
  const v = (libraryMeta as { timing?: { repeatReason?: unknown } } | null)?.timing?.repeatReason;
  return typeof v === 'string' && v.trim().length >= 5 ? v.trim() : null;
}

export function readSampling(raw: unknown): SurveySampling | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = (raw as { percent?: unknown }).percent;
  if (typeof p !== 'number' || !Number.isInteger(p) || p < SAMPLING_MIN_PERCENT || p >= SAMPLING_MAX_PERCENT) return null;
  return { percent: p };
}

export function checkSamplingInput(input: unknown): { ok: true; sampling: SurveySampling | null } | { ok: false; message: string } {
  if (input === null) return { ok: true, sampling: null };
  const p = (input as { percent?: unknown } | undefined)?.percent;
  if (typeof p !== 'number' || !Number.isInteger(p) || p < SAMPLING_MIN_PERCENT || p > SAMPLING_MAX_PERCENT) {
    return { ok: false, message: `Choose a share between ${SAMPLING_MIN_PERCENT}% and ${SAMPLING_MAX_PERCENT}%.` };
  }
  return { ok: true, sampling: p === SAMPLING_MAX_PERCENT ? null : { percent: p } };
}

/** Last day still within the rule for a contact on `lastDay` (YYYY-MM-DD): free from lastDay + 28. */
export function addIsoDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function freeFromDay(lastContactDay: string): string {
  return addIsoDays(lastContactDay, CONTACT_RULE_DAYS);
}

/** Held back today when their last contact day is less than 28 days before today. */
export function isHeldBack(lastContactDay: string, today: string): boolean {
  return freeFromDay(lastContactDay) > today;
}

/**
 * Choose a share of the people: those asked least often in this series first, random among equals
 * (crypto), never fewer than `minimum` (the anonymous minimum) when there are that many.
 */
export function chooseSample(
  ids: string[],
  percent: number,
  timesAsked: Map<string, number>,
  minimum = 0,
  rand: (max: number) => number = (max) => randomInt(max),
): string[] {
  if (percent >= SAMPLING_MAX_PERCENT) return [...ids];
  const want = Math.min(ids.length, Math.max(Math.ceil((ids.length * percent) / 100), minimum, ids.length ? 1 : 0));
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = rand(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // Stable sort keeps the random order among people asked equally often.
  return shuffled
    .map((id, order) => ({ id, order, asked: timesAsked.get(id) ?? 0 }))
    .sort((a, b) => a.asked - b.asked || a.order - b.order)
    .slice(0, want)
    .map((x) => x.id);
}
