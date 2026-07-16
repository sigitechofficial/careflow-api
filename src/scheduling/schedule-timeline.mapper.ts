import { AllocationStatus, type Prisma } from '@prisma/client';
import { formatScheduleDate } from '../schedules/schedules-date.util';
import { jobDurationMinutes } from './schedule-date-range.util';
import { assessVisitDeliveryFromJobLike } from './visit-delivery-assessment.util';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

function decimalToNumber(value: { toString(): string } | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

export const timelineVisitSelect = {
  id: true,
  visitName: true,
  visitPlanSlotId: true,
  status: true,
  scheduledStartDateTime: true,
  scheduledEndDateTime: true,
  actualStartDateTime: true,
  actualEndDateTime: true,
  visitPlanSlot: {
    select: {
      id: true,
      slotCode: true,
      medicationRoundCode: true,
      linkedCarePlanFormIds: true,
      timeCritical: true,
      timeToleranceMinutes: true,
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
      locationId: true,
      location: { select: { id: true, name: true } },
      assignments: {
        where: { deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: {
          locationId: true,
          location: { select: { id: true, name: true } },
        },
      },
      address: {
        where: { deletedAt: null },
        select: {
          addressLine1: true,
          addressLine2: true,
          town: true,
          county: true,
          postcode: true,
          latitude: true,
          longitude: true,
        },
      },
    },
  },
  scheduleArea: { select: { id: true, name: true, code: true, locationId: true } },
  scheduleRun: {
    select: {
      id: true,
      name: true,
      runDate: true,
      startTime: true,
      endTime: true,
      sortOrder: true,
      employeeId: true,
      status: true,
    },
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

function mapTimelineServiceUserBrief(
  su: TimelineJobRow['serviceUser'],
): {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  serviceUserNumber: string | null;
  locationId: string | null;
  location: { id: string; name: string } | null;
  address: {
    addressLine1: string | null;
    addressLine2: string | null;
    town: string | null;
    county: string | null;
    postcode: string | null;
  } | null;
  latitude: number | null;
  longitude: number | null;
} {
  const assignment = su.assignments?.[0];
  const locationId = su.locationId ?? assignment?.locationId ?? null;
  const location = su.location ?? assignment?.location ?? null;
  const addr = su.address;
  return {
    id: su.id,
    firstName: su.firstName,
    lastName: su.lastName,
    preferredName: su.preferredName,
    serviceUserNumber: su.serviceUserNumber,
    locationId,
    location: location ? { id: location.id, name: location.name } : null,
    address: addr
      ? {
          addressLine1: addr.addressLine1,
          addressLine2: addr.addressLine2,
          town: addr.town,
          county: addr.county,
          postcode: addr.postcode,
        }
      : null,
    latitude: decimalToNumber(su.address?.latitude),
    longitude: decimalToNumber(su.address?.longitude),
  };
}

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
          medicationRoundCode: slot.medicationRoundCode ?? slot.slotCode,
          label: primaryVisit?.visitName ?? slot.slotCode,
          linkedCarePlanFormIds: slot.linkedCarePlanFormIds ?? [],
          timeCritical: slot.timeCritical,
          timeToleranceMinutes: slot.timeToleranceMinutes,
        }
      : null,
    visits: row.visits.map((v) => ({
      id: v.id,
      visitName: v.visitName,
      visitPlanSlotId: v.visitPlanSlotId,
      status: v.status,
      scheduledStartDateTime: v.scheduledStartDateTime.toISOString(),
      scheduledEndDateTime: v.scheduledEndDateTime?.toISOString() ?? null,
      actualStartDateTime: v.actualStartDateTime?.toISOString() ?? null,
      actualEndDateTime: v.actualEndDateTime?.toISOString() ?? null,
    })),
  };
}

export function mapTimelineJob(row: TimelineJobRow) {
  const visitPlanContext = mapVisitPlanContext(row);
  const primaryVisit = row.visits[0];
  const actualStartDateTime = primaryVisit?.actualStartDateTime?.toISOString() ?? null;
  const actualEndDateTime = primaryVisit?.actualEndDateTime?.toISOString() ?? null;
  const allocations = row.allocations.map((a) => ({
    id: a.id,
    employeeId: a.employeeId,
    status: a.status,
    requiresConfirmation: a.requiresConfirmation,
    allocatedAt: a.allocatedAt.toISOString(),
    employee: mapEmployeeBrief(a.employee),
  }));

  const mapped = {
    id: row.id,
    scheduleBatchId: row.scheduleBatchId,
    scheduleAreaId: row.scheduleAreaId,
    scheduleRunId: row.scheduleRunId,
    runSequence: row.runSequence,
    serviceUserId: row.serviceUserId,
    jobName: row.jobName,
    status: row.status,
    priority: row.priority,
    requiredCarers: row.requiredCarers,
    scheduledStartDateTime: row.scheduledStartDateTime.toISOString(),
    scheduledEndDateTime: row.scheduledEndDateTime?.toISOString() ?? null,
    durationMinutes: jobDurationMinutes(row),
    actualStartDateTime,
    actualEndDateTime,
    postcode: row.postcode,
    address: row.address,
    latitude: decimalToNumber(row.latitude),
    longitude: decimalToNumber(row.longitude),
    timePeriodColor: row.timePeriodColor,
    serviceUser: mapTimelineServiceUserBrief(row.serviceUser),
    scheduleArea: row.scheduleArea,
    scheduleRun: row.scheduleRun
      ? {
          ...row.scheduleRun,
          runDate: formatScheduleDate(row.scheduleRun.runDate),
        }
      : null,
    allocations,
    ...visitPlanContext,
  };

  return {
    ...mapped,
    deliveryAssessment: assessVisitDeliveryFromJobLike({
      status: mapped.status,
      requiredCarers: mapped.requiredCarers,
      allocatedCarers: visitPlanContext.allocatedCarers,
      scheduledStartDateTime: mapped.scheduledStartDateTime,
      scheduledEndDateTime: mapped.scheduledEndDateTime,
      actualStartDateTime,
      actualEndDateTime,
      visitPlan: mapped.visitPlan,
      visits: mapped.visits,
    }),
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
