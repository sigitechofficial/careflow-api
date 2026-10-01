import { Injectable } from '@nestjs/common';
import {
  AllocationStatus,
  MedicationRecordStatus,
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  formatHmInTimeZone,
  operationalDayBounds,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import { parseScheduleDate } from '../schedules/schedules-date.util';
import { resolveJobMedicationRoundCode } from '../scheduled-jobs-housekeeping/visit-job-tasks.util';
import { buildVisitTaskProgressByJobId } from './visit-task-progress.util';
import { resolveAllocationWindow } from '../job-allocations/allocation-window.util';
import {
  jobMetadataIsOvernight,
  nightDutyAppLabel,
  nightDutyHomeTag,
  resolveStoredNightDuty,
} from '../service-user-visit-plans/visit-plan-night-duty.util';
import { loadVisitRefsByScheduledVisitIds } from '../scheduling/visit-ref-lookup.util';
import { VisitReconciliationsService } from '../billing/visit-reconciliations.service';
import { carerHomeUiStatus, resolveCarerRole } from './employee-app-multi-carer.util';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

/** Draft jobs stay hidden; cancelled/called-off appear as read-only list cards. */
const EXCLUDED_JOB_STATUSES: ScheduledJobStatus[] = [ScheduledJobStatus.DRAFT];

type HomeVisitUiStatus =
  | 'in_progress'
  | 'upcoming'
  | 'completed'
  | 'missed'
  | 'needs_attention'
  | 'cancelled';

type HomeTag = {
  id: string;
  label: string;
  tone: 'danger' | 'primary' | 'success' | 'warning' | 'neutral' | 'teal';
};

const AVG_URBAN_SPEED_MPH = 20;

@Injectable()
export class EmployeeAppHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly visitReconciliations: VisitReconciliationsService,
  ) {}

  async getHome(employeeId: string, dateParam?: string) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const date = this.resolveDate(dateParam, timeZone);
    const { start, end } = operationalDayBounds(date, timeZone);

    const [allocations, hourlyRate] = await Promise.all([
      this.prisma.jobAllocation.findMany({
        where: {
          employeeId,
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_ALLOCATION },
          scheduledJob: {
            deletedAt: null,
            isActive: true,
            scheduledStartDateTime: { gte: start, lte: end },
            status: { notIn: EXCLUDED_JOB_STATUSES },
          },
        },
        orderBy: { scheduledJob: { scheduledStartDateTime: 'asc' } },
        include: {
          scheduledJob: {
            include: {
              serviceUser: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  preferredName: true,
                  careType: { select: { id: true, name: true } },
                  address: {
                    select: {
                      addressLine1: true,
                      addressLine2: true,
                      town: true,
                      county: true,
                      postcode: true,
                      latitude: true,
                      longitude: true,
                      deletedAt: true,
                    },
                  },
                },
              },
              visits: {
                where: { deletedAt: null, isActive: true },
                orderBy: { scheduledStartDateTime: 'asc' },
                select: {
                  id: true,
                  visitName: true,
                  status: true,
                  scheduledStartDateTime: true,
                  scheduledEndDateTime: true,
                  actualStartDateTime: true,
                  actualEndDateTime: true,
                  medicationRequired: true,
                  requiredCarers: true,
                  visitPlanSlot: {
                    select: {
                      slotCode: true,
                      medicationRoundCode: true,
                      nightDuty: true,
                    },
                  },
                },
              },
              allocations: {
                where: { deletedAt: null, isActive: true, status: { in: ACTIVE_ALLOCATION } },
                // Lead resolution (multi-carer): explicit lead, else earliest assigned.
                orderBy: [{ allocatedAt: 'asc' }, { id: 'asc' }],
                select: {
                  id: true,
                  employeeId: true,
                  status: true,
                  isLeadCarer: true,
                  allocatedAt: true,
                },
              },
            },
          },
        },
      }),
      this.resolveHourlyRate(employeeId),
    ]);

    const jobs = allocations.map((a) => a.scheduledJob);
    const serviceUserIds = [...new Set(jobs.map((j) => j.serviceUserId))];

    const [allergies, medCounts, taskProgressByJobId] = await Promise.all([
      this.loadAllergiesByServiceUser(serviceUserIds),
      this.loadMedicationCounts(serviceUserIds),
      this.loadTaskProgress(jobs),
    ]);

    const now = new Date();
    const visitRows = allocations.map((allocation) => {
      const job = allocation.scheduledJob;
      const primaryVisit = job.visits[0] ?? null;
      const su = job.serviceUser;
      const clientName =
        [su.firstName, su.lastName].filter(Boolean).join(' ').trim() || 'Service user';
      const initials = initialsFromName(su.firstName, su.lastName);
      const allergyNames = allergies.get(job.serviceUserId) ?? [];
      const medicationCount = medCounts.get(job.serviceUserId) ?? 0;
      const taskProgress = taskProgressByJobId.get(job.id) ?? { completed: 0, total: 0 };
      // Support on a shared visit: once they clock out their part is done — never
      // their active / in-progress visit (they can clock in to the next one).
      const uiStatus = carerHomeUiStatus(mapUiStatus(job.status, primaryVisit?.status ?? null), {
        role: resolveCarerRole(employeeId, job.requiredCarers, job.allocations),
        myActualEndDateTime: allocation.actualEndDateTime,
      });
      const resolved = resolveAllocationWindow(allocation, {
        scheduledStartDateTime: job.scheduledStartDateTime,
        scheduledEndDateTime: job.scheduledEndDateTime,
        estimatedDurationMinutes: job.estimatedDurationMinutes,
      });
      const startAt = resolved.start;
      const endAt = resolved.end;
      const scheduledStart = formatHmInTimeZone(startAt, timeZone);
      const scheduledEnd = formatHmInTimeZone(endAt, timeZone);
      // UTC ISO (always `…Z`) — Flutter may convert via organisationTimezone.
      // Prefer primary visit (same as details shell.visitWindow); fall back to allocation window.
      const scheduledStartIso = (
        primaryVisit?.scheduledStartDateTime ?? startAt
      ).toISOString();
      const scheduledEndIso = (
        primaryVisit?.scheduledEndDateTime ?? endAt ?? null
      )?.toISOString() ?? null;
      const visitTypeLong =
        primaryVisit?.visitName?.trim() ||
        su.careType?.name?.trim() ||
        job.jobName?.trim() ||
        'Visit';
      const visitTypeShort = shortenVisitType(visitTypeLong);
      const address = resolveAddress(
        job,
        su.address && !su.address.deletedAt ? su.address : null,
      );
      const requiredCarers = Math.max(
        primaryVisit?.requiredCarers ?? 1,
        job.requiredCarers ?? 1,
        job.allocations.length,
      );
      const alreadyClockedIn =
        uiStatus === 'in_progress' ||
        primaryVisit?.status === ScheduledVisitStatus.STARTED ||
        Boolean(primaryVisit?.actualStartDateTime);
      const elapsedMinutes =
        alreadyClockedIn && primaryVisit?.actualStartDateTime
          ? Math.max(0, Math.round((now.getTime() - primaryVisit.actualStartDateTime.getTime()) / 60_000))
          : alreadyClockedIn
            ? Math.max(0, Math.round((now.getTime() - startAt.getTime()) / 60_000))
            : null;

      const showTaskProgress =
        uiStatus === 'in_progress' || uiStatus === 'completed' || taskProgress.total > 0;
      const tasksDone = showTaskProgress ? taskProgress.completed : null;
      const tasksTotal = showTaskProgress ? taskProgress.total : null;
      const identityConfirmed = readIdentityConfirmed(job.metadata);
      const nightDuty = resolveStoredNightDuty({
        slotNightDuty: primaryVisit?.visitPlanSlot?.nightDuty,
        jobMetadata: job.metadata,
      });
      const isOvernight =
        jobMetadataIsOvernight(job.metadata) ||
        (endAt != null && startAt.toISOString().slice(0, 10) !== endAt.toISOString().slice(0, 10));

      return {
        jobId: job.id,
        visitId: primaryVisit?.id ?? null,
        visitRef: null as string | null,
        clientId: su.id,
        status: uiStatus,
        scheduledStart,
        scheduledEnd,
        scheduledStartIso,
        scheduledEndIso,
        startAt,
        endAt,
        visitTypeLong,
        visitTypeShort,
        careTypeName: su.careType?.name?.trim() || null,
        clientName,
        initials,
        firstName: su.firstName,
        lastName: su.lastName,
        allergyNames,
        medicationCount,
        medicationRequired: primaryVisit?.medicationRequired ?? false,
        requiredCarers,
        alreadyClockedIn,
        identityConfirmed,
        elapsedMinutes,
        tasksDone,
        tasksTotal,
        taskProgress,
        address,
        durationMinutes: durationMinutes(startAt, endAt, job.estimatedDurationMinutes),
        travelMinutes: null as number | null,
        distanceMiles: null as number | null,
        nightDuty,
        nightDutyLabel: nightDutyAppLabel(nightDuty),
        isOvernight,
      };
    });

    applyTravelBetweenVisits(visitRows);

    const visitIds = visitRows
      .map((r) => r.visitId)
      .filter((id): id is string => Boolean(id));
    const visitRefById = await loadVisitRefsByScheduledVisitIds(this.prisma, visitIds);
    const missing = visitIds.filter((id) => !visitRefById.get(id));
    if (missing.length) {
      const issued = await this.visitReconciliations.issueVisitRefsByScheduledVisitIds(
        missing,
      );
      for (const [id, ref] of issued) visitRefById.set(id, ref);
    }
    for (const row of visitRows) {
      row.visitRef = row.visitId ? visitRefById.get(row.visitId) ?? null : null;
    }

    const countable = visitRows.filter(
      (v) => v.status !== 'missed' && v.status !== 'cancelled',
    );
    const totalCount = countable.length;

    const visits = visitRows.map((row) => {
      const tags = buildVisitTags(row);
      return {
        visitId: row.visitId,
        visitRef: row.visitRef,
        jobId: row.jobId,
        clientId: row.clientId,
        client: {
          name: row.clientName,
          initials: row.initials,
          firstName: row.firstName,
          lastName: row.lastName,
        },
        visitType: row.visitTypeShort,
        scheduledStart: row.scheduledStart,
        scheduledEnd: row.scheduledEnd,
        scheduledStartIso: row.scheduledStartIso,
        scheduledEndIso: row.scheduledEndIso,
        subtitle: buildVisitSubtitle(row),
        travelMinutes: row.travelMinutes,
        distanceMiles: row.distanceMiles,
        status: row.status,
        statusLabel: listStatusLabel(row.status, row.scheduledStart),
        statusTone: statusTone(row.status),
        tags,
        tasksDone: row.tasksDone,
        tasksTotal: row.tasksTotal,
        taskProgressLabel:
          row.tasksDone != null && row.tasksTotal != null
            ? `${row.tasksDone}/${row.tasksTotal}`
            : null,
        nightDuty: row.nightDuty,
        nightDutyLabel: row.nightDutyLabel,
        isOvernight: row.isOvernight,
      };
    });

    const activeRow = visitRows.find((v) => v.status === 'in_progress') ?? null;
    const activeVisit = activeRow ? buildActiveVisit(activeRow) : null;

    const totalMinutes = visitRows
      .filter(
        (v) =>
          v.status !== 'missed' &&
          v.status !== 'needs_attention' &&
          v.status !== 'cancelled',
      )
      .reduce((sum, v) => sum + v.durationMinutes, 0);
    const outstandingCount = visitRows.filter(
      (v) =>
        v.status === 'upcoming' ||
        v.status === 'in_progress' ||
        v.status === 'needs_attention',
    ).length;
    const estimatedPay =
      hourlyRate != null ? Math.round(hourlyRate * (totalMinutes / 60) * 100) / 100 : null;

    return {
      data: buildEmployeeAppHomeData({
        date,
        organisationTimezone: timeZone,
        activeVisit,
        visits,
        endOfShift: {
          enabled: totalCount > 0,
          durationLabel: formatDurationLabel(totalMinutes),
          estimatedPay,
          estimatedPayLabel: estimatedPay != null ? formatGbp(estimatedPay) : null,
          currency: 'GBP',
          outstandingCount,
          subtitle: buildEndOfShiftSubtitle(totalMinutes, estimatedPay, outstandingCount),
        },
      }),
    };
  }

  private resolveDate(dateParam: string | undefined, timeZone: string): string {
    if (!dateParam?.trim()) {
      return operationalTodayIso(new Date(), timeZone);
    }
    parseScheduleDate(dateParam);
    return dateParam.trim();
  }

  private async resolveHourlyRate(employeeId: string): Promise<number | null> {
    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId, deletedAt: null },
      select: {
        individualBaseRate: true,
        defaultPayCardId: true,
      },
    });
    if (employment?.individualBaseRate != null && employment.individualBaseRate > 0) {
      return employment.individualBaseRate;
    }
    if (!employment?.defaultPayCardId) return null;

    const rule = await this.prisma.payCardRule.findFirst({
      where: {
        payCardId: employment.defaultPayCardId,
        rateType: 'HOURLY',
        appliesToVisit: true,
      },
      orderBy: [{ priority: 'asc' }, { sortOrder: 'asc' }],
      select: { amount: true },
    });
    if (!rule?.amount) return null;
    const n = Number(rule.amount.toString());
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private async loadAllergiesByServiceUser(serviceUserIds: string[]) {
    const map = new Map<string, string[]>();
    if (serviceUserIds.length === 0) return map;

    const rows = await this.prisma.serviceUserAllergy.findMany({
      where: {
        serviceUserId: { in: serviceUserIds },
        deletedAt: null,
        isActive: true,
      },
      select: { serviceUserId: true, allergyName: true },
      orderBy: { allergyName: 'asc' },
    });

    for (const row of rows) {
      const name = row.allergyName.trim();
      if (!name) continue;
      const list = map.get(row.serviceUserId) ?? [];
      if (!list.includes(name)) list.push(name);
      map.set(row.serviceUserId, list);
    }
    return map;
  }

  private async loadMedicationCounts(serviceUserIds: string[]) {
    const map = new Map<string, number>();
    if (serviceUserIds.length === 0) return map;

    const grouped = await this.prisma.serviceUserMedication.groupBy({
      by: ['serviceUserId'],
      where: {
        serviceUserId: { in: serviceUserIds },
        deletedAt: null,
        status: { in: [MedicationRecordStatus.ACTIVE, MedicationRecordStatus.PAUSED] },
      },
      _count: { _all: true },
    });

    for (const row of grouped) {
      map.set(row.serviceUserId, row._count._all);
    }
    return map;
  }

  private async loadTaskProgress(
    jobs: Array<{
      id: string;
      serviceUserId: string;
      scheduledStartDateTime?: Date | null;
      visits: Array<{
        visitPlanSlot: { slotCode: string; medicationRoundCode: string | null } | null;
        scheduledStartDateTime?: Date | null;
      }>;
    }>,
  ) {
    if (jobs.length === 0) return new Map<string, { completed: number; total: number }>();

    const jobRound = new Map<string, string | null>();
    for (const job of jobs) {
      jobRound.set(job.id, resolveJobMedicationRoundCode(job.visits));
    }

    const roundsNeeded = [...new Set([...jobRound.values()].filter((r): r is string => Boolean(r)))];
    const serviceUserIds = [...new Set(jobs.map((j) => j.serviceUserId))];

    const [assignments, completions] = await Promise.all([
      roundsNeeded.length === 0
        ? Promise.resolve([] as Array<{ id: string; serviceUserId: string; medicationRoundCode: string }>)
        : this.prisma.serviceUserVisitTaskAssignment.findMany({
            where: {
              serviceUserId: { in: serviceUserIds },
              medicationRoundCode: { in: roundsNeeded },
              deletedAt: null,
              isActive: true,
            },
            select: {
              id: true,
              serviceUserId: true,
              medicationRoundCode: true,
              daysOfWeek: true,
              scheduleFrequency: true,
              repeatEvery: true,
              repeatUnit: true,
              timeCritical: true,
              timeToleranceMinutes: true,
              monthlyDayMode: true,
              monthlyDaysOfMonth: true,
              monthlyPatternOrdinal: true,
              monthlyPatternWeekday: true,
            },
          }),
      this.prisma.scheduledVisitTaskCompletion.findMany({
        where: { scheduledJobId: { in: jobs.map((j) => j.id) } },
        select: {
          scheduledJobId: true,
          assignmentId: true,
          isCompleted: true,
          recordedValue: true,
          notes: true,
        },
      }),
    ]);

    return buildVisitTaskProgressByJobId({ jobs, assignments, completions });
  }
}

