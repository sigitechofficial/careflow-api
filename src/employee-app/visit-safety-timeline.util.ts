import type { VisitTimelineEventType, VisitTimelineSourceType, VisitTimelineTone } from './visit-timeline.types';

/**
 * Visit Log rows for what happened on arrival and while on site that matters for safety and for trusting the
 * visit's location: how the person was found, a fake (mock) phone location, clocking in outside the visit area,
 * and leaving the area mid-visit (the Care app locks) until the office allows the visit to continue.
 *
 * Each row has a fixed source id, so writing it again updates the same row rather than adding another. The admin
 * visit window's "On arrival and on site" section reads these same rows by the prefixes below.
 */
export const SAFETY_SOURCE_PREFIX = {
  arrival: 'arrival:',
  mockLocation: 'mock_location:',
  outsideArea: 'outside_area:',
  areaLocked: 'area_lock:',
  areaAllowed: 'area_allow:',
} as const;

export type SafetyTimelineEntry = {
  eventType: VisitTimelineEventType;
  sourceType: VisitTimelineSourceType;
  sourceId: string;
  title: string;
  detail: string | null;
  tone: VisitTimelineTone;
};

/** Catalogue tone ok | warn | bad → Log dot colour. */
export function welfareTone(tone: string | null | undefined): VisitTimelineTone {
  if (tone === 'bad') return 'danger';
  if (tone === 'warn') return 'warning';
  return 'success';
}

export type ArrivalAnswers = {
  welfareOutcomeLabel?: string | null;
  welfareOutcomeTone?: string | null;
  personSeen?: boolean | null;
  accessViaKeySafe?: boolean | null;
  requiresManagerReview?: boolean | null;
};

/** "On arrival: Well and comfortable" + seen / key safe / review lines. Null when the carer answered nothing. */
export function arrivalEntry(employeeId: string, a: ArrivalAnswers): SafetyTimelineEntry | null {
  const label = a.welfareOutcomeLabel?.trim() || null;
  const lines: string[] = [];
  if (a.personSeen === true) lines.push('Person seen: yes');
  if (a.personSeen === false) lines.push('Person seen: no');
  if (a.accessViaKeySafe === true) lines.push('Got in using the key safe');
  if (a.requiresManagerReview) lines.push('Needs a manager to review this visit');
  if (!label && !lines.length) return null;
  let tone = welfareTone(a.welfareOutcomeTone);
  if ((a.requiresManagerReview || a.personSeen === false) && tone === 'success') tone = 'warning';
  return {
    eventType: 'clock_in',
    sourceType: 'check_in',
    sourceId: `${SAFETY_SOURCE_PREFIX.arrival}${employeeId}`,
    title: label ? `On arrival: ${label}` : 'On arrival',
    detail: lines.length ? lines.join('\n') : null,
    tone,
  };
}

/** The phone reported a fake (mock) location at clock-in or clock-out. */
export function mockLocationEntry(employeeId: string, at: 'in' | 'out'): SafetyTimelineEntry {
  return {
    eventType: 'presence',
    sourceType: 'presence',
    sourceId: `${SAFETY_SOURCE_PREFIX.mockLocation}${at}:${employeeId}`,
    title: at === 'in' ? 'Mock location at clock-in' : 'Mock location at clock-out',
    detail: "The phone reported a fake (mock) location, so this visit's location can't be trusted.",
    tone: 'danger',
  };
}

/** Clocked in away from the home. Only when the distance is known or the carer gave a reason. */
export function outsideAreaEntry(
  employeeId: string,
  input: { distanceMeters?: number | null; reason?: string | null },
): SafetyTimelineEntry | null {
  const reason = input.reason?.trim() || null;
  const metres =
    input.distanceMeters != null && Number.isFinite(input.distanceMeters) ? Math.round(input.distanceMeters) : null;
  if (metres == null && !reason) return null;
  return {
    eventType: 'presence',
    sourceType: 'presence',
    sourceId: `${SAFETY_SOURCE_PREFIX.outsideArea}${employeeId}`,
    title: metres != null ? `Clocked in ${metres} m outside the visit area` : 'Clocked in outside the visit area',
    detail: reason ? `Reason: ${reason}` : 'No reason given.',
    tone: 'warning',
  };
}

/** Carer left the area mid-visit; the Care app locked the visit. */
export function areaLockedEntry(lock: { id: string; distanceMeters?: number | null }): SafetyTimelineEntry {
  const metres = lock.distanceMeters != null ? Math.round(lock.distanceMeters) : null;
  return {
    eventType: 'presence',
    sourceType: 'presence',
    sourceId: `${SAFETY_SOURCE_PREFIX.areaLocked}${lock.id}`,
    title: 'Left the visit area: Care app locked',
    detail: `${metres != null ? `${metres} m from the home. ` : ''}The carer could not record care until the office allowed the visit to continue.`,
    tone: 'danger',
  };
}

/** Office allowed the carer to carry on after leaving the area. */
export function areaAllowedEntry(lock: {
  id: string;
  allowedByName?: string | null;
  allowNote?: string | null;
}): SafetyTimelineEntry {
  const by = lock.allowedByName?.trim();
  return {
    eventType: 'presence',
    sourceType: 'presence',
    sourceId: `${SAFETY_SOURCE_PREFIX.areaAllowed}${lock.id}`,
    title: by ? `Allowed to continue by ${by}` : 'Allowed to continue by the office',
    detail: lock.allowNote?.trim() || null,
    tone: 'success',
  };
}
