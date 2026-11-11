import type { Prisma } from '@prisma/client';

/**
 * Service user weekly contracted hours rules (Settings → Dom Rules). Simplified 30 Oct 2026
 * (docs/SU_WEEKLY_HOURS_SIMPLIFY_PLAN.md): two Yes/No questions plus whether special visits count.
 * Fixed rules with no setting: hours are counted from the visits on the rota (up to the rota
 * horizon), a decrease always cancels the visits over the new hours (dialog first), every reject
 * needs a reason, draft plans are not checked (only the visits made once active).
 */
export type ServiceUserWeeklyHoursSettings = {
  /** Changing a service user's weekly hours (up or down) waits for a manager. First value never does. */
  changeNeedsApproval: boolean;
  /**
   * A new visit that takes a week over the hours: Yes → the visits within the hours are made and the
   * ones over go to Hours approvals (made on approve). No → made, with a warning.
   */
  visitsNeedApproval: boolean;
  /** Special visits count towards the service user's weekly hours. */
  specialVisitsCount: boolean;
  /**
   * Timebank (docs/SU_TIMEBANK_USE_PLAN.md): Yes → a new visit over the weekly hours takes the hours
   * over from the service user's timebank when the bank covers all of them (reserved when the visit
   * is put on the rota). No → the bank is only shown.
   */
  useTimebank: boolean;
  /**
   * Over care (docs/SU_OVER_CARE_ADJUST_PLAN.md): always true since 10 Nov 2026 (the Dom Rules
   * setting was removed). Over care in a finished week raises a review for a manager (Workforce ›
   * Over care reviews); nothing is cancelled by itself. A saved value is ignored.
   */
  adjustOverCareNextWeek: boolean;
  /**
   * Set by the server, never by the client: the day over care started being taken back. Only weeks
   * starting on or after it are adjusted (null until the first run or the setting is turned on).
   */
  adjustOverCareFrom: string | null;
  /**
   * Timebank hours on the invoice (docs/SU_TIMEBANK_INVOICE_PLAN.md): a finished week's timebank
   * hours are charged on the weekly invoice, and care later paid from them costs nothing.
   * Always on since 10 Nov 2026 (the Dom Rules setting was removed): a saved `false` is ignored.
   */
  chargeTimebankOnInvoice: boolean;
  /** Set by the server: only weeks starting on or after it are charged (null until set). */
  chargeTimebankFrom: string | null;
};

export const DEFAULT_SERVICE_USER_WEEKLY_HOURS_SETTINGS: ServiceUserWeeklyHoursSettings =
  {
    changeNeedsApproval: true,
    visitsNeedApproval: true,
    specialVisitsCount: true,
    useTimebank: false,
    adjustOverCareNextWeek: true,
    adjustOverCareFrom: null,
    chargeTimebankOnInvoice: true,
    chargeTimebankFrom: null,
  };

/**
 * Reads the saved JSON. Values saved before 30 Oct 2026 are mapped: hours change Always / Only up /
 * Only down → Yes, Never → No; extra visit over the hours "Add it, show a warning only" → No, the
 * rest → Yes. Every other old key is dropped on the next save.
 */
export function parseServiceUserWeeklyHoursSettings(
  value: Prisma.JsonValue | null | undefined,
): ServiceUserWeeklyHoursSettings {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const d = DEFAULT_SERVICE_USER_WEEKLY_HOURS_SETTINGS;
  const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  const legacyChange =
    typeof raw.changeApproval === 'string' ? raw.changeApproval !== 'NEVER' : null;
  const legacyVisits =
    typeof raw.extraOverLimit === 'string' ? raw.extraOverLimit !== 'WARN' : null;
  return {
    changeNeedsApproval: bool(raw.changeNeedsApproval) ?? legacyChange ?? d.changeNeedsApproval,
    visitsNeedApproval: bool(raw.visitsNeedApproval) ?? legacyVisits ?? d.visitsNeedApproval,
    specialVisitsCount: bool(raw.specialVisitsCount) ?? d.specialVisitsCount,
    useTimebank: bool(raw.useTimebank) ?? d.useTimebank,
    // Always on: over care always raises a review (Workforce › Over care reviews); no longer a setting.
    adjustOverCareNextWeek: true,
    adjustOverCareFrom:
      typeof raw.adjustOverCareFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.adjustOverCareFrom)
        ? raw.adjustOverCareFrom
        : d.adjustOverCareFrom,
    // Always on: no longer a setting, so an old saved value (Yes or No) is not read.
    chargeTimebankOnInvoice: true,
    chargeTimebankFrom:
      typeof raw.chargeTimebankFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.chargeTimebankFrom)
        ? raw.chargeTimebankFrom
        : d.chargeTimebankFrom,
  };
}

/** The saved `chargeTimebankFrom` after a save (same rule as `nextAdjustOverCareFrom`). */
export function nextChargeTimebankFrom(
  previous: ServiceUserWeeklyHoursSettings,
  next: ServiceUserWeeklyHoursSettings,
  todayIso: string,
): string | null {
  if (!next.chargeTimebankOnInvoice) return null;
  if (previous.chargeTimebankOnInvoice && previous.chargeTimebankFrom) return previous.chargeTimebankFrom;
  return todayIso;
}

/**
 * The saved `adjustOverCareFrom` after a save: kept while the setting stays on, today when it is
 * turned on (or on with no date yet), cleared when it is turned off.
 */
export function nextAdjustOverCareFrom(
  previous: ServiceUserWeeklyHoursSettings,
  next: ServiceUserWeeklyHoursSettings,
  todayIso: string,
): string | null {
  if (!next.adjustOverCareNextWeek) return null;
  if (previous.adjustOverCareNextWeek && previous.adjustOverCareFrom) return previous.adjustOverCareFrom;
  return todayIso;
}

/** Whether changing the hours from `previous` to `next` needs a manager's approval. */
export function suHoursChangeNeedsApproval(
  changeNeedsApproval: boolean,
  previous: number | null,
  next: number,
): boolean {
  if (previous == null) return false; // first value is set directly
  if (next === previous) return false;
  return changeNeedsApproval;
}
