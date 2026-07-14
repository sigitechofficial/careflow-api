/**
 * Auto inter-visit travel for UK domiciliary NMW compliance.
 *
 * HMRC: time spent travelling between assignments is working time for NMW.
 * Ordinary home-to-first / last-to-home commuting generally is not.
 *
 * This module detects gaps between consecutive payable visits for the same worker
 * and attributes qualifying minutes to the destination visit.
 */

import {
  classifyGapBetweenVisits,
  type GapClassification,
} from './pay-mileage.util';

/** Gaps at or above this (minutes) are treated as possible home / personal break. */
export const DEFAULT_LONG_BREAK_MINUTES = 60;

/** Gaps above this are not auto-treated as travel (flag for review). */
export const DEFAULT_MAX_AUTO_TRAVEL_GAP_MINUTES = 90;

/** Short gaps where the worker cannot reasonably use the time personally. */
export const DEFAULT_SHORT_GAP_MINUTES = 15;

export type InterVisitWindow = {
  reconciliationId: string;
  employeeId: string;
  visitRef: string;
  payStart: Date;
  payEnd: Date;
  /** Manual travel minutes already recorded on the destination recon (journey to this visit). */
  manualTravelMinutes?: number | null;
  /** Manual unpaid travel already recorded. */
  manualUnpaidTravelMinutes?: number | null;
  serviceUserId?: string | null;
};

export type InterVisitJourney = {
  fromReconciliationId: string;
  toReconciliationId: string;
  employeeId: string;
  fromVisitRef: string;
  toVisitRef: string;
  gapMinutes: number;
  classification: GapClassification;
  /** Minutes that count as NMW working time. */
  nmwMinutes: number;
  /** Minutes to pay as TRAVEL_TIME when a rate exists (subset of nmwMinutes). */
  payableTravelMinutes: number;
  /** Minutes to pay as WAITING_TIME when a rate exists. */
  payableWaitingMinutes: number;
  /** Minutes to add as unpaid NMW hours when not separately paid. */
  unpaidNmwMinutes: number;
  explanation: string;
  requiresManagerReview: boolean;
};

export type DetectInterVisitTravelOptions = {
  longBreakMinutes?: number;
  maxAutoTravelGapMinutes?: number;
  shortGapMinutes?: number;
  /**
   * When true (default), long gaps (≥ longBreakMinutes) are treated as returned-home
   * unpaid personal time unless they are still short enough and different SUs suggest travel.
   */
  assumeReturnHomeOnLongGap?: boolean;
};

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

/**
 * Detect qualifying travel / wait gaps between consecutive visits for each worker.
 * Windows must already be sorted by payStart ascending (or will be sorted).
 */
