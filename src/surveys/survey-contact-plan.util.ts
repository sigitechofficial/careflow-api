import { SurveyTargetKind } from '@prisma/client';
import { formatHmInTimeZone, DEFAULT_OPERATIONAL_TIMEZONE } from '../common/utils/operational-day.util';
import { SURVEY_ALERT_OWNER_KEYS } from '../../prisma/seed-lib/survey-alert-rules';

/**
 * A survey's contact plan (Survey.contactPlan): invitation → up to three reminders to the people who
 * have not answered → a phone call list for the rest (named surveys only), the mixed-mode sequence
 * the Statistics Norway evidence supports (docs/SURVEY_ROADMAP.md §2, §3.2, A4 #17).
 */

/** Never more than this many reminders to one person for one survey, whatever the plan says. */
export const MAX_SURVEY_REMINDERS = 3;
/** At least this many days between two reminders to the same person (manual ones included). */
export const MIN_REMINDER_GAP_DAYS = 2;
export const MAX_REMINDER_AFTER_DAYS = 60;

export const SURVEY_CONTACT_CHANNELS = ['EMAIL', 'APP', 'PORTAL', 'TEXT'] as const;
export type SurveyContactChannel = (typeof SURVEY_CONTACT_CHANNELS)[number];

export const SURVEY_CONTACT_CHANNEL_LABELS: Record<SurveyContactChannel, string> = {
  EMAIL: 'Email',
  APP: 'Carer app notification',
  PORTAL: 'Portal (email to their portal account)',
  TEXT: 'Text message',
};

/** Ways to reach each kind of person on a survey's list. */
export function contactChannelsFor(targetKind: SurveyTargetKind): SurveyContactChannel[] {
  if (targetKind === SurveyTargetKind.EMPLOYEE) return ['APP', 'EMAIL', 'TEXT'];
  if (targetKind === SurveyTargetKind.SERVICE_USER) return ['PORTAL', 'EMAIL', 'TEXT'];
  return [];
}

export type SurveyCallStep = {
  /** Days after the person was sent the survey before they go on the call list. */
  afterDays: number;
  /** Role the call list task goes to (wins over ownerKey). */
  roleId: string | null;
  /** Library role (SURVEY_ALERT_OWNERS), through the organisation's setting. Default CARE_COORDINATOR. */
  ownerKey: string | null;
  /** Calendar days the role has to make the calls. */
  withinDays: number;
};

export type SurveyContactPlan = {
  reminders: Array<{ afterDays: number }>;
  channels: SurveyContactChannel[];
  /** Nothing is sent from quietStart until quietEnd (organisation time, HH:mm). Equal = no quiet hours. */
  quietStart: string;
  quietEnd: string;
  /** Nothing is sent on Saturdays or Sundays. */
  weekdaysOnly: boolean;
  call: SurveyCallStep | null;
};

export const DEFAULT_QUIET_START = '20:00';
export const DEFAULT_QUIET_END = '09:00';

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** The stored plan, read tolerantly (null when absent or unreadable — no reminders then). */
export function readContactPlan(raw: unknown): SurveyContactPlan | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const reminders = Array.isArray(r.reminders)
    ? r.reminders
        .map((x) => (x && typeof x === 'object' ? (x as { afterDays?: unknown }).afterDays : undefined))
        .filter((d): d is number => isInt(d, 1, MAX_REMINDER_AFTER_DAYS))
        .slice(0, MAX_SURVEY_REMINDERS)
        .map((afterDays) => ({ afterDays }))
    : [];
  const channels = Array.isArray(r.channels)
    ? [...new Set(r.channels.filter((c): c is SurveyContactChannel => (SURVEY_CONTACT_CHANNELS as readonly unknown[]).includes(c)))]
    : [];
  const c = r.call && typeof r.call === 'object' ? (r.call as Record<string, unknown>) : null;
  return {
    reminders,
    channels,
    quietStart: typeof r.quietStart === 'string' && HM.test(r.quietStart) ? r.quietStart : DEFAULT_QUIET_START,
    quietEnd: typeof r.quietEnd === 'string' && HM.test(r.quietEnd) ? r.quietEnd : DEFAULT_QUIET_END,
    weekdaysOnly: r.weekdaysOnly === true,
    call:
      c && isInt(c.afterDays, 0, MAX_REMINDER_AFTER_DAYS)
        ? {
            afterDays: c.afterDays,
            roleId: typeof c.roleId === 'string' && UUID.test(c.roleId) ? c.roleId : null,
            ownerKey: typeof c.ownerKey === 'string' ? c.ownerKey : null,
            withinDays: isInt(c.withinDays, 1, 30) ? c.withinDays : 5,
          }
        : null,
  };
}

export type ContactPlanCheck = { ok: true; plan: SurveyContactPlan } | { ok: false; message: string };

