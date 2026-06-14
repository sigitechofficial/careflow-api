export type CarePlanReviewStatus = 'none' | 'ok' | 'due_soon' | 'overdue';

export type CarePlanReviewSchedule = {
  defaultIntervalDays: number;
  dueSoonLeadDays: number;
  guidanceSummary: string;
};

export type CarePlanReviewState = {
  status: CarePlanReviewStatus;
  nextReviewDueAt: string | null;
  lastReviewedAt: string | null;
  intervalDays: number | null;
  guidanceSummary: string | null;
};

/** Default review intervals for seeded care plan templates (days). */
export const CARE_PLAN_REVIEW_SCHEDULES: Record<string, CarePlanReviewSchedule> = {
  Medication: {
    defaultIntervalDays: 365,
    dueSoonLeadDays: 30,
    guidanceSummary: 'Review medication care plan at least annually and when medicines or support change.',
  },
  Dementia: {
    defaultIntervalDays: 180,
    dueSoonLeadDays: 14,
    guidanceSummary: 'Review dementia care plan at least every six months as cognition or behaviour changes.',
  },
  'Dementia Care plan': {
    defaultIntervalDays: 180,
    dueSoonLeadDays: 14,
    guidanceSummary: 'Review dementia care plan at least every six months as cognition or behaviour changes.',
  },
  'Risk Assessment and Care Plan': {
    defaultIntervalDays: 365,
    dueSoonLeadDays: 30,
    guidanceSummary: 'Review master care plan at least annually and after hospital discharge or major change.',
  },
};

const DEFAULT_SCHEDULE: CarePlanReviewSchedule = {
  defaultIntervalDays: 365,
  dueSoonLeadDays: 30,
  guidanceSummary: 'Review this care plan at least annually and when the person’s needs change.',
};

export function getCarePlanReviewSchedule(formName: string | null | undefined): CarePlanReviewSchedule {
  if (!formName?.trim()) return DEFAULT_SCHEDULE;
  return CARE_PLAN_REVIEW_SCHEDULES[formName.trim()] ?? DEFAULT_SCHEDULE;
}

export function computeNextReviewDueAt(from: Date, intervalDays: number): Date {
  return new Date(from.getTime() + intervalDays * 24 * 60 * 60 * 1000);
}

export function computeCarePlanReviewState(params: {
  nextReviewDueAt?: Date | string | null;
  lastReviewedAt?: Date | string | null;
  intervalDays?: number | null;
  guidanceSummary?: string | null;
  now?: Date;
}): CarePlanReviewState {
  const now = params.now ?? new Date();
  const nextRaw = params.nextReviewDueAt;
  const lastRaw = params.lastReviewedAt;
  const nextReviewDueAt =
    nextRaw instanceof Date
      ? nextRaw.toISOString()
      : typeof nextRaw === 'string'
        ? nextRaw
        : null;
  const lastReviewedAt =
    lastRaw instanceof Date
      ? lastRaw.toISOString()
      : typeof lastRaw === 'string'
        ? lastRaw
        : null;

  if (!nextReviewDueAt) {
    return {
      status: lastReviewedAt ? 'ok' : 'none',
      nextReviewDueAt: null,
      lastReviewedAt,
      intervalDays: params.intervalDays ?? null,
      guidanceSummary: params.guidanceSummary ?? null,
    };
  }

  const dueAt = new Date(nextReviewDueAt);
  const leadDays = 30;
  const leadMs = leadDays * 24 * 60 * 60 * 1000;
  let status: CarePlanReviewStatus = 'ok';
  if (now.getTime() > dueAt.getTime()) status = 'overdue';
  else if (dueAt.getTime() - now.getTime() <= leadMs) status = 'due_soon';

  return {
    status,
    nextReviewDueAt,
    lastReviewedAt,
    intervalDays: params.intervalDays ?? null,
    guidanceSummary: params.guidanceSummary ?? null,
  };
}
