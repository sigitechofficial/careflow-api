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
      plannedStartTime: true,
      plannedEndTime: true,
      durationMinutes: true,
      requiredCarers: true,
      scheduleFrequency: true,
      daysOfWeek: true,
      isEnabled: true,
    },
  },
} satisfies Prisma.ScheduledVisitSelect;

function decimalToNumber(value: { toString(): string } | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

export const timelineJobInclude = {
  serviceUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      serviceUserNumber: true,
      locationId: true,
      location: { select: { id: true, name: true } },
      address: {
        select: { latitude: true, longitude: true },
      },
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
          label: primaryVisit?.visitName ?? slot.medicationRoundCode ?? slot.slotCode,
          linkedCarePlanFormIds: slot.linkedCarePlanFormIds ?? [],
          plannedStartTime: slot.plannedStartTime,
          plannedEndTime: slot.plannedEndTime,
          durationMinutes: slot.durationMinutes,
          requiredCarers: slot.requiredCarers,
          scheduleFrequency: slot.scheduleFrequency,
          daysOfWeek: slot.daysOfWeek ?? [],
          medicationRoundCode: slot.medicationRoundCode,
          isEnabled: slot.isEnabled,
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
    notes: row.notes,
    timePeriodColor: row.timePeriodColor,
    serviceUser: {
      id: row.serviceUser.id,
      firstName: row.serviceUser.firstName,
      lastName: row.serviceUser.lastName,
      preferredName: row.serviceUser.preferredName,
      serviceUserNumber: row.serviceUser.serviceUserNumber,
      locationId: row.serviceUser.locationId,
      location: row.serviceUser.location,
      latitude:
        decimalToNumber(row.serviceUser.address?.latitude) ?? decimalToNumber(row.latitude),
      longitude:
        decimalToNumber(row.serviceUser.address?.longitude) ?? decimalToNumber(row.longitude),
    },
    scheduleArea: row.scheduleArea,
    scheduleRun: row.scheduleRun
      ? {
          ...row.scheduleRun,
          runDate: formatScheduleDate(row.scheduleRun.runDate),
        }
      : null,
    allocations: row.allocations
      .filter((a) => ACTIVE_ALLOCATION.includes(a.status))
      .sort((a, b) => Number(b.isLeadCarer) - Number(a.isLeadCarer) || a.allocatedAt.getTime() - b.allocatedAt.getTime())
      .map((a) => ({
      id: a.id,
      employeeId: a.employeeId,
      status: a.status,
      isLeadCarer: a.isLeadCarer,
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
