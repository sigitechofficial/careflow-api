import {
  AgreementTerms,
  UNPAID_COVERAGE_NOT_DECIDED,
  UNPAID_COVERED_BY_SALARY,
  agreementSegments,
  annualSalaryFromEntry,
  applySalaryCoverage,
  governingAgreement,
  salaryCoverageByVisit,
  salaryForPeriod,
} from './salary.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
let seq = 0;
const agreement = (over: Partial<AgreementTerms> & { effectiveFrom: Date }): AgreementTerms => ({
  id: `a-${String(++seq).padStart(3, '0')}`,
  basis: 'SALARIED',
  status: 'ACTIVE',
  effectiveTo: null,
  annualSalary: 24_000,
  contractedHours: 37.5,
  salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
  salaryCoverage: 'ALL_VISIT_WORK',
  decidedAt: new Date(`2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`),
  ...over,
});
const total = (parts: Array<{ amount: number }>) => Math.round(parts.reduce((a, p) => a + p.amount, 0) * 100) / 100;
const november = { periodStart: d('2026-11-01'), periodEnd: d('2026-11-30'), frequency: 'MONTHLY' };

describe('salary entry (WM-02)', () => {
  it('turns a monthly or weekly salary into the yearly figure', () => {
    expect(annualSalaryFromEntry('ANNUAL', 24_000)).toBe(24_000);
    expect(annualSalaryFromEntry('MONTHLY', 2_000)).toBe(24_000);
    expect(annualSalaryFromEntry('WEEKLY', 480)).toBe(24_960);
  });
});

describe('which agreement is in force (WM-03)', () => {
  it('is the one with the latest start on or before the day', () => {
    const first = agreement({ effectiveFrom: d('2026-01-01'), status: 'SUPERSEDED' });
    const second = agreement({ effectiveFrom: d('2026-11-16') });
    expect(governingAgreement([first, second], d('2026-11-15'))?.id).toBe(first.id);
    expect(governingAgreement([first, second], d('2026-11-16'))?.id).toBe(second.id);
    expect(governingAgreement([first, second], d('2025-12-31'))).toBeNull();
  });

  it('of two starting on the same day, is the one decided last; a draft never counts', () => {
    const wrong = agreement({ effectiveFrom: d('2026-11-01'), status: 'SUPERSEDED' });
    const corrected = agreement({ effectiveFrom: d('2026-11-01') });
    const draft = agreement({ effectiveFrom: d('2026-11-10'), status: 'DRAFT' });
    expect(governingAgreement([corrected, wrong, draft], d('2026-11-20'))?.id).toBe(corrected.id);
  });

  it('an ended agreement does not bring an older one back', () => {
    const old = agreement({ effectiveFrom: d('2026-01-01'), status: 'SUPERSEDED' });
    const ended = agreement({ effectiveFrom: d('2026-06-01'), effectiveTo: d('2026-11-14'), status: 'TERMINATED' });
    expect(governingAgreement([old, ended], d('2026-11-14'))?.id).toBe(ended.id);
    expect(governingAgreement([old, ended], d('2026-11-15'))).toBeNull();
  });

  it('splits a period at each change and leaves out days not employed', () => {
    const first = agreement({ effectiveFrom: d('2026-01-01'), status: 'SUPERSEDED' });
    const second = agreement({ effectiveFrom: d('2026-11-16') });
    const segments = agreementSegments([first, second], november.periodStart, november.periodEnd, {
      startDate: d('2026-11-03'),
    });
    expect(segments.map((s) => [s.agreement.id, s.days])).toEqual([
      [first.id, 13],
      [second.id, 15],
    ]);
  });
});

