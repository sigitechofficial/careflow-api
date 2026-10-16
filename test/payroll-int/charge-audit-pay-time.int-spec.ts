/**
 * Sprint B4E.
 *
 * Task 1 — a client charge entered by hand (`POST :id/billable-amount`) changed money and wrote no
 * audit entry at all. It is now saved together with an entry naming the visit, the old and new
 * amount, the user, the reason and the permission it was done under; a failed entry undoes it.
 *
 * Task 2 — an edit of a visit's payable time could be overridden by the pay rules (a visit within
 * the duration tolerance is paid its planned time) and still be answered as a plain success, with
 * an audit entry showing no change. The response now says what happened, with the payable time in
 * force; an edit that had no effect is recorded as such, not as a change. An office correction of
 * attendance times that leaves pay as it was says so too.
 *
 * All data is synthetic.
 */
import request from 'supertest';
import { AuditLogsService } from '../../src/audit-logs/audit-logs.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import { createRun, resetPayData, uuid } from './harness';
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

const ORG = 'payroll.scope.organisation';

describe('manual charge audit and payable-time edit outcomes (Sprint B4E)', () => {
  let t: TestApp;
  let audit: AuditLogsService;
  let clock: ReturnType<typeof useControlledClock>;
  let office: { id: string };
  let manager: { id: string };
  let reader: { id: string };

  const at = (hm: string, day = '2026-11-03') => new Date(`${day}T${hm}:00Z`);
  const server = () => t.app.getHttpServer();
  const as = (u: { id: string }) => bearer(t.staffToken(u.id));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const patch = (user: { id: string }, path: string, body: Record<string, unknown>) =>
    request(server()).patch(path).set(as(user)).send(body);
  const path = (id: string, action = '') => `/billing/visit-reconciliations/${id}${action ? `/${action}` : ''}`;
  const entries = (recordId: string, action: string) =>
    t.prisma.auditLog.findMany({ where: { recordId, action: action as never }, orderBy: { createdAt: 'asc' } });
  const breakAuditTable = () =>
    jest
      .spyOn(audit as unknown as { db: () => unknown }, 'db')
      .mockReturnValue({ auditLog: { create: () => Promise.reject(new Error('synthetic: audit table unavailable')) } });
  const state = async (id: string) => {
    const r = await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id } });
    return {
      status: r.status,
      approvedById: r.approvedById,
      approvalNotes: r.approvalNotes,
      payableAmount: r.payableAmount == null ? null : Number(r.payableAmount),
      payableMinutes: r.payableMinutes,
      approvedPayStart: r.approvedPayStart?.toISOString() ?? null,
      approvedPayEnd: r.approvedPayEnd?.toISOString() ?? null,
      billableAmount: r.billableAmount == null ? null : Number(r.billableAmount),
    };
  };
  /** A visit 09:00 to 10:00, checked in at 09:01 and completed at 10:00 by the carer. */
  const workedVisit = async () => {
    const carer = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
    const asCarer = () => bearer(t.carerToken(carer.accountId));
    clock.set(at('09:01'));
    expect((await request(server()).post(`/employee-app/visits/${visit.jobId}/check-in`).set(asCarer()).send({})).status).toBe(201);
    clock.set(at('10:00'));
    expect((await request(server()).post(`/employee-app/visits/${visit.jobId}/complete`).set(asCarer()).send({ status: 'COMPLETED' })).status).toBe(201);
    const row = await t.prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visit.visitId, employeeId: carer.employeeId } });
    return { carer, jobId: visit.jobId, id: row.id };
  };
  const officeTime = (jobId: string, employeeId: string, when: Date) =>
    request(server())
      .post(`/ecm/visits/${jobId}/manual-attendance`)
      .set(as(office))
      .send({ employeeId, eventType: 'CHECK_OUT', occurredAt: when.toISOString(), reasonCode: 'VERIFIED_WITH_CLIENT', note: 'Synthetic: confirmed by phone' });
  const settle = async () => {
    const maker = await createStaffUser(t.prisma, { permissions: [] });
    const checker = await createStaffUser(t.prisma, { permissions: [] });
    const runs = t.app.get(PayrollRunsService);
    clock.set(at('09:00', '2026-11-09'));
    const run = await createRun(runs, maker.id, '2026-11-01', '2026-11-07');
    await runs.calculate(run);
    await runs.approve(checker.id, run);
    await runs.lock(checker.id, run);
    return run;
  };

  beforeAll(async () => {
    t = await createTestApp();
    audit = t.app.get(AuditLogsService, { strict: false });
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(at('08:00'));
    await resetPayData(t.prisma);
    await t.prisma.visitAttendanceEvent.deleteMany();
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma);
    office = await createStaffUser(t.prisma, { roleName: 'Super Admin' });
    manager = await createStaffUser(t.prisma, { permissions: ['billing.visit_reconciliations.read', 'billing.visit_reconciliations.manage', ORG] });
    reader = await createStaffUser(t.prisma, { permissions: ['billing.visit_reconciliations.read', ORG] });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clock.restore();
  });
  afterAll(async () => {
    await t.close();
  });

  // ------------------------------------------------------------------ Task 1
  describe('a client charge entered by hand', () => {
    const CHARGE = { billableAmount: 32, notes: 'Synthetic: agreed with the funder' };

    it('is saved with an audit entry: visit, old and new amount, user, reason and permission', async () => {
      const { id } = await workedVisit();
      const before = await state(id);
      const res = await post(manager, path(id, 'billable-amount'), CHARGE);
      expect(res.status).toBe(201);
      expect(await state(id)).toMatchObject({ billableAmount: 32 });
      const [entry] = await entries(id, 'visit_reconciliation_billable_amount_set');
      expect(entry).toMatchObject({ userId: manager.id, recordType: 'VisitReconciliation', description: CHARGE.notes, status: 'SUCCESS' });
      expect(entry.createdAt).toBeInstanceOf(Date);
      expect(entry.oldValues).toMatchObject({ billableAmount: before.billableAmount == null ? null : before.billableAmount.toFixed(2) });
      expect(entry.newValues).toMatchObject({ billableAmount: '32.00', permission: 'billing.visit_reconciliations.manage' });
      expect(entry.metadata).toMatchObject({ visitRef: expect.stringMatching(/^VIS-/) });
    });

    it('the audit entry cannot be written: the charge is not changed, and the API carries on', async () => {
      const { id } = await workedVisit();
      const before = await state(id);
      breakAuditTable();
      const refused = await post(manager, path(id, 'billable-amount'), CHARGE);
      expect(refused.status).toBe(500);
      expect(refused.body.message).toBe('The change was not saved because its audit entry could not be written. Try again.');
      expect(await state(id)).toEqual(before); // amount, status, approver and notes
      expect(await entries(id, 'visit_reconciliation_billable_amount_set')).toEqual([]);
      jest.restoreAllMocks();
      expect((await request(server()).get(path(id)).set(as(manager))).status).toBe(200);
      expect((await post(manager, path(id, 'billable-amount'), CHARGE)).status).toBe(201);
    });

    it('sending the same charge again changes nothing and records nothing twice', async () => {
      const { id } = await workedVisit();
      expect((await post(manager, path(id, 'billable-amount'), CHARGE)).status).toBe(201);
      const once = await state(id);
      expect((await post(manager, path(id, 'billable-amount'), CHARGE)).status).toBe(201);
      expect(await state(id)).toEqual(once); // the note is not added a second time
      expect(await entries(id, 'visit_reconciliation_billable_amount_set')).toHaveLength(1);
      // A different amount is a new change.
      expect((await post(manager, path(id, 'billable-amount'), { billableAmount: 30 })).status).toBe(201);
      expect(await entries(id, 'visit_reconciliation_billable_amount_set')).toHaveLength(2);
    });

    it('needs the permission and a live account; a user gone at write time is refused and nothing changes', async () => {
      const { id } = await workedVisit();
      const before = await state(id);
      expect((await post(reader, path(id, 'billable-amount'), CHARGE)).status).toBe(403);
      const gone = await createStaffUser(t.prisma, { permissions: ['billing.visit_reconciliations.manage', ORG] });
      const token = t.staffToken(gone.id);
      await t.prisma.userRole.deleteMany({ where: { userId: gone.id } });
      await t.prisma.user.delete({ where: { id: gone.id } });
      expect((await request(server()).post(path(id, 'billable-amount')).set(bearer(token)).send(CHARGE)).status).toBe(401);
      const service = t.app.get(VisitReconciliationsService, { strict: false });
      await expect(service.setBillableAmount(uuid(), id, CHARGE as never)).rejects.toMatchObject({ status: 401 });
      expect(await state(id)).toEqual(before);
    });

    it('carer pay that is settled is not touched by a charge change', async () => {
      const { id } = await workedVisit();
      const run = await settle();
      const lines = () => t.prisma.payrollRunLine.findMany({ where: { payrollRunId: run }, orderBy: { id: 'asc' }, select: { id: true, amount: true, claimKey: true } });
      const paidLines = await lines();
      const before = await state(id);
      expect((await post(manager, path(id, 'billable-amount'), CHARGE)).status).toBe(201);
      const after = await state(id);
      expect(after.billableAmount).toBe(32);
      expect({ ...after, billableAmount: null, approvalNotes: null, status: null, approvedById: null }).toEqual({
        ...before,
        billableAmount: null,
        approvalNotes: null,
        status: null,
        approvedById: null,
      });
      expect(await lines()).toEqual(paidLines);
    });

    it('invoice protections are as before: a locked visit or one in an invoice run is refused', async () => {
      const { id } = await workedVisit();
      const invoiceRun = await t.prisma.invoiceRun.create({
        data: { periodLabel: 'Synthetic invoice run', periodStart: new Date('2026-11-01'), periodEnd: new Date('2026-11-30') } as never,
      });
      try {
        await t.prisma.visitReconciliation.update({ where: { id }, data: { includedInInvoiceRunId: invoiceRun.id } });
        const inRun = await post(manager, path(id, 'billable-amount'), CHARGE);
        expect(inRun.status).toBe(400);
        expect(inRun.body.message).toMatch(/already included in an invoice run/);
        await t.prisma.visitReconciliation.update({ where: { id }, data: { includedInInvoiceRunId: null, status: 'LOCKED' } });
        expect((await post(manager, path(id, 'billable-amount'), CHARGE)).status).toBe(400);
        expect(await entries(id, 'visit_reconciliation_billable_amount_set')).toEqual([]);
      } finally {
        await t.prisma.visitReconciliation.update({ where: { id }, data: { includedInInvoiceRunId: null } });
        await t.prisma.invoiceRun.delete({ where: { id: invoiceRun.id } });
      }
    });
  });

  // ------------------------------------------------------------------ Task 2
  describe('an edit of the payable time', () => {
    it('within the duration tolerance: not applied, and the answer says so with the payable time in force', async () => {
      const { id } = await workedVisit(); // 59 minutes worked of 60 planned: paid the planned hour
      const before = await state(id);
      const res = await patch(manager, path(id), { approvedPayEnd: at('09:31').toISOString(), approvalNotes: 'Synthetic: left early' });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(
        /^Payable time not changed\. The visit is within the duration tolerance of \d+ minutes, so it is paid its planned time\. It stays 09:00–10:00 \(60 min\)\.$/,
      );
      expect(res.body.data.payTimeEdit).toMatchObject({
        outcome: 'PAY_TIME_NOT_APPLIED',
        rule: 'DURATION_TOLERANCE',
        requested: { end: at('09:31').toISOString() },
        effective: { start: at('09:00').toISOString(), end: at('10:00').toISOString(), payableMinutes: 60 },
      });
      // Pay is exactly as it was, and no entry calls this a change.
      expect(await state(id)).toMatchObject({
        payableAmount: before.payableAmount,
        payableMinutes: before.payableMinutes,
        approvedPayStart: before.approvedPayStart,
        approvedPayEnd: before.approvedPayEnd,
      });
      expect(await entries(id, 'visit_reconciliation_updated')).toEqual([]);
      const [attempt] = await entries(id, 'visit_pay_time_edit_not_applied');
      expect(attempt).toMatchObject({ userId: manager.id });
      expect(attempt.newValues).toMatchObject({ rule: 'DURATION_TOLERANCE', requested: { end: at('09:31').toISOString() } });
    });

    it('outside the tolerance the edit takes effect: changed, repriced and audited as a change', async () => {
      const { carer, jobId, id } = await workedVisit();
      // The office confirms the carer left at 09:30: draft pay is repriced (existing correction).
      const corrected = await officeTime(jobId, carer.employeeId, at('09:30'));
      expect(corrected.body.data.pay).toMatchObject([{ outcome: 'REPRICED' }]);
      const before = await state(id);
      expect(before.payableMinutes).toBe(29);

      const res = await patch(manager, path(id), { approvedPayEnd: at('09:45').toISOString() });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/^Payable time changed to 09:01–09:45 \(44 min\)\. Carer pay is now £\d+\.\d\d\.$/);
      expect(res.body.data.payTimeEdit).toMatchObject({ outcome: 'PAY_TIME_CHANGED', rule: null });
      const after = await state(id);
      expect(after).toMatchObject({ approvedPayEnd: at('09:45').toISOString(), payableMinutes: 44 });
      expect(after.payableAmount).toBeGreaterThan(before.payableAmount as number);
      expect(res.body.message).toContain(`£${(after.payableAmount as number).toFixed(2)}`); // minutes and amount agree
      const [entry] = await entries(id, 'visit_reconciliation_updated');
      expect(entry.newValues).toMatchObject({ payTimeOutcome: 'PAY_TIME_CHANGED', payableMinutes: 44 });
      expect(entry.oldValues).toMatchObject({ payableMinutes: 29 });
      expect(await entries(id, 'visit_pay_time_edit_not_applied')).toEqual([]);

      // The same edit again: already in force, nothing recorded.
      const again = await patch(manager, path(id), { approvedPayEnd: at('09:45').toISOString() });
      expect(again.body.data.payTimeEdit.outcome).toBe('PAY_TIME_UNCHANGED');
      expect(again.body.message).toBe('Payable time is already 09:01–09:45 (44 min): nothing changed.');
      expect(await entries(id, 'visit_reconciliation_updated')).toHaveLength(1);
    });

    it('a corrected attendance time that leaves pay as it was says so: evidence recorded, pay unchanged', async () => {
      const { carer, jobId, id } = await workedVisit();
      const before = await state(id);
      const res = await officeTime(jobId, carer.employeeId, at('09:50')); // 49 of 60 minutes: still within the tolerance
      expect(res.status).toBe(201);
      expect(res.body.data.pay).toMatchObject([{ outcome: 'PAY_UNCHANGED', payableBefore: String(before.payableAmount) }]);
      expect(res.body.data.pay[0].message).toMatch(
        /^Times updated\. Carer pay is unchanged: The visit is within the duration tolerance of \d+ minutes, so it is paid its planned time\. Payable time stays 09:00–10:00 \(60 min\)\.$/,
      );
      expect(await state(id)).toMatchObject({ payableAmount: before.payableAmount, payableMinutes: before.payableMinutes });
      const [entry] = await entries(id, 'visit_attendance_times_corrected');
      expect(entry.newValues).toMatchObject({ outcome: 'PAY_UNCHANGED', actualEndDateTime: at('09:50').toISOString() });
    });

    it('locked or settled pay cannot be rewritten: the edit is refused and nothing is recorded', async () => {
      const { id } = await workedVisit();
      await settle();
      const before = await state(id);
      const settled = await patch(manager, path(id), { approvedPayEnd: at('09:31').toISOString() });
      expect(settled.status).toBe(400);
      expect(await state(id)).toEqual(before);
      await t.prisma.visitReconciliation.update({ where: { id }, data: { status: 'LOCKED' } });
      expect((await patch(manager, path(id), { approvedPayEnd: at('09:31').toISOString() })).status).toBe(400);
      expect(await entries(id, 'visit_reconciliation_updated')).toEqual([]);
      expect(await entries(id, 'visit_pay_time_edit_not_applied')).toEqual([]);
    });

    it('other edits are answered as before: no payable-time outcome is added', async () => {
      const { id } = await workedVisit();
      const res = await patch(manager, path(id), { travelMiles: 6.2 });
      expect(res.status).toBe(200);
      expect(res.body.data.payTimeEdit).toBeUndefined();
      expect(res.body.data.id).toBe(id);
    });
  });
});
