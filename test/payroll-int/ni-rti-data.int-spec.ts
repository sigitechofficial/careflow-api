/**
 * Gate C10 — National Insurance data kept for future RTI (FPS) reporting: the run row's NI-able
 * earnings and earnings bands, and NI year to date per NI category from the YTD contributions.
 *
 * Synthetic employee on 1257L, paid monthly in 2026-27. Monthly thresholds (GOV.UK 2026-27): LEL
 * £559, PT £1,048, ST £417, UEL £4,189; bands of £3,000 are at LEL £559, LEL–PT £489, PT–UEL £1,952.
 */
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { niYtdByCategory } from '../../src/payroll/payroll-ytd.util';
import { buildUkPayrollRunsService, createUkRun, giveTaxCode, resetPayData } from './harness';
import { createCarer, createStaffUser, createTestApp, resetIdentityData, TestApp } from './http-harness';

describe('NI data for RTI (Gate C10)', () => {
  let t: TestApp;
  let ukRuns: UkPayrollRunsService;
  let maker: { id: string };
  let checker: { id: string };
  let employeeId: string;

  const APRIL = { periodStart: '2026-04-01', periodEnd: '2026-04-30' };
  const MAY = { periodStart: '2026-05-01', periodEnd: '2026-05-31' };
  const agree = (annualSalary: number) =>
    t.prisma.employeePayAgreement.create({
      data: {
        employeeId,
        basis: 'SALARIED',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-04-01'),
        annualSalary,
        contractedHours: 5,
        salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
        salaryCoverage: 'ALL_VISIT_WORK',
        approvedAt: new Date('2026-03-20T09:00:00Z'),
      } as never,
    });
  const run = (period: { periodStart: string; periodEnd: string }) => createUkRun(t.prisma, { ...period, employeeIds: [employeeId], createdById: maker.id });
  const calculate = async (runId: string) => {
    await ukRuns.calculateGross(maker.id, runId);
    await ukRuns.calculateStatutory(maker.id, runId);
  };
  const snapshot = async (runId: string) => {
    const r = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId } });
    return {
      category: r.niCategoryApplied,
      director: r.directorNicMethodApplied,
      niable: Number(r.niableEarnings),
      bands: [Number(r.niEarningsAtLel), Number(r.niEarningsLelToPt), Number(r.niEarningsPtToUel)],
      ni: [Number(r.employeeNi), Number(r.employerNi)],
    };
  };
  const ytd = async () => {
    const taxYear = await t.prisma.payrollTaxYear.findFirstOrThrow({ where: { code: 'TEST-2026-27' } });
    return niYtdByCategory(t.prisma, employeeId, taxYear.id);
  };
  const supplementaryOf = async (runId: string, totalGross: number) => {
    const closed = await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: runId } });
    const created = await t.prisma.ukPayrollRun.create({
      data: {
        periodId: closed.periodId,
        taxYearId: closed.taxYearId,
        scheduleId: closed.scheduleId,
        runNumber: 2,
        label: 'Test supplementary run',
        status: 'GROSS_CALCULATED',
        grossCalculatedAt: new Date(),
        employeeCount: 1,
        createdById: maker.id,
        employees: { create: [{ employeeId, totalGross, grossCalculatedAt: new Date() }] },
      },
    });
    return created.id;
  };

  beforeAll(async () => {
    t = await createTestApp();
    ukRuns = buildUkPayrollRunsService(t.prisma).service;
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    await t.prisma.employeePayrollYtdContribution.deleteMany();
    await t.prisma.employeePayrollYtdLedger.deleteMany();
    maker = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.manage', 'payroll.scope.organisation'] });
    checker = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.close', 'payroll.scope.organisation'] });
    employeeId = (await createCarer(t.prisma)).employeeId;
    await giveTaxCode(t.prisma, [employeeId], '1257L');
    await agree(36_000); // £3,000.00 a month
  });
  afterAll(async () => {
    await t.close();
  });

  it('category A, £3,000 a month: the run row keeps the NI-able pay, the bands and the NI; closing copies them once', async () => {
    const april = await run(APRIL);
    await calculate(april);
    const expected = { category: 'A', director: null, niable: 3000, bands: [559, 489, 1952], ni: [156.16, 387.45] };
    expect(await snapshot(april)).toEqual(expected);
    await ukRuns.calculateStatutory(maker.id, april); // a draft recalculation overwrites, nothing added
    expect(await snapshot(april)).toEqual(expected);
    await ukRuns.close(checker.id, april);
    const posted = await t.prisma.employeePayrollYtdContribution.findMany({ where: { employeeId } });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ niCategory: 'A', directorNicMethod: null });
    expect([posted[0].niableEarnings, posted[0].niEarningsAtLel, posted[0].niEarningsLelToPt, posted[0].niEarningsPtToUel].map(Number)).toEqual([3000, 559, 489, 1952]);
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/Reactivate this closed run/);
    expect(await snapshot(april)).toEqual(expected); // closed history unchanged
  });

  it('two closed periods: NI year to date per category, each period posted once', async () => {
    const april = await run(APRIL);
    await calculate(april);
    await ukRuns.close(checker.id, april);
    const may = await run(MAY);
    await calculate(may);
    await ukRuns.close(checker.id, may);
    expect(await ytd()).toEqual({
      categories: [
        {
          niCategory: 'A',
          directorNicMethod: null,
          niableEarningsYtd: 6000,
          atLelYtd: 1118,
          lelToPtYtd: 978,
          ptToUelYtd: 3904,
          employeeNiYtd: 312.32,
          employerNiYtd: 774.9,
        },
      ],
      runsWithoutNiData: [],
    });
    expect(await t.prisma.employeePayrollYtdContribution.count({ where: { employeeId } })).toBe(2);
  });

  it('a supplementary run in the same earnings period adds its pay without counting the bands twice', async () => {
    const april = await run(APRIL);
    await calculate(april);
    await ukRuns.close(checker.id, april);
    // £1,000 more in April: on the £4,000 total the bands are £559 / £489 / £2,952, so this payment
    // adds only £1,000 between PT and UEL; NI £80.00 / £150.00 (C6).
    const supplementary = await supplementaryOf(april, 1000);
    await ukRuns.calculateStatutory(maker.id, supplementary);
    expect(await snapshot(supplementary)).toEqual({ category: 'A', director: null, niable: 1000, bands: [0, 0, 1000], ni: [80, 150] });
    await ukRuns.close(checker.id, supplementary);
    expect((await ytd()).categories).toEqual([
      expect.objectContaining({ niableEarningsYtd: 4000, atLelYtd: 559, lelToPtYtd: 489, ptToUelYtd: 2952, employeeNiYtd: 236.16, employerNiYtd: 537.45 }),
    ]);
  });

  it('a category change keeps each category apart; a supplementary payment under another category is refused', async () => {
    const april = await run(APRIL);
    await calculate(april);
    await ukRuns.close(checker.id, april);
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { niCategory: 'M' } });
    const may = await run(MAY);
    await calculate(may);
    expect(await snapshot(may)).toEqual({ category: 'M', director: null, niable: 3000, bands: [559, 489, 1952], ni: [156.16, 0] });
    await ukRuns.close(checker.id, may);
    const { categories } = await ytd();
    expect(categories.map((c) => [c.niCategory, c.niableEarningsYtd, c.ptToUelYtd, c.employeeNiYtd, c.employerNiYtd])).toEqual([
      ['A', 3000, 1952, 156.16, 387.45],
      ['M', 3000, 1952, 156.16, 0],
    ]);
    // Back to A for more pay in May, whose earlier payment was under M: the figures could not be kept apart.
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { niCategory: 'A' } });
    const supplementary = await supplementaryOf(may, 500);
    await expect(ukRuns.calculateStatutory(maker.id, supplementary)).rejects.toThrow(/NI category differs from an earlier payment in this earnings period/);
  });
});
