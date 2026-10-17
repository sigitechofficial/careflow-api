/**
 * Sprint B4C, Task 2 — two more financial paths write their audit entry with the change.
 *
 * Before: a decision on a carer's pay for a visit (approve, reject, decide an overrun) and a
 * change to an employee's payroll profile (tax code, NI category, bank details) were saved first
 * and audited afterwards. If the audit entry could not be written, the change stayed and nothing
 * recorded who made it.
 *
 * Now each is one transaction: the change, the amounts it produces and the audit entry are saved
 * together or not at all. A failed audit write is answered with a controlled error, the API stays
 * up, and trying again leaves one audit entry, not two.
 *
 * All data is synthetic.
 */
import request from 'supertest';
import { AuditLogsService } from '../../src/audit-logs/audit-logs.service';
import { PayrollEmployeesService } from '../../src/payroll/payroll-employees.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import { resetPayData, uuid } from './harness';
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

describe('audit entries are saved with the change: visit pay decisions and payroll profiles (Sprint B4C)', () => {
  let t: TestApp;
  let audit: AuditLogsService;
  let clock: ReturnType<typeof useControlledClock>;
  let manager: { id: string };
  let reader: { id: string };

  const at = (hm: string, day = '2026-11-03') => new Date(`${day}T${hm}:00Z`);
  const server = () => t.app.getHttpServer();
  const as = (u: { id: string }) => bearer(t.staffToken(u.id));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const entries = (recordId: string, action: string) =>
    t.prisma.auditLog.findMany({ where: { recordId, action: action as never }, orderBy: { createdAt: 'asc' } });
  /** The real audit service, with a database client whose audit table cannot be written. */
  const breakAuditTable = () =>
    jest
      .spyOn(audit as unknown as { db: () => unknown }, 'db')
      .mockReturnValue({ auditLog: { create: () => Promise.reject(new Error('synthetic: audit table unavailable')) } });
  const NOT_SAVED = 'The change was not saved because its audit entry could not be written. Try again.';

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
    manager = await createStaffUser(t.prisma, {
      permissions: [
        'billing.visit_reconciliations.read',
        'billing.visit_reconciliations.manage',
        'payroll.employees.read',
        'payroll.employees.manage',
        'payroll.scope.organisation',
      ],
    });
    reader = await createStaffUser(t.prisma, {
      permissions: ['billing.visit_reconciliations.read', 'payroll.employees.read', 'payroll.scope.organisation'],
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clock.restore();
  });
  afterAll(async () => {
    await t.close();
  });

  describe('a decision on the pay of a visit', () => {
    /** A visit 09:00 to 10:00, worked and completed by the carer. */
    const workedVisit = async () => {
      const carer = await createCarer(t.prisma);
      const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
      const asCarer = () => bearer(t.carerToken(carer.accountId));
      clock.set(at('09:01'));
      expect((await request(server()).post(`/employee-app/visits/${visit.jobId}/check-in`).set(asCarer()).send({})).status).toBe(201);
      clock.set(at('10:00'));
      const completed = await request(server()).post(`/employee-app/visits/${visit.jobId}/complete`).set(asCarer()).send({ status: 'COMPLETED' });
      expect(completed.status).toBe(201);
      const row = await t.prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visit.visitId, employeeId: carer.employeeId } });
      return { carer, id: row.id };
    };
    const state = async (id: string) => {
      const r = await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id } });
      return {
        status: r.status,
        approvedById: r.approvedById,
        approvalNotes: r.approvalNotes,
        payableAmount: r.payableAmount?.toString() ?? null,
        payableMinutes: r.payableMinutes,
        approvedPayEnd: r.approvedPayEnd?.toISOString() ?? null,
        overrunDecision: r.overrunDecision,
      };
    };
    const path = (id: string, action: string) => `/billing/visit-reconciliations/${id}/${action}`;

    it('a rejection and an approval are each saved with their audit entry, naming the user', async () => {
      const { id } = await workedVisit();
      expect((await post(manager, path(id, 'reject'), { scope: 'PAY', approvalNotes: 'Synthetic: times disputed' })).status).toBe(201);
      expect(await state(id)).toMatchObject({ status: 'REJECTED_FOR_PAY', approvedById: manager.id });
      expect(await entries(id, 'visit_reconciliation_rejected')).toEqual([expect.objectContaining({ userId: manager.id, status: 'SUCCESS' })]);

      expect((await post(manager, path(id, 'approve'), { scope: 'PAY', approvalNotes: 'Synthetic: times confirmed' })).status).toBe(201);
      expect(await state(id)).toMatchObject({ status: 'APPROVED_FOR_PAY', approvedById: manager.id });
      const [approved] = await entries(id, 'visit_reconciliation_approved');
      expect(approved).toMatchObject({ userId: manager.id, description: 'Synthetic: times confirmed' });
      expect(approved.newValues).toMatchObject({ status: 'APPROVED_FOR_PAY', scope: 'PAY' });
    });

    it('the audit entry cannot be written: the approval is rolled back, and trying again leaves one entry', async () => {
      const { id } = await workedVisit();
      await post(manager, path(id, 'reject'), { scope: 'PAY', approvalNotes: 'Synthetic: times disputed' });
      const before = await state(id);

      breakAuditTable();
      const refused = await post(manager, path(id, 'approve'), { scope: 'PAY', approvalNotes: 'Synthetic: times confirmed' });
      expect(refused.status).toBe(500);
      expect(refused.body.message).toBe(NOT_SAVED);
      expect(await state(id)).toEqual(before); // status, approver, notes, amounts: as they were
      expect(await entries(id, 'visit_reconciliation_approved')).toEqual([]);

      // The API is up; the same request now succeeds and is recorded once.
      jest.restoreAllMocks();
      expect((await request(server()).get(`/billing/visit-reconciliations/${id}`).set(as(manager))).status).toBe(200);
      expect((await post(manager, path(id, 'approve'), { scope: 'PAY', approvalNotes: 'Synthetic: times confirmed' })).status).toBe(201);
      expect((await state(id)).status).toBe('APPROVED_FOR_PAY');
      expect(await entries(id, 'visit_reconciliation_approved')).toHaveLength(1);
    });

    it('the audit entry cannot be written: a rejection is rolled back', async () => {
      const { id } = await workedVisit();
      const before = await state(id);
      breakAuditTable();
      const refused = await post(manager, path(id, 'reject'), { scope: 'PAY', approvalNotes: 'Synthetic: times disputed' });
      expect(refused.status).toBe(500);
      expect(await state(id)).toEqual(before);
      expect(await entries(id, 'visit_reconciliation_rejected')).toEqual([]);
    });

    it('an overrun decision reprices the visit and is audited in one step: a failed entry undoes both', async () => {
      const { id } = await workedVisit();
      // Synthetic: the visit ran 40 minutes over its planned hour and the overrun awaits a decision.
      await t.prisma.visitReconciliation.update({
        where: { id },
        data: { actualEndDateTime: at('10:40'), overrunMinutes: 40, overrunDecision: 'PENDING', status: 'PENDING_REVIEW' },
      });
      const before = await state(id);

      breakAuditTable();
      const refused = await post(manager, path(id, 'overrun/approve'), { timeBasis: 'ACTUAL', applyTo: 'PAY', notes: 'Synthetic: client asked the carer to stay' });
      expect(refused.status).toBe(500);
      expect(await state(id)).toEqual(before); // the decision, the pay window and the amount
      expect(await entries(id, 'visit_reconciliation_overrun_decided')).toEqual([]);

      jest.restoreAllMocks();
      expect((await post(manager, path(id, 'overrun/approve'), { timeBasis: 'ACTUAL', applyTo: 'PAY', notes: 'Synthetic: client asked the carer to stay' })).status).toBe(201);
      const after = await state(id);
      expect(after).toMatchObject({ overrunDecision: 'APPROVED', approvedById: manager.id, approvedPayEnd: at('10:40').toISOString() });
      expect(after.approvedPayEnd).not.toBe(before.approvedPayEnd);
      const [entry] = await entries(id, 'visit_reconciliation_overrun_decided');
      expect(entry).toMatchObject({ userId: manager.id });
      expect(entry.newValues).toMatchObject({ decision: 'APPROVED', timeBasis: 'ACTUAL', applyTo: 'PAY' });
      expect(await entries(id, 'visit_reconciliation_overrun_decided')).toHaveLength(1);
    });

    it('a deleted user and a user without the permission change nothing', async () => {
      const { id } = await workedVisit();
      const before = await state(id);
      // No permission to decide pay.
      expect((await post(reader, path(id, 'reject'), { scope: 'PAY' })).status).toBe(403);
      // A session left over from a deleted account.
      const gone = await createStaffUser(t.prisma, { permissions: ['billing.visit_reconciliations.manage', 'payroll.scope.organisation'] });
      const token = t.staffToken(gone.id);
      await t.prisma.userRole.deleteMany({ where: { userId: gone.id } });
      await t.prisma.user.delete({ where: { id: gone.id } });
      expect((await request(server()).post(path(id, 'reject')).set(bearer(token)).send({ scope: 'PAY' })).status).toBe(401);
      // The account disappears after the request was admitted: a controlled error, and a rollback.
      const service = t.app.get(VisitReconciliationsService, { strict: false });
      await expect(service.reject(uuid(), id, { scope: 'PAY' } as never)).rejects.toMatchObject({ status: 401 });
      expect(await state(id)).toEqual(before);
      expect(await entries(id, 'visit_reconciliation_rejected')).toEqual([]);
      // The next valid request works.
      expect((await post(manager, path(id, 'reject'), { scope: 'PAY', approvalNotes: 'Synthetic: times disputed' })).status).toBe(201);
    });
  });

  describe('an employee payroll profile', () => {
    const put = (user: { id: string }, employeeId: string, body: Record<string, unknown>) =>
      request(server()).put(`/payroll/employees/${employeeId}/profile`).set(as(user)).send(body);
    const profile = (employeeId: string) => t.prisma.employeePayrollProfile.findFirst({ where: { employeeId, deletedAt: null } });

    it('creating and changing a profile are each saved with their audit entry', async () => {
      const { employeeId } = await createCarer(t.prisma);
      expect((await put(manager, employeeId, { taxCode: '1257L', niCategory: 'A' })).status).toBe(200);
      const created = await profile(employeeId);
      expect(created).toMatchObject({ taxCode: '1257L', niCategory: 'A', createdById: manager.id });
      expect(await entries(created!.id, 'payroll_employee_profile_created')).toEqual([expect.objectContaining({ userId: manager.id })]);

      expect((await put(manager, employeeId, { taxCode: 'BR' })).status).toBe(200);
      expect((await profile(employeeId))?.taxCode).toBe('BR');
      const [updated] = await entries(created!.id, 'payroll_employee_profile_updated');
      expect(updated).toMatchObject({ userId: manager.id });
      expect(updated.oldValues).toMatchObject({ taxCode: '1257L' });
      expect(updated.newValues).toMatchObject({ taxCode: 'BR' });
    });

    it('the audit entry cannot be written: the change is rolled back, and trying again leaves one entry', async () => {
      const { employeeId } = await createCarer(t.prisma);
      await put(manager, employeeId, { taxCode: '1257L', niCategory: 'A' });
      const before = await profile(employeeId);

      breakAuditTable();
      const refused = await put(manager, employeeId, { taxCode: 'BR', bankSortCode: '00-00-00', bankAccountNumber: '00000000' });
      expect(refused.status).toBe(500);
      expect(refused.body.message).toBe(NOT_SAVED);
      expect(await profile(employeeId)).toEqual(before); // tax code and bank details as they were
      expect(await entries(before!.id, 'payroll_employee_profile_updated')).toEqual([]);

      jest.restoreAllMocks();
      expect((await request(server()).get(`/payroll/employees/${employeeId}/profile`).set(as(manager))).status).toBe(200);
      expect((await put(manager, employeeId, { taxCode: 'BR' })).status).toBe(200);
      expect((await profile(employeeId))?.taxCode).toBe('BR');
      expect(await entries(before!.id, 'payroll_employee_profile_updated')).toHaveLength(1);
    });

    it('the audit entry cannot be written: no profile is created', async () => {
      const { employeeId } = await createCarer(t.prisma);
      breakAuditTable();
      expect((await put(manager, employeeId, { taxCode: '1257L', niCategory: 'A' })).status).toBe(500);
      expect(await profile(employeeId)).toBeNull();
    });

    it('a deleted user and a user without the permission change nothing', async () => {
      const { employeeId } = await createCarer(t.prisma);
      await put(manager, employeeId, { taxCode: '1257L', niCategory: 'A' });
      const before = await profile(employeeId);
      expect((await put(reader, employeeId, { taxCode: 'BR' })).status).toBe(403);
      const gone = await createStaffUser(t.prisma, { permissions: ['payroll.employees.manage', 'payroll.scope.organisation'] });
      const token = t.staffToken(gone.id);
      await t.prisma.userRole.deleteMany({ where: { userId: gone.id } });
      await t.prisma.user.delete({ where: { id: gone.id } });
      expect((await request(server()).put(`/payroll/employees/${employeeId}/profile`).set(bearer(token)).send({ taxCode: 'BR' })).status).toBe(401);
      const service = t.app.get(PayrollEmployeesService, { strict: false });
      await expect(service.upsertProfile(uuid(), employeeId, { taxCode: 'BR' } as never)).rejects.toMatchObject({ status: 401 });
      expect(await profile(employeeId)).toEqual(before);
      expect((await put(manager, employeeId, { taxCode: 'BR' })).status).toBe(200);
    });
  });
});
