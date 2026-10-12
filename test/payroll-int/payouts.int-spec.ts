/**
 * Phase 0.3 — nobody is recorded as paid without authorisation and settlement evidence.
 * Audit IDs: SI-09, PR-18, PR-20, SI-15, SI-07.
 */
import { EmployeePayoutBatchStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EmployeePayoutsService } from '../../src/billing/employee-payouts.service';
import {
  buildPayoutsService,
  createAuditSpy,
  createTestPrisma,
  createUkRunWithNetPay,
  resetPayData,
  uuid,
} from './harness';

describe('employee payouts', () => {
  let prisma: PrismaService;
  let payouts: EmployeePayoutsService;
  const audit = createAuditSpy();
  const maker = uuid();
  const checker = uuid();
  const settler = uuid();
  /** The job runs on the 4th for the previous calendar month. */
  const fourthOfDecember = new Date('2026-12-04T06:00:00Z');
  const november = { periodStart: '2026-11-01', periodEnd: '2026-11-30' };
  /** Settlement is recorded after the fact: the value date is today or earlier. */
  const settledOn = new Date().toISOString().slice(0, 10);
  const evidence = { paymentReference: 'BACS-TEST-0001', settledOn, settlementEvidence: 'Bank statement line 14' };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    payouts = buildPayoutsService(prisma, audit).service;
  });
  beforeEach(async () => {
    audit.calls.length = 0;
    await resetPayData(prisma);
  });
  afterAll(() => prisma.$disconnect());

  it('SI-09: the scheduled job proposes a draft batch and never approves or marks it paid', async () => {
    const run = await createUkRunWithNetPay(prisma, { ...november, netPay: { [uuid()]: 812.4, [uuid()]: 455.1 }, status: 'CLOSED' });

    const result = await payouts.executeAutomaticMonthlyPayout(fourthOfDecember);

    const batches = await prisma.employeePayoutBatch.findMany({ where: { ukPayrollRunId: run }, include: { lines: true } });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      status: EmployeePayoutBatchStatus.DRAFT,
      approvedById: null,
      approvedAt: null,
      paidById: null,
      paidAt: null,
      createdById: null,
    });
    expect(batches[0].lines.every((l) => l.status === 'PENDING')).toBe(true);
    expect(result.outcome).toBe('drafted');
  });

  it('SI-09: the job leaves an existing draft or approved batch exactly as it is', async () => {
    const run = await createUkRunWithNetPay(prisma, { ...november, netPay: { [uuid()]: 812.4 }, status: 'CLOSED' });
    const { data: batch } = await payouts.create(maker, { ukPayrollRunId: run } as never);
    await payouts.approve(checker, batch.id);

    await payouts.executeAutomaticMonthlyPayout(fourthOfDecember);
    await payouts.executeAutomaticMonthlyPayout(fourthOfDecember);

    const batches = await prisma.employeePayoutBatch.findMany({ where: { ukPayrollRunId: run } });
    expect(batches).toHaveLength(1);
    expect(batches[0].status).toBe(EmployeePayoutBatchStatus.APPROVED);
    expect(batches[0].paidAt).toBeNull();
  });

  it('PR-18: a payout batch needs a closed UK run, for the job and for a person', async () => {
    const open = await createUkRunWithNetPay(prisma, { ...november, netPay: { [uuid()]: 812.4 }, status: 'STATUTORY_CALCULATED' });

    await expect(payouts.create(maker, { ukPayrollRunId: open } as never)).rejects.toThrow(/closed/i);
    const result = await payouts.executeAutomaticMonthlyPayout(fourthOfDecember);

    expect(result.outcome).toBe('skipped');
    expect(await prisma.employeePayoutBatch.count()).toBe(0);
  });

  it('SI-15: the person who prepared a batch cannot approve it', async () => {
    const run = await createUkRunWithNetPay(prisma, { ...november, netPay: { [uuid()]: 812.4 }, status: 'CLOSED' });
    const { data: batch } = await payouts.create(maker, { ukPayrollRunId: run } as never);

    await expect(payouts.approve(maker, batch.id)).rejects.toThrow(/different user/i);
    await payouts.approve(checker, batch.id);
    const row = await prisma.employeePayoutBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(row).toMatchObject({ status: EmployeePayoutBatchStatus.APPROVED, approvedById: checker });
  });

  it('PR-20: a batch is marked paid only with settlement evidence', async () => {
    const run = await createUkRunWithNetPay(prisma, { ...november, netPay: { [uuid()]: 812.4 }, status: 'CLOSED' });
    const { data: batch } = await payouts.create(maker, { ukPayrollRunId: run } as never);

    await expect(payouts.markPaid(settler, batch.id, evidence as never)).rejects.toThrow(/approved/i);
    await payouts.approve(checker, batch.id);
    await expect(payouts.markPaid(settler, batch.id, {} as never)).rejects.toThrow(/payment reference/i);
    await expect(
      payouts.markPaid(settler, batch.id, { ...evidence, settledOn: '2999-01-01' } as never),
    ).rejects.toThrow(/future/i);
    expect((await prisma.employeePayoutBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe(
      EmployeePayoutBatchStatus.APPROVED,
    );

    await payouts.markPaid(settler, batch.id, evidence as never);

    const row = await prisma.employeePayoutBatch.findUniqueOrThrow({ where: { id: batch.id }, include: { lines: true } });
    expect(row).toMatchObject({
      status: EmployeePayoutBatchStatus.PAID,
      paidById: settler,
      paymentReference: 'BACS-TEST-0001',
      settlementEvidence: 'Bank statement line 14',
    });
    expect(row.settledOn?.toISOString().slice(0, 10)).toBe(settledOn);
    expect(row.lines.every((l) => l.status === 'PAID')).toBe(true);
  });

  it('SI-07: creating, approving, settling and cancelling a batch are audited', async () => {
    const run = await createUkRunWithNetPay(prisma, { ...november, netPay: { [uuid()]: 812.4 }, status: 'CLOSED' });
    const { data: batch } = await payouts.create(maker, { ukPayrollRunId: run } as never);
    await payouts.approve(checker, batch.id);
    await payouts.markPaid(settler, batch.id, evidence as never);
    const other = await createUkRunWithNetPay(prisma, { ...november, netPay: { [uuid()]: 10 }, status: 'CLOSED' });
    const { data: second } = await payouts.create(maker, { ukPayrollRunId: other } as never);
    await payouts.cancel(maker, second.id, 'Created by mistake');

    expect(audit.calls.map((c) => [c.action, c.userId])).toEqual([
      ['employee_payout_batch_created', maker],
      ['employee_payout_batch_approved', checker],
      ['employee_payout_batch_settled', settler],
      ['employee_payout_batch_created', maker],
      ['employee_payout_batch_cancelled', maker],
    ]);
  });
});
