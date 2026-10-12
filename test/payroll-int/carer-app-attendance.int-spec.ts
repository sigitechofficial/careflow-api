/**
 * Gate A sprint, R-02 / R-03 / R-04 — the real carer-app flow, over HTTP:
 * carer token → check-in → completion → reconciliation → payable time → office review.
 * Audit IDs: VW-02, VW-15.
 *
 * Covers the backend the mobile app talks to. The mobile application itself (its screens, its
 * offline queue, what it actually sends) is not exercised here: its source is not available.
 */
import request from 'supertest';
import { PayrollRunLineType, VisitReconciliationStatus } from '@prisma/client';
import { attendanceTimeTrustFor } from '../../src/visit-attendance/visit-time-trust.util';
import { resetPayData } from './harness';
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

describe('carer app attendance → pay (HTTP)', () => {
  let t: TestApp;
  let clock: ReturnType<typeof useControlledClock>;
  let office: { id: string };
  let payrollMaker: { id: string };

  // A weekday in GMT, so local time = UTC.
  const at = (hm: string, day = '2026-11-03') => new Date(`${day}T${hm}:00Z`);
  const server = () => t.app.getHttpServer();
  const asCarer = (accountId: string) => bearer(t.carerToken(accountId));
  const asStaff = (userId: string) => bearer(t.staffToken(userId));

  const checkIn = (carer: { accountId: string }, jobId: string, body: Record<string, unknown> = {}) =>
    request(server()).post(`/employee-app/visits/${jobId}/check-in`).set(asCarer(carer.accountId)).send(body);
  const complete = (carer: { accountId: string }, jobId: string, body: Record<string, unknown> = {}) =>
    request(server())
      .post(`/employee-app/visits/${jobId}/complete`)
      .set(asCarer(carer.accountId))
      .send({ status: 'COMPLETED', ...body });
  const officeCorrect = (jobId: string, employeeId: string, eventType: 'CHECK_IN' | 'CHECK_OUT', occurredAt: Date) =>
    request(server())
      .post(`/ecm/visits/${jobId}/manual-attendance`)
      .set(asStaff(office.id))
      .send({ employeeId, eventType, occurredAt: occurredAt.toISOString(), reasonCode: 'VERIFIED_WITH_CLIENT', note: 'Confirmed by phone' });

  const rowFor = (visitId: string, employeeId: string) =>
    t.prisma.visitReconciliation.findFirst({
      where: { scheduledVisitId: visitId, employeeId },
      include: { exceptions: true },
    });
  const allocation = (id: string) => t.prisma.jobAllocation.findUniqueOrThrow({ where: { id } });
  const trustFor = async (jobId: string, employeeId: string) =>
    attendanceTimeTrustFor((await t.prisma.scheduledJob.findUniqueOrThrow({ where: { id: jobId } })).metadata, employeeId);
  const events = (jobId: string, employeeId: string) =>
    t.prisma.visitAttendanceEvent.findMany({ where: { scheduledJobId: jobId, employeeId }, orderBy: { occurredAt: 'asc' } });
  /** Lines a visit pay run for the week would hold for this visit. */
  const payLinesFor = async (visitId: string) => {
    const run = await request(server())
      .post('/billing/payroll-runs')
      .set(asStaff(payrollMaker.id))
      .send({ periodStart: '2026-11-01', periodEnd: '2026-11-07' });
    await request(server()).post(`/billing/payroll-runs/${run.body.data.id}/calculate`).set(asStaff(payrollMaker.id));
    const lines = await t.prisma.payrollRunLine.findMany({
      where: { payrollRunId: run.body.data.id, lineType: PayrollRunLineType.VISIT_PAY, visitReconciliation: { scheduledVisitId: visitId } },
    });
    await request(server()).delete(`/billing/payroll-runs/${run.body.data.id}`).set(asStaff(payrollMaker.id));
    return lines;
  };

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(at('09:00'));
    await resetPayData(t.prisma);
    await t.prisma.visitAttendanceEvent.deleteMany();
    await resetIdentityData(t.prisma);
    await seedDefaultCards(t.prisma);
    office = await createStaffUser(t.prisma, { roleName: 'Super Admin' });
    payrollMaker = await createStaffUser(t.prisma, { roleName: 'Super Admin' });
  });
  afterEach(() => clock.restore());
  afterAll(async () => {
    await t.close();
  });

  it('requires a carer session, and only for a visit the carer is allocated to', async () => {
    const carer = await createCarer(t.prisma);
    const stranger = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });

    expect((await request(server()).post(`/employee-app/visits/${visit.jobId}/check-in`).send({})).status).toBe(401);
    expect((await request(server()).post(`/employee-app/visits/${visit.jobId}/check-in`).set(asStaff(office.id)).send({})).status).toBe(403);
    expect((await checkIn(stranger, visit.jobId)).status).toBe(403);
    expect((await complete(stranger, visit.jobId)).status).toBe(403);
    expect((await allocation(visit.allocationIds[carer.employeeId])).actualStartDateTime).toBeNull();
  });

  it('normal visit: server times are recorded, pay is priced and approved without GPS', async () => {
    const carer = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });

    clock.set(at('09:02'));
    expect((await checkIn(carer, visit.jobId)).status).toBe(201); // no coordinates sent: not refused
    clock.set(at('10:01'));
    expect((await complete(carer, visit.jobId)).status).toBe(201);

    const mine = await allocation(visit.allocationIds[carer.employeeId]);
    expect(mine.actualStartDateTime).toEqual(at('09:02'));
    expect(mine.actualEndDateTime).toEqual(at('10:01'));
    const row = await rowFor(visit.visitId, carer.employeeId);
    // 59 minutes attended against 60 planned: a shortfall inside the tolerance pays the planned visit.
    expect(row).toMatchObject({ status: VisitReconciliationStatus.APPROVED_FOR_BOTH, payableMinutes: 60 });
    expect(Number(row!.payableAmount)).toBe(14);
    expect(row!.exceptions).toHaveLength(0);
    expect(await trustFor(visit.jobId, carer.employeeId)).toMatchObject({
      needsReview: false,
      startSource: 'SERVER',
      endSource: 'SERVER',
    });
    expect((await events(visit.jobId, carer.employeeId)).map((e) => e.eventType)).toEqual(['CHECK_IN', 'CHECK_OUT']);
    expect(await payLinesFor(visit.visitId)).toHaveLength(1);
  });

  it('E2E-07: a carer who reports an earlier start than the recorded check-in is not paid for it', async () => {
    const carer = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
    clock.set(at('09:20'));
    await checkIn(carer, visit.jobId);
    clock.set(at('10:00'));

    const res = await complete(carer, visit.jobId, {
      actualStartDateTime: at('07:00').toISOString(),
      timingExceptionReasonCode: 'TRAFFIC_OR_ROAD_CLOSURE', // the app must explain a late start
    });

    expect({ status: res.status, message: res.status === 201 ? 'ok' : res.body.message }).toEqual({ status: 201, message: 'ok' });
    const mine = await allocation(visit.allocationIds[carer.employeeId]);
    expect(mine.actualStartDateTime).toEqual(at('09:20')); // the server's check-in, not the claim
    const row = await rowFor(visit.visitId, carer.employeeId);
    expect(row!.payableMinutes).toBe(40);
    // The claim is kept as evidence.
    expect((await trustFor(visit.jobId, carer.employeeId))?.evidence).toMatchObject({
      reportedStart: at('07:00').toISOString(),
      serverCheckInAt: at('09:20').toISOString(),
    });
  });

  it('device clock ahead: a finish in the future is refused; small drift is accepted', async () => {
    const carer = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
    clock.set(at('09:01'));
    await checkIn(carer, visit.jobId);
    clock.set(at('10:00'));

    const future = await complete(carer, visit.jobId, { actualEndDateTime: at('11:30').toISOString() });
    expect(future.status).toBe(400);
    expect(future.body.message).toMatch(/future/i);
    expect((await allocation(visit.allocationIds[carer.employeeId])).actualEndDateTime).toBeNull();

    // Device 4 minutes behind the server, sent with a +01:00 offset: same instant, accepted as is.
    const drift = await complete(carer, visit.jobId, { actualEndDateTime: '2026-11-03T10:56:00+01:00' });
    expect(drift.status).toBe(201);
    expect((await allocation(visit.allocationIds[carer.employeeId])).actualEndDateTime).toEqual(at('09:56'));
    expect(await trustFor(visit.jobId, carer.employeeId)).toMatchObject({ needsReview: false, endSource: 'CARER_REPORTED' });
    expect((await rowFor(visit.visitId, carer.employeeId))!.status).toBe(VisitReconciliationStatus.APPROVED_FOR_BOTH);
  });

  it('missing check-in: the reported start is used, priced, and held for a person to approve', async () => {
    const carer = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
    clock.set(at('10:02'));

    const res = await complete(carer, visit.jobId, {
      actualStartDateTime: at('09:00').toISOString(),
      actualEndDateTime: at('10:00').toISOString(),
    });

    expect({ status: res.status, message: res.status === 201 ? 'ok' : res.body.message }).toEqual({ status: 201, message: 'ok' });
    const row = await rowFor(visit.visitId, carer.employeeId);
    expect(row!.status).toBe(VisitReconciliationStatus.PENDING_REVIEW);
    expect(row!.exceptions.map((e) => e.code)).toContain('UNVERIFIED_TIMES');
    expect(Number(row!.payableAmount)).toBe(14); // priced, not refused
    expect(await payLinesFor(visit.visitId)).toHaveLength(0); // not paid until someone approves

    // Manager review: approve as it stands.
    const approve = await request(server())
      .post(`/billing/visit-reconciliations/${row!.id}/approve`)
      .set(asStaff(office.id))
      .send({ scope: 'PAY', approvalNotes: 'Carer phone was flat; client confirmed the visit' });
    expect(approve.status).toBe(201);
    expect((await rowFor(visit.visitId, carer.employeeId))!.status).toBe(VisitReconciliationStatus.APPROVED_FOR_PAY);
    expect(await payLinesFor(visit.visitId)).toHaveLength(1);
  });

  it('offline visit uploaded hours later: kept as evidence, held, then corrected by the office', async () => {
    const carer = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
    // The phone had no signal: both requests reach the server at 14:00.
    clock.set(at('14:00'));
    await checkIn(carer, visit.jobId, { deviceCapturedAt: at('09:01').toISOString() });
    const res = await complete(carer, visit.jobId, {
      actualStartDateTime: at('09:01').toISOString(),
      actualEndDateTime: at('10:00').toISOString(),
      deviceRecordedAt: at('10:00').toISOString(),
      timingExceptionReasonCode: 'SYSTEM_OR_DEVICE_ISSUE',
    });
    expect({ status: res.status, message: res.status === 201 ? 'ok' : res.body.message }).toEqual({ status: 201, message: 'ok' });

    const held = await rowFor(visit.visitId, carer.employeeId);
    expect(held!.status).toBe(VisitReconciliationStatus.PENDING_REVIEW);
    expect(held!.exceptions.map((e) => e.code)).toContain('UNVERIFIED_TIMES');
    const trust = await trustFor(visit.jobId, carer.employeeId);
    expect(trust!.reviewReasons.join(' ')).toMatch(/240 minutes before the server received/);
    expect(trust!.evidence).toMatchObject({ reportedStart: at('09:01').toISOString(), reportedEnd: at('10:00').toISOString() });

    // The office confirms the real times: each is a new attributed event, the originals stay.
    expect((await officeCorrect(visit.jobId, carer.employeeId, 'CHECK_IN', at('09:01'))).status).toBe(201);
    const fixed = await rowFor(visit.visitId, carer.employeeId);
    expect(fixed).toMatchObject({ status: VisitReconciliationStatus.APPROVED_FOR_BOTH, payableMinutes: 60 });
    expect(fixed!.actualStartDateTime).toEqual(at('09:01'));
    expect(fixed!.exceptions).toHaveLength(0);
    const all = await events(visit.jobId, carer.employeeId);
    expect(all.filter((e) => e.verificationMethod === 'MANUAL_OFFICE')).toHaveLength(1);
    expect(all.filter((e) => e.verificationMethod !== 'MANUAL_OFFICE').length).toBeGreaterThanOrEqual(2);
  });

  it('missing check-out: no pay record exists until the visit is completed', async () => {
    const carer = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
    clock.set(at('09:01'));
    await checkIn(carer, visit.jobId);
    clock.set(at('12:00'));

    const row = await rowFor(visit.visitId, carer.employeeId);
    expect(row?.payableAmount ?? null).toBeNull();
    expect(await payLinesFor(visit.visitId)).toHaveLength(0);
  });

  it('a repeated completion request changes nothing, whatever times it carries', async () => {
    const carer = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
    clock.set(at('09:01'));
    await checkIn(carer, visit.jobId, { idempotencyKey: 'check-in-1' });
    await checkIn(carer, visit.jobId, { idempotencyKey: 'check-in-1' });
    clock.set(at('10:00'));
    expect((await complete(carer, visit.jobId, { idempotencyKey: 'complete-1' })).status).toBe(201);
    const before = await rowFor(visit.visitId, carer.employeeId);

    clock.set(at('10:30'));
    const retry = await complete(carer, visit.jobId, {
      idempotencyKey: 'complete-1',
      actualStartDateTime: at('06:00').toISOString(),
      actualEndDateTime: at('10:29').toISOString(),
    });

    expect(retry.status).toBe(201);
    const after = await rowFor(visit.visitId, carer.employeeId);
    expect(after).toMatchObject({
      payableMinutes: before!.payableMinutes,
      payableAmount: before!.payableAmount,
      approvedPayStart: before!.approvedPayStart,
      approvedPayEnd: before!.approvedPayEnd,
    });
    const mine = await allocation(visit.allocationIds[carer.employeeId]);
    expect(mine.actualStartDateTime).toEqual(at('09:01'));
    expect(mine.actualEndDateTime).toEqual(at('10:00'));
    const all = await events(visit.jobId, carer.employeeId);
    expect(all.filter((e) => e.eventType === 'CHECK_IN')).toHaveLength(1);
    expect(all.filter((e) => e.eventType === 'CHECK_OUT')).toHaveLength(1);
  });

  it('overnight visit: paid for the time worked across midnight', async () => {
    const carer = await createCarer(t.prisma);
    const visit = await createAllocatedVisit(t.prisma, {
      carers: [carer.employeeId],
      start: at('23:00'),
      plannedMinutes: 120,
    });
    clock.set(at('23:02'));
    await checkIn(carer, visit.jobId);
    clock.set(at('01:01', '2026-11-04'));
    expect((await complete(carer, visit.jobId)).status).toBe(201);

    const row = await rowFor(visit.visitId, carer.employeeId);
    // 119 minutes attended against 120 planned: inside the tolerance, so the planned two hours are paid.
    expect(row!.actualStartDateTime).toEqual(at('23:02'));
    expect(row!.actualEndDateTime).toEqual(at('01:01', '2026-11-04'));
    expect(row!.payableMinutes).toBe(120);
    expect(Number(row!.payableAmount)).toBe(28);
  });

  describe('R-03: double-up visits are reviewed per carer', () => {
    it('E2E-05: one unverified carer does not hold the other carer’s pay', async () => {
      const lead = await createCarer(t.prisma);
      const support = await createCarer(t.prisma);
      const visit = await createAllocatedVisit(t.prisma, { carers: [lead.employeeId, support.employeeId], start: at('09:00') });
      clock.set(at('09:01'));
      await checkIn(lead, visit.jobId);
      await checkIn(support, visit.jobId);
      // The support carer's completion says they left at 09:30; it reaches the server at 10:00.
      clock.set(at('10:00'));
      expect((await complete(support, visit.jobId, { actualEndDateTime: at('09:30').toISOString() })).status).toBe(201);
      expect((await complete(lead, visit.jobId)).status).toBe(201);

      const leadRow = await rowFor(visit.visitId, lead.employeeId);
      const supportRow = await rowFor(visit.visitId, support.employeeId);
      expect(leadRow).toMatchObject({ status: VisitReconciliationStatus.APPROVED_FOR_BOTH, payableMinutes: 60 });
      expect(leadRow!.exceptions.map((e) => e.code)).not.toContain('UNVERIFIED_TIMES');
      expect(supportRow!.status).toBe(VisitReconciliationStatus.PENDING_REVIEW);
      expect(supportRow!.exceptions.map((e) => e.code)).toContain('UNVERIFIED_TIMES');

      // Only the verified carer's pay goes into a pay run.
      const lines = await payLinesFor(visit.visitId);
      expect(lines.map((l) => l.employeeId)).toEqual([lead.employeeId]);

      // The office verifies the support carer's finish: that carer is released, the lead is untouched.
      expect((await officeCorrect(visit.jobId, support.employeeId, 'CHECK_OUT', at('09:30'))).status).toBe(201);
      const released = await rowFor(visit.visitId, support.employeeId);
      expect(released!.exceptions.map((e) => e.code)).not.toContain('UNVERIFIED_TIMES');
      expect(released!.payableMinutes).toBe(29);
      expect((await rowFor(visit.visitId, lead.employeeId))!.payableMinutes).toBe(60);
      // 29 minutes against 60 planned is a short visit: that ordinary flag still needs a decision.
      expect(released!.exceptions.map((e) => e.code)).toEqual(['UNDERRUN']);
      const approve = await request(server())
        .post(`/billing/visit-reconciliations/${released!.id}/approve`)
        .set(asStaff(office.id))
        .send({ scope: 'PAY', approvalNotes: 'Left early by agreement' });
      expect(approve.status).toBe(201);
      const both = await payLinesFor(visit.visitId);
      expect(both.map((l) => l.employeeId).sort()).toEqual([lead.employeeId, support.employeeId].sort());
      expect(new Set(both.map((l) => l.claimKey)).size).toBe(2);
    });

    it('the support carer clocking out after the lead closed the visit is held to the same rules', async () => {
      const lead = await createCarer(t.prisma);
      const support = await createCarer(t.prisma);
      const visit = await createAllocatedVisit(t.prisma, { carers: [lead.employeeId, support.employeeId], start: at('09:00') });
      clock.set(at('09:01'));
      await checkIn(lead, visit.jobId);
      await checkIn(support, visit.jobId);
      clock.set(at('10:00'));
      expect((await complete(lead, visit.jobId)).status).toBe(201); // the lead closes the visit first

      // A finish in the future is refused, and nothing is recorded for the support carer.
      clock.set(at('10:05'));
      const future = await complete(support, visit.jobId, { actualEndDateTime: at('11:30').toISOString() });
      expect(future.status).toBe(400);

      // A finish reported 40 minutes after the fact is kept as evidence and held for review.
      clock.set(at('10:40'));
      expect((await complete(support, visit.jobId, { actualEndDateTime: at('10:00').toISOString() })).status).toBe(201);
      const held = await rowFor(visit.visitId, support.employeeId);
      expect(held!.status).toBe(VisitReconciliationStatus.PENDING_REVIEW);
      expect(held!.exceptions.map((e) => e.code)).toContain('UNVERIFIED_TIMES');
      const trust = await trustFor(visit.jobId, support.employeeId);
      expect(trust).toMatchObject({ endSource: 'CARER_REPORTED', needsReview: true });
      expect(trust!.evidence).toMatchObject({ reportedEnd: at('10:00').toISOString(), serverReceivedAt: at('10:40').toISOString() });
      // The lead, who completed in real time, is not held.
      expect((await rowFor(visit.visitId, lead.employeeId))!.status).toBe(VisitReconciliationStatus.APPROVED_FOR_BOTH);

      // The office verifies the finish: the support carer is released.
      expect((await officeCorrect(visit.jobId, support.employeeId, 'CHECK_OUT', at('10:00'))).status).toBe(201);
      const released = await rowFor(visit.visitId, support.employeeId);
      expect(released!.exceptions.map((e) => e.code)).not.toContain('UNVERIFIED_TIMES');
      expect(released!.payableMinutes).toBe(60);
    });

    it('three carers: each is priced on their own times and reviewed on their own evidence', async () => {
      const lead = await createCarer(t.prisma);
      const second = await createCarer(t.prisma);
      const third = await createCarer(t.prisma);
      const visit = await createAllocatedVisit(t.prisma, {
        carers: [lead.employeeId, second.employeeId, third.employeeId],
        start: at('09:00'),
      });
      clock.set(at('09:00'));
      await checkIn(lead, visit.jobId);
      clock.set(at('09:10'));
      await checkIn(second, visit.jobId);
      clock.set(at('09:05'));
      await checkIn(third, visit.jobId);
      clock.set(at('10:00'));
      await complete(second, visit.jobId);
      await complete(third, visit.jobId, { actualEndDateTime: at('09:20').toISOString() }); // 40 min old
      await complete(lead, visit.jobId);

      const [a, b, c] = await Promise.all(
        [lead, second, third].map((carer) => rowFor(visit.visitId, carer.employeeId)),
      );
      // 50 minutes against 60 planned is inside the tolerance (planned paid); 15 minutes is not.
      expect([a!.payableMinutes, b!.payableMinutes, c!.payableMinutes]).toEqual([60, 60, 15]);
      expect([a!.status, b!.status]).toEqual([
        VisitReconciliationStatus.APPROVED_FOR_BOTH,
        VisitReconciliationStatus.APPROVED_FOR_BOTH,
      ]);
      expect(c!.status).toBe(VisitReconciliationStatus.PENDING_REVIEW);
      expect((await payLinesFor(visit.visitId)).map((l) => l.employeeId).sort()).toEqual(
        [lead.employeeId, second.employeeId].sort(),
      );
    });
  });

  describe('R-04: office corrections while the visit is still open', () => {
    it('an office start recorded before completion becomes the carer’s start', async () => {
      const carer = await createCarer(t.prisma);
      const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
      clock.set(at('09:25'));
      await checkIn(carer, visit.jobId); // the carer forgot to check in on arrival
      clock.set(at('09:40'));

      const correction = await officeCorrect(visit.jobId, carer.employeeId, 'CHECK_IN', at('09:00'));

      expect(correction.status).toBe(201);
      expect(correction.body.data.pay[0].outcome).toBe('RECORDED_FOR_COMPLETION');
      // The live record the app works from is not overwritten.
      expect((await allocation(visit.allocationIds[carer.employeeId])).actualStartDateTime).toEqual(at('09:25'));

      clock.set(at('10:00'));
      expect((await complete(carer, visit.jobId)).status).toBe(201);

      // The recorded attendance now carries the office-verified start; the carer's own check-in
      // stays in the attendance history.
      expect((await allocation(visit.allocationIds[carer.employeeId])).actualStartDateTime).toEqual(at('09:00'));
      const own = (await events(visit.jobId, carer.employeeId)).find(
        (e) => e.eventType === 'CHECK_IN' && e.verificationMethod !== 'MANUAL_OFFICE',
      );
      expect(own?.occurredAt).toEqual(at('09:25'));
      const row = await rowFor(visit.visitId, carer.employeeId);
      expect(row!.actualStartDateTime).toEqual(at('09:00')); // pay follows the office-verified start
      expect(row!.payableMinutes).toBe(60);
      expect(await trustFor(visit.jobId, carer.employeeId)).toMatchObject({ startSource: 'OFFICE', needsReview: false });
      expect((await events(visit.jobId, carer.employeeId)).map((e) => e.verificationMethod)).toContain('MANUAL_OFFICE');
    });

    it('an office finish that the carer then contradicts is held for review, neither side wins silently', async () => {
      const carer = await createCarer(t.prisma);
      const visit = await createAllocatedVisit(t.prisma, { carers: [carer.employeeId], start: at('09:00') });
      clock.set(at('09:00'));
      await checkIn(carer, visit.jobId);
      clock.set(at('10:05'));
      await officeCorrect(visit.jobId, carer.employeeId, 'CHECK_OUT', at('10:00'));
      clock.set(at('11:00'));

      const res = await complete(carer, visit.jobId, { actualEndDateTime: at('10:55').toISOString() });

      expect({ status: res.status, message: res.status === 201 ? 'ok' : res.body.message }).toEqual({ status: 201, message: 'ok' });
      const row = await rowFor(visit.visitId, carer.employeeId);
      expect(row!.actualEndDateTime).toEqual(at('10:00')); // the authorised time is the record
      expect(row!.status).toBe(VisitReconciliationStatus.PENDING_REVIEW);
      expect(row!.exceptions.map((e) => e.code)).toContain('UNVERIFIED_TIMES');
      const trust = await trustFor(visit.jobId, carer.employeeId);
      expect(trust!.reviewReasons.join(' ')).toMatch(/office recorded the finish/i);
      expect(trust!.evidence!.reportedEnd).toBe(at('10:55').toISOString());
    });

    it('on a double-up, an office correction for one carer does not touch the other', async () => {
      const lead = await createCarer(t.prisma);
      const support = await createCarer(t.prisma);
      const visit = await createAllocatedVisit(t.prisma, { carers: [lead.employeeId, support.employeeId], start: at('09:00') });
      clock.set(at('09:00'));
      await checkIn(lead, visit.jobId);
      clock.set(at('09:40'));
      await checkIn(support, visit.jobId);
      await officeCorrect(visit.jobId, support.employeeId, 'CHECK_IN', at('09:20'));
      clock.set(at('10:00'));
      await complete(support, visit.jobId);
      await complete(lead, visit.jobId);

      // 09:20–10:00 for the support carer (20 minutes without the correction).
      expect((await rowFor(visit.visitId, support.employeeId))!.payableMinutes).toBe(40);
      expect((await rowFor(visit.visitId, lead.employeeId))!.payableMinutes).toBe(60);
      expect(await trustFor(visit.jobId, lead.employeeId)).toMatchObject({ startSource: 'SERVER' });
    });
  });
});