type VisitRow = {
  jobId: string;
  visitId: string | null;
  visitRef?: string | null;
  clientId: string;
  status: HomeVisitUiStatus;
  scheduledStart: string;
  scheduledEnd: string | null;
  scheduledStartIso: string;
  scheduledEndIso: string | null;
  startAt: Date;
  endAt: Date | null;
  visitTypeLong: string;
  visitTypeShort: string;
  careTypeName: string | null;
  clientName: string;
  initials: string;
  firstName: string;
  lastName: string;
  allergyNames: string[];
  medicationCount: number;
  medicationRequired: boolean;
  requiredCarers: number;
  alreadyClockedIn: boolean;
  identityConfirmed: boolean;
  elapsedMinutes: number | null;
  tasksDone: number | null;
  tasksTotal: number | null;
  taskProgress: { completed: number; total: number };
  address: ReturnType<typeof resolveAddress>;
  durationMinutes: number;
  travelMinutes: number | null;
  distanceMiles: number | null;
  nightDuty: ReturnType<typeof resolveStoredNightDuty>;
  nightDutyLabel: string | null;
  isOvernight: boolean;
};

function buildActiveVisit(row: VisitRow) {
  const allergiesLabel =
    row.allergyNames.length > 0 ? `Allergies: ${row.allergyNames.join(', ')}` : null;
  const subtitleParts = [row.visitTypeLong];
  if (row.elapsedMinutes != null) subtitleParts.push(`${row.elapsedMinutes} min`);
  else if (row.travelMinutes != null) subtitleParts.push(`${row.travelMinutes} min`);
  if (row.distanceMiles != null) subtitleParts.push(`${row.distanceMiles} mi`);

  const mapsUrl =
    row.address.latitude != null && row.address.longitude != null
      ? `https://maps.google.com/?q=${row.address.latitude},${row.address.longitude}`
      : row.address.formatted
        ? `https://maps.google.com/?q=${encodeURIComponent(row.address.formatted)}`
        : null;

  return {
    visitId: row.visitId,
    visitRef: row.visitRef ?? null,
    jobId: row.jobId,
    clientId: row.clientId,
    status: row.status,
    statusLabel: 'IN PROGRESS',
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    scheduledStartIso: row.scheduledStartIso,
    scheduledEndIso: row.scheduledEndIso,
    timeWindow:
      row.scheduledEnd != null ? `${row.scheduledStart}–${row.scheduledEnd}` : row.scheduledStart,
    client: {
      name: row.clientName,
      initials: row.initials,
      firstName: row.firstName,
      lastName: row.lastName,
    },
    visitType: row.visitTypeLong,
    visitTitle: row.visitTypeLong,
    elapsedMinutes: row.elapsedMinutes,
    travelMinutes: row.travelMinutes,
    distanceMiles: row.distanceMiles,
    subtitle: subtitleParts.join(' · '),
    allergies: row.allergyNames,
    allergiesLabel,
    tasksDone: row.tasksDone ?? 0,
    tasksTotal: row.tasksTotal ?? 0,
    alreadyClockedIn: row.alreadyClockedIn,
    identityConfirmed: row.identityConfirmed,
    primaryAction: {
      id: 'resume',
      label: 'Resume visit',
    },
    directions: {
      label: 'Directions',
      latitude: formatHomeCoord4(row.address.latitude),
      longitude: formatHomeCoord4(row.address.longitude),
      address: row.address.formatted,
      mapsUrl,
    },
    nightDuty: row.nightDuty,
    nightDutyLabel: row.nightDutyLabel,
    isOvernight: row.isOvernight,
  };
}

