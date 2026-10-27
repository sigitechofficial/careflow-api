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

  function build(count: CarerHoursCount) {
    const client = {
      visitPlanSlotCarerAssignment: {
        findMany: jest.fn().mockResolvedValue([{ employeeId: 'john' }]),
      },
      employeeHoursApproval: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'req-1' }),
      },
      jobAllocation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const carerHours = { count: jest.fn().mockResolvedValue(count) };
    const notificationHook = { notifyPendingCreated: jest.fn() };
    const service = new EmployeeHoursApprovalsService(
      {} as never,
      {} as never,
      {} as never,
      notificationHook as never,
      {} as never,
      {} as never,
      {} as never,
      carerHours as never,
      {} as never,
      {} as never,
    );
    return { service, client };
  }

  const week = (visits: CarerHoursVisit[], overFrom: number) => ({
    weekStart: '2026-11-02',
    minutes: visits.reduce((sum, v) => sum + v.minutes, 0),
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