/**
 * A plan a manager saves, checked against the survey: up to three reminders, increasing and at least
 * two days apart; channels that reach this survey's people; the phone step only on named surveys
 * (a call list shows who has not answered, which an anonymous survey never shows).
 */
export function checkContactPlan(
  input: unknown,
  survey: { targetKind: SurveyTargetKind; isAnonymous: boolean },
): ContactPlanCheck {
  if (survey.targetKind === SurveyTargetKind.PUBLIC) {
    return { ok: false, message: 'Public surveys are answered through their shared link, so there is no list of people to remind.' };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, message: 'Choose the reminders to send.' };
  const r = input as Record<string, unknown>;
  const rawReminders = Array.isArray(r.reminders) ? r.reminders : [];
  if (rawReminders.length > MAX_SURVEY_REMINDERS) {
    return { ok: false, message: `Send at most ${MAX_SURVEY_REMINDERS} reminders: more than that puts people off.` };
  }
  const days: number[] = [];
  for (const x of rawReminders) {
    const d = x && typeof x === 'object' ? (x as { afterDays?: unknown }).afterDays : undefined;
    if (!isInt(d, 1, MAX_REMINDER_AFTER_DAYS)) {
      return { ok: false, message: `Each reminder is sent between 1 and ${MAX_REMINDER_AFTER_DAYS} days after the survey.` };
    }
    if (days.length && d - days[days.length - 1] < MIN_REMINDER_GAP_DAYS) {
      return { ok: false, message: `Leave at least ${MIN_REMINDER_GAP_DAYS} days between reminders, each later than the one before.` };
    }
    days.push(d);
  }
  const allowed = contactChannelsFor(survey.targetKind);
  const rawChannels = Array.isArray(r.channels) ? r.channels : [];
  const channels: SurveyContactChannel[] = [];
  for (const c of rawChannels) {
    if (!(allowed as unknown[]).includes(c)) {
      return { ok: false, message: 'Choose ways of reaching people that this survey can use.' };
    }
    if (!channels.includes(c as SurveyContactChannel)) channels.push(c as SurveyContactChannel);
  }
  if (days.length && !channels.length) return { ok: false, message: 'Choose at least one way to send the reminders.' };
  const quietStart = r.quietStart ?? DEFAULT_QUIET_START;
  const quietEnd = r.quietEnd ?? DEFAULT_QUIET_END;
  if (typeof quietStart !== 'string' || !HM.test(quietStart) || typeof quietEnd !== 'string' || !HM.test(quietEnd)) {
    return { ok: false, message: 'Give the quiet hours as times, for example 20:00 to 09:00.' };
  }
  let call: SurveyCallStep | null = null;
  if (r.call !== undefined && r.call !== null) {
    if (survey.isAnonymous) {
      return {
        ok: false,
        message: 'Anonymous surveys have no call list: a list of people who have not answered would show who has.',
      };
    }
    const c = r.call as Record<string, unknown>;
    if (!isInt(c.afterDays, 0, MAX_REMINDER_AFTER_DAYS)) {
      return { ok: false, message: `The call list starts between 0 and ${MAX_REMINDER_AFTER_DAYS} days after the survey is sent.` };
    }
    if (days.length && c.afterDays <= days[days.length - 1]) {
      return { ok: false, message: 'Start the call list after the last reminder, so people have had the chance to answer.' };
    }
    const withinDays = c.withinDays ?? 5;
    if (!isInt(withinDays, 1, 30)) return { ok: false, message: 'Give the calls between 1 and 30 days to be made.' };
    const roleId = c.roleId ?? null;
    if (roleId !== null && !(typeof roleId === 'string' && UUID.test(roleId))) return { ok: false, message: 'Choose a role for the calls.' };
    const ownerKey = c.ownerKey ?? (roleId ? null : 'CARE_COORDINATOR');
    if (ownerKey !== null && !(SURVEY_ALERT_OWNER_KEYS as readonly unknown[]).includes(ownerKey)) {
      return { ok: false, message: 'Choose a role for the calls.' };
    }
    call = { afterDays: c.afterDays, roleId: roleId as string | null, ownerKey: ownerKey as string | null, withinDays };
  }
  return {
    ok: true,
    plan: {
      reminders: days.map((afterDays) => ({ afterDays })),
      channels,
      quietStart,
      quietEnd,
      weekdaysOnly: r.weekdaysOnly === true,
      call,
    },
  };
}

const WEEKDAY = new Map<string, Intl.DateTimeFormat>();
function weekdayIn(now: Date, timeZone: string): string {
  let f = WEEKDAY.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' });
    WEEKDAY.set(timeZone, f);
  }
  return f.format(now);
}

