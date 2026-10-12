/**
 * Gate A sprint — one synthetic month, end to end, through the real application.
 *
 * Dataset: two branches; two carers (one per branch) and a salaried worker; a payroll preparer, a
 * second preparer, an approver and a branch manager; normal, double-up and overnight visits; a
 * mileage claim; a pay card rate change; a cancelled UK payroll run and its replacement; a
 * supplementary run; a pay correction and its reversal.
 *
 * The steps run in order and share that month. HTTP is used wherever an endpoint exists; the tax
 * and NI calculation is replaced by a stand-in (net pay is set by hand), because statutory payroll
 * is outside Gate A. Scenario ids (E2E-nn) are those of docs/…/09-end-to-end-validation.md.
 */
import request from 'supertest';
import { PayrollRunLineType } from '@prisma/client';
import { EmployeePayoutsService } from '../../src/billing/employee-payouts.service';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';
import { createUkRun, markStatutoryCalculated, resetPayData } from './harness';
import {
  bearer,
  createAllocatedVisit,
  createBranch,
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
  'payroll.runs.reopen',
  'payroll.scope.organisation',
];

describe('Gate A end to end: one synthetic month', () => {
  let t: TestApp;
  let clock: ReturnType<typeof useControlledClock>;
  let ukRuns: UkPayrollRunsService;
  let payouts: EmployeePayoutsService;

  // People.
  let office: { id: string };
  let preparer: { id: string };
  let preparer2: { id: string };
  let approver: { id: string };
  let managerA: { id: string };
  let ann: { employeeId: string; accountId: string };
  let ben: { employeeId: string; accountId: string };
  let sam: string;
  let payCardId: string;

  // What the month produces.
  const visits: Record<string, { jobId: string; visitId: string }> = {};
  const rows: Record<string, string> = {};
  let run1: string;
  let ukReplacement: string;
  let correctionId: string;

  const at = (day: string, hm: string) => new Date(`${day}T${hm}:00Z`); // November is GMT: local = UTC
  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const asCarer = (carer: { accountId: string }) => bearer(t.carerToken(carer.accountId));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const get = (user: { id: string }, path: string) => request(server()).get(path).set(as(user));
  const checkIn = (carer: { accountId: string }, jobId: string) =>
    request(server()).post(`/employee-app/visits/${jobId}/check-in`).set(asCarer(carer)).send({});
  const complete = (carer: { accountId: string }, jobId: string, body: Record<string, unknown> = {}) =>
    request(server()).post(`/employee-app/visits/${jobId}/complete`).set(asCarer(carer)).send({ status: 'COMPLETED', ...body });
  const rowOf = (visitId: string, employeeId: string) =>
    t.prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visitId, employeeId }, include: { exceptions: true } });
  const linesOf = (payrollRunId: string) =>
    t.prisma.payrollRunLine.findMany({ where: { payrollRunId }, orderBy: [{ lineType: 'asc' }, { amount: 'asc' }] });
  const amounts = (lines: Array<{ lineType: string; amount: unknown; employeeId: string | null }>, type: string, employeeId?: string) =>
    lines.filter((l) => l.lineType === type && (!employeeId || l.employeeId === employeeId)).map((l) => Number(l.amount));
  const lockRun = async (run: string) => {
    expect((await post(approver, `/billing/payroll-runs/${run}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${run}/lock`)).status).toBe(201);
  };
  const newRun = async (periodStart: string, periodEnd: string) => {
    const created = await post(preparer, '/billing/payroll-runs', { periodStart, periodEnd });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await post(preparer, `/billing/payroll-runs/${id}/calculate`)).status).toBe(201);
    return id;
  };
  const earningRow = async (reconciliationId: string, employeeId: string) => {
    const res = await get(preparer, `/billing/payroll-runs/employee/${employeeId}/earnings?dateFrom=2026-11-01&dateTo=2026-11-30`);
    expect(res.status).toBe(200);
    return res.body.data.visits.find((v: { id: string }) => v.id === reconciliationId);
  };

  beforeAll(async () => {
    t = await createTestApp();
    ukRuns = t.app.get(UkPayrollRunsService);
    payouts = t.app.get(EmployeePayoutsService);
    clock = useControlledClock(at('2026-11-03', '08:00'));

    await resetPayData(t.prisma);
    await t.prisma.visitAttendanceEvent.deleteMany();
    await resetIdentityData(t.prisma);
    payCardId = (await seedDefaultCards(t.prisma, 14)).payCardId;

    const branchA = await createBranch(t.prisma, 'TEST Branch A');
    const branchB = await createBranch(t.prisma, 'TEST Branch B');
    office = await createStaffUser(t.prisma, { roleName: 'Super Admin' });
    preparer = await createStaffUser(t.prisma, { permissions: PREPARE });
    preparer2 = await createStaffUser(t.prisma, { permissions: PREPARE });
    approver = await createStaffUser(t.prisma, { permissions: APPROVE });
    managerA = await createStaffUser(t.prisma, {
      permissions: ['billing.payroll_runs.read', 'billing.visit_reconciliations.read', 'payroll.runs.read'],
      locationIds: [branchA],
    });
    ann = await createCarer(t.prisma, { locationId: branchA });
    ben = await createCarer(t.prisma, { locationId: branchB });
    sam = (await createCarer(t.prisma, { locationId: branchA })).employeeId;
    await t.prisma.employeePayAgreement.create({
      data: { employeeId: sam, basis: 'SALARIED', annualSalary: 36525, effectiveFrom: new Date('2026-01-01'), status: 'ACTIVE' } as never,
    });
  }, 240_000);
  afterAll(async () => {
    clock.restore();
    await t.close();
  });

  it('E2E-01: a normal visit completed in the carer app becomes one approved earning', async () => {
    const visit = await createAllocatedVisit(t.prisma, { carers: [ann.employeeId], start: at('2026-11-03', '09:00') });
    visits.normal = visit;
    clock.set(at('2026-11-03', '09:01'));
    expect((await checkIn(ann, visit.jobId)).status).toBe(201);
    clock.set(at('2026-11-03', '10:00'));
    expect((await complete(ann, visit.jobId)).status).toBe(201);

    const row = await rowOf(visit.visitId, ann.employeeId);
    rows.normal = row.id;
    expect(row).toMatchObject({ status: 'APPROVED_FOR_BOTH', payableMinutes: 60 });
    expect(Number(row.payableAmount)).toBe(14);
    expect(await t.prisma.visitReconciliation.count({ where: { scheduledVisitId: visit.visitId } })).toBe(1);
  });

  it('E2E-05 / E2E-07 / E2E-06: double-up — an altered time holds that carer only; the office verifies it', async () => {
    const visit = await createAllocatedVisit(t.prisma, { carers: [ann.employeeId, ben.employeeId], start: at('2026-11-04', '09:00') });
    visits.doubleUp = visit;
    clock.set(at('2026-11-04', '09:01'));
    await checkIn(ann, visit.jobId);
    await checkIn(ben, visit.jobId);
    // Ben's app says he left at 10:00; the completion reaches the server at 10:40.
    clock.set(at('2026-11-04', '10:00'));
    expect((await complete(ann, visit.jobId)).status).toBe(201);
    clock.set(at('2026-11-04', '10:40'));
    expect((await complete(ben, visit.jobId, { actualEndDateTime: at('2026-11-04', '10:00').toISOString() })).status).toBe(201);

    const annRow = await rowOf(visit.visitId, ann.employeeId);
    const benHeld = await rowOf(visit.visitId, ben.employeeId);
    rows.doubleUpAnn = annRow.id;
    rows.doubleUpBen = benHeld.id;
    expect(annRow.status).toBe('APPROVED_FOR_BOTH');
    expect(benHeld.status).toBe('PENDING_REVIEW');
    expect(benHeld.exceptions.map((e) => e.code)).toContain('UNVERIFIED_TIMES');

    // The office confirms Ben's finish. What the app sent stays on record as evidence.
    const verified = await post(office, `/ecm/visits/${visit.jobId}/manual-attendance`, {
      employeeId: ben.employeeId,
      eventType: 'CHECK_OUT',
      occurredAt: at('2026-11-04', '10:00').toISOString(),
      reasonCode: 'VERIFIED_WITH_CLIENT',
      note: 'Confirmed by phone',
    });
    expect(verified.status).toBe(201);
    const benRow = await rowOf(visit.visitId, ben.employeeId);
    expect(benRow.exceptions.map((e) => e.code)).not.toContain('UNVERIFIED_TIMES');
    if (benRow.status !== 'APPROVED_FOR_BOTH' && benRow.status !== 'APPROVED_FOR_PAY') {
      expect((await post(preparer, `/billing/visit-reconciliations/${benRow.id}/approve`, { scope: 'BOTH' })).status).toBe(201);
    }
    expect(Number((await rowOf(visit.visitId, ben.employeeId)).payableAmount)).toBe(14);
    expect(Number((await rowOf(visit.visitId, ann.employeeId)).payableAmount)).toBe(14);
    expect(
      await t.prisma.visitAttendanceEvent.count({ where: { scheduledJobId: visit.jobId, employeeId: ben.employeeId } }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('an overnight visit is paid for every hour across midnight', async () => {
    const visit = await createAllocatedVisit(t.prisma, { carers: [ann.employeeId], start: at('2026-11-05', '22:00'), plannedMinutes: 480 });
    visits.overnight = visit;
    clock.set(at('2026-11-05', '22:01'));
    expect((await checkIn(ann, visit.jobId)).status).toBe(201);
    clock.set(at('2026-11-06', '06:00'));
    expect((await complete(ann, visit.jobId)).status).toBe(201);

    const row = await rowOf(visit.visitId, ann.employeeId);
    rows.overnight = row.id;
    expect(row.payableMinutes).toBe(480);
    expect(Number(row.payableAmount)).toBe(112); // 8h × £14
    if (row.status !== 'APPROVED_FOR_BOTH') {
      expect((await post(preparer, `/billing/visit-reconciliations/${row.id}/approve`, { scope: 'BOTH' })).status).toBe(201);
    }
  });

  it('a mileage claim is recorded against the visit', async () => {
    const saved = await request(server())
      .patch(`/billing/visit-reconciliations/${rows.normal}`)
      .set(as(preparer))
      .send({ travelMiles: 6.2 });
    expect(saved.status).toBe(200);
    expect(Number((await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id: rows.normal } })).travelMiles)).toBe(6.2);
  });

  it('E2E-10 / E2E-16 / E2E-02: the pay run — recalculated without duplicates, approved by a second person, claimed once', async () => {
    clock.set(at('2026-11-09', '09:00'));
    run1 = await newRun('2026-11-01', '2026-11-07');
    const first = await linesOf(run1);
    expect(amounts(first, 'VISIT_PAY', ann.employeeId).sort((a, b) => a - b)).toEqual([14, 14, 112]);
    expect(amounts(first, 'VISIT_PAY', ben.employeeId)).toEqual([14]);
    expect(amounts(first, 'MILEAGE')).toEqual([3.41]); // 6.2 miles × 55p (UK approved rate)

    // Recalculating an open run replaces its lines; nothing is claimed twice.
    expect((await post(preparer, `/billing/payroll-runs/${run1}/calculate`)).status).toBe(201);
    const again = await linesOf(run1);
    expect(again).toHaveLength(first.length);
    const keys = again.map((l) => l.claimKey).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);

    // The person who prepared the run cannot approve it.
    expect((await post(preparer, `/billing/payroll-runs/${run1}/approve`)).status).toBe(403);
    expect((await post(approver, `/billing/payroll-runs/${run1}/approve`)).status).toBe(201);
    // Recalculating an approved run withdraws the approval: it cannot be locked on a stale approval.
    expect((await post(preparer, `/billing/payroll-runs/${run1}/calculate`)).status).toBe(201);
    expect((await post(approver, `/billing/payroll-runs/${run1}/lock`)).status).toBe(400);
    await lockRun(run1);

    // A second run over the same dates finds nothing left to pay.
    const overlap = await newRun('2026-11-01', '2026-11-07');
    expect(await linesOf(overlap)).toHaveLength(0);
    expect(
      await t.prisma.payrollRunLine.count({ where: { visitReconciliationId: rows.normal, lineType: PayrollRunLineType.VISIT_PAY } }),
    ).toBe(1);
    expect((await request(server()).delete(`/billing/payroll-runs/${overlap}`).set(as(preparer))).status).toBe(200);
  });

  it('E2E-03 / E2E-17: a cancelled UK payroll run gives its earnings back; the replacement collects them once', async () => {
    clock.set(at('2026-12-01', '09:00'));
    const november = { periodStart: '2026-11-01', periodEnd: '2026-11-30', employeeIds: [ann.employeeId, ben.employeeId, sam], createdById: preparer.id };
    const agreement = await t.prisma.employeePayAgreement.findFirstOrThrow({ where: { employeeId: sam } });
    const enrolSalary = (runId: string) =>
      t.prisma.ukPayrollRunEmployee.updateMany({ where: { runId, employeeId: sam }, data: { payAgreementId: agreement.id } });

    const first = await createUkRun(t.prisma, november);
    await enrolSalary(first);
    expect((await post(preparer, `/payroll/runs/${first}/calculate-gross`)).status).toBe(201);
    const collected = await t.prisma.ukPayrollInputLine.findMany({ where: { runId: first } });
    const total = (lines: Array<{ amount: unknown }>) => Math.round(lines.reduce((s, l) => s + Number(l.amount), 0) * 100) / 100;
    // Visit pay 154 + mileage 3.41 + salary 3,000 (30 days of £36,525 a year).
    expect(total(collected)).toBe(3157.41);

    expect((await post(preparer, `/payroll/runs/${first}/cancel`, { reason: 'Wrong enrolment' })).status).toBe(201);
    expect(await t.prisma.ukPayrollInputLine.count({ where: { runId: first, claimKey: { not: null } } })).toBe(0);
    expect(await t.prisma.ukPayrollInputLine.count({ where: { runId: first } })).toBe(collected.length); // snapshot kept

    // The replacement is a second run of the same pay period.
    const base = await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: first } });
    const replacement = await t.prisma.ukPayrollRun.create({
      data: {
        periodId: base.periodId,
        taxYearId: base.taxYearId,
        scheduleId: base.scheduleId,
        runNumber: 2,
        label: 'TEST November (replacement)',
        status: 'EMPLOYEES_ENROLLED',
        employeeCount: 3,
        createdById: preparer.id,
        employees: { create: [{ employeeId: ann.employeeId }, { employeeId: ben.employeeId }, { employeeId: sam, payAgreementId: agreement.id }] },
      },
    });
    ukReplacement = replacement.id;
    expect((await post(preparer, `/payroll/runs/${ukReplacement}/calculate-gross`)).status).toBe(201);
    const recollected = await t.prisma.ukPayrollInputLine.findMany({ where: { runId: ukReplacement } });
    expect(total(recollected)).toBe(3157.41);
    const liveKeys = recollected.map((l) => l.claimKey).filter(Boolean);
    expect(new Set(liveKeys).size).toBe(liveKeys.length);

    // Stand-in for tax and NI, then close: not by the person who created the run.
    await markStatutoryCalculated(t.prisma, ukReplacement);
    for (const employee of await t.prisma.ukPayrollRunEmployee.findMany({ where: { runId: ukReplacement } })) {
      await t.prisma.ukPayrollRunEmployee.update({ where: { id: employee.id }, data: { netPay: employee.totalGross } });
    }
    expect((await post(preparer, `/payroll/runs/${ukReplacement}/close`)).status).toBe(403);
    expect((await post(approver, `/payroll/runs/${ukReplacement}/close`)).status).toBe(201);
    expect((await post(preparer, `/payroll/runs/${ukReplacement}/cancel`, { reason: 'Too late' })).status).toBe(400);
  });

  it('E2E-11 / E2E-12: the scheduled payout proposes a draft; paying needs approval and evidence', async () => {
    clock.set(at('2026-12-04', '06:00'));
    await payouts.executeAutomaticMonthlyPayout();
    const batches = await t.prisma.employeePayoutBatch.findMany({ where: { ukPayrollRunId: ukReplacement } });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ status: 'DRAFT', paidAt: null, approvedAt: null, paymentReference: null });
    const batch = batches[0].id;

    expect((await post(preparer, `/billing/employee-payouts/${batch}/approve`)).status).toBe(403);
    expect((await post(approver, `/billing/employee-payouts/${batch}/mark-paid`, { paymentReference: 'BACS-TEST-1', settledOn: '2026-12-04' })).status).toBe(400);
    expect((await post(approver, `/billing/employee-payouts/${batch}/approve`)).status).toBe(201);
    expect((await post(approver, `/billing/employee-payouts/${batch}/mark-paid`, {})).status).toBe(400);
    const paid = await post(approver, `/billing/employee-payouts/${batch}/mark-paid`, {
      paymentReference: 'BACS-TEST-1',
      settledOn: '2026-12-04',
      settlementEvidence: 'Synthetic statement line 1',
    });
    expect(paid.status).toBe(201);
    expect(paid.body.data).toMatchObject({ status: 'PAID', paymentState: 'MANUALLY_RECORDED', settlementConfirmed: false });

    expect(await earningRow(rows.normal, ann.employeeId)).toMatchObject({ earningStage: 'PAYMENT_RECORDED', paySettled: true });
  });

  it('a pay card rate change prices later visits at the new rate and leaves paid visits alone', async () => {
    const changed = await request(server())
      .patch(`/billing/pay-cards/${payCardId}`)
      .set(as(preparer))
      .send({
        rules: [{ label: 'Any day', dayType: 'ANY', rateType: 'HOURLY', amount: 15 }],
        versionEffectiveFrom: '2026-11-16',
        versionNote: 'Annual uplift',
      });
    expect(changed.status).toBe(200);

    const visit = await createAllocatedVisit(t.prisma, { carers: [ben.employeeId], start: at('2026-11-17', '09:00') });
    visits.afterUplift = visit;
    clock.set(at('2026-11-17', '09:01'));
    expect((await checkIn(ben, visit.jobId)).status).toBe(201);
    clock.set(at('2026-11-17', '10:00'));
    expect((await complete(ben, visit.jobId)).status).toBe(201);
    const row = await rowOf(visit.visitId, ben.employeeId);
    rows.afterUplift = row.id;
    expect(Number(row.payableAmount)).toBe(15);
    expect(Number((await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id: rows.normal } })).payableAmount)).toBe(14);
  });

  it('E2E-04: a paid visit is corrected by an adjustment in a supplementary run; history is not rewritten', async () => {
    clock.set(at('2026-12-07', '09:00'));
    // Direct edits are refused once the pay is settled.
    expect((await post(preparer, `/billing/visit-reconciliations/${rows.normal}/payable-amount`, { payableAmount: 21 })).status).toBe(400);

    const recorded = await post(preparer, '/billing/pay-items/visit-corrections', {
      visitReconciliationId: rows.normal,
      correctedAmount: 21,
      reason: 'Visit ran 30 minutes longer than paid',
    });
    expect(recorded.status).toBe(201);
    correctionId = recorded.body.data.id;
    expect((await post(preparer, `/billing/pay-items/${correctionId}/approve`)).status).toBe(403); // own entry
    expect((await post(preparer2, `/billing/pay-items/${correctionId}/approve`)).status).toBe(201);

    // Supplementary visit pay run: the new visit at the new rate, and the adjustment.
    const supplementary = await newRun('2026-11-01', '2026-11-30');
    const lines = await linesOf(supplementary);
    expect(amounts(lines, 'VISIT_PAY')).toEqual([15]);
    expect(lines.filter((l) => l.employeePayItemId === correctionId).map((l) => Number(l.amount))).toEqual([7]);
    expect(lines).toHaveLength(2);
    await lockRun(supplementary);

    const original = await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id: rows.normal } });
    expect(Number(original.payableAmount)).toBe(14);
    expect(original.includedInPayrollRunId).toBe(run1);
    const history = await get(preparer, `/billing/pay-items/visit-corrections/${rows.normal}`);
    expect(history.body.data).toMatchObject({ originalAmount: '14.00', netAmount: '21.00', differenceAmount: '7.00' });
    expect(history.body.data.items[0]).toMatchObject({ displayStatus: 'SETTLED', canReverse: true });

    // Supplementary UK run in the same pay period: only what has not been processed yet.
    const base = await t.prisma.ukPayrollRun.findUniqueOrThrow({ where: { id: ukReplacement } });
    const agreement = await t.prisma.employeePayAgreement.findFirstOrThrow({ where: { employeeId: sam } });
    const uk = await t.prisma.ukPayrollRun.create({
      data: {
        periodId: base.periodId,
        taxYearId: base.taxYearId,
        scheduleId: base.scheduleId,
        runNumber: 3,
        label: 'TEST November (supplementary)',
        status: 'EMPLOYEES_ENROLLED',
        employeeCount: 3,
        createdById: preparer.id,
        employees: { create: [{ employeeId: ann.employeeId }, { employeeId: ben.employeeId }, { employeeId: sam, payAgreementId: agreement.id }] },
      },
    });
    expect((await post(preparer, `/payroll/runs/${uk.id}/calculate-gross`)).status).toBe(201);
    const inputs = await t.prisma.ukPayrollInputLine.findMany({ where: { runId: uk.id } });
    expect(inputs.map((l) => Number(l.amount)).sort((a, b) => a - b)).toEqual([7, 15]);
    expect(inputs.some((l) => l.lineType === 'SALARY')).toBe(false); // the salary was paid by the replacement run
  });

  it('E2E-18: reversing the correction is one compensating adjustment, once', async () => {
    const reversed = await post(preparer, `/billing/pay-items/${correctionId}/reverse`, { reason: 'Timesheet was right after all' });
    expect(reversed.status).toBe(201);
    const reversalId = reversed.body.data.id as string;
    expect((await post(preparer, `/billing/pay-items/${correctionId}/reverse`, { reason: 'Timesheet was right after all' })).status).toBe(400);
    expect((await post(preparer, `/billing/pay-items/${reversalId}/approve`)).status).toBe(403);
    expect((await post(preparer2, `/billing/pay-items/${reversalId}/approve`)).status).toBe(201);

    const next = await newRun('2026-11-01', '2026-11-30');
    const lines = await linesOf(next);
    expect(lines.map((l) => Number(l.amount))).toEqual([-7]);
    await lockRun(next);

    const history = await get(preparer, `/billing/pay-items/visit-corrections/${rows.normal}`);
    expect(history.body.data).toMatchObject({ originalAmount: '14.00', netAmount: '14.00', differenceAmount: '0.00' });
    expect(history.body.data.items.map((i: { displayStatus: string }) => i.displayStatus)).toEqual(['REVERSED', 'SETTLED']);
    expect((await post(preparer, `/billing/pay-items/${reversalId}/reverse`, { reason: 'Reverse the reversal' })).status).toBe(400);
  });

  it('E2E-13: the client charge of the paid visit is corrected; its pay is untouched', async () => {
    const before = await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id: rows.normal } });
    const charged = await post(preparer, `/billing/visit-reconciliations/${rows.normal}/billable-amount`, { billableAmount: 30, notes: 'Agreed with funder' });
    expect(charged.status).toBe(201);
    const after = await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id: rows.normal } });
    expect(Number(after.billableAmount)).toBe(30);
    expect(Number(after.payableAmount)).toBe(Number(before.payableAmount));
    expect(after.payableMinutes).toBe(before.payableMinutes);
    expect(after.includedInPayrollRunId).toBe(run1);
  });

  it('E2E-08 / E2E-09: pay data is closed to the unauthenticated, to the other branch and to other carers', async () => {
    const earnings = (employeeId: string) => `/billing/payroll-runs/employee/${employeeId}/earnings`;
    expect((await request(server()).get(earnings(ann.employeeId))).status).toBe(401);
    expect((await request(server()).get('/billing/payroll-runs')).status).toBe(401);
    // Branch A's manager sees Ann (branch A), not Ben (branch B), and no organisation-wide run.
    expect((await get(managerA, earnings(ann.employeeId))).status).toBe(200);
    expect((await get(managerA, earnings(ben.employeeId))).status).toBe(404);
    expect((await get(managerA, '/billing/payroll-runs')).status).toBe(403);
    expect((await get(managerA, `/billing/payroll-runs/${run1}`)).status).toBe(403);
    expect((await get(managerA, '/payroll/runs')).status).toBe(403);
    // A carer reads their own salary, never a colleague's.
    expect((await request(server()).get('/employee-app/me/salary').set(asCarer(ben))).status).toBe(200);
    expect((await request(server()).get(earnings(ann.employeeId)).set(asCarer(ben))).status).toBe(403);
    // A Super Admin without the approval role prepares but does not approve.
    expect((await post(office, `/billing/payroll-runs/${run1}/approve`)).status).toBe(403);
  });

  it('the month adds up: every earning is an original once, and the statuses say where it is', async () => {
    // One original visit pay line per carer per visit across all locked runs.
    const locked = await t.prisma.payrollRunLine.findMany({
      where: { lineType: PayrollRunLineType.VISIT_PAY, payrollRun: { status: { in: ['LOCKED', 'EXPORTED'] } } },
    });
    const perVisit = new Map<string, number>();
    for (const l of locked) perVisit.set(l.visitReconciliationId!, (perVisit.get(l.visitReconciliationId!) ?? 0) + 1);
    expect([...perVisit.values()].every((n) => n === 1)).toBe(true);
    expect(perVisit.size).toBe(5); // normal, double-up × 2, overnight, after the uplift

    // Carer totals from locked runs: Ann 14 + 14 + 112 + 3.41 + 7 − 7; Ben 14 + 15.
    const sum = async (employeeId: string) =>
      Math.round(
        (await t.prisma.payrollRunLine.findMany({ where: { employeeId, payrollRun: { status: { in: ['LOCKED', 'EXPORTED'] } } } })).reduce(
          (s, l) => s + Number(l.amount),
          0,
        ) * 100,
      ) / 100;
    expect(await sum(ann.employeeId)).toBe(143.41);
    expect(await sum(ben.employeeId)).toBe(29);

    // No claim key is held twice anywhere.
    for (const table of ['"billing"."PayrollRunLine"', '"payroll"."UkPayrollInputLine"']) {
      const duplicates = await t.prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT COUNT(*)::int AS n FROM (SELECT "claimKey" FROM ${table} WHERE "claimKey" IS NOT NULL GROUP BY "claimKey" HAVING COUNT(*) > 1) d`,
      );
      expect(duplicates[0].n).toBe(0);
    }

    expect(await earningRow(rows.normal, ann.employeeId)).toMatchObject({
      earningStage: 'PAYMENT_RECORDED',
      correctionState: 'ADJUSTED',
      correctionAdjustmentValue: 0,
      payableAmountValue: 14,
    });
    expect(await earningRow(rows.afterUplift, ben.employeeId)).toMatchObject({ earningStage: 'IN_OPEN_UK_RUN', paySettled: true });
    expect(await earningRow(rows.doubleUpBen, ben.employeeId)).toMatchObject({ earningStage: 'PAYMENT_RECORDED' });
  });
});
