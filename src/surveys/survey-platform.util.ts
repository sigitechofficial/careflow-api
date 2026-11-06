/**
 * Platform items (Phase 2 part 7): repeats that skip months, a rotating question, grouped answer choices, answer
 * retention, and the wording checker. Pure helpers; SurveyPlatformService does the database work.
 */
import { BadRequestException } from '@nestjs/common';
import type { SurveyRecurrence } from '@prisma/client';
import { DEFAULT_OPERATIONAL_TIMEZONE } from '../common/utils/operational-day.util';
import { nextSurveyDistributeAt } from './survey-recurrence.util';
import { parseRetentionNotice, type RetentionBasis, type RetentionRule } from '../../prisma/seed-lib/survey-retention';

export { parseRetentionNotice, type RetentionBasis, type RetentionRule };

// ─── Repeats that skip months ────────────────────────────────────────────

export const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The month (1–12) of an instant in the organisation's time zone. */
export function monthIn(at: Date, timeZone = DEFAULT_OPERATIONAL_TIMEZONE): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, month: 'numeric' }).format(at));
}

export function isSkippedMonth(at: Date, skipMonths: readonly number[] | null | undefined, timeZone = DEFAULT_OPERATIONAL_TIMEZONE): boolean {
  return Boolean(skipMonths?.length) && skipMonths!.includes(monthIn(at, timeZone));
}

/** The next run after `after` / `now` that is not in a skipped month. */
export function nextRunSkipping(
  anchor: Date,
  recurrence: SurveyRecurrence,
  after: Date,
  now: Date,
  timeZone: string,
  skipMonths: readonly number[] | null | undefined,
): Date {
  let at = nextSurveyDistributeAt(anchor, recurrence, after, now, timeZone);
  // Every month this repeat runs in is skipped (a yearly or quarterly repeat whose months were all chosen): skipping
  // would put the next run decades away without saying so, so the months are not applied.
  if (skipMonths?.length && runMonthsOf(anchor, recurrence, timeZone).every((m) => skipMonths.includes(m))) return at;
  for (let guard = 0; guard < 120 && isSkippedMonth(at, skipMonths, timeZone); guard += 1) {
    at = nextSurveyDistributeAt(anchor, recurrence, at, at, timeZone);
  }
  return at;
}

/** The months (1–12, organisation time) a repeat runs in: every month, or a quarterly / yearly repeat's own. */
export function runMonthsOf(anchor: Date, recurrence: SurveyRecurrence, timeZone = DEFAULT_OPERATIONAL_TIMEZONE): number[] {
  const first = monthIn(anchor, timeZone);
  if (recurrence === 'YEARLY') return [first];
  if (recurrence === 'QUARTERLY') return [0, 3, 6, 9].map((k) => ((first - 1 + k) % 12) + 1).sort((a, b) => a - b);
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
}

/** Checked skip months: whole numbers 1–12, at most 10 (a repeat must still run). */
export function checkSkipMonths(v: unknown): number[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) throw new BadRequestException('Months to skip must be from 1 (January) to 12 (December).');
  const months = [...new Set(v as number[])].sort((a, b) => a - b);
  if (months.length > 10) throw new BadRequestException('A repeating survey must run in at least 2 months of the year.');
  return months;
}

