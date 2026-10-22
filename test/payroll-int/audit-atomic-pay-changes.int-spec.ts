/**
 * Sprint B4D — pay agreements (B4C-01) and the remaining changes to the pay of a visit (B4C-02)
 * are saved with their audit entry.
 *
 * Before: a pay agreement was created, approved or changed in one transaction and audited after
 * it; a time edit, a manually entered amount, an attendance correction, a withdrawn approval and a
 * recalculation changed the pay of a visit first and wrote their audit entry afterwards. A failed
 * entry left the change in place with nothing to say who made it.
 *
 * Now each is one transaction, including the repricing it triggers and, for a settled visit, the
 * pay correction recorded by the pay items service. A failed entry undoes all of it, is answered
 * with a controlled error, and trying again does not record anything twice.
 *
 * All data is synthetic.
 */
import request from 'supertest';
import { AuditLogsService } from '../../src/audit-logs/audit-logs.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { createRun, resetPayData } from './harness';
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

describe('audit entries are saved with the change: pay agreements and visit pay changes (Sprint B4D)', () => {
  let t: TestApp;
  let audit: AuditLogsService;
  let clock: ReturnType<typeof useControlledClock>;

  const at = (hm: string, day = '2026-11-03') => new Date(`${day}T${hm}:00Z`);
  const server = () => t.app.getHttpServer();
  const as = (u: { id: string }) => bearer(t.staffToken(u.id));
  const post = (user: { id: string }, path: string, body: Record<string, unknown> = {}) =>
    request(server()).post(path).set(as(user)).send(body);
  const patch = (user: { id: string }, path: string, body: Record<string, unknown>) =>
    request(server()).patch(path).set(as(user)).send(body);
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
    // The built-in roles outlive every test: none of them may hold the approval power here.
    await t.prisma.rolePermission.deleteMany({
      where: { permission: { key: 'payroll.pay_agreements.approve' }, role: { name: { not: { startsWith: 'TEST ' } } } },
    });
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(at('08:00'));
    await resetPayData(t.prisma);
    await t.prisma.visitAttendanceEvent.deleteMany();
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clock.restore();
  });
  afterAll(async () => {
    await t.close();
  });

  // ------------------------------------------------------------------ Task 1: pay agreements
  describe('a pay agreement', () => {
    let officer: { id: string };
    let approver: { id: string };
    let employeeId: string;
    const SALARY = {
      basis: 'SALARIED',
      effectiveFrom: '2026-11-01',
      salaryEntryPeriod: 'MONTHLY',
      salaryEntryAmount: 2000,
      salaryProrationMethod: 'EQUAL_PERIODS_CALENDAR_DAYS',
      salaryCoverage: 'ALL_VISIT_WORK',
    };
    const create = (body: Record<string, unknown> = SALARY) => post(officer, `/payroll/employees/${employeeId}/pay-agreements`, body);
    const agreements = () => t.prisma.employeePayAgreement.findMany({ where: { employeeId }, orderBy: { effectiveFrom: 'asc' } });
    const facts = async () =>
      (await agreements()).map((a) => ({
        id: a.id,
        status: a.status,
        annualSalary: a.annualSalary == null ? null : Number(a.annualSalary),
        contractedHours: a.contractedHours == null ? null : Number(a.contractedHours),
        effectiveFrom: a.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: a.effectiveTo?.toISOString().slice(0, 10) ?? null,
        approvedById: a.approvedById,
        updatedById: a.updatedById,
      }));

    beforeEach(async () => {
      officer = await createStaffUser(t.prisma, { permissions: ['payroll.employees.read', 'payroll.employees.manage', ORG] });
      approver = await createStaffUser(t.prisma, { permissions: ['payroll.employees.read', 'payroll.pay_agreements.approve', ORG] });
      employeeId = (await createCarer(t.prisma)).employeeId;
      await setHours(37.5);
    });
    // Contracted weekly hours are entered on the employee's record; agreements and terms copy them.
    const setHours = (hours: number | null) =>
      t.prisma.employeeEmployment.updateMany({ where: { employeeId }, data: { contractedWeeklyHours: hours } });

    it('creating, approving, replacing and changing an agreement are each saved with their audit entry', async () => {
      const created = await create();
      expect(created.status).toBe(201);
      const first = created.body.data.id as string;
      expect(await entries(first, 'payroll_pay_agreement_created')).toEqual([expect.objectContaining({ userId: officer.id })]);

      expect((await post(approver, `/payroll/pay-agreements/${first}/approve`)).status).toBe(201);
      const [approved] = await entries(first, 'payroll_pay_agreement_approved');
      expect(approved).toMatchObject({ userId: approver.id });
      expect(approved.oldValues).toMatchObject({ status: 'DRAFT' });
      expect(approved.newValues).toMatchObject({ status: 'ACTIVE', annualSalary: 24000 });

      // A draft is changed before approval; then it replaces the first from its start date.
      const second = (await create({ ...SALARY, effectiveFrom: '2027-01-01', salaryEntryAmount: 2100 })).body.data.id as string;
      expect((await patch(officer, `/payroll/pay-agreements/${second}`, { salaryEntryAmount: 2200 })).status).toBe(200);
      const [changed] = await entries(second, 'payroll_pay_agreement_updated');
      expect(changed.oldValues).toMatchObject({ annualSalary: 25200 });
      expect(changed.newValues).toMatchObject({ annualSalary: 26400 });
      expect((await post(approver, `/payroll/pay-agreements/${second}/approve`)).status).toBe(201);
      expect(await facts()).toEqual([
        expect.objectContaining({ id: first, annualSalary: 24000, effectiveFrom: '2026-11-01', contractedHours: 37.5 }),
        expect.objectContaining({ id: second, status: 'ACTIVE', annualSalary: 26400, effectiveFrom: '2027-01-01', approvedById: approver.id }),
      ]);
      expect(await entries(second, 'payroll_pay_agreement_approved')).toHaveLength(1);
    });

    it('the audit entry cannot be written: no agreement is created, and trying again creates one, once', async () => {
      breakAuditTable();
      const refused = await create();
      expect(refused.status).toBe(500);
      expect(refused.body.message).toBe(NOT_SAVED);
      expect(await agreements()).toEqual([]);

      jest.restoreAllMocks();
      const created = await create();
      expect(created.status).toBe(201);
      expect(await agreements()).toHaveLength(1);
      expect(await entries(created.body.data.id, 'payroll_pay_agreement_created')).toHaveLength(1);
    });

    it('the audit entry cannot be written: the approval is rolled back, and the agreement it would replace stays in effect', async () => {
      const first = (await create()).body.data.id as string;
      await post(approver, `/payroll/pay-agreements/${first}/approve`);
      const second = (await create({ ...SALARY, effectiveFrom: '2026-11-01', salaryEntryAmount: 1800 })).body.data.id as string;
      const before = await facts();
      expect(before.map((a) => a.status).sort()).toEqual(['ACTIVE', 'DRAFT']);

      breakAuditTable();
      const refused = await post(approver, `/payroll/pay-agreements/${second}/approve`);
      expect(refused.status).toBe(500);
      expect(refused.body.message).toBe(NOT_SAVED);
      expect(await facts()).toEqual(before); // not approved; the first is not superseded
      expect(await entries(second, 'payroll_pay_agreement_approved')).toEqual([]);

      // Trying again approves it once; a third request has nothing left to approve.
      jest.restoreAllMocks();
      expect((await post(approver, `/payroll/pay-agreements/${second}/approve`)).status).toBe(201);
      const after = await facts();
      expect(after.find((a) => a.id === second)).toMatchObject({ status: 'ACTIVE', approvedById: approver.id, annualSalary: 21600 });
      expect(after.find((a) => a.id === first)?.status).toBe('SUPERSEDED');
      expect((await post(approver, `/payroll/pay-agreements/${second}/approve`)).status).toBe(400);
      expect(await entries(second, 'payroll_pay_agreement_approved')).toHaveLength(1);
      expect(await agreements()).toHaveLength(2);
    });

    it('the audit entry cannot be written: a change to an agreement is rolled back', async () => {
      const id = (await create()).body.data.id as string;
      const before = await facts();
      await setHours(40); // a draft takes the employee's hours again when it is saved
      breakAuditTable();
      const refused = await patch(officer, `/payroll/pay-agreements/${id}`, { salaryEntryAmount: 2500 });
      expect(refused.status).toBe(500);
      expect(await facts()).toEqual(before); // salary and weekly hours as they were
      expect(await entries(id, 'payroll_pay_agreement_updated')).toEqual([]);

      jest.restoreAllMocks();
      expect((await patch(officer, `/payroll/pay-agreements/${id}`, { salaryEntryAmount: 2500 })).status).toBe(200);
      expect((await facts())[0]).toMatchObject({ annualSalary: 30000, contractedHours: 40 });
      expect(await entries(id, 'payroll_pay_agreement_updated')).toHaveLength(1);
    });

    it('maker/checker and permissions are as before: no self-approval, no approval without the power', async () => {
      const id = (await create()).body.data.id as string;
      expect((await post(officer, `/payroll/pay-agreements/${id}/approve`)).status).toBe(403); // no approval power
      const both = await createStaffUser(t.prisma, { permissions: ['payroll.employees.read', 'payroll.employees.manage', 'payroll.pay_agreements.approve', ORG] });
      expect((await patch(both, `/payroll/pay-agreements/${id}`, { salaryEntryAmount: 2100 })).status).toBe(200);
      const own = await post(both, `/payroll/pay-agreements/${id}/approve`);
      expect(own.status).toBe(403);
      expect(own.body.message).toMatch(/approved by a different person/);
      expect((await facts())[0]).toMatchObject({ status: 'DRAFT', approvedById: null });
      expect((await patch(approver, `/payroll/pay-agreements/${id}`, { salaryEntryAmount: 9000 })).status).toBe(403); // cannot edit
    });
  });

  // ------------------------------------------------------------------ Task 2: the pay of a visit
  describe('a change to the pay of a visit', () => {
    let office: { id: string };
    let manager: { id: string };

    /** A visit 09:00 to 10:00, worked and completed by the carer: one hour at £14.00. */
    const workedVisit = async () => {
      const carer = await createCarer(t.prisma);
      const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
      const asCarer = () => bearer(t.carerToken(carer.accountId));
      clock.set(at('09:01'));
      expect((await request(server()).post(`/employee-app/visits/${visit.jobId}/check-in`).set(asCarer()).send({})).status).toBe(201);
      clock.set(at('10:00'));
      expect((await request(server()).post(`/employee-app/visits/${visit.jobId}/complete`).set(asCarer()).send({ status: 'COMPLETED' })).status).toBe(201);
      const row = await t.prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visit.visitId, employeeId: carer.employeeId } });
      return { carer, jobId: visit.jobId, visitId: visit.visitId, id: row.id };
    };
    const state = async (id: string) => {
      const r = await t.prisma.visitReconciliation.findUniqueOrThrow({ where: { id } });
      return {
        status: r.status,
        approvedById: r.approvedById,
        approvalSource: r.approvalSource,
        approvalNotes: r.approvalNotes,
        payableAmount: r.payableAmount == null ? null : Number(r.payableAmount),
        payableMinutes: r.payableMinutes,
        approvedPayEnd: r.approvedPayEnd?.toISOString() ?? null,
        travelMinutes: r.travelMinutes,
        includedInPayrollRunId: r.includedInPayrollRunId,
      };
    };
    const path = (id: string, action = '') => `/billing/visit-reconciliations/${id}${action ? `/${action}` : ''}`;
    const officeTime = (jobId: string, employeeId: string, when: Date) =>
      request(server())
        .post(`/ecm/visits/${jobId}/manual-attendance`)
        .set(as(office))
        .send({ employeeId, eventType: 'CHECK_OUT', occurredAt: when.toISOString(), reasonCode: 'VERIFIED_WITH_CLIENT', note: 'Synthetic: confirmed by phone' });
    const visitEnd = async (visitId: string) => (await t.prisma.scheduledVisit.findUniqueOrThrow({ where: { id: visitId } })).actualEndDateTime?.toISOString();
    /** The visit's pay locked in a visit pay run. */
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

    beforeEach(async () => {
      office = await createStaffUser(t.prisma, { roleName: 'Super Admin' });
      manager = await createStaffUser(t.prisma, {
        permissions: ['billing.visit_reconciliations.read', 'billing.visit_reconciliations.manage', ORG],
      });
    });

    it('a correction to payable time is re-evaluated and audited in one step; a failed entry undoes both', async () => {
      const { id } = await workedVisit();
      const before = await state(id);
      // Paid travel time before the visit, entered by the office.
      const edit = { travelMinutes: 25, approvalNotes: 'Synthetic: 25 minutes of travel confirmed' };

      breakAuditTable();
      const refused = await patch(manager, path(id), edit);
      expect(refused.status).toBe(500);
      expect(refused.body.message).toBe(NOT_SAVED);
      expect(await state(id)).toEqual(before); // travel time, pay window, amount and notes
      expect(await entries(id, 'visit_reconciliation_updated')).toEqual([]);

      jest.restoreAllMocks();
      expect((await patch(manager, path(id), edit)).status).toBe(200);
      const after = await state(id);
      expect(after).toMatchObject({ travelMinutes: 25, approvalNotes: 'Synthetic: 25 minutes of travel confirmed' });
      const [entry] = await entries(id, 'visit_reconciliation_updated');
      expect(entry).toMatchObject({ userId: manager.id });
      expect(entry.oldValues).toMatchObject({ travelMinutes: null, payableMinutes: before.payableMinutes });
      expect(entry.newValues).toMatchObject({ travelMinutes: 25 });
      expect(await entries(id, 'visit_reconciliation_updated')).toHaveLength(1);
    });

    it('an amount entered by hand is saved with its audit entry; a failed entry leaves amount and approval as they were', async () => {
      const { id } = await workedVisit();
      await post(manager, path(id, 'reject'), { scope: 'PAY', approvalNotes: 'Synthetic: disputed' });
      const before = await state(id);
      const body = { payableAmount: 20, notes: 'Synthetic: agreed flat amount' };

      breakAuditTable();
      expect((await post(manager, path(id, 'payable-amount'), body)).status).toBe(500);
      expect(await state(id)).toEqual(before); // still rejected, still the old amount
      expect(await entries(id, 'visit_reconciliation_payable_amount_set')).toEqual([]);

      jest.restoreAllMocks();
      expect((await post(manager, path(id, 'payable-amount'), body)).status).toBe(201);
      expect(await state(id)).toMatchObject({ payableAmount: 20, status: 'APPROVED_FOR_PAY', approvedById: manager.id, approvalSource: 'MANAGER_OVERRIDE' });
      const [entry] = await entries(id, 'visit_reconciliation_payable_amount_set');
      expect(entry).toMatchObject({ userId: manager.id, description: 'Synthetic: agreed flat amount' });
      expect(entry.newValues).toMatchObject({ payableAmount: '20.00', status: 'APPROVED_FOR_PAY' });
    });

    it('an attendance correction: the evidence stays, and the repricing, the withdrawn approval and their entries are saved together', async () => {
      const { carer, jobId, visitId, id } = await workedVisit();
      // A person approved the visit; the office then learns the carer left at 09:30.
      expect((await post(manager, path(id, 'approve'), { scope: 'BOTH' })).status).toBe(201);
      const before = await state(id);
      expect(before).toMatchObject({ status: 'APPROVED_FOR_BOTH', approvalSource: 'MANAGER_APPROVED', payableAmount: 14 });

      breakAuditTable();
      // B4F: the times are recorded, so the answer is not an error; it says pay was not recalculated.
      const refused = await officeTime(jobId, carer.employeeId, at('09:30'));
      expect(refused.status).toBe(201);
      expect(refused.body.data.pay).toMatchObject([{ outcome: 'PAY_NOT_RECALCULATED' }]);
      // The corrected time is on record: attendance evidence is not undone.
      expect(await visitEnd(visitId)).toBe(at('09:30').toISOString());
      // The pay and its approval are exactly as they were, and nothing claims otherwise.
      expect(await state(id)).toEqual(before);
      expect(await entries(id, 'visit_attendance_times_corrected')).toEqual([]);
      expect(await entries(id, 'visit_reconciliation_approval_withdrawn')).toEqual([]);

      // The same correction again: repriced on the corrected times, approval withdrawn, each recorded once.
      jest.restoreAllMocks();
      const corrected = await officeTime(jobId, carer.employeeId, at('09:30'));
      expect(corrected.status).toBe(201);
      expect(corrected.body.data.pay).toMatchObject([{ outcome: 'REPRICED', payableBefore: '14' }]);
      const after = await state(id);
      expect(after).toMatchObject({ status: 'PENDING_REVIEW', approvedById: manager.id, payableMinutes: 29 });
      expect(after.payableAmount).toBeLessThan(14);
      const [withdrawn] = await entries(id, 'visit_reconciliation_approval_withdrawn');
      expect(withdrawn.oldValues).toMatchObject({ status: 'APPROVED_FOR_BOTH', approvedById: manager.id });
      const [times] = await entries(id, 'visit_attendance_times_corrected');
      expect(times).toMatchObject({ userId: office.id });
      expect(times.newValues).toMatchObject({ outcome: 'REPRICED' });
      expect(await entries(id, 'visit_reconciliation_approval_withdrawn')).toHaveLength(1);
      expect(await entries(id, 'visit_attendance_times_corrected')).toHaveLength(1);
    });

    it('settled pay is never rewritten: a correction is an adjustment record, saved with its audit entries or not at all, and never twice', async () => {
      const { carer, jobId, id } = await workedVisit();
      const run = await settle();
      const before = await state(id);
      expect(before).toMatchObject({ includedInPayrollRunId: run, payableAmount: 14 });
      const lockedLines = () => t.prisma.payrollRunLine.findMany({ where: { payrollRunId: run }, orderBy: { id: 'asc' }, select: { id: true, amount: true, claimKey: true } });
      const lines = await lockedLines();
      const corrections = () => t.prisma.employeePayItem.findMany({ where: { sourceId: id } });

      // The locked pay cannot be edited or replaced by hand.
      expect((await patch(manager, path(id), { approvedPayEnd: at('09:31').toISOString() })).status).toBe(400);
      expect((await post(manager, path(id, 'payable-amount'), { payableAmount: 7 })).status).toBe(400);
      expect(await state(id)).toEqual(before);

      // The office corrects the finish time, but the audit entry cannot be written: no correction is left behind.
      breakAuditTable();
      // B4F: the times are recorded, so the answer is not an error; it says pay was not recalculated.
      const refused = await officeTime(jobId, carer.employeeId, at('09:30', '2026-11-03'));
      expect(refused.status).toBe(201);
      expect(refused.body.data.pay).toMatchObject([{ outcome: 'PAY_NOT_RECALCULATED' }]);
      expect(await corrections()).toEqual([]);
      expect(await entries(id, 'visit_attendance_times_corrected')).toEqual([]);
      expect(await state(id)).toEqual(before);
      expect(await lockedLines()).toEqual(lines);

      // Again, with the audit table available: one pending correction, recorded once.
      jest.restoreAllMocks();
      const corrected = await officeTime(jobId, carer.employeeId, at('09:30', '2026-11-03'));
      expect(corrected.status).toBe(201);
      expect(corrected.body.data.pay).toMatchObject([{ outcome: 'CORRECTION_RECORDED' }]);
      const [item] = await corrections();
      expect(item).toMatchObject({ sourceType: 'VISIT_CORRECTION', status: 'PENDING_APPROVAL', createdById: office.id });
      expect(Number(item.amount)).toBeLessThan(0); // paid for an hour, worked half
      expect(await entries(item.id, 'visit_pay_correction_recorded')).toHaveLength(1);
      expect(await entries(id, 'visit_attendance_times_corrected')).toHaveLength(1);

      // The same correction sent again adds nothing; the paid line and the paid amount are untouched.
      const again = await officeTime(jobId, carer.employeeId, at('09:30', '2026-11-03'));
      expect(again.status).toBe(201);
      expect(again.body.data.pay).toMatchObject([{ outcome: 'NO_CORRECTION' }]);
      expect(await corrections()).toHaveLength(1);
      expect(await entries(item.id, 'visit_pay_correction_recorded')).toHaveLength(1);
      expect((await state(id)).payableAmount).toBe(14);
      expect(await lockedLines()).toEqual(lines);
    });

    it('a recalculation a person asks for: each changed visit is repriced with its own audit entry; asking twice records it once', async () => {
      const { id } = await workedVisit();
      // Synthetic: the stored amount is wrong and a recalculation should restore £14.00.
      await t.prisma.visitReconciliation.update({ where: { id }, data: { payableAmount: 1 } });
      const body = { ids: [id], reason: 'Synthetic: rates corrected, recalculate' };

      breakAuditTable();
      const refused = await post(manager, '/billing/visit-reconciliations/recalculate-amounts', body);
      expect(refused.status).toBe(500);
      expect((await state(id)).payableAmount).toBe(1); // not repriced without its entry
      expect(await entries(id, 'visit_reconciliation_amounts_recalculated')).toEqual([]);

      jest.restoreAllMocks();
      const done = await post(manager, '/billing/visit-reconciliations/recalculate-amounts', body);
      expect(done.status).toBe(201);
      expect(done.body.data).toMatchObject({ changed: 1, failed: 0 });
      expect((await state(id)).payableAmount).toBe(14);
      const [entry] = await entries(id, 'visit_reconciliation_amounts_recalculated');
      expect(entry).toMatchObject({ userId: manager.id, description: body.reason });
      expect(entry.oldValues).toMatchObject({ payableAmount: '1.00' });
      expect(entry.newValues).toMatchObject({ payableAmount: '14.00' });

      // Asked again: nothing changes, so no visit gets a second entry.
      const repeat = await post(manager, '/billing/visit-reconciliations/recalculate-amounts', body);
      expect(repeat.body.data).toMatchObject({ changed: 0, failed: 0 });
      expect(await entries(id, 'visit_reconciliation_amounts_recalculated')).toHaveLength(1);
      expect((await state(id)).payableAmount).toBe(14);
    });

    it('an evaluation on its own is one transaction: an approval is not withdrawn without the entry that records it', async () => {
      // A double-up, 09:00 to 10:00. The lead closes the visit at 10:00, which closes the support
      // carer's time too; a person then approves the support carer's pay.
      const lead = await createCarer(t.prisma);
      const support = await createCarer(t.prisma);
      const visit = await createAllocatedVisit(t.prisma, { carers: [lead.employeeId, support.employeeId], start: at('09:00') });
      const carerPost = (c: { accountId: string }, action: string, body: Record<string, unknown> = {}) =>
        request(server()).post(`/employee-app/visits/${visit.jobId}/${action}`).set(bearer(t.carerToken(c.accountId))).send(body);
      clock.set(at('09:01'));
      await carerPost(lead, 'check-in');
      await carerPost(support, 'check-in');
      clock.set(at('10:00'));
      expect((await carerPost(lead, 'complete', { status: 'COMPLETED' })).status).toBe(201);
      const id = (await t.prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visit.visitId, employeeId: support.employeeId } })).id;
      expect((await post(manager, path(id, 'approve'), { scope: 'BOTH' })).status).toBe(201);
      const before = await state(id);
      expect(before).toMatchObject({ status: 'APPROVED_FOR_BOTH', approvalSource: 'MANAGER_APPROVED' });

      // Only the entry of the withdrawal fails (synthetic). The support carer's later claim is
      // evaluated outside any request of the office, so the evaluation has no transaction but its own.
      const write = audit.logAudit.bind(audit);
      jest.spyOn(audit, 'logAudit').mockImplementation(((params: Parameters<AuditLogsService['logAudit']>[0]) =>
        params.action === 'visit_reconciliation_approval_withdrawn'
          ? Promise.reject(new Error('synthetic: audit entry refused'))
          : write(params)) as never);
      const failuresBefore = await t.prisma.payEvaluationFailure.count();
      clock.set(at('10:05'));
      const claim = await carerPost(support, 'complete', { status: 'COMPLETED', actualEndDateTime: at('09:30').toISOString(), idempotencyKey: 'synthetic-late-claim' });
      expect(claim.status).toBe(201); // the carer is not stopped by a pay evaluation
      expect(await state(id)).toEqual(before); // the approval was not withdrawn without a record of it
      expect(await entries(id, 'visit_reconciliation_approval_withdrawn')).toEqual([]);
      // The failure is kept for the office to see and retry.
      expect(await t.prisma.payEvaluationFailure.count()).toBeGreaterThan(failuresBefore);

      // Evaluated again once the entry can be written: withdrawn, with its entry, once.
      jest.restoreAllMocks();
      expect((await post(manager, path(id, 'evaluate'))).status).toBeLessThan(300);
      const after = await state(id);
      expect(after).toMatchObject({ status: 'PENDING_REVIEW', approvedById: manager.id });
      expect(await entries(id, 'visit_reconciliation_approval_withdrawn')).toHaveLength(1);
      expect((await post(manager, path(id, 'evaluate'))).status).toBeLessThan(300);
      expect(await entries(id, 'visit_reconciliation_approval_withdrawn')).toHaveLength(1);
    });
  });
});
