import type { Prisma } from '@prisma/client';

/**
 * Service user weekly contracted hours rules (Settings → Dom Rules). The defaults are the
 * behaviour built first, so an organisation that never saves these settings sees no change.
 */

/** When a change to the weekly hours needs a manager's approval. */
export const SU_HOURS_CHANGE_APPROVAL = [
  'ALWAYS',
  'INCREASE_ONLY',
  'DECREASE_ONLY',
  'NEVER',
] as const;
export type SuHoursChangeApproval = (typeof SU_HOURS_CHANGE_APPROVAL)[number];

/** Approved decrease with visits over the new hours: keep them (warning) or cancel the latest in each week. */
export const SU_HOURS_DECREASE_ACTIONS = [
  'KEEP_WARN',
  'CANCEL_LATEST',
] as const;
export type SuHoursDecreaseAction = (typeof SU_HOURS_DECREASE_ACTIONS)[number];

/** Visit plan save that takes a week over the hours. */
export const SU_PLAN_OVER_LIMIT = ['BLOCK', 'WARN'] as const;
export type SuPlanOverLimit = (typeof SU_PLAN_OVER_LIMIT)[number];

/** New extra visit that takes its week over the hours. */
export const SU_EXTRA_OVER_LIMIT = [
  'MANAGER_APPROVAL',
  'BLOCK',
  'WARN',
] as const;
export type SuExtraOverLimit = (typeof SU_EXTRA_OVER_LIMIT)[number];

/** Editing an extra visit so its week goes over the hours. */
export const SU_EXTRA_EDIT_OVER_LIMIT = ['BLOCK', 'WARN'] as const;
export type SuExtraEditOverLimit = (typeof SU_EXTRA_EDIT_OVER_LIMIT)[number];

/**
 * Bulk generate / hourly rolling rota with a plan over the hours: warn only, skip it when run by
 * hand (the rolling rota still makes the visits so care is not missed), or skip it everywhere.
 */
export const SU_BULK_OVER_LIMIT = ['WARN', 'SKIP_MANUAL', 'SKIP_ALL'] as const;
export type SuBulkOverLimit = (typeof SU_BULK_OVER_LIMIT)[number];

/** Special visit (Workforce → Special visits) that takes the service user's week over the hours. */
export const SU_SPECIAL_OVER_LIMIT = ['BLOCK', 'WARN'] as const;
export type SuSpecialOverLimit = (typeof SU_SPECIAL_OVER_LIMIT)[number];

/**
 * Draft visit plan saved with a week over the hours: block the save, save it but keep Activate
 * blocked until a manager approves, or save it with a warning only.
 */
export const SU_DRAFT_OVER_LIMIT = ['BLOCK', 'MANAGER_APPROVAL', 'WARN'] as const;
export type SuDraftOverLimit = (typeof SU_DRAFT_OVER_LIMIT)[number];

export const SU_HOURS_CHECK_WEEKS_MIN = 1;
export const SU_HOURS_CHECK_WEEKS_MAX = 26;

export type ServiceUserWeeklyHoursSettings = {
  changeApproval: SuHoursChangeApproval;
  decreaseAction: SuHoursDecreaseAction;
  planOverLimit: SuPlanOverLimit;
  extraOverLimit: SuExtraOverLimit;
  /** On approve, refuse when the week now has more hours than when the visit was asked for. */
  extraApproveRecheck: boolean;
  extraRejectReasonRequired: boolean;
  extraEditOverLimit: SuExtraEditOverLimit;
  bulkOverLimit: SuBulkOverLimit;
  /** Special visits count towards the service user's weekly hours. */
  specialVisitsCount: boolean;
  specialVisitOverLimit: SuSpecialOverLimit;
  draftOverLimit: SuDraftOverLimit;
  /** Weeks ahead checked against the hours (from this week). */
  checkWeeks: number;
};

export const DEFAULT_SERVICE_USER_WEEKLY_HOURS_SETTINGS: ServiceUserWeeklyHoursSettings =
  {
    changeApproval: 'ALWAYS',
    decreaseAction: 'KEEP_WARN',
    planOverLimit: 'BLOCK',
    extraOverLimit: 'MANAGER_APPROVAL',
    extraApproveRecheck: false,
    extraRejectReasonRequired: true,
    extraEditOverLimit: 'BLOCK',
    bulkOverLimit: 'WARN',
    specialVisitsCount: true,
    specialVisitOverLimit: 'WARN',
    draftOverLimit: 'BLOCK',
    checkWeeks: 12,
  };

function pick<T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function parseServiceUserWeeklyHoursSettings(
  value: Prisma.JsonValue | null | undefined,
): ServiceUserWeeklyHoursSettings {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const d = DEFAULT_SERVICE_USER_WEEKLY_HOURS_SETTINGS;
  const weeks = Number(raw.checkWeeks);
  return {
    changeApproval: pick(
      SU_HOURS_CHANGE_APPROVAL,
      raw.changeApproval,
      d.changeApproval,
    ),
    decreaseAction: pick(
      SU_HOURS_DECREASE_ACTIONS,
      raw.decreaseAction,
      d.decreaseAction,
    ),
    planOverLimit: pick(SU_PLAN_OVER_LIMIT, raw.planOverLimit, d.planOverLimit),
    extraOverLimit: pick(
      SU_EXTRA_OVER_LIMIT,
      raw.extraOverLimit,
      d.extraOverLimit,
    ),
    extraApproveRecheck:
      typeof raw.extraApproveRecheck === 'boolean'
        ? raw.extraApproveRecheck
        : d.extraApproveRecheck,
    extraRejectReasonRequired:
      typeof raw.extraRejectReasonRequired === 'boolean'
        ? raw.extraRejectReasonRequired
        : d.extraRejectReasonRequired,
    extraEditOverLimit: pick(
      SU_EXTRA_EDIT_OVER_LIMIT,
      raw.extraEditOverLimit,
      d.extraEditOverLimit,
    ),
    bulkOverLimit: pick(SU_BULK_OVER_LIMIT, raw.bulkOverLimit, d.bulkOverLimit),
    specialVisitsCount:
      typeof raw.specialVisitsCount === 'boolean' ? raw.specialVisitsCount : d.specialVisitsCount,
    specialVisitOverLimit: pick(SU_SPECIAL_OVER_LIMIT, raw.specialVisitOverLimit, d.specialVisitOverLimit),
    draftOverLimit: pick(SU_DRAFT_OVER_LIMIT, raw.draftOverLimit, d.draftOverLimit),
    checkWeeks: Number.isFinite(weeks)
      ? Math.max(
          SU_HOURS_CHECK_WEEKS_MIN,
          Math.min(SU_HOURS_CHECK_WEEKS_MAX, Math.round(weeks)),
        )
      : d.checkWeeks,
  };
}

/** Whether changing the hours from `previous` to `next` needs a manager's approval. */
export function suHoursChangeNeedsApproval(
  rule: SuHoursChangeApproval,
  previous: number | null,
  next: number,
): boolean {
  if (previous == null) return false; // first value is set directly
  if (rule === 'ALWAYS') return true;
  if (rule === 'NEVER') return false;
  if (rule === 'INCREASE_ONLY') return next > previous;
  return next < previous;
}