/** Months the ready-made survey says it does not run in ("not in April, September…" in timing.when). */
export function libraryNotInMonths(libraryMeta: unknown): number[] {
  const when = (libraryMeta as { timing?: { when?: unknown } } | null)?.timing?.when;
  if (typeof when !== 'string') return [];
  // "not in April, September, October or November, when …": the months named up to the end of that clause.
  const m = /\bnot in ([^;.(]+)/i.exec(when);
  if (!m) return [];
  return MONTH_LABELS.map((name, i) => (new RegExp(`\\b${name}\\b`, 'i').test(m[1]) ? i + 1 : 0)).filter(Boolean);
}

// ─── A rotating question ────────────────────────────────────────────────

/**
 * The question ids a period copy leaves out: of the bank (in question order), all but the one whose turn it is
 * (the period's number, counted from 0, modulo the bank's size).
 */
export function rotatedOut(bankInOrder: readonly string[], periodNumber: number): Set<string> {
  if (bankInOrder.length < 2) return new Set();
  const keep = bankInOrder[((periodNumber % bankInOrder.length) + bankInOrder.length) % bankInOrder.length];
  return new Set(bankInOrder.filter((id) => id !== keep));
}

export type RotationQuestion = { id: string; key: string | null; questionText: string; questionType: string; showIf: unknown; sortOrder: number };

/** Checks a bank: 2–12 of the survey's questions, none that another depends on or that has its own condition. */
export function checkRotation(ids: unknown, questions: readonly RotationQuestion[]): string[] {
  if (ids === null || ids === undefined) return [];
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) throw new BadRequestException('Choose the questions that take turns.');
  const bank = [...new Set(ids as string[])];
  if (bank.length === 0) return [];
  if (bank.length < 2 || bank.length > 12) throw new BadRequestException('A rotating question needs 2 to 12 questions that take turns.');
  const byId = new Map(questions.map((q) => [q.id, q]));
  const dependedOn = new Set(
    questions.map((q) => (q.showIf && typeof q.showIf === 'object' ? (q.showIf as { questionKey?: string }).questionKey : null)).filter((k): k is string => Boolean(k)),
  );
  for (const id of bank) {
    const q = byId.get(id);
    if (!q) throw new BadRequestException('A question chosen to take turns is no longer on the survey.');
    if (q.showIf) throw new BadRequestException(`"${q.questionText}" is asked only after another answer, so it cannot take turns.`);
    if (q.key && dependedOn.has(q.key)) throw new BadRequestException(`Another question depends on "${q.questionText}", so it cannot take turns.`);
    if (/^would you like someone to contact you/i.test(q.questionText.trim())) throw new BadRequestException('The contact-me question cannot take turns.');
  }
  return bank.sort((a, b) => byId.get(a)!.sortOrder - byId.get(b)!.sortOrder);
}

// ─── Grouped answer choices ─────────────────────────────────────────────

export type OptionGroup = { heading: string; options: string[] };
export const MAX_OPTION_GROUPS = 12;

export function readOptionGroups(v: unknown): OptionGroup[] {
  return Array.isArray(v)
    ? v.flatMap((g) =>
        g && typeof g === 'object' && typeof (g as OptionGroup).heading === 'string' && Array.isArray((g as OptionGroup).options)
          ? [{ heading: (g as OptionGroup).heading, options: (g as OptionGroup).options.filter((o): o is string => typeof o === 'string') }]
          : [],
      )
    : [];
}

/** Checks groups against a choice question's answers; null clears them. */
export function checkOptionGroups(v: unknown, questionType: string, options: readonly string[]): OptionGroup[] | null {
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return null;
  if (questionType !== 'SINGLE_SELECT' && questionType !== 'MULTI_SELECT') throw new BadRequestException('Only single- and multi-choice questions can group their answers.');
  if (!Array.isArray(v)) throw new BadRequestException('Groups must be a list of headings with their answers.');
  if (v.length < 2 || v.length > MAX_OPTION_GROUPS) throw new BadRequestException(`Use 2 to ${MAX_OPTION_GROUPS} groups.`);
  const used = new Set<string>();
  const headings = new Set<string>();
  const out: OptionGroup[] = [];
  for (const g of v as Array<Record<string, unknown>>) {
    const heading = typeof g?.heading === 'string' ? g.heading.trim().slice(0, 80) : '';
    if (!heading) throw new BadRequestException('Each group needs a heading.');
    if (headings.has(heading.toLowerCase())) throw new BadRequestException(`Two groups are called "${heading}".`);
    headings.add(heading.toLowerCase());
    const opts = Array.isArray(g.options) ? (g.options as unknown[]).filter((o): o is string => typeof o === 'string') : [];
    if (!opts.length) throw new BadRequestException(`"${heading}" has no answers.`);
    for (const o of opts) {
      if (!options.includes(o)) throw new BadRequestException(`"${o}" is not one of the question's answers.`);
      if (used.has(o)) throw new BadRequestException(`"${o}" is in two groups.`);
      used.add(o);
    }
    out.push({ heading, options: opts });
  }
  return out;
}

/**
 * Results by group: each group's count (single choice: the options' counts added; multi choice: people who chose any
 * option in the group) and share of the people who answered. On surveys where an answer can be linked to no one, a
 * group under `min` people is folded into "Other groups" (and the whole breakdown is withheld if that is still small).
 */
