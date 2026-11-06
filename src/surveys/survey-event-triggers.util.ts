/**
 * Surveys sent when something happens in the care records (Phase 2 part 3): the per-survey setting, its
 * checks, and the day arithmetic. Pure helpers; SurveyEventTriggersService does the database work. The
 * event catalogue and the library's structured triggers live in prisma/seed-lib (seed-safe).
 */
import {
  LIBRARY_EVENT_TRIGGERS,
  NEW_STARTER_REVIEW_TYPES,
  SURVEY_TRIGGER_EVENTS,
  SURVEY_TRIGGER_EVENT_INFO,
  SURVEY_TRIGGER_EXCLUSIONS,
  SURVEY_TRIGGER_EXCLUSION_INFO,
  TRIGGER_DELAY_MAX,
  TRIGGER_DELAY_MIN,
  TRIGGER_LOOK_BACK_MAX,
  TRIGGER_WINDOW_MAX,
  TRIGGER_WINDOW_MIN,
  type LibraryEventTrigger,
  type SurveyTriggerEvent,
  type SurveyTriggerExclusion,
  type SurveyTriggerOptions,
  type TriggerAudience,
} from '../../prisma/seed-lib/survey-event-triggers';

export {
  LIBRARY_EVENT_TRIGGERS,
  SURVEY_TRIGGER_EVENTS,
  SURVEY_TRIGGER_EVENT_INFO,
  SURVEY_TRIGGER_EXCLUSIONS,
  SURVEY_TRIGGER_EXCLUSION_INFO,
  type LibraryEventTrigger,
  type SurveyTriggerEvent,
  type SurveyTriggerExclusion,
  type SurveyTriggerOptions,
  type TriggerAudience,
};

/** Occurrence statuses. WAITING: before the due day; DUE: waiting for staff (check first, or an offer); BATCH:
 * an anonymous survey waiting for 5 people due at once. The rest are final. */
export const OCCURRENCE_STATUSES = ['WAITING', 'DUE', 'BATCH', 'SENT', 'HELD', 'SKIPPED', 'CANCELLED', 'EXPIRED', 'OFFERED'] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];
export const OPEN_OCCURRENCE_STATUSES: OccurrenceStatus[] = ['WAITING', 'DUE', 'BATCH'];

/** Reasons recorded on skipped / cancelled / expired rows (shown in words on the screen). */
export const OCCURRENCE_REASONS = {
  DIED: 'The person has died',
  CARE_ENDED: 'Their care has ended',
  LEFT: 'They have given notice or left',
  IN_HOSPITAL: 'They are in hospital',
  OPEN_SAFEGUARDING: 'An open safeguarding case about them',
  OPEN_COMPLAINT: 'An open complaint about their care',
  COMPLAINT_REOPENED: 'The complaint was reopened',
  REVIEW_CHANGED: 'The review was done or moved',
  ABSENCE_CHANGED: 'The absence was changed or removed',
  DEATH_IN_SERVICE: 'A death in service',
  NOT_REACHABLE: 'They could not be sent surveys (for example inactive)',
  ALREADY_SENT: 'Already sent this month\'s copy',
  HELD_NOT_SENT: 'Had another survey in the last 4 weeks (this survey skips them)',
  WINDOW_PASSED: 'Not sent in time',
  SURVEY_STOPPED: 'The survey was closed or the trigger switched off',
  RECORD_REMOVED: 'The record that raised it was removed',
  SURVEY_CLOSED: 'This month’s copy of the survey was closed',
  NO_DATE: 'No date recorded: check the date before deciding',
} as const;
export type OccurrenceReason = keyof typeof OCCURRENCE_REASONS;

/** Anonymous surveys: event sends go out only when at least this many people are due at once. */
export const EVENT_ANONYMOUS_BATCH = 5;
/** A person is not added again for the same repeating event on the same survey within this many days. */
export const EVENT_REPEAT_GAP_DAYS = 28;
/** A month copy stays open this many days after its month ends. */
export const EVENT_PERIOD_EXTRA_DAYS = 28;

export type SurveyEventTrigger = {
  event: SurveyTriggerEvent;
  delayDays: number;
  windowDays: number;
  exclusions: SurveyTriggerExclusion[];
  options: SurveyTriggerOptions;
  checkFirst: boolean;
  /** First event day counted (YYYY-MM-DD). */
  since: string;
  /** Who checks, offers and is told (SURVEY_ALERT_OWNERS key). */
  ownerKey: string;
};

export function triggerAudienceOf(targetKind: string): TriggerAudience {
  return targetKind === 'EMPLOYEE' ? 'EMPLOYEE' : targetKind === 'SERVICE_USER' ? 'SERVICE_USER' : 'FAMILY';
}

export function defaultOwnerKey(audience: TriggerAudience): string {
  return audience === 'EMPLOYEE' ? 'REGISTERED_MANAGER' : 'CARE_COORDINATOR';
}

