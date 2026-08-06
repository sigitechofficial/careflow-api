import {
  EMPLOYEE_APP_CHECK_IN_ARRIVAL_REASON_CODES,
  employeeAppEarlyArrivalReasons,
  employeeAppLateArrivalReasons,
  isEmployeeAppCheckInArrivalReasonCode,
} from './employee-app-check-in-arrival-reasons';

describe('employee-app check-in arrival reasons', () => {
  it('exposes early and late catalogues with code + label', () => {
    const early = employeeAppEarlyArrivalReasons();
    const late = employeeAppLateArrivalReasons();

    expect(early.length).toBeGreaterThan(0);
    expect(late.length).toBeGreaterThan(0);

    for (const list of [early, late]) {
      for (const item of list) {
        expect(item.code).toBeTruthy();
        expect(item.label).toBeTruthy();
        expect(isEmployeeAppCheckInArrivalReasonCode(item.code)).toBe(true);
      }
    }
  });

  it('marks OTHER as requiring notes on both lists', () => {
    const earlyOther = employeeAppEarlyArrivalReasons().find((r) => r.code === 'OTHER');
    const lateOther = employeeAppLateArrivalReasons().find((r) => r.code === 'OTHER');
    expect(earlyOther?.requiresNotes).toBe(true);
    expect(lateOther?.requiresNotes).toBe(true);
  });

  it('keeps early vs late lists distinct (both keys always present)', () => {
    const earlyCodes = employeeAppEarlyArrivalReasons().map((r) => r.code);
    const lateCodes = employeeAppLateArrivalReasons().map((r) => r.code);
    expect(earlyCodes).toContain('CLIENT_REQUESTED_EARLIER');
    expect(lateCodes).toContain('PREVIOUS_VISIT_OVERRAN');
    expect(lateCodes).toContain('TRAVEL_OR_TRAFFIC');
    expect(earlyCodes).not.toEqual(lateCodes);
  });

  it('documents stable check-in codes accepted on POST check-in', () => {
    expect([...EMPLOYEE_APP_CHECK_IN_ARRIVAL_REASON_CODES]).toEqual([
      'PREVIOUS_VISIT_OVERRAN',
      'TRAVEL_OR_TRAFFIC',
      'CLIENT_REQUESTED_EARLIER',
      'EMERGENCY',
      'SCHEDULING_CHANGE',
      'OTHER',
    ]);
  });

  it('sorts by sortOrder ascending', () => {
    const late = employeeAppLateArrivalReasons();
    const orders = late.map((r) => r.sortOrder ?? 0);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});
