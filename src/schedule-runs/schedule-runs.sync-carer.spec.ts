import { BadRequestException } from '@nestjs/common';
import { ScheduledJobStatus } from '@prisma/client';
import { ScheduleRunsService } from './schedule-runs.service';

const EMMA = 'emma';
const AMELIA = 'amelia';

function makeService(
  jobs: Array<{
    id: string;
    requiredCarers: number;
    allocations: Array<{ employeeId: string }>;
  }>,
  /** Visits over the run carer's weekly hours (wait for a manager). */
  overHours: string[] = [],
) {
  const holders = new Map(
    jobs.map((j) => [j.id, j.allocations.map((a) => a.employeeId)]),
  );
  const prisma = {
    scheduleRun: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'run1',
        employeeId: EMMA,
        jobs: jobs.map((j) => ({ ...j, status: ScheduledJobStatus.ALLOCATED })),
      }),
    },
  };
  const allocations = {
    // Same decisions as JobAllocationsService.planRunCarer, from who holds each visit.
    planRunCarer: jest.fn(
      (employeeId: string, jobIds: string[], options: { replaceExisting?: boolean }) =>
        Promise.resolve({
          visits: jobIds.map((jobId) => {
            const job = jobs.find((j) => j.id === jobId)!;
            const current = holders.get(jobId) ?? [];
            const base = { jobId, overWeeklyHours: false, replaceEmployeeIds: [] as string[], replaceNames: [] as string[] };
            if (current.includes(employeeId)) return { ...base, outcome: 'ALREADY', message: null };
            const replace = Boolean(options.replaceExisting) && job.requiredCarers <= 1 && current.length > 0;
            if (!replace && current.length >= job.requiredCarers) {
              return { ...base, outcome: 'BLOCKED', message: 'This visit already has its carer' };
            }
            const replaced = replace ? { replaceEmployeeIds: current, replaceNames: current } : {};
            return overHours.includes(jobId)
              ? { ...base, ...replaced, outcome: 'NEEDS_APPROVAL', message: 'Over the weekly hours', overWeeklyHours: true }
              : { ...base, ...replaced, outcome: 'ALLOCATE', message: null };
          }),
          weeks: [],
          maxMinutes: 3600,
        }),
    ),
    requestReplacingApproval: jest.fn().mockResolvedValue({ id: 'req-1' }),
    unallocate: jest.fn(
      (_userId: string, jobId: string, dto: { employeeId: string }) => {
        holders.set(
          jobId,
          (holders.get(jobId) ?? []).filter((e) => e !== dto.employeeId),
        );
        return Promise.resolve({});
      },
    ),
    allocate: jest.fn(
      (_userId: string, jobId: string, dto: { employeeId: string }) => {
        const job = jobs.find((j) => j.id === jobId)!;
        const current = holders.get(jobId) ?? [];
        if (current.length >= job.requiredCarers) {
          return Promise.reject(
            new BadRequestException('This visit already has its carer'),
          );
        }
        if (overHours.includes(jobId)) {
          return Promise.resolve({ meta: { approvalRequested: true, approvalId: `req-${jobId}` } });
        }
        holders.set(jobId, [...current, dto.employeeId]);
        return Promise.resolve({});
      },
    ),
  };
  const service = new ScheduleRunsService(
    prisma as never,
    {} as never,
    allocations as never,
    {} as never,
  );
  jest.spyOn(service, 'getById').mockResolvedValue({ data: {} } as never);
  return { service, allocations, holders };
}

describe('ScheduleRunsService.syncCarer', () => {
  it('leaves a visit held by another carer alone and warns, by default', async () => {
    const { service, allocations, holders } = makeService([
      { id: 'v1', requiredCarers: 1, allocations: [{ employeeId: AMELIA }] },
    ]);

    const result = await service.syncCarer('u1', 'run1', { force: true });

    expect(allocations.unallocate).not.toHaveBeenCalled();
    expect(holders.get('v1')).toEqual([AMELIA]);
    expect(result.warnings).toEqual([
      { jobId: 'v1', message: 'This visit already has its carer' },
    ]);
  });

  it('moves single-carer visits to the run carer with replaceExisting', async () => {
    const { service, allocations, holders } = makeService([
      { id: 'v1', requiredCarers: 1, allocations: [{ employeeId: AMELIA }] },
      { id: 'v2', requiredCarers: 1, allocations: [] },
    ]);

    const result = await service.syncCarer('u1', 'run1', {
      force: true,
      replaceExisting: true,
    });

    expect(allocations.unallocate).toHaveBeenCalledWith(
      'u1',
      'v1',
      { employeeId: AMELIA, reason: 'Visit moved to the run carer' },
      undefined,
    );
    expect(holders.get('v1')).toEqual([EMMA]);
    expect(holders.get('v2')).toEqual([EMMA]);
    expect(result.warnings).toEqual([]);
  });

  it('does not take carers off a multi-carer visit', async () => {
    const { service, allocations, holders } = makeService([
      {
        id: 'v1',
        requiredCarers: 2,
        allocations: [{ employeeId: AMELIA }, { employeeId: 'charlotte' }],
      },
    ]);

    const result = await service.syncCarer('u1', 'run1', {
      force: true,
      replaceExisting: true,
    });

    expect(allocations.unallocate).not.toHaveBeenCalled();
    expect(holders.get('v1')).toEqual([AMELIA, 'charlotte']);
    expect(result.warnings).toHaveLength(1);
  });

  it('keeps the carer on a visit until a manager approves the run carer over their hours', async () => {
    const { service, allocations, holders } = makeService(
      [{ id: 'v1', requiredCarers: 1, allocations: [{ employeeId: AMELIA }] }],
      ['v1'],
    );

    const result = await service.syncCarer('u1', 'run1', { force: true, replaceExisting: true });

    expect(allocations.unallocate).not.toHaveBeenCalled();
    expect(allocations.requestReplacingApproval).toHaveBeenCalledWith('u1', 'v1', EMMA, {
      employeeIds: [AMELIA],
      names: [AMELIA],
    });
    expect(holders.get('v1')).toEqual([AMELIA]);
    expect(result.approvalRequested).toEqual([{ jobId: 'v1', approvalId: 'req-1' }]);
    expect(result.synced).toBe(0);
  });

  it('counts a visit sent to a manager apart from the ones the carer went on', async () => {
    const { service } = makeService(
      [
        { id: 'v1', requiredCarers: 1, allocations: [] },
        { id: 'v2', requiredCarers: 1, allocations: [] },
      ],
      ['v2'],
    );

    const result = await service.syncCarer('u1', 'run1', { force: true });

    expect(result.synced).toBe(1);
    expect(result.approvalRequested).toEqual([{ jobId: 'v2', approvalId: 'req-v2' }]);
  });
});
