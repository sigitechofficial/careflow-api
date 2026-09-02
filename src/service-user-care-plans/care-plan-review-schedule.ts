import { CarePathwayFormType } from '@prisma/client';

export const CARE_PLAN_REVIEW_FREQUENCY_MONTHS = [1, 2, 3, 6, 12] as const;
export type CarePlanReviewFrequencyMonths = (typeof CARE_PLAN_REVIEW_FREQUENCY_MONTHS)[number];

export const DEFAULT_CARE_PLAN_REVIEW_FREQUENCY_MONTHS: CarePlanReviewFrequencyMonths = 6;
export const CARE_PLAN_REVIEW_DUE_SOON_DAYS = 30;
/** Service User Management list icon only — does not change per-plan due_soon (30 days). */
export const CARE_PLAN_LIST_DUE_WITHIN_DAYS = 7;
export const DRAFT_NEXT_REVIEW_DATE_KEY = '__meta.nextReviewDate';

export type CarePlanReviewStatus = 'none' | 'ok' | 'due_soon' | 'overdue';
/** Derived list-row icon status. Not stored. Uses a 7-day amber window. */
export type CarePlanListStatus = 'none' | 'ok' | 'due_within_week' | 'overdue';

export type CarePlanReviewState = {
  status: CarePlanReviewStatus;
  nextReviewDueAt: string | null;
  lastReviewedAt: string | null;
  intervalMonths: number | null;
  guidanceSummary: string | null;
};

export function isCarePlanReviewFrequencyMonths(
  value: unknown,
): value is CarePlanReviewFrequencyMonths {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (CARE_PLAN_REVIEW_FREQUENCY_MONTHS as readonly number[]).includes(value)
  );
}

/** Default 6 months for new CARE_PLAN forms; other form types stay null unless explicitly set. */
export function reviewFrequencyMonthsForCreate(
  formType: CarePathwayFormType | string,
  requested?: number | null,
): number | null {
  if (isCarePlanReviewFrequencyMonths(requested)) return requested;
  if (formType === CarePathwayFormType.CARE_PLAN || formType === 'CARE_PLAN') {
    return DEFAULT_CARE_PLAN_REVIEW_FREQUENCY_MONTHS;
  }
  return null;
}

export function isoDateOnly(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function parseIsoDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function utcDayMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseNextReviewDueDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' || !value.trim()) return null;
  return parseIsoDateOnly(value) ?? (Number.isNaN(Date.parse(value)) ? null : new Date(value));
}

function lastDayOfUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Calendar-month arithmetic with month-end clamping (e.g. 31 Aug + 6 months → 28 Feb 2027). */
export function addCalendarMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const monthIndex = from.getUTCMonth();
  const day = from.getUTCDate();
  const targetMonthIndex = monthIndex + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const clampedDay = Math.min(day, lastDayOfUtcMonth(targetYear, normalizedMonth));
  return new Date(Date.UTC(targetYear, normalizedMonth, clampedDay));
}

export function defaultNextReviewDate(
  from: Date,
  reviewFrequencyMonths: number | null | undefined,
): Date | null {
  if (!isCarePlanReviewFrequencyMonths(reviewFrequencyMonths)) return null;
  return addCalendarMonths(from, reviewFrequencyMonths);
}

export function reviewGuidanceSummary(intervalMonths: number | null | undefined): string | null {
  if (!isCarePlanReviewFrequencyMonths(intervalMonths)) return null;
  const label = intervalMonths === 1 ? 'month' : 'months';
  return `Review this care plan at least every ${intervalMonths} ${label}, or sooner if needs change.`;
}

export function parseDraftNextReviewDate(values: unknown): Date | null {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  const raw = (values as Record<string, unknown>)[DRAFT_NEXT_REVIEW_DATE_KEY];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return parseIsoDateOnly(raw.trim());
}

export function ensureDraftValuesNextReviewDate(
  values: Record<string, unknown>,
  opts: {
    existingNextReviewDueAt?: Date | string | null;
    reviewFrequencyMonths?: number | null;
    from?: Date;
  },
): Record<string, unknown> {
  if (parseDraftNextReviewDate(values)) return values;
  const existing = opts.existingNextReviewDueAt
    ? opts.existingNextReviewDueAt instanceof Date
      ? opts.existingNextReviewDueAt
      : parseIsoDateOnly(String(opts.existingNextReviewDueAt))
    : null;
  if (existing) {
    return { ...values, [DRAFT_NEXT_REVIEW_DATE_KEY]: isoDateOnly(existing) };
  }
  const computed = defaultNextReviewDate(opts.from ?? new Date(), opts.reviewFrequencyMonths);
  if (!computed) return values;
  return { ...values, [DRAFT_NEXT_REVIEW_DATE_KEY]: isoDateOnly(computed) };
}

/**
 * Publish resolver: staff override wins; otherwise keep an existing published date;
 * otherwise calculate from Care Pathway frequency. Never uses form-name day counts.
 */
