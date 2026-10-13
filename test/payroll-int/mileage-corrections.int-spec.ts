/**
 * Gate B2, D-21 / D-20 — settled mileage is corrected as mileage, and mileage of earlier payroll
 * runs is paid only when finance releases it. Audit IDs: TR-09, TR-13.
 *
 * Before: the only correction for a visit in a locked run was a wage adjustment, so extra miles
 * were taxed as pay and counted as pay for the minimum wage. Mileage of UK runs calculated before
 * reimbursements reached payouts could not be paid by this system at all.
 *
 * Real controllers, services and database; tax and NI by the application's own calculation.
 * EVERY RATE HERE IS A SYNTHETIC TEST VALUE, labelled "TEST synthetic".
 */
import request from 'supertest';
import { createUkRun, resetPayData } from './harness';
import {
  bearer,
  createAllocatedVisit,
  createCarer,
  createStaffUser,
  createTestApp,
  resetIdentityData,
  seedDefaultCards,
  TestApp,
  useControlledClock,
} from './http-harness';

const PREPARE = [
  'billing.payroll_runs.read',
  'billing.payroll_runs.manage',
  'billing.employee_payouts.read',
  'billing.employee_payouts.manage',
  'billing.visit_reconciliations.read',
  'billing.visit_reconciliations.manage',
  'billing.pay_cards.read',
  'billing.pay_cards.manage',
  'payroll.runs.read',
  'payroll.runs.manage',
  'payroll.scope.organisation',
];
const APPROVE = [
  'billing.payroll_runs.read',
  'billing.payroll_runs.approve',
  'billing.employee_payouts.read',
  'billing.employee_payouts.approve',
  'billing.employee_payouts.settle',
  'payroll.runs.read',
  'payroll.runs.close',
  'payroll.scope.organisation',
];

type Carer = { employeeId: string; accountId: string };