export function groupSummary(
  groups: readonly OptionGroup[],
  answers: ReadonlyArray<readonly string[]>,
  opts: { min: number; fold: boolean },
): { groups: Array<{ heading: string; count: number; percent: number }>; note: string | null } | null {
  if (!groups.length) return null;
  const answered = answers.filter((a) => a.length > 0).length;
  if (!answered) return { groups: [], note: null };
  const raw = groups.map((g) => ({ heading: g.heading, count: answers.filter((a) => a.some((o) => g.options.includes(o))).length }));
  const pct = (n: number) => Math.round((n / answered) * 100);
  if (!opts.fold) return { groups: raw.map((g) => ({ ...g, percent: pct(g.count) })), note: null };
  const shown = raw.filter((g) => g.count >= opts.min);
  const small = raw.filter((g) => g.count > 0 && g.count < opts.min);
  const smallPeople = answers.filter((a) => a.length && small.some((g) => groups.find((x) => x.heading === g.heading)!.options.some((o) => a.includes(o)))).length;
  if (small.length && smallPeople < opts.min) {
    return { groups: [], note: `Groups are shown once each has at least ${opts.min} answers, so nobody can be identified.` };
  }
  return {
    groups: [...shown.map((g) => ({ ...g, percent: pct(g.count) })), ...(small.length ? [{ heading: `Other groups (fewer than ${opts.min} each)`, count: smallPeople, percent: pct(smallPeople) }] : [])],
    note: small.length ? `Groups chosen by fewer than ${opts.min} people are combined.` : null,
  };
}

// ─── Answer retention ───────────────────────────────────────────────────

/**
 * The ready-made survey's retention rule: the one stored with the library details when it was loaded
 * (libraryMeta.retention, from the notice by parseRetentionNotice), else read from the notice (details loaded before
 * the rule was stored; the same parser, so the same answer).
 */
export function libraryRetention(libraryMeta: unknown): RetentionRule | null {
  const stored = (libraryMeta as { retention?: unknown } | null)?.retention as Partial<RetentionRule> | null | undefined;
  if (stored && typeof stored === 'object') {
    if (Number.isInteger(stored.months) && (stored.months as number) >= 1 && (stored.basis === 'FROM_CLOSE' || stored.basis === 'FROM_ANSWER')) {
      return { months: stored.months as number, basis: stored.basis };
    }
  }
  if (libraryMeta && typeof libraryMeta === 'object' && 'retention' in libraryMeta && (libraryMeta as { retention?: unknown }).retention === null) return null;
  return parseRetentionNotice((libraryMeta as { privacyNotice?: unknown } | null)?.privacyNotice);
}

/** Months the ready-made privacy notice keeps answers for ("We keep your answers for 1 year after the survey closes"). */
export function libraryRetentionMonths(libraryMeta: unknown): number | null {
  return libraryRetention(libraryMeta)?.months ?? null;
}

/**
 * The latest instant whose answers are due for deletion `months` after it (the inverse of retentionDue): an answer
 * given at or before it has retentionDue(given, months) <= now, never one given after it.
 */
export function retentionCutoff(now: Date, months: number): Date {
  const d = new Date(now);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * When a closed unit closed, never earlier than it did: its end date when that came first (closed at its end date, or
 * a period ended at the next one), else its last change (closed by hand before an end date, or with none; a later
 * change only moves this later, so answers are never deleted early).
 */
export function closedAtOf(u: { closesAt: Date | null; updatedAt: Date }): Date {
  return u.closesAt && u.closesAt.getTime() <= u.updatedAt.getTime() ? u.closesAt : u.updatedAt;
}

export function checkRetentionMonths(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 120) throw new BadRequestException('Keep answers for 1 to 120 months after the survey closes.');
  return v as number;
}

/** The day answers to a unit closed on `closedAt` are deleted, `months` later (end of the same day of month). */
export function retentionDue(closedAt: Date, months: number): Date {
  const d = new Date(closedAt);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** The latest of some dates (null when none). */
export function latestDate(dates: ReadonlyArray<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const d of dates) if (d && (!best || d.getTime() > best.getTime())) best = d;
  return best;
}

/** Days a linked complaint, safeguarding case or incident still holds answers after it closes (time to reopen it). */
export const LEGAL_HOLD_GRACE_DAYS = 30;

/**
 * A linked complaint, safeguarding case or incident holds answers while it is open and for LEGAL_HOLD_GRACE_DAYS
 * after it closed (its closedAt; a closed record with none counts from its last change). Deleted records hold nothing.
 */
