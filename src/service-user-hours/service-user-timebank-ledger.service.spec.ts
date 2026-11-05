import { ScheduledJobStatus, ServiceUserTimebankEntryKind } from '@prisma/client';
import { ServiceUserTimebankLedgerService, TimebankBudget } from './service-user-timebank-ledger.service';

/** Timebank ledger (docs/SU_TIMEBANK_USE_PLAN.md): all-or-nothing cover and giving time back. */
describe('TimebankBudget', () => {
  it('covers the hours over only when the bank has all of them', () => {
    const budget = new TimebankBudget(true, 90, new Map());
    expect(budget.cover('2026-11-09', 120)).toBe(false);
    expect(budget.availableMinutes).toBe(90);
    expect(budget.cover('2026-11-09', 60)).toBe(true);
    expect(budget.availableMinutes).toBe(30);
    expect(budget.reservedIn('2026-11-09')).toBe(60);
  });

  it('never covers when the setting is off, but keeps what visits already hold', () => {
    const budget = new TimebankBudget(false, 600, new Map([['2026-11-09', 45]]));
    expect(budget.cover('2026-11-09', 30)).toBe(false);
    expect(budget.reservedIn('2026-11-09')).toBe(45);
  });
});

describe('ServiceUserTimebankLedgerService.settle', () => {
  const RESERVED = ServiceUserTimebankEntryKind.RESERVED;
  type Entry = { scheduledJobId: string | null; kind: ServiceUserTimebankEntryKind; minutes: number; weekStart: Date };
  const entry = (jobId: string | null, minutes: number, week = '2026-11-09'): Entry => ({
    scheduledJobId: jobId,
    kind: RESERVED,
    minutes,
    weekStart: new Date(`${week}T00:00:00Z`),
  });
  const week = (over: Partial<Record<string, unknown>>) => ({
    weekStart: '2026-11-09',
    status: 'current',
    setMinutes: 1200,
    createdMinutes: 1500,
    deliveredMinutes: 0,
    pendingMinutes: 0,
    scheduledMinutes: 0,
    awaitingMinutes: 0,
    chargeableCancelMinutes: 0,
    ...over,
  });

  function build(entries: Entry[], jobs: unknown[], weeks: unknown[], weeklyHours = 20) {
    const created: unknown[] = [];
    const prisma = {
      serviceUserTimebankEntry: {
        findMany: jest.fn().mockResolvedValue(entries),
        createMany: jest.fn().mockImplementation(({ data }) => {
          created.push(...data);
          return Promise.resolve({ count: data.length });
        }),
      },
      scheduledJob: { findMany: jest.fn().mockResolvedValue(jobs) },
    };
    const timebank = {
      weeksForServiceUser: jest.fn().mockResolvedValue({
        weeks,
        earnedMinutes: 600,
        currentWeeklyHours: weeklyHours,
        currentMonday: '2026-11-09',
        timeZone: 'Europe/London',
      }),
    };
    const service = new ServiceUserTimebankLedgerService(prisma as never, {} as never, timebank as never);
    return { service, created };
  }
  const job = (id: string, start: string, over: Record<string, unknown> = {}) => ({
    id,
    status: ScheduledJobStatus.ALLOCATED,
    deletedAt: null,
    scheduledStartDateTime: new Date(start),
    cancellation: null,
    ...over,
  });

  it('a cancelled visit gives all its reserved time back', async () => {
    const { service, created } = build(
      [entry('a', 120)],
      [job('a', '2026-11-12T09:00:00Z', { status: ScheduledJobStatus.CANCELLED })],
      [week({ createdMinutes: 1200 })],
    );
    await service.settle('su');
    expect(created).toEqual([expect.objectContaining({ scheduledJobId: 'a', minutes: 120, reason: 'VISIT_CANCELLED' })]);
  });

  it('a week that needs less gives back from the latest visit first', async () => {
    // 20h set, 21h on the rota → needs 1h; visits hold 2h + 1h.
    const { service, created } = build(
      [entry('early', 120), entry('late', 60)],
      [job('early', '2026-11-10T09:00:00Z'), job('late', '2026-11-13T09:00:00Z')],
      [week({ createdMinutes: 1260 })],
    );
    await service.settle('su');
    expect(created).toEqual([
      expect.objectContaining({ scheduledJobId: 'late', minutes: 60, reason: 'WEEK_NEEDED_LESS' }),
      expect.objectContaining({ scheduledJobId: 'early', minutes: 60, reason: 'WEEK_NEEDED_LESS' }),
    ]);
  });

  it('a finished week gives back what was not delivered', async () => {
    // 20h set, 21h counted (delivered + pending) → used 1h of the 2h held.
    const { service, created } = build(
      [entry('a', 120)],
      [job('a', '2026-11-12T09:00:00Z', { status: ScheduledJobStatus.MISSED })],
      [week({ status: 'complete', deliveredMinutes: 1200, pendingMinutes: 60 })],
    );
    await service.settle('su');
    expect(created).toEqual([expect.objectContaining({ scheduledJobId: 'a', minutes: 60, reason: 'NOT_DELIVERED' })]);
  });

  it('a visit cancelled with a Charge decision keeps the hours it took from the bank', async () => {
    const charged = {
      cancelledAt: new Date('2026-11-12T03:00:00Z'),
      chargeDecision: 'CHARGE',
      policySnapshot: { timebank: 'CHARGEABLE_NOT_BANKED' },
      reinstatedAt: null,
    };
    const { service, created } = build(
      [entry('a', 120)],
      [job('a', '2026-11-12T09:00:00Z', { status: ScheduledJobStatus.CANCELLED, cancellation: charged })],
      [week({ createdMinutes: 1200 })],
    );
    await service.settle('su');
    expect(created).toEqual([]);
  });

  it('an older Charge cancellation (no timebank marker) still gives the hours back', async () => {
    const { service, created } = build(
      [entry('a', 120)],
      [
        job('a', '2026-11-12T09:00:00Z', {
          status: ScheduledJobStatus.CANCELLED,
          cancellation: { cancelledAt: null, chargeDecision: 'CHARGE', policySnapshot: null, reinstatedAt: null },
        }),
      ],
      [week({ createdMinutes: 1200 })],
    );
    await service.settle('su');
    expect(created).toEqual([expect.objectContaining({ scheduledJobId: 'a', minutes: 120, reason: 'VISIT_CANCELLED' })]);
  });

  it('a finished week does not count a charged visit\'s held hours again for the other visits', async () => {
    // 20h set: 19h delivered + visit a (1h, held) delivered + visit b (1h, held) charged → over 1h, held by b.
    const charged = {
      cancelledAt: null,
      chargeDecision: 'CHARGE',
      policySnapshot: { timebank: 'CHARGEABLE_NOT_BANKED' },
      reinstatedAt: null,
    };
    const { service, created } = build(
      [entry('a', 60), entry('b', 60)],
      [
        job('a', '2026-11-10T09:00:00Z', { status: ScheduledJobStatus.COMPLETED }),
        job('b', '2026-11-12T09:00:00Z', { status: ScheduledJobStatus.CANCELLED, cancellation: charged }),
      ],
      [week({ status: 'complete', deliveredMinutes: 1200, chargeableCancelMinutes: 60 })],
    );
    await service.settle('su');
    expect(created).toEqual([expect.objectContaining({ scheduledJobId: 'a', minutes: 60, reason: 'NOT_DELIVERED' })]);
  });

  it('nothing to give back while the week still needs it', async () => {
    const { service, created } = build(
      [entry('a', 120)],
      [job('a', '2026-11-12T09:00:00Z')],
      [week({ createdMinutes: 1320 })],
    );
    await service.settle('su');
    expect(created).toEqual([]);
  });
});
