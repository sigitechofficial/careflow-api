/**
 * Gate B sprint, R-18 — an approval stands for the attendance evidence it was given for.
 * Audit ID: VW-02.
 *
 * Before: re-evaluation kept any existing approval unless a blocking set-up exception appeared,
 * and could not tell an automatic approval from a person's. Evidence arriving after approval left
 * a stale approval in place.
 */
import request from 'supertest';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import { recordOfficeAttendanceTime } from '../../src/visit-attendance/visit-attendance-verification.store';
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

describe('R-18: approvals follow the evidence', () => {
  let t: TestApp;
  let clock: ReturnType<typeof useControlledClock>;
  let office: { id: string };
  let manager: { id: string };

  const at = (hm: string, day = '2026-11-03') => new Date(`${day}T${hm}:00Z`);
  const server = () => t.app.getHttpServer();
  const asCarer = (c: { accountId: string }) => bearer(t.carerToken(c.accountId));
  const as = (u: { id: string }) => bearer(t.staffToken(u.id));
  const checkIn = (c: { accountId: string }, jobId: string) =>
    request(server()).post(`/employee-app/visits/${jobId}/check-in`).set(asCarer(c)).send({});
  const complete = (c: { accountId: string }, jobId: string, body: Record<string, unknown> = {}) =>
    request(server()).post(`/employee-app/visits/${jobId}/complete`).set(asCarer(c)).send({ status: 'COMPLETED', ...body });
  const officeTime = (jobId: string, employeeId: string, eventType: 'CHECK_IN' | 'CHECK_OUT', when: Date) =>
    request(server())
      .post(`/ecm/visits/${jobId}/manual-attendance`)
      .set(as(office))
      .send({ employeeId, eventType, occurredAt: when.toISOString(), reasonCode: 'VERIFIED_WITH_CLIENT', note: 'Confirmed by phone' });
  const approve = (rowId: string, body: Record<string, unknown> = { scope: 'BOTH' }) =>
    request(server()).post(`/billing/visit-reconciliations/${rowId}/approve`).set(as(manager)).send(body);
  const rowFor = (visitId: string, employeeId: string) =>
    t.prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visitId, employeeId }, include: { exceptions: true } });
  const codes = (row: { exceptions: Array<{ code: string }> }) => row.exceptions.map((e) => e.code);
  const withdrawals = (rowId: string) =>
    t.prisma.auditLog.findMany({ where: { recordId: rowId, action: 'visit_reconciliation_approval_withdrawn' } });

  /**
   * A double-up, 09:00 to 10:00. Both check in at 09:01; the lead completes at 10:00, which closes
   * the visit and closes the support carer's time at 10:00 too. Both rows are approved automatically.
   */
  const closedDoubleUp = async () => {
    const lead = await createCarer(t.prisma);
    const support = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [lead.employeeId, support.employeeId], start: at('09:00') });
    clock.set(at('09:01'));
    await checkIn(lead, visit.jobId);
    await checkIn(support, visit.jobId);
    clock.set(at('10:00'));
    expect((await complete(lead, visit.jobId)).status).toBe(201);
    return { lead, support, visit };
  };

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(at('08:00'));
    await resetPayData(t.prisma);
    await t.prisma.visitAttendanceEvent.deleteMany();
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma);
    office = await createStaffUser(t.prisma, { roleName: 'Super Admin' });
    manager = await createStaffUser(t.prisma, {
      permissions: ['billing.visit_reconciliations.read', 'billing.visit_reconciliations.manage', 'payroll.scope.organisation'],
    });
  });
  afterEach(() => clock.restore());
  afterAll(async () => {
    await t.close();
  });

  it('an automatic approval records that it was automatic, when, and on which evidence', async () => {
    const { lead, visit } = await closedDoubleUp();
    const row = await rowFor(visit.visitId, lead.employeeId);
    expect(row).toMatchObject({
      status: 'APPROVED_FOR_BOTH',
      approvalSource: 'AUTO_VERIFIED',
      approvedById: null,
      approvedEvidence: '2026-11-03T09:01|2026-11-03T10:00|OK',
      evidenceChangedReason: null,
    });
    expect(row.approvedAt).toEqual(at('10:00'));
  });

  it('auto-approved, then a late clock-out the server can corroborate: approved again on the new evidence', async () => {
    const { support, visit } = await closedDoubleUp();
    const before = await rowFor(visit.visitId, support.employeeId);
    expect(before).toMatchObject({ status: 'APPROVED_FOR_BOTH', approvalSource: 'AUTO_VERIFIED' });

    // The support carer's own clock-out: left at 09:55, sent at 10:05.
    clock.set(at('10:05'));
    expect((await complete(support, visit.jobId, { actualEndDateTime: at('09:55').toISOString() })).status).toBe(201);

    const after = await rowFor(visit.visitId, support.employeeId);
    expect(after).toMatchObject({
      status: 'APPROVED_FOR_BOTH',
      approvalSource: 'AUTO_VERIFIED',
      approvedEvidence: '2026-11-03T09:01|2026-11-03T09:55|OK',
    });
    expect(after.actualEndDateTime).toEqual(at('09:55'));
    expect(after.approvedAt).toEqual(at('10:05')); // a new approval, not the old one carried over
    expect(await withdrawals(after.id)).toHaveLength(1);
  });

  it('auto-approved, then a contradictory device time: the approval is withdrawn and the row is held', async () => {
    const { lead, support, visit } = await closedDoubleUp();
    const leadBefore = await rowFor(visit.visitId, lead.employeeId);

    // Reported 40 minutes after the fact: the server cannot corroborate it.
    clock.set(at('10:40'));
    expect((await complete(support, visit.jobId, { actualEndDateTime: at('09:30').toISOString() })).status).toBe(201);

    const held = await rowFor(visit.visitId, support.employeeId);
    expect(held).toMatchObject({ status: 'PENDING_REVIEW', approvalSource: null, approvedEvidence: null, approvedAt: null });
    expect(codes(held)).toContain('UNVERIFIED_TIMES');
    expect(held.actualEndDateTime).toEqual(at('09:30')); // the claim is the record, held for review

    // The other carer's valid approval is not touched in any way.
    const leadAfter = await rowFor(visit.visitId, lead.employeeId);
    expect(leadAfter).toMatchObject({
      status: leadBefore.status,
      approvalSource: 'AUTO_VERIFIED',
      approvedEvidence: leadBefore.approvedEvidence,
      payableMinutes: leadBefore.payableMinutes,
    });
    expect(leadAfter.approvedAt).toEqual(leadBefore.approvedAt);
    expect(await withdrawals(leadAfter.id)).toHaveLength(0);
  });

  it('the same clock-out delivered twice withdraws nothing the second time', async () => {
    const { support, visit } = await closedDoubleUp();
    clock.set(at('10:05'));
    const body = { actualEndDateTime: at('09:55').toISOString(), idempotencyKey: 'late-out-1' };
    expect((await complete(support, visit.jobId, body)).status).toBe(201);
    const first = await rowFor(visit.visitId, support.employeeId);

    clock.set(at('10:20'));
    expect((await complete(support, visit.jobId, body)).status).toBe(201);
    // Opening the visit evaluates it again: still nothing to withdraw.
    expect((await request(server()).get(`/billing/visit-reconciliations/${first.id}`).set(as(manager))).status).toBe(200);

    const second = await rowFor(visit.visitId, support.employeeId);
    expect(second.approvedEvidence).toBe(first.approvedEvidence);
    expect(second.approvedAt).toEqual(first.approvedAt);
    expect(second.status).toBe('APPROVED_FOR_BOTH');
    expect(await withdrawals(first.id)).toHaveLength(1);
  });

  it("a manager's approval is kept on record but needs a new review when the evidence changes", async () => {
    const { support, visit } = await closedDoubleUp();
    const row = await rowFor(visit.visitId, support.employeeId);
    clock.set(at('11:00'));
    expect((await approve(row.id, { scope: 'BOTH', approvalNotes: 'Checked with the lead carer' })).status).toBe(201);
    expect(await rowFor(visit.visitId, support.employeeId)).toMatchObject({
      approvalSource: 'MANAGER_APPROVED',
      approvedById: manager.id,
      approvedEvidence: '2026-11-03T09:01|2026-11-03T10:00|OK',
    });

    // New evidence: the support carer's own clock-out says 09:55.
    clock.set(at('11:02'));
    await complete(support, visit.jobId, { actualEndDateTime: at('09:55').toISOString(), actualStartDateTime: undefined });
    // 09:55 reported at 11:02 is uncorroborated as well, so both flags are raised.
    const undermined = await rowFor(visit.visitId, support.employeeId);
    expect(undermined.status).toBe('PENDING_REVIEW');
    expect(codes(undermined)).toEqual(expect.arrayContaining(['EVIDENCE_CHANGED', 'UNVERIFIED_TIMES']));
    expect(undermined.evidenceChangedReason).toMatch(/changed after this visit was approved \(finish was 2026-11-03 10:00 UTC, now 2026-11-03 09:55 UTC/);
    // Who approved, when and why stays on the record.
    expect(undermined).toMatchObject({ approvedById: manager.id, approvalSource: 'MANAGER_APPROVED', approvalNotes: 'Checked with the lead carer' });
    expect(undermined.approvedAt).toEqual(at('11:00'));
    const [audit] = await withdrawals(row.id);
    expect(audit.newValues).toMatchObject({ outcome: 'REQUIRE_REVIEW' });

    // The office verifies the finish; the manager reviews and approves again.
    clock.set(at('11:30'));
    expect((await officeTime(visit.jobId, support.employeeId, 'CHECK_OUT', at('09:55'))).status).toBe(201);
    expect((await approve(row.id, { scope: 'BOTH', approvalNotes: 'Agreed 09:55' })).status).toBe(201);
    const again = await rowFor(visit.visitId, support.employeeId);
    expect(again).toMatchObject({
      status: 'APPROVED_FOR_BOTH',
      approvalSource: 'MANAGER_APPROVED',
      approvedEvidence: '2026-11-03T09:01|2026-11-03T09:55|OK',
      evidenceChangedReason: null,
    });
    expect(codes(again)).not.toContain('EVIDENCE_CHANGED');
  });

  it('an office correction of a manager-approved visit also sends it back for review', async () => {
    const carer = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
    clock.set(at('09:01'));
    await checkIn(carer, visit.jobId);
    clock.set(at('10:00'));
    await complete(carer, visit.jobId);
    const row = await rowFor(visit.visitId, carer.employeeId);
    expect((await approve(row.id)).status).toBe(201);

    expect((await officeTime(visit.jobId, carer.employeeId, 'CHECK_OUT', at('09:30'))).status).toBe(201);

    const after = await rowFor(visit.visitId, carer.employeeId);
    expect(after.status).toBe('PENDING_REVIEW');
    expect(codes(after)).toContain('EVIDENCE_CHANGED');
    expect(after.approvedById).toBe(manager.id);
    expect(after.payableMinutes).toBe(29); // repriced on the corrected times, not paid yet
  });

  describe('a visit whose pay is settled', () => {
    /** The lead's and the support carer's pay locked in a visit pay run. */
    const settledDoubleUp = async () => {
      const ctx = await closedDoubleUp();
      const maker = await createStaffUser(t.prisma, { permissions: [] });
      const checker = await createStaffUser(t.prisma, { permissions: [] });
      const runs = t.app.get(PayrollRunsService);
      clock.set(at('09:00', '2026-11-09'));
      const run = await createRun(runs, maker.id, '2026-11-01', '2026-11-07');
      await runs.calculate(run);
      await runs.approve(checker.id, run);
      await runs.lock(checker.id, run);
      return { ...ctx, run };
    };

    it('new evidence from the carer is flagged; the pay and its approval are not touched', async () => {
      const { support, visit, run } = await settledDoubleUp();
      const before = await rowFor(visit.visitId, support.employeeId);
      expect(before.includedInPayrollRunId).toBe(run);

      expect((await complete(support, visit.jobId, { actualEndDateTime: at('09:30').toISOString() })).status).toBe(201);

      const after = await rowFor(visit.visitId, support.employeeId);
      expect(after).toMatchObject({
        status: before.status,
        payableMinutes: before.payableMinutes,
        includedInPayrollRunId: run,
        approvalSource: 'AUTO_VERIFIED',
        approvedEvidence: before.approvedEvidence,
      });
      expect(Number(after.payableAmount)).toBe(Number(before.payableAmount));
      expect(codes(after)).toContain('EVIDENCE_CHANGED');
      expect(after.evidenceChangedReason).toMatch(/after the pay of this visit was settled.*record a pay correction/);
      expect((await withdrawals(after.id))[0].newValues).toMatchObject({ outcome: 'FLAG_SETTLED' });
      // No correction is created from a carer's unverified claim.
      expect(await t.prisma.employeePayItem.count({ where: { sourceId: after.id } })).toBe(0);

      // The office verifies the time: a pending correction is recorded and the flag is answered.
      const verified = await officeTime(visit.jobId, support.employeeId, 'CHECK_OUT', at('09:30'));
      expect(verified.status).toBe(201);
      expect(verified.body.data.pay).toMatchObject([{ outcome: 'CORRECTION_RECORDED' }]);
      const answered = await rowFor(visit.visitId, support.employeeId);
      expect(answered.evidenceChangedReason).toBeNull();
      expect(codes(answered)).not.toContain('EVIDENCE_CHANGED');
      expect(Number(answered.payableAmount)).toBe(Number(before.payableAmount)); // history unchanged
      const [correction] = await t.prisma.employeePayItem.findMany({ where: { sourceId: answered.id } });
      expect(correction).toMatchObject({ sourceType: 'VISIT_CORRECTION', status: 'PENDING_APPROVAL' });
    });

    it('an office correction of a settled visit raises a correction and leaves no flag behind', async () => {
      const { lead, visit, run } = await settledDoubleUp();
      const before = await rowFor(visit.visitId, lead.employeeId);

      const corrected = await officeTime(visit.jobId, lead.employeeId, 'CHECK_OUT', at('09:30'));
      expect(corrected.body.data.pay).toMatchObject([{ outcome: 'CORRECTION_RECORDED' }]);

      const after = await rowFor(visit.visitId, lead.employeeId);
      expect(after).toMatchObject({ includedInPayrollRunId: run, evidenceChangedReason: null, status: before.status });
      expect(Number(after.payableAmount)).toBe(Number(before.payableAmount));
      expect(after.approvedEvidence).toBe('2026-11-03T09:01|2026-11-03T09:30|OK');
    });
  });

  it('an approval made before evidence was recorded adopts the current evidence; nothing is withdrawn', async () => {
    const { lead, visit } = await closedDoubleUp();
    const row = await rowFor(visit.visitId, lead.employeeId);
    await t.prisma.visitReconciliation.update({
      where: { id: row.id },
      data: { approvalSource: null, approvedEvidence: null, approvedById: manager.id },
    });

    expect((await request(server()).get(`/billing/visit-reconciliations/${row.id}`).set(as(manager))).status).toBe(200);

    expect(await rowFor(visit.visitId, lead.employeeId)).toMatchObject({
      status: 'APPROVED_FOR_BOTH',
      approvalSource: 'MANAGER_APPROVED', // a named approver means a person approved
      approvedEvidence: '2026-11-03T09:01|2026-11-03T10:00|OK',
    });
    expect(await withdrawals(row.id)).toHaveLength(0);
  });

  it('an office time entered for an open visit after the completion arrived is flagged, not silently dropped', async () => {
    const carer = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
    clock.set(at('09:10'));
    await checkIn(carer, visit.jobId);
    clock.set(at('10:00'));
    await complete(carer, visit.jobId);
    expect((await rowFor(visit.visitId, carer.employeeId)).status).toBe('APPROVED_FOR_BOTH');

    // What the office request does when it read "visit still open" a moment before the completion.
    await recordOfficeAttendanceTime(t.prisma, {
      scheduledJobId: visit.jobId,
      employeeId: carer.employeeId,
      eventType: 'CHECK_IN',
      occurredAt: at('09:00'),
      byUserId: office.id,
      verified: false,
    });
    await t.app.get(VisitReconciliationsService).ensureForVisitSafe(visit.visitId);

    const held = await rowFor(visit.visitId, carer.employeeId);
    expect(held.status).toBe('PENDING_REVIEW');
    expect(held.exceptions.find((e) => e.code === 'UNVERIFIED_TIMES')?.message).toMatch(
      /office recorded a start of 2026-11-03T09:00:00.000Z while the carer's completion was being processed/,
    );
  });
});
