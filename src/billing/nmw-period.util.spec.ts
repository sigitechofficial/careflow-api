import {
  assessSalariedHours,
  annualBasicHours,
  basicHoursOfPeriod,
  payPeriodWindows,
  salariedCalculationYear,
  calendarMonthOf,
  isWithinOneMonth,
  assessPayReferencePeriod,
  nmwCategoryForPeriod,
  nmwTreatment,
  payReferencePeriodFor,
} from './nmw-period.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const RUN = { periodStart: d('2026-11-02'), periodEnd: d('2026-11-08') };
const MONTHS = [
  { periodStart: d('2026-10-01'), periodEnd: d('2026-10-31') },
  { periodStart: d('2026-11-01'), periodEnd: d('2026-11-30') },
];

describe('pay reference period (Q37–Q39)', () => {
  it('is the period of the payroll schedule the worker is paid by, not the dates of the pay run', () => {
    expect(payReferencePeriodFor('2026-11-03', MONTHS, RUN)).toEqual({ start: '2026-11-01', end: '2026-11-30', source: 'PAYROLL_SCHEDULE', issue: null });
    expect(payReferencePeriodFor('2026-10-31', MONTHS, RUN)).toEqual({ start: '2026-10-01', end: '2026-10-31', source: 'PAYROLL_SCHEDULE', issue: null });
  });

  it('falls back to the run dates, and says so, when no schedule period covers the day', () => {
    expect(payReferencePeriodFor('2026-11-03', [], RUN)).toEqual({ start: '2026-11-02', end: '2026-11-08', source: 'PAY_RUN_PERIOD', issue: 'NO_PAYROLL_SCHEDULE' });
    expect(payReferencePeriodFor('2026-12-03', MONTHS, RUN)).toMatchObject({ source: 'PAY_RUN_PERIOD', issue: 'NO_PAYROLL_SCHEDULE' });
  });

  it('never uses a period longer than a month (Sprint B3)', () => {
    expect(isWithinOneMonth('2026-11-01', '2026-11-30')).toBe(true);
    expect(isWithinOneMonth('2026-11-02', '2026-12-01')).toBe(true);
    expect(isWithinOneMonth('2026-11-01', '2026-12-01')).toBe(false);
    expect(isWithinOneMonth('2027-01-31', '2027-02-27')).toBe(true);
    expect(isWithinOneMonth('2027-01-31', '2027-02-28')).toBe(false);
    expect(isWithinOneMonth('2026-11-02', '2026-11-08')).toBe(true);
    expect(calendarMonthOf('2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' });

    // A run of six weeks with no schedule: each day is assessed in its calendar month.
    const longRun = { periodStart: d('2026-11-01'), periodEnd: d('2026-12-15') };
    expect(payReferencePeriodFor('2026-11-20', [], longRun)).toEqual({ start: '2026-11-01', end: '2026-11-30', source: 'CALENDAR_MONTH', issue: 'NO_PAYROLL_SCHEDULE' });
    expect(payReferencePeriodFor('2026-12-03', [], longRun)).toEqual({ start: '2026-12-01', end: '2026-12-31', source: 'CALENDAR_MONTH', issue: 'NO_PAYROLL_SCHEDULE' });
    // A schedule period of six weeks is not a pay reference period either.
    const sixWeeks = [{ periodStart: d('2026-11-01'), periodEnd: d('2026-12-12') }];
    expect(payReferencePeriodFor('2026-12-03', sixWeeks, RUN)).toEqual({ start: '2026-12-01', end: '2026-12-31', source: 'CALENDAR_MONTH', issue: 'PERIOD_OVER_ONE_MONTH' });
  });

  it('a weekly or four-weekly schedule period that crosses a month or the tax year is one period', () => {
    const weekly = [{ periodStart: d('2027-03-29'), periodEnd: d('2027-04-04') }, { periodStart: d('2027-04-05'), periodEnd: d('2027-04-11') }];
    expect(payReferencePeriodFor('2027-04-01', weekly, RUN)).toMatchObject({ start: '2027-03-29', end: '2027-04-04', issue: null });
    // 5 April is the last day of the tax year, 6 April the first of the next: the same pay period.
    expect(payReferencePeriodFor('2027-04-05', weekly, RUN).start).toBe('2027-04-05');
    expect(payReferencePeriodFor('2027-04-06', weekly, RUN).start).toBe('2027-04-05');
    const fourWeekly = [{ periodStart: d('2026-11-23'), periodEnd: d('2026-12-20') }];
    expect(payReferencePeriodFor('2026-12-01', fourWeekly, RUN)).toMatchObject({ start: '2026-11-23', end: '2026-12-20', source: 'PAYROLL_SCHEDULE', issue: null });
  });
});

