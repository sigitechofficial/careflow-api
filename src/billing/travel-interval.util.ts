/**
 * Travel-time intervals (TR-01 / TR-04 / TR-05 / TR-06).
 *
 * A gap between two visits is not, by itself, travel. Until a person says what a stretch of time
 * was, the pay run uses an estimate made from the gap and labels it as an estimate. Once an
 * interval is recorded and approved, it replaces the estimate for that visit.
 *
 * An interval is time. Distance is paid as mileage on its own lines and is never derived from it.
 */

export const TRAVEL_CATEGORIES = [
  'BETWEEN_SERVICE_USERS',
  'REQUIRED_WAITING',
  'REST_BREAK',
  'ORDINARY_COMMUTE',
  'TRAINING_JOURNEY',
  'CANCELLED_VISIT_JOURNEY',
  'OTHER',
] as const;
export type TravelCategory = (typeof TRAVEL_CATEGORIES)[number];

/** How the times of an interval are known. */
export const TRAVEL_EVIDENCE = ['ESTIMATED', 'RECORDED', 'VERIFIED'] as const;
export type TravelEvidence = (typeof TRAVEL_EVIDENCE)[number];

export const TRAVEL_CATEGORY_LABELS: Record<TravelCategory, string> = {
  BETWEEN_SERVICE_USERS: 'travel between service users',
  REQUIRED_WAITING: 'required waiting',
  REST_BREAK: 'rest break',
  ORDINARY_COMMUTE: 'ordinary commute',
  TRAINING_JOURNEY: 'training journey',
  CANCELLED_VISIT_JOURNEY: 'journey to a cancelled visit',
  OTHER: 'other',
};

export type TravelTreatment = 'TRAVEL' | 'WAITING' | 'NOT_WORKING_TIME' | 'BY_DECISION';

/**
 * What a category is by its nature. Travel between service users and waiting the employer
 * requires are working time. A rest break and the ordinary journey from or to home are not.
 * The others depend on the employer's policy, so the person approving says whether they are paid.
 */
export function travelTreatment(category: string): TravelTreatment {
  switch (category) {
    case 'BETWEEN_SERVICE_USERS':
      return 'TRAVEL';
    case 'REQUIRED_WAITING':
      return 'WAITING';
    case 'REST_BREAK':
    case 'ORDINARY_COMMUTE':
      return 'NOT_WORKING_TIME';
    default:
      return 'BY_DECISION';
  }
}

/** Whether an interval is paid: decided by its category, or by the person for policy categories. */
export function intervalIsPayable(category: string, payable: boolean): boolean {
  const treatment = travelTreatment(category);
  if (treatment === 'TRAVEL' || treatment === 'WAITING') return true;
  if (treatment === 'NOT_WORKING_TIME') return false;
  return payable;
}

export type DecidedTravel = {
  /** Minutes paid as travel time and counted as working time. */
  travelMinutes: number;
  /** Minutes paid as waiting time and counted as working time. */
  waitingMinutes: number;
  /** Minutes classified as not payable (rest break, commute, or a policy category not paid). */
  notPaidMinutes: number;
  summary: string;
};

/**
 * The approved intervals of one visit, as the pay run uses them. Null when none is approved: the
 * estimate from the gap between visits then still applies.
 */
export function decidedTravelForVisit(
  intervals: Array<{ category: string; evidence: string; minutes: number; payable: boolean; status: string }>,
): DecidedTravel | null {
  const approved = intervals.filter((i) => i.status === 'APPROVED');
  if (!approved.length) return null;
  const result: DecidedTravel = { travelMinutes: 0, waitingMinutes: 0, notPaidMinutes: 0, summary: '' };
  const parts: string[] = [];
  for (const interval of approved) {
    const minutes = Math.max(0, interval.minutes);
    const paid = intervalIsPayable(interval.category, interval.payable);
    if (!paid) result.notPaidMinutes += minutes;
    else if (travelTreatment(interval.category) === 'WAITING') result.waitingMinutes += minutes;
    else result.travelMinutes += minutes;
    const label = TRAVEL_CATEGORY_LABELS[interval.category as TravelCategory] ?? interval.category.toLowerCase();
    parts.push(`${minutes} min ${label}${paid ? '' : ', not paid'} (${interval.evidence.toLowerCase()})`);
  }
  result.summary = parts.join('; ');
  return result;
}
