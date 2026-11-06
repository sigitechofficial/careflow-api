import { addCalendarMonths } from '../../service-user-care-plans/care-plan-review-schedule';

/**
 * Default expiry for a dated record from its type's validity period (ComplianceType /
 * CertificationType `defaultValidityMonths`, SkillType `defaultRefreshMonths`): `from` plus that
 * many calendar months (month-end clamped). Null when there is no start date or no period.
 */
export function defaultExpiryFromValidity(
  from: Date | null | undefined,
  months: number | null | undefined,
): Date | null {
  if (!from || !months || months < 1 || Number.isNaN(from.getTime())) return null;
  return addCalendarMonths(from, months);
}