function isIsoDay(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

function cleanOptions(event: SurveyTriggerEvent, raw: unknown): { ok: true; options: SurveyTriggerOptions } | { ok: false; message: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: SurveyTriggerOptions = {};
  const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  switch (event) {
    case 'CARE_REVIEW_DUE':
      if (o.firstReviewOnly !== undefined && typeof o.firstReviewOnly !== 'boolean') return { ok: false, message: 'Choose whether only the first review counts.' };
      if (o.firstReviewOnly) out.firstReviewOnly = true;
      break;
    case 'HOSPITAL_DISCHARGE':
      if (o.minNights !== undefined && !int(o.minNights, 0, 60)) return { ok: false, message: 'Nights in hospital must be a whole number from 0 to 60.' };
      out.minNights = (o.minNights as number | undefined) ?? 1;
      break;
    case 'COMPLAINT_CLOSED':
      if (o.complaintFrom !== 'SELF' && o.complaintFrom !== 'FAMILY') return { ok: false, message: 'Choose whose complaints this survey follows.' };
      out.complaintFrom = o.complaintFrom;
      break;
    case 'MEDICINES_CHANGE':
      if (o.ignoreFirstDays !== undefined && !int(o.ignoreFirstDays, 0, 120)) return { ok: false, message: 'The first days of care to ignore must be a whole number from 0 to 120.' };
      out.ignoreFirstDays = (o.ignoreFirstDays as number | undefined) ?? 42;
      break;
    case 'NEW_STARTER_SIGN_OFF':
      if (o.reviewType !== undefined && !(NEW_STARTER_REVIEW_TYPES as readonly string[]).includes(o.reviewType as string)) {
        return { ok: false, message: 'Choose which new-starter review.' };
      }
      out.reviewType = (o.reviewType as SurveyTriggerOptions['reviewType']) ?? 'PROBATION_REVIEW';
      break;
    case 'RETURN_FROM_LONG_ABSENCE':
      if (o.minDays !== undefined && !int(o.minDays, 7, 365)) return { ok: false, message: 'The absence length must be a whole number of days from 7 to 365.' };
      out.minDays = (o.minDays as number | undefined) ?? 28;
      break;
    default:
      break;
  }
  return { ok: true, options: out };
}

/** The stored setting, or null when it is off or not readable. */
export function readEventTrigger(raw: unknown): SurveyEventTrigger | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!(SURVEY_TRIGGER_EVENTS as readonly string[]).includes(r.event as string)) return null;
  const event = r.event as SurveyTriggerEvent;
  if (typeof r.delayDays !== 'number' || typeof r.windowDays !== 'number' || !isIsoDay(r.since)) return null;
  const opts = cleanOptions(event, r.options);
  return {
    event,
    delayDays: r.delayDays,
    windowDays: r.windowDays,
    exclusions: Array.isArray(r.exclusions)
      ? (r.exclusions as unknown[]).filter((x): x is SurveyTriggerExclusion => (SURVEY_TRIGGER_EXCLUSIONS as readonly unknown[]).includes(x))
      : [],
    options: opts.ok ? opts.options : {},
    checkFirst: r.checkFirst === true,
    since: r.since,
    ownerKey: typeof r.ownerKey === 'string' && r.ownerKey ? r.ownerKey : 'CARE_COORDINATOR',
  };
}

/** The library's suggestion for a ready-made survey, or null. */
export function libraryEventTrigger(libraryReference: string | null | undefined): LibraryEventTrigger | null {
  return (libraryReference && LIBRARY_EVENT_TRIGGERS[libraryReference]) || null;
}

/**
 * Check a switch-on or change. `today` is the organisation's day; `lookBackDays` (0–90) counts events
 * from that many days before today (default: only from today). Family (public) surveys are always checked
 * by staff first: they are an offer staff make.
 */
