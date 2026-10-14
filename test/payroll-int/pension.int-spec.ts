/**
 * Gate C16 — workplace pension (relief at source, qualifying earnings) through the monthly UK run:
 * net pay, the run row, YTD, recalculation, a supplementary payment and the cases refused.
 *
 * Synthetic employee on 1257L / NI A, £3,000 a month in 2026-27, enrolled from 1 April 2026 in a
 * synthetic scheme at the statutory minimum (5% employee gross, 3% employer). Not any employer's
 * actual scheme.
 */
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { buildUkPayrollRunsService, createUkRun, giveTaxCode, resetPayData } from './harness';
import { createCarer, createStaffUser, createTestApp, resetIdentityData, TestApp } from './http-harness';

describe('workplace pension through the UK run (Gate C16)', () => {
  let t: TestApp;
  let ukRuns: UkPayrollRunsService;
  let maker: { id: string };
  let checker: { id: string };
  let employeeId: string;

  const APRIL = { periodStart: '2026-04-01', periodEnd: '2026-04-30' };
  const MAY = { periodStart: '2026-05-01', periodEnd: '2026-05-31' };
  const ENROLLED = {
    pensionStatus: 'ENROLLED',
    pensionEnrolledFrom: new Date('2026-04-01'),
    pensionSchemeRef: 'SYNTHETIC-DC-001',
    pensionPolicyRef: 'Synthetic policy v1',
    pensionContributionBasis: 'QUALIFYING_EARNINGS',
    pensionTaxRelief: 'RAS',
    pensionEmployeeRatePercent: 5,
    pensionEmployerRatePercent: 3,
  };
  const run = (period: { periodStart: string; periodEnd: string }) => createUkRun(t.prisma, { ...period, employeeIds: [employeeId], createdById: maker.id });
  const calculate = async (runId: string) => {
    await ukRuns.calculateGross(maker.id, runId);
    await ukRuns.calculateStatutory(maker.id, runId);
  };
  const row = async (runId: string) => {
    const r = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId } });
    return {
      applied: r.pensionApplied,
      qualifying: Number(r.pensionQualifyingEarnings),
      gross: Number(r.pensionEmployeeGross),
      net: Number(r.pensionEmployeeNet),
      relief: Number(r.pensionTaxRelief),
      employer: Number(r.pensionEmployer),
      taxablePay: Number(r.taxablePay),
      employeeNi: Number(r.employeeNi),
      netPay: Number(r.netPay),
    };
  };
  const profile = (data: Record<string, unknown>) => t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: data as never });

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
    await profile(ENROLLED);
    await t.prisma.employeePayAgreement.create({
      data: {
        employeeId,
        basis: 'SALARIED',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-04-01'),
        annualSalary: 36_000,
        contractedHours: 5,
        salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
        salaryCoverage: 'ALL_VISIT_WORK',
        approvedAt: new Date('2026-03-20T09:00:00Z'),
      } as never,
    });
  });
  afterAll(async () => {
    await t.close();
  });

  it('pension on £3,000 through the run: recalculation and close post it once; a supplementary payment applies the limits once', async () => {
    const april = await run(APRIL);
    await calculate(april);
    const expected = { applied: true, qualifying: 2480, gross: 124, net: 99.2, relief: 24.8, employer: 74.4, taxablePay: 1951, employeeNi: 156.16, netPay: 2354.44 };
    expect(await row(april)).toEqual(expected); // net 3,000 − 390.20 − 156.16 − 99.20
    await ukRuns.calculateStatutory(maker.id, april);
    expect(await row(april)).toEqual(expected);
    await ukRuns.close(checker.id, april);
    const may = await run(MAY);
    await calculate(may);
    expect(await row(may)).toMatchObject({ gross: 124, net: 99.2, employer: 74.4, netPay: 2354.24 }); // May PAYE cumulative £390.40
    await ukRuns.close(checker.id, may);
    let ledger = await t.prisma.employeePayrollYtdLedger.findFirstOrThrow({ where: { employeeId } });
    expect([Number(ledger.pensionEmployeeGrossYtd), Number(ledger.pensionEmployeeNetYtd), Number(ledger.pensionEmployerYtd)]).toEqual([248, 198.4, 148.8]);
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/Reactivate this closed run/);

    // £1,000 more salary in May: on £4,000 (£3,480) less May's contributions: £50.00 / £40.00 / £30.00.
    const closed = await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: may } });
    const supplementary = await t.prisma.ukPayrollRun.create({
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
        employees: { create: [{ employeeId, salaryPay: 1000, totalGross: 1000, grossCalculatedAt: new Date() }] },
      },
    });
    await ukRuns.calculateStatutory(maker.id, supplementary.id);
    expect(await row(supplementary.id)).toMatchObject({ qualifying: 1000, gross: 50, net: 40, relief: 10, employer: 30 });
    await ukRuns.close(checker.id, supplementary.id);
    ledger = await t.prisma.employeePayrollYtdLedger.findFirstOrThrow({ where: { employeeId } });
    expect([Number(ledger.pensionEmployeeGrossYtd), Number(ledger.pensionEmployeeNetYtd), Number(ledger.pensionEmployerYtd)]).toEqual([298, 238.4, 178.8]);
    expect(await t.prisma.employeePayrollYtdContribution.count({ where: { employeeId } })).toBe(3);
  });

  it('a missing or incomplete enrolment, a net pay arrangement and unclassified pay are refused; not enrolled deducts nothing', async () => {
    const april = await run(APRIL);
    await ukRuns.calculateGross(maker.id, april);
    await profile({ pensionStatus: null });
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/workplace pension status not recorded/);
    await profile({ ...ENROLLED, pensionPolicyRef: null });
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/workplace pension details not recorded: approved policy reference/);
    await profile({ ...ENROLLED, pensionTaxRelief: 'NET_PAY' });
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/pension tax relief method NET_PAY \(only relief at source is calculated/);
    await profile({ ...ENROLLED, pensionEmployerRatePercent: 2 });
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/below the statutory minimum/);
    await profile(ENROLLED);
    await t.prisma.ukPayrollRunEmployee.updateMany({ where: { runId: april }, data: { otherPay: 100, totalGross: 3100 } });
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/not classified for pension/);
    expect((await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: april } })).statutoryCalculatedAt).toBeNull();

    // Confirmed not enrolled: nothing deducted (this is not an auto-enrolment assessment).
    await ukRuns.calculateGross(maker.id, april);
    await profile({ pensionStatus: 'NOT_ENROLLED' });
    await ukRuns.calculateStatutory(maker.id, april);
    expect(await row(april)).toMatchObject({ applied: false, net: 0, employer: 0, netPay: 2453.64 });
  });
});