describe('D-21 / D-20: mileage corrections and historic mileage', () => {
  let t: TestApp;
  let clock: ReturnType<typeof useControlledClock>;
  let preparer: { id: string };
  let preparer2: { id: string };
  let approver: { id: string };

  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const get = (user: { id: string }, path: string) => request(server()).get(path).set(as(user));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const patch = (user: { id: string }, path: string, body: Record<string, unknown>) =>
    request(server()).patch(path).set(as(user)).send(body);
  const n = (value: unknown) => Number(value);

  const work = async (carer: Carer, day: string, miles?: number, hm = '09:00') => {
    const start = new Date(`${day}T${hm}:00Z`);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start });
    clock.set(new Date(start.getTime() + 60_000));
    await request(server()).post(`/employee-app/visits/${visit.jobId}/check-in`).set(bearer(t.carerToken(carer.accountId))).send({});
    clock.set(new Date(start.getTime() + 60 * 60_000));
    const done = await request(server()).post(`/employee-app/visits/${visit.jobId}/complete`).set(bearer(t.carerToken(carer.accountId))).send({ status: 'COMPLETED' });
    expect(done.status).toBe(201);
    const row = await t.prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visit.visitId } });
    if (miles != null) expect((await patch(preparer, `/billing/visit-reconciliations/${row.id}`, { travelMiles: miles })).status).toBe(200);
    return row.id;
  };
  const payRun = async (periodStart: string, periodEnd: string) => {
    const created = await post(preparer, '/billing/payroll-runs', { periodStart, periodEnd });
    const id = created.body.data.id as string;
    expect((await post(preparer, `/billing/payroll-runs/${id}/calculate`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${id}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${id}/lock`)).status).toBe(201);
    return id;
  };
  const mileageOf = (payrollRunId: string) =>
    t.prisma.payrollRunLine.findMany({ where: { payrollRunId, lineType: 'MILEAGE' }, orderBy: { createdAt: 'asc' } });
  const correct = (visitReconciliationId: string, correctedMiles: number, by = preparer) =>
    post(by, '/billing/pay-items/mileage-corrections', { visitReconciliationId, correctedMiles, reason: 'Synthetic: miles recorded wrongly' });
  /** Records a correction and has a second person approve it. Returns the pay item. */
  const correctAndApprove = async (visitId: string, miles: number) => {
    const recorded = await correct(visitId, miles);
    expect(recorded.status).toBe(201);
    expect((await post(preparer2, `/billing/pay-items/${recorded.body.data.id}/approve`)).status).toBe(201);
    return recorded.body.data as { id: string };
  };
  const ukRun = async (periodStart: string, periodEnd: string, employeeIds: string[]) => {
    const id = await createUkRun(t.prisma, { periodStart, periodEnd, employeeIds, createdById: preparer.id });
    expect((await post(preparer, `/payroll/runs/${id}/calculate-gross`)).status).toBe(201);
    expect((await post(preparer, `/payroll/runs/${id}/calculate-statutory`)).status).toBe(201);
    expect((await post(approver, `/payroll/runs/${id}/close`)).status).toBe(201);
    return id;
  };
  const syntheticRate = async (rateFirst: number, rateAfter: number, thresholdMiles: number, approved?: { first: number; after: number }) => {
    const created = await post(preparer, '/billing/mileage-rates', {
      effectiveFrom: '2026-04-06',
      vehicleType: 'CAR_VAN',
      rateFirst,
      rateAfter,
      thresholdMiles,
      passengerRate: 0.05,
      label: 'TEST synthetic — not a real rate',
      reason: 'Synthetic test rate, not a policy decision',
    });
    expect(created.status).toBe(201);
    if (approved) {
      const verified = await patch(preparer, `/billing/mileage-rates/${created.body.data.id}/approved-amounts`, {
        approvedRateFirst: approved.first,
        approvedRateAfter: approved.after,
        approvedThresholdMiles: thresholdMiles,
        approvedPassengerRate: 0.05,
        source: 'TEST synthetic — no real publication was consulted',
      });
      expect(verified.status).toBe(200);
    }
  };

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(new Date('2026-11-02T08:00:00Z'));
    await resetPayData(t.prisma);
    await t.prisma.payEvaluationFailure.deleteMany();
    await t.prisma.visitAttendanceEvent.deleteMany();
    await t.prisma.employeeNonCoreActivity.deleteMany();
    await t.prisma.mileageRate.deleteMany({ where: { label: { startsWith: 'TEST' } } });
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma, 14);
    preparer = await createStaffUser(t.prisma, { permissions: PREPARE });
    preparer2 = await createStaffUser(t.prisma, { permissions: PREPARE });
    approver = await createStaffUser(t.prisma, { permissions: APPROVE });
  });
  afterEach(() => clock.restore());
  afterAll(async () => {
    await t.prisma.mileageRate.deleteMany({ where: { label: { startsWith: 'TEST' } } });
    await resetPayData(t.prisma);
    await t.close();
  });

  it('more miles than were paid: the difference is a mileage line in the next run, approved by a second person, and never wages', async () => {
    const ann = await createCarer(t.prisma);
    const visit = await work(ann, '2026-11-03', 10);
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const first = await payRun('2026-11-02', '2026-11-08');
    expect((await mileageOf(first)).map((l) => [n(l.quantity), n(l.amount)])).toEqual([[10, 5.5]]);

    // Miles on a settled visit cannot be edited; a mileage correction is the way.
    expect((await patch(preparer, `/billing/visit-reconciliations/${visit}`, { travelMiles: 14 })).status).toBeGreaterThanOrEqual(400);
    const recorded = await correct(visit, 14);
    expect(recorded.status).toBe(201);
    expect(recorded.body.data).toMatchObject({ wageTypeCode: 'MILEAGE_CORRECTION', sourceType: 'MILEAGE_CORRECTION', sourceId: visit, status: 'PENDING_APPROVAL', taxTreatment: 'NOT_VERIFIED' });
    expect([n(recorded.body.data.quantity), n(recorded.body.data.amount), n(recorded.body.data.originalAmount), n(recorded.body.data.correctedAmount)]).toEqual([4, 2.2, 5.5, 7.7]);
    expect(recorded.body.message).toContain('reimbursed in the next visit pay run');
    // One at a time; the same person cannot approve their own entry.
    expect((await correct(visit, 15)).status).toBe(400);
    expect((await post(preparer, `/billing/pay-items/${recorded.body.data.id}/approve`)).status).toBe(403);
    expect((await post(preparer2, `/billing/pay-items/${recorded.body.data.id}/approve`)).status).toBe(201);
    // Asking for the same total again changes nothing.
    const same = await correct(visit, 14);
    expect(same.status).toBe(400);
    expect(same.body.message).toContain('already settled at 14.00 miles');

    await work(ann, '2026-11-10');
    clock.set(new Date('2026-11-16T09:00:00Z'));
    const second = await payRun('2026-11-09', '2026-11-15');
    const lines = await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: second } });
    const correction = lines.find((l) => l.employeePayItemId === recorded.body.data.id)!;
    expect(correction).toMatchObject({ lineType: 'MILEAGE', sourceType: 'PAY_ITEM', taxTreatment: 'NOT_VERIFIED' });
    expect([n(correction.quantity), n(correction.amount)]).toEqual([4, 2.2]);
    expect(correction.description).toContain('Mileage correction');
    // Not wages: the run's gross pay is the visit pay alone; nothing was added for the minimum wage either.
    const run = await t.prisma.payrollRun.findUniqueOrThrow({ where: { id: second } });
    expect([n(run.grossPay), n(run.expenseTotal), n(run.nmwTopUp)]).toEqual([14, 2.2, 0]);
    expect(lines.filter((l) => l.lineType === 'ADJUSTMENT')).toHaveLength(0);

    const history = await get(preparer, `/billing/pay-items/mileage-corrections/${visit}`);
    expect(history.body.data).toMatchObject({ originalMiles: '10.00', originalAmount: '5.50', netMiles: '14.00', netAmount: '7.70', differenceAmount: '2.20', taxTreatmentVerified: false });
    // The wage ledger of the visit is untouched.
    const wages = await get(preparer, `/billing/pay-items/visit-corrections/${visit}`);
    expect(wages.body.data.items).toHaveLength(0);
    expect(wages.body.data.differenceAmount).toBe('0.00');
  });

  it('fewer miles than were paid: the recovery comes off the reimbursement, and the payment carries the net once', async () => {
    const ann = await createCarer(t.prisma);
    const visit = await work(ann, '2026-11-03', 10);
    clock.set(new Date('2026-11-09T09:00:00Z'));
    await payRun('2026-11-02', '2026-11-08');
    const item = await correctAndApprove(visit, 6);
    const stored = await t.prisma.employeePayItem.findUniqueOrThrow({ where: { id: item.id } });
    expect([n(stored.quantity), n(stored.amount)]).toEqual([-4, -2.2]);

    await work(ann, '2026-11-10');
    clock.set(new Date('2026-11-16T09:00:00Z'));
    await payRun('2026-11-09', '2026-11-15');
    clock.set(new Date('2026-12-01T09:00:00Z'));
    const uk = await ukRun('2026-11-01', '2026-11-30', [ann.employeeId]);
    const row = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: uk } });
    // Wages £28.00 (two visits); mileage £5.50 less the £2.20 recovered.
    expect([n(row.totalGross), n(row.expenseTotal), n(row.reimbursementPayable)]).toEqual([28, 3.3, 3.3]);
    const batch = await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: uk });
    expect(batch.status).toBe(201);
    expect(batch.body.data.lines[0]).toMatchObject({ netPayValue: n(row.netPay), reimbursementValue: 3.3 });
    const detail = await get(preparer, `/payroll/runs/${uk}`);
    expect(detail.body.data.employees[0].payBreakdown).toEqual({
      grossTaxableWages: 28,
      reimbursementTaxFree: 0,
      reimbursementTaxableExcess: 0,
      reimbursementNotVerified: 3.3,
      netWages: n(row.netPay),
      totalPayable: Math.round((n(row.netPay) + 3.3) * 100) / 100,
    });
  });

  it('a paid mileage correction is reversed as mileage, once', async () => {
    const ann = await createCarer(t.prisma);
    const visit = await work(ann, '2026-11-03', 10);
    clock.set(new Date('2026-11-09T09:00:00Z'));
    await payRun('2026-11-02', '2026-11-08');
    const item = await correctAndApprove(visit, 14);
    // Not paid yet: it is cancelled, not reversed.
    expect((await post(preparer, `/billing/pay-items/${item.id}/reverse`, { reason: 'Synthetic: entered twice' })).status).toBe(400);
    await work(ann, '2026-11-10');
    clock.set(new Date('2026-11-16T09:00:00Z'));
    await payRun('2026-11-09', '2026-11-15');

    const reversed = await post(preparer, `/billing/pay-items/${item.id}/reverse`, { reason: 'Synthetic: the original miles were right' });
    expect(reversed.status).toBe(201);
    expect(reversed.body.data).toMatchObject({ wageTypeCode: 'MILEAGE_CORRECTION', sourceType: 'MILEAGE_CORRECTION', sourceId: visit, reversesPayItemId: item.id, status: 'PENDING_APPROVAL' });
    expect([n(reversed.body.data.quantity), n(reversed.body.data.amount)]).toEqual([-4, -2.2]);
    expect((await post(preparer, `/billing/pay-items/${item.id}/reverse`, { reason: 'Synthetic: a second time' })).status).toBe(400);
    expect((await post(preparer2, `/billing/pay-items/${reversed.body.data.id}/approve`)).status).toBe(201);
    expect((await post(preparer, `/billing/pay-items/${reversed.body.data.id}/reverse`, { reason: 'Synthetic: reverse the reversal' })).status).toBe(400);
    const history = await get(preparer, `/billing/pay-items/mileage-corrections/${visit}`);
    expect(history.body.data).toMatchObject({ netMiles: '10.00', netAmount: '5.50', differenceAmount: '0.00' });
  });

  it('with verified approved amounts the correction carries its own tax split, and the part above is taxed as pay', async () => {
    await syntheticRate(0.55, 0.25, 10_000, { first: 0.45, after: 0.25 });
    const ann = await createCarer(t.prisma);
    const visit = await work(ann, '2026-11-03', 10);
    clock.set(new Date('2026-11-09T09:00:00Z'));
    await payRun('2026-11-02', '2026-11-08');
    const recorded = await correct(visit, 20);
    expect(recorded.body.data).toMatchObject({ taxTreatment: 'PART_TAXABLE' });
    expect([n(recorded.body.data.amount), n(recorded.body.data.taxFreeAmount), n(recorded.body.data.taxableAmount)]).toEqual([5.5, 4.5, 1]);
    expect((await post(preparer2, `/billing/pay-items/${recorded.body.data.id}/approve`)).status).toBe(201);
    await work(ann, '2026-11-10');
    clock.set(new Date('2026-11-16T09:00:00Z'));
    await payRun('2026-11-09', '2026-11-15');
    clock.set(new Date('2026-12-01T09:00:00Z'));
    const uk = await ukRun('2026-11-01', '2026-11-30', [ann.employeeId]);
    const inputs = await t.prisma.ukPayrollInputLine.findMany({ where: { runId: uk } });
    expect(inputs.filter((l) => l.lineType.startsWith('MILEAGE')).map((l) => [l.lineType, n(l.amount), l.isExpense]).sort()).toEqual(
      [
        ['MILEAGE', 4.5, true], // the original journey, within the approved amount
        ['MILEAGE', 4.5, true], // the correction, within the approved amount
        ['MILEAGE_TAXABLE', 1, false],
        ['MILEAGE_TAXABLE', 1, false],
      ].sort(),
    );
    const detail = await get(preparer, `/payroll/runs/${uk}`);
    expect(detail.body.data.employees[0].payBreakdown).toMatchObject({ grossTaxableWages: 28, reimbursementTaxFree: 9, reimbursementTaxableExcess: 2, reimbursementNotVerified: 0 });
  });

  it('a correction is priced where the journey sits in the tax year, and later journeys see the corrected total', async () => {
    await syntheticRate(0.5, 0.2, 100); // synthetic: 50p for the first 100 miles of the tax year, 20p after
    const ann = await createCarer(t.prisma);
    const visit = await work(ann, '2026-11-03', 90);
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const first = await payRun('2026-11-02', '2026-11-08');
    expect((await mileageOf(first)).map((l) => n(l.amount))).toEqual([45]);

    // 110 miles: 100 at 50p and 10 at 20p = £52.00, so £7.00 more (not 20 × 50p).
    const recorded = await correct(visit, 110);
    expect([n(recorded.body.data.quantity), n(recorded.body.data.amount)]).toEqual([20, 7]);
    expect((await post(preparer2, `/billing/pay-items/${recorded.body.data.id}/approve`)).status).toBe(201);
    await work(ann, '2026-11-10');
    clock.set(new Date('2026-11-16T09:00:00Z'));
    await payRun('2026-11-09', '2026-11-15');

    // A journey after the correction was paid: the year's total is 110, so all of it is at 20p.
    await work(ann, '2026-11-17', 10);
    clock.set(new Date('2026-11-23T09:00:00Z'));
    const third = await payRun('2026-11-16', '2026-11-22');
    expect((await mileageOf(third)).map((l) => [n(l.quantity), n(l.amount)])).toEqual([[10, 2]]);
  });

  it('a settled visit with no mileage can be given miles; a visit that is not settled is corrected on the visit', async () => {
    const ann = await createCarer(t.prisma);
    const settled = await work(ann, '2026-11-03');
    clock.set(new Date('2026-11-09T09:00:00Z'));
    await payRun('2026-11-02', '2026-11-08');
    const recorded = await correct(settled, 5);
    expect(recorded.status).toBe(201);
    expect([n(recorded.body.data.quantity), n(recorded.body.data.amount), n(recorded.body.data.originalAmount)]).toEqual([5, 2.75, 0]);

    const open = await work(ann, '2026-11-10', 3);
    const refused = await correct(open, 6);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('not in a locked payroll run yet');
  });

  it('mileage of an earlier UK run is paid only after finance releases it, with a reason, and then once', async () => {
    const ann = await createCarer(t.prisma);
    await work(ann, '2026-11-03', 6.2);
    clock.set(new Date('2026-11-09T09:00:00Z'));
    await payRun('2026-11-02', '2026-11-08');
    clock.set(new Date('2026-12-01T09:00:00Z'));
    const uk = await ukRun('2026-11-01', '2026-11-30', [ann.employeeId]);
    const row = await t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId: uk } });
    // As a run calculated before reimbursements reached payouts would be: recorded, not payable.
    await t.prisma.ukPayrollRunEmployee.update({ where: { id: row.id }, data: { reimbursementPayable: 0 } });

    const batch = await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: uk });
    expect(batch.body.data.lines[0]).toMatchObject({ reimbursementValue: 0, amountValue: n(row.netPay) });
    expect((await post(approver, `/billing/employee-payouts/${batch.body.data.id}/approve`)).status).toBe(201);
    clock.set(new Date('2026-12-04T10:00:00Z'));
    expect((await post(approver, `/billing/employee-payouts/${batch.body.data.id}/mark-paid`, { paymentReference: 'BACS-TEST-OLD', settledOn: '2026-12-04', settlementEvidence: 'Synthetic statement line' })).status).toBe(201);
    const before = await get(preparer, `/billing/employee-payouts/reimbursements?ukPayrollRunId=${uk}`);
    expect(before.body.data[0]).toMatchObject({ expenseTotal: 3.41, reimbursementPayable: 0, outstanding: 0, beforeReimbursementPayouts: true });
    // Nothing pays it by itself.
    expect((await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: uk })).status).toBe(400);

    const release = (by: { id: string }, body: Record<string, unknown>) => post(by, `/billing/employee-payouts/reimbursements/${row.id}/release`, body);
    const reason = { reason: 'Synthetic: finance checked the November statement; not paid elsewhere' };
    expect((await release(preparer, reason)).status).toBe(403); // needs the payout approval power
    expect((await release(approver, {})).status).toBe(400); // needs a reason
    const released = await release(approver, reason);
    expect(released.status).toBe(201);
    expect(released.body.data).toMatchObject({ released: 3.41 });
    expect((await release(approver, reason)).status).toBe(400); // already payable
    const audit = await t.prisma.auditLog.findFirst({ where: { action: 'historic_reimbursement_released', recordId: row.id } });
    expect(audit).toMatchObject({ userId: approver.id, description: reason.reason });

    const after = await get(preparer, `/billing/employee-payouts/reimbursements?ukPayrollRunId=${uk}`);
    expect(after.body.data[0]).toMatchObject({ reimbursementPayable: 3.41, inPayoutBatches: 0, outstanding: 3.41, beforeReimbursementPayouts: false });
    const second = await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: uk });
    expect(second.status).toBe(201);
    expect(second.body.data.lines[0]).toMatchObject({ netPayValue: 0, reimbursementValue: 3.41, amountValue: 3.41 });
    expect((await post(approver, `/billing/employee-payouts/${second.body.data.id}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/employee-payouts/${second.body.data.id}/mark-paid`, { paymentReference: 'BACS-TEST-OLD-MILEAGE', settledOn: '2026-12-04', settlementEvidence: 'Synthetic statement line' })).status).toBe(201);
    expect((await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: uk })).status).toBe(400);
    const done = await get(preparer, `/billing/employee-payouts/reimbursements?ukPayrollRunId=${uk}`);
    expect(done.body.data[0]).toMatchObject({ inPayoutBatches: 3.41, recordedAsPaid: 3.41, outstanding: 0 });
  });
});