export function resolvePublishedNextReviewDueAt(params: {
  explicitDate?: Date | string | null;
  existingNextReviewDueAt?: Date | string | null;
  reviewFrequencyMonths?: number | null;
  from: Date;
}): Date | null {
  const explicit =
    params.explicitDate instanceof Date
      ? params.explicitDate
      : typeof params.explicitDate === 'string'
        ? parseIsoDateOnly(params.explicitDate)
        : null;
  if (explicit) return explicit;

  const existing =
    params.existingNextReviewDueAt instanceof Date
      ? params.existingNextReviewDueAt
      : typeof params.existingNextReviewDueAt === 'string'
        ? parseIsoDateOnly(params.existingNextReviewDueAt) ??
          (Number.isNaN(Date.parse(params.existingNextReviewDueAt))
            ? null
            : new Date(params.existingNextReviewDueAt))
        : null;
  if (existing) return existing;

  return defaultNextReviewDate(params.from, params.reviewFrequencyMonths);
}

export function computeCarePlanReviewState(params: {
  nextReviewDueAt?: Date | string | null;
  lastReviewedAt?: Date | string | null;
  intervalMonths?: number | null;
  guidanceSummary?: string | null;
  now?: Date;
}): CarePlanReviewState {
  const now = params.now ?? new Date();
  const nextRaw = params.nextReviewDueAt;
  const lastRaw = params.lastReviewedAt;
  const nextDate = parseNextReviewDueDate(nextRaw);
  const lastReviewedAt =
    lastRaw instanceof Date
      ? lastRaw.toISOString()
      : typeof lastRaw === 'string'
        ? lastRaw
        : null;
  const intervalMonths = isCarePlanReviewFrequencyMonths(params.intervalMonths)
    ? params.intervalMonths
    : null;
  const guidanceSummary = params.guidanceSummary ?? reviewGuidanceSummary(intervalMonths);

  if (!nextDate) {
    return {
      status: lastReviewedAt ? 'ok' : 'none',
      nextReviewDueAt: null,
      lastReviewedAt,
      intervalMonths,
      guidanceSummary,
    };
  }

  const todayMs = utcDayMs(now);
  const dueMs = utcDayMs(nextDate);
  let status: CarePlanReviewStatus = 'ok';
  if (todayMs > dueMs) status = 'overdue';
  else {
    const daysUntil = Math.round((dueMs - todayMs) / 86_400_000);
    if (daysUntil <= CARE_PLAN_REVIEW_DUE_SOON_DAYS) status = 'due_soon';
  }

  return {
    status,
    nextReviewDueAt: nextDate.toISOString(),
    lastReviewedAt,
    intervalMonths,
    guidanceSummary,
  };
}

export type CarePlanReviewAggregate = {
  carePlanReviewRequired: boolean;
  overdueCount: number;
  dueSoonCount: number;
  upToDateCount: number;
};

export function aggregatePublishedCarePlanReview(
  states: Array<Pick<CarePlanReviewState, 'status'>>,
): CarePlanReviewAggregate {
  let overdueCount = 0;
  let dueSoonCount = 0;
  let upToDateCount = 0;
  for (const state of states) {
    if (state.status === 'overdue') overdueCount += 1;
    else if (state.status === 'due_soon') dueSoonCount += 1;
    else if (state.status === 'ok') upToDateCount += 1;
  }
  return {
    carePlanReviewRequired: overdueCount > 0,
    overdueCount,
    dueSoonCount,
    upToDateCount,
  };
}

/**
 * Service User Management list icon. Priority: overdue > due within 7 days > ok > none.
 * Empty input means no published plans (grey). Published plans with a null date count as ok.
 */
export function aggregateCarePlanListStatus(
  nextReviewDueAts: Array<Date | string | null | undefined>,
  now?: Date,
): CarePlanListStatus {
  if (nextReviewDueAts.length === 0) return 'none';

  const todayMs = utcDayMs(now ?? new Date());
  let overdue = false;
  let dueWithinWeek = false;

  for (const raw of nextReviewDueAts) {
    const dueDate = parseNextReviewDueDate(raw);
    if (!dueDate) continue;
    const dueMs = utcDayMs(dueDate);
    if (todayMs > dueMs) {
      overdue = true;
      continue;
    }
    const daysUntil = Math.round((dueMs - todayMs) / 86_400_000);
    if (daysUntil <= CARE_PLAN_LIST_DUE_WITHIN_DAYS) dueWithinWeek = true;
  }

  if (overdue) return 'overdue';
  if (dueWithinWeek) return 'due_within_week';
  return 'ok';
}

export function carePlanListStatusByServiceUser(
  pageServiceUserIds: string[],
  published: Array<{ serviceUserId: string; nextReviewDueAt: Date | string | null }>,
  now?: Date,
): Map<string, CarePlanListStatus> {
  const datesByUser = new Map<string, Array<Date | string | null>>();
  for (const row of published) {
    const list = datesByUser.get(row.serviceUserId) ?? [];
    list.push(row.nextReviewDueAt);
    datesByUser.set(row.serviceUserId, list);
  }
  const result = new Map<string, CarePlanListStatus>();
  for (const id of pageServiceUserIds) {
    result.set(id, aggregateCarePlanListStatus(datesByUser.get(id) ?? [], now));
  }
  return result;
}
