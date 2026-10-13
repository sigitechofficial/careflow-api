/**
 * Sprint B3, Task 1 — an overpayment found by a pay calculation is not deducted from wages by
 * itself.
 *
 * Before: a salary lowered for a period already paid, a guaranteed-hours top-up overtaken by a
 * late visit, and a minimum wage top-up overtaken by later pay each produced a negative pay line
 * straight away. A deduction from wages needs authority, and an employer may choose not to make it.
 *
 * Now the calculation records a proposed recovery (reason, original payment, amount, status) and
 * shows it on the run. A person with the pay approval power, other than the one whose calculation
 * proposed it, authorises it and states the basis, or rejects it. Only then is anything deducted.
 *
 * All people, salaries, guarantees and rates are synthetic.
 */
import request from 'supertest';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { buildUkPayrollRunsService, createApprovedVisit, createUkRun, markStatutoryCalculated, resetPayData, uuid } from './harness';
import { bearer, createCarer, createStaffUser, createTestApp, resetIdentityData, seedDefaultCards, TestApp } from './http-harness';

describe('wage recoveries: proposed, authorised, then deducted once', () => {
  let t: TestApp;
  let ukRuns: UkPayrollRunsService;
  let preparer: { id: string };
  let approver: { id: string };
  let employeeId: string;
  const NOVEMBER = { periodStart: '2026-11-01', periodEnd: '2026-11-30' };
  const DECEMBER = { periodStart: '2026-12-01', periodEnd: '2026-12-31' };
  const BASIS = 'Synthetic: clause 9.2 of the contract allows recovery of overpaid wages';

  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const recoveries = () => t.prisma.wageRecovery.findMany({ where: { employeeId }, orderBy: { createdAt: 'asc' } });

  // --- UK payroll (salary)
  const agree = (annualSalary: number, over: Record<string, unknown> = {}) =>
    t.prisma.employeePayAgreement.create({
      data: {
        employeeId,
        basis: 'SALARIED',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01'),
        annualSalary,
        salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
        salaryCoverage: 'ALL_VISIT_WORK',
        contractedHours: 30,
        approvedAt: new Date('2026-01-01T09:00:00Z'),
        termsChangedAt: new Date('2026-01-01T09:00:00Z'),
        ...over,
      } as never,
    });
  const ukRun = (period = NOVEMBER) => createUkRun(t.prisma, { ...period, employeeIds: [employeeId], createdById: preparer.id });
  const gross = (runId: string) => ukRuns.calculateGross(preparer.id, runId);
  const close = async (runId: string) => {
    await markStatutoryCalculated(t.prisma, runId);
    await ukRuns.close(approver.id, runId);
  };
  const ukLines = (runId: string) => t.prisma.ukPayrollInputLine.findMany({ where: { runId, employeeId } });
  const salaryPay = async (runId: string) => Number((await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId } })).salaryPay);
  /** November is paid at £24,000 a year; afterwards the salary for November is changed. */
  const novemberPaidThenSalaryBecomes = async (annualSalary: number) => {
    const original = await agree(24_000);
    const november = await ukRun();
    await gross(november);
    await close(november);
    await t.prisma.employeePayAgreement.update({ where: { id: original.id }, data: { status: 'SUPERSEDED' } });
    const now = new Date();
    await agree(annualSalary, { effectiveFrom: new Date('2026-11-01'), approvedAt: now, termsChangedAt: now });
    return november;
  };

  // --- visit pay run (guaranteed hours)
  const newRun = async (periodStart = '2026-11-02', periodEnd = '2026-11-08') => {
    const created = await post(preparer, '/billing/payroll-runs', { periodStart, periodEnd });
    expect(created.status).toBe(201);
    return created.body.data.id as string;
  };
  const calculate = async (id: string) => expect((await post(preparer, `/billing/payroll-runs/${id}/calculate`)).status).toBe(201);
  const lock = async (id: string) => {
    expect((await post(approver, `/billing/payroll-runs/${id}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${id}/lock`)).status).toBe(201);
  };
  const runLines = (payrollRunId: string) => t.prisma.payrollRunLine.findMany({ where: { payrollRunId, employeeId } });
  const work = (day: string, hours: number) =>
    createApprovedVisit(t.prisma, { employeeId, start: `${day}T09:00:00Z`, minutes: hours * 60, amount: hours * 14 });
  /** Guarantee of 14 hours: 6 worked, top-up of £112.00 locked, then a 2-hour visit approved late. */
  const topUpPaidThenLateVisit = async () => {
    await t.prisma.employeePayAgreement.create({
      data: { employeeId, basis: 'HOURLY_CARE', status: 'ACTIVE', effectiveFrom: new Date('2026-01-01'), guaranteedWeeklyHours: 14, guaranteeTopUp: 'PAY_SHORTFALL', guaranteeQualifyingTime: 'VISITS', approvedAt: new Date('2026-01-01') } as never,
    });
    await work('2026-11-03', 6);
    const first = await newRun();
    await calculate(first);
    await lock(first);
    await work('2026-11-05', 2);
    const supplementary = await newRun();
    await calculate(supplementary);
    return supplementary;
  };

  beforeAll(async () => {
    t = await createTestApp();
    ukRuns = buildUkPayrollRunsService(t.prisma).service;
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma, 14);
    const org = 'payroll.scope.organisation';
    preparer = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.manage', org] });
    approver = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.approve', org] });
    employeeId = (await createCarer(t.prisma)).employeeId;
  });
  afterAll(async () => {
    await t.close();
  });

  describe('a salary lowered for a period already paid', () => {
    it('is proposed and shown, and nothing is deducted from the next payroll', async () => {
      await novemberPaidThenSalaryBecomes(21_600); // November should have been £1,800.00, £2,000.00 was paid
      const december = await ukRun(DECEMBER);
      await gross(december);

      const lines = await ukLines(december);
      expect(lines.filter((l) => Number(l.amount) < 0)).toEqual([]);
      const [shown] = lines.filter((l) => l.lineType === 'SALARY_ADJUSTMENT');
      expect(shown).toMatchObject({ claimKey: null, unpaidReason: 'RECOVERY_NOT_AUTHORISED' });
      expect(Number(shown.amount)).toBe(0);
      expect(Number(shown.unpaidAmount)).toBe(200);
      expect(shown.description).toMatch(/Not deducted — salary overpaid .* nothing is deducted from pay until a person with the authority approves it/);
      // December is paid in full at its own salary.
      expect(await salaryPay(december)).toBe(1_800);

      const [recovery] = await recoveries();
      expect(recovery).toMatchObject({ kind: 'SALARY', status: 'PROPOSED', detectedInRunId: december, detectedById: preparer.id, authorityBasis: null });
      expect(Number(recovery.amount)).toBe(200);
      expect(recovery.reason).toMatch(/is now £1800\.00; £2000\.00 was paid/);
      expect(recovery.originalReference).toMatch(/£2000\.00 paid as salary by closed UK payroll run/);
      expect(recovery.subjectKey).toMatch(/^SALARY_ADJ:.*:1$/);

      // The run can be closed with the proposal unresolved: the employee is simply not charged.
      await close(december);
      expect((await recoveries())[0].status).toBe('PROPOSED');
    });

    it('once authorised by a second person with the approval power, it is deducted once', async () => {
      await novemberPaidThenSalaryBecomes(21_600);
      const december = await ukRun(DECEMBER);
      await gross(december);
      const [{ id }] = await recoveries();

      // Not the person whose calculation proposed it, not without the power, not without the basis.
      const both = await createStaffUser(t.prisma, { permissions: ['billing.payroll_runs.read', 'billing.payroll_runs.manage', 'billing.payroll_runs.approve', 'payroll.scope.organisation'] });
      expect((await post(preparer, `/billing/wage-recoveries/${id}/approve`, { authorityBasis: BASIS })).status).toBe(403);
      expect((await post(approver, `/billing/wage-recoveries/${id}/approve`, {})).status).toBe(400);
      await t.prisma.wageRecovery.update({ where: { id }, data: { detectedById: both.id } });
      const own = await post(both, `/billing/wage-recoveries/${id}/approve`, { authorityBasis: BASIS });
      expect(own.status).toBe(403);
      expect(own.body.message).toMatch(/different user from the one whose calculation proposed it/);

      const approved = await post(approver, `/billing/wage-recoveries/${id}/approve`, { authorityBasis: BASIS });
      expect(approved.status).toBe(201);
      expect((await post(approver, `/billing/wage-recoveries/${id}/approve`, { authorityBasis: BASIS })).status).toBe(400);

      await gross(december);
      const adjustments = (await ukLines(december)).filter((l) => l.lineType === 'SALARY_ADJUSTMENT');
      expect(adjustments.map((l) => [Number(l.amount), l.unpaidReason])).toEqual([[-200, null]]);
      expect(adjustments[0].claimKey).toBe((await recoveries())[0].subjectKey);
      expect(await salaryPay(december)).toBe(1_600);

      // A duplicate attempt: calculating again, and later runs, deduct nothing more.
      await gross(december);
      expect(await t.prisma.ukPayrollInputLine.count({ where: { employeeId, lineType: 'SALARY_ADJUSTMENT' } })).toBe(1);
      await close(december);
      expect((await recoveries()).map((r) => [r.status, r.appliedInRunId, r.authorityBasis])).toEqual([['APPLIED', december, BASIS]]);
      const january = await ukRun({ periodStart: '2027-01-01', periodEnd: '2027-01-31' });
      await gross(january);
      expect((await ukLines(january)).filter((l) => l.lineType === 'SALARY_ADJUSTMENT')).toEqual([]);
      expect(await recoveries()).toHaveLength(1);
      const audit = (await t.prisma.auditLog.findMany({ where: { recordId: id }, select: { action: true } })).map((a) => a.action);
      expect(audit).toEqual(['wage_recovery_approved']);
    });

    it('stays a proposal, shown on each later run, until someone decides; rejected, it is written off', async () => {
      await novemberPaidThenSalaryBecomes(21_600);
      const december = await ukRun(DECEMBER);
      await gross(december);
      await close(december);
      const january = await ukRun({ periodStart: '2027-01-01', periodEnd: '2027-01-31' });
      await gross(january);
      expect(await recoveries()).toHaveLength(1); // the same proposal, not a second one
      expect((await ukLines(january)).filter((l) => l.unpaidReason === 'RECOVERY_NOT_AUTHORISED')).toHaveLength(1);

      const [{ id }] = await recoveries();
      const rejected = await post(approver, `/billing/wage-recoveries/${id}/reject`, { note: 'Synthetic: employer error, not recovered' });
      expect(rejected.status).toBe(201);
      await gross(january);
      const lines = await ukLines(january);
      expect(lines.filter((l) => l.lineType === 'SALARY_ADJUSTMENT')).toEqual([]);
      expect(await salaryPay(january)).toBe(1_800);
      expect((await recoveries())[0]).toMatchObject({ status: 'REJECTED', decisionNote: 'Synthetic: employer error, not recovered' });
    });

    it('a decision is for an amount: if the overpayment changes, it is proposed again and nothing is deducted', async () => {
      await novemberPaidThenSalaryBecomes(21_600);
      const december = await ukRun(DECEMBER);
      await gross(december);
      const [{ id }] = await recoveries();
      await post(approver, `/billing/wage-recoveries/${id}/approve`, { authorityBasis: BASIS });
      // The salary for November is lowered again before the deduction is made.
      const now = new Date(Date.now() + 1000);
      await t.prisma.employeePayAgreement.updateMany({ where: { employeeId, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
      await agree(19_200, { effectiveFrom: new Date('2026-11-01'), approvedAt: now, termsChangedAt: now });
      await gross(december);
      expect((await ukLines(december)).filter((l) => Number(l.amount) < 0)).toEqual([]);
      const [again] = await recoveries();
      expect(again).toMatchObject({ status: 'PROPOSED', authorityBasis: null });
      expect(Number(again.amount)).toBe(400);
      expect(again.decisionNote).toMatch(/changed from £200\.00 after it was approved/);
    });

    it('a proposal is withdrawn when the calculation no longer finds the overpayment', async () => {
      await novemberPaidThenSalaryBecomes(21_600);
      const december = await ukRun(DECEMBER);
      await gross(december);
      // The lower agreement is found to be a mistake: the earlier salary is put back.
      const now = new Date(Date.now() + 1000);
      await t.prisma.employeePayAgreement.updateMany({ where: { employeeId, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
      await agree(24_000, { effectiveFrom: new Date('2026-11-01'), approvedAt: now, termsChangedAt: now });
      await gross(december);
      expect((await recoveries()).map((r) => r.status)).toEqual(['WITHDRAWN']);
      expect((await ukLines(december)).filter((l) => l.lineType === 'SALARY_ADJUSTMENT')).toEqual([]);
    });

    it('positive backpay is paid as before, with no recovery record', async () => {
      await novemberPaidThenSalaryBecomes(30_000);
      const december = await ukRun(DECEMBER);
      await gross(december);
      const adjustments = (await ukLines(december)).filter((l) => l.lineType === 'SALARY_ADJUSTMENT');
      expect(adjustments.map((l) => Number(l.amount))).toEqual([500]);
      expect(await salaryPay(december)).toBe(3_000);
      expect(await recoveries()).toEqual([]);
    });
  });

  describe('a guaranteed-hours top-up overtaken by a visit approved late', () => {
    it('the late visit is paid; the overpaid top-up is proposed, shown and not deducted', async () => {
      const supplementary = await topUpPaidThenLateVisit();
      const lines = await runLines(supplementary);
      expect(lines.filter((l) => Number(l.amount) < 0)).toEqual([]);
      expect(lines.filter((l) => l.lineType === 'VISIT_PAY').map((l) => Number(l.amount))).toEqual([28]);
      const [held] = lines.filter((l) => l.sourceType === 'HELD_EARNING');
      expect(held).toMatchObject({ lineType: 'GUARANTEED_HOURS', sourceRef: `HELD:RECOVERY:GUARANTEE:${employeeId}:2026-11-02:2`, claimKey: null });
      expect(held.exceptionMessage).toMatch(/£28\.00 was paid above what is now due\. It is a proposed recovery awaiting authorisation/);

      const [recovery] = await recoveries();
      expect(recovery).toMatchObject({ kind: 'GUARANTEED_HOURS', status: 'PROPOSED', subjectKey: `GUARANTEE:${employeeId}:2026-11-02:2`, detectedById: preparer.id });
      expect(Number(recovery.amount)).toBe(28);
      expect(recovery.reason).toBe('Overpaid guaranteed hours top-up for the week of 2026-11-02: £84.00 is now due, £112.00 was paid.');

      // Locking with the proposal unresolved pays the visit and deducts nothing.
      await lock(supplementary);
      expect((await recoveries())[0].status).toBe('PROPOSED');
      const listed = (await request(server()).get('/billing/wage-recoveries?status=PROPOSED').set(as(preparer))).body.data;
      expect(listed).toEqual([expect.objectContaining({ id: recovery.id, amount: 28, kind: 'GUARANTEED_HOURS' })]);
    });

    it('authorised: deducted once, with the week identity, and applied when the run is locked', async () => {
      const supplementary = await topUpPaidThenLateVisit();
      const [{ id }] = await recoveries();
      expect((await post(approver, `/billing/wage-recoveries/${id}/approve`, { authorityBasis: BASIS })).status).toBe(201);
      await calculate(supplementary);
      const lines = await runLines(supplementary);
      const [deduction] = lines.filter((l) => l.sourceType === 'GUARANTEED_HOURS');
      expect(Number(deduction.amount)).toBe(-28);
      expect(deduction.claimKey).toBe(`GUARANTEE:${employeeId}:2026-11-02:2`);
      expect(lines.filter((l) => l.sourceType === 'HELD_EARNING')).toEqual([]);
      await calculate(supplementary);
      expect((await runLines(supplementary)).filter((l) => l.sourceType === 'GUARANTEED_HOURS')).toHaveLength(1);

      await lock(supplementary);
      expect((await recoveries()).map((r) => [r.status, r.appliedInRunId])).toEqual([['APPLIED', supplementary]]);
      // The week now totals the guarantee, and a further run finds nothing to pay or to recover.
      const everything = await t.prisma.payrollRunLine.findMany({ where: { employeeId } });
      expect(everything.reduce((sum, l) => sum + Number(l.amount), 0)).toBe(196);
      const again = await newRun();
      await calculate(again);
      expect(await runLines(again)).toEqual([]);
      expect(await recoveries()).toHaveLength(1);
      expect((await post(approver, `/billing/wage-recoveries/${id}/reject`, { note: 'Too late' })).body.message).toMatch(/already been deducted in a locked pay run/);
    });

    it('rejected: written off, with nothing deducted and nothing left to show', async () => {
      const supplementary = await topUpPaidThenLateVisit();
      const [{ id }] = await recoveries();
      await post(approver, `/billing/wage-recoveries/${id}/reject`, { note: 'Synthetic: goodwill' });
      await calculate(supplementary);
      const lines = await runLines(supplementary);
      expect(lines.map((l) => [l.lineType, Number(l.amount)])).toEqual([['VISIT_PAY', 28]]);
    });
  });

  it('closing a UK run still requires every ordinary line to hold its claim', async () => {
    await agree(24_000);
    const run = await ukRun();
    await gross(run);
    // A line that lost its claim (as after a cancellation) and is neither held nor a shown recovery.
    await t.prisma.ukPayrollInputLine.updateMany({ where: { runId: run, lineType: 'SALARY' }, data: { claimKey: null } });
    await markStatutoryCalculated(t.prisma, run);
    await expect(ukRuns.close(approver.id, run)).rejects.toThrow(/no longer held by it/);
  });
});