function buildVisitSubtitle(row: VisitRow): string {
  const parts = [row.visitTypeShort];
  if (row.travelMinutes != null) parts.push(`${row.travelMinutes} min`);
  if (row.distanceMiles != null) parts.push(`${row.distanceMiles} mi`);
  if (parts.length === 1) parts.push(row.scheduledStart);
  return parts.join(' · ');
}

function applyTravelBetweenVisits(rows: VisitRow[]) {
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (
      prev.address.latitude == null ||
      prev.address.longitude == null ||
      cur.address.latitude == null ||
      cur.address.longitude == null
    ) {
      continue;
    }
    const meters = haversineMeters(
      prev.address.latitude,
      prev.address.longitude,
      cur.address.latitude,
      cur.address.longitude,
    );
    const miles = Math.round((meters / 1609.344) * 10) / 10;
    const minutes = Math.max(1, Math.round((miles / AVG_URBAN_SPEED_MPH) * 60));
    cur.distanceMiles = miles;
    cur.travelMinutes = minutes;
  }
}

function buildVisitTags(row: VisitRow): HomeTag[] {
  const tags: HomeTag[] = [];
  const nightTag = nightDutyHomeTag(row.nightDuty);
  if (nightTag) tags.push(nightTag);
  if (row.allergyNames.length > 0) {
    tags.push({ id: 'allergy', label: 'Allergy', tone: 'danger' });
  }
  if (row.medicationRequired) {
    const n = row.medicationCount > 0 ? row.medicationCount : null;
    tags.push({
      id: 'meds',
      label: n != null ? `${n} med${n === 1 ? '' : 's'}` : 'Meds',
      tone: 'primary',
    });
    tags.push({ id: 'mar', label: 'MAR', tone: 'teal' });
  }
  if (row.careTypeName) {
    tags.push({ id: 'care', label: row.careTypeName, tone: 'primary' });
  }
  if (row.requiredCarers >= 2) {
    tags.push({
      id: 'double_up',
      label: `${row.requiredCarers} carers`,
      tone: 'neutral',
    });
  }
  return tags;
}

