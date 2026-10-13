/**
 * Gate B2, Stage 2 — salary in UK payroll gross (WM-02 / WM-03 / WM-09).
 *
 * The agreements here are SYNTHETIC POLICY: salaries, proration methods and "what the salary pays
 * for" are test values, not Allfor Care's terms (policy decision Q22 is open).
 *
 * The rule under test: an employee receiving a salary is not paid ordinary visit wages again for
 * work that salary already pays for; everything else due is still paid, once.
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import {
  buildPayrollRunsService,
  buildUkPayrollRunsService,
  createApprovedVisit,
  createRun,
  createTestPrisma,
  createUkRun,
  markStatutoryCalculated,
  resetPayData,
  uuid,
} from './harness';

describe('salary in UK payroll gross (synthetic agreements)', () => {
  let prisma: PrismaService;
  let visitRuns: PayrollRunsService;
  let ukRuns: UkPayrollRunsService;
  const maker = uuid();
  const checker = uuid();
  const NOVEMBER = { periodStart: '2026-11-01', periodEnd: '2026-11-30' };
  const DECEMBER = { periodStart: '2026-12-01', periodEnd: '2026-12-31' };
  const approvedOn = (iso: string) => ({ approvedById: checker, approvedAt: new Date(iso), termsChangedAt: new Date(iso) });

  /** An approved salary agreement. £24,000 a year, equal monthly amounts, covering all visit work. */
  const agree = (employeeId: string, over: Record<string, unknown> = {}) =>
    prisma.employeePayAgreement.create({
      data: {
        employeeId,
        basis: 'SALARIED',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01'),
        annualSalary: 24_000,
        salaryEntryPeriod: 'ANNUAL',
        salaryEntryAmount: 24_000,
        salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
        salaryCoverage: 'ALL_VISIT_WORK',
        createdById: maker,
        ...approvedOn('2026-01-01T09:00:00Z'),
        ...over,
      } as never,
    });
  const ukRun = (employeeIds: string[], period = NOVEMBER) =>
    createUkRun(prisma, { ...period, employeeIds, createdById: maker });
  /** A further run in the same pay period as `runId` (a supplementary run). */
  const supplementaryTo = async (runId: string, employeeIds: string[]) => {
    const base = await prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: runId } });
    const run = await prisma.ukPayrollRun.create({
      data: {
        periodId: base.periodId,
        taxYearId: base.taxYearId,
        scheduleId: base.scheduleId,
        runNumber: base.runNumber + 1,
        label: `Supplementary ${uuid().slice(0, 6)}`,
        status: 'EMPLOYEES_ENROLLED',
        employeeCount: employeeIds.length,
        createdById: maker,
        employees: { create: employeeIds.map((employeeId) => ({ employeeId })) },
      },
    });
    return run.id;
  };
  const gross = (runId: string) => ukRuns.calculateGross(maker, runId);
  const grossAndClose = async (runId: string) => {
    await gross(runId);
    await markStatutoryCalculated(prisma, runId);
    await ukRuns.close(checker, runId);
  };
  const lines = (runId: string, employeeId: string) =>
    prisma.ukPayrollInputLine.findMany({ where: { runId, employeeId }, orderBy: [{ lineType: 'asc' }, { description: 'asc' }] });
  const totals = async (runId: string, employeeId: string) => {
    const row = await prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId } });
    return {
      salaryPay: Number(row.salaryPay),
      visitPay: Number(row.visitPay),
      otherPay: Number(row.otherPay),
      expenseTotal: Number(row.expenseTotal),
      totalGross: Number(row.totalGross),
    };
  };
  const amounts = (rows: Array<{ lineType: string; amount: unknown }>, lineType: string) =>
    rows.filter((l) => l.lineType === lineType).map((l) => Number(l.amount));
  const lockedVisitRun = async (period = NOVEMBER) => {
    const run = await createRun(visitRuns, maker, period.periodStart, period.periodEnd);
    await visitRuns.calculate(run);
    await visitRuns.approve(checker, run);
    await visitRuns.lock(checker, run);
    return run;
  };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    visitRuns = buildPayrollRunsService(prisma).service;
    ukRuns = buildUkPayrollRunsService(prisma).service;
  });
  beforeEach(() => resetPayData(prisma));
  afterAll(() => prisma.$disconnect());

  describe('the salary of a period', () => {
    it('monthly salaried: a salary entered per month is paid as that amount for a whole month', async () => {
      const employeeId = uuid();
      await agree(employeeId, { salaryEntryPeriod: 'MONTHLY', salaryEntryAmount: 2_000 });
      const run = await ukRun([employeeId]);
      await gross(run);
      expect(amounts(await lines(run, employeeId), 'SALARY')).toEqual([2_000]);
      expect(await totals(run, employeeId)).toMatchObject({ salaryPay: 2_000, totalGross: 2_000 });
    });

    it('annual salaried: one twelfth of the yearly salary, in a short month as in a long one', async () => {
      const employeeId = uuid();
      await agree(employeeId, { annualSalary: 30_000, salaryEntryAmount: 30_000 });
      const november = await ukRun([employeeId]);
      const february = await ukRun([employeeId], { periodStart: '2027-02-01', periodEnd: '2027-02-28' });
      await gross(november);
      await gross(february);
      expect((await totals(november, employeeId)).salaryPay).toBe(2_500);
      expect((await totals(february, employeeId)).salaryPay).toBe(2_500);
    });

    it('an agreement with no proration method keeps the earlier calculation', async () => {
      const employeeId = uuid();
      await agree(employeeId, { annualSalary: 36_525, salaryProrationMethod: null });
      const run = await ukRun([employeeId]);
      await gross(run);
      expect((await totals(run, employeeId)).salaryPay).toBe(3_000); // 30 days × £36,525 ÷ 365.25
    });

    it('starter part way through: paid from the first day of the agreement, by the method it states', async () => {
      const byCalendar = uuid();
      const byWorking = uuid();
      await agree(byCalendar, { effectiveFrom: new Date('2026-11-16') });
      await agree(byWorking, { effectiveFrom: new Date('2026-11-16'), salaryProrationMethod: 'EQUAL_PERIODS_WORKING_DAYS' });
      const run = await ukRun([byCalendar, byWorking]);
      await gross(run);
      expect((await totals(run, byCalendar)).salaryPay).toBe(1_000); // 15 of 30 days
      expect((await totals(run, byWorking)).salaryPay).toBe(1_047.62); // 11 of 21 working days
    });

    it('leaver part way through: paid to the last day of the agreement and not after', async () => {
      const employeeId = uuid();
      await agree(employeeId, { status: 'TERMINATED', effectiveTo: new Date('2026-11-10') });
      const november = await ukRun([employeeId]);
      await gross(november);
      expect((await totals(november, employeeId)).salaryPay).toBe(666.67); // 10 of 30 days
      const december = await ukRun([employeeId], DECEMBER);
      await expect(gross(december)).rejects.toThrow(/No visit-pay or salary inputs/);
    });

    it('salary increase part way through: each part at its own salary, each held by one claim', async () => {
      const employeeId = uuid();
      await agree(employeeId, { status: 'SUPERSEDED' });
      await agree(employeeId, { effectiveFrom: new Date('2026-11-16'), annualSalary: 30_000, ...approvedOn('2026-11-10T09:00:00Z') });
      const run = await ukRun([employeeId]);
      await gross(run);
      const salary = (await lines(run, employeeId)).filter((l) => l.lineType === 'SALARY');
      expect(salary.map((l) => Number(l.amount)).sort((a, b) => a - b)).toEqual([1_000, 1_250]);
      expect(new Set(salary.map((l) => l.claimKey)).size).toBe(2);
      expect((await totals(run, employeeId)).salaryPay).toBe(2_250);
    });

    it('salary decrease part way through', async () => {
      const employeeId = uuid();
      await agree(employeeId, { status: 'SUPERSEDED' });
      await agree(employeeId, { effectiveFrom: new Date('2026-11-16'), annualSalary: 18_000, ...approvedOn('2026-11-10T09:00:00Z') });
      const run = await ukRun([employeeId]);
      await gross(run);
      expect((await totals(run, employeeId)).salaryPay).toBe(1_750);
    });

    it('a draft agreement pays nothing until it is approved', async () => {
      const employeeId = uuid();
      await agree(employeeId, { status: 'DRAFT', approvedAt: null, approvedById: null, termsChangedAt: null });
      const run = await ukRun([employeeId]);
      await expect(gross(run)).rejects.toThrow(/No visit-pay or salary inputs/);
    });
  });

  describe('salary and visit work', () => {
    it('salary plus covered visits: the visit wages are not paid again, and are settled by the run', async () => {
      const employeeId = uuid();
      await agree(employeeId);
      // One visit settled by a locked visit pay run, one still only approved.
      const locked = await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 28, minutes: 120 });
      await lockedVisitRun({ periodStart: '2026-11-01', periodEnd: '2026-11-07' });
      const provisional = await createApprovedVisit(prisma, { employeeId, start: '2026-11-17T09:00:00Z', amount: 14 });

      const run = await ukRun([employeeId]);
      await gross(run);

      const visitLines = (await lines(run, employeeId)).filter((l) => l.lineType === 'VISIT_PAY');
      expect(visitLines).toHaveLength(2);
      for (const line of visitLines) {
        expect(Number(line.amount)).toBe(0);
        expect(line.unpaidReason).toBe('COVERED_BY_SALARY');
        expect(line.description).toMatch(/already paid by the salary, not paid again/);
      }
      expect(visitLines.map((l) => Number(l.unpaidAmount)).sort((a, b) => a - b)).toEqual([14, 28]);
      expect(await totals(run, employeeId)).toMatchObject({ salaryPay: 2_000, visitPay: 0, totalGross: 2_000 });

      const detail = (await ukRuns.getById(run)) as { data: { employees: Array<{ coveredBySalary: number; heldForSalaryDecision: number }> } };
      expect(detail.data.employees[0]).toMatchObject({ coveredBySalary: 42, heldForSalaryDecision: 0 });

      // Closing settles both visits, so no later run can pay them.
      await markStatutoryCalculated(prisma, run);
      await ukRuns.close(checker, run);
      expect((await prisma.visitReconciliation.findUniqueOrThrow({ where: { id: provisional.id } })).paidByUkPayrollRunId).toBe(run);
      const supplementary = await supplementaryTo(run, [employeeId]);
      await expect(gross(supplementary)).rejects.toThrow(/No visit-pay or salary inputs/);
      expect(await prisma.ukPayrollInputLine.count({ where: { sourceVisitReconciliationId: { in: [locked.id, provisional.id] } } })).toBe(2);
    });

    it('an hourly employee in the same run is paid visit wages as before', async () => {
      const salariedId = uuid();
      const hourlyId = uuid();
      await agree(salariedId);
      await createApprovedVisit(prisma, { employeeId: salariedId, start: '2026-11-03T09:00:00Z', amount: 28 });
      await createApprovedVisit(prisma, { employeeId: hourlyId, start: '2026-11-03T09:00:00Z', amount: 28 });
      const run = await ukRun([salariedId, hourlyId]);
      await gross(run);
      expect(await totals(run, hourlyId)).toMatchObject({ salaryPay: 0, visitPay: 28, totalGross: 28 });
      expect(await totals(run, salariedId)).toMatchObject({ salaryPay: 2_000, visitPay: 0, totalGross: 2_000 });
    });

    it('a visit worked before the salary started is paid as a visit', async () => {
      const employeeId = uuid();
      await agree(employeeId, { effectiveFrom: new Date('2026-11-16') });
      await createApprovedVisit(prisma, { employeeId, start: '2026-11-10T09:00:00Z', amount: 28 });
      await createApprovedVisit(prisma, { employeeId, start: '2026-11-17T09:00:00Z', amount: 14 });
      const run = await ukRun([employeeId]);
      await gross(run);
      expect(await totals(run, employeeId)).toMatchObject({ salaryPay: 1_000, visitPay: 28, totalGross: 1_028 });
    });

    it('salary plus separately paid additional work: hours beyond the contracted hours are paid', async () => {
      const employeeId = uuid();
      await agree(employeeId, { salaryCoverage: 'CONTRACTED_HOURS', contractedHours: 10 });
      // Week of Monday 2 November: 6h + 6h + 2h = 14 hours at £14.
      await createApprovedVisit(prisma, { employeeId, start: '2026-11-02T09:00:00Z', minutes: 360, amount: 84 });
      await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', minutes: 360, amount: 84 });
      await createApprovedVisit(prisma, { employeeId, start: '2026-11-04T09:00:00Z', minutes: 120, amount: 28 });
      const run = await ukRun([employeeId]);
      await gross(run);
      const visitLines = (await lines(run, employeeId)).filter((l) => l.lineType === 'VISIT_PAY');
      expect(visitLines.map((l) => Number(l.amount)).sort((a, b) => a - b)).toEqual([0, 28, 28]);
      expect(visitLines.reduce((sum, l) => sum + Number(l.unpaidAmount ?? 0), 0)).toBe(140); // 10 hours
      expect(await totals(run, employeeId)).toMatchObject({ salaryPay: 2_000, visitPay: 56, totalGross: 2_056 });
    });

    it('a week split between two runs counts the contracted hours once', async () => {
      const employeeId = uuid();
      await agree(employeeId, { salaryCoverage: 'CONTRACTED_HOURS', contractedHours: 10 });
      // Week of Monday 30 November: 6 hours in November, 6 hours in December.
      await createApprovedVisit(prisma, { employeeId, start: '2026-11-30T09:00:00Z', minutes: 360, amount: 84 });
      await createApprovedVisit(prisma, { employeeId, start: '2026-12-01T09:00:00Z', minutes: 360, amount: 84 });
      const november = await ukRun([employeeId]);
      const december = await ukRun([employeeId], DECEMBER);
      // December first: the answer does not depend on the order the runs are calculated in.
      await gross(december);
      await gross(november);
      expect((await totals(november, employeeId)).visitPay).toBe(0); // all 6 hours within the 10
      expect((await totals(december, employeeId)).visitPay).toBe(28); // 4 covered, 2 additional
      await gross(december);
      expect((await totals(december, employeeId)).visitPay).toBe(28);
    });

    it('a salary for other duties (hybrid): visit work is paid in full as well', async () => {
      const employeeId = uuid();
      await agree(employeeId, { basis: 'HYBRID', salaryCoverage: 'NO_VISIT_WORK' });
      await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 28 });
      const run = await ukRun([employeeId]);
      await gross(run);
      expect(await totals(run, employeeId)).toMatchObject({ salaryPay: 2_000, visitPay: 28, totalGross: 2_028 });
    });

    it('salary plus an approved pay item and expenses: both are paid, the covered visit is not', async () => {
      const employeeId = uuid();
      await agree(employeeId);
      await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 28 });
      const approvedItem = { employeeId, workDate: new Date('2026-11-03'), status: 'APPROVED', createdById: maker, approvedById: checker, approvedAt: new Date() };
      await prisma.employeePayItem.create({
        data: { ...approvedItem, wageTypeCode: 'BONUS', unit: 'AMOUNT', amount: 50, reason: 'Synthetic bonus' } as never,
      });
      await prisma.employeePayItem.create({
        data: {
          ...approvedItem,
          wageTypeCode: 'MILEAGE_CORRECTION',
          unit: 'AMOUNT',
          amount: 9,
          quantity: 20,
          taxTreatment: 'TAX_FREE',
          taxFreeAmount: 9,
          taxableAmount: 0,
          reason: 'Synthetic mileage',
        } as never,
      });
      await lockedVisitRun({ periodStart: '2026-11-01', periodEnd: '2026-11-07' });

      const run = await ukRun([employeeId]);
      await gross(run);
      expect(await totals(run, employeeId)).toMatchObject({
        salaryPay: 2_000,
        visitPay: 0,
        otherPay: 50,
        expenseTotal: 9,
        totalGross: 2_050, // the reimbursement is not wages
      });
      const row = await prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: run, employeeId } });
      expect(Number(row.reimbursementPayable)).toBe(9);
    });

    it('a salary that does not say what it pays for: the visit wages are held, not paid on top and not lost', async () => {
      const employeeId = uuid();
      const undecided = await agree(employeeId, { salaryCoverage: null });
      const visit = await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z', amount: 28 });
      const run = await ukRun([employeeId]);
      await gross(run);

      const [held] = (await lines(run, employeeId)).filter((l) => l.lineType === 'VISIT_PAY');
      expect(Number(held.amount)).toBe(0);
      expect(Number(held.unpaidAmount)).toBe(28);
      expect(held.unpaidReason).toBe('SALARY_COVERAGE_NOT_DECIDED');
      expect(held.description).toMatch(/^Held — the pay agreement does not say/);
      expect(await totals(run, employeeId)).toMatchObject({ salaryPay: 2_000, totalGross: 2_000 });

      // The salary can be paid; the held visit stays unsettled.
      await markStatutoryCalculated(prisma, run);
      await ukRuns.close(checker, run);
      expect((await prisma.visitReconciliation.findUniqueOrThrow({ where: { id: visit.id } })).paidByUkPayrollRunId).toBeNull();

      // Once an approved agreement says the salary is for other duties, a supplementary run pays it.
      await prisma.employeePayAgreement.update({ where: { id: undecided.id }, data: { status: 'SUPERSEDED' } });
      await agree(employeeId, { basis: 'HYBRID', salaryCoverage: 'NO_VISIT_WORK', ...approvedOn('2026-12-02T09:00:00Z') });
      const supplementary = await supplementaryTo(run, [employeeId]);
      await gross(supplementary);
      expect(await totals(supplementary, employeeId)).toMatchObject({ salaryPay: 0, visitPay: 28, totalGross: 28 });
    });
  });

  describe('supplementary runs and corrections after a run is closed', () => {
    it('supplementary payroll: the salary of a period is not paid twice', async () => {
      const employeeId = uuid();
      await agree(employeeId, { basis: 'HYBRID', salaryCoverage: 'NO_VISIT_WORK' });
      const run = await ukRun([employeeId]);
      await grossAndClose(run);
      await createApprovedVisit(prisma, { employeeId, start: '2026-11-20T09:00:00Z', amount: 14 });
      const supplementary = await supplementaryTo(run, [employeeId]);
      await gross(supplementary);
      expect(await totals(supplementary, employeeId)).toMatchObject({ salaryPay: 0, visitPay: 14, totalGross: 14 });
      expect(await prisma.ukPayrollInputLine.count({ where: { employeeId, lineType: 'SALARY' } })).toBe(1);
    });

    it('salary corrected after the run is closed: the difference is paid once, in the next run', async () => {
      const employeeId = uuid();
      const original = await agree(employeeId);
      const november = await ukRun([employeeId]);
      await grossAndClose(november);
      const closedLines = await lines(november, employeeId);

      // The salary should have been £30,000 from 1 November. Approved after November was paid.
      await prisma.employeePayAgreement.update({ where: { id: original.id }, data: { status: 'SUPERSEDED' } });
      await agree(employeeId, { effectiveFrom: new Date('2026-11-01'), annualSalary: 30_000, ...approvedOn(new Date().toISOString()) });

      const december = await ukRun([employeeId], DECEMBER);
      await gross(december);
      const adjustment = (await lines(december, employeeId)).filter((l) => l.lineType === 'SALARY_ADJUSTMENT');
      expect(adjustment.map((l) => Number(l.amount))).toEqual([500]);
      expect(adjustment[0].description).toMatch(/now £2500\.00, £2000\.00 was paid/);
      expect(await totals(december, employeeId)).toMatchObject({ salaryPay: 3_000, totalGross: 3_000 });

      // Recalculating does not add it again, and the closed run is untouched.
      await gross(december);
      expect(await prisma.ukPayrollInputLine.count({ where: { employeeId, lineType: 'SALARY_ADJUSTMENT' } })).toBe(1);
      expect(await lines(november, employeeId)).toEqual(closedLines);

      // Once December is closed, later runs carry no further adjustment for November.
      await markStatutoryCalculated(prisma, december);
      await ukRuns.close(checker, december);
      const january = await ukRun([employeeId], { periodStart: '2027-01-01', periodEnd: '2027-01-31' });
      await gross(january);
      expect(await totals(january, employeeId)).toMatchObject({ salaryPay: 2_500, totalGross: 2_500 });
    });

    it('a correction can also be paid by a supplementary run in the same period, with no second salary', async () => {
      const employeeId = uuid();
      const original = await agree(employeeId);
      const november = await ukRun([employeeId]);
      await grossAndClose(november);
      await prisma.employeePayAgreement.update({ where: { id: original.id }, data: { status: 'SUPERSEDED' } });
      await agree(employeeId, { effectiveFrom: new Date('2026-11-01'), annualSalary: 30_000, ...approvedOn(new Date().toISOString()) });

      const supplementary = await supplementaryTo(november, [employeeId]);
      await gross(supplementary);
      const rows = await lines(supplementary, employeeId);
      expect(amounts(rows, 'SALARY')).toEqual([]);
      expect(amounts(rows, 'SALARY_ADJUSTMENT')).toEqual([500]);

      // A second open run does not also pay the same difference.
      const december = await ukRun([employeeId], DECEMBER);
      await gross(december);
      expect(amounts(await lines(december, employeeId), 'SALARY_ADJUSTMENT')).toEqual([]);
    });

    it('a salary reduced for a paid period is proposed for recovery, not deducted (Sprint B3; see wage-recoveries)', async () => {
      const employeeId = uuid();
      const original = await agree(employeeId);
      const november = await ukRun([employeeId]);
      await grossAndClose(november);
      await prisma.employeePayAgreement.update({ where: { id: original.id }, data: { status: 'SUPERSEDED' } });
      await agree(employeeId, { effectiveFrom: new Date('2026-11-01'), annualSalary: 21_600, ...approvedOn(new Date().toISOString()) });
      const december = await ukRun([employeeId], DECEMBER);
      await gross(december);
      const shown = (await lines(december, employeeId)).filter((l) => l.lineType === 'SALARY_ADJUSTMENT');
      expect(shown.map((l) => [Number(l.amount), Number(l.unpaidAmount), l.unpaidReason])).toEqual([[0, 200, 'RECOVERY_NOT_AUTHORISED']]);
      expect(await totals(december, employeeId)).toMatchObject({ salaryPay: 1_800, totalGross: 1_800 });
      expect(await prisma.wageRecovery.count({ where: { employeeId, status: 'PROPOSED' } })).toBe(1);
    });

    it('agreements that nobody changed after a period was paid never produce an adjustment', async () => {
      const employeeId = uuid();
      // Paid under the earlier calculation, by a run that picked the agreement at enrolment.
      await agree(employeeId, { salaryProrationMethod: null, termsChangedAt: null, approvedAt: null, approvedById: null });
      const november = await ukRun([employeeId]);
      await grossAndClose(november);
      // The stored amount differs from what the rules would work out now.
      await prisma.ukPayrollInputLine.updateMany({ where: { runId: november, lineType: 'SALARY' }, data: { amount: 1_234 } });
      const december = await ukRun([employeeId], DECEMBER);
      await gross(december);
      expect(amounts(await lines(december, employeeId), 'SALARY_ADJUSTMENT')).toEqual([]);
    });
  });
});
