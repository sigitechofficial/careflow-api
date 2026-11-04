import { EmployeeHoursApprovalsService } from './employee-hours-approvals.service';
import type {
  CarerHoursCount,
  CarerHoursVisit,
} from './carer-weekly-hours.service';

/**
 * A plan's carer-hours request is about this plan's visits from the one that crosses the
 * carer's limit on — not about a week another visit (e.g. an approved extra) took over.
 */
describe('EmployeeHoursApprovalsService.reconcileForPlan — which visits are over', () => {
  const visit = (
    date: string,
    hour: number,
    minutes: number,
    planId?: string,
    slotId?: string,
  ): CarerHoursVisit => ({
    date,
    start: new Date(`${date}T${String(hour).padStart(2, '0')}:00:00.000Z`),
    minutes,
    serviceUserId: 'su',
    visitPlanId: planId,
    visitPlanSlotId: slotId,
  });

  function build(
    count: Omit<CarerHoursCount, 'maxMinutes'> & { maxMinutes?: number },
    maxHours = 60,
    rule: { allowOverMax?: 'NO' | 'YES'; behavior?: 'MANAGER_APPROVAL' | 'REQUEST_CONFIRMATION' } = {},
    planStatus = 'ACTIVE',
  ) {
    const client = {
      serviceUserVisitPlan: { findUnique: jest.fn().mockResolvedValue({ status: planStatus }) },
      visitPlanSlotCarerAssignment: {
        findMany: jest.fn().mockResolvedValue([{ employeeId: 'john', visitPlanSlotId: 'slot-am' }]),
      },
      employeeHoursApproval: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'req-1' }),
      },
      jobAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      visitPlanSlot: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      employeePersonalDetail: {
        findFirst: jest.fn().mockResolvedValue({ firstName: 'John', lastName: 'Smith' }),
      },
    };
    const carerHours = {
      count: jest.fn().mockResolvedValue({ maxMinutes: maxHours * 60, ...count }),
      rule: jest.fn().mockResolvedValue({ behavior: 'MANAGER_APPROVAL', allowOverMax: 'NO', graceMinutes: 0, ...rule }),
    };
    const orgSettings = {
      getOperationalDisplaySettings: jest.fn().mockResolvedValue({ dateDisplayFormat: 'DD/MM/YYYY' }),
    };
    const notificationHook = { notifyPendingCreated: jest.fn() };
    const service = new EmployeeHoursApprovalsService(
      {} as never,
      {} as never,
      {} as never,
      notificationHook as never,
      {} as never,
      {} as never,
      orgSettings as never,
      carerHours as never,
      {} as never,
      {} as never,
    );
    return { service, client };
  }

  const week = (visits: CarerHoursVisit[], overFrom: number) => ({
    weekStart: '2026-11-02',
    minutes: visits.reduce((sum, v) => sum + v.minutes, 0),
    // No extra weekly hours: the week's limit is the contracted hours.
    limitMinutes: null,
    extraMinutes: 0,
    visits,
    overVisits: visits.slice(overFrom),
  });

  it('makes no request when another visit (approved extra) takes the week over', async () => {
    // Mon plan 2h + 2.5h, then Thu extra 5h crosses the 6h limit.
    const w = week(
      [
        visit('2026-11-02', 9, 120, 'plan-1', 'slot-am'),
        visit('2026-11-02', 11, 150, 'plan-1', 'slot-mid'),
        visit('2026-11-05', 11, 300, 'plan-2', 'slot-x'),
      ],
      2,
    );
    const { service, client } = build({
      limitMinutes: 360,
      graceMinutes: 0,
      weeks: [w],
      overWeeks: [w],
      heaviestMinutes: w.minutes,
    });
    const held = await service.reconcileForPlan(
      'u',
      'su',
      'plan-1',
      client as never,
    );
    expect(held.size).toBe(0);
    expect(client.employeeHoursApproval.create).not.toHaveBeenCalled();
  });

  it('holds back visits a plan save adds to a week another visit already took over', async () => {
    // Mon plan 2h + 2.5h added by this save, then Thu approved extra 5h crosses the 6h limit.
    const w = week(
      [
        visit('2026-11-02', 9, 120, 'plan-1', 'slot-am'),
        visit('2026-11-02', 11, 150, 'plan-1', 'slot-mid'),
        visit('2026-11-05', 11, 300, 'plan-2', 'slot-x'),
      ],
      2,
    );
    const { service, client } = build({
      limitMinutes: 360,
      graceMinutes: 0,
      weeks: [w],
      overWeeks: [w],
      heaviestMinutes: w.minutes,
    });
    const held = await service.reconcileForPlan(
      'u',
      'su',
      'plan-1',
      client as never,
      {
        // The carer already had the 09:00 visit before the save; the 11:00 one is new.
        previousVisits: new Map([['john', new Set(['slot-am|2026-11-02'])]]),
      },
    );
    expect([...held]).toEqual(['john|slot-mid|2026-11-02']);
    expect(client.employeeHoursApproval.create).toHaveBeenCalledTimes(1);
  });

  it('holds back the new visit a plan save adds, not an existing later one', async () => {
    // Mon–Fri evening 4h (20h, on the limit), then a new Mon 07:00 1h makes it 21h.
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
    const w = week(
      [
        visit('2026-11-02', 7, 60, 'plan-1', 'slot-morning'),
        ...days.map((d) => visit(d, 17, 240, 'plan-1', 'slot-evening')),
      ],
      5,
    );
    const { service, client } = build({
      limitMinutes: 1200,
      graceMinutes: 0,
      weeks: [w],
      overWeeks: [w],
      heaviestMinutes: w.minutes,
    });
    const held = await service.reconcileForPlan('u', 'su', 'plan-1', client as never, {
      previousVisits: new Map([['john', new Set(days.map((d) => `slot-evening|${d}`))]]),
    });
    expect([...held]).toEqual(['john|slot-morning|2026-11-02']);
  });

  it('keeps a longer visit at its old time for a manager instead of holding visits back', async () => {
    // Mon–Fri evening made 4h → 5h: 25h against a 20h limit.
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
    const w = week(days.map((d) => visit(d, 17, 300, 'plan-1', 'slot-evening')), 4);
    const { service, client } = build({
      limitMinutes: 1200,
      graceMinutes: 0,
      weeks: [w],
      overWeeks: [w],
      heaviestMinutes: w.minutes,
    });
    client.visitPlanSlotCarerAssignment.findMany.mockResolvedValue([
      { employeeId: 'john', visitPlanSlotId: 'slot-evening' },
    ]);
    const heldTimeSlotIds = new Set<string>();
    const held = await service.reconcileForPlan('u', 'su', 'plan-1', client as never, {
      previousVisits: new Map([['john', new Set(days.map((d) => `slot-evening|${d}`))]]),
      timeChanges: [
        {
          slotId: 'slot-evening',
          slotLabel: 'Evening',
          fromStart: '17:00',
          fromEnd: '21:00',
          fromMinutes: 240,
          toStart: '17:00',
          toEnd: '22:00',
          toMinutes: 300,
        },
      ],
      heldTimeSlotIds,
    });
    expect([...held]).toEqual([]);
    expect([...heldTimeSlotIds]).toEqual(['slot-evening']);
    const payload = client.employeeHoursApproval.create.mock.calls[0][0].data.requestPayload;
    expect(payload.pendingTimes).toHaveLength(1);
    expect(payload.withheld).toEqual([]);
  });

  it('refuses a plan save whose new visits take a week above the weekly maximum', async () => {
    // 5h of other visits, then a new 2h plan visit: 7h against a 6h maximum.
    const w = week(
      [
        visit('2026-11-02', 9, 300, 'plan-2', 'slot-x'),
        visit('2026-11-05', 9, 120, 'plan-1', 'slot-am'),
      ],
      1,
    );
    const { service, client } = build(
      { limitMinutes: 240, graceMinutes: 0, weeks: [w], overWeeks: [w], heaviestMinutes: w.minutes },
      6,
    );
    await expect(
      service.reconcileForPlan('u', 'su', 'plan-1', client as never, { previousVisits: new Map() }),
    ).rejects.toThrow(/John Smith: That week would have 7h — above the carer's 6h weekly maximum/);
    expect(client.employeeHoursApproval.create).not.toHaveBeenCalled();
  });

  it('asks a manager instead when over the maximum is allowed with approval', async () => {
    // Same 7h against a 6h maximum, Settings → Dom Rules "Allow over a carer's maximum" Yes.
    const w = week(
      [
        visit('2026-11-02', 9, 300, 'plan-2', 'slot-x'),
        visit('2026-11-05', 9, 120, 'plan-1', 'slot-am'),
      ],
      1,
    );
    const { service, client } = build(
      { limitMinutes: 240, graceMinutes: 0, weeks: [w], overWeeks: [w], heaviestMinutes: w.minutes },
      6,
      { allowOverMax: 'YES', behavior: 'MANAGER_APPROVAL' },
    );
    const held = await service.reconcileForPlan('u', 'su', 'plan-1', client as never, {
      previousVisits: new Map(),
    });
    expect([...held]).toEqual(['john|slot-am|2026-11-05']);
    expect(client.employeeHoursApproval.create).toHaveBeenCalledTimes(1);
  });

  it('no approval needed: assigned with a warning — nothing held, no request', async () => {
    const w = week(
      [
        visit('2026-11-02', 9, 300, 'plan-2', 'slot-x'),
        visit('2026-11-05', 9, 120, 'plan-1', 'slot-am'),
      ],
      1,
    );
    const { service, client } = build(
      { limitMinutes: 240, graceMinutes: 0, weeks: [w], overWeeks: [w], heaviestMinutes: w.minutes },
      60,
      { behavior: 'REQUEST_CONFIRMATION' },
    );
    const warnings: string[] = [];
    const held = await service.reconcileForPlan('u', 'su', 'plan-1', client as never, {
      previousVisits: new Map(),
      warnings,
    });
    expect(held.size).toBe(0);
    expect(client.employeeHoursApproval.create).not.toHaveBeenCalled();
    expect(warnings).toEqual([expect.stringMatching(/^John Smith goes over their weekly hours \(week of 02\/11\/2026: 7h of 4h\)/)]);
  });

  it('no approval needed but above the maximum (not allowed): still refused', async () => {
    const w = week(
      [
        visit('2026-11-02', 9, 300, 'plan-2', 'slot-x'),
        visit('2026-11-05', 9, 120, 'plan-1', 'slot-am'),
      ],
      1,
    );
    const { service, client } = build(
      { limitMinutes: 240, graceMinutes: 0, weeks: [w], overWeeks: [w], heaviestMinutes: w.minutes },
      6,
      { behavior: 'REQUEST_CONFIRMATION', allowOverMax: 'NO' },
    );
    await expect(
      service.reconcileForPlan('u', 'su', 'plan-1', client as never, { previousVisits: new Map() }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CARER_OVER_MAX_WEEKLY_HOURS' }) });
  });

  it('draft plans are not checked', async () => {
    const w = week([visit('2026-11-05', 9, 600, 'plan-1', 'slot-am')], 0);
    const { service, client } = build(
      { limitMinutes: 240, graceMinutes: 0, weeks: [w], overWeeks: [w], heaviestMinutes: w.minutes },
      6,
      {},
      'DRAFT',
    );
    const held = await service.reconcileForPlan('u', 'su', 'plan-1', client as never, { previousVisits: new Map() });
    expect(held.size).toBe(0);
    expect(client.employeeHoursApproval.create).not.toHaveBeenCalled();
  });

  it('no contracted hours: a save giving the carer visits is refused', async () => {
    const w = week([visit('2026-11-05', 9, 120, 'plan-1', 'slot-am')], 0);
    const { service, client } = build({ limitMinutes: null, graceMinutes: 0, weeks: [w], overWeeks: [], heaviestMinutes: 120 });
    await expect(
      service.reconcileForPlan('u', 'su', 'plan-1', client as never, { previousVisits: new Map() }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CARER_NO_CONTRACTED_HOURS', employeeId: 'john' }),
    });
  });

  it('no contracted hours: the rota (no save) leaves the carer off this plan\'s visits', async () => {
    const w = week([visit('2026-11-05', 9, 120, 'plan-1', 'slot-am')], 0);
    const { service, client } = build({ limitMinutes: null, graceMinutes: 0, weeks: [w], overWeeks: [], heaviestMinutes: 120 });
    const held = await service.reconcileForPlan('u', 'su', 'plan-1', client as never);
    expect([...held]).toEqual(['john|slot-am|2026-11-05']);
    expect(client.employeeHoursApproval.create).not.toHaveBeenCalled();
  });

  it("holds back this plan's visits after the crossing and asks a manager", async () => {
    // Mon extra 5h, then Thu plan 2h crosses the 6h limit (plan visit not on the rota yet).
    const w = week(
      [
        visit('2026-11-02', 9, 300, 'plan-2', 'slot-x'),
        visit('2026-11-05', 9, 120, 'plan-1', 'slot-am'),
      ],
      1,
    );
    const { service, client } = build({
      limitMinutes: 360,
      graceMinutes: 0,
      weeks: [w],
      overWeeks: [w],
      heaviestMinutes: w.minutes,
    });
    const held = await service.reconcileForPlan(
      'u',
      'su',
      'plan-1',
      client as never,
    );
    expect([...held]).toEqual(['john|slot-am|2026-11-05']);
    expect(client.employeeHoursApproval.create).toHaveBeenCalledTimes(1);
  });
});

describe('EmployeeHoursApprovalsService approve — the weekly maximum', () => {
  function build(rule: { allowOverMax: 'NO' | 'YES'; behavior: 'MANAGER_APPROVAL' | 'REQUEST_CONFIRMATION' }) {
    const carerHours = {
      // 7h that week against the carer's 6h maximum.
      count: jest.fn().mockResolvedValue({ weeks: [{ minutes: 420 }], maxMinutes: 360 }),
      rule: jest.fn().mockResolvedValue(rule),
    };
    const service = new EmployeeHoursApprovalsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      carerHours as never,
      {} as never,
      {} as never,
    );
    const row = {
      id: 'req-1',
      employeeId: 'john',
      requestType: 'VISIT_PLAN_OVER_HOURS',
      requestPayload: { withheld: ['slot-am|2026-11-05'] },
      projectedWeeklyHours: 7,
    };
    const assert = () =>
      (service as unknown as { assertWithinMaxApprovable: (r: unknown) => Promise<void> }).assertWithinMaxApprovable(row);
    return { assert };
  }

  it('refuses above the maximum by default', async () => {
    await expect(build({ allowOverMax: 'NO', behavior: 'MANAGER_APPROVAL' }).assert()).rejects.toThrow(
      /Cannot approve — that week would have 7h/,
    );
  });

  it('allows it when Settings → Dom Rules allows over the maximum', async () => {
    await expect(build({ allowOverMax: 'YES', behavior: 'MANAGER_APPROVAL' }).assert()).resolves.toBeUndefined();
  });

  it("names the carer's own maximum when refused", async () => {
    await expect(build({ allowOverMax: 'NO', behavior: 'REQUEST_CONFIRMATION' }).assert()).rejects.toThrow(
      /above the carer's 6h weekly maximum/,
    );
  });
});