describe('minimum wage band for a period', () => {
  const band = (over: Partial<Parameters<typeof nmwCategoryForPeriod>[0]> = {}) =>
    nmwCategoryForPeriod({ dateOfBirth: d('2000-06-15'), periodStart: d('2026-11-01'), apprenticeContract: false, apprenticeshipStartDate: null, ...over });

  it('uses the age at the start of the period: a birthday in the period changes the next period, not this one', () => {
    // 21st birthday on 15 November 2026.
    const dob = d('2005-11-15');
    expect(band({ dateOfBirth: dob, periodStart: d('2026-11-01') })).toMatchObject({ category: 'AGE_18_TO_20', ageAtPeriodStart: 20 });
    expect(band({ dateOfBirth: dob, periodStart: d('2026-12-01') })).toMatchObject({ category: 'AGE_21_AND_OVER', ageAtPeriodStart: 21 });
    expect(band({ dateOfBirth: d('2009-03-01') })).toMatchObject({ category: 'UNDER_18', ageAtPeriodStart: 17 });
  });

  it('with no date of birth uses the highest rate and says why', () => {
    expect(band({ dateOfBirth: null })).toMatchObject({ category: 'AGE_21_AND_OVER', ageAtPeriodStart: null });
    expect(band({ dateOfBirth: null }).note).toMatch(/Date of birth not recorded/);
  });

  it('an apprentice under 19 is on the apprentice rate', () => {
    expect(band({ apprenticeContract: true, dateOfBirth: d('2008-06-01') })).toMatchObject({ category: 'APPRENTICE', ageAtPeriodStart: 18 });
  });

  it('an apprentice of 19 or over is on the apprentice rate only in the first year of the apprenticeship', () => {
    const adult = { apprenticeContract: true, dateOfBirth: d('2000-06-15') };
    expect(band({ ...adult, apprenticeshipStartDate: d('2026-03-01') }).category).toBe('APPRENTICE');
    const second = band({ ...adult, apprenticeshipStartDate: d('2025-09-01') });
    expect(second.category).toBe('AGE_21_AND_OVER');
    expect(second.note).toMatch(/past the first year/);
    // The first year ends on the anniversary: a period starting that day is on the age rate.
    expect(band({ ...adult, apprenticeshipStartDate: d('2025-11-01') }).category).toBe('AGE_21_AND_OVER');
    expect(band({ ...adult, apprenticeshipStartDate: d('2025-11-02') }).category).toBe('APPRENTICE');
  });

  it('an apprentice contract with no start date recorded never gives a worker of 19 or over the lower rate', () => {
    const unknown = band({ apprenticeContract: true });
    expect(unknown.category).toBe('AGE_21_AND_OVER');
    expect(unknown.note).toMatch(/date the apprenticeship began is not recorded/);
  });
});

describe('what counts towards minimum wage', () => {
  it('work lines count as pay and as hours', () => {
    for (const type of ['VISIT_PAY', 'TRAVEL_TIME', 'WAITING_TIME', 'NON_VISIT_ACTIVITY']) {
      expect(nmwTreatment(type)).toEqual({ pay: true, hours: true });
    }
  });

  it('reimbursements, leave pay, pay for time not worked, the overtime premium and the top-up do not count', () => {
    for (const type of ['MILEAGE', 'PASSENGER_MILEAGE', 'EXPENSE', 'HOLIDAY_PAY', 'SICK_PAY', 'GUARANTEED_HOURS', 'CANCELLATION', 'OVERTIME', 'NMW_TOP_UP']) {
      expect(nmwTreatment(type)).toEqual({ pay: false, hours: false });
    }
  });

  it('a bonus or an adjustment counts as pay with no hours', () => {
    expect(nmwTreatment('BONUS')).toEqual({ pay: true, hours: false });
    expect(nmwTreatment('ADJUSTMENT')).toEqual({ pay: true, hours: false });
  });
});

