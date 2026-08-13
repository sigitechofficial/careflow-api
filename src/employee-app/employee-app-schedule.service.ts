import { Injectable } from '@nestjs/common';
import {
  AllocationStatus,
  ScheduledJobStatus,
  ScheduledVisitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  dayKeyInTimeZone,
  formatHmUtc,
  hourInTimeZone,
  operationalDayBounds,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import { formatScheduleDate, parseScheduleDate } from '../schedules/schedules-date.util';
import { resolveAllocationWindow } from '../job-allocations/allocation-window.util';

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

type ScheduleUiStatus = 'in_progress' | 'upcoming' | 'completed' | 'missed' | 'needs_attention';
type Tone = 'danger' | 'primary' | 'success' | 'warning' | 'neutral';

@Injectable()
export class EmployeeAppScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async getSchedule(
    employeeId: string,
    opts: { date?: string; from?: string; to?: string } = {},
  ) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const selectedDate = this.resolveDate(opts.date, timeZone);
    const today = operationalTodayIso(new Date(), timeZone);
    const { stripFrom, stripTo } = this.resolveStripBounds(selectedDate, opts.from, opts.to);

    const dayBounds = operationalDayBounds(selectedDate, timeZone);
    const stripStart = operationalDayBounds(stripFrom, timeZone).start;
    const stripEnd = operationalDayBounds(stripTo, timeZone).end;

    const [dayAllocations, stripAllocations] = await Promise.all([
      this.prisma.jobAllocation.findMany({
        where: {
          employeeId,
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_ALLOCATION },
          scheduledJob: {
            deletedAt: null,
            isActive: true,
            scheduledStartDateTime: { gte: dayBounds.start, lte: dayBounds.end },
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
                  careType: { select: { name: true } },
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
      this.prisma.jobAllocation.findMany({
        where: {
          employeeId,
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_ALLOCATION },
          scheduledJob: {
            deletedAt: null,
            isActive: true,
            scheduledStartDateTime: { gte: stripStart, lte: stripEnd },
            status: { notIn: EXCLUDED_JOB_STATUSES },
          },
        },
        select: {
          scheduledJob: {
            select: { scheduledStartDateTime: true },
          },
        },
      }),
    ]);

    const daysWithVisits = new Set(
      stripAllocations.map((a) =>
        dayKeyInTimeZone(a.scheduledJob.scheduledStartDateTime, timeZone),
      ),
    );

    const dateStrip = buildDateStrip(stripFrom, stripTo, selectedDate, today, daysWithVisits);

    const visits = dayAllocations.map((allocation) => {
      const job = allocation.scheduledJob;
      const primaryVisit = job.visits[0] ?? null;
      const su = job.serviceUser;
      const clientName =
        [su.firstName, su.lastName].filter(Boolean).join(' ').trim() || 'Service user';
      const initials = initialsFromName(su.firstName, su.lastName);
      const resolved = resolveAllocationWindow(allocation, {
        scheduledStartDateTime: job.scheduledStartDateTime,
        scheduledEndDateTime: job.scheduledEndDateTime,
        estimatedDurationMinutes: job.estimatedDurationMinutes,
      });
      const startAt = resolved.start;
      const endAt = resolved.end;
      const scheduledStart = formatHmUtc(startAt);
      const scheduledEnd = formatHmUtc(endAt);
      const uiStatus = mapUiStatus(job.status, primaryVisit?.status ?? null);
      const periodLabel = resolvePeriodLabel({
        visitName: primaryVisit?.visitName ?? job.jobName,
        slotCode: primaryVisit?.visitPlanSlot?.slotCode ?? null,
        roundCode: primaryVisit?.visitPlanSlot?.medicationRoundCode ?? null,
        startAt,
        careTypeName: su.careType?.name ?? null,
      });
      const requiredCarers = Math.max(
        primaryVisit?.requiredCarers ?? 1,
        job.requiredCarers ?? 1,
        job.allocations.length,
      );
      const statusTag = buildStatusTag({
        status: uiStatus,
        requiredCarers,
        careTypeName: su.careType?.name ?? null,
        scheduledStart,
      });
      const timeRange =
        scheduledEnd != null ? `${scheduledStart} - ${scheduledEnd}` : scheduledStart;

      return {
        visitId: primaryVisit?.id ?? job.id,
        jobId: job.id,
        clientId: su.id,
        client: {
          name: clientName,
          initials,
          firstName: su.firstName,
          lastName: su.lastName,
        },
        periodLabel,
        visitType: shortenVisitType(primaryVisit?.visitName?.trim() || job.jobName || 'Visit'),
        scheduledStart,
        scheduledEnd,
        timeRange,
        subtitle: `${periodLabel} · ${timeRange}`,
        status: uiStatus,
        statusTag,
        requiredCarers,
        durationMinutes: durationMinutes(startAt, endAt, job.estimatedDurationMinutes),
      };
    });

    const totalMinutes = visits.reduce((sum, v) => sum + v.durationMinutes, 0);
    const visitsCount = visits.length;
    const miles = null as number | null;

    const selected = parseScheduleDate(selectedDate);
    const isToday = selectedDate === today;

    return {
      data: {
        selectedDate,
        organisationTimezone: timeZone,
        isToday,
        selectedDateLabel: formatSelectedDateLabel(selected, isToday),
        totalsHeading: formatTotalsHeading(selected),
        visitsHeading: isToday ? 'TODAY · VISITS' : `${formatShortDayDate(selected)} · VISITS`,
        hint: 'Tap any date · swipe across months',
        dateStrip: {
          from: stripFrom,
          to: stripTo,
          dates: dateStrip,
        },
        totals: {
          visitsCount,
          visitsLabel: 'Visits',
          plannedMinutes: totalMinutes,
          plannedHoursLabel: formatDurationLabel(totalMinutes),
          plannedHoursCaption: 'Planned hours',
          miles,
          milesLabel: miles != null ? String(miles) : '—',
          milesCaption: 'Miles',
        },
        visits,
      },
    };
  }

  private resolveDate(dateParam: string | undefined, timeZone: string): string {
    if (!dateParam?.trim()) return operationalTodayIso(new Date(), timeZone);
    parseScheduleDate(dateParam);
    return dateParam.trim();
  }

  private resolveStripBounds(
    selectedDate: string,
    fromParam?: string,
    toParam?: string,
  ): { stripFrom: string; stripTo: string } {
    if (fromParam?.trim() && toParam?.trim()) {
      parseScheduleDate(fromParam);
      parseScheduleDate(toParam);
      return { stripFrom: fromParam.trim(), stripTo: toParam.trim() };
    }
    const selected = parseScheduleDate(selectedDate);
    const from = new Date(selected);
    from.setUTCDate(from.getUTCDate() - 14);
    const to = new Date(selected);
    to.setUTCDate(to.getUTCDate() + 21);
    return {
      stripFrom: formatScheduleDate(from),
      stripTo: formatScheduleDate(to),
    };
  }
}

function buildDateStrip(
  from: string,
  to: string,
  selectedDate: string,
  today: string,
  daysWithVisits: Set<string>,
) {
  const start = parseScheduleDate(from);
  const end = parseScheduleDate(to);
  const dates: Array<{
    date: string;
    dayName: string;
    dayNumber: number;
    monthLabel: string;
    monthKey: string;
    isSelected: boolean;
    isToday: boolean;
    hasVisits: boolean;
  }> = [];

  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = formatScheduleDate(d);
    dates.push({
      date,
      dayName: DAY_NAMES[d.getUTCDay()],
      dayNumber: d.getUTCDate(),
      monthLabel: MONTH_LABELS[d.getUTCMonth()],
      monthKey: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      isSelected: date === selectedDate,
      isToday: date === today,
      hasVisits: daysWithVisits.has(date),
    });
  }
  return dates;
}

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const MONTH_LABELS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

