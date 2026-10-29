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
});