export function checkEventTriggerInput(
  input: unknown,
  ctx: { audience: TriggerAudience; today: string; previous?: SurveyEventTrigger | null },
): { ok: true; trigger: SurveyEventTrigger } | { ok: false; message: string } {
  if (!input || typeof input !== 'object') return { ok: false, message: 'Choose the event this survey is sent after.' };
  const r = input as Record<string, unknown>;
  if (!(SURVEY_TRIGGER_EVENTS as readonly string[]).includes(r.event as string)) return { ok: false, message: 'Choose the event this survey is sent after.' };
  const event = r.event as SurveyTriggerEvent;
  const info = SURVEY_TRIGGER_EVENT_INFO[event];
  if (!info.audiences.includes(ctx.audience)) {
    return {
      ok: false,
      message:
        ctx.audience === 'EMPLOYEE'
          ? 'That event is about people we support: choose a staff event for a staff survey.'
          : ctx.audience === 'FAMILY'
            ? 'Family surveys can follow a death or a family member\'s complaint.'
            : 'That event is not about people we support: choose another.',
    };
  }
  const delay = r.delayDays;
  if (typeof delay !== 'number' || !Number.isInteger(delay) || delay < TRIGGER_DELAY_MIN || delay > TRIGGER_DELAY_MAX) {
    return { ok: false, message: `The number of days must be a whole number from ${TRIGGER_DELAY_MIN} to ${TRIGGER_DELAY_MAX}.` };
  }
  if (delay < 0 && !info.beforeAllowed) return { ok: false, message: 'This survey can only be sent on or after the event.' };
  if (info.minDelayDays !== undefined && delay < info.minDelayDays) {
    return { ok: false, message: `This survey is never sent sooner than ${info.minDelayDays} days (${info.minDelayDays / 7} weeks) after the event.` };
  }
  const windowDays = r.windowDays;
  if (typeof windowDays !== 'number' || !Number.isInteger(windowDays) || windowDays < TRIGGER_WINDOW_MIN || windowDays > TRIGGER_WINDOW_MAX) {
    return { ok: false, message: `Days it may still go out late must be a whole number from ${TRIGGER_WINDOW_MIN} to ${TRIGGER_WINDOW_MAX}.` };
  }
  const exclusions = Array.isArray(r.exclusions) ? (r.exclusions as unknown[]) : [];
  for (const x of exclusions) {
    const xi = SURVEY_TRIGGER_EXCLUSION_INFO[x as SurveyTriggerExclusion];
    if (!xi || !xi.audiences.includes(ctx.audience)) return { ok: false, message: 'One of the checks chosen does not apply to this survey.' };
  }
  const opts = cleanOptions(event, r.options);
  if (!opts.ok) return opts;
  const look = r.lookBackDays === undefined ? 0 : r.lookBackDays;
  if (typeof look !== 'number' || !Number.isInteger(look) || look < 0 || look > TRIGGER_LOOK_BACK_MAX) {
    return { ok: false, message: `Earlier events can be included from up to ${TRIGGER_LOOK_BACK_MAX} days ago.` };
  }
  // Same event as before and no look-back asked: keep the original start (a change never re-sends).
  const since =
    ctx.previous && ctx.previous.event === event && r.lookBackDays === undefined ? ctx.previous.since : addDays(ctx.today, -look);
  const ownerKey = typeof r.ownerKey === 'string' && /^[A-Z_]{2,40}$/.test(r.ownerKey) ? r.ownerKey : defaultOwnerKey(ctx.audience);
  return {
    ok: true,
    trigger: {
      event,
      delayDays: delay,
      windowDays,
      exclusions: [...new Set(exclusions as SurveyTriggerExclusion[])],
      options: opts.options,
      checkFirst: ctx.audience === 'FAMILY' || event === 'DEATH' ? true : r.checkFirst === true,
      since,
      ownerKey,
    },
  };
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** The days a survey for an event on `eventDay` is due, and the last day it may still go. */
export function occurrenceDays(eventDay: string, t: Pick<SurveyEventTrigger, 'delayDays' | 'windowDays'>): { dueOn: string; lastDay: string } {
  const dueOn = addDays(eventDay, t.delayDays);
  return { dueOn, lastDay: addDays(dueOn, t.windowDays) };
}

/**
 * Event days worth looking for today: from the trigger's start, no older than the last day still open, and
 * up to the furthest event whose due day is today or later (future events only when sent before them).
 */
export function detectionRange(t: SurveyEventTrigger, today: string): { from: string; to: string } | null {
  const oldest = addDays(today, -(t.delayDays + t.windowDays));
  const from = oldest > t.since ? oldest : t.since;
  const to = t.delayDays < 0 ? addDays(today, -t.delayDays) : today;
  return from > to ? null : { from, to };
}

/** The month copy an event send goes into: key "2026-11", label "Nov 2026", open until 4 weeks after the month. */
export function eventPeriodFor(today: string): { periodKey: string; monthStart: string; closesOn: string } {
  const [y, m] = today.split('-').map(Number);
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { periodKey: monthStart.slice(0, 7), monthStart, closesOn: addDays(next, EVENT_PERIOD_EXTRA_DAYS) };
}

/**
 * What happens to a waiting row on `today`, before any person checks: still waiting, let go (past its last
 * day), sent for a check / offer, or ready to send.
 */
export function dueDecision(
  row: { dueOn: string; lastDay: string },
  today: string,
  t: Pick<SurveyEventTrigger, 'checkFirst'>,
): 'WAIT' | 'EXPIRE' | 'CHECK' | 'SEND' {
  if (row.dueOn > today) return 'WAIT';
  if (row.lastDay < today) return 'EXPIRE';
  return t.checkFirst ? 'CHECK' : 'SEND';
}

/** Words for a reason code; free text (a person's own reason) is shown as it is. */
export function reasonWords(reason: string | null): string | null {
  if (!reason) return null;
  return (OCCURRENCE_REASONS as Record<string, string>)[reason] ?? reason;
}
