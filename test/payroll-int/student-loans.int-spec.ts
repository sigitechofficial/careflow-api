/**
 * Gate C11 — student and postgraduate loan deductions through the monthly UK payroll run: net pay,
 * the run row, the YTD ledger, recalculation, supplementary payments and the cases refused.
 *
 * Synthetic employee on 1257L and NI category A, paid £3,000 a month in 2026-27, with Plan 2 and a
 * postgraduate loan recorded (GOV.UK 2026-27 monthly thresholds £2,448.75 and £1,750.00).
 */
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { buildUkPayrollRunsService, createUkRun, giveTaxCode, resetPayData } from './harness';
import { createCarer, createStaffUser, createTestApp, resetIdentityData, TestApp } from './http-harness';

describe('student and postgraduate loans through the UK run (Gate C11)', () => {
  let t: TestApp;
  let ukRuns: UkPayrollRunsService;
  let maker: { id: string };
  let checker: { id: string };
  let employeeId: string;

  const APRIL = { periodStart: '2026-04-01', periodEnd: '2026-04-30' };
  const MAY = { periodStart: '2026-05-01', periodEnd: '2026-05-31' };
  const JUNE = { periodStart: '2026-06-01', periodEnd: '2026-06-30' };
  const run = (period: { periodStart: string; periodEnd: string }) => createUkRun(t.prisma, { ...period, employeeIds: [employeeId], createdById: maker.id });
  const calculate = async (runId: string) => {
    await ukRuns.calculateGross(maker.id, runId);
    await ukRuns.calculateStatutory(maker.id, runId);
  };
  const row = async (runId: string) => {
    const r = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId } });
    return {
      plan: r.studentLoanPlanApplied,
      studentLoan: Number(r.studentLoanDeduction),
      postgraduate: r.postgraduateLoanApplied,
      postgraduateLoan: Number(r.postgraduateLoanDeduction),
      employerNi: Number(r.employerNi),
      netPay: Number(r.netPay),
    };
  };
  const ledger = () => t.prisma.employeePayrollYtdLedger.findFirstOrThrow({ where: { employeeId } });
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
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { studentLoanPlan2: true, postgraduateLoan: true } });
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

  it('Plan 2 and postgraduate loan: £49 and £75 off net pay, employer NI unchanged, posted to YTD once per closed run', async () => {
    const expected = { plan: '2', studentLoan: 49, postgraduate: true, postgraduateLoan: 75, employerNi: 387.45, netPay: 2329.64 };
    const april = await run(APRIL);
    await calculate(april);
    expect(await row(april)).toEqual(expected);
    await ukRuns.calculateStatutory(maker.id, april); // a draft recalculation: nothing doubled
    expect(await row(april)).toEqual(expected);
    await ukRuns.close(checker.id, april);
    const may = await run(MAY);
    await calculate(may);
    // May's PAYE is cumulative (£390.40), so net pay is £2,329.44; the loans are the same.
    expect(await row(may)).toEqual({ ...expected, netPay: 2329.44 });
    await ukRuns.close(checker.id, may);
    const after = await ledger();
    expect([Number(after.studentLoanYtd), Number(after.postgraduateLoanYtd), Number(after.netPayYtd)]).toEqual([98, 150, 4659.08]);
    expect(await t.prisma.employeePayrollYtdContribution.count({ where: { employeeId, studentLoan: 49, postgraduateLoan: 75 } })).toBe(2);
    await expect(ukRuns.calculateStatutory(maker.id, april)).rejects.toThrow(/Reactivate this closed run/);
    expect(await row(april)).toEqual(expected); // closed history unchanged
  });

  it('a supplementary payment applies the monthly threshold once; changed, multiple or non-monthly loan cases are refused', async () => {
    const april = await run(APRIL);
    await calculate(april);
    await ukRuns.close(checker.id, april);
    // £1,000 more in April: on £4,000, £139 and £135 less £49 and £75 = £90 and £60;
    // net £1,000 − £200 tax − £80 NI − £90 − £60 = £570.
    const supplementary = await supplementaryOf(april, 1000);
    await ukRuns.calculateStatutory(maker.id, supplementary);
    expect(await row(supplementary)).toMatchObject({ studentLoan: 90, postgraduateLoan: 60, netPay: 570 });

    // The postgraduate loan stopped since April's payment: the period's figures cannot be kept apart.
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { postgraduateLoan: false } });
    await expect(ukRuns.calculateStatutory(maker.id, supplementary)).rejects.toThrow(/loan changed since an earlier payment in this earnings period/);

    // Two plans recorded: the plan HMRC notified has to be recorded, not chosen here.
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { postgraduateLoan: true, studentLoanPlan1: true } });
    const may = await run(MAY);
    await ukRuns.calculateGross(maker.id, may);
    await expect(ukRuns.calculateStatutory(maker.id, may)).rejects.toThrow(/more than one student loan plan recorded \(1, 2\)/);

    // A weekly schedule: not deducted rather than deducted wrongly.
    await t.prisma.employeePayrollProfile.update({ where: { employeeId }, data: { studentLoanPlan1: false } });
    const june = await run(JUNE);
    await ukRuns.calculateGross(maker.id, june);
    const juneRun = await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: june } });
    await t.prisma.payrollSchedule.update({ where: { id: juneRun.scheduleId }, data: { frequency: 'WEEKLY' } });
    await expect(ukRuns.calculateStatutory(maker.id, june)).rejects.toThrow(/calculated for monthly pay only/);
  });
});
