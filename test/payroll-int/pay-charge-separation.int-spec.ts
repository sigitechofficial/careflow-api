/**
 * Gate A sprint, R-07 — settled carer pay does not block, and is not changed by, decisions about
 * the client charge. Audit IDs: VW-06, VW-22.
 */
import { VisitOverrunDecision } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
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

describe('pay and client charge are decided separately', () => {
  let prisma: PrismaService;
  let runs: PayrollRunsService;
  let recons: VisitReconciliationsService;
  let payCardId: string;
  const audit = createAuditSpy();
  const maker = uuid();
  const checker = uuid();

  /** A 60-minute visit that ran 90 minutes; pay locked on the given basis (£14/hr pay, £24/hr charge). */
  const paidOverrunVisit = async (payBasis: 'PLANNED' | 'ACTUAL' = 'PLANNED', actualMinutes = 90) => {
    const fixture = await createCompletedVisit(prisma, { start: '2026-11-03T09:00:00Z', actualMinutes });
    const id = (await recons.ensureForVisit(fixture.visitId))!;
    if (payBasis === 'ACTUAL') {
      await recons.approveOverrun(checker, id, { timeBasis: 'ACTUAL', applyTo: 'PAY' } as never);
    }
    await recons.approve(checker, id, { scope: 'PAY', managerOverride: true } as never);
    const run = await createRun(runs, maker, '2026-11-01', '2026-11-07');
    await runs.calculate(run);
    await runs.approve(checker, run);
    await runs.lock(checker, run);
    return { ...fixture, id, run };
  };
  const snapshot = async (id: string) => {
    const row = await prisma.visitReconciliation.findUniqueOrThrow({ where: { id } });
    return {
      pay: {
        amount: Number(row.payableAmount),
        minutes: row.payableMinutes,
        start: row.approvedPayStart?.toISOString(),
        end: row.approvedPayEnd?.toISOString(),
        run: row.includedInPayrollRunId,
        status: row.status,
      },
      charge: { amount: Number(row.billableAmount), minutes: row.billableMinutes },
      row,
    };
  };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    runs = buildPayrollRunsService(prisma).service;
  });
  beforeEach(async () => {
    audit.calls.length = 0;
    await resetPayData(prisma);
    const built = await buildReconciliationService(prisma, { audit });
    recons = built.service;
    payCardId = built.card.id;
  });
  afterAll(() => prisma.$disconnect());

  it('E2E-13: the overrun of a paid visit can be charged on actual time; pay history is unchanged', async () => {
    const visit = await paidOverrunVisit('PLANNED');
    const before = await snapshot(visit.id);
    expect(before.pay).toMatchObject({ amount: 14, minutes: 60 });
    expect(before.charge).toMatchObject({ amount: 24, minutes: 60 });

    await recons.approveOverrun(checker, visit.id, {
      applyTo: 'CHARGE',
      timeBasis: 'ACTUAL',
      notes: 'Commissioner agreed the extra time',
    } as never);

    const after = await snapshot(visit.id);
    expect(after.charge).toMatchObject({ amount: 36, minutes: 90 });
    expect(after.pay).toEqual(before.pay);
    expect(after.row.overrunDecision).toBe(VisitOverrunDecision.APPROVED);
    expect(after.row.overrunPayBasis).toBe('PLANNED'); // what the carer was actually paid on
    expect(audit.calls.some((c) => c.action === 'visit_reconciliation_overrun_decided' && c.userId === checker)).toBe(true);

    // And back to planned for the charge: still no effect on pay.
    await recons.rejectOverrun(checker, visit.id, { notes: 'Charge planned time after all' } as never);
    const reverted = await snapshot(visit.id);
    expect(reverted.charge).toMatchObject({ amount: 24, minutes: 60 });
    expect(reverted.pay).toEqual(before.pay);
  });

  it('a decision that would touch settled pay is still refused', async () => {
    const visit = await paidOverrunVisit('PLANNED');
    const before = await snapshot(visit.id);
    await expect(
      recons.approveOverrun(checker, visit.id, { applyTo: 'PAY', timeBasis: 'ACTUAL' } as never),
    ).rejects.toThrow(/pay correction/i);
    await expect(
      recons.approveOverrun(checker, visit.id, { applyTo: 'BOTH', timeBasis: 'ACTUAL' } as never),
    ).rejects.toThrow(/charge only/i);
    await expect(recons.approveOverrun(checker, visit.id, { timeBasis: 'ACTUAL' } as never)).rejects.toThrow(
      /charge only/i,
    );
    expect((await snapshot(visit.id)).pay).toEqual(before.pay);
  });

  it('a carer paid on actual time keeps that basis when the charge is decided later', async () => {
    const visit = await paidOverrunVisit('ACTUAL');
    const before = await snapshot(visit.id);
    expect(before.pay).toMatchObject({ amount: 21, minutes: 90 });

    await recons.rejectOverrun(checker, visit.id, { notes: 'Charge the planned hour only' } as never);

    const after = await snapshot(visit.id);
    expect(after.pay).toEqual(before.pay);
    expect(after.charge).toMatchObject({ amount: 24, minutes: 60 });
    expect(after.row.overrunDecision).toBe(VisitOverrunDecision.APPROVED);
    expect(after.row.overrunPayBasis).toBe('ACTUAL');
    expect(after.row.overrunBillBasis).toBe('PLANNED');
  });

  it('the charge quantity and amount of a paid visit can be corrected without touching pay', async () => {
    // A visit that ran to plan (the charge window of an overrun visit follows the overrun decision).
    const visit = await paidOverrunVisit('PLANNED', 60);
    const before = await snapshot(visit.id);

    await recons.update(visit.id, { approvedBillEnd: '2026-11-03T09:45:00.000Z' } as never, checker);
    await recons.recalculateAmounts({ ids: [visit.id], reason: 'Charge window corrected' } as never, checker);
    const shorter = await snapshot(visit.id);
    expect(shorter.charge.minutes).toBe(45);
    expect(shorter.pay).toEqual(before.pay);

    await recons.setBillableAmount(checker, visit.id, { billableAmount: 30, notes: 'Agreed with funder' } as never);
    const manual = await snapshot(visit.id);
    expect(manual.charge.amount).toBe(30);
    // Setting the charge also approves it for invoicing: the pay approval is kept alongside it.
    expect(manual.pay).toEqual({ ...before.pay, status: 'APPROVED_FOR_BOTH' });
  });

  it('recalculating after pay and charge rates change reprices the charge and leaves settled pay alone', async () => {
    const visit = await paidOverrunVisit('PLANNED');
    const before = await snapshot(visit.id);
    await prisma.chargeCardRule.updateMany({ data: { amount: 30 } });
    await prisma.payCardRule.updateMany({ where: { payCardId }, data: { amount: 99 } });

    await recons.recalculateAmounts({ ids: [visit.id], reason: 'Charge rate corrected' } as never, checker);

    const after = await snapshot(visit.id);
    expect(after.charge.amount).toBe(30);
    expect(after.pay).toEqual(before.pay);
  });
});
