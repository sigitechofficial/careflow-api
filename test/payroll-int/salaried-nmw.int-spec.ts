/**
 * Sprint B3, Task 2 — minimum wage for salaried hours work, in the UK payroll run.
 *
 * Before: a salaried worker was only recorded as "salaried" by the visit pay run; the function
 * that compares a salary with its basic hours was never called, so nothing checked the salary.
 *
 * Now the UK run that pays a period's salary assesses it: pay of the period against the basic
 * hours (contracted weekly hours × 52 ÷ pay periods in the year, as HMRC's guidance sets out) and
 * any hours paid on top. A certain shortfall is topped up once. What one period cannot decide —
 * no basic hours recorded, or more hours worked than paid for — is recorded, shown, and stops
 * the run being closed until a second person has reviewed it.
 *
 * Rates: £12.71 from 1 April 2026 (GOV.UK, read 2026-10-13). Salaries are synthetic.
 */
import request from 'supertest';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { buildUkPayrollRunsService, createApprovedVisit, createUkRun, markStatutoryCalculated, resetPayData, uuid } from './harness';
import { bearer, createStaffUser, createTestApp, resetIdentityData, TestApp } from './http-harness';

describe('minimum wage for salaried hours work (UK payroll run)', () => {
  let t: TestApp;
  let ukRuns: UkPayrollRunsService;
  let maker: { id: string };
  let checker: { id: string };
  const NOVEMBER = { periodStart: '2026-11-01', periodEnd: '2026-11-30' };

  const agree = (employeeId: string, annualSalary: number, over: Record<string, unknown> = {}) =>
    t.prisma.employeePayAgreement.create({
      data: {
        employeeId,
        basis: 'SALARIED',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01'),
        annualSalary,
        contractedHours: 30, // 30 × 52 ÷ 12 = 130 basic hours a month
        salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
        salaryCoverage: 'ALL_VISIT_WORK',
        approvedAt: new Date('2026-01-01T09:00:00Z'),
        ...over,
      } as never,
    });
  const ukRun = (employeeIds: string[], period = NOVEMBER) => createUkRun(t.prisma, { ...period, employeeIds, createdById: maker.id });
  const gross = (runId: string) => ukRuns.calculateGross(maker.id, runId);
  const close = async (runId: string) => {
    await markStatutoryCalculated(t.prisma, runId);
    return ukRuns.close(checker.id, runId);
  };
  const assessment = (runId: string, employeeId: string) =>
    t.prisma.nmwPeriodAssessment.findFirst({ where: { ukPayrollRunId: runId, employeeId } });
  const topUps = (runId: string, employeeId: string) =>
    t.prisma.ukPayrollInputLine.findMany({ where: { runId, employeeId, lineType: 'NMW_TOP_UP' } });
  const totals = async (runId: string, employeeId: string) => {
    const row = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId } });
    return { salaryPay: Number(row.salaryPay), visitPay: Number(row.visitPay), nmwTopUp: Number(row.nmwTopUp), totalGross: Number(row.totalGross) };
  };

  beforeAll(async () => {
    t = await createTestApp();
    ukRuns = buildUkPayrollRunsService(t.prisma).service;
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    maker = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.manage', 'payroll.scope.organisation'] });
    checker = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.close', 'payroll.scope.organisation'] });
  });
  afterAll(async () => {
    await t.close();
  });

  it('a salary above the minimum wage on its basic hours: assessed, recorded, nothing added', async () => {
    const employeeId = uuid();
    await agree(employeeId, 24_000);
    const run = await ukRun([employeeId]);
    await gross(run);
    const row = await assessment(run, employeeId);
    expect(row).toMatchObject({ workType: 'SALARIED_HOURS', periodSource: 'UK_PAYROLL_PERIOD', category: 'AGE_21_AND_OVER', compliant: true, issue: null, minutes: 7800 });
    expect(Number(row?.requiredHourly)).toBe(12.71);
    expect(Number(row?.eligiblePay)).toBe(2_000);
    expect(row?.note).toMatch(/£2000\.00 for 130h \(130h basic\) = £15\.3846\/hr against £12\.71/);
    expect(await topUps(run, employeeId)).toEqual([]);
    await close(run);
  });

  it('a salary below the minimum wage on its basic hours is topped up, once', async () => {
    const employeeId = uuid();
    await agree(employeeId, 18_000); // £1,500.00 for 130 hours = £11.54
    const run = await ukRun([employeeId]);
    await gross(run);
    const [line] = await topUps(run, employeeId);
    expect(Number(line.amount)).toBe(152.3); // 130 × £12.71 − £1,500.00
    const period = (await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: run } })).periodId;
    expect(line.claimKey).toBe(`NMW_SALARY:${employeeId}:${period}`);
    expect(line.description).toMatch(/Minimum wage top-up \(salaried hours work\).*topped up by £152\.30/);
    expect(await totals(run, employeeId)).toEqual({ salaryPay: 1_500, visitPay: 0, nmwTopUp: 152.3, totalGross: 1_652.3 });
    expect(await assessment(run, employeeId)).toMatchObject({ compliant: false, issue: null });
    expect(Number((await assessment(run, employeeId))?.topUpInRun)).toBe(152.3);

    // Calculating again does not add a second top-up; nor does a supplementary run of the period.
    await gross(run);
    expect(await topUps(run, employeeId)).toHaveLength(1);
    await close(run);
    const base = await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: run } });
    const supplementary = await t.prisma.ukPayrollRun.create({
      data: { periodId: base.periodId, taxYearId: base.taxYearId, scheduleId: base.scheduleId, runNumber: 2, label: 'Supplementary', status: 'EMPLOYEES_ENROLLED', employeeCount: 1, createdById: maker.id, employees: { create: [{ employeeId }] } },
    });
    // A visit the salary already pays for is all the supplementary run finds: nothing payable.
    await createApprovedVisit(t.prisma, { employeeId, start: '2026-11-20T09:00:00Z', amount: 14 });
    await expect(gross(supplementary.id)).rejects.toThrow(/No visit-pay or salary inputs/);
    expect(await topUps(supplementary.id, employeeId)).toEqual([]);
    expect(await assessment(supplementary.id, employeeId)).toBeNull(); // the period was assessed by the run that paid its salary
    expect(await t.prisma.ukPayrollInputLine.count({ where: { employeeId, claimKey: { startsWith: 'NMW_SALARY:' } } })).toBe(1);
  });

  it('a starter and a leaver are measured against the basic hours of the days they were employed', async () => {
    const starter = uuid();
    const leaver = uuid();
    await agree(starter, 18_000, { effectiveFrom: new Date('2026-11-16') }); // 15 of 30 days: £750.00, 65 hours
    await agree(leaver, 18_000, { status: 'TERMINATED', effectiveTo: new Date('2026-11-10') }); // 10 days: £500.00, 43.33 hours
    const run = await ukRun([starter, leaver]);
    await gross(run);
    expect((await assessment(run, starter))?.minutes).toBe(3900);
    expect((await topUps(run, starter)).map((l) => Number(l.amount))).toEqual([76.15]); // 65 × 12.71 − 750
    expect((await assessment(run, leaver))?.minutes).toBe(2600);
    expect((await topUps(run, leaver)).map((l) => Number(l.amount))).toEqual([50.72]); // 43.33 × 12.71 − 500
  });

  it('a change of salary and hours part way through: each part carries its own basic hours', async () => {
    const employeeId = uuid();
    await agree(employeeId, 18_000, { status: 'SUPERSEDED' }); // to 15 November: £750.00, 65 hours
    await agree(employeeId, 24_000, { effectiveFrom: new Date('2026-11-16'), contractedHours: 40, approvedAt: new Date('2026-11-10T09:00:00Z') }); // £1,000.00, 86.67 hours
    const run = await ukRun([employeeId]);
    await gross(run);
    const row = await assessment(run, employeeId);
    expect(Number(row?.eligiblePay)).toBe(1_750);
    expect(row?.minutes).toBe(9100); // 151.67 hours
    expect((await topUps(run, employeeId)).map((l) => Number(l.amount))).toEqual([177.73]); // 151.67 × 12.71 − 1,750
  });

  it('hours paid on top of the salary count with their pay', async () => {
    const employeeId = uuid();
    // £7,200.00 a year for 10 hours a week: £600.00 for 43.33 basic hours. Hours beyond 10 a week are paid.
    await agree(employeeId, 7_200, { contractedHours: 10, salaryCoverage: 'CONTRACTED_HOURS' });
    await createApprovedVisit(t.prisma, { employeeId, start: '2026-11-02T09:00:00Z', minutes: 600, amount: 140 }); // covered
    await createApprovedVisit(t.prisma, { employeeId, start: '2026-11-03T09:00:00Z', minutes: 240, amount: 56 }); // 4 hours on top
    const run = await ukRun([employeeId]);
    await gross(run);
    const row = await assessment(run, employeeId);
    expect(Number(row?.eligiblePay)).toBe(656); // £600.00 salary and £56.00 for the further hours
    expect(row?.minutes).toBe(2840); // 43.33 + 4 hours
    expect(row).toMatchObject({ compliant: true, issue: null, periodMinutes: 840 });
    expect(await topUps(run, employeeId)).toEqual([]);
  });

  describe('what one period cannot decide stops the run closing until a second person reviews it', () => {
    it('more hours worked than the salary pays for, and below the rate if they count: not declared compliant', async () => {
      const employeeId = uuid();
      await agree(employeeId, 20_400); // £1,700.00 for 130 basic hours = £13.08
      for (const day of ['02', '09', '16', '23', '27']) {
        await createApprovedVisit(t.prisma, { employeeId, start: `2026-11-${day}T08:00:00Z`, minutes: 1800, amount: 420 }); // 150 hours, covered by the salary
      }
      const run = await ukRun([employeeId]);
      await gross(run);
      const row = await assessment(run, employeeId);
      expect(row).toMatchObject({ compliant: null, issue: 'EXCESS_HOURS_NOT_VERIFIED', periodMinutes: 9000 });
      expect(Number(row?.shortfall)).toBe(206.5); // 150 × 12.71 − 1,700
      expect(await topUps(run, employeeId)).toEqual([]); // nothing is paid on a guess
      const detail = (await ukRuns.getById(run)) as { data: { nmwAssessments: Array<Record<string, unknown>> } };
      expect(detail.data.nmwAssessments).toEqual([expect.objectContaining({ issue: 'EXCESS_HOURS_NOT_VERIFIED', blocksClose: true, shortfall: 206.5, workedHours: 150 })]);

      await markStatutoryCalculated(t.prisma, run);
      await expect(ukRuns.close(checker.id, run)).rejects.toThrow(/1 minimum wage exception\(s\) on this run have not been reviewed/);

      // The review is the checker's act, over HTTP with the closing power.
      const path = `/payroll/runs/${run}/nmw-assessments/${row?.id}/review`;
      const post = (user: { id: string }, body: Record<string, unknown>) =>
        request(t.app.getHttpServer()).post(path).set(bearer(t.staffToken(user.id))).send(body);
      expect((await post(maker, { note: 'Checked against the year so far' })).status).toBe(403); // no closing power
      const makerWithPower = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.close', 'payroll.scope.organisation'] });
      await t.prisma.ukPayrollRun.update({ where: { id: run }, data: { createdById: makerWithPower.id } });
      expect((await post(makerWithPower, { note: 'Checked against the year so far' })).status).toBe(403); // created the run
      expect((await post(checker, { note: 'short' })).status).toBe(400);
      const reviewed = await post(checker, { note: 'Synthetic: annual basic hours of 1,560 not exceeded; 1,180 worked to date' });
      expect(reviewed.status).toBe(201);
      await ukRuns.close(checker.id, run);
      const kept = await t.prisma.nmwPeriodAssessment.findUniqueOrThrow({ where: { id: row!.id } });
      expect(kept).toMatchObject({ resolvedById: checker.id, issue: 'EXCESS_HOURS_NOT_VERIFIED', compliant: null });
    });

    it('no contracted hours on the agreement: the minimum wage cannot be checked, and the run says so', async () => {
      const employeeId = uuid();
      await agree(employeeId, 24_000, { contractedHours: null });
      const run = await ukRun([employeeId]);
      await gross(run);
      expect(await assessment(run, employeeId)).toMatchObject({ compliant: null, issue: 'BASIC_HOURS_NOT_RECORDED' });
      await markStatutoryCalculated(t.prisma, run);
      await expect(ukRuns.close(checker.id, run)).rejects.toThrow(/minimum wage exception/);
      // Recording the hours on an approved agreement and recalculating clears it.
      await t.prisma.employeePayAgreement.updateMany({ where: { employeeId }, data: { contractedHours: 30 } });
      await gross(run);
      expect(await assessment(run, employeeId)).toMatchObject({ compliant: true, issue: null });
      await close(run);
    });

    it('recalculating gross replaces the assessment, and with it an earlier review', async () => {
      const employeeId = uuid();
      await agree(employeeId, 24_000, { contractedHours: null });
      const run = await ukRun([employeeId]);
      await gross(run);
      const first = await assessment(run, employeeId);
      await ukRuns.reviewNmwAssessment(checker.id, run, first!.id, 'Synthetic review of the earlier figures');
      await gross(run);
      expect(await assessment(run, employeeId)).toMatchObject({ issue: 'BASIC_HOURS_NOT_RECORDED', resolvedAt: null });
      expect(await t.prisma.nmwPeriodAssessment.count({ where: { ukPayrollRunId: run } })).toBe(1);
    });

    it('a pay period longer than a month is not used as a pay reference period', async () => {
      const employeeId = uuid();
      await agree(employeeId, 24_000);
      const run = await ukRun([employeeId], { periodStart: '2026-11-01', periodEnd: '2026-12-15' });
      await gross(run);
      expect(await assessment(run, employeeId)).toMatchObject({ compliant: null, issue: 'PERIOD_OVER_ONE_MONTH' });
      await markStatutoryCalculated(t.prisma, run);
      await expect(ukRuns.close(checker.id, run)).rejects.toThrow(/minimum wage exception/);
    });
  });

  it('age and apprentice status decide the rate, as for hourly workers', async () => {
    const employee = await t.prisma.employee.create({ data: {} });
    await t.prisma.employeeEmployment.create({ data: { employeeId: employee.id } as never });
    await t.prisma.employeePersonalDetail.create({ data: { employeeId: employee.id, firstName: 'Synthetic', lastName: `Young ${uuid().slice(0, 6)}`, dateOfBirth: new Date('2007-03-01') } as never });
    await agree(employee.id, 15_000); // £1,250.00 for 130 hours = £9.62: below £10.85 for age 19
    const run = await ukRun([employee.id]);
    await gross(run);
    expect(await assessment(run, employee.id)).toMatchObject({ category: 'AGE_18_TO_20', ageAtPeriodStart: 19 });
    expect((await topUps(run, employee.id)).map((l) => Number(l.amount))).toEqual([160.5]); // 130 × 10.85 − 1,250
  });

  it('an hourly worker in the same run is untouched: no salaried assessment, pay as before', async () => {
    const hourly = uuid();
    const salaried = uuid();
    await agree(salaried, 24_000);
    await createApprovedVisit(t.prisma, { employeeId: hourly, start: '2026-11-03T09:00:00Z', amount: 28 });
    const run = await ukRun([hourly, salaried]);
    await gross(run);
    expect(await assessment(run, hourly)).toBeNull();
    expect(await totals(run, hourly)).toEqual({ salaryPay: 0, visitPay: 28, nmwTopUp: 0, totalGross: 28 });
    expect(await t.prisma.nmwPeriodAssessment.count({ where: { ukPayrollRunId: run } })).toBe(1);
  });
});
