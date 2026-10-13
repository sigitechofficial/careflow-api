/**
 * Sprint B4B, Task 2 — salaried hours work over the calculation year.
 *
 * Before: the basic hours of a pay period were always contracted weekly hours x 52 / pay periods,
 * with 52 written into the code, and a period with more hours worked than its basic hours was
 * only reported for a person to check "against the year so far".
 *
 * Now: the multiplier comes from the employer's approved annualisation method, and without one
 * the salary is not assessed (POLICY_REVIEW_REQUIRED). With one, the run works out the
 * calculation year, its basic hours, the hours worked in it so far, and whether they have been
 * exceeded; from the period in which they are, the excess hours must be paid and a shortfall is
 * topped up, once.
 *
 * EVERYTHING HERE IS SYNTHETIC: 35 contracted hours a week, a salary of £24,000.00, and the
 * harness's test method "weekly hours x 52" (1,820 hours a year, 151.67 a month), which no
 * employer has approved. Rate: £12.71 from 1 April 2026 (GOV.UK, read 2026-10-13). The statutory
 * method is HMRC's "Working hours for which the minimum wage must be paid" (last updated
 * 6 January 2026); its own figures are reproduced in src/billing/nmw-period.util.spec.ts.
 */
import request from 'supertest';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { buildUkPayrollRunsService, createApprovedVisit, createUkRun, markStatutoryCalculated, resetPayData, uuid } from './harness';
import { bearer, createStaffUser, createTestApp, resetIdentityData, TestApp } from './http-harness';

