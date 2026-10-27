import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';

/**
 * Visit plan actions the hours approvals need: create an approved extra visit, count a week,
 * and cancel visits when the weekly hours go down. Provided by the visit plans module under
 * this token (looked up at run time, so the two modules do not import each other).
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

  /** Weekly hours lowered: weeks over the new hours and the visits that would be cancelled (nothing saved). */
  planHoursDecrease(
    serviceUserId: string,
    newHours: number,
  ): Promise<{
    planId: string | null;
    limitMinutes: number;
    overWeeks: Array<{ weekStart: string; minutes: number }>;
    toCancel: Array<{ date: string; slotLabel: string; startDateTime: string; endDateTime: string; status: string }>;
    stillOverWeeks: Array<{ weekStart: string; minutes: number }>;
  }>;

  /** Put the plan's carers back onto its upcoming rota visits (after an over-hours approval). */
  resyncPlanCarers(userId: string, planId: string): Promise<{ jobsUpdated: number }>;

  /** Weekly hours lowered: cancel the latest visits in each week over the new hours. */
  applyHoursDecrease(
    userId: string,
    serviceUserId: string,
    newHours: number,
    meta?: RequestAuditMeta,
  ): Promise<{ cancelled: number }>;
}
