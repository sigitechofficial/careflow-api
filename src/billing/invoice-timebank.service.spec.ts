import { InvoiceRunLineType, Prisma } from '@prisma/client';
import { InvoiceTimebankService } from './invoice-timebank.service';

/** Timebank hours on the weekly invoice (docs/SU_TIMEBANK_INVOICE_PLAN.md). */
describe('InvoiceTimebankService', () => {
  const SU = 'su-1';

  function week(weekStart: string, bank: number) {
    return {
      weekStart,
      weekEnd: '2026-11-01',
      status: 'short',
      addedToBankMinutes: bank,
      shortVisits: [],
    };
  }

  function build(opts: {
    rules?: Record<string, unknown>;
    bank?: number;
    charges?: Array<{
      kind: string;
      minutes: number;
      amount: number;
      weekStart: string | null;
    }>;
    held?: Map<string, number>;
    recons?: Array<{
      id: string;
      scheduledJobId: string;
      billableMinutes: number;
    }>;
  }) {
    const prisma = {
      serviceUser: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: SU, invoiceBillingFrequency: 'WEEKLY' }]),
      },
      invoiceRunLine: { findMany: jest.fn().mockResolvedValue([]) },
      serviceUserTimebankCharge: {
        findMany: jest.fn().mockResolvedValue(
          (opts.charges ?? []).map((c) => ({
            ...c,
            serviceUserId: SU,
            weekStart: c.weekStart
              ? new Date(`${c.weekStart}T00:00:00Z`)
              : null,
            amount: new Prisma.Decimal(c.amount),
            invoiceRun: {
              invoiceNumber: 'RUN-1',
              documents: [{ serviceUserId: SU, invoiceNumber: 'INV-1050' }],
            },
          })),
        ),
      },
      serviceUserFunding: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'f1',
            funderId: null,
            splitPercent: null,
            splitPriority: 0,
            isPrimary: true,
            isActive: true,
            status: 'ACTIVE',
            funder: null,
          },
        ]),
      },
      visitReconciliation: {
        findMany: jest.fn().mockResolvedValue(opts.recons ?? []),
      },
    };
    const orgSettings = {
      getServiceUserWeeklyHoursSettings: jest.fn().mockResolvedValue({
        chargeTimebankOnInvoice: true,
        chargeTimebankFrom: '2026-10-26',
        ...opts.rules,
      }),
      getOperationalDisplaySettings: jest
        .fn()
        .mockResolvedValue({ dateDisplayFormat: 'DD_MM_YYYY' }),
      setChargeTimebankFrom: jest.fn().mockResolvedValue(undefined),
    };
    const timebank = {
      weeksForServiceUser: jest
        .fn()
        .mockResolvedValue({ weeks: [week('2026-10-26', opts.bank ?? 0)] }),
    };
    const ledger = {
      heldByJob: jest.fn().mockResolvedValue(opts.held ?? new Map()),
    };
    const chargeCards = {
      resolveForServiceUser: jest
        .fn()
        .mockResolvedValue({ data: { chargeCard: null } }),
    };
    const service = new InvoiceTimebankService(
      prisma as never,
      orgSettings as never,
      timebank as never,
      ledger as never,
      chargeCards as never,
    );
    return { service, prisma, orgSettings };
  }

  const ctx = (lineData: Prisma.InvoiceRunLineCreateManyInput[] = []) => ({
    runId: 'run-2',
    lineData,
    serviceUserIds: new Set<string>(),
    funderIds: new Set<string>(),
    periodEndIso: '2026-11-08',
    runCadence: 'WEEKLY' as const,
    timeZone: 'Europe/London',
  });

  it('charges nothing when the setting is off', async () => {
    const { service } = build({
      rules: { chargeTimebankOnInvoice: false },
      bank: 120,
    });
    const c = ctx();
    await service.addLines(c);
    expect(c.lineData).toHaveLength(0);
  });

  it('setting off: a charged week that later has fewer hours is still credited', async () => {
    const { service, orgSettings } = build({
      rules: { chargeTimebankOnInvoice: false },
      bank: 60,
      charges: [
        { kind: 'CHARGED', minutes: 120, amount: 40, weekStart: '2026-10-26' },
      ],
    });
    const c = ctx();
    await service.addLines(c);
    expect(c.lineData).toHaveLength(1);
    expect(c.lineData[0]).toMatchObject({ minutes: -60, amount: -20 });
    expect(orgSettings.setChargeTimebankFrom).not.toHaveBeenCalled();
  });

  it('setting off: never charges more hours on a charged week', async () => {
    const { service } = build({
      rules: { chargeTimebankOnInvoice: false },
      bank: 180,
      charges: [
        { kind: 'CHARGED', minutes: 120, amount: 40, weekStart: '2026-10-26' },
      ],
    });
    const c = ctx();
    await service.addLines(c);
    expect(c.lineData).toHaveLength(0);
  });

  it('first run only records the start day (the past bank is never charged)', async () => {
    const { service, orgSettings } = build({
      rules: { chargeTimebankFrom: null },
      bank: 120,
    });
    const c = ctx();
    await service.addLines(c);
    expect(orgSettings.setChargeTimebankFrom).toHaveBeenCalled();
    expect(c.lineData).toHaveLength(0);
  });

  it('does not charge a week again once it is charged in full', async () => {
    const { service } = build({
      bank: 120,
      charges: [
        { kind: 'CHARGED', minutes: 120, amount: 40, weekStart: '2026-10-26' },
      ],
    });
    const c = ctx();
    await service.addLines(c);
    expect(c.lineData).toHaveLength(0);
  });

  it('credits a charged week that later has fewer timebank hours, at the rate it was charged', async () => {
    const { service } = build({
      bank: 60,
      charges: [
        { kind: 'CHARGED', minutes: 120, amount: 40, weekStart: '2026-10-26' },
      ],
    });
    const c = ctx();
    await service.addLines(c);
    expect(c.lineData).toHaveLength(1);
    expect(c.lineData[0]).toMatchObject({
      lineType: InvoiceRunLineType.TIMEBANK_HOURS,
      minutes: -60,
      amount: -20,
    });
    expect(String(c.lineData[0].description)).toContain('Credit');
  });

  it('still credits a charged week from before the start day (setting turned off and on again)', async () => {
    const { service } = build({
      rules: { chargeTimebankFrom: '2026-11-05' },
      bank: 60,
      charges: [
        { kind: 'CHARGED', minutes: 120, amount: 40, weekStart: '2026-10-26' },
      ],
    });
    const c = ctx();
    await service.addLines(c);
    expect(c.lineData).toHaveLength(1);
    expect(c.lineData[0]).toMatchObject({ minutes: -60, amount: -20 });
  });

  it('never charges a week from before the start day that was not charged', async () => {
    const { service } = build({
      rules: { chargeTimebankFrom: '2026-11-05' },
      bank: 120,
    });
    const c = ctx();
    await service.addLines(c);
    expect(c.lineData).toHaveLength(0);
  });

  it('a visit paid from charged timebank hours costs nothing for that part', async () => {
    const visitLine = {
      invoiceRunId: 'run-2',
      visitReconciliationId: 'r1',
      serviceUserId: SU,
      serviceUserFundingId: 'f1',
      funderId: null,
      lineType: InvoiceRunLineType.VISIT_CHARGE,
      description: 'Visit charge',
      minutes: 120,
      amount: 40,
      exceptionMessage: null,
    } as Prisma.InvoiceRunLineCreateManyInput;
    const { service } = build({
      bank: 60,
      charges: [
        { kind: 'CHARGED', minutes: 60, amount: 20, weekStart: '2026-10-26' },
      ],
      held: new Map([['job-1', 90]]),
      recons: [{ id: 'r1', scheduledJobId: 'job-1', billableMinutes: 120 }],
    });
    const c = ctx([visitLine]);
    await service.addLines(c);
    const used = c.lineData.filter(
      (l) => l.lineType === InvoiceRunLineType.TIMEBANK_USED,
    );
    // Only the 60m already charged is free (not the 90m the visit holds): half of £40.
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({
      amount: -20,
      minutes: 60,
      visitReconciliationId: 'r1',
    });
    expect(String(used[0].description)).toBe(
      'Used 1h of the timebank hours already paid (INV-1050) · no charge',
    );
  });

  it('records charged and used hours on lock (split lines counted once)', async () => {
    const { service } = build({});
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const tx = {
      invoiceRunLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            serviceUserId: SU,
            lineType: 'TIMEBANK_HOURS',
            timebankWeekStart: new Date('2026-10-26T00:00:00Z'),
            minutes: 120,
            splitPercent: new Prisma.Decimal(60),
            amount: new Prisma.Decimal(24),
            visitReconciliation: null,
          },
          {
            serviceUserId: SU,
            lineType: 'TIMEBANK_HOURS',
            timebankWeekStart: new Date('2026-10-26T00:00:00Z'),
            minutes: 120,
            splitPercent: new Prisma.Decimal(40),
            amount: new Prisma.Decimal(16),
            visitReconciliation: null,
          },
          {
            serviceUserId: SU,
            lineType: 'TIMEBANK_USED',
            timebankWeekStart: null,
            minutes: 60,
            splitPercent: null,
            amount: new Prisma.Decimal(-20),
            visitReconciliation: { scheduledJobId: 'job-1' },
          },
        ]),
      },
      serviceUserTimebankCharge: { createMany },
    };
    await service.recordOnLock(tx as never, 'run-2');
    const rows = (
      createMany.mock.calls[0] as Array<{
        data: Array<Record<string, unknown>>;
      }>
    )[0].data;
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'CHARGED',
        minutes: 120,
        amount: 40,
      }) as unknown,
      expect.objectContaining({
        kind: 'USED',
        minutes: 60,
        amount: -20,
        scheduledJobId: 'job-1',
      }) as unknown,
    ]);
  });
});
