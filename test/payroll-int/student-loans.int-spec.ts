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

  it('a supplementary payment applies the monthly threshold once; changed or multiple loan cases are refused', async () => {
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
  });

  it('Gate C12: fortnightly pay uses the weekly thresholds on average weekly pay; YTD, recalculation and a supplementary payment', async () => {
    // A fortnightly run for tax weeks 1-2 (6 to 19 April 2026) paying £1,300: £650 a week on average.
    const first = await run({ periodStart: '2026-04-06', periodEnd: '2026-04-19' });
    const created = await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: first } });
    await t.prisma.payrollSchedule.update({ where: { id: created.scheduleId }, data: { frequency: 'FORTNIGHTLY' } });
    await t.prisma.ukPayrollRun.update({ where: { id: first }, data: { status: 'GROSS_CALCULATED', grossCalculatedAt: new Date() } });
    await t.prisma.ukPayrollRunEmployee.updateMany({ where: { runId: first }, data: { totalGross: 1300, grossCalculatedAt: new Date() } });
    await ukRuns.calculateStatutory(maker.id, first);
    // Plan 2: £7 a week × 2 = £14; postgraduate: 6% of £246.16 = £14.77 → £14 × 2 = £28.
    const r1 = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: first, employeeId } });
    expect([r1.studentLoanPlanApplied, Number(r1.studentLoanDeduction), Number(r1.postgraduateLoanDeduction)]).toEqual(['2', 14, 28]);
    expect(Number(r1.employeeNi)).toBe(65.28); // NI unchanged: (1,300 − 484) × 8%
    expect(Number(r1.netPay)).toBe(Math.round((1300 - Number(r1.incomeTax) - 65.28 - 14 - 28) * 100) / 100);
    expect(r1.statutoryExplanation).toContain('a week (on average weekly pay over 2 weeks)');
    await ukRuns.calculateStatutory(maker.id, first); // draft recalculation: nothing doubled
    expect(await row(first)).toMatchObject({ studentLoan: 14, postgraduateLoan: 28 });
    await ukRuns.close(checker.id, first);

    // £200 more in the same fortnight: on £1,500 (£750 a week), £16 × 2 = £32 and £20 × 2 = £40,
    // less £14 and £28 already deducted: £18 and £12.
    const supplementary = await supplementaryOf(first, 200);
    await ukRuns.calculateStatutory(maker.id, supplementary);
    expect(await row(supplementary)).toMatchObject({ studentLoan: 18, postgraduateLoan: 12 });
    await ukRuns.close(checker.id, supplementary);
    const after = await ledger();
    expect([Number(after.studentLoanYtd), Number(after.postgraduateLoanYtd)]).toEqual([32, 40]);
    expect(await t.prisma.employeePayrollYtdContribution.count({ where: { employeeId } })).toBe(2);
  });
});
