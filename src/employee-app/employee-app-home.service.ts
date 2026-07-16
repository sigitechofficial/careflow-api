import { Injectable } from '@nestjs/common';
import {
  AllocationStatus,
  MedicationRecordStatus,
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatScheduleDate, parseScheduleDate } from '../schedules/schedules-date.util';
import { utcDayBounds } from '../scheduling/schedule-date-range.util';
import { resolveJobMedicationRoundCode } from '../scheduled-jobs-housekeeping/visit-job-tasks.util';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const EXCLUDED_JOB_STATUSES: ScheduledJobStatus[] = [
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
  ScheduledJobStatus.DRAFT,
];

type HomeVisitUiStatus = 'in_progress' | 'upcoming' | 'completed' | 'missed' | 'needs_attention';

type HomeTag = { id: string; label: string; tone: 'danger' | 'primary' | 'success' | 'warning' | 'neutral' };

@Injectable()
export class EmployeeAppHomeService {
  constructor(private readonly prisma: PrismaService) {}

  async getHome(employeeId: string, dateParam?: string) {
    const date = this.resolveDate(dateParam);
    const { start, end } = utcDayBounds(date);

    const [personal, allocations, hourlyRate] = await Promise.all([
      this.prisma.employeePersonalDetail.findFirst({
        where: { employeeId, deletedAt: null },
        select: { firstName: true, lastName: true },
      }),
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
                    },
                  },
                },
              },
              allocations: {
                where: { deletedAt: null, isActive: true, status: { in: ACTIVE_ALLOCATION } },
                select: { id: true },
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
    const visitRows = jobs.map((job) => {
      const primaryVisit = job.visits[0] ?? null;
      const su = job.serviceUser;
      const clientName =
        [su.firstName, su.lastName].filter(Boolean).join(' ').trim() || 'Service user';
      const initials = initialsFromName(su.firstName, su.lastName);
      const allergyNames = allergies.get(job.serviceUserId) ?? [];
      const medicationCount = medCounts.get(job.serviceUserId) ?? 0;
      const taskProgress = taskProgressByJobId.get(job.id) ?? { completed: 0, total: 0 };
      const uiStatus = mapUiStatus(job.status, primaryVisit?.status ?? null);
      const startAt = primaryVisit?.scheduledStartDateTime ?? job.scheduledStartDateTime;
      const endAt = primaryVisit?.scheduledEndDateTime ?? job.scheduledEndDateTime ?? null;
      const scheduledStart = formatHmUtc(startAt);
      const scheduledEnd = endAt ? formatHmUtc(endAt) : null;
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

      const showTaskProgress = uiStatus === 'in_progress' || uiStatus === 'completed';
      const tasksDone = showTaskProgress ? taskProgress.completed : null;
      const tasksTotal = showTaskProgress ? taskProgress.total : null;

      return {
        jobId: job.id,
        visitId: primaryVisit?.id ?? job.id,
        clientId: su.id,
        status: uiStatus,
        scheduledStart,
        scheduledEnd,
        startAt,
        endAt,
        visitTypeLong,
        visitTypeShort,
        clientName,
        initials,
        firstName: su.firstName,
        lastName: su.lastName,
        allergyNames,
        medicationCount,
        medicationRequired: primaryVisit?.medicationRequired ?? false,
        requiredCarers,
        alreadyClockedIn,
        elapsedMinutes,
        tasksDone,
        tasksTotal,
        taskProgress,
        address,
        durationMinutes: durationMinutes(startAt, endAt, job.estimatedDurationMinutes),
      };
    });

    const countable = visitRows.filter((v) => v.status !== 'missed');
    const completedCount = countable.filter((v) => v.status === 'completed').length;
    const totalCount = countable.length;
    const remainingCount = Math.max(0, totalCount - completedCount);
    const percent = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

    const visits = visitRows.map((row) => {
      const tags = buildVisitTags(row);
      return {
        visitId: row.visitId,
        jobId: row.jobId,
        clientId: row.clientId,
        client: {
          name: row.clientName,
          initials: row.initials,
        },
        visitType: row.visitTypeShort,
        scheduledStart: row.scheduledStart,
        scheduledEnd: row.scheduledEnd,
        subtitle: `${row.visitTypeShort} · ${row.scheduledStart}`,
        status: row.status,
        statusLabel: listStatusLabel(row.status, row.scheduledStart),
        statusTone: statusTone(row.status),
        tags,
        tasksDone: row.tasksDone,
        tasksTotal: row.tasksTotal,
        taskProgressLabel:
          row.tasksDone != null && row.tasksTotal != null ? `${row.tasksDone}/${row.tasksTotal}` : null,
      };
    });

    const activeRow = visitRows.find((v) => v.status === 'in_progress') ?? null;
    const activeVisit = activeRow ? buildActiveVisit(activeRow) : null;

    const firstName = personal?.firstName?.trim() || 'Carer';
    const lastName = personal?.lastName?.trim() || '';
    const greeting = buildGreeting(firstName, lastName);

    const totalMinutes = visitRows
      .filter((v) => v.status !== 'missed' && v.status !== 'needs_attention')
      .reduce((sum, v) => sum + v.durationMinutes, 0);
    const outstandingCount = visitRows.filter(
      (v) => v.status === 'upcoming' || v.status === 'in_progress' || v.status === 'needs_attention',
    ).length;
    const estimatedPay =
      hourlyRate != null ? Math.round(hourlyRate * (totalMinutes / 60) * 100) / 100 : null;

    return {
      data: {
        date,
        greeting,
        sync: {
          pendingCount: 0,
        },
        notifications: {
          hasUnread: false,
          unreadCount: 0,
        },
        quickActions: [
          { id: 'incident', label: 'Incident', enabled: true, tone: 'danger' },
          { id: 'message', label: 'Message', enabled: true, tone: 'primary' },
          { id: 'safety', label: 'Safety', enabled: true, tone: 'success' },
        ],
        progress: {
          completedCount,
          totalCount,
          remainingCount,
          percent,
          label: `${completedCount} of ${totalCount} visits done`,
          remainingLabel: `${remainingCount} remaining today`,
        },
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
      },
    };
  }

  private resolveDate(dateParam?: string): string {
    if (!dateParam?.trim()) {
      return formatScheduleDate(new Date());
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
      visits: Array<{
        visitPlanSlot: { slotCode: string; medicationRoundCode: string | null } | null;
      }>;
    }>,
  ) {
    const result = new Map<string, { completed: number; total: number }>();
    if (jobs.length === 0) return result;

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
            select: { id: true, serviceUserId: true, medicationRoundCode: true },
          }),
      this.prisma.scheduledVisitTaskCompletion.findMany({
        where: { scheduledJobId: { in: jobs.map((j) => j.id) } },
        select: {
          scheduledJobId: true,
          assignmentId: true,
          isCompleted: true,
        },
      }),
    ]);

    const assignmentsByKey = new Map<string, string[]>();
    for (const a of assignments) {
      const key = `${a.serviceUserId}|${a.medicationRoundCode}`;
      const list = assignmentsByKey.get(key) ?? [];
      list.push(a.id);
      assignmentsByKey.set(key, list);
    }

    const completionsByJob = new Map<string, typeof completions>();
    for (const c of completions) {
      const list = completionsByJob.get(c.scheduledJobId) ?? [];
      list.push(c);
      completionsByJob.set(c.scheduledJobId, list);
    }

    for (const job of jobs) {
      const round = jobRound.get(job.id);
      if (!round) {
        result.set(job.id, { completed: 0, total: 0 });
        continue;
      }
      const plannedIds = assignmentsByKey.get(`${job.serviceUserId}|${round}`) ?? [];
      const jobCompletions = completionsByJob.get(job.id) ?? [];
      const completedAssignmentIds = new Set(
        jobCompletions.filter((c) => c.assignmentId && c.isCompleted).map((c) => c.assignmentId!),
      );
      const adHocCompleted = jobCompletions.filter((c) => !c.assignmentId && c.isCompleted).length;
      const plannedCompleted = plannedIds.filter((id) => completedAssignmentIds.has(id)).length;
      result.set(job.id, {
        completed: plannedCompleted + adHocCompleted,
        total: plannedIds.length + adHocCompleted,
      });
    }

    return result;
  }
}

