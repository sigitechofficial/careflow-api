/**
 * Gate B sprint, R-16 — per-carer attendance verification records are safe under concurrency.
 * Audit ID: VW-02.
 *
 * Before: each carer's record lived inside the job's metadata document and was written by reading
 * the document and writing it back, so simultaneous writers could erase each other's evidence.
 * Now: one row per job and carer, changed under a row lock, with an append-only history.
 */
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import {
  findAttendanceVerification,
  recordAttendanceCompletion,
  recordOfficeAttendanceTime,
} from '../../src/visit-attendance/visit-attendance-verification.store';
import { resolveTrustedCompletionTimes } from '../../src/visit-attendance/visit-time-trust.util';
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

describe('R-16: attendance evidence under concurrency', () => {
  let t: TestApp;
  let prisma: PrismaService;
  let clock: ReturnType<typeof useControlledClock>;
  let office: { id: string };
  let office2: { id: string };

  const at = (hm: string, day = '2026-11-03') => new Date(`${day}T${hm}:00Z`);
  const server = () => t.app.getHttpServer();
  const asCarer = (c: { accountId: string }) => bearer(t.carerToken(c.accountId));
  const checkIn = (c: { accountId: string }, jobId: string) =>
    request(server()).post(`/employee-app/visits/${jobId}/check-in`).set(asCarer(c)).send({});
  const complete = (c: { accountId: string }, jobId: string, body: Record<string, unknown> = {}) =>
    request(server()).post(`/employee-app/visits/${jobId}/complete`).set(asCarer(c)).send({ status: 'COMPLETED', ...body });
  const officeTime = (user: { id: string }, jobId: string, employeeId: string, eventType: 'CHECK_IN' | 'CHECK_OUT', when: Date) =>
    request(server())
      .post(`/ecm/visits/${jobId}/manual-attendance`)
      .set(bearer(t.staffToken(user.id)))
      .send({ employeeId, eventType, occurredAt: when.toISOString(), reasonCode: 'VERIFIED_WITH_CLIENT', note: 'Confirmed by phone' });
  const record = (jobId: string, employeeId: string) => findAttendanceVerification(prisma, jobId, employeeId);
  const entries = (jobId: string, employeeId: string) =>
    prisma.visitAttendanceVerificationEntry.findMany({
      where: { verification: { scheduledJobId: jobId, employeeId } },
      orderBy: { version: 'asc' },
    });
  /** A completion as the store sees it: server check-in 09:00, completion received at `received`. */
  const completion = (jobId: string, employeeId: string, received: Date, reportedEnd?: Date, clientEventId?: string) =>
    recordAttendanceCompletion(prisma, {
      scheduledJobId: jobId,
      employeeId,
      clientEventId,
      resolve: (officeTimes) =>
        resolveTrustedCompletionTimes({
          serverNow: received,
          serverCheckInAt: at('09:00'),
          reportedEnd: reportedEnd ?? undefined,
          officeStart: officeTimes?.start,
          officeEnd: officeTimes?.end,
        }),
    });

  beforeAll(async () => {
    t = await createTestApp();
    prisma = t.prisma;
  }, 240_000);
  beforeEach(async () => {
    clock = useControlledClock(at('09:00'));
    await resetPayData(prisma);
    await prisma.visitAttendanceEvent.deleteMany();
    await resetIdentityData(prisma);
    await seedDefaultCards(prisma);
    office = await createStaffUser(prisma, { roleName: 'Super Admin' });
    office2 = await createStaffUser(prisma, { roleName: 'Super Admin' });
  });
  afterEach(() => clock.restore());
  afterAll(async () => {
    await t.close();
  });

  describe('carers completing over HTTP', () => {
    it('two carers complete at the same moment: each keeps their own evidence', async () => {
      const lead = await createCarer(prisma);
      const support = await createCarer(prisma);
      const visit = await createAllocatedVisit(prisma, { carers: [lead.employeeId, support.employeeId], start: at('09:00') });
      clock.set(at('09:01'));
      await checkIn(lead, visit.jobId);
      await checkIn(support, visit.jobId);
      clock.set(at('10:00'));

      const [a, b] = await Promise.all([
        complete(lead, visit.jobId, { actualEndDateTime: at('09:58').toISOString() }),
        complete(support, visit.jobId, { actualEndDateTime: at('09:55').toISOString() }),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);

      const leadRecord = await record(visit.jobId, lead.employeeId);
      const supportRecord = await record(visit.jobId, support.employeeId);
      expect(leadRecord?.evidence?.reportedEnd).toBe(at('09:58').toISOString());
      expect(supportRecord?.evidence?.reportedEnd).toBe(at('09:55').toISOString());
      expect(leadRecord?.evidence?.serverCheckInAt).toBe(at('09:01').toISOString());
      expect(supportRecord?.evidence?.serverCheckInAt).toBe(at('09:01').toISOString());
      expect(await prisma.visitAttendanceVerification.count({ where: { scheduledJobId: visit.jobId } })).toBe(2);
    });

    it('three carers complete at the same moment', async () => {
      const carers = await Promise.all([1, 2, 3].map(() => createCarer(prisma)));
      const visit = await createAllocatedVisit(prisma, { carers: carers.map((c) => c.employeeId), start: at('09:00') });
      clock.set(at('09:01'));
      for (const c of carers) await checkIn(c, visit.jobId);
      clock.set(at('10:00'));
      const ends = ['09:57', '09:56', '09:55'];

      const results = await Promise.all(
        carers.map((c, i) => complete(c, visit.jobId, { actualEndDateTime: at(ends[i]).toISOString() })),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
      for (const [i, c] of carers.entries()) {
        const mine = await record(visit.jobId, c.employeeId);
        expect(mine?.evidence?.reportedEnd).toBe(at(ends[i]).toISOString());
        expect((await entries(visit.jobId, c.employeeId)).length).toBeGreaterThanOrEqual(1);
      }
    });

    it('an office correction arriving while the carer completes is not lost', async () => {
      const carer = await createCarer(prisma);
      const visit = await createAllocatedVisit(prisma, { carers: [carer.employeeId], start: at('09:00') });
      clock.set(at('09:10'));
      await checkIn(carer, visit.jobId);
      clock.set(at('10:00'));

      const [done, corrected] = await Promise.all([
        complete(carer, visit.jobId),
        officeTime(office, visit.jobId, carer.employeeId, 'CHECK_IN', at('09:00')),
      ]);
      expect([done.status, corrected.status]).toEqual([201, 201]);

      // Whichever was applied first, both facts are on the carer's record afterwards.
      const mine = await record(visit.jobId, carer.employeeId);
      expect(mine?.office?.start).toBe(at('09:00').toISOString());
      expect(mine?.evidence?.serverCheckInAt).toBe(at('09:10').toISOString());
      const kinds = (await entries(visit.jobId, carer.employeeId)).map((e) => e.kind).sort();
      expect(kinds).toEqual(['COMPLETION', 'OFFICE_TIME']);
    });

    it('two office users correcting the same carer at once: both times are kept', async () => {
      const carer = await createCarer(prisma);
      const visit = await createAllocatedVisit(prisma, { carers: [carer.employeeId], start: at('09:00') });

      const [a, b] = await Promise.all([
        officeTime(office, visit.jobId, carer.employeeId, 'CHECK_IN', at('09:00')),
        officeTime(office2, visit.jobId, carer.employeeId, 'CHECK_OUT', at('10:00')),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);

      const mine = await record(visit.jobId, carer.employeeId);
      expect(mine?.office).toMatchObject({ start: at('09:00').toISOString(), end: at('10:00').toISOString() });
      const history = await entries(visit.jobId, carer.employeeId);
      expect(history.map((e) => e.actorUserId).sort()).toEqual([office.id, office2.id].sort());
      expect(history.map((e) => e.version)).toEqual([1, 2]);
    });

    it('one carer already paid: another carer\'s late clock-out leaves the paid carer alone', async () => {
      const lead = await createCarer(prisma);
      const support = await createCarer(prisma);
      const maker = await createStaffUser(prisma, { permissions: [] });
      const checker = await createStaffUser(prisma, { permissions: [] });
      const visit = await createAllocatedVisit(prisma, { carers: [lead.employeeId, support.employeeId], start: at('09:00') });
      clock.set(at('09:01'));
      await checkIn(lead, visit.jobId);
      await checkIn(support, visit.jobId);
      clock.set(at('10:00'));
      expect((await complete(lead, visit.jobId)).status).toBe(201); // closes the visit; support is auto-closed

      // The lead's pay is settled in a locked run. The support carer is held out of it first.
      const supportRow = await prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visit.visitId, employeeId: support.employeeId } });
      await prisma.visitReconciliation.update({ where: { id: supportRow.id }, data: { status: 'PENDING_REVIEW' } });
      const runs = t.app.get(PayrollRunsService);
      clock.set(at('09:00', '2026-11-09'));
      const run = await createRun(runs, maker.id, '2026-11-01', '2026-11-07');
      await runs.calculate(run);
      await runs.approve(checker.id, run);
      await runs.lock(checker.id, run);
      const leadBefore = await prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visit.visitId, employeeId: lead.employeeId } });
      const leadRecordBefore = await record(visit.jobId, lead.employeeId);
      expect(leadBefore.includedInPayrollRunId).toBe(run);

      // The support carer's own clock-out arrives days later.
      expect((await complete(support, visit.jobId, { actualEndDateTime: at('09:45').toISOString() })).status).toBe(201);

      const leadAfter = await prisma.visitReconciliation.findUniqueOrThrow({ where: { id: leadBefore.id } });
      expect(Number(leadAfter.payableAmount)).toBe(Number(leadBefore.payableAmount));
      expect(leadAfter.includedInPayrollRunId).toBe(run);
      expect(await record(visit.jobId, lead.employeeId)).toEqual(leadRecordBefore);
      const supportRecord = await record(visit.jobId, support.employeeId);
      expect(supportRecord).toMatchObject({ needsReview: true, endSource: 'CARER_REPORTED' });
      expect(supportRecord?.evidence?.reportedEnd).toBe(at('09:45').toISOString());
    });
  });

  describe('the record itself', () => {
    it('eight carers of one job written in parallel: eight records, none overwritten', async () => {
      const jobId = uuid();
      const carers = Array.from({ length: 8 }, () => uuid());
      await Promise.all(carers.map((id, i) => completion(jobId, id, at('10:00'), at(`09:5${i}`))));

      for (const [i, id] of carers.entries()) {
        expect((await record(jobId, id))?.evidence?.reportedEnd).toBe(at(`09:5${i}`).toISOString());
      }
      expect(await prisma.visitAttendanceVerification.count({ where: { scheduledJobId: jobId } })).toBe(8);
    });

    it('completion and office entries for one carer, many at once: every one is applied in turn', async () => {
      const jobId = uuid();
      const carer = uuid();
      const by = uuid();
      await Promise.all([
        completion(jobId, carer, at('10:00')),
        recordOfficeAttendanceTime(prisma, { scheduledJobId: jobId, employeeId: carer, eventType: 'CHECK_IN', occurredAt: at('09:00'), byUserId: by, verified: false }),
        recordOfficeAttendanceTime(prisma, { scheduledJobId: jobId, employeeId: carer, eventType: 'CHECK_OUT', occurredAt: at('10:00'), byUserId: by, verified: false }),
        completion(jobId, carer, at('10:01')),
      ]);

      const mine = await record(jobId, carer);
      expect(mine?.version).toBe(4);
      expect(mine?.office).toMatchObject({ start: at('09:00').toISOString(), end: at('10:00').toISOString() });
      expect(mine?.evidence).not.toBeNull();
      const history = await entries(jobId, carer);
      expect(history.map((e) => e.version)).toEqual([1, 2, 3, 4]); // no version handed out twice
      expect(history.map((e) => e.kind).sort()).toEqual(['COMPLETION', 'COMPLETION', 'OFFICE_TIME', 'OFFICE_TIME']);
    });

    it('the same device request delivered twice, even at the same moment, is recorded once', async () => {
      const jobId = uuid();
      const carer = uuid();
      const [first, second] = await Promise.all([
        completion(jobId, carer, at('10:00'), at('09:58'), 'complete:offline-123'),
        completion(jobId, carer, at('10:00'), at('09:58'), 'complete:offline-123'),
      ]);
      expect([first.applied, second.applied].sort()).toEqual([false, true]);
      expect((await record(jobId, carer))?.version).toBe(1);
      expect(await entries(jobId, carer)).toHaveLength(1);

      // Delivered again hours later: still nothing new, and the first evidence stands.
      const late = await completion(jobId, carer, at('14:00'), at('09:58'), 'complete:offline-123');
      expect(late.applied).toBe(false);
      expect((await record(jobId, carer))?.evidence?.serverReceivedAt).toBe(at('10:00').toISOString());
      expect(late.times.end).toEqual(at('09:58')); // the caller can still answer the device
    });

    it('an offline completion arriving late is kept as evidence and held for review', async () => {
      const jobId = uuid();
      const carer = uuid();
      const { record: mine } = await completion(jobId, carer, at('14:00'), at('10:00'), 'complete:offline-9');
      expect(mine).toMatchObject({ needsReview: true, endSource: 'CARER_REPORTED' });
      expect(mine.evidence).toMatchObject({ reportedEnd: at('10:00').toISOString(), serverReceivedAt: at('14:00').toISOString() });
      const [entry] = await entries(jobId, carer);
      expect(entry).toMatchObject({ kind: 'COMPLETION', clientEventId: 'complete:offline-9', actorEmployeeId: carer });
    });

    it('a transaction that fails leaves nothing behind; the retry is recorded once', async () => {
      const jobId = uuid();
      const carer = uuid();
      const failing = recordAttendanceCompletion(prisma, {
        scheduledJobId: jobId,
        employeeId: carer,
        clientEventId: 'complete:retry-1',
        resolve: () => {
          throw new Error('simulated failure inside the transaction');
        },
      });
      await expect(failing).rejects.toThrow(/simulated failure/);
      expect(await prisma.visitAttendanceVerification.count({ where: { scheduledJobId: jobId } })).toBe(0);
      expect(await record(jobId, carer)).toBeUndefined();

      const retry = await completion(jobId, carer, at('10:00'), at('09:59'), 'complete:retry-1');
      expect(retry.applied).toBe(true);
      expect((await record(jobId, carer))?.version).toBe(1);
      expect(await entries(jobId, carer)).toHaveLength(1);
    });

    it('a record kept in older job metadata is read, then brought in on the first write, as it stood', async () => {
      const carer = await createCarer(prisma);
      const other = await createCarer(prisma);
      const visit = await createAllocatedVisit(prisma, { carers: [carer.employeeId, other.employeeId], start: at('09:00') });
      const legacy = {
        needsReview: true,
        reviewReasons: ['Finish time was reported by the carer 240 minutes before the server received the completion.'],
        startSource: 'SERVER',
        endSource: 'CARER_REPORTED',
        evidence: { serverReceivedAt: at('14:00').toISOString(), serverCheckInAt: at('09:00').toISOString(), reportedStart: null, reportedEnd: at('10:00').toISOString() },
        office: { start: at('09:00').toISOString(), end: null, byUserId: office.id, at: at('09:30').toISOString(), reason: 'Phoned in' },
      };
      const metadata = { keep: 'me', employeeApp: { attendanceTimesByEmployee: { [carer.employeeId]: legacy } } };
      await prisma.scheduledJob.update({ where: { id: visit.jobId }, data: { metadata } });

      // Read without a row: the metadata record, version 0.
      const job = await prisma.scheduledJob.findUniqueOrThrow({ where: { id: visit.jobId } });
      expect(await findAttendanceVerification(prisma, visit.jobId, carer.employeeId, job.metadata)).toMatchObject({ ...legacy, version: 0 });

      // First write: the office verifies the finish.
      await recordOfficeAttendanceTime(prisma, {
        scheduledJobId: visit.jobId,
        employeeId: carer.employeeId,
        eventType: 'CHECK_OUT',
        occurredAt: at('10:00'),
        byUserId: office2.id,
        reason: 'Confirmed',
        verified: true,
      });
      const mine = await record(visit.jobId, carer.employeeId);
      expect(mine?.version).toBe(2);
      expect(mine?.evidence).toEqual(legacy.evidence); // device evidence carried over
      expect(mine?.office).toMatchObject({ start: at('09:00').toISOString(), end: at('10:00').toISOString(), byUserId: office2.id });
      expect(mine?.verifiedByUserId).toBe(office2.id);
      const history = await entries(visit.jobId, carer.employeeId);
      expect(history.map((e) => e.kind)).toEqual(['LEGACY_IMPORT', 'OFFICE_TIME']);
      expect(history[0].payload).toMatchObject({ evidence: legacy.evidence });
      // The old metadata is left exactly as it was.
      expect((await prisma.scheduledJob.findUniqueOrThrow({ where: { id: visit.jobId } })).metadata).toEqual(metadata);
    });
  });
});
