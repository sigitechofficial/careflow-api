import { SurveyQuestionType } from '@prisma/client';
import {
  SURVEY_ALERT_OWNERS,
  SURVEY_ALERT_OWNER_KEYS,
  SURVEY_ALERT_RECORDS,
  MAX_ALERT_DUE_WORKING_DAYS,
  MAX_ALERT_DUE_CALENDAR_DAYS,
  MAX_ALERT_TASK_LENGTH,
  type LibraryAlertRule,
  type SurveyAlertOwnerKey,
} from '../../prisma/seed-lib/survey-alert-rules';
import { answerLabelsFor, questionAnswerChoices } from './survey-question-config.util';
import { isContactRequestQuestion } from './survey-respondent-anonymity.util';

export {
  SURVEY_ALERT_OWNERS,
  SURVEY_ALERT_OWNER_KEYS,
  SURVEY_ALERT_RECORDS,
  MAX_ALERT_DUE_WORKING_DAYS,
  MAX_ALERT_DUE_CALENDAR_DAYS,
  MAX_ALERT_TASK_LENGTH,
  type SurveyAlertOwnerKey,
};

/**
 * One condition: the question was answered with one of `answers` — or, with `not`, it was answered
 * but none of `answers` was chosen (a gap in a checklist).
 */
export type StoredAlertCondition = { questionKey: string; answers: string[]; not?: boolean };
/** Every one of these must hold (e.g. "poor supervision AND asked to be contacted"). */
export type AlertConditionGroup = { all: StoredAlertCondition[] };
/** SurveyAlertRule.conditions is a list of entries; the rule fires when ANY entry holds. */
export type AlertConditionEntry = StoredAlertCondition | AlertConditionGroup;

export const isGroup = (e: AlertConditionEntry): e is AlertConditionGroup => 'all' in e;

/** Every single condition in a rule, however they are combined. */
export function flatConditions(entries: readonly AlertConditionEntry[]): StoredAlertCondition[] {
  return entries.flatMap((e) => (isGroup(e) ? e.all : [e]));
}

/** How a rule's entries combine, for the editor: any (OR), all (one AND group), or mixed. */
export function conditionMode(entries: readonly AlertConditionEntry[]): 'any' | 'all' | 'mixed' {
  if (entries.every((e) => !isGroup(e))) return 'any';
  if (entries.length === 1 && isGroup(entries[0]!)) return 'all';
  return 'mixed';
}

/** A survey question as the rules need it. */
export type AlertQuestion = {
  id: string;
  key: string | null;
  questionText: string;
  questionType: SurveyQuestionType;
  options: unknown;
  config: unknown;
  otherOption?: unknown;
  /** Options from a CareFlow list. */
  optionsFrom?: string | null;
  /** A CareFlow-list question on an anonymous survey: rules cannot check it. */
  lookupBlocked?: boolean;
};

/** RoleTask.sourceType for tasks raised by survey alerts. */
export const SURVEY_ALERT_TASK_SOURCE = 'SURVEY_ALERT';

/** Library alert keys ("library-0" for the first alert) — stable across revisions of the same alert. */
export const libraryRuleKey = (index: number) => `library-${index}`;

/** What happened, for the follow-up list. */
export const SURVEY_ALERT_OUTCOMES = ['CONTACTED', 'NOT_REACHED', 'NO_LONGER_NEEDED', 'ACTIONED'] as const;
export type SurveyAlertOutcomeKind = (typeof SURVEY_ALERT_OUTCOMES)[number];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const readSimple = (c: Record<string, unknown>): StoredAlertCondition | null => {
  const questionKey = typeof c.questionKey === 'string' ? c.questionKey : '';
  const answers = strings(c.answers);
  if (!questionKey || !answers.length) return null;
  return c.not === true ? { questionKey, answers, not: true } : { questionKey, answers };
};

/** Stored conditions, ignoring anything malformed. */
export function readConditions(value: unknown): AlertConditionEntry[] {
  if (!Array.isArray(value)) return [];
  const out: AlertConditionEntry[] = [];
  for (const e of value.filter(isObject)) {
    if (Array.isArray(e.all)) {
      const all = e.all.filter(isObject).map(readSimple).filter((c): c is StoredAlertCondition => !!c);
      if (all.length) out.push({ all });
    } else {
      const c = readSimple(e);
      if (c) out.push(c);
    }
  }
  return out;
}

