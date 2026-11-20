import { VisitAttendanceEventType, VisitAttendanceVerificationMethod } from '@prisma/client';
import type { VisitTimelineEventType, VisitTimelineSourceType, VisitTimelineTone } from '../employee-app/visit-timeline.types';

/** Log row for a clock time the office recorded; null for anything else (the carer app logs its own). */
export function officeClockTimelineEntry(event: {
  employeeId: string;
  eventType: VisitAttendanceEventType;
  verificationMethod: VisitAttendanceVerificationMethod;
  notes: string | null;
}): {
  eventType: VisitTimelineEventType;
  sourceType: VisitTimelineSourceType;
  sourceId: string;
  title: string;
  detail: string;
  tone: VisitTimelineTone;
} | null {
  if (event.verificationMethod !== VisitAttendanceVerificationMethod.MANUAL_OFFICE) return null;
  const clockIn = event.eventType === VisitAttendanceEventType.CHECK_IN;
  if (!clockIn && event.eventType !== VisitAttendanceEventType.CHECK_OUT) return null;
  return {
    eventType: clockIn ? 'clock_in' : 'clock_out',
    sourceType: clockIn ? 'check_in' : 'complete',
    sourceId: `${clockIn ? 'office_check_in' : 'office_check_out'}:${event.employeeId}`,
    title: clockIn ? 'Clocked in (entered by the office)' : 'Clocked out (entered by the office)',
    detail: officeClockReason(event.notes),
    tone: clockIn ? 'primary' : 'success',
  };
}

/** "MANUAL:PHONE_FAILURE | Battery died | approvedBy:…" → "Reason: phone failure. Battery died". */
export function officeClockReason(notes: string | null): string {
  const parts = String(notes ?? '').split('|').map((p) => p.trim()).filter(Boolean);
  const code = parts.find((p) => p.startsWith('MANUAL:'))?.slice('MANUAL:'.length).trim() ?? '';
  const note = parts.find((p) => !/^(MANUAL|approvedBy|geofenceOverride):/.test(p));
  if (!code || code === 'ADMIN_COMPLETE') {
    return note ? `Recorded when the visit was completed. ${note}` : 'Recorded when the visit was completed.';
  }
  const reason = code.toLowerCase().replace(/_/g, ' ');
  return note ? `Reason: ${reason}. ${note}` : `Reason: ${reason}.`;
}
