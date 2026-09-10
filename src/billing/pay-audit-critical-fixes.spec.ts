import {
  resolveDefaultApprovedWindows,
  isLegacyLateStartBillWindow,
} from './visit-reconciliation.util';
import { FinanceExceptionCode } from '@prisma/client';
import { calculateBandedPay } from './pay-time-band.util';
import { ageInFullYears, validateMinimumWage } from './pay-compliance.util';

describe('isLegacyLateStartBillWindow', () => {
  const plannedStart = new Date('2026-09-10T06:00:00.000Z');
  const actualStart = new Date('2026-09-10T06:11:00.000Z');

  it('detects booked-start bill with actual pay after late check-in', () => {
    expect(
      isLegacyLateStartBillWindow({
        plannedStartDateTime: plannedStart,
        actualStartDateTime: actualStart,
        approvedPayStart: actualStart,
        approvedBillStart: plannedStart,
      }),
    ).toBe(true);
  });

  it('ignores rows already using actual bill start', () => {
    expect(
      isLegacyLateStartBillWindow({
        plannedStartDateTime: plannedStart,
        actualStartDateTime: actualStart,
        approvedPayStart: actualStart,
        approvedBillStart: actualStart,
      }),
    ).toBe(false);
  });
});

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

  it('early visit finished before planned start bills actual worked time', () => {
    const earlyStart = new Date('2026-08-12T12:05:00.000Z');
    const earlyEnd = new Date('2026-08-12T12:22:00.000Z');
    const slotStart = new Date('2026-08-12T13:00:00.000Z');
    const slotEnd = new Date('2026-08-12T14:30:00.000Z');
    const w = resolveDefaultApprovedWindows({
      plannedStartDateTime: slotStart,
      plannedEndDateTime: slotEnd,
      actualStartDateTime: earlyStart,
      actualEndDateTime: earlyEnd,
      exceptions: [{ code: FinanceExceptionCode.UNDERRUN, message: 'short' }],
    });
    expect(w.approvedBillStart.getTime()).toBe(earlyStart.getTime());
    expect(w.approvedBillEnd.getTime()).toBe(earlyEnd.getTime());
    expect(w.approvedBillEnd.getTime()).toBeGreaterThan(w.approvedBillStart.getTime());
  });
});

describe('resolveDefaultApprovedWindows duration tolerance', () => {
  it('fixed ≤60: early leave within tolerance pays and charges full planned', () => {
    const plannedStart = new Date('2026-07-13T10:00:00.000Z');
    const plannedEnd = new Date('2026-07-13T10:45:00.000Z'); // 45 min fixed
    const actualEnd = new Date('2026-07-13T10:37:00.000Z'); // 8 min early
    const w = resolveDefaultApprovedWindows({
      plannedStartDateTime: plannedStart,
      plannedEndDateTime: plannedEnd,
      actualStartDateTime: plannedStart,
      actualEndDateTime: actualEnd,
      exceptions: [],
      durationToleranceMinutes: 15,
    });
    expect(w.approvedPayStart.getTime()).toBe(plannedStart.getTime());
    expect(w.approvedPayEnd.getTime()).toBe(plannedEnd.getTime());
    expect(w.approvedBillStart.getTime()).toBe(plannedStart.getTime());
    expect(w.approvedBillEnd.getTime()).toBe(plannedEnd.getTime());
  });

  it('pro-rata >60: early leave within tolerance pays and charges full planned', () => {
    const plannedStart = new Date('2026-07-13T10:00:00.000Z');
    const plannedEnd = new Date('2026-07-13T11:30:00.000Z'); // 90 min
    const actualEnd = new Date('2026-07-13T11:18:00.000Z'); // 12 min short
    const w = resolveDefaultApprovedWindows({
      plannedStartDateTime: plannedStart,
      plannedEndDateTime: plannedEnd,
      actualStartDateTime: plannedStart,
      actualEndDateTime: actualEnd,
      exceptions: [{ code: FinanceExceptionCode.UNDERRUN, message: 'short' }],
      durationToleranceMinutes: 20,
    });
    expect(w.approvedPayEnd.getTime()).toBe(plannedEnd.getTime());
    expect(w.approvedBillEnd.getTime()).toBe(plannedEnd.getTime());
  });

  it('shortfall beyond tolerance keeps actual pay/charge windows', () => {
    const plannedStart = new Date('2026-07-13T10:00:00.000Z');
    const plannedEnd = new Date('2026-07-13T11:00:00.000Z');
    const actualEnd = new Date('2026-07-13T10:30:00.000Z'); // 30 min short
    const w = resolveDefaultApprovedWindows({
      plannedStartDateTime: plannedStart,
      plannedEndDateTime: plannedEnd,
      actualStartDateTime: plannedStart,
      actualEndDateTime: actualEnd,
      exceptions: [{ code: FinanceExceptionCode.UNDERRUN, message: 'short' }],
      durationToleranceMinutes: 15,
    });
    expect(w.approvedPayEnd.getTime()).toBe(actualEnd.getTime());
    expect(w.approvedBillEnd.getTime()).toBe(actualEnd.getTime());
  });

  it('late start + underrun bills actual worked time (not planned start → actual end)', () => {
    const plannedStart = new Date('2026-09-10T06:00:00.000Z'); // 07:00 BST
    const plannedEnd = new Date('2026-09-10T07:00:00.000Z'); // 08:00 BST
    const actualStart = new Date('2026-09-10T06:11:00.000Z'); // 07:11
    const actualEnd = new Date('2026-09-10T06:41:00.000Z'); // 07:41
    const w = resolveDefaultApprovedWindows({
      plannedStartDateTime: plannedStart,
      plannedEndDateTime: plannedEnd,
      actualStartDateTime: actualStart,
      actualEndDateTime: actualEnd,
      exceptions: [{ code: FinanceExceptionCode.UNDERRUN, message: 'short' }],
      durationToleranceMinutes: 15,
    });
    expect(w.approvedPayStart.getTime()).toBe(actualStart.getTime());
    expect(w.approvedPayEnd.getTime()).toBe(actualEnd.getTime());
    expect(w.approvedBillStart.getTime()).toBe(actualStart.getTime());
    expect(w.approvedBillEnd.getTime()).toBe(actualEnd.getTime());
    // Must not charge empty pre-arrival time (old rule: plannedStart → actualEnd)
    expect(w.approvedBillStart.getTime()).not.toBe(plannedStart.getTime());
  });

  it('UNDERRUN flag input does not block tolerance snap when shortfall ≤ tolerance', () => {
    const plannedStart = new Date('2026-07-13T10:00:00.000Z');
    const plannedEnd = new Date('2026-07-13T11:00:00.000Z');
    const actualEnd = new Date('2026-07-13T10:42:00.000Z'); // 18 min short, flag would fire (>15)
    const w = resolveDefaultApprovedWindows({
      plannedStartDateTime: plannedStart,
      plannedEndDateTime: plannedEnd,
      actualStartDateTime: plannedStart,
      actualEndDateTime: actualEnd,
      exceptions: [{ code: FinanceExceptionCode.UNDERRUN, message: 'short' }],
      durationToleranceMinutes: 20,
    });
    expect(w.approvedPayEnd.getTime()).toBe(plannedEnd.getTime());
    expect(w.approvedBillEnd.getTime()).toBe(plannedEnd.getTime());
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
