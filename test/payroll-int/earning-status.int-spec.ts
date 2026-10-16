/**
 * Gate A sprint, R-06 — the status of an earning is the same on every screen and for every route
 * into payroll. Audit IDs: EL-01, EL-03, PR-19.
 */
import request from 'supertest';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { EmployeePayoutsService } from '../../src/billing/employee-payouts.service';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { createApprovedVisit, createRun, createUkRun, markStatutoryCalculated, resetPayData } from './harness';
import { bearer, createCarer, createStaffUser, createTestApp, resetIdentityData, TestApp, seedDefaultCards } from './http-harness';

describe('earning status projection (HTTP)', () => {
  let t: TestApp;
  let office: { id: string };
  let carer: { employeeId: string; accountId: string };
  let visitRuns: PayrollRunsService;
  let ukRuns: UkPayrollRunsService;
  let payouts: EmployeePayoutsService;
  // Real users: these services write audit rows.
  let maker: string;
  let checker: string;
  let settler: string;
  const november = { periodStart: '2026-11-01', periodEnd: '2026-11-30' };
  const range = 'dateFrom=2026-11-01&dateTo=2026-11-30';

  const earnings = async () => {
    const res = await request(t.app.getHttpServer())
      .get(`/billing/payroll-runs/employee/${carer.employeeId}/earnings?${range}`)
      .set(bearer(t.staffToken(office.id)));
    expect(res.status).toBe(200);
    return res.body.data;
  };
  const row = async (visitId: string) => {
    const data = await earnings();
    const found = data.visits.find((v: { id: string }) => v.id === visitId);
    return { ...found, totals: data };
  };
  const visit = (start = '2026-11-03T09:00:00Z', amount = 14) =>
    createApprovedVisit(t.prisma, { employeeId: carer.employeeId, start, amount });
  const ukRun = () => createUkRun(t.prisma, { ...november, employeeIds: [carer.employeeId], createdById: maker });
  const closeUk = async (runId: string, netPay = 14) => {
    await markStatutoryCalculated(t.prisma, runId);
    await t.prisma.ukPayrollRunEmployee.updateMany({ where: { runId }, data: { netPay, totalGross: netPay } });
    await ukRuns.close(checker, runId);
  };

  beforeAll(async () => {
    t = await createTestApp();
    visitRuns = t.app.get(PayrollRunsService);
    ukRuns = t.app.get(UkPayrollRunsService);
    payouts = t.app.get(EmployeePayoutsService);
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    // One organisation default card, so the carer's card is decided whatever earlier suites left behind.
    await seedDefaultCards(t.prisma);
    office = await createStaffUser(t.prisma, {
      permissions: ['billing.payroll_runs.read', 'payroll.scope.organisation'],
    });
    [maker, checker, settler] = (
      await Promise.all([1, 2, 3].map(() => createStaffUser(t.prisma, { permissions: [] })))
    ).map((u) => u.id);
    carer = await createCarer(t.prisma);
  });
  afterAll(async () => {
    await t.close();
  });

  it('visit pay run route: approved → draft run → locked run → UK run → processed → payment recorded', async () => {
    const v = await visit();
    expect(await row(v.id)).toMatchObject({ earningStage: 'APPROVED', earningPhase: 'EARNED', paymentState: 'REMAINING' });

    const run = await createRun(visitRuns, maker, '2026-11-01', '2026-11-07');
    await visitRuns.calculate(run);
    expect(await row(v.id)).toMatchObject({
      earningStage: 'IN_DRAFT_PAY_RUN',
      earningPhase: 'EARNED',
      paid: false,
      paySettled: false,
    });

    await visitRuns.approve(checker, run);
    expect((await row(v.id)).earningStage).toBe('IN_DRAFT_PAY_RUN');
    await visitRuns.lock(checker, run);
    expect(await row(v.id)).toMatchObject({
      earningStage: 'IN_LOCKED_PAY_RUN',
      earningPhase: 'EARNED',
      paymentState: 'PAID',
      paySettled: true,
    });

    const uk = await ukRun();
    await ukRuns.calculateGross(maker, uk);
    expect(await row(v.id)).toMatchObject({ earningStage: 'IN_OPEN_UK_RUN', earningPhase: 'EARNED' });

    await closeUk(uk);
    const processed = await row(v.id);
    expect(processed).toMatchObject({ earningStage: 'IN_CLOSED_UK_RUN', earningPhase: 'PAYROLL_PROCESSED' });
    expect(processed.paymentState).not.toBe('BANK_PAID');
    expect(processed.earningStageLabel).toBe('Payroll processed');

    const { data: batch } = await payouts.create(maker, { ukPayrollRunId: uk } as never);
    expect(await row(v.id)).toMatchObject({ earningStage: 'PAYMENT_PREPARED', earningPhase: 'PAYMENT_PREPARED' });
    await payouts.approve(checker, batch.id);
    expect(await row(v.id)).toMatchObject({ earningStage: 'PAYMENT_APPROVED', earningPhase: 'PAYMENT_PREPARED' });

    await payouts.markPaid(settler, batch.id, {
      paymentReference: 'BACS-TEST-0001',
      settledOn: new Date().toISOString().slice(0, 10),
      settlementEvidence: 'Bank statement line 14',
    } as never);
    expect(await row(v.id)).toMatchObject({
      earningStage: 'PAYMENT_RECORDED',
      earningPhase: 'PAYMENT_RECORDED',
      earningStageLabel: 'Payment recorded',
      paymentState: 'BANK_PAID',
    });
  });

  it('UK run route without a visit pay run: processed at close and counted in the settled totals', async () => {
    const v = await visit('2026-11-03T09:00:00Z', 28);
    const before = await earnings();
    expect(before).toMatchObject({ totalEarnedAmount: 0, paidVisitCount: 0, remainingVisitCount: 1 });

    const uk = await ukRun();
    await ukRuns.calculateGross(maker, uk);
    // Collected by an open UK run only: still editable, so not offered a pay correction.
    expect(await row(v.id)).toMatchObject({ earningStage: 'IN_OPEN_UK_RUN', earningPhase: 'EARNED', paySettled: false });

    await closeUk(uk, 28);
    const after = await row(v.id);
    expect(after).toMatchObject({ earningStage: 'IN_CLOSED_UK_RUN', earningPhase: 'PAYROLL_PROCESSED', paySettled: true });
    expect(after.totals).toMatchObject({ totalEarnedAmount: 28, paidVisitCount: 1, remainingVisitCount: 0 });
  });

  it('a cancelled UK run gives the earning back: it is shown as waiting again, not as in payroll', async () => {
    const v = await visit();
    const uk = await ukRun();
    await ukRuns.calculateGross(maker, uk);
    expect((await row(v.id)).earningStage).toBe('IN_OPEN_UK_RUN');

    await ukRuns.cancel(maker, uk, undefined, 'Wrong period');

    const released = await row(v.id);
    expect(released).toMatchObject({ earningStage: 'APPROVED', paymentState: 'REMAINING', ukPayrollRunId: null });
    expect(released.totals).toMatchObject({ remainingVisitCount: 1, remainingAmountValue: 14 });

    // The replacement run picks it up and the status follows the replacement.
    const replacement = await ukRun();
    await ukRuns.calculateGross(maker, replacement);
    expect(await row(v.id)).toMatchObject({ earningStage: 'IN_OPEN_UK_RUN', ukPayrollRunId: replacement });
  });

  it('a correction on a settled visit shows on the earning: pending, then adjusted', async () => {
    const v = await visit();
    const run = await createRun(visitRuns, maker, '2026-11-01', '2026-11-07');
    await visitRuns.calculate(run);
    await visitRuns.approve(checker, run);
    await visitRuns.lock(checker, run);
    expect(await row(v.id)).toMatchObject({ correctionState: 'NONE', correctionAdjustmentValue: 0 });

    const item = await t.prisma.employeePayItem.create({
      data: {
        employeeId: carer.employeeId,
        wageTypeCode: 'MANUAL_ADJUSTMENT',
        workDate: new Date('2026-11-03'),
        unit: 'AMOUNT',
        amount: 7,
        reason: 'Pay correction: visit ran 90 minutes',
        sourceType: 'VISIT_CORRECTION',
        sourceId: v.id,
        originalAmount: 14,
        correctedAmount: 21,
        createdById: maker,
      },
    });
    expect(await row(v.id)).toMatchObject({ correctionState: 'PENDING_APPROVAL', correctionAdjustmentValue: 0 });

    await t.prisma.employeePayItem.update({ where: { id: item.id }, data: { status: 'APPROVED', approvedById: checker, approvedAt: new Date() } });
    const adjusted = await row(v.id);
    expect(adjusted).toMatchObject({ correctionState: 'ADJUSTED', correctionAdjustmentValue: 7, earningStage: 'IN_LOCKED_PAY_RUN' });
    // The settled amount of the visit itself is not rewritten.
    expect(adjusted.payableAmountValue).toBe(14);
  });

  it('the branch salary list counts UK-settled visits as settled and released ones as remaining', async () => {
    const settled = await visit('2026-11-03T09:00:00Z', 28);
    const uk = await ukRun();
    await ukRuns.calculateGross(maker, uk);
    await closeUk(uk, 28);
    const later = await visit('2026-11-20T09:00:00Z', 14);
    const second = await ukRun();
    await ukRuns.calculateGross(maker, second);
    await ukRuns.cancel(maker, second, undefined, 'Entered twice');

    const res = await request(t.app.getHttpServer())
      .get(`/billing/payroll-runs/employee-salaries?${range}`)
      .set(bearer(t.staffToken(office.id)));
    expect(res.status).toBe(200);
    const mine = res.body.data.rows.find((r: { employeeId: string }) => r.employeeId === carer.employeeId);
    expect(mine).toMatchObject({
      paidAmountValue: settled.payableAmount!.toNumber(),
      paidLineCount: 1,
      remainingVisitCount: 1,
      remainingAmountValue: later.payableAmount!.toNumber(),
    });
  });

  it('the carer app shows the same stage for the same visit', async () => {
    const v = await visit();
    const uk = await ukRun();
    await ukRuns.calculateGross(maker, uk);
    await closeUk(uk);

    const res = await request(t.app.getHttpServer())
      .get(`/employee-app/me/salary?${range}`)
      .set(bearer(t.carerToken(carer.accountId)));
    expect(res.status).toBe(200);
    const mine = res.body.data.visits.find((x: { id: string }) => x.id === v.id);
    expect(mine).toMatchObject({ earningStage: 'IN_CLOSED_UK_RUN', earningStageLabel: 'Payroll processed' });
    expect((await row(v.id)).earningStage).toBe(mine.earningStage);
  });
});
