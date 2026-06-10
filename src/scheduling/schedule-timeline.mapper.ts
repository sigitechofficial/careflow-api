import { AllocationStatus, type Prisma } from '@prisma/client';
import { formatScheduleDate } from '../schedules/schedules-date.util';
import { jobDurationMinutes } from './schedule-date-range.util';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

export const timelineVisitSelect = {
  id: true,
  visitName: true,
  visitPlanSlotId: true,
  visitPlanSlot: {
    select: {
      id: true,
      slotCode: true,
      medicationRoundCode: true,
      linkedCarePlanFormIds: true,
    },
  },
} satisfies Prisma.ScheduledVisitSelect;

export const timelineJobInclude = {
  serviceUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      serviceUserNumber: true,
    },
  },
  scheduleArea: { select: { id: true, name: true, code: true } },
  scheduleRun: {
    select: { id: true, name: true, runDate: true, startTime: true, endTime: true, sortOrder: true },
  },
  allocations: {
    where: { deletedAt: null, isActive: true },
    include: {
      employee: {
        select: {
          id: true,
          personalDetail: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  },
  visits: {
    where: { deletedAt: null, isActive: true },
    orderBy: { scheduledStartDateTime: 'asc' as const },
    select: timelineVisitSelect,
  },
} satisfies Prisma.ScheduledJobInclude;

export type TimelineJobRow = Prisma.ScheduledJobGetPayload<{ include: typeof timelineJobInclude }>;

function mapVisitPlanContext(row: TimelineJobRow) {
  const primaryVisit = row.visits[0];
  const slot = primaryVisit?.visitPlanSlot ?? null;
  const activeAllocations = row.allocations.filter((a) => ACTIVE_ALLOCATION.includes(a.status));
  const allocatedCarers = activeAllocations.length;
  const underAllocated = allocatedCarers < row.requiredCarers;

  return {
    allocatedCarers,
    underAllocated,
    visitPlan: slot
      ? {
          slotId: slot.id,
          slotCode: slot.slotCode,
          label: primaryVisit?.visitName ?? slot.slotCode,
          linkedCarePlanFormIds: slot.linkedCarePlanFormIds ?? [],
        }
      : null,
    visits: row.visits.map((v) => ({
      id: v.id,
      visitName: v.visitName,
      visitPlanSlotId: v.visitPlanSlotId,
    })),
  };
}

export function mapTimelineJob(row: TimelineJobRow) {
  const visitPlanContext = mapVisitPlanContext(row);

  return {
    id: row.id,
    scheduleBatchId: row.scheduleBatchId,
    scheduleAreaId: row.scheduleAreaId,
    scheduleRunId: row.scheduleRunId,
    serviceUserId: row.serviceUserId,
    jobName: row.jobName,
    status: row.status,
    priority: row.priority,
    requiredCarers: row.requiredCarers,
    scheduledStartDateTime: row.scheduledStartDateTime.toISOString(),
    scheduledEndDateTime: row.scheduledEndDateTime?.toISOString() ?? null,
    durationMinutes: jobDurationMinutes(row),
    postcode: row.postcode,
    address: row.address,
    timePeriodColor: row.timePeriodColor,
    serviceUser: row.serviceUser,
    scheduleArea: row.scheduleArea,
    scheduleRun: row.scheduleRun
      ? {
          ...row.scheduleRun,
          runDate: formatScheduleDate(row.scheduleRun.runDate),
        }
      : null,
    allocations: row.allocations.map((a) => ({
      id: a.id,
      employeeId: a.employeeId,
      status: a.status,
      requiresConfirmation: a.requiresConfirmation,
      allocatedAt: a.allocatedAt.toISOString(),
      employee: mapEmployeeBrief(a.employee),
    })),
    ...visitPlanContext,
  };
}

export function mapEmployeeBrief(
  employee: {
    id: string;
    personalDetail: { firstName: string; lastName: string; email: string | null } | null;
    employment?: {
      role: { id: string; name: string } | null;
      jobTitle: { id: string; name: string } | null;
      contractedWeeklyHours: number | null;
      maximumWeeklyHours: number | null;
      isBankStaff: boolean;
      isAgencyStaff: boolean;
    } | null;
  } | null,
) {
  if (!employee) return null;
  return {
    id: employee.id,
    firstName: employee.personalDetail?.firstName,
    lastName: employee.personalDetail?.lastName,
    email: employee.personalDetail?.email,
    role: employee.employment?.role,
    jobTitle: employee.employment?.jobTitle,
    contractedWeeklyHours: employee.employment?.contractedWeeklyHours,
    maximumWeeklyHours: employee.employment?.maximumWeeklyHours,
    isBankStaff: employee.employment?.isBankStaff,
    isAgencyStaff: employee.employment?.isAgencyStaff,
  };
}