export function legalHoldActive(r: { status: string; closedAt: Date | null; updatedAt: Date; deletedAt?: Date | null }, now: Date): boolean {
  if (r.deletedAt) return false;
  if (r.status !== 'CLOSED') return true;
  const closed = r.closedAt ?? r.updatedAt;
  return closed.getTime() > now.getTime() - LEGAL_HOLD_GRACE_DAYS * 24 * 60 * 60 * 1000;
}

/** legalHoldActive as a query (the same rule, for FeedbackRecord, SafeguardingCase and Incident). */
export function legalHoldWhere(now: Date) {
  const since = new Date(now.getTime() - LEGAL_HOLD_GRACE_DAYS * 24 * 60 * 60 * 1000);
  return {
    OR: [
      { status: { not: 'CLOSED' as const } },
      { status: 'CLOSED' as const, closedAt: { gt: since } },
      { status: 'CLOSED' as const, closedAt: null, updatedAt: { gt: since } },
    ],
  };
}

/**
 * Whether answers to a unit may be deleted as far as its CQC evidence goes. Evidence (totals only) is taken from
 * closed units, so:
 * - never closed (open, or deleted before it closed): there is no evidence to take; nothing to wait for;
 * - closed and not deleted: the capture must be done (CAPTURED or NO_STATEMENTS, or ANSWERS_DELETED once partly
 *   deleted) and up to date with the unit's last change (an edit is captured again first);
 * - closed, then deleted: a deleted survey is never captured again (deleting takes the capture first), so a done
 *   capture is enough; with none it waits (never deleted without evidence).
 */
export function evidenceReadyForRetention(
  u: { status: string; deletedAt: Date | null; updatedAt: Date },
  capture: { outcome: string; surveyUpdatedAt: Date } | null,
): boolean {
  if (u.status !== 'CLOSED') return true;
  const done = Boolean(capture) && ['CAPTURED', 'NO_STATEMENTS', 'ANSWERS_DELETED'].includes(capture!.outcome);
  if (!done) return false;
  if (u.deletedAt) return true;
  return capture!.surveyUpdatedAt.getTime() >= u.updatedAt.getTime();
}

// ─── Wording checker ────────────────────────────────────────────────────

export type WordingQuestion = {
  id: string;
  questionText: string;
  questionType: string;
  options: unknown;
  config?: unknown;
  isRequired: boolean;
  sectionTitle?: string | null;
};
export type WordingFinding = {
  rule: 'PLAIN_ENGLISH' | 'ONE_IDEA' | 'SCALE' | 'NEGATIVE' | 'LEADING' | 'FORCED_WRITING' | 'ANONYMITY' | 'TIME';
  severity: 'PROBLEM' | 'SUGGESTION';
  questionId: string | null;
  questionText: string | null;
  message: string;
};

export const WORDING_RULE_LABELS: Record<WordingFinding['rule'], string> = {
  PLAIN_ENGLISH: 'Plain English',
  ONE_IDEA: 'One idea per question',
  SCALE: 'Answer scales',
  NEGATIVE: 'Negative statements',
  LEADING: 'Leading wording',
  FORCED_WRITING: 'Written answers',
  ANONYMITY: 'Anonymity',
  TIME: 'Honest time',
};

/** Words with plainer ones (GOV.UK style guide and the library standard). */
const PLAINER: Array<[RegExp, string]> = [
  [/\butili[sz](e|es|ed|ing|ation)\b/i, 'use'],
  [/\bfacilitat\w*\b/i, 'help, run or arrange'],
  [/\bcommenc\w*\b/i, 'start'],
  [/\bendeavour\w*\b/i, 'try'],
  [/\bascertain\w*\b/i, 'find out'],
  [/\bin respect of\b/i, 'about'],
  [/\bwith regards? to\b/i, 'about'],
  [/\bprior to\b/i, 'before'],
  [/\bsubsequent(ly)?\b/i, 'later, after'],
  [/\bin order to\b/i, 'to'],
  [/\bpertaining to\b/i, 'about'],
  [/\bservice users?\b/i, 'people we support (or "you")'],
  [/\bdomiciliary\b/i, 'home care'],
  [/\bmulti-?disciplinary\b/i, 'different professionals'],
  [/\bperson-centred\b/i, 'what matters to you'],
  [/\bstakeholders?\b/i, 'people involved'],
  [/\bleverag\w*\b/i, 'use'],
  [/\bensure\b/i, 'make sure'],
];