/** Answers a question can be checked for (null: a written answer, which rules never read). */
export function alertAnswerChoices(q: AlertQuestion): string[] | null {
  return questionAnswerChoices(q.questionType, q.options, q.config, q.otherOption ?? null);
}

/**
 * Why conditions cannot be saved for a survey's questions (empty = fine). Every condition must name
 * a question with chosen answers and only answers it can be given.
 */
export function conditionProblems(entries: readonly AlertConditionEntry[], questions: readonly AlertQuestion[]): string[] {
  if (!entries.length) return ['Choose at least one question and answer.'];
  const byKey = new Map(questions.filter((q) => q.key).map((q) => [q.key!, q]));
  const problems: string[] = [];
  for (const e of entries) {
    if (isGroup(e) && e.all.length < 2) problems.push('"All of these" needs at least two questions.');
  }
  // A question may appear once per entry (in different entries it is fine: "A or (A and B)").
  for (const e of entries) {
    const seen = new Set<string>();
    for (const c of isGroup(e) ? e.all : [e]) {
      if (seen.has(c.questionKey)) {
        const q = byKey.get(c.questionKey);
        problems.push(`"${q?.questionText ?? c.questionKey}" is in this rule twice.`);
      }
      seen.add(c.questionKey);
    }
  }
  for (const c of flatConditions(entries)) {
    const q = byKey.get(c.questionKey);
    if (!q) {
      problems.push('A question in this rule is no longer in the survey.');
      continue;
    }
    if (q.lookupBlocked) {
      problems.push(`"${q.questionText}" takes its answers from a CareFlow list: on an anonymous survey alerts cannot check them, as one answer could point at the few people it fits.`);
      continue;
    }
    const choices = alertAnswerChoices(q);
    if (!choices) {
      problems.push(`"${q.questionText}" has a written answer: alerts can only check chosen answers.`);
      continue;
    }
    const wrong = c.answers.filter((a) => !choices.includes(a));
    if (wrong.length) problems.push(`"${wrong.join('", "')}" is not an answer to "${q.questionText}".`);
    if (!c.answers.length) problems.push(`Choose at least one answer to "${q.questionText}".`);
    if (c.not && c.answers.length >= choices.length) problems.push(`"Not chosen" must leave some answers to "${q.questionText}".`);
  }
  return [...new Set(problems)];
}

/** A contact-me rule checks only the contact-me question answered Yes. */
export function isContactRuleShape(entries: readonly AlertConditionEntry[], questions: readonly AlertQuestion[]): boolean {
  const only = entries.length === 1 ? entries[0] : undefined;
  if (!only || isGroup(only) || only.not) return false;
  const q = questions.find((x) => x.key === only.questionKey);
  return Boolean(q && isContactRequestQuestion(q) && only.answers.length === 1 && only.answers[0] === 'Yes');
}

/** A library rule's conditions for this survey's questions (by id/key, else exact text); null if any is missing. */
export function conditionsFromLibrary(rule: LibraryAlertRule, questions: readonly AlertQuestion[]): AlertConditionEntry[] | null {
  const simple = (c: { question?: unknown; answers?: unknown; not?: unknown }): StoredAlertCondition | null => {
    const ref = String(c.question ?? '').trim();
    const q = questions.find((x) => x.key === ref) ?? questions.find((x) => x.questionText.trim() === ref);
    if (!q?.key) return null;
    const answers = [...new Set(strings(c.answers))];
    return c.not === true ? { questionKey: q.key, answers, not: true } : { questionKey: q.key, answers };
  };
  const out: AlertConditionEntry[] = [];
  for (const c of (rule.if ?? []) as unknown[]) {
    if (!isObject(c)) return null;
    if (Array.isArray(c.all)) {
      const all = c.all.map((x) => (isObject(x) ? simple(x) : null));
      if (all.some((x) => !x)) return null;
      out.push({ all: all as StoredAlertCondition[] });
    } else {
      const one = simple(c);
      if (!one) return null;
      out.push(one);
    }
  }
  return out.length && !conditionProblems(out, questions).length ? out : null;
}

