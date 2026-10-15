import { VisitAttendanceVerificationMethod } from '@prisma/client';
import {
  nfcCheckInTimelineDetail,
  nfcTagHash,
  toAttendanceVerificationMethod,
} from './employee-app-nfc-check-in.util';

describe('employee-app-nfc-check-in.util', () => {
  it('hashes uid salted with the service user id', () => {
    const su = '11111111-1111-4111-8111-111111111111';
    // sha256("11111111-1111-4111-8111-111111111111:04A23B1C5D8000")
    expect(nfcTagHash(su, '04A23B1C5D8000')).toMatch(/^[0-9a-f]{64}$/);
    expect(nfcTagHash(su, '04A23B1C5D8000')).toBe(nfcTagHash(su, '04A23B1C5D8000'));
    expect(nfcTagHash(su, '04A23B1C5D8000')).not.toBe(
      nfcTagHash('22222222-2222-4222-8222-222222222222', '04A23B1C5D8000'),
    );
  });

  it('maps check-in methods to attendance verification methods', () => {
    expect(toAttendanceVerificationMethod('NFC')).toBe(VisitAttendanceVerificationMethod.NFC);
    expect(toAttendanceVerificationMethod('QR')).toBe(VisitAttendanceVerificationMethod.QR);
    expect(toAttendanceVerificationMethod('GPS')).toBe(VisitAttendanceVerificationMethod.MOBILE_GPS);
    expect(toAttendanceVerificationMethod('MANUAL')).toBe(VisitAttendanceVerificationMethod.MOBILE_GPS);
  });

  it('names the tag in the timeline line', () => {
    expect(nfcCheckInTimelineDetail('Main tag')).toBe('NFC confirmed · Main tag');
    expect(nfcCheckInTimelineDetail(null)).toBe('NFC confirmed');
  });
});
