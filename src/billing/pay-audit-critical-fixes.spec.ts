import { resolveDefaultApprovedWindows } from './visit-reconciliation.util';
import { FinanceExceptionCode } from '@prisma/client';
import { calculateBandedPay } from './pay-time-band.util';
import { ageInFullYears, validateMinimumWage } from './pay-compliance.util';

describe('resolveDefaultApprovedWindows overrun approval', () => {
  const plannedStart = new Date('2026-07-13T10:00:00.000Z');
  const plannedEnd = new Date('2026-07-13T10:30:00.000Z');
  const actualStart = new Date('2026-07-13T10:00:00.000Z');
  const actualEnd = new Date('2026-07-13T11:15:00.000Z'); // 75 min

  it('pending overrun pays planned 30 minutes only', () => {
    const w = resolveDefaultApprovedWindows({
      plannedStartDateTime: plannedStart,
      plannedEndDateTime: plannedEnd,
      actualStartDateTime: actualStart,
      actualEndDateTime: actualEnd,
      exceptions: [{ code: FinanceExceptionCode.OVERRUN, message: 'over' }],
      overrunDecision: 'PENDING',
    });
    expect(w.approvedPayEnd.getTime()).toBe(plannedEnd.getTime());
  });

  it('approved overrun pays actual 75 minutes', () => {
    const w = resolveDefaultApprovedWindows({
      plannedStartDateTime: plannedStart,
      plannedEndDateTime: plannedEnd,
      actualStartDateTime: actualStart,
      actualEndDateTime: actualEnd,
      exceptions: [{ code: FinanceExceptionCode.OVERRUN, message: 'over' }],
      overrunDecision: 'APPROVED',
    });
    expect(w.approvedPayEnd.getTime()).toBe(actualEnd.getTime());
  });
});

describe('Sunday into Monday bank holiday per-segment', () => {
  it('applies bank-holiday rate only after midnight when isBankHolidayFn marks Monday', () => {
    const rules = [
      { label: 'Sunday', dayType: 'SUNDAY', rateType: 'HOURLY', amount: 16, priority: 5, sortOrder: 0 },
      { label: 'BH', dayType: 'BANK_HOLIDAY', rateType: 'HOURLY', amount: 21, priority: 10, sortOrder: 0 },
    ];
    const start = new Date('2026-07-12T22:00:00.000Z'); // Sunday
    const end = new Date('2026-07-13T02:00:00.000Z'); // Monday
    const result = calculateBandedPay({
      start,
      end,
      rules,
      isBankHolidayFn: (d) => d.toISOString().slice(0, 10) === '2026-07-13',
    });
    expect(result?.totalMinutes).toBe(240);
    // 2h Sunday @ 16 + 2h Monday BH @ 21
    expect(result?.totalAmount).toBe(32 + 42);
  });
});

describe('ageInFullYears', () => {
  it('changes category on birthday', () => {
    const dob = new Date('2005-07-14T00:00:00.000Z');
    expect(ageInFullYears(dob, new Date('2026-07-13T00:00:00.000Z'))).toBe(20);
    expect(ageInFullYears(dob, new Date('2026-07-14T00:00:00.000Z'))).toBe(21);
  });
});

describe('NMW unpaid travel', () => {
  it('detects shortfall when unpaid travel hours are included', () => {
    const result = validateMinimumWage({
      category: 'AGE_21_AND_OVER',
      components: [
        { amount: 140, includesInNmwPay: true, countsAsNmwHours: true, hours: 10 },
        { amount: 0, includesInNmwPay: true, countsAsNmwHours: true, hours: 2 },
      ],
    });
    expect(result.compliant).toBe(false);
    expect(result.topUp).toBeGreaterThan(0);
  });
});
