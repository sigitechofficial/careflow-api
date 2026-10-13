import {
  assessPayReferencePeriod,
  nmwCategoryForPeriod,
  nmwTreatment,
  payReferencePeriodFor,
  salariedHoursCheck,
} from './nmw-period.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const RUN = { periodStart: d('2026-11-02'), periodEnd: d('2026-11-08') };
const MONTHS = [
  { periodStart: d('2026-10-01'), periodEnd: d('2026-10-31') },
  { periodStart: d('2026-11-01'), periodEnd: d('2026-11-30') },
];

describe('pay reference period (Q37–Q39)', () => {
  it('is the period of the payroll schedule the worker is paid by, not the dates of the pay run', () => {
    expect(payReferencePeriodFor('2026-11-03', MONTHS, RUN)).toEqual({ start: '2026-11-01', end: '2026-11-30', source: 'PAYROLL_SCHEDULE' });
    expect(payReferencePeriodFor('2026-10-31', MONTHS, RUN)).toEqual({ start: '2026-10-01', end: '2026-10-31', source: 'PAYROLL_SCHEDULE' });
  });

  it('falls back to the run dates, and says so, when no schedule period covers the day', () => {
    expect(payReferencePeriodFor('2026-11-03', [], RUN)).toEqual({ start: '2026-11-02', end: '2026-11-08', source: 'PAY_RUN_PERIOD' });
    expect(payReferencePeriodFor('2026-12-03', MONTHS, RUN).source).toBe('PAY_RUN_PERIOD');
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

describe('salaried hours work', () => {
  it('compares the salary of a period with the basic hours it pays for', () => {
    expect(salariedHoursCheck({ periodSalary: 2000, contractedWeeklyHours: 37.5, periodsPerYear: 12, requiredHourly: 12.71 })).toEqual({
      basicHours: 162.5,
      effectiveHourly: 12.3077,
      compliant: false,
    });
    expect(salariedHoursCheck({ periodSalary: 2200, contractedWeeklyHours: 37.5, periodsPerYear: 12, requiredHourly: 12.71 }).compliant).toBe(true);
  });

  it('cannot be worked out without contracted hours', () => {
    expect(salariedHoursCheck({ periodSalary: 2000, contractedWeeklyHours: null, periodsPerYear: 12, requiredHourly: 12.71 }).compliant).toBeNull();
  });
});