/** Keys removed from Home `data` (mobile no longer consumes them). */
export const EMPLOYEE_APP_HOME_REMOVED_DATA_KEYS = [
  'greeting',
  'sync',
  'notifications',
  'quickActions',
  'progress',
] as const;

/** Assemble the trimmed Home / Today `data` object (API-01). */
export function buildEmployeeAppHomeData(input: {
  date: string;
  organisationTimezone: string;
  activeVisit: ReturnType<typeof buildActiveVisit> | null;
  visits: Array<Record<string, unknown>>;
  endOfShift: Record<string, unknown>;
}) {
  return {
    date: input.date,
    organisationTimezone: input.organisationTimezone,
    activeVisit: input.activeVisit,
    visits: input.visits,
    endOfShift: input.endOfShift,
  };
}

function mapUiStatus(
  jobStatus: ScheduledJobStatus,
  visitStatus: ScheduledVisitStatus | null,
): HomeVisitUiStatus {
  if (
    jobStatus === ScheduledJobStatus.CANCELLED ||
    jobStatus === ScheduledJobStatus.CALLED_OFF ||
    visitStatus === ScheduledVisitStatus.CANCELLED ||
    visitStatus === ScheduledVisitStatus.CALLED_OFF
  ) {
    return 'cancelled';
  }
  if (jobStatus === ScheduledJobStatus.IN_PROGRESS || visitStatus === ScheduledVisitStatus.STARTED) {
    return 'in_progress';
  }
  if (
    jobStatus === ScheduledJobStatus.COMPLETED ||
    jobStatus === ScheduledJobStatus.PARTIALLY_COMPLETED ||
    visitStatus === ScheduledVisitStatus.COMPLETED ||
    visitStatus === ScheduledVisitStatus.PARTIALLY_COMPLETED
  ) {
    return 'completed';
  }
  if (jobStatus === ScheduledJobStatus.MISSED || visitStatus === ScheduledVisitStatus.MISSED) {
    return 'missed';
  }
  if (
    jobStatus === ScheduledJobStatus.NEEDS_ATTENTION ||
    visitStatus === ScheduledVisitStatus.NEEDS_ATTENTION
  ) {
    return 'needs_attention';
  }
  return 'upcoming';
}