/** A library rule's fewest answers linked to no one before it raises anything (5–100), or null. */
export function libraryMinimumAnswers(rule: LibraryAlertRule | null | undefined): number | null {
  const n = (rule as { minimumAnswers?: unknown } | null | undefined)?.minimumAnswers;
  return Number.isInteger(n) && (n as number) >= 5 && (n as number) <= 100 ? (n as number) : null;
}

/** The structured alerts in a survey's library details (libraryMeta.managerGuidance.alerts). */
export function libraryAlerts(libraryMeta: unknown): Array<{ index: number; when: string; action: string; rule: LibraryAlertRule | null }> {
  const g = isObject(libraryMeta) && isObject(libraryMeta.managerGuidance) ? libraryMeta.managerGuidance : null;
  const alerts = g && Array.isArray(g.alerts) ? g.alerts : [];
  // A retired alert keeps its place (its position is its identity: rule key library-<index>).
  return alerts.flatMap((a, index) =>
    isObject(a) && typeof a.when === 'string' && typeof a.action === 'string' && a.retired !== true
      ? [{ index, when: a.when, action: a.action, rule: isObject(a.rule) ? (a.rule as unknown as LibraryAlertRule) : null }]
      : [],
  );
}

export type AlertRuleRow = {
  key: string;
  position: number;
  title: string;
  whenText: string;
  actionText: string;
  conditions: AlertConditionEntry[];
  ownerKey: SurveyAlertOwnerKey | null;
  dueWorkingDays: number;
  dueCalendarDays: number | null;
  urgent: boolean;
  recordKind: string | null;
  contactRequest: boolean;
  libraryAlert: number | null;
  /** Answers linked to no one: raise only from at least this many (the library's, e.g. 10 for abuse). */
  minimumAnswers: number | null;
};

/**
 * Rule rows for a ready-made survey: one per library alert with a rule whose questions are all
 * still in the survey (an organisation that removed a question keeps the rest). Contact-me rules are
 * left out of anonymous surveys (nobody could be contacted).
 */
export function libraryRuleRows(libraryMeta: unknown, questions: readonly AlertQuestion[], opts: { anonymous: boolean }): AlertRuleRow[] {
  const rows: AlertRuleRow[] = [];
  for (const a of libraryAlerts(libraryMeta)) {
    if (!a.rule) continue;
    if (a.rule.contactRequest && opts.anonymous) continue;
    const conditions = conditionsFromLibrary(a.rule, questions);
    if (!conditions) continue;
    const owner = (SURVEY_ALERT_OWNER_KEYS as string[]).includes(a.rule.owner) ? a.rule.owner : null;
    rows.push({
      key: libraryRuleKey(a.index),
      position: rows.length,
      title: a.rule.task.trim().slice(0, MAX_ALERT_TASK_LENGTH),
      whenText: a.when,
      actionText: a.action,
      conditions,
      ownerKey: owner,
      dueWorkingDays: Math.min(Math.max(Math.trunc(a.rule.dueWorkingDays ?? 0), 0), MAX_ALERT_DUE_WORKING_DAYS),
      dueCalendarDays:
        a.rule.dueCalendarDays != null ? Math.min(Math.max(Math.trunc(a.rule.dueCalendarDays), 1), MAX_ALERT_DUE_CALENDAR_DAYS) : null,
      urgent: a.rule.urgent === true,
      recordKind: a.rule.record && (SURVEY_ALERT_RECORDS as readonly string[]).includes(a.rule.record) ? a.rule.record : null,
      contactRequest: a.rule.contactRequest === true && isContactRuleShape(conditions, questions),
      libraryAlert: a.index,
      minimumAnswers: libraryMinimumAnswers(a.rule),
    });
  }
  return rows;
}

/** One answer row as stored (or held). */
export type AlertAnswer = {
  questionId: string;
  booleanValue: boolean | null;
  numberValue: number | null;
  selectedOptions: unknown;
};

/** The labels each question was answered with, by question key. */
export function answerLabelsByKey(questions: readonly AlertQuestion[], answers: readonly AlertAnswer[]): Map<string, string[]> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out = new Map<string, string[]>();
  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q?.key) continue;
    const labels = answerLabelsFor(q, a);
    if (labels.length) out.set(q.key, labels);
  }
  return out;
}

