import { ScheduleLifecycleImpactService } from './schedule-lifecycle-impact.service';
import { JobAllocationsService } from '../job-allocations/job-allocations.service';

/** A visit plan amendment that moves a visit's time also moves carers who had the visit's times. */
describe('ScheduleLifecycleImpactService.rescheduleSlotJobs — carer times', () => {
  const oldStart = new Date('2026-11-03T07:00:00.000Z');
  const oldEnd = new Date('2026-11-03T08:00:00.000Z');
  const newStart = new Date('2026-11-03T07:00:00.000Z');
  const newEnd = new Date('2026-11-03T09:30:00.000Z');

  function build() {
    const tx = {
      scheduledJob: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'job-1',
            scheduledStartDateTime: oldStart,
            scheduledEndDateTime: oldEnd,
            estimatedDurationMinutes: 60,
            metadata: { visitPlanSlotId: 'slot-1' },
            visits: [{ id: 'visit-1' }],
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      scheduledVisit: { update: jest.fn().mockResolvedValue({}) },
    };
    const jobAllocations = {
      syncAllocationTimingsToJobWindow: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ScheduleLifecycleImpactService(
      {} as never,
      { logAudit: jest.fn().mockResolvedValue(undefined) } as never,
      jobAllocations as never,
      {} as never,
      {} as never,
      {
        getOperationalTimezone: jest.fn().mockResolvedValue('Europe/London'),
      } as never,
    );
    return { service, tx, jobAllocations };
  }

  it('moves inherited carer times to the new visit window, keeping customised ones', async () => {
    const { service, tx, jobAllocations } = build();
    const result = await service.rescheduleSlotJobs(
      'user-1',
      {
        serviceUserId: 'su-1',
        visitPlanSlotId: 'slot-1',
        fromDate: new Date('2026-11-03T00:00:00.000Z'),
        resolveNewTimes: () => ({ start: newStart, end: newEnd }),
        reason: 'Longer visit',
        source: 'visit_plan_amendment',
      },
      undefined,
      tx as never,
    );
    expect(result.jobsRescheduled).toBe(1);
    expect(
      jobAllocations.syncAllocationTimingsToJobWindow,
    ).toHaveBeenCalledWith(tx, {
      scheduledJobId: 'job-1',
      previousJob: {
        scheduledStartDateTime: oldStart,
        scheduledEndDateTime: oldEnd,
        estimatedDurationMinutes: 60,
      },
      nextJob: {
        scheduledStartDateTime: newStart,
        scheduledEndDateTime: newEnd,
        estimatedDurationMinutes: 60,
      },
      userId: 'user-1',
      meta: undefined,
      rejectOutside: false,
    });
  });
});

describe('JobAllocationsService.syncAllocationTimingsToJobWindow', () => {
  const previousJob = {
    scheduledStartDateTime: new Date('2026-11-03T07:00:00.000Z'),
    scheduledEndDateTime: new Date('2026-11-03T09:00:00.000Z'),
    estimatedDurationMinutes: 120,
  };
  const nextJob = {
    scheduledStartDateTime: new Date('2026-11-03T10:00:00.000Z'),
    scheduledEndDateTime: new Date('2026-11-03T12:00:00.000Z'),
    estimatedDurationMinutes: 120,
  };

  function build(allocations: unknown[]) {
    const tx = {
      jobAllocation: {
        findMany: jest.fn().mockResolvedValue(allocations),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(data)),
      },
    };
    const service = new JobAllocationsService(
      {} as never,
      { logAudit: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, tx };
  }

  const inherited = {
    id: 'a-1',
    employeeId: 'e-1',
    scheduledStartDateTime: previousJob.scheduledStartDateTime,
    scheduledEndDateTime: previousJob.scheduledEndDateTime,
  };
  const customised = {
    id: 'a-2',
    employeeId: 'e-2',
    scheduledStartDateTime: new Date('2026-11-03T07:30:00.000Z'),
    scheduledEndDateTime: new Date('2026-11-03T08:30:00.000Z'),
  };

  it('moves an inherited carer to the new window', async () => {
    const { service, tx } = build([inherited]);
    await service.syncAllocationTimingsToJobWindow(tx as never, {
      scheduledJobId: 'job-1',
      previousJob,
      nextJob,
      userId: 'u',
    });
    expect(tx.jobAllocation.update).toHaveBeenCalledWith({
      where: { id: 'a-1' },
      data: {
        scheduledStartDateTime: nextJob.scheduledStartDateTime,
        scheduledEndDateTime: nextJob.scheduledEndDateTime,
        durationMinutes: 120,
      },
    });
  });

  it('refuses a customised carer outside the new window by default', async () => {
    const { service, tx } = build([customised]);
    await expect(
      service.syncAllocationTimingsToJobWindow(tx as never, {
        scheduledJobId: 'job-1',
        previousJob,
        nextJob,
        userId: 'u',
      }),
    ).rejects.toThrow(/outside the new visit window/);
  });

  it('keeps a customised carer as it is when rejectOutside is false (plan amendment)', async () => {
    const { service, tx } = build([customised]);
    await expect(
      service.syncAllocationTimingsToJobWindow(tx as never, {
        scheduledJobId: 'job-1',
        previousJob,
        nextJob,
        userId: 'u',
        rejectOutside: false,
      }),
    ).resolves.toBeUndefined();
    expect(tx.jobAllocation.update).not.toHaveBeenCalled();
  });
});
