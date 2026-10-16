/**
 * Leave taken in advance, recovered on leaving (employer decision 2026-10-14: annual salary / 260 a
 * day). A salaried employee (£36,000, 37.5 hours a week, leave year from 1 April) takes the whole
 * 28 days (210 hours) and leaves on 30 September 2026. Earned by then: 210 × 183/365 = 105.29
 * hours, so 104.71 hours = 13.96 days were taken in advance: 13.96 × £36,000 / 260 = £1,932.92.
 * Synthetic data; the contract term and recovery policy references are synthetic.
 */
import { WageRecoveriesService } from '../../src/billing/wage-recoveries.service';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { buildUkPayrollRunsService, createUkRun, giveTaxCode, resetPayData } from './harness';
import { createCarer, createStaffUser, createTestApp, resetIdentityData, TestApp } from './http-harness';

describe('leave taken in advance, recovered on leaving', () => {
  let t: TestApp;
  let ukRuns: UkPayrollRunsService;
  let preparer: { id: string };
  let approver: { id: string };
  let employeeId: string;
  const SEPTEMBER = { periodStart: '2026-09-01', periodEnd: '2026-09-30' };

  const salaryLines = async (runId: string) =>
    t.prisma.ukPayrollInputLine.findMany({ where: { runId, lineType: 'SALARY_ADJUSTMENT' } });
  const salaryPay = async (runId: string) =>
    Number((await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId } })).salaryPay);

  beforeAll(async () => {
    t = await createTestApp();
    ukRuns = buildUkPayrollRunsService(t.prisma).service;
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    await t.prisma.employeeLeaveEntry.deleteMany();
    await t.prisma.employeeLeaveTerms.deleteMany();
    await t.prisma.wageRecovery.deleteMany();
    preparer = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.manage', 'payroll.scope.organisation'] });
    approver = await createStaffUser(t.prisma, { permissions: ['payroll.runs.read', 'payroll.runs.close', 'billing.payroll_runs.approve', 'payroll.scope.organisation'] });
    employeeId = (await createCarer(t.prisma)).employeeId;
    await giveTaxCode(t.prisma, [employeeId], '1257L');
    await t.prisma.employeeEmployment.updateMany({
      where: { employeeId },
      data: { startDate: new Date('2026-04-01'), endDate: new Date('2026-09-30') },
    });
    await t.prisma.employeePayAgreement.create({
      data: {
        employeeId,
        basis: 'SALARIED',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-04-01'),
        annualSalary: 36_000,
        contractedHours: 37.5,
        salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
        salaryCoverage: 'ALL_VISIT_WORK',
        approvedAt: new Date('2026-03-20T09:00:00Z'),
      } as never,
    });
    await t.prisma.employeeLeaveTerms.create({
      data: {
        employeeId,
        workerCategory: 'REGULAR_HOURS',
        leaveYearStartMonth: 4,
        leaveYearStartDay: 1,
        weeklyHours: 37.5,
        payMethod: 'NORMAL_REMUNERATION_52_WEEKS',
        effectiveFrom: new Date('2026-04-01'),
        status: 'ACTIVE',
        approvedAt: new Date('2026-03-20T09:00:00Z'),
      },
    });
    await t.prisma.employeeLeaveEntry.create({
      data: { employeeId, entryType: 'TAKEN', entitlementType: 'STATUTORY', hours: 210, date: new Date('2026-06-01') },
    });
    await t.prisma.wageRecoveryPolicy.create({ data: { reference: 'Synthetic: recovery policy v1', recordedById: approver.id } });
  });
  afterAll(async () => {
    await t.close();
  });

  it('is proposed and shown on the final run; once approved, 13.96 days at £138.46 (£1,932.92) are deducted and the recovery is applied at close', async () => {
    const september = await createUkRun(t.prisma, { ...SEPTEMBER, employeeIds: [employeeId], createdById: preparer.id });
    await ukRuns.calculateGross(preparer.id, september);
    // Proposed only: nothing deducted, the full salary is paid.
    const [shown] = await salaryLines(september);
    expect(shown).toMatchObject({ claimKey: null, unpaidReason: 'RECOVERY_NOT_AUTHORISED' });
    expect([Number(shown.amount), Number(shown.unpaidAmount)]).toEqual([0, 1932.92]);
    expect(shown.description).toMatch(/Not deducted — leave taken in advance \(13\.96 day\(s\)\)/);
    expect(await salaryPay(september)).toBe(3000);
    const [proposal] = await t.prisma.wageRecovery.findMany({ where: { employeeId } });
    expect(proposal).toMatchObject({ kind: 'LEAVE_IN_ADVANCE', status: 'PROPOSED' });
    expect(Number(proposal.amount)).toBe(1932.92);
    expect(proposal.reason).toContain('13.96 day(s) (104.71 hours) more than earned by the leaving date 2026-09-30, at £36000.00 / 260 = £138.46 a day');

    // Approved by a second person with the contract term: deducted on recalculation.
    await t.app
      .get(WageRecoveriesService, { strict: false })
      .approve(approver.id, proposal.id, 'Synthetic: contract clause 14 (holiday taken in advance)', 'Synthetic: leaver confirmed');
    await ukRuns.calculateGross(preparer.id, september);
    const [deducted] = await salaryLines(september);
    expect(Number(deducted.amount)).toBe(-1932.92);
    expect(deducted.claimKey).toBe(proposal.subjectKey);
    expect(deducted.description).toBe('Leave taken in advance recovered on leaving: 13.96 day(s) at £138.46 (annual salary / 260)');
    expect(await salaryPay(september)).toBe(1067.08);

    await ukRuns.calculateStatutory(preparer.id, september);
    await ukRuns.close(approver.id, september);
    expect(await t.prisma.wageRecovery.findUniqueOrThrow({ where: { id: proposal.id } })).toMatchObject({ status: 'APPLIED', appliedInRunId: september });
  });
});