function formatSelectedDateLabel(date: Date, isToday: boolean): string {
  const day = DAY_NAMES[date.getUTCDay()];
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  const body = `${day} ${dd}/${mm}/${yyyy}`;
  return isToday ? `Today · ${body}` : body;
}

function formatTotalsHeading(date: Date): string {
  return `${formatShortDayDate(date)} · TOTALS`;
}

function formatShortDayDate(date: Date): string {
  const day = DAY_NAMES[date.getUTCDay()];
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day} ${dd}/${mm}`;
}

function mapUiStatus(
  jobStatus: ScheduledJobStatus,
  visitStatus: ScheduledVisitStatus | null,
): ScheduleUiStatus {
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

function buildStatusTag(input: {
  status: ScheduleUiStatus;
  requiredCarers: number;
  careTypeName: string | null;
  scheduledStart: string;
}): { id: string; label: string; tone: Tone } {
  if (input.status === 'in_progress') {
    return { id: 'in_progress', label: 'In progress', tone: 'warning' };
  }
  if (input.status === 'completed') {
    return { id: 'completed', label: 'Done', tone: 'success' };
  }
  if (input.status === 'missed') {
    return { id: 'missed', label: 'Missed', tone: 'danger' };
  }
  if (input.status === 'needs_attention') {
    return { id: 'needs_attention', label: 'Needs attention', tone: 'danger' };
  }
  if (input.careTypeName && /palliative/i.test(input.careTypeName)) {
    return { id: 'palliative', label: 'Palliative', tone: 'warning' };
  }
  if (input.requiredCarers >= 2) {
    return {
      id: 'double_up',
      label: `${input.requiredCarers} carers`,
      tone: 'primary',
    };
  }
  return { id: 'scheduled', label: 'Scheduled', tone: 'neutral' };
}

function resolvePeriodLabel(input: {
  visitName: string | null;
  slotCode: string | null;
  roundCode: string | null;
  startAt: Date;
  careTypeName: string | null;
}): string {
  const code = (input.roundCode ?? input.slotCode ?? '').trim().toUpperCase();
  if (code === 'MORNING' || code === 'AM') return 'Morning';
  if (code === 'LUNCH' || code === 'MIDDAY') return 'Lunch';
  if (code === 'TEA') return 'Tea';
  if (code === 'EVENING' || code === 'PM') return 'Evening';
  if (code === 'NIGHT' || code === 'BED') return 'Night';

  const candidates = [input.visitName, input.roundCode, input.slotCode]
    .map((v) => v?.trim() ?? '')
    .filter(Boolean);

  for (const raw of candidates) {
    const lower = raw.toLowerCase();
    if (/\bmorning\b/.test(lower)) return 'Morning';
    if (/\blunch\b/.test(lower)) return 'Lunch';
    if (/\btea\b/.test(lower)) return 'Tea';
    if (/\bevening\b/.test(lower)) return 'Evening';
    if (/\bpersonal\s*care\b/.test(lower)) return 'Personal care';
    if (/\bmedication\b|\bmeds?\b/.test(lower)) return 'Medication';
  }

  if (input.careTypeName?.trim()) {
    return shortenVisitType(input.careTypeName.trim());
  }

  const hour = hourInTimeZone(input.startAt, 'UTC');
  if (hour < 11) return 'Morning';
  if (hour < 14) return 'Lunch';
  if (hour < 17) return 'Afternoon';
  if (hour < 20) return 'Tea';
  return 'Evening';
}

function shortenVisitType(value: string): string {
  return value.replace(/\s+visit$/i, '').trim() || value;
}

function initialsFromName(firstName: string, lastName: string): string {
  const a = firstName.trim().charAt(0);
  const b = lastName.trim().charAt(0);
  return `${a}${b}`.toUpperCase() || '?';
}

function durationMinutes(
  startAt: Date,
  endAt: Date | null,
  estimated: number | null | undefined,
): number {
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
