/**
 * Sprint B3, Task 3 — valid pay reference periods, and UK civil-date boundaries.
 *
 * Before: with no payroll schedule the dates of the pay run were used as the pay reference period
 * whatever their length, and only a top-up line said so; and UK payroll decided "which pay period"
 * and "which week" from the UTC date, so a visit at 00:30 on 1 July (23:30 UTC on 30 June) fell in
 * June.
 *
 * Now a period longer than a month is never used; a missing or invalid schedule is recorded on the
 * assessment and shown with the run; and UK payroll asks which date it is in the United Kingdom.
 * Attendance instants are not changed.
 */
import request from 'supertest';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { buildUkPayrollRunsService, createApprovedVisit, createUkRun, resetPayData, uuid } from './harness';
import { bearer, createCarer, createStaffUser, createTestApp, resetIdentityData, seedDefaultCards, TestApp } from './http-harness';

describe('pay reference periods and UK date boundaries', () => {
  let t: TestApp;
  let ukRuns: UkPayrollRunsService;
  let preparer: { id: string };
  let employeeId: string;

  const server = () => t.app.getHttpServer();
  const post = (path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(bearer(t.staffToken(preparer.id))).send(body);
  const calculated = async (periodStart: string, periodEnd: string) => {
    const created = await post('/billing/payroll-runs', { periodStart, periodEnd });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await post(`/billing/payroll-runs/${id}/calculate`)).status).toBe(201);
    return id;
  };
  const work = (start: string, hourly: number, hours = 10) =>
    createApprovedVisit(t.prisma, { employeeId, start, minutes: hours * 60, amount: hours * hourly });
  const assessments = (payrollRunId: string) =>
    t.prisma.nmwPeriodAssessment.findMany({ where: { payrollRunId, employeeId }, orderBy: { periodStart: 'asc' } });
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const topUps = async (payrollRunId: string) =>
    (await t.prisma.payrollRunLine.findMany({ where: { payrollRunId, employeeId, lineType: 'NMW_TOP_UP', sourceType: 'NMW_PERIOD' } })).map((l) => Number(l.amount));
  const paidBy = async (frequency: 'WEEKLY' | 'MONTHLY', periods: Array<[string, string]>, taxYear = 'TEST-2026-27') => {
    const tag = uuid().slice(0, 8);
    const year =
      (await t.prisma.payrollTaxYear.findFirst({ where: { code: taxYear } })) ??
      (await t.prisma.payrollTaxYear.create({ data: { code: taxYear, label: taxYear, startDate: new Date('2026-04-06'), endDate: new Date('2027-04-05') } }));
    const schedule = await t.prisma.payrollSchedule.create({ data: { name: `Test ${tag}`, code: `TEST-${tag}`, frequency } });
    for (const [index, [start, end]] of periods.entries()) {
      await t.prisma.payrollPeriod.create({
        data: { scheduleId: schedule.id, taxYearId: year.id, sequence: index + 1, label: `${start} – ${end}`, periodStart: new Date(start), periodEnd: new Date(end), paymentDate: new Date(end) },
      });
    }
    await t.prisma.employeePayrollProfile.create({ data: { employeeId, scheduleId: schedule.id } as never });
  };

  beforeAll(async () => {
    t = await createTestApp();
    ukRuns = buildUkPayrollRunsService(t.prisma).service;
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await t.prisma.employeePayrollProfile.deleteMany({ where: { schedule: { code: { startsWith: 'TEST-' } } } });
    await t.prisma.payrollSchedule.deleteMany({ where: { code: { startsWith: 'TEST-' } } });
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma, 14);
    preparer = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.manage', 'payroll.scope.organisation'] });
    employeeId = (await createCarer(t.prisma)).employeeId;
  });
  afterAll(async () => {
    await t.prisma.employeePayrollProfile.deleteMany({ where: { schedule: { code: { startsWith: 'TEST-' } } } });
    await t.close();
  });

  describe('which period minimum wage is checked over', () => {
    it('a weekly-paid worker: each week of the schedule, with nothing to report', async () => {
      await paidBy('WEEKLY', [['2026-11-02', '2026-11-08'], ['2026-11-09', '2026-11-15']]);
      await work('2026-11-03T08:00:00Z', 12);
      await work('2026-11-10T08:00:00Z', 14);
      const run = await calculated('2026-11-02', '2026-11-15');
      expect((await assessments(run)).map((a) => [iso(a.periodStart), iso(a.periodEnd), a.periodSource, a.issue, a.compliant])).toEqual([
        ['2026-11-02', '2026-11-08', 'PAYROLL_SCHEDULE', null, false],
        ['2026-11-09', '2026-11-15', 'PAYROLL_SCHEDULE', null, true],
      ]);
      expect(await topUps(run)).toEqual([7.1]);
    });

    it('a monthly-paid worker: the month of the schedule', async () => {
      await paidBy('MONTHLY', [['2026-11-01', '2026-11-30']]);
      await work('2026-11-03T08:00:00Z', 12);
      const run = await calculated('2026-11-02', '2026-11-08');
      expect((await assessments(run)).map((a) => [iso(a.periodStart), iso(a.periodEnd), a.periodSource, a.issue])).toEqual([
        ['2026-11-01', '2026-11-30', 'PAYROLL_SCHEDULE', null],
      ]);
    });

    it('no payroll schedule: still checked over a month or less, and reported as an exception on the run', async () => {
      await work('2026-11-03T08:00:00Z', 12);
      const run = await calculated('2026-11-02', '2026-11-08');
      const [row] = await assessments(run);
      expect(row).toMatchObject({ periodSource: 'PAY_RUN_PERIOD', issue: 'NO_PAYROLL_SCHEDULE', compliant: false });
      expect(row.note).toMatch(/No UK payroll schedule period covers this work/);
      expect(await topUps(run)).toEqual([7.1]); // the worker is still protected
      const detail = (await request(server()).get(`/billing/payroll-runs/${run}`).set(bearer(t.staffToken(preparer.id)))).body.data;
      expect(detail.nmwExceptions).toEqual([
        expect.objectContaining({ employeeId, issue: 'NO_PAYROLL_SCHEDULE', periodStart: '2026-11-02', periodEnd: '2026-11-08', periodSource: 'PAY_RUN_PERIOD' }),
      ]);
      expect(detail.nmwExceptions[0].message).toMatch(/give the worker a payroll schedule/);
    });

    it('a run longer than a month is never one period: each calendar month is checked on its own', async () => {
      await work('2026-11-20T08:00:00Z', 12); // November: below the rate
      await work('2026-12-03T08:00:00Z', 16); // December: well above. Together they would average £14.00.
      const run = await calculated('2026-11-01', '2026-12-15');
      expect((await assessments(run)).map((a) => [iso(a.periodStart), iso(a.periodEnd), a.periodSource, a.issue, a.compliant])).toEqual([
        ['2026-11-01', '2026-11-30', 'CALENDAR_MONTH', 'NO_PAYROLL_SCHEDULE', false],
        ['2026-12-01', '2026-12-31', 'CALENDAR_MONTH', 'NO_PAYROLL_SCHEDULE', true],
      ]);
      expect(await topUps(run)).toEqual([7.1]);
    });

    it('a schedule period longer than a month is not accepted either', async () => {
      await paidBy('MONTHLY', [['2026-11-01', '2026-12-12']]);
      await work('2026-11-20T08:00:00Z', 12);
      await work('2026-12-03T08:00:00Z', 16);
      const run = await calculated('2026-11-16', '2026-12-06');
      expect((await assessments(run)).map((a) => [iso(a.periodStart), a.periodSource, a.issue, a.compliant])).toEqual([
        ['2026-11-01', 'CALENDAR_MONTH', 'PERIOD_OVER_ONE_MONTH', false],
        ['2026-12-01', 'CALENDAR_MONTH', 'PERIOD_OVER_ONE_MONTH', true],
      ]);
    });

    it('a weekly period that crosses a month end and the tax year end is one period', async () => {
      // Monday 5 April 2027 is the last day of the tax year; Tuesday 6 April the first of the next.
      await paidBy('WEEKLY', [['2027-03-29', '2027-04-04'], ['2027-04-05', '2027-04-11']]);
      await work('2027-03-31T08:00:00Z', 12); // March
      await work('2027-04-01T08:00:00Z', 16); // April, same pay week: averages £14.00
      await work('2027-04-05T08:00:00Z', 12); // tax year 2026-27
      await work('2027-04-06T08:00:00Z', 16); // tax year 2027-28, same pay week
      const run = await calculated('2027-03-29', '2027-04-11');
      expect((await assessments(run)).map((a) => [iso(a.periodStart), iso(a.periodEnd), a.minutes, a.compliant, a.issue])).toEqual([
        ['2027-03-29', '2027-04-04', 1200, true, null],
        ['2027-04-05', '2027-04-11', 1200, true, null],
      ]);
      expect(await topUps(run)).toEqual([]);
    });
  });

  describe('a visit just after midnight in British Summer Time', () => {
    // 00:30 on Wednesday 1 July 2026 in the United Kingdom is 23:30 UTC on Tuesday 30 June.
    const AFTER_MIDNIGHT = '2026-06-30T23:30:00.000Z';

    it('minimum wage: it belongs to the pay week of its UK date', async () => {
      await paidBy('WEEKLY', [['2026-06-24', '2026-06-30'], ['2026-07-01', '2026-07-07']]);
      const visit = await work(AFTER_MIDNIGHT, 12, 2);
      const run = await calculated('2026-06-24', '2026-07-07');
      expect((await assessments(run)).map((a) => [iso(a.periodStart), a.minutes])).toEqual([['2026-07-01', 120]]);
      // The attendance instant itself is untouched.
      expect((await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id: visit.id } })).approvedPayStart?.toISOString()).toBe(AFTER_MIDNIGHT);
    });

    it('UK payroll: an approved visit is collected by the pay period of its UK date, not its UTC date', async () => {
      await work(AFTER_MIDNIGHT, 14, 2);
      const june = await createUkRun(t.prisma, { periodStart: '2026-06-01', periodEnd: '2026-06-30', employeeIds: [employeeId], createdById: preparer.id });
      await expect(ukRuns.calculateGross(preparer.id, june)).rejects.toThrow(/No visit-pay or salary inputs/);
      const july = await createUkRun(t.prisma, { periodStart: '2026-07-01', periodEnd: '2026-07-31', employeeIds: [employeeId], createdById: preparer.id });
      await ukRuns.calculateGross(preparer.id, july);
      expect(await t.prisma.ukPayrollInputLine.count({ where: { runId: july, employeeId, lineType: 'VISIT_PAY' } })).toBe(1);
    });

    it('UK payroll: the last visit of the period, late on its last UK day, is still inside it', async () => {
      // 23:30 on 30 June in the United Kingdom is 22:30 UTC.
      await work('2026-06-30T22:30:00.000Z', 14, 1);
      const june = await createUkRun(t.prisma, { periodStart: '2026-06-01', periodEnd: '2026-06-30', employeeIds: [employeeId], createdById: preparer.id });
      await ukRuns.calculateGross(preparer.id, june);
      expect(await t.prisma.ukPayrollInputLine.count({ where: { runId: june, employeeId, lineType: 'VISIT_PAY' } })).toBe(1);
    });

    it('salary cover by contracted hours: the visit counts in the week of its UK date', async () => {
      await t.prisma.employeePayAgreement.create({
        data: { employeeId, basis: 'SALARIED', status: 'ACTIVE', effectiveFrom: new Date('2026-01-01'), annualSalary: 24_000, contractedHours: 10, salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS', salaryCoverage: 'CONTRACTED_HOURS', approvedAt: new Date('2026-01-01') } as never,
      });
      // Week of Monday 22 June: ten hours, all of the contracted hours.
      await work('2026-06-23T08:00:00Z', 14, 10);
      // 00:30 on Monday 29 June in the United Kingdom (23:30 UTC on Sunday 28 June): a new week.
      const monday = await work('2026-06-28T23:30:00.000Z', 14, 2);
      const run = await createUkRun(t.prisma, { periodStart: '2026-06-01', periodEnd: '2026-06-30', employeeIds: [employeeId], createdById: preparer.id });
      await ukRuns.calculateGross(preparer.id, run);
      const line = await t.prisma.ukPayrollInputLine.findFirstOrThrow({ where: { runId: run, sourceVisitReconciliationId: monday.id } });
      // By the UTC date it would have been the eleventh and twelfth hour of the earlier week, paid on top.
      expect(Number(line.amount)).toBe(0);
      expect(line.unpaidReason).toBe('COVERED_BY_SALARY');
      expect(Number(line.unpaidAmount)).toBe(28);
    });
  });
});