/** One condition against the answers given: what matched, or null. A question not answered never matches. */
function matchOne(c: StoredAlertCondition, labelsByKey: ReadonlyMap<string, readonly string[]>): StoredAlertCondition | null {
  const given = labelsByKey.get(c.questionKey) ?? [];
  if (c.not) {
    // Answered, but none of these chosen.
    return given.length && !c.answers.some((a) => given.includes(a)) ? { questionKey: c.questionKey, answers: c.answers, not: true } : null;
  }
  const hit = c.answers.filter((a) => given.includes(a));
  return hit.length ? { questionKey: c.questionKey, answers: hit } : null;
}

/**
 * The conditions a response meets, each with the answers that matched (empty = the rule does not
 * fire). Any entry may hold; an "all" entry holds only when every one of its conditions does.
 */
export function matchConditions(
  entries: readonly AlertConditionEntry[],
  labelsByKey: ReadonlyMap<string, readonly string[]>,
): StoredAlertCondition[] {
  const out: StoredAlertCondition[] = [];
  for (const e of entries) {
    if (isGroup(e)) {
      const hits = e.all.map((c) => matchOne(c, labelsByKey));
      if (hits.every((h) => h)) out.push(...(hits as StoredAlertCondition[]));
    } else {
      const hit = matchOne(e, labelsByKey);
      if (hit) out.push(hit);
    }
  }
  return out;
}

/** "Never" / "none of: Medicines, Moving and handling". */
export function matchedAnswerText(c: Pick<StoredAlertCondition, 'answers' | 'not'>): string {
  return c.not ? `none of: ${c.answers.join(', ')}` : c.answers.join(', ');
}

const DAY_MS = 86_400_000;
const isoPlus = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const isWorkingDay = (iso: string, holidays: ReadonlySet<string>) => {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.has(iso);
};

/**
 * The due day for "within N calendar days": N days after `todayIso`, brought back to the last working
 * day on or before it (never after the deadline), but never before the first working day from today.
 */
export function alertCalendarDueDate(todayIso: string, calendarDays: number, holidays: ReadonlySet<string> = new Set()): string {
  const earliest = alertDueDate(todayIso, 0, holidays);
  let day = isoPlus(todayIso, Math.max(0, Math.trunc(calendarDays)));
  while (day > earliest && !isWorkingDay(day, holidays)) day = isoPlus(day, -1);
  return day < earliest ? earliest : day;
}

/** A rule's due day: calendar days when it has them, else working days. */
export function ruleDueDate(
  todayIso: string,
  rule: { dueWorkingDays: number; dueCalendarDays?: number | null },
  holidays: ReadonlySet<string> = new Set(),
): string {
  return rule.dueCalendarDays != null
    ? alertCalendarDueDate(todayIso, rule.dueCalendarDays, holidays)
    : alertDueDate(todayIso, rule.dueWorkingDays, holidays);
}

/**
 * The due day: `workingDays` working days after `todayIso` (Monday to Friday, not bank holidays).
 * 0 = the same working day — today when today is a working day, otherwise the next one.
 */
export function alertDueDate(todayIso: string, workingDays: number, holidays: ReadonlySet<string> = new Set()): string {
  let day = todayIso;
  while (!isWorkingDay(day, holidays)) day = isoPlus(day, 1);
  let left = Math.max(0, Math.trunc(workingDays));
  while (left > 0) {
    day = isoPlus(day, 1);
    if (isWorkingDay(day, holidays)) left -= 1;
  }
  return day;
}

/** The organisation role for an owner key, by the usual role names (case-insensitive). */
export function roleForOwner(
  ownerKey: string | null,
  roles: ReadonlyArray<{ id: string; name: string }>,
): { id: string; name: string } | null {
  if (!ownerKey || !(ownerKey in SURVEY_ALERT_OWNERS)) return null;
  const names = SURVEY_ALERT_OWNERS[ownerKey as SurveyAlertOwnerKey].names;
  for (const n of names) {
    const hit = roles.find((r) => r.name.trim().toLowerCase() === n.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** "a", "b" or "c" → "a, b or c". */
export function orList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}
