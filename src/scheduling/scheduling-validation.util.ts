import { BadRequestException, NotFoundException } from '@nestjs/common';

type PrismaClientLike = {
  serviceUser: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
  scheduleBatch: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
  scheduleArea: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
  scheduleRun: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
  employee: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
};

export function assertDateRange(start: Date, end?: Date | null): void {
  if (end && end.getTime() <= start.getTime()) {
    throw new BadRequestException('scheduledEndDateTime must be after scheduledStartDateTime');
  }
}

export function assertRequiredCarers(value: number): void {
  if (value < 1) {
    throw new BadRequestException('requiredCarers must be at least 1');
  }
}

export function parseIsoDateTime(value: string, field: string): Date {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO date-time`);
  }
  return dt;
}

export async function ensureActiveServiceUser(
  prisma: PrismaClientLike,
  serviceUserId: string,
): Promise<void> {
  const su = await prisma.serviceUser.findFirst({
    where: { id: serviceUserId, deletedAt: null, isActive: true },
  });
  if (!su) throw new NotFoundException('Service user not found or inactive');
}

export async function ensureScheduleBatch(
  prisma: PrismaClientLike,
  scheduleBatchId: string,
): Promise<void> {
  const batch = await prisma.scheduleBatch.findFirst({
    where: { id: scheduleBatchId, deletedAt: null, isActive: true },
  });
  if (!batch) throw new NotFoundException('Schedule batch not found');
}

export async function ensureScheduleArea(
  prisma: PrismaClientLike,
  scheduleAreaId: string | null | undefined,
): Promise<void> {
  if (!scheduleAreaId) return;
  const area = await prisma.scheduleArea.findFirst({
    where: { id: scheduleAreaId, deletedAt: null, isActive: true },
  });
  if (!area) throw new NotFoundException('Schedule area not found or inactive');
}

export async function ensureScheduleRun(
  prisma: PrismaClientLike,
  scheduleRunId: string | null | undefined,
  scheduleBatchId?: string,
): Promise<void> {
  if (!scheduleRunId) return;
  const run = await prisma.scheduleRun.findFirst({
    where: {
      id: scheduleRunId,
      deletedAt: null,
      isActive: true,
      ...(scheduleBatchId ? { scheduleBatchId } : {}),
    },
  });
  if (!run) throw new NotFoundException('Schedule run not found or inactive');
}

export async function ensureActiveEmployee(
  prisma: PrismaClientLike,
  employeeId: string | null | undefined,
): Promise<void> {
  if (!employeeId) return;
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, deletedAt: null, isActive: true },
  });
  if (!emp) throw new NotFoundException('Employee not found or inactive');
}
