import {
  LeaveTerms,
  accruedIrregularLeaveHours,
  carryOverAllowed,
  employedShareOfYear,
  entitlementHours,
  leaveBalance,
  leaveYearFor,
  normalRemuneration,
  rolledUpAllowedFor,
} from './leave.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const terms = (over: Partial<LeaveTerms> = {}): LeaveTerms => ({
  workerCategory: 'REGULAR_HOURS',
  leaveYearStartMonth: 4,
  leaveYearStartDay: 1,
  weeklyHours: 37.5,
  contractualExtraHours: null,
  payMethod: 'NORMAL_REMUNERATION_52_WEEKS',
  carryOverMaxHours: null,
  ...over,
});
const YEAR = { start: d('2026-04-01'), end: d('2027-03-31') };

describe('leave year', () => {
  it('is the year, from its start day, that a date falls in', () => {
    expect(leaveYearFor(d('2026-11-03'), 4, 1)).toEqual(YEAR);
    expect(leaveYearFor(d('2026-03-31'), 4, 1)).toEqual({ start: d('2025-04-01'), end: d('2026-03-31') });
    expect(leaveYearFor(d('2026-04-01'), 4, 1)).toEqual(YEAR);
    expect(leaveYearFor(d('2026-11-03'), 1, 1)).toEqual({ start: d('2026-01-01'), end: d('2026-12-31') });
  });

  it('a starter or a leaver is employed for part of it', () => {
    expect(employedShareOfYear(YEAR, {})).toBe(1);
    expect(employedShareOfYear(YEAR, { startDate: d('2026-10-01') })).toBeCloseTo(182 / 365, 6);
    expect(employedShareOfYear(YEAR, { endDate: d('2026-06-30') })).toBeCloseTo(91 / 365, 6);
    expect(employedShareOfYear(YEAR, { startDate: d('2027-05-01') })).toBe(0);
  });
});

describe('entitlement by worker category (Q35)', () => {
  it('regular hours: 5.6 weeks of the normal week, pro rata for a part year', () => {
    const full = entitlementHours({ terms: terms(), leaveYear: YEAR, employment: {}, hoursByPayPeriod: [] });
    expect(full.statutoryHours).toBe(210); // 37.5 × 5.6
    const starter = entitlementHours({ terms: terms(), leaveYear: YEAR, employment: { startDate: d('2026-10-01') }, hoursByPayPeriod: [] });
    expect(starter.statutoryHours).toBe(104.71); // 182 of 365 days
    const partTime = entitlementHours({ terms: terms({ weeklyHours: 20 }), leaveYear: YEAR, employment: {}, hoursByPayPeriod: [] });
    expect(partTime.statutoryHours).toBe(112);
  });

  it('regular hours: what has been earned by a day in the year', () => {
    const soFar = entitlementHours({ terms: terms(), leaveYear: YEAR, employment: {}, hoursByPayPeriod: [], upTo: d('2026-09-30') });
    expect(soFar.statutoryHours).toBe(105.29); // 183 of 365 days
  });

  it('irregular hours and part year: 12.07% of the hours worked in each pay period, each rounded to the hour', () => {
    expect(accruedIrregularLeaveHours([100])).toBe(12); // 12.07
    expect(accruedIrregularLeaveHours([120])).toBe(14); // 14.48
    expect(accruedIrregularLeaveHours([125])).toBe(15); // 15.09
    expect(accruedIrregularLeaveHours([29])).toBe(4); // 3.50 rounds up
    expect(accruedIrregularLeaveHours([100, 120, 0])).toBe(26);
    for (const workerCategory of ['IRREGULAR_HOURS', 'PART_YEAR']) {
      const result = entitlementHours({ terms: terms({ workerCategory, weeklyHours: null }), leaveYear: YEAR, employment: {}, hoursByPayPeriod: [100, 120] });
      expect(result.statutoryHours).toBe(26);
    }
  });

  it('keeps contractual leave apart from statutory leave', () => {
    const result = entitlementHours({ terms: terms({ contractualExtraHours: 37.5 }), leaveYear: YEAR, employment: { startDate: d('2026-10-01') }, hoursByPayPeriod: [] });
    expect(result).toMatchObject({ statutoryHours: 104.71, contractualHours: 18.7 });
  });

  it('rolled-up holiday pay is only for irregular-hours and part-year workers', () => {
    expect(rolledUpAllowedFor('IRREGULAR_HOURS')).toBe(true);
    expect(rolledUpAllowedFor('PART_YEAR')).toBe(true);
    expect(rolledUpAllowedFor('REGULAR_HOURS')).toBe(false);
  });
});