type VisitRow = {
  jobId: string;
  visitId: string;
  clientId: string;
  status: HomeVisitUiStatus;
  scheduledStart: string;
  scheduledEnd: string | null;
  visitTypeLong: string;
  visitTypeShort: string;
  clientName: string;
  initials: string;
  firstName: string;
  lastName: string;
  allergyNames: string[];
  medicationCount: number;
  medicationRequired: boolean;
  requiredCarers: number;
  alreadyClockedIn: boolean;
  elapsedMinutes: number | null;
  tasksDone: number | null;
  tasksTotal: number | null;
  address: ReturnType<typeof resolveAddress>;
  durationMinutes: number;
};

function buildActiveVisit(row: VisitRow) {
  const allergiesLabel =
    row.allergyNames.length > 0 ? `Allergies: ${row.allergyNames.join(', ')}` : null;
  const distanceMiles: number | null = null;
  const subtitleParts = [row.visitTypeLong];
  if (row.elapsedMinutes != null) subtitleParts.push(`${row.elapsedMinutes} min`);
  if (distanceMiles != null) subtitleParts.push(`${distanceMiles} mi`);

  const mapsUrl =
    row.address.latitude != null && row.address.longitude != null
      ? `https://maps.google.com/?q=${row.address.latitude},${row.address.longitude}`
      : row.address.formatted
        ? `https://maps.google.com/?q=${encodeURIComponent(row.address.formatted)}`
        : null;

  return {
    visitId: row.visitId,
    jobId: row.jobId,
    clientId: row.clientId,
    status: row.status,
    statusLabel: 'IN PROGRESS',
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
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
    distanceMiles,
    subtitle: subtitleParts.join(' · '),
    allergies: row.allergyNames,
    allergiesLabel,
    tasksDone: row.tasksDone ?? 0,
    tasksTotal: row.tasksTotal ?? 0,
    alreadyClockedIn: row.alreadyClockedIn,
    identityConfirmed: row.alreadyClockedIn,
    primaryAction: {
      id: 'resume',
      label: 'Resume visit',
    },
    directions: {
      label: 'Directions',
      latitude: row.address.latitude,
      longitude: row.address.longitude,
      address: row.address.formatted,
      mapsUrl,
    },
  };
}

