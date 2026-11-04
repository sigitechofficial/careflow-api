/**
 * Late charges: a visit approved for invoicing after the invoice run for its dates was finished is
 * billed by the next invoice run, once. A date still covered by another open run stays with it.
 * All data is synthetic.
 */
import { InvoiceRunStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { InvoiceRunsService } from '../../src/billing/invoice-runs.service';
import { createApprovedVisit, createTestPrisma, resetPayData, stubOrgSettings, uuid } from './harness';

describe('invoice runs: late charges', () => {
  let prisma: PrismaService;
  let service: InvoiceRunsService;
  const user = uuid();

  const invoiceRun = (periodStart: string, periodEnd: string, status: InvoiceRunStatus) =>
    prisma.invoiceRun.create({
      data: { periodLabel: `Test ${periodStart}`, periodStart: new Date(periodStart), periodEnd: new Date(periodEnd), status } as never,
    });
  const billable = (start: string) =>
    createApprovedVisit(prisma, { employeeId: uuid(), start }).then((v) =>
      prisma.visitReconciliation.update({
        where: { id: v.id },
        data: { approvedBillStart: v.approvedPayStart, approvedBillEnd: v.approvedPayEnd, billableMinutes: 60, billableAmount: 32 },
      }),
    );
  const linesOf = (runId: string) => prisma.invoiceRunLine.findMany({ where: { invoiceRunId: runId } });

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    service = new (InvoiceRunsService as unknown as new (...args: unknown[]) => InvoiceRunsService)(
      prisma,
      { ensureOrganisationDefaultTemplate: async () => undefined, resolveForServiceUser: async () => null },
      {},
      stubOrgSettings,
    );
  });
  beforeEach(async () => {
    await prisma.invoiceRunLine.deleteMany();
    await prisma.invoiceRun.deleteMany();
    await resetPayData(prisma);
  });
  afterAll(() => prisma.$disconnect());

  it('bills a visit from a finished run’s dates in the next run, as a late charge', async () => {
    await invoiceRun('2026-10-19', '2026-10-25', InvoiceRunStatus.PAID);
    const late = await billable('2026-10-23T09:00:00Z');
    const next = await invoiceRun('2026-10-26', '2026-11-01', InvoiceRunStatus.DRAFT);

    await service.calculate(user, next.id);

    const lines = await linesOf(next.id);
    expect(lines.map((l) => l.visitReconciliationId)).toEqual([late.id]);
    expect(lines[0].description).toBe(`Late charge (visit on 2026-10-23) — ${late.visitRef}`);
  });

  it('leaves a visit to the open run that covers its date', async () => {
    const open = await invoiceRun('2026-10-19', '2026-10-25', InvoiceRunStatus.DRAFT);
    const visit = await billable('2026-10-23T09:00:00Z');
    const next = await invoiceRun('2026-10-26', '2026-11-01', InvoiceRunStatus.DRAFT);

    await service.calculate(user, next.id);
    expect(await linesOf(next.id)).toHaveLength(0);

    await service.calculate(user, open.id);
    const lines = await linesOf(open.id);
    expect(lines.map((l) => l.visitReconciliationId)).toEqual([visit.id]);
    expect(lines[0].description).toBe(`Visit charge — ${visit.visitRef}`);
  });

  it('a late charge is billed by one run only', async () => {
    const late = await billable('2026-10-23T09:00:00Z');
    const first = await invoiceRun('2026-10-26', '2026-11-01', InvoiceRunStatus.DRAFT);
    await service.calculate(user, first.id);
    const second = await invoiceRun('2026-11-02', '2026-11-08', InvoiceRunStatus.DRAFT);
    await service.calculate(user, second.id);

    expect((await linesOf(first.id)).map((l) => l.visitReconciliationId)).toEqual([late.id]);
    expect(await linesOf(second.id)).toHaveLength(0);
  });
});