function listStatusLabel(status: HomeVisitUiStatus, scheduledStart: string): string {
  if (status === 'in_progress') return 'In progress';
  if (status === 'completed') return 'Done';
  if (status === 'missed') return 'Missed';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'needs_attention') return 'Needs attention';
  return scheduledStart;
}

function statusTone(
  status: HomeVisitUiStatus,
): 'warning' | 'neutral' | 'success' | 'danger' | 'primary' | 'teal' {
  if (status === 'in_progress') return 'warning';
  if (status === 'completed') return 'success';
  if (status === 'missed' || status === 'needs_attention' || status === 'cancelled') {
    return 'danger';
  }
  return 'neutral';
}

function shortenVisitType(value: string): string {
  return value.replace(/\s+visit$/i, '').trim() || value;
}

function initialsFromName(firstName: string, lastName: string): string {
  const a = firstName.trim().charAt(0);
  const b = lastName.trim().charAt(0);
  return `${a}${b}`.toUpperCase() || '?';
}

function durationMinutes(startAt: Date, endAt: Date | null, estimated: number | null | undefined): number {
  if (endAt) {
    return Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60_000));
  }
  if (estimated != null && estimated > 0) return estimated;
  return 30;
}

function formatDurationLabel(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatGbp(amount: number): string {
  return `£${amount.toFixed(2)}`;
}

function buildEndOfShiftSubtitle(
  totalMinutes: number,
  estimatedPay: number | null,
  outstandingCount: number,
): string {
  const parts = [formatDurationLabel(totalMinutes)];
  if (estimatedPay != null) parts.push(`${formatGbp(estimatedPay)} est. pay`);
  parts.push(`${outstandingCount} outstanding`);
  return parts.join(' · ');
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value.toString());
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10_000) / 10_000;
}

