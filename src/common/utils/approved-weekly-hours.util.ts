/**
 * Resolve the weekly hours threshold used for over-contract checks
 * (visit-plan warnings, hours approvals, rostering capacity).
 *
 * When "Approved extra weekly hours" is set and not expired on employment,
 * that override is the allowed threshold; otherwise fall back to contracted hours.
 */
export type EmploymentHoursFields = {
  contractedWeeklyHours?: number | null;
  weeklyHoursCapOverride?: number | null;
  weeklyHoursCapOverrideExpiresAt?: Date | string | null;
};

function toFiniteHours(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function isWeeklyHoursCapOverrideActive(
  employment: EmploymentHoursFields | null | undefined,
  at: Date = new Date(),
): boolean {
  const override = toFiniteHours(employment?.weeklyHoursCapOverride ?? null);
  if (override == null) return false;
  const expiresRaw = employment?.weeklyHoursCapOverrideExpiresAt;
  if (expiresRaw) {
    const expires = expiresRaw instanceof Date ? expiresRaw : new Date(expiresRaw);
    if (!Number.isNaN(expires.getTime()) && expires.getTime() < at.getTime()) return false;
  }
  return true;
}

/** Active override hours, or null if unset/expired. */
export function resolveWeeklyHoursCapOverride(
  employment: EmploymentHoursFields | null | undefined,
  at: Date = new Date(),
): number | null {
  if (!isWeeklyHoursCapOverrideActive(employment, at)) return null;
  return toFiniteHours(employment?.weeklyHoursCapOverride ?? null);
}

/**
 * Hours threshold for "needs hours approval / exceeds contracted" checks.
 * Prefer an active approved override; otherwise contracted weekly hours.
 */
export function resolveApprovedWeeklyHoursThreshold(
  employment: EmploymentHoursFields | null | undefined,
  at: Date = new Date(),
): number | null {
  const override = resolveWeeklyHoursCapOverride(employment, at);
  if (override != null) return override;
  return toFiniteHours(employment?.contractedWeeklyHours ?? null);
}
