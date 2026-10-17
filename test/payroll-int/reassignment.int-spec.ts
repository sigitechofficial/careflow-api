/**
 * Phase 0.1 — a visit reassigned after completion does not leave two payable rows.
 * Audit ID: VW-11.
 */
import { PayrollRunLineType, VisitReconciliationStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import {
  buildPayrollRunsService,
  buildReconciliationService,
  createCompletedVisit,
  createRun,
  createTestPrisma,
  resetPayData,
  uuid,
} from './harness';

describe('visit reassigned after completion', () => {
  let prisma: PrismaService;
  let runs: PayrollRunsService;
  let recons: VisitReconciliationsService;
  const maker = uuid();
  const checker = uuid();

  /** Office replaces the carer on a completed visit: old allocation removed, new one added. */
  const reassign = async (fixture: Awaited<ReturnType<typeof createCompletedVisit>>) => {
    const start = new Date('2026-11-03T09:00:00Z');
    const end = new Date('2026-11-03T10:00:00Z');
    await prisma.jobAllocation.update({
      where: { id: fixture.allocationId },
      data: { status: 'UNALLOCATED', isActive: false },
    });
    const replacement = await prisma.employee.create({ data: {} });
    const allocation = await prisma.jobAllocation.create({
      data: {
        scheduledJobId: fixture.jobId,
        scheduledVisitId: fixture.visitId,
        employeeId: replacement.id,
        status: 'ALLOCATED',
        scheduledStartDateTime: start,
        scheduledEndDateTime: end,
        actualStartDateTime: start,
        actualEndDateTime: end,
      },
    });
    await recons.ensureForVisit(fixture.visitId);
    return { employeeId: replacement.id, allocationId: allocation.id };
  };
  const rowFor = (visitId: string, allocationId: string) =>
    prisma.visitReconciliation.findFirstOrThrow({ where: { scheduledVisitId: visitId, jobAllocationId: allocationId } });
  const payLineCount = (visitId: string) =>
    prisma.payrollRunLine.count({
      where: { lineType: PayrollRunLineType.VISIT_PAY, visitReconciliation: { scheduledVisitId: visitId } },
    });

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    runs = buildPayrollRunsService(prisma).service;
  });
  beforeEach(async () => {
    await resetPayData(prisma);
    recons = (await buildReconciliationService(prisma)).service;
  });
  afterAll(() => prisma.$disconnect());

  it('VW-11: before pay, the removed carer is withdrawn and only the replacement is paid', async () => {
    const fixture = await createCompletedVisit(prisma, { start: '2026-11-03T09:00:00Z' });
    await recons.ensureForVisit(fixture.visitId);
    const replacement = await reassign(fixture);

    const oldRow = await rowFor(fixture.visitId, fixture.allocationId);
    const newRow = await rowFor(fixture.visitId, replacement.allocationId);
    expect(oldRow.status).toBe(VisitReconciliationStatus.REJECTED_FOR_PAY);
    expect(oldRow.approvalNotes).toMatch(/superseded/i);
    expect(newRow.status).toBe(VisitReconciliationStatus.APPROVED_FOR_BOTH);

    const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(run);
    expect(await payLineCount(fixture.visitId)).toBe(1);
    const line = await prisma.payrollRunLine.findFirstOrThrow({ where: { visitReconciliationId: newRow.id } });
    expect(line.employeeId).toBe(replacement.employeeId);
  });

  it('VW-11: after pay, the paid row stays and the replacement is held for a manager', async () => {
    const fixture = await createCompletedVisit(prisma, { start: '2026-11-03T09:00:00Z' });
    await recons.ensureForVisit(fixture.visitId);
    const first = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(first);
    await runs.approve(checker, first);
    await runs.lock(checker, first);

    const replacement = await reassign(fixture);

    const oldRow = await rowFor(fixture.visitId, fixture.allocationId);
    const newRow = await rowFor(fixture.visitId, replacement.allocationId);
    expect(oldRow.includedInPayrollRunId).toBe(first);
    expect(oldRow.employeeId).toBe(fixture.employeeId);
    expect(newRow.status).toBe(VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL);

    // Not picked up by a later run, and it stays held when re-evaluated.
    await recons.evaluate(newRow.id);
    const supplementary = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(supplementary);
    expect(await payLineCount(fixture.visitId)).toBe(1);

    // A manager can still decide to pay the replacement carer.
    await recons.approve(checker, newRow.id, { scope: 'PAY', managerOverride: true } as never);
    await recons.evaluate(newRow.id);
    expect((await rowFor(fixture.visitId, replacement.allocationId)).status).toBe(
      VisitReconciliationStatus.APPROVED_FOR_PAY,
    );
  });

  it('a double-up visit keeps both carers payable', async () => {
    const fixture = await createCompletedVisit(prisma, { start: '2026-11-03T09:00:00Z' });
    const second = await prisma.employee.create({ data: {} });
    const start = new Date('2026-11-03T09:00:00Z');
    const end = new Date('2026-11-03T10:00:00Z');
    await prisma.scheduledVisit.update({ where: { id: fixture.visitId }, data: { requiredCarers: 2 } });
    await prisma.jobAllocation.create({
      data: {
        scheduledJobId: fixture.jobId,
        scheduledVisitId: fixture.visitId,
        employeeId: second.id,
        status: 'ALLOCATED',
        scheduledStartDateTime: start,
        scheduledEndDateTime: end,
        actualStartDateTime: start,
        actualEndDateTime: end,
      },
    });
    await recons.ensureForVisit(fixture.visitId);

    const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(run);
    expect(await payLineCount(fixture.visitId)).toBe(2);
  });
});
