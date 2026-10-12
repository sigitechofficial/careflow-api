/**
 * Phase 0.5 — attendance time trust and office corrections that reach pay.
 * Audit IDs: VW-02, VW-15, with VW-22.
 */
import { VisitReconciliationStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import { EcmManualAttendanceService } from '../../src/ecm/ecm-manual-attendance.service';
import { VisitAttendanceService } from '../../src/visit-attendance/visit-attendance.service';
import {
  buildPayrollRunsService,
  buildReconciliationService,
  createAuditSpy,
  createCompletedVisit,
  createRun,
  createTestPrisma,
  resetPayData,
  uuid,
} from './harness';

describe('attendance times and pay', () => {
  let prisma: PrismaService;
  let runs: PayrollRunsService;
  let recons: VisitReconciliationsService;
  let office: EcmManualAttendanceService;
  const audit = createAuditSpy();
  const maker = uuid();
  const checker = uuid();
  const officeUser = uuid();

  const rowOf = (visitId: string) =>
    prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visitId }, include: { exceptions: true } });
  /** Office records that the carer actually left at the given time. */
  const correctFinish = (fixture: { jobId: string; employeeId: string }, occurredAt: string) =>
    office.recordManual({
      scheduledJobId: fixture.jobId,
      employeeId: fixture.employeeId,
      eventType: 'CHECK_OUT',
      occurredAt,
      reasonCode: 'CARER_FORGOT',
      note: 'Confirmed with the service user',
      approvedByUserId: officeUser,
    });

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    runs = buildPayrollRunsService(prisma).service;
  });
  beforeEach(async () => {
    audit.calls.length = 0;
    await resetPayData(prisma);
    await prisma.visitAttendanceEvent.deleteMany();
    recons = (await buildReconciliationService(prisma, { audit })).service;
    office = new (EcmManualAttendanceService as unknown as new (...args: unknown[]) => EcmManualAttendanceService)(
      prisma,
      new VisitAttendanceService(prisma),
      { evaluateJobSafe: async () => undefined },
      { append: async () => undefined },
      recons,
    );
  });
  afterAll(() => prisma.$disconnect());

  it('VW-15: an office correction reprices the draft pay of an unpaid visit and keeps the evidence', async () => {
    const fixture = await createCompletedVisit(prisma, { start: '2026-11-03T09:00:00Z' });
    await recons.ensureForVisit(fixture.visitId);
    expect(Number((await rowOf(fixture.visitId)).payableAmount)).toBe(14);

    const result = await correctFinish(fixture, '2026-11-03T09:30:00Z');

    const row = await rowOf(fixture.visitId);
    expect(row.actualEndDateTime?.toISOString()).toBe('2026-11-03T09:30:00.000Z');
    expect(row.payableMinutes).toBe(30);
    expect(Number(row.payableAmount)).toBe(7);
    expect(result.data.pay).toMatchObject([{ outcome: 'REPRICED', payableBefore: '14', payableAfter: '7' }]);
    // Append-only: the correction is a new attributed event, and the decision is audited.
    const events = await prisma.visitAttendanceEvent.findMany({ where: { scheduledJobId: fixture.jobId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ verificationMethod: 'MANUAL_OFFICE', eventType: 'CHECK_OUT' });
    expect(audit.calls.some((c) => c.action === 'visit_attendance_times_corrected' && c.userId === officeUser)).toBe(true);
  });

  it('VW-15: an office correction on a paid visit leaves the record and raises a pay correction', async () => {
    const fixture = await createCompletedVisit(prisma, { start: '2026-11-03T09:00:00Z' });
    await recons.ensureForVisit(fixture.visitId);
    const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(run);
    await runs.approve(checker, run);
    await runs.lock(checker, run);

    const result = await correctFinish(fixture, '2026-11-03T09:30:00Z');

    const row = await rowOf(fixture.visitId);
    expect(Number(row.payableAmount)).toBe(14);
    expect(row.payableMinutes).toBe(60);
    expect(row.includedInPayrollRunId).toBe(run);
    expect(result.data.pay).toMatchObject([{ outcome: 'CORRECTION_RECORDED' }]);
    const corrections = await prisma.employeePayItem.findMany({ where: { sourceId: row.id } });
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({
      sourceType: 'VISIT_CORRECTION',
      status: 'PENDING_APPROVAL',
      createdById: officeUser,
    });
    expect(Number(corrections[0].amount)).toBe(-7);
    expect(Number(corrections[0].correctedAmount)).toBe(7);

    // Recording the same correction again does not create a second adjustment.
    const again = await correctFinish(fixture, '2026-11-03T09:30:00Z');
    expect(again.data.pay).toMatchObject([{ outcome: 'NO_CORRECTION' }]);
    expect(await prisma.employeePayItem.count({ where: { sourceId: row.id } })).toBe(1);
  });

  it('VW-15: a correction that would put the start after the finish is refused', async () => {
    const fixture = await createCompletedVisit(prisma, { start: '2026-11-03T09:00:00Z' });
    await recons.ensureForVisit(fixture.visitId);
    await expect(correctFinish(fixture, '2026-11-03T08:00:00Z')).rejects.toThrow(/start at or after the finish/i);
    expect(Number((await rowOf(fixture.visitId)).payableAmount)).toBe(14);
  });

  it('VW-02: a carer-reported time the server could not corroborate holds the visit for approval', async () => {
    const fixture = await createCompletedVisit(prisma, { start: '2026-11-03T09:00:00Z' });
    await prisma.scheduledJob.update({
      where: { id: fixture.jobId },
      data: {
        metadata: {
          employeeApp: {
            attendanceTimes: {
              needsReview: true,
              reviewReasons: ['Start time was reported by the carer; no check-in was recorded.'],
              startSource: 'CARER_REPORTED',
              endSource: 'SERVER',
            },
          },
        },
      },
    });

    await recons.ensureForVisit(fixture.visitId);

    const held = await rowOf(fixture.visitId);
    expect(held.status).toBe(VisitReconciliationStatus.PENDING_REVIEW);
    expect(held.exceptions.map((e) => e.code)).toEqual(['UNVERIFIED_TIMES']);
    // Priced, not refused: the amount is ready for whoever approves it.
    expect(Number(held.payableAmount)).toBe(14);
    const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(run);
    expect(await prisma.payrollRunLine.count({ where: { payrollRunId: run } })).toBe(0);

    // A person can approve it as it stands…
    await recons.approve(checker, held.id, { scope: 'PAY' } as never);
    expect((await rowOf(fixture.visitId)).status).toBe(VisitReconciliationStatus.APPROVED_FOR_PAY);
  });

  it('VW-02: once the office verifies the times the review flag is cleared', async () => {
    const fixture = await createCompletedVisit(prisma, { start: '2026-11-03T09:00:00Z' });
    await prisma.scheduledJob.update({
      where: { id: fixture.jobId },
      data: {
        metadata: {
          employeeApp: {
            attendanceTimes: {
              needsReview: true,
              reviewReasons: ['Finish time was reported by the carer 240 minutes before the server received the completion.'],
              startSource: 'SERVER',
              endSource: 'CARER_REPORTED',
            },
          },
        },
      },
    });
    await recons.ensureForVisit(fixture.visitId);
    expect((await rowOf(fixture.visitId)).exceptions.map((e) => e.code)).toEqual(['UNVERIFIED_TIMES']);

    await correctFinish(fixture, '2026-11-03T10:00:00Z');

    const row = await rowOf(fixture.visitId);
    expect(row.exceptions).toHaveLength(0);
    expect(row.status).toBe(VisitReconciliationStatus.APPROVED_FOR_BOTH);
  });
});