/** Reminders wait while it is quiet (organisation time): inside quiet hours, or a weekend when weekdays only. */
export function isQuietTime(
  now: Date,
  plan: Pick<SurveyContactPlan, 'quietStart' | 'quietEnd' | 'weekdaysOnly'>,
  timeZone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): boolean {
  if (plan.weekdaysOnly && ['Sat', 'Sun'].includes(weekdayIn(now, timeZone))) return true;
  if (plan.quietStart === plan.quietEnd) return false;
  const hm = formatHmInTimeZone(now, timeZone);
  return plan.quietStart < plan.quietEnd
    ? hm >= plan.quietStart && hm < plan.quietEnd
    : hm >= plan.quietStart || hm < plan.quietEnd;
}

/**
 * The reminder step (1-based) now due for one person who has not answered, or null. A step is due
 * once its days have passed since they were sent the survey; one step at a time, never beyond the
 * plan or MAX_SURVEY_REMINDERS, and never within MIN_REMINDER_GAP_DAYS of their last reminder.
 */
export function dueReminderStep(
  person: { sentAt: Date | null; reminderCount: number; remindedAt: Date | null },
  plan: Pick<SurveyContactPlan, 'reminders'>,
  now: Date,
  /** Anonymous surveys keep the reminder date as the day only (see reminderGapPassed). */
  dayOnly = false,
): number | null {
  if (!person.sentAt) return null;
  const limit = Math.min(plan.reminders.length, MAX_SURVEY_REMINDERS);
  if (person.reminderCount >= limit) return null;
  const step = plan.reminders[person.reminderCount];
  if (now.getTime() < person.sentAt.getTime() + step.afterDays * DAY_MS) return null;
  if (!reminderGapPassed(person.remindedAt, now, dayOnly)) return null;
  return person.reminderCount + 1;
}

/**
 * At least MIN_REMINDER_GAP_DAYS since this person's last reminder (or none yet). `dayOnly`: the
 * stored date is the start of the day it was sent (anonymous surveys), so the reminder may have gone
 * as late as the end of that day: a whole extra day is counted, so the gap is never shorter.
 */
export function reminderGapPassed(remindedAt: Date | null, now: Date, dayOnly = false): boolean {
  if (!remindedAt) return true;
  const gapDays = MIN_REMINDER_GAP_DAYS + (dayOnly ? 1 : 0);
  return now.getTime() >= remindedAt.getTime() + gapDays * DAY_MS - 60 * 60 * 1000;
}

/** The person goes on the call list (named surveys): the call step's days have passed since sending. */
export function callDue(sentAt: Date | null, plan: Pick<SurveyContactPlan, 'call'>, now: Date): boolean {
  return Boolean(plan.call && sentAt && now.getTime() >= sentAt.getTime() + plan.call.afterDays * DAY_MS);
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
const toNumber = (w: string) => NUMBER_WORDS[w.toLowerCase()] ?? Number(w);

/**
 * A suggested plan for a survey, from its ready-made library details where there are any: the
 * reminder its guidance states ("one reminder after 2 weeks", "a group reminder after 1 week"), its
 * channels (online / portal → reminders; telephone → a call list on named surveys), else one
 * reminder after a week. Only a suggestion: a manager turns it on.
 */
export function suggestedContactPlan(survey: {
  targetKind: SurveyTargetKind;
  isAnonymous: boolean;
  libraryMeta?: unknown;
}): SurveyContactPlan | null {
  if (survey.targetKind === SurveyTargetKind.PUBLIC) return null;
  const meta = (survey.libraryMeta && typeof survey.libraryMeta === 'object' ? survey.libraryMeta : {}) as {
    channels?: unknown;
    managerGuidance?: { howToRun?: unknown };
  };
  const channels = Array.isArray(meta.channels) ? (meta.channels as string[]) : null;
  const online = !channels || channels.includes('ONLINE') || channels.includes('PORTAL');
  const phone = Boolean(channels?.includes('TELEPHONE'));
  const guidance = Array.isArray(meta.managerGuidance?.howToRun) ? (meta.managerGuidance!.howToRun as unknown[]).join(' ') : '';
  let reminders: Array<{ afterDays: number }> = online ? [{ afterDays: 7 }] : [];
  const m = /reminders?\s+(?:letter\s+|message\s+)?after\s+(\d+|one|two|three|four)\s+(day|week)s?/i.exec(guidance);
  if (online && m) {
    const n = toNumber(m[1]) * (m[2].toLowerCase() === 'week' ? 7 : 1);
    if (isInt(n, 1, MAX_REMINDER_AFTER_DAYS)) reminders = [{ afterDays: n }];
  }
  const last = reminders.length ? reminders[reminders.length - 1].afterDays : 0;
  return {
    reminders,
    channels: online ? contactChannelsFor(survey.targetKind).filter((c) => c !== 'TEXT') : [],
    quietStart: DEFAULT_QUIET_START,
    quietEnd: DEFAULT_QUIET_END,
    weekdaysOnly: false,
    call:
      phone && !survey.isAnonymous && survey.targetKind === SurveyTargetKind.SERVICE_USER
        ? { afterDays: online ? last + 3 : 0, roleId: null, ownerKey: 'CARE_COORDINATOR', withinDays: 5 }
        : null,
  };
}
