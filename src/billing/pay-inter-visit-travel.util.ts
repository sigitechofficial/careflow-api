/**
 * Auto inter-visit travel for UK domiciliary NMW compliance.
 *
 * HMRC: time spent travelling between assignments is working time for NMW.
 * Ordinary home-to-first / last-to-home commuting generally is not.
 *
 * This module detects gaps between consecutive payable visits for the same worker
 * and attributes qualifying minutes to the destination visit.
 */

import { dayKeyInTimeZone } from '../common/utils/operational-day.util';
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
  /** Map point of the visit address (for travel worked out from distance). */
  latitude?: number | null;
  longitude?: number | null;
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
  /** Miles of the journey when travel is worked out from distance. */
  travelMiles?: number;
};

/** How the journey between two visits is paid. */
export type TravelPayBasis = 'GAP' | 'DISTANCE';
export const TRAVEL_PAY_BASES: readonly TravelPayBasis[] = ['GAP', 'DISTANCE'];

/** A journey longer than this is not paid automatically (likely a wrong address); flagged for review. */
export const DEFAULT_MAX_AUTO_TRAVEL_MILES = 50;

/** Straight-line distance in miles between two map points. */
export function straightLineMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

export type DetectInterVisitTravelOptions = {
  longBreakMinutes?: number;
  maxAutoTravelGapMinutes?: number;
  shortGapMinutes?: number;
  /**
   * When true (default), long gaps (≥ longBreakMinutes) are treated as returned-home
   * unpaid personal time unless they are still short enough and different SUs suggest travel.
   */
  assumeReturnHomeOnLongGap?: boolean;
  /**
   * When false, gaps are not paid automatically: only journeys to visits with travel minutes
   * entered by hand are kept. Default true.
   */
  autoPayGaps?: boolean;
  /**
   * GAP (default): the gap rules above. DISTANCE: on the same day, the journey between two
   * service users is worked out from their map points (× roadFactor at averageSpeedMph), however
   * long the gap; once the date changes nothing is paid.
   */
  basis?: TravelPayBasis;
  averageSpeedMph?: number;
  /** Roads are not straight: straight-line miles × this. */
  roadFactor?: number;
  /** Operational timezone, for "same day". */
  timeZone?: string;
  maxAutoMiles?: number;
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
  const autoPayGaps = options.autoPayGaps !== false;

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
      if (!autoPayGaps && !((to.manualTravelMinutes ?? 0) > 0)) continue;

      if (options.basis === 'DISTANCE' && !((to.manualTravelMinutes ?? 0) > 0)) {
        const journey = distanceJourney(from, to, employeeId, gapMinutes, options);
        if (journey) journeys.push(journey);
        continue;
      }

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
  travelMiles: number;
} {
  const mine = journeys.filter((j) => j.toReconciliationId === toReconciliationId);
  return {
    payableTravelMinutes: mine.reduce((s, j) => s + j.payableTravelMinutes, 0),
    payableWaitingMinutes: mine.reduce((s, j) => s + j.payableWaitingMinutes, 0),
    unpaidNmwMinutes: mine.reduce((s, j) => s + j.unpaidNmwMinutes, 0),
    nmwMinutes: mine.reduce((s, j) => s + j.nmwMinutes, 0),
    explanations: mine.map((j) => j.explanation),
    requiresManagerReview: mine.some((j) => j.requiresManagerReview),
    travelMiles: Math.round(mine.reduce((s, j) => s + (j.travelMiles ?? 0), 0) * 10) / 10,
  };
}

/**
 * DISTANCE basis: the journey between two visits on the same day, from the two addresses.
 * Null = no journey (date changed, or the same service user).
 */
function distanceJourney(
  from: InterVisitWindow,
  to: InterVisitWindow,
  employeeId: string,
  gapMinutes: number,
  options: DetectInterVisitTravelOptions,
): InterVisitJourney | null {
  const timeZone = options.timeZone ?? 'Europe/London';
  if (dayKeyInTimeZone(from.payEnd, timeZone) !== dayKeyInTimeZone(to.payStart, timeZone)) return null;
  if (from.serviceUserId && from.serviceUserId === to.serviceUserId) return null;

  const base = {
    fromReconciliationId: from.reconciliationId,
    toReconciliationId: to.reconciliationId,
    employeeId,
    fromVisitRef: from.visitRef,
    toVisitRef: to.visitRef,
    gapMinutes,
    payableWaitingMinutes: 0,
    unpaidNmwMinutes: 0,
  };
  const review = (explanation: string): InterVisitJourney => ({
    ...base,
    classification: 'REQUIRES_MANAGER_REVIEW',
    nmwMinutes: 0,
    payableTravelMinutes: 0,
    travelMiles: 0,
    explanation,
    requiresManagerReview: true,
  });

  if (from.latitude == null || from.longitude == null || to.latitude == null || to.longitude == null) {
    return review(`No map location for one of the addresses (${from.visitRef} → ${to.visitRef}); enter the travel by hand`);
  }
  const roadFactor = options.roadFactor ?? 1.3;
  const speed = options.averageSpeedMph ?? 20;
  const maxMiles = options.maxAutoMiles ?? DEFAULT_MAX_AUTO_TRAVEL_MILES;
  const miles =
    Math.round(
      straightLineMiles(
        { latitude: from.latitude, longitude: from.longitude },
        { latitude: to.latitude, longitude: to.longitude },
      ) *
        roadFactor *
        10,
    ) / 10;
  if (miles > maxMiles) {
    return review(`${miles} miles between ${from.visitRef} and ${to.visitRef} is over ${maxMiles}; check the addresses`);
  }
  const minutes = miles > 0 ? Math.max(1, Math.ceil((miles / speed) * 60)) : 0;
  return {
    ...base,
    classification: 'PAID_TRAVEL',
    nmwMinutes: minutes,
    payableTravelMinutes: minutes,
    travelMiles: miles,
    explanation: `${miles} mi at ${speed} mph = ${minutes}m travel ${from.visitRef} → ${to.visitRef} (gap ${gapMinutes}m)`,
    // The drive takes longer than the gap: the visit times need a look.
    requiresManagerReview: minutes > gapMinutes,
  };
}