const AGREE = ['Strongly agree', 'Agree', 'Neither agree nor disagree', 'Disagree', 'Strongly disagree'];
const optionList = (q: WordingQuestion): string[] =>
  Array.isArray(q.options) ? (q.options as unknown[]).filter((o): o is string => typeof o === 'string') : q.questionType === 'LIKERT' ? AGREE : [];
const notCounted = (q: WordingQuestion): string[] => {
  const c = q.config as { notCountedOptions?: unknown } | null | undefined;
  return Array.isArray(c?.notCountedOptions) ? (c!.notCountedOptions as unknown[]).filter((o): o is string => typeof o === 'string') : [];
};
const wordsIn = (t: string) => t.trim().split(/\s+/).filter(Boolean);

/** Seconds people usually take: a choice or scale 10, a number or short text 20, a long written answer 60. */
export function estimateSeconds(questions: readonly WordingQuestion[]): number {
  return questions.reduce((n, q) => n + (q.questionType === 'TEXTAREA' ? 60 : q.questionType === 'TEXT' || q.questionType === 'NUMBER' ? 20 : 10), 30);
}

/** The minutes the introduction promises ("takes about 5 minutes"), or null. */
export function promisedMinutes(text: string | null | undefined): number | null {
  const m = typeof text === 'string' ? /(\d+)\s*(?:to\s*(\d+)\s*)?min(?:ute)?s?/i.exec(text) : null;
  return m ? Number(m[2] ?? m[1]) : null;
}

/** Words that rate something: two joined by "and" / "or" are two questions in one ("kind and on time"). */
const RATED =
  '(?:kind|caring|helpful|polite|friendly|respectful|clear|useful|easy|quick|safe|clean|tidy|reliable|punctual|on time|supportive|knowledgeable|skilled|competent|professional|informed|involved|listened to|valued|happy|satisfied|confident|comfortable|well[- ]trained|fair|honest)';
const TWO_RATINGS = new RegExp(`\\b(${RATED})\\s*,?\\s+(?:and|or)\\s+(?:also\\s+)?(${RATED})\\b`, 'i');
/** Two questions joined: "…and do you…", "…or were they…", "…and how…". */
const TWO_QUESTIONS = /\b(?:and|or)\s+(?:(?:do|did|does|are|were|is|was|have|has|can|could|will|would|should)\s+(?:you|they|we|staff|your|our|the)|how|what|why)\b/i;

/**
 * One idea per question: two rated qualities ("kind and on time") or two questions joined. Lists of things or people
 * ("wash, dress or use the toilet", "a man or a woman", "culture and beliefs") are one question and never flagged.
 */
export function asksTwoThings(text: string): boolean {
  const m = TWO_RATINGS.exec(text);
  if (m && m[1].toLowerCase() !== m[2].toLowerCase()) return true;
  return TWO_QUESTIONS.test(text);
}