describe('salary of a pay period (WM-09)', () => {
  it('a whole month under one agreement is one twelfth of the year, whatever the month length', () => {
    const a = agreement({ effectiveFrom: d('2026-01-01') });
    expect(total(salaryForPeriod({ agreements: [a], ...november }))).toBe(2_000);
    expect(
      total(salaryForPeriod({ agreements: [a], periodStart: d('2027-02-01'), periodEnd: d('2027-02-28'), frequency: 'MONTHLY' })),
    ).toBe(2_000);
  });

  it('a weekly schedule pays one fifty-second, a four-weekly one a thirteenth', () => {
    const a = agreement({ effectiveFrom: d('2026-01-01'), annualSalary: 26_000 });
    expect(total(salaryForPeriod({ agreements: [a], periodStart: d('2026-11-02'), periodEnd: d('2026-11-08'), frequency: 'WEEKLY' }))).toBe(500);
    expect(total(salaryForPeriod({ agreements: [a], periodStart: d('2026-11-02'), periodEnd: d('2026-11-29'), frequency: 'FOUR_WEEKLY' }))).toBe(2_000);
  });

  it('an agreement with no method keeps the earlier calculation: calendar days of a 365.25 day year', () => {
    const a = agreement({ effectiveFrom: d('2026-01-01'), salaryProrationMethod: null });
    expect(total(salaryForPeriod({ agreements: [a], ...november }))).toBe(Math.round(((24_000 * 30) / 365.25) * 100) / 100);
  });

  it('a starter is paid from the start date: by calendar days, or by working days, as the agreement says', () => {
    const byCalendar = agreement({ effectiveFrom: d('2026-11-16') });
    expect(total(salaryForPeriod({ agreements: [byCalendar], ...november }))).toBe(1_000); // 15 of 30 days
    const byWorking = agreement({ effectiveFrom: d('2026-11-16'), salaryProrationMethod: 'EQUAL_PERIODS_WORKING_DAYS' });
    // 16–30 November 2026 has 11 Monday–Friday days of the month's 21.
    expect(total(salaryForPeriod({ agreements: [byWorking], ...november }))).toBe(1_047.62);
  });

  it('a leaver is paid to the leaving date, from the employment record or the agreement end', () => {
    const a = agreement({ effectiveFrom: d('2026-01-01') });
    expect(total(salaryForPeriod({ agreements: [a], ...november, employment: { endDate: d('2026-11-10') } }))).toBe(666.67);
    const ended = agreement({ effectiveFrom: d('2026-01-01'), effectiveTo: d('2026-11-10'), status: 'TERMINATED' });
    expect(total(salaryForPeriod({ agreements: [ended], ...november }))).toBe(666.67);
  });

  it('an increase or a decrease part way through pays each part at its own salary', () => {
    const before = agreement({ effectiveFrom: d('2026-01-01'), status: 'SUPERSEDED' });
    const rise = agreement({ effectiveFrom: d('2026-11-16'), annualSalary: 30_000 });
    const parts = salaryForPeriod({ agreements: [before, rise], ...november });
    expect(parts.map((p) => p.amount)).toEqual([1_000, 1_250]);
    const cut = agreement({ effectiveFrom: d('2026-11-16'), annualSalary: 18_000 });
    expect(salaryForPeriod({ agreements: [before, cut], ...november }).map((p) => p.amount)).toEqual([1_000, 750]);
  });

  it('a change to hourly pay part way through ends the salary on the day before', () => {
    const salaried = agreement({ effectiveFrom: d('2026-01-01'), status: 'SUPERSEDED' });
    const hourly = agreement({ effectiveFrom: d('2026-11-16'), basis: 'HOURLY_CARE', annualSalary: null });
    expect(total(salaryForPeriod({ agreements: [salaried, hourly], ...november }))).toBe(1_000);
  });
});