describe('position of a pay reference period', () => {
  const base = { requiredHourly: 12.71, thisPay: 0, thisMinutes: 0, otherPay: 0, otherMinutes: 0, topUpAlreadyPaid: 0 };

  it('a shortfall in this run alone', () => {
    expect(assessPayReferencePeriod({ ...base, thisPay: 120, thisMinutes: 600 })).toMatchObject({ topUpDue: 7.1, topUpInRun: 7.1, compliant: false });
  });

  it('a low week is not topped up when the whole period meets the rate', () => {
    // This run: 10 hours at £12.00. Earlier in the period: 10 hours at £14.00.
    const result = assessPayReferencePeriod({ ...base, thisPay: 120, thisMinutes: 600, otherPay: 140, otherMinutes: 600 });
    expect(result).toMatchObject({ periodPay: 260, periodMinutes: 1200, topUpDue: 0, topUpInRun: 0, compliant: true });
  });

  it('a top-up already paid for the period is not paid again, and is reduced if later pay makes it unnecessary', () => {
    const more = assessPayReferencePeriod({ ...base, thisPay: 120, thisMinutes: 600, otherPay: 120, otherMinutes: 600, topUpAlreadyPaid: 7.1 });
    expect(more).toMatchObject({ topUpDue: 14.2, topUpInRun: 7.1 });
    const corrected = assessPayReferencePeriod({ ...base, thisPay: 10, thisMinutes: 0, otherPay: 120, otherMinutes: 600, topUpAlreadyPaid: 7.1 });
    expect(corrected).toMatchObject({ topUpDue: 0, topUpInRun: -7.1, compliant: true });
  });

  it('no working time means nothing to check', () => {
    expect(assessPayReferencePeriod({ ...base, thisPay: 50 })).toMatchObject({ topUpDue: 0, compliant: true });
  });
});

describe('minimum wage for salaried hours work (Sprint B3)', () => {
  const RATE = 12.71;

  it('basic hours of a period: contracted weekly hours over 52 weeks, divided by the pay periods of the year', () => {
    expect(basicHoursOfPeriod([{ contractedWeeklyHours: 35, days: 30 }], 30, 12, 52)).toBe(151.67); // GOV.UK example: 1,820 hours a year
    expect(basicHoursOfPeriod([{ contractedWeeklyHours: 37.5, days: 7 }], 7, 52, 52)).toBe(37.5);
    // A starter half way through the month has half the basic hours.
    expect(basicHoursOfPeriod([{ contractedWeeklyHours: 30, days: 15 }], 30, 12, 52)).toBe(65);
    // A change of agreement: each part carries its own hours.
    expect(basicHoursOfPeriod([{ contractedWeeklyHours: 30, days: 15 }, { contractedWeeklyHours: 20, days: 15 }], 30, 12, 52)).toBe(108.33);
    expect(basicHoursOfPeriod([{ contractedWeeklyHours: null, days: 30 }], 30, 12, 52)).toBeNull();
    expect(basicHoursOfPeriod([], 30, 12, 52)).toBeNull();
  });

  it('above the rate on the basic hours', () => {
    const result = assessSalariedHours({ requiredHourly: RATE, basicHours: 130, pay: 2000, additionalPaidMinutes: 0, workedMinutes: 6000 });
    expect(result).toMatchObject({ hours: 130, effectiveHourly: 15.3846, topUp: 0, compliant: true, issue: null });
  });

  it('below the rate on the basic hours: the shortfall is certain and is topped up', () => {
    const result = assessSalariedHours({ requiredHourly: RATE, basicHours: 130, pay: 1500, additionalPaidMinutes: 0, workedMinutes: 0 });
    expect(result).toMatchObject({ topUp: 152.3, compliant: false, issue: null, shortfall: 0 }); // 130 × 12.71 − 1,500
    expect(result.note).toMatch(/topped up by £152\.30/);
  });

  it('hours paid on top count with their pay', () => {
    // 130 basic hours for £1,700 and 10 further hours paid £140.
    const result = assessSalariedHours({ requiredHourly: RATE, basicHours: 130, pay: 1840, additionalPaidMinutes: 600, workedMinutes: 8400 });
    expect(result).toMatchObject({ hours: 140, effectiveHourly: 13.1429, topUp: 0, compliant: true });
  });

  it('more hours worked than paid for, and below the rate if they count: not declared compliant', () => {
    // £1,700 for 130 basic hours is £13.08, but 150 hours were worked: £11.33 if the extra 20 count.
    const result = assessSalariedHours({ requiredHourly: RATE, basicHours: 130, pay: 1700, additionalPaidMinutes: 0, workedMinutes: 9000 });
    expect(result).toMatchObject({ topUp: 0, compliant: null, issue: 'EXCESS_HOURS_NOT_VERIFIED', shortfall: 206.5 });
    expect(result.note).toMatch(/150\.00h were worked.*Up to £206\.50 more may be due/);
    // The same extra hours with pay high enough either way need no review.
    expect(assessSalariedHours({ requiredHourly: RATE, basicHours: 130, pay: 2000, additionalPaidMinutes: 0, workedMinutes: 9000 }).compliant).toBe(true);
  });

  it('with no contracted hours recorded nothing can be said', () => {
    expect(assessSalariedHours({ requiredHourly: RATE, basicHours: null, pay: 2000, additionalPaidMinutes: 0, workedMinutes: 0 })).toMatchObject({
      compliant: null,
      issue: 'BASIC_HOURS_NOT_RECORDED',
      topUp: 0,
    });
  });
});