/** The library standard's checks on an organisation's own survey. Findings only; nothing is blocked. */
export function checkWording(survey: { description: string | null; isAnonymous: boolean }, questions: readonly WordingQuestion[]): WordingFinding[] {
  const out: WordingFinding[] = [];
  const add = (q: WordingQuestion | null, rule: WordingFinding['rule'], severity: WordingFinding['severity'], message: string) =>
    out.push({ rule, severity, questionId: q?.id ?? null, questionText: q?.questionText ?? null, message });
  const forced: WordingQuestion[] = [];
  for (const q of questions) {
    const t = q.questionText.trim();
    const n = wordsIn(t).length;
    if (n > 25) add(q, 'PLAIN_ENGLISH', 'PROBLEM', `${n} words: keep a question under 20 words so it can be read once and answered.`);
    else if (n > 20) add(q, 'PLAIN_ENGLISH', 'SUGGESTION', `${n} words: can it be shorter?`);
    for (const [re, plain] of PLAINER) {
      const m = re.exec(t);
      if (m) add(q, 'PLAIN_ENGLISH', 'SUGGESTION', `Say "${plain}" instead of "${m[0]}".`);
    }
    const scaleOrYesNo = ['LIKERT', 'YES_NO', 'RATING'].includes(q.questionType) || (q.questionType === 'SINGLE_SELECT' && optionList(q).length <= 7);
    if (scaleOrYesNo && asksTwoThings(t)) {
      add(q, 'ONE_IDEA', 'SUGGESTION', 'It may ask about two things at once ("and" / "or"). Someone who feels differently about each cannot answer: ask them separately.');
    }
    if (q.questionType === 'LIKERT') {
      const opts = optionList(q);
      // "supported, not blamed, if…" is a contrast, not a negative statement. A suggestion: some tested questions (the
      // NHS Staff Survey's "…I would not be treated worse") are kept as worded.
      if (/\b(not|never|no one|nobody|don't|doesn't|didn't|isn't|aren't|wasn't|can't|cannot|won't|un\w+able)\b/i.test(t.replace(/,\s*not\s+[\w-]+\s*,/gi, ','))) {
        add(q, 'NEGATIVE', 'SUGGESTION', 'A negative statement on an agree / disagree scale makes people disagree with a "not" (a double negative). Word it positively.');
      }
      const counted = opts.filter((o) => !notCounted(q).includes(o));
      if (counted.length < 4) add(q, 'SCALE', 'PROBLEM', `Only ${counted.length} answers on the scale: use a balanced 5-point scale.`);
      if (counted.length % 2 === 0 && counted.length >= 4) add(q, 'SCALE', 'SUGGESTION', 'An even number of answers has no middle: people who feel neither way are pushed to one side.');
    }
    if (q.questionType === 'RATING') {
      const c = q.config as { min?: number; max?: number } | null | undefined;
      const span = (c?.max ?? 10) - (c?.min ?? 0);
      if (span > 10) add(q, 'SCALE', 'SUGGESTION', 'A rating with more than 11 points is hard to answer: 0 to 10 is the most people can tell apart.');
    }
    if (['LIKERT', 'SINGLE_SELECT', 'MULTI_SELECT'].includes(q.questionType)) {
      const dk = optionList(q).filter((o) => /don'?t know|does not apply|not applicable|prefer not to say/i.test(o));
      const counted = dk.filter((o) => !notCounted(q).includes(o));
      if (counted.length) add(q, 'SCALE', 'PROBLEM', `"${counted[0]}" is counted in the percentages: mark it "Not counted in percentages".`);
    }
    // "How good / helpful was…?" is neutral when the answers run from good to poor (or helpful to not helpful).
    const balanced = q.questionType === 'RATING' || optionList(q).some((o) => /\b(poor|bad|not|unhelpful|no)\b/i.test(o));
    if (
      /\b(how (great|excellent)|don'?t you (agree|think)|wouldn'?t you|excellent service|how much did you (enjoy|like))\b/i.test(t) ||
      (!balanced && /\bhow (good|helpful)\b/i.test(t))
    ) {
      add(q, 'LEADING', 'PROBLEM', 'The wording suggests the answer wanted. Ask neutrally, for example "How would you rate…?"');
    }
    if ((q.questionType === 'TEXT' || q.questionType === 'TEXTAREA') && q.isRequired) forced.push(q);
    // Asking for the detail itself ("your phone number"), not mentioning it ("does someone phone you?").
    if (
      survey.isAnonymous &&
      /\b(your (full |first |last )?name|e-?mail address|(phone|mobile|telephone) number|(your|home) address|date of birth|postcode|(employee|staff|payroll) number|national insurance)\b/i.test(t)
    ) {
      add(q, 'ANONYMITY', 'PROBLEM', 'This anonymous survey asks for something that can identify the person. Remove it, or make the survey named.');
    }
  }
  // A form that needs its written answers (a self-assessment, a complaint) has many: said once, not on each.
  const forcedWhy = 'people with little to say, or who find writing hard, may give up.';
  if (forced.length > 3) add(null, 'FORCED_WRITING', 'SUGGESTION', `${forced.length} written answers are required: ${forcedWhy} Make them optional unless the survey needs them.`);
  else for (const q of forced) add(q, 'FORCED_WRITING', 'SUGGESTION', `A written answer is required: ${forcedWhy} Make it optional.`);
  const minutes = Math.ceil(estimateSeconds(questions) / 60);
  const promised = promisedMinutes(survey.description);
  if (promised !== null && minutes > promised + 1) {
    add(null, 'TIME', 'PROBLEM', `The introduction promises ${promised} minutes; ${questions.length} questions take about ${minutes}. Say ${minutes} minutes, or ask fewer questions.`);
  } else if (promised === null && questions.length) {
    add(null, 'TIME', 'SUGGESTION', `Tell people how long it takes: about ${minutes} minute${minutes === 1 ? '' : 's'} for these ${questions.length} questions.`);
  }
  if (minutes > 15) add(null, 'TIME', 'SUGGESTION', `About ${minutes} minutes is long: people give up. Keep a survey under 10 minutes.`);
  return out;
}