describe('what a salary already pays for', () => {
  const visit = (id: string, start: string, minutes: number) => ({ id, start: new Date(start), minutes });

  it('contracted hours cover the first hours of each week, in the order worked, whatever run they are in', () => {
    const a = agreement({ effectiveFrom: d('2026-01-01'), salaryCoverage: 'CONTRACTED_HOURS', contractedHours: 10 });
    // Week of Monday 30 November 2026 is split between a November and a December pay period.
    const all = [
      visit('mon', '2026-11-30T09:00:00Z', 360),
      visit('tue', '2026-12-01T09:00:00Z', 360),
      visit('wed', '2026-12-02T09:00:00Z', 120),
      visit('next', '2026-12-07T09:00:00Z', 60),
    ];
    const cover = salaryCoverageByVisit(all, [a]);
    expect(cover.get('mon')?.coveredMinutes).toBe(360);
    expect(cover.get('tue')?.coveredMinutes).toBe(240); // 10 hours reached
    expect(cover.get('wed')?.coveredMinutes).toBe(0);
    expect(cover.get('next')?.coveredMinutes).toBe(60); // a new week
    // The same answer when the visits are handed over in another order.
    expect(salaryCoverageByVisit([...all].reverse(), [a]).get('tue')?.coveredMinutes).toBe(240);
  });

  it('a visit worked while paid hourly is not covered by a salary that starts later', () => {
    const hourly = agreement({ effectiveFrom: d('2026-01-01'), basis: 'HOURLY_CARE', annualSalary: null, status: 'SUPERSEDED' });
    const salaried = agreement({ effectiveFrom: d('2026-11-16') });
    const cover = salaryCoverageByVisit(
      [visit('before', '2026-11-10T09:00:00Z', 60), visit('after', '2026-11-17T09:00:00Z', 60)],
      [hourly, salaried],
    );
    expect(cover.get('before')?.coveredMinutes).toBe(0);
    expect(cover.get('after')?.coveredMinutes).toBe(60);
  });

  it('all visit work: visit wages, travel time and the amounts worked out from them are not paid again', () => {
    const a = agreement({ effectiveFrom: d('2026-01-01') });
    for (const lineType of ['VISIT_PAY', 'TRAVEL_TIME', 'WAITING_TIME', 'NON_VISIT_ACTIVITY', 'NMW_TOP_UP', 'OVERTIME', 'HOLIDAY_PAY']) {
      expect(applySalaryCoverage({ lineType, amount: 28, agreement: a, visit: null })).toEqual({
        paid: 0,
        unpaid: 28,
        reason: UNPAID_COVERED_BY_SALARY,
      });
    }
  });

  it('allowances, bonuses, corrections, sick pay and expenses are always paid as well as the salary', () => {
    const a = agreement({ effectiveFrom: d('2026-01-01') });
    for (const lineType of ['ON_CALL_STANDBY', 'BONUS', 'ADJUSTMENT', 'SICK_PAY', 'MILEAGE', 'EXPENSE', 'MILEAGE_TAXABLE']) {
      expect(applySalaryCoverage({ lineType, amount: 12.5, agreement: a, visit: null }).paid).toBe(12.5);
    }
  });

  it('contracted hours: the part of a visit beyond them is paid as additional hours', () => {
    const a = agreement({ effectiveFrom: d('2026-01-01'), salaryCoverage: 'CONTRACTED_HOURS', contractedHours: 10 });
    expect(
      applySalaryCoverage({ lineType: 'VISIT_PAY', amount: 84, agreement: a, visit: { coveredMinutes: 240, minutes: 360, notDecided: false } }),
    ).toEqual({ paid: 28, unpaid: 56, reason: UNPAID_COVERED_BY_SALARY });
    expect(
      applySalaryCoverage({ lineType: 'VISIT_PAY', amount: 28, agreement: a, visit: { coveredMinutes: 0, minutes: 120, notDecided: false } }).paid,
    ).toBe(28);
  });

  it('salary for other duties: visit work is paid in full', () => {
    const a = agreement({ effectiveFrom: d('2026-01-01'), basis: 'HYBRID', salaryCoverage: 'NO_VISIT_WORK' });
    expect(applySalaryCoverage({ lineType: 'VISIT_PAY', amount: 28, agreement: a, visit: null })).toEqual({ paid: 28, unpaid: 0, reason: null });
  });

  it('a salary with no coverage recorded holds the visit wages instead of paying them on top', () => {
    const a = agreement({ effectiveFrom: d('2026-01-01'), salaryCoverage: null });
    expect(applySalaryCoverage({ lineType: 'VISIT_PAY', amount: 28, agreement: a, visit: null })).toEqual({
      paid: 0,
      unpaid: 28,
      reason: UNPAID_COVERAGE_NOT_DECIDED,
    });
  });

  it('an hourly employee is untouched', () => {
    const hourly = agreement({ effectiveFrom: d('2026-01-01'), basis: 'HOURLY_CARE', annualSalary: null });
    expect(applySalaryCoverage({ lineType: 'VISIT_PAY', amount: 28, agreement: hourly, visit: null }).paid).toBe(28);
    expect(applySalaryCoverage({ lineType: 'VISIT_PAY', amount: 28, agreement: null, visit: null }).paid).toBe(28);
  });
});