/**
 * Sprint B4B. Figures are those of HMRC's examples in "Working hours for which the minimum wage
 * must be paid" (GOV.UK, last updated 6 January 2026, read 2026-10-13). Rates in the examples are
 * HMRC's illustrations. Multipliers below are test values, not an employer's policy.
 */
describe('salaried hours work over the calculation year (Sprint B4B, HMRC examples)', () => {
  const d = (day: string) => new Date(`${day}T00:00:00.000Z`);
  const year = (anchor: string, frequency: string, on: string) => {
    const y = salariedCalculationYear(d(anchor), frequency, d(on));
    return y && [y.start.toISOString().slice(0, 10), y.end.toISOString().slice(0, 10)];
  };

  it('calculation year: monthly from the 1st, monthly from mid-month, weekly from the start date', () => {
    // "Monthly-paid, starting 1 May: runs 1 May to 30 April the following year."
    expect(year('2026-05-01', 'MONTHLY', '2026-05-01')).toEqual(['2026-05-01', '2027-04-30']);
    expect(year('2026-05-01', 'MONTHLY', '2027-04-30')).toEqual(['2026-05-01', '2027-04-30']);
    expect(year('2026-05-01', 'MONTHLY', '2027-05-01')).toEqual(['2027-05-01', '2028-04-30']);
    // "Starting 15 May: runs 15 May to 31 May the following year, then 1 June to 31 May each year."
    expect(year('2026-05-15', 'MONTHLY', '2026-05-15')).toEqual(['2026-05-15', '2027-05-31']);
    expect(year('2026-05-15', 'MONTHLY', '2027-05-31')).toEqual(['2026-05-15', '2027-05-31']);
    expect(year('2026-05-15', 'MONTHLY', '2027-06-01')).toEqual(['2027-06-01', '2028-05-31']);
    expect(year('2026-05-15', 'MONTHLY', '2029-01-10')).toEqual(['2028-06-01', '2029-05-31']);
    // "Weekly or fortnightly-paid, starting 22 May: runs 22 May to 21 May the following year."
    expect(year('2026-05-22', 'WEEKLY', '2026-12-01')).toEqual(['2026-05-22', '2027-05-21']);
    expect(year('2026-05-22', 'FORTNIGHTLY', '2027-05-22')).toEqual(['2027-05-22', '2028-05-21']);
    expect(year('2026-05-22', 'MONTHLY', '2026-05-21')).toBeNull(); // before the contract started
  });

  it('basic hours of a pay period: the year divided by the number of payments (HMRC monthly and weekly examples)', () => {
    // £24,000 a year, 1,920 basic hours: 1,920 / 12 = 160 hours; £2,000 / 160 = £12.50.
    const monthly = basicHoursOfPeriod([{ contractedWeeklyHours: 40, days: 30 }], 30, 12, 48);
    expect(monthly).toBe(160);
    expect(assessSalariedHours({ requiredHourly: 12.21, basicHours: monthly, pay: 2000, additionalPaidMinutes: 0, workedMinutes: 0 }).effectiveHourly).toBe(12.5);
    // 40 hours x 35 weeks = 1,400 hours: 1,400 / 52 = 26.92 hours; £346.15 / 26.92 = £12.86.
    const weekly = basicHoursOfPeriod([{ contractedWeeklyHours: 40, days: 7 }], 7, 52, 35);
    expect(weekly).toBe(26.92);
    expect(Math.round((346.15 / (weekly as number)) * 100) / 100).toBe(12.86);
  });

  it('the multiplier decides the basic hours of the year: it is never 52 by default', () => {
    expect(annualBasicHours([{ days: 365, contractedWeeklyHours: 35 }], 52)).toBe(1820);
    expect(annualBasicHours([{ days: 365, contractedWeeklyHours: 35 }], 52.14)).toBe(1824.9);
    expect(annualBasicHours([{ days: 365, contractedWeeklyHours: 35 }], 52.18)).toBe(1826.3);
    expect(annualBasicHours([{ days: 365, contractedWeeklyHours: null }], 52)).toBeNull();
    expect(annualBasicHours([], 52)).toBeNull();
  });

  it('a contract whose hours change in the year: days / 365 of each (HMRC: 1,196 + 786 = 1,982; then 1,196 + 479 + 291)', () => {
    // 2,040 hours a year = 40 a week x 51 weeks; 1,900 = 38 x 50; 1,800 = 36 x 50.
    const hours = (days: number, annual: number) => Math.round((days / 365) * annual);
    expect([hours(214, 2040), hours(151, 1900)]).toEqual([1196, 786]);
    expect(Math.round(annualBasicHours([{ days: 214, contractedWeeklyHours: 40.8 }, { days: 151, contractedWeeklyHours: 38 }], 50) as number)).toBe(1982);
    expect([hours(214, 2040), hours(92, 1900), hours(59, 1800)]).toEqual([1196, 479, 291]);
    expect(
      Math.round(
        annualBasicHours(
          [{ days: 214, contractedWeeklyHours: 40.8 }, { days: 92, contractedWeeklyHours: 38 }, { days: 59, contractedWeeklyHours: 36 }],
          50,
        ) as number,
      ),
    ).toBe(1966);
  });

  // HMRC excess hours example: 2,040 hours a year, £20,400 (£1,700 a month, 170 hours), rate £10.
  const excessCase = { requiredHourly: 10, basicHours: 170, pay: 1700, additionalPaidMinutes: 0 };

  it('within the basic hours of the year, extra hours in one period change nothing', () => {
    const result = assessSalariedHours({
      ...excessCase,
      workedMinutes: 200 * 60,
      year: { thresholdHours: 2040, hoursBefore: 1500, hoursInPeriod: 200, excessCountedBefore: 0, exceedingPeriodBasicHours: 156.5 },
    });
    expect(result).toMatchObject({ hours: 170, topUp: 0, compliant: true, issue: null, excessHours: 0 });
    expect(result.note).toMatch(/1700\.00h worked in the calculation year \(200\.00h in this period\) against 2040h basic: within the basic hours/);
  });

  it('the period in which the basic hours are exceeded (HMRC: 55.9 + 100.6 + 70 = 226.5 hours, at least £2,265.00)', () => {
    // February, 28 days: 28 / 365 x 2,040 = 156.5 basic hours by days; 70 hours worked beyond the year's basic hours.
    const byDays = Math.round((28 / 365) * 2040 * 10) / 10;
    expect(byDays).toBe(156.5);
    const result = assessSalariedHours({
      ...excessCase,
      workedMinutes: 210 * 60,
      year: { thresholdHours: 2040, hoursBefore: 1900, hoursInPeriod: 210, excessCountedBefore: 0, exceedingPeriodBasicHours: byDays },
    });
    expect(result).toMatchObject({ hours: 226.5, excessHours: 70, topUp: 565, compliant: false, issue: null });
    expect(result.note).toMatch(/The pay must cover 226\.5h \(156\.5h basic by days \+ 70\.00h beyond the basic hours\) at £10\.00 = £2265\.00; £1700\.00 is paid: topped up by £565\.00/);
  });

  it('every later period: basic hours and all hours worked (HMRC: 170 + 170 = 340 hours, £3,400, a further £1,700)', () => {
    const result = assessSalariedHours({
      ...excessCase,
      workedMinutes: 170 * 60,
      year: { thresholdHours: 2040, hoursBefore: 2110, hoursInPeriod: 170, excessCountedBefore: 70, exceedingPeriodBasicHours: 173.3 },
    });
    expect(result).toMatchObject({ hours: 340, excessHours: 170, topUp: 1700, compliant: false });
  });

  it('a leaver: excess over the basic hours of the periods employed, in the last period (HMRC: 170 + 130 = 300 hours, £3,663)', () => {
    // Six months employed: 6 x 170 = 1,020 basic hours; 1,150 worked.
    const result = assessSalariedHours({
      requiredHourly: 12.21,
      basicHours: 170,
      pay: 1700,
      additionalPaidMinutes: 0,
      workedMinutes: 190 * 60,
      year: { thresholdHours: 1020, hoursBefore: 960, hoursInPeriod: 190, excessCountedBefore: 0, exceedingPeriodBasicHours: null },
    });
    expect(result).toMatchObject({ hours: 300, excessHours: 130, topUp: 1963, compliant: false }); // £3,663.00 due, £1,700.00 paid
  });

  it('excess hours are counted once: what an earlier assessment counted is not counted again, what it missed is', () => {
    const position = { thresholdHours: 2040, hoursBefore: 2110, hoursInPeriod: 0, exceedingPeriodBasicHours: 156.5 };
    // Calculated again with nothing new: the 70 hours were counted before.
    expect(assessSalariedHours({ ...excessCase, workedMinutes: 0, year: { ...position, excessCountedBefore: 70 } })).toMatchObject({ excessHours: 0, topUp: 0, hours: 170 });
    // 20 of them reached payroll late (a supplementary run) and no assessment counted them: counted now.
    expect(assessSalariedHours({ ...excessCase, workedMinutes: 0, year: { ...position, excessCountedBefore: 50 } })).toMatchObject({ excessHours: 20, hours: 190, topUp: 200 });
  });

  it('hours paid on top of the salary are not added twice to the excess hours', () => {
    // 30 hours paid on top (£330.00) are among the 70 excess hours.
    const result = assessSalariedHours({
      ...excessCase,
      pay: 2030,
      additionalPaidMinutes: 30 * 60,
      workedMinutes: 210 * 60,
      year: { thresholdHours: 2040, hoursBefore: 1900, hoursInPeriod: 210, excessCountedBefore: 0, exceedingPeriodBasicHours: 156.5 },
    });
    expect(result).toMatchObject({ hours: 226.5, topUp: 235 }); // £2,265.00 less £2,030.00
  });

  it('pay periods of a calculation year, for the basic hours of the periods a leaver was employed', () => {
    const keys = (frequency: string, from: string, to: string) =>
      payPeriodWindows(d(from), d(to), frequency).map((w) => `${w.start.toISOString().slice(5, 10)}..${w.end.toISOString().slice(5, 10)}`);
    expect(keys('MONTHLY', '2026-04-01', '2026-06-30')).toEqual(['04-01..04-30', '05-01..05-31', '06-01..06-30']);
    expect(keys('MONTHLY', '2026-04-01', '2026-06-10')).toEqual(['04-01..04-30', '05-01..05-31', '06-01..06-30']);
    expect(keys('WEEKLY', '2026-05-22', '2026-06-04')).toEqual(['05-22..05-28', '05-29..06-04']);
    expect(payPeriodWindows(d('2026-04-01'), d('2027-03-31'), 'MONTHLY')).toHaveLength(12);
    expect(payPeriodWindows(d('2026-05-22'), d('2027-05-21'), 'FOUR_WEEKLY')).toHaveLength(14); // 13 full periods and one day
  });
});