export function detectInterVisitTravel(
  windows: InterVisitWindow[],
  options: DetectInterVisitTravelOptions = {},
): InterVisitJourney[] {
  const longBreak = options.longBreakMinutes ?? DEFAULT_LONG_BREAK_MINUTES;
  const maxGap = options.maxAutoTravelGapMinutes ?? DEFAULT_MAX_AUTO_TRAVEL_GAP_MINUTES;
  const shortGap = options.shortGapMinutes ?? DEFAULT_SHORT_GAP_MINUTES;
  const assumeReturnHome = options.assumeReturnHomeOnLongGap !== false;

  const byEmployee = new Map<string, InterVisitWindow[]>();
  for (const w of windows) {
    if (!w.employeeId || !w.payStart || !w.payEnd) continue;
    const list = byEmployee.get(w.employeeId) ?? [];
    list.push(w);
    byEmployee.set(w.employeeId, list);
  }

  const journeys: InterVisitJourney[] = [];

  for (const [employeeId, list] of byEmployee) {
    const ordered = [...list].sort((a, b) => a.payStart.getTime() - b.payStart.getTime());
    for (let i = 0; i < ordered.length - 1; i++) {
      const from = ordered[i];
      const to = ordered[i + 1];
      if (to.payStart.getTime() <= from.payEnd.getTime()) continue; // overlapping / contiguous

      const gapMinutes = minutesBetween(from.payEnd, to.payStart);
      if (gapMinutes <= 0) continue;

      const differentClients =
        !!from.serviceUserId &&
        !!to.serviceUserId &&
        from.serviceUserId !== to.serviceUserId;

      const returnedHome =
        assumeReturnHome && gapMinutes >= longBreak && !differentClients
          ? true
          : assumeReturnHome && gapMinutes >= maxGap;

      const classification = classifyGapBetweenVisits({
        gapMinutes,
        returnedHome,
        hasApprovedTravel: (to.manualTravelMinutes ?? 0) > 0,
        cannotUsePersonally: gapMinutes <= shortGap,
        genuineRestBreak: false,
        employerRequiredWait: false,
        shortGapMinutes: shortGap,
        longBreakMinutes: longBreak,
      });

      // Already has approved travel on destination — trust manual value for payable travel,
      // but ensure NMW hours are at least that duration.
      if (classification === 'PAID_TRAVEL' && (to.manualTravelMinutes ?? 0) > 0) {
        const manual = to.manualTravelMinutes ?? 0;
        journeys.push({
          fromReconciliationId: from.reconciliationId,
          toReconciliationId: to.reconciliationId,
          employeeId,
          fromVisitRef: from.visitRef,
          toVisitRef: to.visitRef,
          gapMinutes,
          classification,
          nmwMinutes: Math.max(manual, Math.min(gapMinutes, maxGap)),
          payableTravelMinutes: 0, // already on recon; payroll uses recon.travelMinutes
          payableWaitingMinutes: 0,
          unpaidNmwMinutes: Math.max(0, Math.min(gapMinutes, maxGap) - manual),
          explanation: `Manual travel ${manual}m to ${to.visitRef}; gap ${gapMinutes}m`,
          requiresManagerReview: gapMinutes > maxGap,
        });
        continue;
      }

      if (classification === 'UNPAID_REST_BREAK' || classification === 'UNPAID_PERSONAL') {
        journeys.push({
          fromReconciliationId: from.reconciliationId,
          toReconciliationId: to.reconciliationId,
          employeeId,
          fromVisitRef: from.visitRef,
          toVisitRef: to.visitRef,
          gapMinutes,
          classification,
          nmwMinutes: 0,
          payableTravelMinutes: 0,
          payableWaitingMinutes: 0,
          unpaidNmwMinutes: 0,
          explanation: `Gap ${gapMinutes}m classified as ${classification} (not NMW travel)`,
          requiresManagerReview: false,
        });
        continue;
      }

      const capped = Math.min(gapMinutes, maxGap);
      const requiresManagerReview =
        classification === 'REQUIRES_MANAGER_REVIEW' || gapMinutes > maxGap;

      // Conservative for NMW: treat travel / wait / review gaps as working time.
      let payableTravelMinutes = 0;
      let payableWaitingMinutes = 0;
      if (classification === 'PAID_WAITING') {
        payableWaitingMinutes = capped;
      } else {
        // PAID_TRAVEL or REQUIRES_MANAGER_REVIEW → treat as travel for pay attempt
        payableTravelMinutes = capped;
      }

      const unpaidAlready = to.manualUnpaidTravelMinutes ?? 0;

      journeys.push({
        fromReconciliationId: from.reconciliationId,
        toReconciliationId: to.reconciliationId,
        employeeId,
        fromVisitRef: from.visitRef,
        toVisitRef: to.visitRef,
        gapMinutes,
        classification,
        nmwMinutes: capped,
        payableTravelMinutes,
        payableWaitingMinutes,
        unpaidNmwMinutes: Math.max(0, capped - unpaidAlready),
        explanation: `Auto ${classification}: ${capped}m between ${from.visitRef} → ${to.visitRef} (gap ${gapMinutes}m)`,
        requiresManagerReview,
      });
    }
  }

  return journeys;
}

/**
 * Merge auto journeys into a per-destination summary for payroll (avoid double-counting manuals).
 */
export function summariseTravelForDestination(
  journeys: InterVisitJourney[],
  toReconciliationId: string,
): {
  payableTravelMinutes: number;
  payableWaitingMinutes: number;
  unpaidNmwMinutes: number;
  nmwMinutes: number;
  explanations: string[];
  requiresManagerReview: boolean;
} {
  const mine = journeys.filter((j) => j.toReconciliationId === toReconciliationId);
  return {
    payableTravelMinutes: mine.reduce((s, j) => s + j.payableTravelMinutes, 0),
    payableWaitingMinutes: mine.reduce((s, j) => s + j.payableWaitingMinutes, 0),
    unpaidNmwMinutes: mine.reduce((s, j) => s + j.unpaidNmwMinutes, 0),
    nmwMinutes: mine.reduce((s, j) => s + j.nmwMinutes, 0),
    explanations: mine.map((j) => j.explanation),
    requiresManagerReview: mine.some((j) => j.requiresManagerReview),
  };
}