describe('salaried hours work over the calculation year (UK payroll run)', () => {
  let t: TestApp;
  let ukRuns: UkPayrollRunsService;
  let maker: { id: string };
  let checker: { id: string };

  const agree = (employeeId: string, over: Record<string, unknown> = {}) =>
    t.prisma.employeePayAgreement.create({
      data: {
        employeeId,
        basis: 'SALARIED',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-04-01'), // the salaried contract starts: calculation year 1 April to 31 March
        annualSalary: 24_000,
        contractedHours: 35,
        salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
        salaryCoverage: 'ALL_VISIT_WORK',
        approvedAt: new Date('2026-03-20T09:00:00Z'),
        ...over,
      } as never,
    });
  const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  /** Approved visits of 30 hours each in a month. */
  const work = async (employeeId: string, month: string, hours: number, firstDay = 2) => {
    for (let i = 0; i < hours / 30; i += 1) {
      const day = String(firstDay + i * 3).padStart(2, '0');
      await createApprovedVisit(t.prisma, { employeeId, start: `${month}-${day}T08:00:00Z`, minutes: 1800, amount: 420 });
    }
  };
  const ukRun = (employeeIds: string[], month: string) =>
    createUkRun(t.prisma, { periodStart: `${month}-01`, periodEnd: lastDay(month), employeeIds, createdById: maker.id });
  const gross = (runId: string) => ukRuns.calculateGross(maker.id, runId);
  const close = async (runId: string) => {
    await markStatutoryCalculated(t.prisma, runId);
    return ukRuns.close(checker.id, runId);
  };
  /** A month worked, paid and closed. */
  const payMonth = async (employeeId: string, month: string, hours: number) => {
    await work(employeeId, month, hours);
    const run = await ukRun([employeeId], month);
    await gross(run);
    await close(run);
    return run;
  };
  const assessment = (runId: string, employeeId: string) =>
    t.prisma.nmwPeriodAssessment.findFirst({ where: { ukPayrollRunId: runId, employeeId } });
  const topUps = (runId: string, employeeId: string) =>
    t.prisma.ukPayrollInputLine.findMany({ where: { runId, employeeId, lineType: 'NMW_TOP_UP' } });
  const SEVEN_MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  /** April to October at 240 hours a month: 1,680 of the year's 1,820 basic hours. */
  const workedToOctober = async (employeeId: string) => {
    for (const month of SEVEN_MONTHS) await payMonth(employeeId, month, 240);
  };

  beforeAll(async () => {
    t = await createTestApp();
    ukRuns = buildUkPayrollRunsService(t.prisma).service;
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma); // also puts the SYNTHETIC "weekly hours x 52" method in force
    await resetIdentityData(t.prisma);
    maker = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.manage', 'payroll.settings.read', 'payroll.settings.manage', 'payroll.scope.organisation'] });
    checker = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.close', 'payroll.pay_agreements.approve', 'payroll.scope.organisation'] });
  });
  afterAll(async () => {
    await t.close();
  });

  it('35 contracted hours a week: the year, its basic hours and the method used are recorded with the assessment', async () => {
    const employeeId = uuid();
    await agree(employeeId);
    const run = await ukRun([employeeId], '2026-04');
    await gross(run);
    const row = await assessment(run, employeeId);
    expect(row).toMatchObject({
      workType: 'SALARIED_HOURS',
      compliant: true,
      issue: null,
      minutes: 9100, // 1,820 / 12 = 151.67 hours
      annualBasicMinutes: 109_200, // 35 x 52 = 1,820 hours
      yearMinutesBefore: 0,
      excessMinutes: 0,
    });
    expect(Number(row?.weeksPerYear)).toBe(52);
    expect([row?.calcYearStart?.toISOString().slice(0, 10), row?.calcYearEnd?.toISOString().slice(0, 10)]).toEqual(['2026-04-01', '2027-03-31']);
    expect(row?.note).toMatch(/Calculation year 2026-04-01 to 2027-03-31; basic hours from contracted weekly hours x 52 weeks \(SYNTHETIC TEST METHOD, not an employer policy\)/);
    // The contract still says 35 hours a week: nothing annual was written to it.
    expect(Number((await t.prisma.employeePayAgreement.findFirstOrThrow({ where: { employeeId } })).contractedHours)).toBe(35);
    const shown = ((await ukRuns.getById(run)) as { data: { nmwAssessments: Array<Record<string, unknown>> } }).data.nmwAssessments[0];
    expect(shown).toMatchObject({ contractedWeeklyHours: 35, calcYearStart: '2026-04-01', calcYearEnd: '2027-03-31', weeksPerYear: 52, annualBasicHours: 1820, yearHoursBefore: 0, excessHours: 0 });
  });

  it('within the basic hours of the year, months with more hours than their share are compliant and need no review', async () => {
    const employeeId = uuid();
    await agree(employeeId);
    const before: Array<number | null | undefined> = [];
    for (const month of ['2026-04', '2026-05', '2026-06']) {
      const run = await payMonth(employeeId, month, 240); // 240 worked against 151.67 basic: closes without a review
      const row = await assessment(run, employeeId);
      expect(row).toMatchObject({ compliant: true, issue: null, periodMinutes: 14_400, excessMinutes: 0 });
      expect(await topUps(run, employeeId)).toEqual([]);
      before.push(row?.yearMinutesBefore);
    }
    expect(before).toEqual([0, 14_400, 28_800]);
  });

  it('the basic hours of the year are exceeded: the excess hours are paid from that period on, by a top-up, once', async () => {
    const employeeId = uuid();
    await agree(employeeId);
    await workedToOctober(employeeId);

    // November: 1,680 + 240 = 1,920 hours, 100 beyond the 1,820. The period's basic hours by days
    // are 30 / 365 x 1,820 = 149.6, so the pay must cover 249.6 hours: £3,172.42. £2,000.00 is paid.
    await work(employeeId, '2026-11', 240);
    const november = await ukRun([employeeId], '2026-11');
    await gross(november);
    expect(await assessment(november, employeeId)).toMatchObject({ compliant: false, issue: null, yearMinutesBefore: 100_800, excessMinutes: 6_000, minutes: 14_976 });
    const [line] = await topUps(november, employeeId);
    expect(Number(line.amount)).toBe(1_172.42);
    expect(line.description).toMatch(/1920\.00h worked in the calculation year \(240\.00h in this period\) against 1820h basic: the basic hours are exceeded\. The pay must cover 249\.6h \(149\.6h basic by days \+ 100\.00h beyond the basic hours\) at £12\.71 = £3172\.42; £2000\.00 is paid: topped up by £1172\.42/);
    // Calculating again changes nothing: one top-up, the same excess.
    await gross(november);
    expect((await topUps(november, employeeId)).map((l) => Number(l.amount))).toEqual([1_172.42]);
    expect((await assessment(november, employeeId))?.excessMinutes).toBe(6_000);
    await close(november);

    // December: every hour worked is now beyond the basic hours. 151.67 + 60 = 211.67 hours: £2,690.33.
    await work(employeeId, '2026-12', 60);
    const december = await ukRun([employeeId], '2026-12');
    await gross(december);
    expect(await assessment(december, employeeId)).toMatchObject({ compliant: false, issue: null, yearMinutesBefore: 115_200, excessMinutes: 3_600, minutes: 12_700 });
    expect((await topUps(december, employeeId)).map((l) => Number(l.amount))).toEqual([690.33]);
    await close(december);

    // A new calculation year starts on 1 April 2027: the count starts again.
    await work(employeeId, '2027-04', 240);
    const april = await ukRun([employeeId], '2027-04');
    await gross(april);
    const next = await assessment(april, employeeId);
    expect(next).toMatchObject({ yearMinutesBefore: 0, excessMinutes: 0 });
    expect(next?.calcYearStart?.toISOString().slice(0, 10)).toBe('2027-04-01');
  });

  it('a supplementary run adds its hours once, makes no second assessment or top-up, and the closed month is not changed', async () => {
    const employeeId = uuid();
    const hourly = uuid();
    await agree(employeeId);
    await workedToOctober(employeeId);
    const november = await payMonth(employeeId, '2026-11', 240); // 100 excess hours counted, £1,172.42 topped up
    const snapshot = async () => ({
      run: await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: november }, select: { status: true, totalGross: true, closedAt: true } }),
      lines: await t.prisma.ukPayrollInputLine.findMany({ where: { runId: november }, orderBy: { id: 'asc' }, select: { id: true, lineType: true, amount: true, minutes: true, claimKey: true } }),
      assessment: await assessment(november, employeeId),
    });
    const closed = await snapshot();

    // A November visit of 30 hours is approved late, and comes into a supplementary run with an
    // hourly colleague's visit. The salary already pays for it; its hours still count.
    await createApprovedVisit(t.prisma, { employeeId, start: '2026-11-27T08:00:00Z', minutes: 1800, amount: 420 });
    await createApprovedVisit(t.prisma, { employeeId: hourly, start: '2026-11-27T09:00:00Z', minutes: 120, amount: 28 });
    const base = await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: november } });
    const supplementary = await t.prisma.ukPayrollRun.create({
      data: {
        periodId: base.periodId,
        taxYearId: base.taxYearId,
        scheduleId: base.scheduleId,
        runNumber: 2,
        label: 'Supplementary',
        status: 'EMPLOYEES_ENROLLED',
        employeeCount: 2,
        createdById: maker.id,
        employees: { create: [{ employeeId }, { employeeId: hourly }] },
      },
    });
    await gross(supplementary.id);
    await gross(supplementary.id); // and again
    expect(await assessment(supplementary.id, employeeId)).toBeNull(); // the period was assessed by the run that paid its salary
    expect(await topUps(supplementary.id, employeeId)).toEqual([]);
    expect(await t.prisma.ukPayrollInputLine.count({ where: { employeeId, claimKey: { startsWith: 'NMW_SALARY:' } } })).toBe(1);
    await close(supplementary.id);
    expect(await snapshot()).toEqual(closed); // closed payroll is not rewritten

    // December sees 1,680 + 240 + 30 = 1,950 hours before it, each once. With 60 worked the year
    // stands at 2,010: 190 beyond the basic hours, of which November counted 100. The other 90 (the
    // 30 that came late and December's 60) are counted now: 151.67 + 90 = 241.67 hours, £3,071.63.
    await work(employeeId, '2026-12', 60);
    const december = await ukRun([employeeId], '2026-12');
    await gross(december);
    expect(await assessment(december, employeeId)).toMatchObject({ yearMinutesBefore: 117_000, excessMinutes: 5_400, compliant: false, issue: null });
    expect((await topUps(december, employeeId)).map((l) => Number(l.amount))).toEqual([1_071.63]);
    await gross(december);
    expect(await assessment(december, employeeId)).toMatchObject({ yearMinutesBefore: 117_000, excessMinutes: 5_400 });
    expect((await topUps(december, employeeId)).map((l) => Number(l.amount))).toEqual([1_071.63]);
    expect(await snapshot()).toEqual(closed);
    // A closed run is not calculated again.
    await expect(gross(november)).rejects.toThrow();
  });

  it('a cancelled run gives its hours back: they are not in the year until a run claims them again', async () => {
    const employeeId = uuid();
    await agree(employeeId);
    await work(employeeId, '2026-04', 240);
    const april = await ukRun([employeeId], '2026-04');
    await gross(april);
    await ukRuns.cancel(maker.id, april, 'Synthetic: wrong employees enrolled');
    await work(employeeId, '2026-05', 60);
    const may = await ukRun([employeeId], '2026-05');
    await gross(may);
    expect(await assessment(may, employeeId)).toMatchObject({ yearMinutesBefore: 0, periodMinutes: 3_600 });
  });

  it('contracted weekly hours change during the year: each stretch counts by its days (HMRC method)', async () => {
    const employeeId = uuid();
    await agree(employeeId, { status: 'SUPERSEDED' }); // 35 hours a week to 30 September: 183 days
    await agree(employeeId, { effectiveFrom: new Date('2026-10-01'), contractedHours: 30, approvedAt: new Date('2026-09-20T09:00:00Z') }); // 182 days
    const run = await ukRun([employeeId], '2026-10');
    await gross(run);
    const row = await assessment(run, employeeId);
    // 183 / 365 x 1,820 + 182 / 365 x 1,560 = 912.49 + 777.86 = 1,690.36 hours.
    expect(row).toMatchObject({ annualBasicMinutes: 101_422, minutes: 7_800, compliant: true, issue: null }); // October: 1,560 / 12 = 130 hours
    expect(row?.calcYearStart?.toISOString().slice(0, 10)).toBe('2026-04-01');
    // The agreements keep their weekly hours.
    const hours = (await t.prisma.employeePayAgreement.findMany({ where: { employeeId }, orderBy: { effectiveFrom: 'asc' } })).map((a) => Number(a.contractedHours));
    expect(hours).toEqual([35, 30]);
  });

  it('a leaver: the hours worked are compared with the basic hours of the periods employed, in the last period', async () => {
    const employeeId = uuid();
    await agree(employeeId, { status: 'TERMINATED', effectiveTo: new Date('2026-09-30') }); // six months: 6 x 151.67 = 910.02 basic hours
    for (const month of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) await payMonth(employeeId, month, 180); // 900 hours
    await work(employeeId, '2026-09', 60);
    const september = await ukRun([employeeId], '2026-09');
    await gross(september);
    // 960 worked against 910.02: 49.98 excess. Last period: 151.67 + 49.98 = 201.65 hours, £2,562.97.
    const row = await assessment(september, employeeId);
    expect(row).toMatchObject({ annualBasicMinutes: 54_601, yearMinutesBefore: 54_000, excessMinutes: 2_999, minutes: 12_099, compliant: false, issue: null });
    expect(row?.note).toMatch(/leaves in the year, so the basic hours are those of the pay periods employed/);
    expect((await topUps(september, employeeId)).map((l) => Number(l.amount))).toEqual([562.97]);
  });

  describe('the annualisation method is the employer’s to approve: nothing is assumed', () => {
    const server = () => t.app.getHttpServer();
    const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
      request(server()).post(path).set(bearer(t.staffToken(user.id))).send(body);
    const METHOD = { weeksPerYear: 52.14, basis: 'Synthetic: staff handbook section 4.2, weekly hours x 52.14', effectiveFrom: '2026-04-01' };

    it('with no approved method the salary is not assessed: no compliance is claimed, no top-up is made, and the run cannot be closed', async () => {
      await t.prisma.salariedHoursAnnualisation.deleteMany();
      const low = uuid();
      await agree(low, { annualSalary: 18_000 }); // £1,500.00 a month: below the rate on 35 hours x 52, if 52 were the method
      const run = await ukRun([low], '2026-04');
      await gross(run);
      expect(await assessment(run, low)).toMatchObject({ compliant: null, issue: 'POLICY_REVIEW_REQUIRED', minutes: 0, annualBasicMinutes: null, excessMinutes: null, calcYearStart: null });
      expect(await topUps(run, low)).toEqual([]);
      await markStatutoryCalculated(t.prisma, run);
      await expect(ukRuns.close(checker.id, run)).rejects.toThrow(/1 minimum wage exception\(s\) on this run stop it being closed/);
    });

    it('the method in force at the start of the pay period is the one used (Sprint B4C)', async () => {
      await t.prisma.salariedHoursAnnualisation.deleteMany();
      const method = (weeksPerYear: number, effectiveFrom: string, over: Record<string, unknown> = {}) =>
        t.prisma.salariedHoursAnnualisation.create({
          data: {
            weeksPerYear,
            basis: `SYNTHETIC TEST FIXTURE: weekly hours x ${weeksPerYear}. Not an employer policy.`,
            effectiveFrom: new Date(effectiveFrom),
            status: 'APPROVED',
            isSynthetic: true,
            approvedAt: new Date('2026-03-01T09:00:00Z'),
            ...over,
          },
        });
      await method(52, '2026-04-01');
      await method(52.18, '2026-06-01');
      await method(50, '2026-05-01', { status: 'DRAFT', approvedAt: null }); // entered, never approved
      await method(51, '2026-05-01', { status: 'WITHDRAWN', withdrawnAt: new Date('2026-04-20T09:00:00Z') });
      const employeeId = uuid();
      await agree(employeeId);
      const used = async (month: string) => {
        const run = await ukRun([employeeId], month);
        await gross(run);
        const row = await assessment(run, employeeId);
        return [Number(row?.weeksPerYear), row?.annualBasicMinutes, row?.issue];
      };
      expect(await used('2026-04')).toEqual([52, 109_200, null]);
      expect(await used('2026-05')).toEqual([52, 109_200, null]); // neither the draft nor the withdrawn one
      expect(await used('2026-06')).toEqual([52.18, 109_578, null]); // 35 x 52.18 = 1,826.3 hours
      // A period that starts before any method applies is not assessed.
      await t.prisma.salariedHoursAnnualisation.updateMany({ where: { status: 'APPROVED' }, data: { effectiveFrom: new Date('2026-08-01') } });
      expect(await used('2026-07')).toEqual([0, null, 'POLICY_REVIEW_REQUIRED']);
    });

    it('a method is entered by one user and counts only once a different user approves it', async () => {
      await t.prisma.salariedHoursAnnualisation.deleteMany();
      const employeeId = uuid();
      await agree(employeeId);
      const run = await ukRun([employeeId], '2026-04');

      expect((await post(checker, '/payroll/salaried-hours-methods', METHOD)).status).toBe(403); // cannot enter one
      expect((await post(maker, '/payroll/salaried-hours-methods', { ...METHOD, basis: 'too short' })).status).toBe(400);
      expect((await post(maker, '/payroll/salaried-hours-methods', { ...METHOD, weeksPerYear: 60 })).status).toBe(400);
      expect((await post(maker, '/payroll/salaried-hours-methods', { ...METHOD, isSynthetic: true })).status).toBe(400); // not something a user can set
      const entered = await post(maker, '/payroll/salaried-hours-methods', METHOD);
      expect(entered.status).toBe(201);
      const id = entered.body.data.id as string;
      expect(entered.body.data).toMatchObject({ status: 'DRAFT', isSynthetic: false, weeksPerYear: 52.14 });

      // Entered, not approved: still nothing is assumed.
      await gross(run);
      expect(await assessment(run, employeeId)).toMatchObject({ issue: 'POLICY_REVIEW_REQUIRED', compliant: null });

      expect((await post(maker, `/payroll/salaried-hours-methods/${id}/approve`)).status).toBe(403); // no power to approve
      const both = await createStaffUser(t.prisma, { permissions: ['payroll.settings.manage', 'payroll.pay_agreements.approve', 'payroll.scope.organisation'] });
      await t.prisma.salariedHoursAnnualisation.update({ where: { id }, data: { createdById: both.id } });
      const own = await post(both, `/payroll/salaried-hours-methods/${id}/approve`);
      expect(own.status).toBe(403);
      expect(own.body.message).toMatch(/approved by a different user from the one who entered it/);
      expect((await post(checker, `/payroll/salaried-hours-methods/${id}/approve`)).status).toBe(201);
      const listed = await request(server()).get('/payroll/salaried-hours-methods').set(bearer(t.staffToken(maker.id)));
      expect(listed.body.data.inForce).toMatchObject({ id, status: 'APPROVED', weeksPerYear: 52.14, approvedById: checker.id });
      expect(listed.body.data.inForce.createdByName).toMatch(/^Test User/);
      expect(listed.body.data.inForce.approvedByName).toMatch(/^Test User/);

      // Approved: the salary is assessed with it. 35 x 52.14 = 1,824.9 hours a year, 152.08 a month.
      await gross(run);
      const row = await assessment(run, employeeId);
      expect(row).toMatchObject({ issue: null, compliant: true, annualBasicMinutes: 109_494, minutes: 9_125 });
      expect(Number(row?.weeksPerYear)).toBe(52.14);
      expect(row?.note).toMatch(/x 52\.14 weeks \(approved method\)/);

      // Withdrawn: back to not assessed, on the next calculation of an open run.
      expect((await post(checker, `/payroll/salaried-hours-methods/${id}/withdraw`, { note: 'Synthetic: under review' })).status).toBe(201);
      await gross(run);
      expect(await assessment(run, employeeId)).toMatchObject({ issue: 'POLICY_REVIEW_REQUIRED', compliant: null, annualBasicMinutes: null });
      const audit = (await t.prisma.auditLog.findMany({ where: { recordId: id }, orderBy: { createdAt: 'asc' }, select: { action: true } })).map((a) => a.action);
      expect(audit).toEqual(['salaried_hours_method_entered', 'salaried_hours_method_approved', 'salaried_hours_method_withdrawn']);
    });
  });
});
