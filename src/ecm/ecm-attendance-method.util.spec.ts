import {
  hasElectronicAttendanceEvidence,
  hasManualOfficeAttendanceEvidence,
  isElectronicAttendanceMethod,
  shouldFlagManualAttendance,
} from './ecm-attendance-method.util';

describe('ecm-attendance-method.util', () => {
  it('treats mobile GPS / NFC / QR as electronic', () => {
    expect(isElectronicAttendanceMethod('MOBILE_GPS')).toBe(true);
    expect(isElectronicAttendanceMethod('NFC')).toBe(true);
    expect(isElectronicAttendanceMethod('QR')).toBe(true);
    expect(isElectronicAttendanceMethod('MANUAL_OFFICE')).toBe(false);
  });

  it('flags manual when admin completes even if GPS seed events exist', () => {
    expect(
      shouldFlagManualAttendance({
        completedOutcome: true,
        hasActualStart: true,
        officeCompleted: true,
        attendanceEvents: [{ verificationMethod: 'MOBILE_GPS' }],
      }),
    ).toBe(true);
  });

  it('flags manual when MANUAL_OFFICE evidence exists alongside GPS', () => {
    expect(
      hasManualOfficeAttendanceEvidence([
        { verificationMethod: 'MOBILE_GPS' },
        { verificationMethod: 'MANUAL_OFFICE' },
      ]),
    ).toBe(true);
    expect(
      shouldFlagManualAttendance({
        completedOutcome: true,
        hasActualStart: true,
        attendanceEvents: [
          { verificationMethod: 'MOBILE_GPS' },
          { verificationMethod: 'MANUAL_OFFICE' },
        ],
      }),
    ).toBe(true);
  });

  it('keeps electronic when only carer-app GPS evidence exists', () => {
    expect(
      shouldFlagManualAttendance({
        completedOutcome: true,
        hasActualStart: true,
        attendanceEvents: [{ verificationMethod: 'MOBILE_GPS' }],
      }),
    ).toBe(false);
    expect(
      hasElectronicAttendanceEvidence([{ verificationMethod: 'MOBILE_GPS' }]),
    ).toBe(true);
  });

  it('flags manual for office-only completion with no mobile evidence', () => {
    expect(
      shouldFlagManualAttendance({
        completedOutcome: true,
        hasActualStart: true,
        attendanceEvents: [],
      }),
    ).toBe(true);
  });
});
