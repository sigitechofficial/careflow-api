import { visitTimingExceptionReasonLabel } from '../scheduling/visit-timing-exception-reason.util';
import { normalizeCheckInMethod } from './employee-app-check-in-methods.util';

/** Matches the carer-app `ManualOverrideReasons` catalogue. */
export const MANUAL_CHECK_IN_REASON_LABELS: Record<string, string> = {
  GPS_UNAVAILABLE: 'GPS unavailable',
  GPS_INACCURATE: 'GPS inaccurate',
  NFC_TAG_DAMAGED: 'NFC tag damaged',
  QR_UNAVAILABLE: 'QR code unavailable',
  APPROVED_ALTERNATIVE_LOCATION: 'Client at an approved alternative location',
  DEVICE_ISSUE: 'Device issue',
  OTHER: 'Other',
};

export type CheckInArrivalKind = 'early' | 'late';

export type EmployeeAppCheckInBlob = {
  method?: string | null;
  manualOverrideReasonCode?: string | null;
  manualOverrideNotes?: string | null;
  timingStatus?: string | null;
  timingExceptionReasonCode?: string | null;
  timingExceptionNotes?: string | null;
  outsideGeofenceReason?: string | null;
  /** Name of the NFC tag scanned at an NFC check-in. */
  nfcTagLabel?: string | null;
};

export type AdminCheckInSummary = {
  method: string;
  /** e.g. "GPS", "Manual", or "NFC (Main tag)" when the tag name is known. */
  methodLabel: string;
  nfcTagLabel: string | null;
  reasonCode: string | null;
  reasonLabel: string | null;
  notes: string | null;
  timingStatus: CheckInArrivalKind | null;
  timingKindLabel: string | null;
  timingNotesLabel: string | null;
  timingExceptionReasonCode: string | null;
  timingExceptionReasonLabel: string | null;
  timingExceptionNotes: string | null;
  outsideGeofenceReason: string | null;
};

export function checkInMethodLabel(method?: string | null): string {
  switch (normalizeCheckInMethod(method)) {
    case 'MANUAL':
      return 'Manual';
    case 'NFC':
      return 'NFC';
    case 'QR':
      return 'QR';
    default:
      return 'GPS';
  }
}

export function checkInMethodDetailLine(method?: string | null): string {
  switch (normalizeCheckInMethod(method)) {
    case 'MANUAL':
      return 'Manual clock-in';
    case 'NFC':
      return 'NFC confirmed';
    case 'QR':
      return 'QR confirmed';
    default:
      return 'GPS confirmed';
  }
}

export function manualCheckInReasonLabel(code?: string | null): string | null {
  const trimmed = code?.trim();
  if (!trimmed) return null;
  return MANUAL_CHECK_IN_REASON_LABELS[trimmed.toUpperCase()] ?? trimmed;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeCheckInArrivalKind(
  raw?: string | null,
): CheckInArrivalKind | null {
  const status = raw?.trim().toLowerCase();
  if (status === 'early') return 'early';
  if (status === 'late') return 'late';
  return null;
}

export function inferCheckInArrivalKind(
  scheduledStart?: string | Date | null,
  actualStart?: string | Date | null,
): CheckInArrivalKind | null {
  if (!scheduledStart || !actualStart) return null;
  const scheduled = new Date(scheduledStart).getTime();
  const actual = new Date(actualStart).getTime();
  if (Number.isNaN(scheduled) || Number.isNaN(actual) || scheduled === actual) {
    return null;
  }
  return actual < scheduled ? 'early' : 'late';
}

export function checkInArrivalKindLabel(kind: CheckInArrivalKind | null): string | null {
  if (kind === 'early') return 'Early arrival';
  if (kind === 'late') return 'Late arrival';
  return null;
}

export function checkInArrivalNotesLabel(kind: CheckInArrivalKind | null): string {
  if (kind === 'early') return 'More detail on early arrival';
  if (kind === 'late') return 'More detail on late arrival';
  return 'More detail';
}

function parseCheckInBlob(raw: unknown): EmployeeAppCheckInBlob | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const method = readString(row.method);
  const manualOverrideReasonCode = readString(row.manualOverrideReasonCode);
  const manualOverrideNotes = readString(row.manualOverrideNotes);
  const timingStatus = readString(row.timingStatus);
  const timingExceptionReasonCode = readString(row.timingExceptionReasonCode);
  const timingExceptionNotes = readString(row.timingExceptionNotes);
  const outsideGeofenceReason = readString(row.outsideGeofenceReason);
  const nfcTagLabel = readString(row.nfcTagLabel);
  if (
    !method &&
    !manualOverrideReasonCode &&
    !manualOverrideNotes &&
    !timingStatus &&
    !timingExceptionReasonCode &&
    !timingExceptionNotes &&
    !outsideGeofenceReason
  ) {
    return null;
  }
  return {
    method,
    manualOverrideReasonCode,
    manualOverrideNotes,
    timingStatus,
    timingExceptionReasonCode,
    timingExceptionNotes,
    outsideGeofenceReason,
    nfcTagLabel,
  };
}