function buildVisitTags(row: VisitRow): HomeTag[] {
  const tags: HomeTag[] = [];
  if (row.allergyNames.length > 0) {
    tags.push({ id: 'allergy', label: 'Allergy', tone: 'danger' });
  }
  if (row.medicationCount > 0 || row.medicationRequired) {
    const n = row.medicationCount > 0 ? row.medicationCount : null;
    tags.push({
      id: 'meds',
      label: n != null ? `${n} med${n === 1 ? '' : 's'}` : 'Meds',
      tone: 'primary',
    });
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

function buildGreeting(firstName: string, lastName: string) {
  const hour = new Date().getUTCHours();
  let period: 'morning' | 'afternoon' | 'evening' = 'evening';
  let label = 'GOOD EVENING';
  if (hour < 12) {
    period = 'morning';
    label = 'GOOD MORNING';
  } else if (hour < 17) {
    period = 'afternoon';
    label = 'GOOD AFTERNOON';
  }
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return {
    period,
    label,
    firstName,
    fullName,
    text: `${label}, ${fullName}`,
  };
}

function mapUiStatus(
  jobStatus: ScheduledJobStatus,
  visitStatus: ScheduledVisitStatus | null,
): HomeVisitUiStatus {
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
  if (status === 'needs_attention') return 'Needs attention';
  return scheduledStart;
}

function statusTone(status: HomeVisitUiStatus): 'warning' | 'neutral' | 'success' | 'danger' {
  if (status === 'in_progress') return 'warning';
  if (status === 'completed') return 'success';
  if (status === 'missed' || status === 'needs_attention') return 'danger';
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

function formatHmUtc(date: Date): string {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
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
  return Number.isFinite(n) ? n : null;
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