/** API lat/lng with exactly 4 digits after the decimal (JSON-safe string). */
function formatHomeCoord4(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return (Math.round(value * 10_000) / 10_000).toFixed(4);
}

function resolveAddress(
  job: {
    address: string | null;
    postcode: string | null;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
  },
  suAddress: {
    addressLine1: string | null;
    addressLine2: string | null;
    town: string | null;
    county: string | null;
    postcode: string | null;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
  } | null,
) {
  const line1 = job.address?.trim() || suAddress?.addressLine1?.trim() || null;
  const line2 = suAddress?.addressLine2?.trim() || null;
  const town = suAddress?.town?.trim() || null;
  const county = suAddress?.county?.trim() || null;
  const postcode = job.postcode?.trim() || suAddress?.postcode?.trim() || null;
  const latitude = decimalToNumber(job.latitude) ?? decimalToNumber(suAddress?.latitude);
  const longitude = decimalToNumber(job.longitude) ?? decimalToNumber(suAddress?.longitude);
  const formatted = [line1, line2, town, county, postcode].filter(Boolean).join(', ') || null;

  return {
    line1,
    line2,
    town,
    county,
    postcode,
    latitude,
    longitude,
    formatted,
  };
}

function readIdentityConfirmed(metadata: Prisma.JsonValue | null | undefined): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const employeeApp = (metadata as Record<string, unknown>).employeeApp;
  if (!employeeApp || typeof employeeApp !== 'object' || Array.isArray(employeeApp)) return false;
  return Boolean((employeeApp as Record<string, unknown>).identityConfirmed);
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
