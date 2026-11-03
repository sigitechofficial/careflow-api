import { VisitPlanWeeklyHoursService, mondayOfIso } from './visit-plan-weekly-hours.service';
import { TimebankBudget } from '../service-user-hours/service-user-timebank-ledger.service';

/** Service user weekly hours counted from the rota (docs/SU_WEEKLY_HOURS_SIMPLIFY_PLAN.md S11–S13). */
describe('VisitPlanWeeklyHoursService (rota count)', () => {
  const tz = 'Europe/London';
  const job = (startIso: string, minutes: number, carers = 1, metadata: Record<string, unknown> = {}) => ({
    scheduledStartDateTime: new Date(startIso),
    scheduledEndDateTime: new Date(new Date(startIso).getTime() + minutes * 60000),
    estimatedDurationMinutes: minutes,
    requiredCarers: carers,
    metadata,
  });

  function build(jobs: ReturnType<typeof job>[], opts?: { limit?: string | null; specialVisitsCount?: boolean }) {
    const prisma = {
      scheduledJob: { findMany: jest.fn().mockResolvedValue(jobs) },
      serviceUserDomCare: { findFirst: jest.fn().mockResolvedValue({ weeklyContractedHours: opts?.limit ?? '5' }) },
      serviceUserVisitPlan: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const orgSettings = {
      getOperationalDisplaySettings: jest.fn().mockResolvedValue({ timeZone: tz, dateDisplayFormat: 'DD_MM_YYYY' }),
      getServiceUserWeeklyHoursSettings: jest.fn().mockResolvedValue({
        changeNeedsApproval: true,
        visitsNeedApproval: true,
        specialVisitsCount: opts?.specialVisitsCount ?? true,
      }),
      getOperationalTimezone: jest.fn().mockResolvedValue(tz),
    };
    const service = new VisitPlanWeeklyHoursService(prisma as never, orgSettings as never);
    jest.spyOn(service, 'limit').mockResolvedValue(opts?.limit === null ? null : Number(opts?.limit ?? '5'));
    return { service, prisma };
  }

  it('Monday of a week', () => {
    expect(mondayOfIso('2026-11-11')).toBe('2026-11-09');
    expect(mondayOfIso('2026-11-09')).toBe('2026-11-09');
    expect(mondayOfIso('2026-11-15')).toBe('2026-11-09');
  });

  it('a visit counts its time for every carer it needs', () => {
    expect(VisitPlanWeeklyHoursService.jobMinutes(job('2026-11-10T09:00:00Z', 60, 2))).toBe(120);
    expect(VisitPlanWeeklyHoursService.jobMinutes(job('2026-11-10T09:00:00Z', 45, 0))).toBe(45);
  });

  it('counts rota visits per day; special visits only when the setting says so', async () => {
    const jobs = [
      job('2026-11-10T09:00:00Z', 60),
      job('2026-11-10T14:00:00Z', 30, 2),
      job('2026-11-11T10:00:00Z', 90, 1, { special: true }),
    ];
    const on = build(jobs);
    const byDay = await on.service.rotaMinutesByDay(on.prisma as never, 'su', '2026-11-09', '2026-11-15');
    expect(byDay.get('2026-11-10')?.minutes).toBe(120);
    expect(byDay.get('2026-11-11')?.minutes).toBe(90);
    const off = build(jobs, { specialVisitsCount: false });
    const noSpecial = await off.service.rotaMinutesByDay(off.prisma as never, 'su', '2026-11-09', '2026-11-15');
    expect(noSpecial.get('2026-11-11')).toBeUndefined();
  });

  it('new visits in time order: from the one that crosses the limit on, the rest of that week is over', async () => {
    // 5h limit; the week already has 3h on the rota.
    const { service } = build([job('2026-11-09T09:00:00Z', 180)]);
    const result = await service.classifyNewVisits({
      serviceUserId: 'su',
      visits: [
        { date: '2026-11-12', startsAt: '2026-11-12T09:00', minutes: 60 },
        { date: '2026-11-10', startsAt: '2026-11-10T09:00', minutes: 60 },
        { date: '2026-11-11', startsAt: '2026-11-11T09:00', minutes: 60 },
      ],
    });
    expect(result.visits.map((v) => [v.date, v.over, v.weekMinutes])).toEqual([
      ['2026-11-10', false, 240],
      ['2026-11-11', false, 300],
      ['2026-11-12', true, 360],
    ]);
  });

  it('timebank: pays for the hours over only when it has all of them; held minutes widen the week', async () => {
    // 5h limit; 4h on the rota, 1h of it already held from the bank (so the week has room for 6h).
    const { service } = build([job('2026-11-09T09:00:00Z', 240)]);
    const budget = new TimebankBudget(true, 90, new Map([['2026-11-09', 60]]));
    const result = await service.classifyNewVisits({
      serviceUserId: 'su',
      budget,
      visits: [
        { date: '2026-11-10', startsAt: '2026-11-10T09:00', minutes: 120 },
        { date: '2026-11-11', startsAt: '2026-11-11T09:00', minutes: 60 },
      ],
    });
    // 4h + 2h = 6h fits 5h + 1h held; then 7h is 1h over → the bank (90m) pays 60m.
    expect(result.visits.map((v) => [v.date, v.over, v.fromTimebankMinutes])).toEqual([
      ['2026-11-10', false, 0],
      ['2026-11-11', false, 60],
    ]);
    expect(budget.availableMinutes).toBe(30);
    // The rota now has the 7h made above.
    const after = build([job('2026-11-09T09:00:00Z', 240), job('2026-11-10T09:00:00Z', 120), job('2026-11-11T09:00:00Z', 60)]);
    const more = await after.service.classifyNewVisits({
      serviceUserId: 'su',
      budget,
      visits: [{ date: '2026-11-12', startsAt: '2026-11-12T09:00', minutes: 60 }],
    });
    // 30m left cannot pay for 60m: over as before, the bank untouched.
    expect(more.visits[0]).toMatchObject({ over: true, fromTimebankMinutes: 0 });
    expect(budget.availableMinutes).toBe(30);
  });

  it('no weekly hours set: nothing is over', async () => {
    const { service } = build([job('2026-11-09T09:00:00Z', 600)], { limit: null });
    const result = await service.classifyNewVisits({
      serviceUserId: 'su',
      visits: [{ date: '2026-11-10', startsAt: '2026-11-10T09:00', minutes: 600 }],
    });
    expect(result.visits[0].over).toBe(false);
  });

  it('a longer visit is over only when it adds time past the limit', async () => {
    const { service } = build([job('2026-11-09T09:00:00Z', 240)]);
    const longer = await service.checkLongerVisit({
      serviceUserId: 'su',
      date: '2026-11-09',
      oldMinutes: 60,
      newMinutes: 180,
    });
    expect(longer).toMatchObject({ weekMinutes: 360, over: true });
    const shorter = await service.checkLongerVisit({
      serviceUserId: 'su',
      date: '2026-11-09',
      oldMinutes: 60,
      newMinutes: 30,
    });
    expect(shorter.over).toBe(false);
  });
});
