import { isClaimConflict, payrollLineClaimKey, weekEarningParts, weekEarningRef } from './payroll-claim.util';

describe('payrollLineClaimKey (SI-01)', () => {
  it('claims a visit per earning component', () => {
    expect(payrollLineClaimKey({ visitReconciliationId: 'r1', lineType: 'VISIT_PAY' })).toBe('VISIT:r1:VISIT_PAY');
    expect(payrollLineClaimKey({ visitReconciliationId: 'r1', lineType: 'MILEAGE' })).toBe('VISIT:r1:MILEAGE');
    expect(payrollLineClaimKey({ visitReconciliationId: 'r1', lineType: 'TRAVEL_TIME' })).toBe('VISIT:r1:TRAVEL_TIME');
  });

  it('gives two carers on one visit different claims (one reconciliation each)', () => {
    const a = payrollLineClaimKey({ visitReconciliationId: 'carer-a-row', lineType: 'VISIT_PAY' });
    const b = payrollLineClaimKey({ visitReconciliationId: 'carer-b-row', lineType: 'VISIT_PAY' });
    expect(a).not.toBe(b);
  });

  it('claims pay items and activities by their own id', () => {
    expect(payrollLineClaimKey({ employeePayItemId: 'p1', sourceType: 'PAY_ITEM', lineType: 'BONUS' })).toBe('PAY_ITEM:p1');
    expect(
      payrollLineClaimKey({ sourceType: 'NON_CORE_ACTIVITY', sourceRef: 'a1', lineType: 'NON_VISIT_ACTIVITY' }),
    ).toBe('NON_CORE_ACTIVITY:a1');
  });

  it('leaves derived lines unclaimed', () => {
    expect(payrollLineClaimKey({ visitReconciliationId: 'r1', lineType: 'NMW_TOP_UP' })).toBeNull();
    expect(payrollLineClaimKey({ sourceType: 'OVERTIME', sourceRef: 'run:emp:2026-10-12', lineType: 'OVERTIME' })).toBeNull();
    expect(payrollLineClaimKey({ sourceType: 'HOLIDAY_ROLLED_UP', sourceRef: 'run:emp', lineType: 'HOLIDAY_PAY' })).toBeNull();
  });

  it('claims overtime per employee and week, not per run (WM-18)', () => {
    const inRunA = payrollLineClaimKey({ sourceType: 'OVERTIME', sourceRef: weekEarningRef('run-a', 'emp', '2026-11-02', 1), lineType: 'OVERTIME' });
    const inRunB = payrollLineClaimKey({ sourceType: 'OVERTIME', sourceRef: weekEarningRef('run-b', 'emp', '2026-11-02', 1), lineType: 'OVERTIME' });
    expect(inRunA).toBe('OVERTIME:emp:2026-11-02:1');
    expect(inRunB).toBe(inRunA); // two runs cannot both hold the first settlement of that week
    expect(
      payrollLineClaimKey({ sourceType: 'OVERTIME', sourceRef: weekEarningRef('run-b', 'emp', '2026-11-02', 2), lineType: 'OVERTIME' }),
    ).toBe('OVERTIME:emp:2026-11-02:2');
    expect(weekEarningParts('run-a:emp:2026-11-02')).toEqual({ employeeId: 'emp', weekKey: '2026-11-02', sequence: null });
  });
});

describe('isClaimConflict', () => {
  it('recognises the unique violation on claimKey only', () => {
    expect(isClaimConflict({ code: 'P2002', meta: { target: ['claimKey'] } })).toBe(true);
    expect(isClaimConflict({ code: 'P2002', meta: { target: 'PayrollRunLine_claimKey_key' } })).toBe(true);
    expect(isClaimConflict({ code: 'P2002', meta: { target: ['payrollRunId', 'employeePayItemId'] } })).toBe(false);
    expect(isClaimConflict(new Error('other'))).toBe(false);
  });
});
