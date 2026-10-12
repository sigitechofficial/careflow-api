/**
 * Phase 0.1 — one entitlement is an original earning in one visit pay run only.
 * Audit IDs: SI-01, SI-02, SI-03, SI-08.
 */
import { PayrollRunLineType, PayrollRunStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import {
  buildPayrollRunsService,
  createApprovedVisit,
  createRun,
  createTestPrisma,
  resetPayData,
  stubOrgSettings,
  uuid,
} from './harness';

describe('visit pay runs: payable-source claims', () => {
  let prisma: PrismaService;
  let service: PayrollRunsService;
  const maker = uuid();
  const checker = uuid();

  const visitPayLines = (reconciliationId: string) =>
    prisma.payrollRunLine.findMany({
      where: { visitReconciliationId: reconciliationId, lineType: PayrollRunLineType.VISIT_PAY },
    });
  const approveAndLock = async (runId: string) => {
    await service.approve(checker, runId);
    await service.lock(checker, runId);
  };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    service = buildPayrollRunsService(prisma).service;
  });
  beforeEach(() => resetPayData(prisma));
  afterAll(() => prisma.$disconnect());

  it('SI-01: the same visit calculated into two runs is paid by one run only', async () => {
    const visit = await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z' });
    const runA = await createRun(service, maker, '2026-11-01', '2026-11-07');
    const runB = await createRun(service, maker, '2026-11-01', '2026-11-30');

    await service.calculate(runA);
    await service.calculate(runB);

    const lines = await visitPayLines(visit.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].payrollRunId).toBe(runA);
    expect(lines[0].claimKey).toBe(`VISIT:${visit.id}:VISIT_PAY`);
  });

  it('SI-01: two runs calculating at the same time never both claim a visit', async () => {
    const employeeId = uuid();
    const visits = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((d) =>
        createApprovedVisit(prisma, { employeeId, start: `2026-11-0${d}T09:00:00Z` }),
      ),
    );
    const runA = await createRun(service, maker, '2026-11-01', '2026-11-07');
    const runB = await createRun(service, maker, '2026-11-01', '2026-11-07');

    await Promise.all([service.calculate(runA), service.calculate(runB)]);

    for (const visit of visits) {
      expect(await visitPayLines(visit.id)).toHaveLength(1);
    }
    const total = await prisma.payrollRunLine.count({ where: { lineType: PayrollRunLineType.VISIT_PAY } });
    expect(total).toBe(visits.length);
  });

  it('SI-01: calculating the same run twice is idempotent', async () => {
    const visit = await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z' });
    const run = await createRun(service, maker, '2026-11-01', '2026-11-07');

    await service.calculate(run);
    await service.calculate(run);

    expect(await visitPayLines(visit.id)).toHaveLength(1);
  });

  it('double-up visit: each carer has an own claim and is paid once', async () => {
    const scheduledVisitId = uuid();
    const a = await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z', scheduledVisitId });
    const b = await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z', scheduledVisitId });
    const run = await createRun(service, maker, '2026-11-01', '2026-11-07');

    await service.calculate(run);

    expect(await visitPayLines(a.id)).toHaveLength(1);
    expect(await visitPayLines(b.id)).toHaveLength(1);
  });

  it('SI-02: a supplementary run over a locked period pays only work not yet paid', async () => {
    const employeeId = uuid();
    const paid = await createApprovedVisit(prisma, { employeeId, start: '2026-11-03T09:00:00Z' });
    const first = await createRun(service, maker, '2026-11-01', '2026-11-07');
    await service.calculate(first);
    await approveAndLock(first);

    // Approved late: same period, after the first run was locked.
    const late = await createApprovedVisit(prisma, { employeeId, start: '2026-11-05T09:00:00Z' });
    const supplementary = await createRun(service, maker, '2026-11-01', '2026-11-07');
    await service.calculate(supplementary);

    expect((await visitPayLines(paid.id)).map((l) => l.payrollRunId)).toEqual([first]);
    expect((await visitPayLines(late.id)).map((l) => l.payrollRunId)).toEqual([supplementary]);
  });

  it('SI-01: a second run cannot take over a visit when it locks', async () => {
    const visit = await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z' });
    const runA = await createRun(service, maker, '2026-11-01', '2026-11-07');
    const runB = await createRun(service, maker, '2026-11-01', '2026-11-07');
    await service.calculate(runA);
    await service.calculate(runB);
    await approveAndLock(runA);

    const row = await prisma.visitReconciliation.findUniqueOrThrow({ where: { id: visit.id } });
    expect(row.includedInPayrollRunId).toBe(runA);
    expect(await prisma.payrollRunLine.count({ where: { payrollRunId: runB } })).toBe(0);
  });

  it('SI-01: the database refuses a second original pay line for the same source', async () => {
    const visit = await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z' });
    const runA = await createRun(service, maker, '2026-11-01', '2026-11-07');
    const runB = await createRun(service, maker, '2026-11-01', '2026-11-07');
    await service.calculate(runA);

    await expect(
      prisma.payrollRunLine.create({
        data: {
          payrollRunId: runB,
          visitReconciliationId: visit.id,
          lineType: PayrollRunLineType.VISIT_PAY,
          description: 'duplicate',
          amount: 14,
          claimKey: `VISIT:${visit.id}:VISIT_PAY`,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('SI-08: a failed calculation leaves the run usable and a retry succeeds', async () => {
    const visit = await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z' });
    const run = await createRun(service, maker, '2026-11-01', '2026-11-07');

    const spy = jest
      .spyOn(stubOrgSettings, 'getOperationalTimezone')
      .mockRejectedValueOnce(new Error('simulated failure'));
    await expect(service.calculate(run)).rejects.toThrow('simulated failure');
    spy.mockRestore();

    const afterFailure = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run } });
    expect(afterFailure.status).not.toBe(PayrollRunStatus.CALCULATING);
    expect(await visitPayLines(visit.id)).toHaveLength(0);

    await service.calculate(run);
    expect(await visitPayLines(visit.id)).toHaveLength(1);
  });

  it('a visit changed after calculation must be recalculated before the run can lock', async () => {
    const visit = await createApprovedVisit(prisma, { employeeId: uuid(), start: '2026-11-03T09:00:00Z', amount: 14 });
    const run = await createRun(service, maker, '2026-11-01', '2026-11-07');
    await service.calculate(run);
    await prisma.visitReconciliation.update({ where: { id: visit.id }, data: { payableAmount: 21 } });
    await service.approve(checker, run);

    await expect(service.lock(checker, run)).rejects.toThrow(/changed since this run was calculated/i);

    await service.calculate(run);
    await approveAndLock(run);
    const [line] = await visitPayLines(visit.id);
    expect(Number(line.amount)).toBe(21);
  });

  it('SI-03: an approved pay item is claimed by one run only, also when two runs calculate together', async () => {
    const employeeId = uuid();
    const item = await prisma.employeePayItem.create({
      data: {
        employeeId,
        wageTypeCode: 'BONUS',
        workDate: new Date('2026-11-03'),
        amount: 50,
        reason: 'Synthetic test bonus',
        status: 'APPROVED',
        createdById: maker,
        approvedById: checker,
        approvedAt: new Date(),
      },
    });
    const runA = await createRun(service, maker, '2026-11-01', '2026-11-07');
    const runB = await createRun(service, maker, '2026-11-01', '2026-11-07');

    await Promise.all([service.calculate(runA), service.calculate(runB)]);

    expect(await prisma.payrollRunLine.count({ where: { employeePayItemId: item.id } })).toBe(1);
  });
});
