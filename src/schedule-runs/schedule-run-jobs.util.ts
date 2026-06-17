import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ScheduleRunStatus } from '@prisma/client';
import { formatScheduleDate } from '../schedules/schedules-date.util';

export const ACTIVE_SCHEDULE_RUN_STATUSES: ScheduleRunStatus[] = [
  ScheduleRunStatus.DRAFT,
  ScheduleRunStatus.PUBLISHED,
  ScheduleRunStatus.IN_PROGRESS,
];

export function jobStartMatchesRunDate(runDate: Date, scheduledStart: Date): boolean {
  return formatScheduleDate(runDate) === formatScheduleDate(scheduledStart);
}

export function sortTimelineJobsByRunSequence<
  T extends { runSequence?: number | null; scheduledStartDateTime: string },
>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => {
    const seqA = a.runSequence ?? Number.MAX_SAFE_INTEGER;
    const seqB = b.runSequence ?? Number.MAX_SAFE_INTEGER;
    if (seqA !== seqB) return seqA - seqB;
    return new Date(a.scheduledStartDateTime).getTime() - new Date(b.scheduledStartDateTime).getTime();
  });
}

export function sortJobsByRunSequence<T extends { runSequence: number | null; scheduledStartDateTime: Date }>(
  jobs: T[],
): T[] {
  return [...jobs].sort((a, b) => {
    const seqA = a.runSequence ?? Number.MAX_SAFE_INTEGER;
    const seqB = b.runSequence ?? Number.MAX_SAFE_INTEGER;
    if (seqA !== seqB) return seqA - seqB;
    return a.scheduledStartDateTime.getTime() - b.scheduledStartDateTime.getTime();
  });
}

export function nextRunSequence(existingSequences: Array<number | null | undefined>): number {
  const max = existingSequences.reduce<number>((acc, value) => {
    if (value == null) return acc;
    return Math.max(acc, value);
  }, 0);
  return max + 1;
}

export function assertUniqueVisitIds(visitIds: string[]): void {
  const unique = new Set(visitIds);
  if (unique.size !== visitIds.length) {
    throw new BadRequestException('Duplicate visit IDs are not allowed in the same request');
  }
}

export function assertReorderVisitIdsMatchRun(
  orderedVisitIds: string[],
  runJobIds: string[],
): void {
  assertUniqueVisitIds(orderedVisitIds);
  if (orderedVisitIds.length !== runJobIds.length) {
    throw new BadRequestException('Reorder must include every visit currently in the run');
  }
  const runSet = new Set(runJobIds);
  for (const id of orderedVisitIds) {
    if (!runSet.has(id)) {
      throw new BadRequestException('Reorder contains visits that are not in this run');
    }
  }
}

export function assertRunEditable(status: ScheduleRunStatus): void {
  if (status === ScheduleRunStatus.CANCELLED || status === ScheduleRunStatus.COMPLETED) {
    throw new BadRequestException('This run cannot be modified in its current status');
  }
}

export function assertRunFound<T>(row: T | null): asserts row is T {
  if (!row) throw new NotFoundException('Schedule run not found');
}
