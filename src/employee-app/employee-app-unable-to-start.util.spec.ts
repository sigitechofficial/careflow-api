import {
  buildUnableToStartBlock,
  employeeAppUnableToStartReasons,
  isEmployeeAppUnableToStartReasonCode,
} from './employee-app-unable-to-start.util';

describe('employee-app-unable-to-start.util', () => {
  it('exposes the care-not-delivered catalogue with notesRequired', () => {
    const reasons = employeeAppUnableToStartReasons();
    expect(reasons.map((r) => r.code)).toEqual([
      'CLIENT_NOT_HOME',
      'CLIENT_IN_HOSPITAL',
      'CLIENT_DECEASED',
      'CLIENT_REFUSED',
      'UNSAFE_SITUATION',
      'OTHER',
    ]);
    expect(reasons.every((r) => r.notesRequired)).toBe(true);
    expect(reasons.every((r) => r.description.length > 0)).toBe(true);
    expect(isEmployeeAppUnableToStartReasonCode('CLIENT_NOT_HOME')).toBe(true);
    expect(isEmployeeAppUnableToStartReasonCode('NO_ANSWER')).toBe(false);
  });

  it('allows report only when checked in, open, and not already reported', () => {
    expect(
      buildUnableToStartBlock({
        isCheckedIn: true,
        visitClosed: false,
        existing: null,
      }).canReport,
    ).toBe(true);

    expect(
      buildUnableToStartBlock({
        isCheckedIn: false,
        visitClosed: false,
        existing: null,
      }).canReport,
    ).toBe(false);

    expect(
      buildUnableToStartBlock({
        isCheckedIn: true,
        visitClosed: true,
        existing: null,
      }).canReport,
    ).toBe(false);

    const reported = buildUnableToStartBlock({
      isCheckedIn: true,
      visitClosed: false,
      existing: {
        reasonCode: 'CLIENT_NOT_HOME',
        reasonLabel: 'Client not at home',
        notes: 'No answer',
        recordedAt: '2026-08-07T06:05:01.000Z',
      },
    });
    expect(reported.canReport).toBe(false);
    expect(reported.alreadyReported).toBe(true);
    expect(reported.summary?.reasonCode).toBe('CLIENT_NOT_HOME');
  });
});
