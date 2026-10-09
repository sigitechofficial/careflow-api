import { VisitAttendanceVerificationMethod } from '@prisma/client';

/** Device / carer-app evidence — counts as Electronic when office did not complete. */
const ELECTRONIC_VERIFICATION_METHODS = new Set<string>([
  VisitAttendanceVerificationMethod.MOBILE_GPS,
  VisitAttendanceVerificationMethod.NFC,
  VisitAttendanceVerificationMethod.QR,
]);

export function isElectronicAttendanceMethod(
  method: VisitAttendanceVerificationMethod | string | null | undefined,
): boolean {
  if (!method) return false;
  return ELECTRONIC_VERIFICATION_METHODS.has(String(method).toUpperCase());
}

export function hasElectronicAttendanceEvidence(
  events: Array<{ verificationMethod: VisitAttendanceVerificationMethod | string }>,
): boolean {
  return events.some((e) => isElectronicAttendanceMethod(e.verificationMethod));
}

export function hasManualOfficeAttendanceEvidence(
  events: Array<{ verificationMethod: VisitAttendanceVerificationMethod | string }>,
): boolean {
  return events.some(
    (e) =>
      String(e.verificationMethod ?? '').toUpperCase() ===
      VisitAttendanceVerificationMethod.MANUAL_OFFICE,
  );
}

/**
 * Manual vs Electronic SSOT for ECM graphs:
 * - Admin panel complete (officeCompleted / MANUAL_OFFICE) → Manual
 * - Carer mobile app evidence only → Electronic
 */
export function shouldFlagManualAttendance(input: {
  completedOutcome: boolean;
  hasActualStart: boolean;
  attendanceEvents: Array<{ verificationMethod: VisitAttendanceVerificationMethod | string }>;
  checkInVerificationMethod?: VisitAttendanceVerificationMethod | string | null;
  /** Set when schedule-jobs / admin housekeeping completes the visit. */
  officeCompleted?: boolean;
}): boolean {
  if (!input.completedOutcome || !input.hasActualStart) return false;

  // Admin complete always wins — even if seed/demo GPS events already exist.
  if (input.officeCompleted) return true;
  if (hasManualOfficeAttendanceEvidence(input.attendanceEvents)) return true;
  if (
    String(input.checkInVerificationMethod ?? '').toUpperCase() ===
    VisitAttendanceVerificationMethod.MANUAL_OFFICE
  ) {
    return true;
  }

  // Carer app GPS / NFC / QR → Electronic
  if (hasElectronicAttendanceEvidence(input.attendanceEvents)) return false;

  // Completed with times but no mobile evidence (legacy / office-only) → Manual
  return true;
}

/**
 * Office-facing label for one attendance event.
 * The attendance log stores carer-app Manual check-ins as MOBILE_GPS, so for a
 * CHECK_IN pass the carer-app method from the check-in record when known.
 */
export function attendanceEventMethodLabel(input: {
  verificationMethod: VisitAttendanceVerificationMethod | string | null | undefined;
  appCheckInMethod?: string | null;
  nfcTagLabel?: string | null;
}): string {
  const app = input.appCheckInMethod?.trim().toUpperCase();
  const stored = String(input.verificationMethod ?? '').toUpperCase();
  const method = app || stored;
  const tag = input.nfcTagLabel?.trim();
  switch (method) {
    case 'NFC':
      return tag ? `NFC tag · ${tag}` : 'NFC tag';
    case 'QR':
      return 'QR code';
    case 'MANUAL':
      return 'Manual (carer)';
    case VisitAttendanceVerificationMethod.MANUAL_OFFICE:
      return 'Office (manual)';
    case VisitAttendanceVerificationMethod.TELEPHONE:
      return 'Telephone';
    case 'GPS':
    case VisitAttendanceVerificationMethod.MOBILE_GPS:
      return 'GPS';
    default:
      return method ? method.charAt(0) + method.slice(1).toLowerCase() : '—';
  }
}
