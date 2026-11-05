import { ServiceUserOverCareService } from './service-user-over-care.service';

/** Over care taken back the next week (docs/SU_OVER_CARE_ADJUST_PLAN.md). Runs on Monday 9 Nov 2026. */
/** `expect.objectContaining` typed as unknown (it returns any). */
const containing = (o: Record<string, unknown>): unknown =>
  expect.objectContaining(o) as unknown;

describe('ServiceUserOverCareService.runWeekly', () => {
  const SU = 'su-1';

  function week(weekStart: string, extra: Record<string, unknown> = {}) {
    return {
      weekStart,
      status: 'complete',
      weeklyHours: 10,
      setMinutes: 600,
      deliveredMinutes: 0,
      pendingMinutes: 0,
      scheduledMinutes: 0,
      awaitingMinutes: 0,
      ...extra,
    };
  }

  function job(id: string, metadata: unknown, minutes: number) {
    const start = new Date('2026-11-05T10:00:00Z');
    return {
      id,
      metadata,
      scheduledStartDateTime: start,
      scheduledEndDateTime: new Date(start.getTime() + minutes * 60000),
      estimatedDurationMinutes: null,
      requiredCarers: 1,
    };
  }

  function build(opts: {
    rules?: Record<string, unknown>;
    lastWeek?: Record<string, unknown>;
    reserved?: number;
    approvedJobMinutes?: number;
    /** An approved visit plan extra visit (linked by its plan exception). */
    approvedExtraMinutes?: number;
    /** A visit a manager approved longer: only the extra minutes are approved. */
    approvedLonger?: {
      kind: 'PLAN_TIME' | 'EXTRA_EDIT';
      jobMinutes: number;
      extra: number;
    };
    existing?: boolean;
    activePlan?: boolean;
    toCancel?: Array<{ scheduledJobId: string; minutes: number }>;
    stillOver?: number;
  }) {
    const rules = {
      adjustOverCareNextWeek: true,
      adjustOverCareFrom: '2026-10-26',
      ...opts.rules,
    };
    const prisma = {
      serviceUserOverCareAdjustment: {
        findUnique: jest
          .fn()
          .mockResolvedValue(opts.existing ? { id: 'row' } : null),
        create: jest.fn().mockResolvedValue({}),
      },
      serviceUserVisitPlan: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.activePlan === false ? null : { id: 'plan-1' },
          ),
      },
      employeeHoursApproval: {
        findMany: jest.fn().mockResolvedValue([
          ...(opts.approvedJobMinutes
            ? [{ requestPayload: { createdJobId: 'job-approved' } }]
            : []),
          ...(opts.approvedExtraMinutes
            ? [{ requestPayload: { createdExceptionId: 'exc-1' } }]
            : []),
          ...(opts.approvedLonger?.kind === 'PLAN_TIME'
            ? [
                {
                  requestPayload: {
                    kind: 'PLAN_TIME',
                    heldDeltas: [{ date: '2026-11-05', minutes: 15 }],
                    planTimeChange: {
                      held: [
                        {
                          jobId: 'job-longer',
                          minutes: opts.approvedLonger.extra,
                        },
                      ],
                    },
                  },
                },
              ]
            : []),
          ...(opts.approvedLonger?.kind === 'EXTRA_EDIT'
            ? [
                {
                  requestPayload: {
                    kind: 'EXTRA_EDIT',
                    createdJobId: 'job-longer',
                    heldDeltas: [
                      {
                        date: '2026-11-05',
                        minutes: opts.approvedLonger.extra,
                      },
                    ],
                  },
                },
              ]
            : []),
        ]),
      },
      scheduledJob: {
        findMany: jest.fn().mockResolvedValue([
          ...(opts.approvedJobMinutes
            ? [job('job-approved', null, opts.approvedJobMinutes)]
            : []),
          ...(opts.approvedExtraMinutes
            ? [
                job(
                  'job-extra',
                  { visitPlanExceptionId: 'exc-1' },
                  opts.approvedExtraMinutes,
                ),
              ]
            : []),
          ...(opts.approvedLonger
            ? [job('job-longer', null, opts.approvedLonger.jobMinutes)]
            : []),
          // A visit of the week nobody approved: never left out.
          job('job-plain', null, 45),
        ]),
      },
    };
    const orgSettings = {
      getServiceUserWeeklyHoursSettings: jest.fn().mockResolvedValue(rules),
      getOperationalDisplaySettings: jest.fn().mockResolvedValue({
        timeZone: 'Europe/London',
        dateDisplayFormat: 'DD/MM/YYYY',
      }),
      setAdjustOverCareFrom: jest.fn().mockResolvedValue(undefined),
    };
    const lastWeek = week('2026-11-02', opts.lastWeek);
    const timebank = {
      list: jest.fn().mockResolvedValue({
        rows: [
          {
            id: SU,
            name: 'Ray Okonkwo',
            overMinutes: 1,
            overCareAdjustment: null,
          },
        ],
      }),
      weeksForServiceUser: jest.fn().mockResolvedValue({
        weeks: [lastWeek, week('2026-11-09', { status: 'current' })],
        timeZone: 'Europe/London',
      }),
    };
    const ledger = {
      balance: jest.fn().mockResolvedValue({
        reservedByWeek: new Map(
          opts.reserved ? [['2026-11-02', opts.reserved]] : [],
        ),
      }),
    };
    const toCancel = (opts.toCancel ?? []).map((v) => ({
      ...v,
      date: '2026-11-15',
    }));
    const dateChanges = {
      planVisitCut: jest.fn().mockResolvedValue({
        toCancel,
        stillOverWeeks: opts.stillOver
          ? [{ weekStart: '2026-11-09', minutes: opts.stillOver }]
          : [],
      }),
      applyVisitCut: jest
        .fn()
        .mockResolvedValue({ cancelled: toCancel.length }),
    };
    const hook = {
      notifyOverCareTakenBack: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ServiceUserOverCareService(
      prisma as never,
      orgSettings as never,
      timebank as never,
      ledger as never,
      dateChanges as never,
      hook as never,
    );
    return { service, prisma, orgSettings, dateChanges, hook };
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-09T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('cancels next week visits for the over care and records it once', async () => {
    const { service, prisma, dateChanges, hook } = build({
      lastWeek: { deliveredMinutes: 600, pendingMinutes: 120 },
      toCancel: [{ scheduledJobId: 'job-sun', minutes: 120 }],
    });
    const res = await service.runWeekly('user-1');
    expect(res).toEqual({ adjusted: 1, cancelledVisits: 1 });
    // 10h this week − 2h over = 8h for the week of 9 Nov.
    expect(dateChanges.planVisitCut).toHaveBeenCalledWith(SU, 480, {
      onlyWeek: '2026-11-09',
    });
    const note = (dateChanges.applyVisitCut.mock.calls[0] as unknown[])[3];
    expect(note).toBe('Over care adjustment — week of 02/11/2026 had 2h over');
    expect(prisma.serviceUserOverCareAdjustment.create).toHaveBeenCalledWith({
      data: containing({
        serviceUserId: SU,
        careGivenMinutes: 720,
        overMinutes: 120,
        excludedMinutes: 0,
        cancelledMinutes: 120,
        takenBackMinutes: 120,
        notTakenBackMinutes: 0,
        cancelledJobIds: ['job-sun'],
      }),
    });
    expect(hook.notifyOverCareTakenBack).toHaveBeenCalledTimes(1);
  });

  it('leaves out timebank-paid and manager-approved over minutes', async () => {
    const { service, dateChanges, prisma } = build({
      lastWeek: { deliveredMinutes: 780 },
      reserved: 60,
      approvedJobMinutes: 60,
      toCancel: [{ scheduledJobId: 'job-sun', minutes: 60 }],
    });
    await service.runWeekly('user-1');
    // 3h over − 1h bank − 1h approved = 1h taken back.
    expect(dateChanges.planVisitCut).toHaveBeenCalledWith(SU, 540, {
      onlyWeek: '2026-11-09',
    });
    expect(prisma.serviceUserOverCareAdjustment.create).toHaveBeenCalledWith({
      data: containing({ overMinutes: 60, excludedMinutes: 120 }),
    });
  });

  it('leaves out a visit plan extra visit a manager approved over the hours', async () => {
    const { service, dateChanges, prisma } = build({
      lastWeek: { deliveredMinutes: 780 },
      approvedExtraMinutes: 60,
      toCancel: [{ scheduledJobId: 'job-sun', minutes: 120 }],
    });
    await service.runWeekly('user-1');
    // 3h over − 1h approved extra visit = 2h taken back.
    expect(dateChanges.planVisitCut).toHaveBeenCalledWith(SU, 480, {
      onlyWeek: '2026-11-09',
    });
    expect(prisma.serviceUserOverCareAdjustment.create).toHaveBeenCalledWith({
      data: containing({ overMinutes: 120, excludedMinutes: 60 }),
    });
  });

  it.each(['PLAN_TIME', 'EXTRA_EDIT'] as const)(
    'leaves out only the extra minutes of a visit approved longer (%s)',
    async (kind) => {
      const { service, prisma } = build({
        lastWeek: { deliveredMinutes: 780 },
        // The visit is 45m now; the manager approved 15m more than it was.
        approvedLonger: { kind, jobMinutes: 45, extra: 15 },
        toCancel: [{ scheduledJobId: 'job-sun', minutes: 180 }],
      });
      await service.runWeekly('user-1');
      // 3h over − 15m approved = 2h 45m taken back (not the whole 45m visit).
      expect(prisma.serviceUserOverCareAdjustment.create).toHaveBeenCalledWith({
        data: containing({ overMinutes: 165, excludedMinutes: 15 }),
      });
    },
  );

  it('records what the next week could not take back', async () => {
    const { service, prisma } = build({
      lastWeek: { deliveredMinutes: 780 },
      toCancel: [{ scheduledJobId: 'job-sun', minutes: 60 }],
      // After the cut the week still has 8h 30m against a 7h limit: 1h 30m not taken back.
      stillOver: 510,
    });
    await service.runWeekly('user-1');
    expect(prisma.serviceUserOverCareAdjustment.create).toHaveBeenCalledWith({
      data: containing({
        overMinutes: 180,
        takenBackMinutes: 90,
        notTakenBackMinutes: 90,
      }),
    });
  });

  it('counts over care above the whole next week as not taken back', async () => {
    const { service, dateChanges, prisma } = build({
      // 23h given against 10h: 13h over, more than the next week's 10h.
      lastWeek: { deliveredMinutes: 1380 },
      toCancel: [{ scheduledJobId: 'job-sun', minutes: 480 }],
      // Limit 0; the Monday kept (2h) is still over it.
      stillOver: 120,
    });
    await service.runWeekly('user-1');
    expect(dateChanges.planVisitCut).toHaveBeenCalledWith(SU, 0, {
      onlyWeek: '2026-11-09',
    });
    // 13h over, next week 10h: 3h above the week + 2h kept = 5h not taken back, 8h taken back.
    expect(prisma.serviceUserOverCareAdjustment.create).toHaveBeenCalledWith({
      data: containing({
        overMinutes: 780,
        cancelledMinutes: 480,
        takenBackMinutes: 480,
        notTakenBackMinutes: 300,
      }),
    });
  });

  it('does nothing when the setting is off', async () => {
    const { service, dateChanges } = build({
      rules: { adjustOverCareNextWeek: false },
      lastWeek: { deliveredMinutes: 720 },
    });
    expect(await service.runWeekly('user-1')).toEqual({
      adjusted: 0,
      cancelledVisits: 0,
    });
    expect(dateChanges.applyVisitCut).not.toHaveBeenCalled();
  });

  it('first run only records the start day', async () => {
    const { service, orgSettings, dateChanges } = build({
      rules: { adjustOverCareFrom: null },
      lastWeek: { deliveredMinutes: 720 },
    });
    await service.runWeekly('user-1');
    expect(orgSettings.setAdjustOverCareFrom).toHaveBeenCalledWith(
      '2026-11-09',
    );
    expect(dateChanges.applyVisitCut).not.toHaveBeenCalled();
  });

  it('skips a week before the start day, a week already done and a service user with no active plan', async () => {
    for (const opts of [
      { rules: { adjustOverCareFrom: '2026-11-03' } },
      { existing: true },
      { activePlan: false },
    ]) {
      const { service, dateChanges } = build({
        ...opts,
        lastWeek: { deliveredMinutes: 720 },
      });
      await service.runWeekly('user-1');
      expect(dateChanges.applyVisitCut).not.toHaveBeenCalled();
    }
  });
});