export function extractEmployeeAppCheckIn(metadata: unknown): EmployeeAppCheckInBlob | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const employeeApp = (metadata as Record<string, unknown>).employeeApp;
  if (!employeeApp || typeof employeeApp !== 'object' || Array.isArray(employeeApp)) {
    return null;
  }
  const fromLast = parseCheckInBlob((employeeApp as Record<string, unknown>).checkIn);
  if (fromLast) return fromLast;
  const checkIns = (employeeApp as Record<string, unknown>).checkIns;
  if (!checkIns || typeof checkIns !== 'object' || Array.isArray(checkIns)) return null;
  const blobs = Object.values(checkIns as Record<string, unknown>)
    .map(parseCheckInBlob)
    .filter((row): row is EmployeeAppCheckInBlob => Boolean(row));
  return blobs[blobs.length - 1] ?? null;
}

/**
 * Every carer's own clock-in blob on a shared visit (`employeeApp.checkIns[employeeId]`).
 * `extractEmployeeAppCheckIn` returns only the latest one, which on a double-up
 * hides the other carers' arrival reasons.
 */
export function extractEmployeeAppCheckInsByEmployee(
  metadata: unknown,
): Record<string, EmployeeAppCheckInBlob> {
  const out: Record<string, EmployeeAppCheckInBlob> = {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return out;
  const employeeApp = (metadata as Record<string, unknown>).employeeApp;
  if (!employeeApp || typeof employeeApp !== 'object' || Array.isArray(employeeApp)) return out;
  const checkIns = (employeeApp as Record<string, unknown>).checkIns;
  if (!checkIns || typeof checkIns !== 'object' || Array.isArray(checkIns)) return out;
  for (const [employeeId, raw] of Object.entries(checkIns as Record<string, unknown>)) {
    const blob = parseCheckInBlob(raw);
    if (blob) out[employeeId] = blob;
  }
  return out;
}

export function buildAdminCheckInSummary(
  blob: EmployeeAppCheckInBlob | null | undefined,
  inferFrom?: { scheduledStart?: string | Date | null; actualStart?: string | Date | null },
): AdminCheckInSummary | null {
  if (!blob) return null;
  const method = normalizeCheckInMethod(blob.method);
  const reasonCode = blob.manualOverrideReasonCode?.trim() || null;
  const notes = blob.manualOverrideNotes?.trim() || null;
  const timingExceptionReasonCode = blob.timingExceptionReasonCode?.trim() || null;
  const timingExceptionNotes = blob.timingExceptionNotes?.trim() || null;
  const outsideGeofenceReason = blob.outsideGeofenceReason?.trim() || null;
  const timingStatus =
    normalizeCheckInArrivalKind(blob.timingStatus) ??
    (timingExceptionReasonCode || timingExceptionNotes
      ? inferCheckInArrivalKind(inferFrom?.scheduledStart, inferFrom?.actualStart)
      : null);
  if (
    !blob.method &&
    !reasonCode &&
    !notes &&
    !timingExceptionReasonCode &&
    !timingExceptionNotes &&
    !outsideGeofenceReason
  ) {
    return null;
  }
  const nfcTagLabel = method === 'NFC' ? blob.nfcTagLabel?.trim() || null : null;
  return {
    method,
    methodLabel: nfcTagLabel ? `NFC (${nfcTagLabel})` : checkInMethodLabel(method),
    nfcTagLabel,
    reasonCode,
    reasonLabel: manualCheckInReasonLabel(reasonCode),
    notes,
    timingStatus,
    timingKindLabel: checkInArrivalKindLabel(timingStatus),
    timingNotesLabel: checkInArrivalNotesLabel(timingStatus),
    timingExceptionReasonCode,
    timingExceptionReasonLabel: visitTimingExceptionReasonLabel(timingExceptionReasonCode),
    timingExceptionNotes,
    outsideGeofenceReason,
  };
}

/** Multi-line log detail: method, then reason / notes / timing when present. */
export function formatCheckInTimelineDetail(
  blob?: EmployeeAppCheckInBlob | null,
  methodFallback?: string | null,
): string {
  const method = blob?.method ?? methodFallback;
  const tag = normalizeCheckInMethod(method) === 'NFC' ? blob?.nfcTagLabel?.trim() : null;
  const lines = [tag ? `NFC confirmed · ${tag}` : checkInMethodDetailLine(method)];
  const reason = manualCheckInReasonLabel(blob?.manualOverrideReasonCode);
  if (reason) lines.push(`Reason: ${reason}`);
  const notes = blob?.manualOverrideNotes?.trim();
  if (notes) lines.push(`Clock in notes: ${notes}`);
  const kind = normalizeCheckInArrivalKind(blob?.timingStatus);
  const timing = visitTimingExceptionReasonLabel(blob?.timingExceptionReasonCode);
  if (timing) {
    lines.push(`${checkInArrivalKindLabel(kind) ?? 'Arrival reason'}: ${timing}`);
  }
  const timingNotes = blob?.timingExceptionNotes?.trim();
  if (timingNotes) {
    lines.push(`${checkInArrivalNotesLabel(kind)}: ${timingNotes}`);
  }
  const outside = blob?.outsideGeofenceReason?.trim();
  if (outside) lines.push(`Outside area: ${outside}`);
  return lines.join('\n');
}
