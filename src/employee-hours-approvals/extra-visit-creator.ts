import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';

/**
 * Creates an extra visit a manager approved over a service user's weekly hours. Provided by
 * the visit plans module under this token (looked up at run time, so the two modules do not
 * import each other).
 */
export const EXTRA_VISIT_CREATOR = 'EXTRA_VISIT_CREATOR';

export interface ExtraVisitCreator {
  createApprovedExtraVisit(
    userId: string,
    serviceUserId: string,
    planId: string,
    payload: Record<string, unknown>,
    meta?: RequestAuditMeta,
  ): Promise<{ exceptionId: string }>;

  /** That week's visit minutes today with this extra visit added (the week may have changed since the request). */
  currentExtraVisitWeekHours(
    serviceUserId: string,
    planId: string,
    payload: Record<string, unknown>,
  ): Promise<{ weekMinutes: number; limitWeeklyHours: number | null }>;
}
