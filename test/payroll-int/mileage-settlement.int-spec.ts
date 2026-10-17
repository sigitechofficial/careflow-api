/**
 * Gate B sprint, TR-09 / TR-13 — mileage from the visit to the employee's payment.
 * Audit IDs: TR-09, TR-13.
 *
 * Before: mileage was priced from rates fixed in the code, the year-to-date total was guessed by
 * dividing pounds by a rate, a threshold crossed inside one pay run was missed, and the
 * reimbursement stopped at the UK payroll run: it was "tracked separately" and never reached a
 * payout, so the carer was not paid it by this system.
 *
 * Real controllers, services and database. Tax and National Insurance are worked out by the
 * application's own calculation, not by a stand-in; these tests check how reimbursements relate
 * to it (inside or outside taxable pay, paid once), not the correctness of the statutory tables.
 *
 * EVERY RATE HERE IS A SYNTHETIC TEST VALUE, labelled "TEST synthetic". None is a statement of
 * what the organisation pays or of what HMRC approves.
 */
import request from 'supertest';
import { createUkRun, resetPayData, giveTaxCode } from './harness';
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

describe('TR-09 / TR-13: mileage from the visit to the payment', () => {
  let t: TestApp;
  let clock: ReturnType<typeof useControlledClock>;
  let preparer: { id: string };
  let approver: { id: string };
  let reader: { id: string };

  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const asCarer = (c: Carer) => bearer(t.carerToken(c.accountId));
  const get = (user: { id: string }, path: string) => request(server()).get(path).set(as(user));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const patch = (user: { id: string }, path: string, body: Record<string, unknown>) =>
    request(server()).patch(path).set(as(user)).send(body);

  /** The carer works a visit of `hours` on `day` (local = UTC in these tests' winter dates). */
  const work = async (carer: Carer, day: string, hm: string, hours: number, miles?: number) => {
    const start = new Date(`${day}T${hm}:00Z`);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start, plannedMinutes: hours * 60 });
    clock.set(new Date(start.getTime() + 60_000));
    await request(server()).post(`/employee-app/visits/${visit.jobId}/check-in`).set(asCarer(carer)).send({});
    clock.set(new Date(start.getTime() + hours * 60 * 60_000));
    const done = await request(server()).post(`/employee-app/visits/${visit.jobId}/complete`).set(asCarer(carer)).send({ status: 'COMPLETED' });
    expect(done.status).toBe(201);
    const row = await t.prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visit.visitId } });
    expect(row.status).toBe('APPROVED_FOR_BOTH');
    if (miles != null) {
      expect((await patch(preparer, `/billing/visit-reconciliations/${row.id}`, { travelMiles: miles })).status).toBe(200);
    }
    return row.id;
  };
  const payRun = async (periodStart: string, periodEnd: string, lock = true) => {
    const created = await post(preparer, '/billing/payroll-runs', { periodStart, periodEnd });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await post(preparer, `/billing/payroll-runs/${id}/calculate`)).status).toBe(201);
    if (lock) {
      expect((await post(approver, `/billing/payroll-runs/${id}/approve`)).status).toBe(201);
      expect((await post(approver, `/billing/payroll-runs/${id}/lock`)).status).toBe(201);
    }
    return id;
  };
  const mileageLines = (payrollRunId: string, employeeId?: string) =>
    t.prisma.payrollRunLine.findMany({
      where: { payrollRunId, lineType: 'MILEAGE', ...(employeeId ? { employeeId } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { visitReconciliation: { select: { plannedStartDateTime: true } } },
    });
  const byVisitDate = <T extends { visitReconciliation: { plannedStartDateTime: Date } | null }>(lines: T[]) =>
    [...lines].sort((a, b) => a.visitReconciliation!.plannedStartDateTime.getTime() - b.visitReconciliation!.plannedStartDateTime.getTime());
  /** A UK payroll run through the application's own tax and NI calculation, closed by a second person. */
  const ukRun = async (periodStart: string, periodEnd: string, employeeIds: string[]) => {
    const id = await createUkRun(t.prisma, { periodStart, periodEnd, employeeIds, createdById: preparer.id });
    await giveTaxCode(t.prisma, employeeIds); // synthetic 1257L: tax is never calculated on a guessed code
    expect((await post(preparer, `/payroll/runs/${id}/calculate-gross`)).status).toBe(201);
    expect((await post(preparer, `/payroll/runs/${id}/calculate-statutory`)).status).toBe(201);
    expect((await post(approver, `/payroll/runs/${id}/close`)).status).toBe(201);
    return id;
  };
  const runEmployee = (runId: string, employeeId: string) =>
    t.prisma.ukPayrollRunEmployee.findFirstOrThrow({ where: { runId, employeeId } });
  const n = (value: unknown) => Number(value);
  /** A labelled synthetic rate for cars from a date. */
  const syntheticRate = (effectiveFrom: string, rateFirst: number, rateAfter: number, thresholdMiles: number) =>
    post(preparer, '/billing/mileage-rates', {
      effectiveFrom,
      vehicleType: 'CAR_VAN',
      rateFirst,
      rateAfter,
      thresholdMiles,
      passengerRate: 0.05,
      label: 'TEST synthetic — not a real rate',
      reason: 'Synthetic test rate, not a policy decision',
    });

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(new Date('2026-11-02T08:00:00Z'));
    await resetPayData(t.prisma);
    await t.prisma.payEvaluationFailure.deleteMany();
    await t.prisma.visitAttendanceEvent.deleteMany();
    await t.prisma.mileageRate.deleteMany({ where: { label: { startsWith: 'TEST' } } });
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma, 14);
    preparer = await createStaffUser(t.prisma, { permissions: PREPARE });
    approver = await createStaffUser(t.prisma, { permissions: APPROVE });
    reader = await createStaffUser(t.prisma, { permissions: ['billing.pay_cards.read'] });
  });
  afterEach(() => clock.restore());
  afterAll(async () => {
    await t.prisma.mileageRate.deleteMany({ where: { label: { startsWith: 'TEST' } } });
    await resetPayData(t.prisma);
    await t.close();
  });

  it('visit earnings £154.00 and mileage £3.41 stay apart all the way, and the mileage is paid once', async () => {
    const ann = await createCarer(t.prisma);
    const twin = await createCarer(t.prisma); // the same work, no mileage
    for (const carer of [ann, twin]) {
      await work(carer, '2026-11-03', '09:00', 8, carer === ann ? 6.2 : undefined);
      await work(carer, '2026-11-04', '09:00', 3);
    }
    clock.set(new Date('2026-11-09T09:00:00Z'));

    // The visit pay run: wages and mileage on separate lines; mileage is not part of gross pay.
    const run = await payRun('2026-11-02', '2026-11-08');
    const lines = await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: run, employeeId: ann.employeeId } });
    const visitPay = lines.filter((l) => l.lineType === 'VISIT_PAY').reduce((sum, l) => sum + n(l.amount), 0);
    expect(visitPay).toBe(154);
    const [mileage] = await mileageLines(run, ann.employeeId);
    expect(n(mileage.amount)).toBe(3.41); // 6.2 miles at the rate recorded for the period
    expect(n(mileage.quantity)).toBe(6.2);
    // Nobody has verified HMRC's approved amounts for the period, so the line does not claim to be tax-free.
    expect(mileage).toMatchObject({ taxTreatment: 'NOT_VERIFIED', taxFreeAmount: null, taxableAmount: null });
    const visitRun = await t.prisma.payrollRun.findUniqueOrThrow({ where: { id: run } });
    expect(n(visitRun.grossPay)).toBe(308); // two carers × £154; mileage is in expenseTotal
    expect(n(visitRun.expenseTotal)).toBe(3.41);

    // The UK payroll run, with the application's own tax and NI calculation.
    clock.set(new Date('2026-12-01T09:00:00Z'));
    const uk = await ukRun('2026-11-01', '2026-11-30', [ann.employeeId, twin.employeeId]);
    const annRow = await runEmployee(uk, ann.employeeId);
    const twinRow = await runEmployee(uk, twin.employeeId);
    expect(n(annRow.totalGross)).toBe(154);
    expect(n(annRow.expenseTotal)).toBe(3.41);
    expect(n(annRow.reimbursementPayable)).toBe(3.41);
    expect(n(annRow.expenseNotVerified)).toBe(3.41);
    // The mileage changed nothing in the taxable calculation: the twin has the same figures.
    for (const field of ['totalGross', 'taxablePay', 'incomeTax', 'employeeNi', 'netPay'] as const) {
      expect(n(annRow[field])).toBe(n(twinRow[field]));
    }
    expect(n(annRow.netPay)).toBeCloseTo(154 - n(annRow.incomeTax) - n(annRow.employeeNi), 2);
    expect(n(twinRow.reimbursementPayable)).toBe(0);
    const detail = await get(preparer, `/payroll/runs/${uk}`);
    const shown = detail.body.data.employees.find((e: { employeeId: string }) => e.employeeId === ann.employeeId);
    expect(shown).toMatchObject({ expenseTotal: 3.41, reimbursementPayable: 3.41, totalPayable: Math.round((n(annRow.netPay) + 3.41) * 100) / 100 });

    // The payout: net pay plus the reimbursement, each shown, the reimbursement included once.
    const batch = await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: uk });
    expect(batch.status).toBe(201);
    const annLine = batch.body.data.lines.find((l: { employeeId: string }) => l.employeeId === ann.employeeId);
    const twinLine = batch.body.data.lines.find((l: { employeeId: string }) => l.employeeId === twin.employeeId);
    expect(annLine).toMatchObject({ netPayValue: n(annRow.netPay), reimbursementValue: 3.41 });
    expect(annLine.amountValue).toBeCloseTo(n(annRow.netPay) + 3.41, 2);
    expect(twinLine).toMatchObject({ netPayValue: n(twinRow.netPay), reimbursementValue: 0, amountValue: n(twinRow.netPay) });
    expect(annLine.amountValue - twinLine.amountValue).toBeCloseTo(3.41, 2);
    // A second batch for the run finds nothing left: not the wages, not the mileage.
    expect((await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: uk })).status).toBe(409);
    expect((await post(approver, `/billing/employee-payouts/${batch.body.data.id}/approve`)).status).toBe(201);
    clock.set(new Date('2026-12-04T10:00:00Z'));
    const paid = await post(approver, `/billing/employee-payouts/${batch.body.data.id}/mark-paid`, {
      paymentReference: 'BACS-TEST-MILEAGE',
      settledOn: '2026-12-04',
      settlementEvidence: 'Synthetic statement line',
    });
    expect(paid.status).toBe(201);
    expect((await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: uk })).status).toBe(400); // nothing outstanding

    // Reconciliation: recorded = payable = in batches = recorded as paid; nothing outstanding.
    const recon = await get(preparer, `/billing/employee-payouts/reimbursements?ukPayrollRunId=${uk}`);
    expect(recon.status).toBe(200);
    expect(recon.body.data).toEqual([
      expect.objectContaining({
        employeeId: ann.employeeId,
        expenseTotal: 3.41,
        reimbursementPayable: 3.41,
        taxTreatmentNotVerified: 3.41,
        inPayoutBatches: 3.41,
        recordedAsPaid: 3.41,
        outstanding: 0,
        beforeReimbursementPayouts: false,
      }),
    ]);
    // Wages paid compared with net pay are still about wages.
    const totals = await t.prisma.employeePayoutLine.findMany({ where: { batchId: batch.body.data.id } });
    expect(totals.reduce((sum, l) => sum + n(l.reimbursementAmount), 0)).toBe(3.41);
  });

  it('a cancelled payout batch gives the reimbursement back, and the next batch carries it once', async () => {
    const ann = await createCarer(t.prisma);
    await work(ann, '2026-11-03', '09:00', 2, 10);
    clock.set(new Date('2026-11-09T09:00:00Z'));
    await payRun('2026-11-02', '2026-11-08');
    clock.set(new Date('2026-12-01T09:00:00Z'));
    const uk = await ukRun('2026-11-01', '2026-11-30', [ann.employeeId]);

    const first = await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: uk });
    expect(first.body.data.lines[0].reimbursementValue).toBe(5.5);
    expect((await post(preparer, `/billing/employee-payouts/${first.body.data.id}/cancel`, { reason: 'Synthetic: wrong date' })).status).toBe(201);
    const outstanding = await get(preparer, `/billing/employee-payouts/reimbursements?ukPayrollRunId=${uk}`);
    expect(outstanding.body.data[0]).toMatchObject({ inPayoutBatches: 0, outstanding: 5.5 });

    const second = await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: uk });
    expect(second.status).toBe(201);
    expect(second.body.data.lines[0].reimbursementValue).toBe(5.5);
    expect(second.body.data.lines[0].amountValue).toBe(first.body.data.lines[0].amountValue);
  });

  it('paid above the verified approved amount: the part above is taxed as pay, the rest is reimbursed tax-free', async () => {
    // Synthetic: the organisation pays 55p; a person records 45p as the approved amount.
    const created = await syntheticRate('2026-04-06', 0.55, 0.25, 10_000);
    expect(created.status).toBe(201);
    const verified = await patch(preparer, `/billing/mileage-rates/${created.body.data.id}/approved-amounts`, {
      approvedRateFirst: 0.45,
      approvedRateAfter: 0.25,
      approvedThresholdMiles: 10_000,
      approvedPassengerRate: 0.05,
      source: 'TEST synthetic — no real publication was consulted',
    });
    expect(verified.status).toBe(200);

    const ann = await createCarer(t.prisma);
    const twin = await createCarer(t.prisma);
    for (const carer of [ann, twin]) await work(carer, '2026-11-03', '09:00', 8, carer === ann ? 10 : undefined);
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const run = await payRun('2026-11-02', '2026-11-08');
    const [mileage] = await mileageLines(run, ann.employeeId);
    expect(mileage).toMatchObject({ taxTreatment: 'PART_TAXABLE' });
    expect([n(mileage.amount), n(mileage.taxFreeAmount), n(mileage.taxableAmount)]).toEqual([5.5, 4.5, 1]);

    clock.set(new Date('2026-12-01T09:00:00Z'));
    const uk = await ukRun('2026-11-01', '2026-11-30', [ann.employeeId, twin.employeeId]);
    const inputs = await t.prisma.ukPayrollInputLine.findMany({ where: { runId: uk, employeeId: ann.employeeId } });
    expect(inputs.map((l) => [l.lineType, n(l.amount), l.isExpense]).sort()).toEqual(
      [
        ['MILEAGE', 4.5, true],
        ['MILEAGE_TAXABLE', 1, false],
        ['VISIT_PAY', 112, false],
      ].sort(),
    );
    const annRow = await runEmployee(uk, ann.employeeId);
    const twinRow = await runEmployee(uk, twin.employeeId);
    // £1.00 above the approved amount is inside taxable pay; £4.50 is outside it.
    expect(n(annRow.totalGross)).toBe(113);
    expect(n(twinRow.totalGross)).toBe(112);
    expect(n(annRow.expenseTotal)).toBe(4.5);
    expect(n(annRow.reimbursementPayable)).toBe(4.5);
    expect(n(annRow.expenseNotVerified)).toBe(0);
    expect(n(annRow.taxablePay)).toBeGreaterThanOrEqual(n(twinRow.taxablePay));
    // What the carer receives in all is still the £5.50 claimed, less any tax and NI on the £1.00.
    const batch = await post(preparer, '/billing/employee-payouts', { ukPayrollRunId: uk });
    const annLine = batch.body.data.lines.find((l: { employeeId: string }) => l.employeeId === ann.employeeId);
    expect(annLine.reimbursementValue).toBe(4.5);
    expect(annLine.amountValue).toBeCloseTo(n(annRow.netPay) + 4.5, 2);
    expect(n(annRow.netPay)).toBeLessThanOrEqual(n(twinRow.netPay) + 1);
    expect(n(annRow.netPay)).toBeGreaterThanOrEqual(n(twinRow.netPay));
  });

  it('the year-to-date total: across runs, across the threshold inside one run, and from 6 April again', async () => {
    // Synthetic: 50p for the first 100 business miles of the tax year, 20p after.
    expect((await syntheticRate('2026-04-06', 0.5, 0.2, 100)).status).toBe(201);
    const ann = await createCarer(t.prisma);
    const other = await createCarer(t.prisma);

    await work(ann, '2026-11-03', '09:00', 1, 60);
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const first = await payRun('2026-11-02', '2026-11-08');
    expect((await mileageLines(first)).map((l) => n(l.amount))).toEqual([30]); // 60 × 50p

    // The next week: two journeys in one run. The second crosses the threshold part-way.
    await work(ann, '2026-11-10', '09:00', 1, 30);
    await work(ann, '2026-11-11', '09:00', 1, 30);
    await work(other, '2026-11-11', '13:00', 1, 30); // another carer has their own total
    clock.set(new Date('2026-11-16T09:00:00Z'));
    const second = await payRun('2026-11-09', '2026-11-15');
    const annLines = byVisitDate(await mileageLines(second, ann.employeeId));
    expect(annLines.map((l) => n(l.amount))).toEqual([15, 9]); // 30 × 50p; then 10 × 50p + 20 × 20p
    expect(annLines[1].description).toContain('10.00 mi × £0.50 + 20.00 mi × £0.20');
    expect((await mileageLines(second, other.employeeId)).map((l) => n(l.amount))).toEqual([15]);

    // Calculating the same open run again gives the same answer (nothing is counted twice).
    await work(ann, '2026-11-17', '09:00', 1, 10);
    clock.set(new Date('2026-11-23T09:00:00Z'));
    const third = await payRun('2026-11-16', '2026-11-22', false);
    expect((await mileageLines(third)).map((l) => n(l.amount))).toEqual([2]); // above the threshold: 10 × 20p
    expect((await post(preparer, `/billing/payroll-runs/${third}/calculate`)).status).toBe(201);
    expect((await mileageLines(third)).map((l) => n(l.amount))).toEqual([2]);

    // 5 April is still the old tax year; 6 April starts again from nothing.
    await work(ann, '2027-04-05', '09:00', 1, 10);
    await work(ann, '2027-04-06', '09:00', 1, 10);
    clock.set(new Date('2027-04-12T09:00:00Z'));
    const april = await payRun('2027-04-05', '2027-04-11', false);
    expect(byVisitDate(await mileageLines(april)).map((l) => n(l.amount))).toEqual([2, 5]);
  });

  it('a change of rate applies from its date; earlier journeys keep the rate of their day', async () => {
    expect((await syntheticRate('2026-11-10', 0.6, 0.6, 10_000)).status).toBe(201);
    const ann = await createCarer(t.prisma);
    await work(ann, '2026-11-09', '09:00', 1, 10);
    await work(ann, '2026-11-10', '09:00', 1, 10);
    clock.set(new Date('2026-11-16T09:00:00Z'));
    const run = await payRun('2026-11-09', '2026-11-15', false);
    expect(byVisitDate(await mileageLines(run)).map((l) => n(l.amount))).toEqual([5.5, 6]);
  });

  it('mileage corrected before the run is locked is recalculated; after the lock it cannot be changed in place', async () => {
    const ann = await createCarer(t.prisma);
    const row = await work(ann, '2026-11-03', '09:00', 1, 10);
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const run = await payRun('2026-11-02', '2026-11-08', false);
    expect((await mileageLines(run)).map((l) => [n(l.quantity), n(l.amount)])).toEqual([[10, 5.5]]);

    expect((await patch(preparer, `/billing/visit-reconciliations/${row}`, { travelMiles: 4 })).status).toBe(200);
    expect((await post(preparer, `/billing/payroll-runs/${run}/calculate`)).status).toBe(201);
    expect((await mileageLines(run)).map((l) => [n(l.quantity), n(l.amount)])).toEqual([[4, 2.2]]);
    // Removing the miles removes the line.
    expect((await patch(preparer, `/billing/visit-reconciliations/${row}`, { travelMiles: 0 })).status).toBe(200);
    expect((await post(preparer, `/billing/payroll-runs/${run}/calculate`)).status).toBe(201);
    expect(await mileageLines(run)).toHaveLength(0);

    expect((await patch(preparer, `/billing/visit-reconciliations/${row}`, { travelMiles: 4 })).status).toBe(200);
    expect((await post(preparer, `/billing/payroll-runs/${run}/calculate`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${run}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${run}/lock`)).status).toBe(201);
    const refused = await patch(preparer, `/billing/visit-reconciliations/${row}`, { travelMiles: 9 });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect((await mileageLines(run)).map((l) => n(l.amount))).toEqual([2.2]);
  });

  it('a deleted pay run gives its mileage back: the next run prices it once, from the same running total', async () => {
    expect((await syntheticRate('2026-04-06', 0.5, 0.2, 100)).status).toBe(201);
    const ann = await createCarer(t.prisma);
    await work(ann, '2026-11-03', '09:00', 1, 90);
    await work(ann, '2026-11-04', '09:00', 1, 20);
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const abandoned = await payRun('2026-11-02', '2026-11-08', false);
    expect(byVisitDate(await mileageLines(abandoned)).map((l) => n(l.amount))).toEqual([45, 7]); // 90 × 50p; 10 × 50p + 10 × 20p
    expect((await request(server()).delete(`/billing/payroll-runs/${abandoned}`).set(as(preparer))).status).toBe(200);

    const replacement = await payRun('2026-11-02', '2026-11-08');
    expect(byVisitDate(await mileageLines(replacement)).map((l) => n(l.amount))).toEqual([45, 7]);
    const keys = (await t.prisma.payrollRunLine.findMany({ where: { payrollRunId: replacement } })).map((l) => l.claimKey).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('miles with nothing to price them are an exception on the run, not a missing line', async () => {
    const ann = await createCarer(t.prisma);
    const cards = await t.prisma.payCard.findMany({ where: { code: { startsWith: 'TEST-' } } });
    await t.prisma.payCard.updateMany({ where: { id: { in: cards.map((c) => c.id) } }, data: { mileageVehicleType: 'PUBLIC_TRANSPORT' } });
    await work(ann, '2026-11-03', '09:00', 1, 12);
    clock.set(new Date('2026-11-09T09:00:00Z'));
    const run = await payRun('2026-11-02', '2026-11-08', false);
    const [line] = await mileageLines(run);
    expect(n(line.amount)).toBe(0);
    expect(line.exceptionMessage).toBe('No mileage rate is recorded for 2026-11-03 (public transport), and the pay card has no mileage rate.');
    expect((await t.prisma.payrollRun.findUniqueOrThrow({ where: { id: run } })).status).toBe('EXCEPTION_FOUND');
  });

  it('mileage rates are entered by people with permission, with a reason, and audited', async () => {
    const body = { effectiveFrom: '2027-04-06', vehicleType: 'CAR_VAN', rateFirst: 0.5, rateAfter: 0.2, thresholdMiles: 100, label: 'TEST synthetic', reason: 'Synthetic test rate, not a policy decision' };
    expect((await post(reader, '/billing/mileage-rates', body)).status).toBe(403);
    expect((await post(preparer, '/billing/mileage-rates', { ...body, reason: undefined })).status).toBe(400);
    expect((await post(preparer, '/billing/mileage-rates', { ...body, rateFirst: 55 })).status).toBe(400); // pence typed as pounds
    expect((await post(preparer, '/billing/mileage-rates', { ...body, thresholdMiles: undefined })).status).toBe(400); // two rates, no threshold
    const created = await post(preparer, '/billing/mileage-rates', body);
    expect(created.status).toBe(201);
    expect((await post(preparer, '/billing/mileage-rates', body)).status).toBe(409);

    const list = await get(reader, '/billing/mileage-rates');
    expect(list.status).toBe(200);
    const mine = list.body.data.find((r: { id: string }) => r.id === created.body.data.id);
    expect(mine).toMatchObject({ approvedAmountsVerified: false, approvedRateFirst: null });
    // The rates the application used before are there as the first period, not verified either.
    const first = list.body.data.find((r: { vehicleType: string; effectiveFrom: string }) => r.vehicleType === 'CAR_VAN' && r.effectiveFrom.startsWith('2000-04-06'));
    expect(first).toMatchObject({ approvedAmountsVerified: false });
    expect([Number(first.rateFirst), Number(first.rateAfter), first.thresholdMiles]).toEqual([0.55, 0.25, 10000]);

    expect((await patch(reader, `/billing/mileage-rates/${mine.id}/approved-amounts`, { approvedRateFirst: 0.45, source: 'TEST synthetic source' })).status).toBe(403);
    expect((await patch(preparer, `/billing/mileage-rates/${mine.id}/approved-amounts`, { approvedRateFirst: 0.45 })).status).toBe(400); // where was it checked?
    const verified = await patch(preparer, `/billing/mileage-rates/${mine.id}/approved-amounts`, { approvedRateFirst: 0.45, approvedRateAfter: 0.25, approvedThresholdMiles: 10000, source: 'TEST synthetic source' });
    expect(verified.status).toBe(200);
    expect(verified.body.data).toMatchObject({ approvedVerifiedById: preparer.id, approvedSource: 'TEST synthetic source' });
    const audits = await t.prisma.auditLog.findMany({ where: { recordType: 'MileageRate', recordId: mine.id }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((a) => a.action)).toEqual(['mileage_rate_created', 'mileage_approved_amounts_verified']);
    expect(audits[0].metadata).toMatchObject({ reason: 'Synthetic test rate, not a policy decision' });
  });
});
