import { createHash } from 'crypto';
import { VisitAttendanceVerificationMethod } from '@prisma/client';

/**
 * Hash of a client's NFC tag UID, sent to the carer app so it can tell a wrong
 * tag straight away even offline. The server still re-checks the real UID.
 * Salting with the service user id stops one hash matching across clients.
 * App must compute: sha256(`${serviceUserId}:${UID_UPPER_HEX}`) as lower-case hex.
 */
export function nfcTagHash(serviceUserId: string, uid: string): string {
  return createHash('sha256').update(`${serviceUserId}:${uid}`).digest('hex');
}

/** Attendance log method for a normalised check-in method (GPS/NFC/QR/MANUAL). */
export function toAttendanceVerificationMethod(method: string): VisitAttendanceVerificationMethod {
  switch (method) {
    case 'NFC':
      return VisitAttendanceVerificationMethod.NFC;
    case 'QR':
      return VisitAttendanceVerificationMethod.QR;
    default:
      // GPS and carer-app Manual have always been logged as MOBILE_GPS; unchanged.
      return VisitAttendanceVerificationMethod.MOBILE_GPS;
  }
}

/** Timeline line for an NFC check-in, naming the tag when known. */
export function nfcCheckInTimelineDetail(tagLabel: string | null | undefined): string {
  const label = tagLabel?.trim();
  return label ? `NFC confirmed · ${label}` : 'NFC confirmed';
}
