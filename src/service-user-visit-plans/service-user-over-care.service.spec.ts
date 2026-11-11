import {
  ServiceUserOverCareService,
  takeBackByWeek,
} from './service-user-over-care.service';

/**
 * Over care reviews (docs/SU_OVER_CARE_ADJUST_PLAN.md): the weekly check raises a review, and a
 * manager cancels visits or marks it "no action needed". Runs on Monday 9 Nov 2026.
 */
/** `expect.objectContaining` typed as unknown (it returns any). */
const containing = (o: Record<string, unknown>): unknown =>
  expect.objectContaining(o) as unknown;

describe('ServiceUserOverCareService', () => {
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
      chargeableCancelMinutes: 0,
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
    /** The review row for cancelVisits / markNoActionNeeded. */
    review?: Record<string, unknown> | null;
    /** Future visits a manager can cancel. */
    candidates?: Array<Record<string, unknown>>;
    claimCount?: number;
  }) {
    const rules = {
      adjustOverCareNextWeek: true,
      adjustOverCareFrom: '2026-10-26',
      ...opts.rules,
    };
    const prisma = {
      serviceUserOverCareAdjustment: {
        findMany: jest
          .fn()
          .mockResolvedValue(opts.existing ? [{ serviceUserId: SU }] : []),
        findUnique: jest.fn().mockResolvedValue(opts.review ?? null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: opts.claimCount ?? 1 }),
        count: jest.fn().mockResolvedValue(opts.review ? 1 : 0),
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
        findMany: jest
          .fn()
          .mockImplementation((args: { where?: { id?: unknown } }) =>
            args?.where?.id
              ? Promise.resolve([
                  {
                    id: 'job-special',
                    jobName: 'Special visit',
                    serviceUserId: SU,
                    allocations: [{ employeeId: 'emp-1' }],
                  },
                ])
              : Promise.resolve([
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
          ),
      },
    };
    const orgSettings = {
      getServiceUserWeeklyHoursSettings: jest.fn().mockResolvedValue(rules),
      getOperationalDisplaySettings: jest.fn().mockResolvedValue({
        timeZone: 'Europe/London',
        dateDisplayFormat: 'DD/MM/YYYY',
      }),
      setAdjustOverCareFrom: jest.fn().mockResolvedValue(undefined),
      getOperationalTimezone: jest.fn().mockResolvedValue('Europe/London'),
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
    const dateChanges = {
      listCutCandidates: jest.fn().mockResolvedValue(opts.candidates ?? []),
      applyVisitCut: jest.fn().mockResolvedValue({ cancelled: 0 }),
    };
    const hook = {
      notifyOverCareReviewsRaised: jest.fn().mockResolvedValue(undefined),
    };
    const carerPush = { notify: jest.fn() };
    const service = new ServiceUserOverCareService(
      prisma as never,
      orgSettings as never,
      timebank as never,
      ledger as never,
      dateChanges as never,
      hook as never,
      carerPush as never,
    );
    // getReview is covered by the e2e check; here it only has to return.
    jest.spyOn(service, 'getReview').mockResolvedValue({} as never);
    return { service, prisma, orgSettings, dateChanges, hook, carerPush };
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-09T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  describe('runWeekly', () => {
    it('raises one pending review for last week, cancels nothing and tells managers', async () => {
      const { service, prisma, dateChanges, hook } = build({
        lastWeek: { deliveredMinutes: 600, pendingMinutes: 120 },
      });
      expect(await service.runWeekly()).toEqual({ raised: 1 });
      expect(prisma.serviceUserOverCareAdjustment.create).toHaveBeenCalledWith({
        data: containing({
          serviceUserId: SU,
          status: 'PENDING',
          raisedByUserId: null,
          careGivenMinutes: 720,
          overMinutes: 120,
          excludedMinutes: 0,
          cancelledJobIds: [],
        }),
      });
      expect(dateChanges.applyVisitCut).not.toHaveBeenCalled();
      expect(hook.notifyOverCareReviewsRaised).toHaveBeenCalledWith({
        overWeekLabel: '02/11/2026',
        rows: [{ label: 'Ray Okonkwo: 2h over' }],
      });
    });

    it('counts a cancellation the service user is charged for as care given', async () => {
      const { service, prisma } = build({
        // 9h delivered + 2h late cancellation charged, against 10h.
        lastWeek: { deliveredMinutes: 540, chargeableCancelMinutes: 120 },
      });
      await service.runWeekly();
      expect(prisma.serviceUserOverCareAdjustment.create).toHaveBeenCalledWith({
        data: containing({ careGivenMinutes: 660, overMinutes: 60 }),
      });
    });

    it('leaves out only hours paid from the timebank', async () => {
      const { service, prisma } = build({
        lastWeek: { deliveredMinutes: 780 },
        reserved: 60,
      });
      await service.runWeekly();
      // 3h over − 1h paid from the timebank = 2h over care.
      expect(prisma.serviceUserOverCareAdjustment.create).toHaveBeenCalledWith({
        data: containing({ overMinutes: 120, excludedMinutes: 60 }),
      });
    });

    it.each([
      ['an approved visit', { approvedJobMinutes: 60 }],
      ['an approved visit plan extra visit', { approvedExtraMinutes: 60 }],
      [
        'a visit approved longer',
        {
          approvedLonger: {
            kind: 'PLAN_TIME' as const,
            jobMinutes: 45,
            extra: 15,
          },
        },
      ],
    ])(
      'counts %s like any delivered visit (10 Nov 2026)',
      async (_label, opts) => {
        const { service, prisma } = build({
          lastWeek: { deliveredMinutes: 780 },
          ...opts,
        });
        await service.runWeekly();
        expect(
          prisma.serviceUserOverCareAdjustment.create,
        ).toHaveBeenCalledWith({
          data: containing({ overMinutes: 180, excludedMinutes: 0 }),
        });
      },
    );

    it('runs whatever the old setting says (it is always on now)', async () => {
      const { service, prisma } = build({
        rules: { adjustOverCareNextWeek: false },
        lastWeek: { deliveredMinutes: 720 },
      });
      expect(await service.runWeekly()).toEqual({ raised: 1 });
      expect(prisma.serviceUserOverCareAdjustment.create).toHaveBeenCalled();
    });

    it('first run only records the start day', async () => {
      const { service, orgSettings, prisma } = build({
        rules: { adjustOverCareFrom: null },
        lastWeek: { deliveredMinutes: 720 },
      });
      await service.runWeekly();
      expect(orgSettings.setAdjustOverCareFrom).toHaveBeenCalledWith(
        '2026-11-09',
      );
      expect(
        prisma.serviceUserOverCareAdjustment.create,
      ).not.toHaveBeenCalled();
    });

    it('skips a week before the start day, a week already raised and a week with no over care', async () => {
      for (const opts of [
        {
          rules: { adjustOverCareFrom: '2026-11-03' },
          lastWeek: { deliveredMinutes: 720 },
        },
        { existing: true, lastWeek: { deliveredMinutes: 720 } },
        { lastWeek: { deliveredMinutes: 600 } },
      ]) {
        const { service, prisma, hook } = build(opts);
        expect(await service.runWeekly()).toEqual({ raised: 0 });
        expect(
          prisma.serviceUserOverCareAdjustment.create,
        ).not.toHaveBeenCalled();
        expect(hook.notifyOverCareReviewsRaised).not.toHaveBeenCalled();
      }
    });
  });

  describe('cancelVisits', () => {
    const review = {
      id: 'rev-1',
      serviceUserId: SU,
      status: 'PENDING',
      overWeekStart: new Date('2026-11-02T00:00:00Z'),
      overMinutes: 120,
    };
    const visit = (
      id: string,
      date: string,
      minutes: number,
      kind = 'PLAN',
    ) => ({
      kind,
      scheduledJobId: id,
      visitPlanSlotId: kind === 'SPECIAL' ? null : 'slot-1',
      date,
      slotLabel: 'Lunch',
      startDateTime: `${date}T12:00:00.000Z`,
      endDateTime: `${date}T13:00:00.000Z`,
      minutes,
      timeCritical: false,
    });

    it('cancels the chosen visits with the over care reason and records who decided', async () => {
      const { service, prisma, dateChanges } = build({
        review,
        candidates: [
          visit('j1', '2026-11-12', 60),
          visit('j2', '2026-11-17', 90),
        ],
      });
      await service.cancelVisits('rev-1', 'mgr-1', {
        scheduledJobIds: ['j1', 'j2'],
        note: 'Agreed with family',
      });
      expect(
        prisma.serviceUserOverCareAdjustment.updateMany,
      ).toHaveBeenCalledWith({
        where: { id: 'rev-1', status: 'PENDING' },
        data: containing({ status: 'ACTION_TAKEN', decidedByUserId: 'mgr-1' }),
      });
      const call = dateChanges.applyVisitCut.mock.calls[0] as unknown[];
      expect((call[2] as { toCancel: unknown[] }).toCancel).toHaveLength(2);
      expect(call[3]).toBe(
        'Over care adjustment — week of 02/11/2026 had 2h over: Agreed with family',
      );
      // 2h over: 1h from the week of 9 Nov, then 1h of the 1h 30m in the week of 16 Nov.
      expect(prisma.serviceUserOverCareAdjustment.update).toHaveBeenCalledWith({
        where: { id: 'rev-1' },
        data: containing({
          decisionNote: 'Agreed with family',
          cancelledJobIds: ['j1', 'j2'],
          cancelledMinutes: 150,
          takenBackMinutes: 120,
          notTakenBackMinutes: 0,
          takenBackWeeks: [
            { weekStart: '2026-11-09', minutes: 60 },
            { weekStart: '2026-11-16', minutes: 60 },
          ],
        }),
      });
    });

    it('tells the carers of a cancelled special visit', async () => {
      const { service, carerPush } = build({
        review,
        candidates: [visit('job-special', '2026-11-12', 60, 'SPECIAL')],
      });
      await service.cancelVisits('rev-1', 'mgr-1', {
        scheduledJobIds: ['job-special'],
      });
      expect(carerPush.notify).toHaveBeenCalledWith(
        containing({ employeeIds: ['emp-1'], title: 'Visit cancelled' }),
      );
    });

    it('refuses a visit that can no longer be cancelled, and a review already decided', async () => {
      const a = build({ review, candidates: [visit('j1', '2026-11-12', 60)] });
      await expect(
        a.service.cancelVisits('rev-1', 'mgr-1', {
          scheduledJobIds: ['j1', 'gone'],
        }),
      ).rejects.toThrow('can no longer be cancelled');
      expect(a.dateChanges.applyVisitCut).not.toHaveBeenCalled();

      const b = build({ review: { ...review, status: 'NO_ACTION_NEEDED' } });
      await expect(
        b.service.cancelVisits('rev-1', 'mgr-1', { scheduledJobIds: ['j1'] }),
      ).rejects.toThrow('already been decided');

      const c = build({
        review,
        candidates: [visit('j1', '2026-11-12', 60)],
        claimCount: 0,
      });
      await expect(
        c.service.cancelVisits('rev-1', 'mgr-1', { scheduledJobIds: ['j1'] }),
      ).rejects.toThrow('already been decided');
      expect(c.dateChanges.applyVisitCut).not.toHaveBeenCalled();
    });

    it('puts the review back to pending when cancelling fails', async () => {
      const { service, prisma, dateChanges } = build({
        review,
        candidates: [visit('j1', '2026-11-12', 60)],
      });
      dateChanges.applyVisitCut.mockRejectedValueOnce(new Error('boom'));
      await expect(
        service.cancelVisits('rev-1', 'mgr-1', { scheduledJobIds: ['j1'] }),
      ).rejects.toThrow('boom');
      expect(
        prisma.serviceUserOverCareAdjustment.updateMany,
      ).toHaveBeenLastCalledWith({
        where: { id: 'rev-1', status: 'ACTION_TAKEN' },
        data: { status: 'PENDING', decidedByUserId: null, decidedAt: null },
      });
    });
  });

  describe('markNoActionNeeded', () => {
    it('needs a reason and saves who decided', async () => {
      const { service, prisma } = build({ review: { id: 'rev-1' } });
      await expect(
        service.markNoActionNeeded('rev-1', 'mgr-1', '  '),
      ).rejects.toThrow('Enter a reason');
      await service.markNoActionNeeded(
        'rev-1',
        'mgr-1',
        ' Family asked for the extra visit ',
      );
      expect(
        prisma.serviceUserOverCareAdjustment.updateMany,
      ).toHaveBeenCalledWith({
        where: { id: 'rev-1', status: 'PENDING' },
        data: containing({
          status: 'NO_ACTION_NEEDED',
          decidedByUserId: 'mgr-1',
          decisionNote: 'Family asked for the extra visit',
        }),
      });
    });

    it('refuses a review already decided', async () => {
      const { service } = build({ review: { id: 'rev-1' }, claimCount: 0 });
      await expect(
        service.markNoActionNeeded('rev-1', 'mgr-1', 'x'),
      ).rejects.toThrow('already been decided');
    });
  });
});

describe('takeBackByWeek', () => {
  const v = (date: string, minutes: number) => ({
    date,
    startDateTime: `${date}T10:00:00.000Z`,
    minutes,
  });
  it('takes the over care back from the earliest visits, week by week', () => {
    expect(
      takeBackByWeek([v('2026-11-18', 60), v('2026-11-12', 90)], 120),
    ).toEqual([
      { weekStart: '2026-11-09', minutes: 90 },
      { weekStart: '2026-11-16', minutes: 30 },
    ]);
  });
  it('never takes back more than the over care', () => {
    expect(takeBackByWeek([v('2026-11-12', 300)], 60)).toEqual([
      { weekStart: '2026-11-09', minutes: 60 },
    ]);
  });
});