describe('balance, carry-over and leavers', () => {
  const movements = [
    { entryType: 'TAKEN', entitlementType: 'STATUTORY', hours: 37.5 },
    { entryType: 'TAKEN', entitlementType: 'STATUTORY', hours: 7.5 },
    { entryType: 'CARRY_OVER', entitlementType: 'STATUTORY', hours: 15 },
    { entryType: 'ADJUSTMENT', entitlementType: 'STATUTORY', hours: -2 },
    { entryType: 'TAKEN', entitlementType: 'CONTRACTUAL', hours: 7.5 },
  ];

  it('each kind of leave has its own balance', () => {
    expect(leaveBalance(210, movements, 'STATUTORY')).toEqual({ entitlement: 210, taken: 45, adjustments: -2, carriedOver: 15, paidOnLeaving: 0, balance: 178 });
    expect(leaveBalance(37.5, movements, 'CONTRACTUAL')).toMatchObject({ taken: 7.5, balance: 30 });
  });

  it('a leaver who has taken more than was earned has a negative balance; a payment on leaving clears a positive one', () => {
    expect(leaveBalance(52.5, [{ entryType: 'TAKEN', entitlementType: 'STATUTORY', hours: 60 }], 'STATUTORY').balance).toBe(-7.5);
    expect(
      leaveBalance(52.5, [{ entryType: 'TAKEN', entitlementType: 'STATUTORY', hours: 30 }, { entryType: 'LEAVER_PAYMENT', entitlementType: 'STATUTORY', hours: 22.5 }], 'STATUTORY').balance,
    ).toBe(0);
  });

  it('carry-over is what the terms allow, never more than what is left, and nothing when the terms allow none', () => {
    expect(carryOverAllowed(40, 15)).toBe(15);
    expect(carryOverAllowed(10, 15)).toBe(10);
    expect(carryOverAllowed(40, null)).toBe(0);
    expect(carryOverAllowed(-5, 15)).toBe(0);
  });
});

describe('normal remuneration (52-week reference period)', () => {
  const weekKey = (n: number) => {
    const day = new Date('2026-11-02T00:00:00.000Z');
    day.setUTCDate(day.getUTCDate() - n * 7);
    return day.toISOString().slice(0, 10);
  };
  const LEAVE_WEEK = weekKey(0);

  it('averages the last 52 paid weeks before the leave', () => {
    const weeks = Array.from({ length: 60 }, (_, i) => ({ weekKey: weekKey(i + 1), pay: i < 52 ? 400 : 100, hours: 30 }));
    expect(normalRemuneration(weeks, LEAVE_WEEK)).toEqual({ weeksUsed: 52, averageWeeklyPay: 400, averageHourlyPay: 13.3333, complete: true });
  });

  it('leaves out weeks with no pay and goes further back for them', () => {
    const weeks = [
      ...Array.from({ length: 50 }, (_, i) => ({ weekKey: weekKey(i + 1), pay: 400, hours: 30 })),
      { weekKey: weekKey(51), pay: 0, hours: 0 },
      { weekKey: weekKey(52), pay: 0, hours: 0 },
      { weekKey: weekKey(53), pay: 500, hours: 30 },
      { weekKey: weekKey(54), pay: 500, hours: 30 },
    ];
    const result = normalRemuneration(weeks, LEAVE_WEEK);
    expect(result.weeksUsed).toBe(52);
    expect(result.averageWeeklyPay).toBe(403.85);
  });

  it('does not look back further than 104 weeks, and uses the weeks there are', () => {
    const weeks = [
      { weekKey: weekKey(1), pay: 300, hours: 20 },
      { weekKey: weekKey(2), pay: 500, hours: 30 },
      { weekKey: weekKey(105), pay: 9000, hours: 30 },
    ];
    expect(normalRemuneration(weeks, LEAVE_WEEK)).toEqual({ weeksUsed: 2, averageWeeklyPay: 400, averageHourlyPay: 16, complete: false });
    expect(normalRemuneration([], LEAVE_WEEK)).toMatchObject({ weeksUsed: 0, averageWeeklyPay: null, averageHourlyPay: null });
  });

  it('the week of the leave itself is not part of the average', () => {
    expect(normalRemuneration([{ weekKey: LEAVE_WEEK, pay: 999, hours: 10 }], LEAVE_WEEK).weeksUsed).toBe(0);
  });
});
