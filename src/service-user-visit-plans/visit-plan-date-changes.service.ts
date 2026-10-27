import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import {
  AllocationStatus,
  CarerVisitPushKind,
  EmployeeHoursApprovalStatus,
  EmployeeHoursApprovalType,
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  VisitChargeDecision,
  VisitPlanNightDuty,
  VisitPlanSlotExceptionType,
  VisitPlanStatus,
} from '@prisma/client';
import { CarerVisitPushHook } from '../notifications/carer-visit-push.hook';
import { formatOrganisationIsoDate } from '../common/utils/organisation-display-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  combineOperationalDateAndHm,
  operationalDayBounds,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { ScheduledJobsHousekeepingService } from '../scheduled-jobs-housekeeping/scheduled-jobs-housekeeping.service';
import { assertVisitCancellationCompliance } from '../scheduled-jobs-housekeeping/visit-cancellation-validation.util';
import {
  visitCancellationReasonMeta,
  type VisitCancellationReasonCode,
} from '../scheduled-jobs-housekeeping/visit-cancellation-reason.util';
import {
  COMMISSIONED_FUNDING_TYPE_CODES,
  VISIT_CANCELLATION_REASONS_BY_PARTY,
  evaluateVisitCancellationPolicy,
  type VisitCancellationPolicyResult,
} from '../scheduled-jobs-housekeeping/visit-cancellation-policy.util';
import { CANCELLABLE_JOB_STATUSES } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.util';
import { buildVisitPlanOccurrence } from './visit-plan-generate-occurrence.util';
import {
  computeVisitPlanWeeklyHours,
  visitPlanOccurrenceMinutes,
} from './visit-plan-weekly-hours.util';
import { normalizeVisitPlanSlotCode, slotLabel } from './visit-plan-slot-defaults';
import { clampRotaHorizonDays } from './visit-plan-rolling-rota.util';
import { wallClockVisitEnd } from './visit-plan-slot-window.util';
import {
  isNightTimeSlotCode,
  resolveStoredNightDuty,
  slotTimesCrossMidnight,
  visitPlanGeneratedJobMetadata,
} from './visit-plan-night-duty.util';
import { loadScheduledMedicationDueTimes, resolveMedicationRequiredForSlot } from './visit-medication-required.util';
import { groupRotaGeneratedCarerPushes } from './visit-plan-rota-carer-push.util';
import { VISIT_PLAN_EXTRA_JOB_METADATA_KEY } from './visit-plan-extra-visit.util';
import { VisitPlanWeeklyHoursService } from './visit-plan-weekly-hours.service';
import { EmployeeHoursApprovalNotificationHook } from '../employee-hours-approvals/employee-hours-approval-notification.hook';
import type { ExtraVisitCreator } from '../employee-hours-approvals/extra-visit-creator';
import type {
  VisitPlanAddExtraVisitsDto,
  VisitPlanEditExtraVisitDto,
  VisitPlanDeleteExtraVisitDto,
  VisitPlanCancelVisitsDto,
  VisitPlanCancelVisitsPreviewDto,
  VisitPlanDateChangeItemDto,
  VisitPlanDateChangesRangeQueryDto,
  VisitPlanExtraVisitsPreviewDto,
} from './dto/visit-plan-date-changes.dto';
import {
  mapDbCarerAssignmentsForSync,
  syncVisitPlanSlotCarersToScheduledJobs,
  visitPlanCarerEmployeeIds,
  visitPlanCarerSyncFromDateTime,
} from './visit-plan-slot-carer-sync.util';
import { resolveGlobalAssignedEmployeeIds } from './visit-plan-readiness.util';
import { CarerWeeklyHoursService } from '../employee-hours-approvals/carer-weekly-hours.service';

const datePlanInclude = {
  slots: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      carerAssignments: { orderBy: [{ sortOrder: 'asc' as const }, { role: 'asc' as const }] },
      exceptions: { orderBy: { exceptionDate: 'asc' as const } },
    },
  },
} satisfies Prisma.ServiceUserVisitPlanInclude;

type DatePlanRow = Prisma.ServiceUserVisitPlanGetPayload<{ include: typeof datePlanInclude }>;

const ACTIVE_ALLOCATION_STATUSES = ['PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED'];
const ACTIVE_ALLOCATION_ENUMS: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];
/** A visit in one of these states no longer occupies the service user's or carer's time. */
const NOT_OCCUPYING_JOB_STATUSES: ScheduledJobStatus[] = [ScheduledJobStatus.CANCELLED, ScheduledJobStatus.CALLED_OFF];
const MAX_RANGE_DAYS = 92;
const ABSENCE_NOTE_MARKER = 'Auto: service user absence';
/** Row-code suffix of the hidden rows that carry a time slot's extra visits. */
const EXTRA_HOST_CODE_SUFFIX = '__X';
/** An extra visit can be edited only while its rota job has not started. */
const EDITABLE_EXTRA_JOB_STATUSES: ScheduledJobStatus[] = [
  ScheduledJobStatus.DRAFT,
  ScheduledJobStatus.UNALLOCATED,
  ScheduledJobStatus.ALLOCATED,
  ScheduledJobStatus.NEEDS_ATTENTION,
];

export type CancellableVisitStatus = 'ON_ROTA' | 'NOT_ON_ROTA';

export type CancellableVisit = {
  visitPlanSlotId: string;
  slotCode: string;
  slotLabel: string;
  date: string;
  startDateTime: string;
  endDateTime: string;
  durationMinutes: number;
  status: CancellableVisitStatus;
  scheduledJobId: string | null;
  carerEmployeeIds: string[];
  timeCritical: boolean;
};

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoToUtcDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function addMinutesToHm(hm: string, minutes: number): string {
  const [h, m] = hm.split(':').map(Number);
  const total = (((h ?? 0) * 60 + (m ?? 0) + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatHmInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/** 1500 → "25h", 1550 → "25h 50m" (same format as the plan page). */
function formatMinutesAsHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export type ExtraVisitDateCheck = {
  date: string;
  ok: boolean;
  message: string | null;
  /** Carers who already have a visit at that time on this date. */
  clashEmployeeIds: string[];
  /** Its week would go over the service user's weekly hours: sent to a manager instead. */
  needsApproval?: boolean;
  weekStart?: string;
  /** Week minutes with this extra visit added. */
  weekMinutes?: number;
  /** The week would go over the weekly hours: blocked when `ok` is false, else a warning only (Settings → Dom Rules). */
  overWeeklyHours?: boolean;
  /**
   * Carers over their contracted weekly hours with this visit and what saving does
   * (Settings → Dom Rules "Carer over weekly hours"): wait for a manager, or go on to be confirmed.
   * "Don't allow" makes the date not ok instead.
   */
  carerOverHours?: Array<{
    employeeId: string;
    message: string;
    outcome: 'MANAGER_APPROVAL' | 'REQUEST_CONFIRMATION';
  }>;
};

/** What an "extra visit over weekly hours" request creates when a manager approves it. */
export type ExtraVisitApprovalPayload = {
  kind: 'EXTRA_VISIT';
  date: string;
  weekStart: string;
  weekMinutes: number;
  limitWeeklyHours: number | null;
  roundCode: string;
  slotLabel: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  requiredCarers: number;
  employeeIds: string[];
  nightDuty: VisitPlanNightDuty;
  reason: string;
  notes: string | null;
  /** Set once approved: the extra visit that was created. */
  createdExceptionId?: string;
};

/**
 * Editing an extra visit: the carers it gives more time to — new on the visit, or already on it
 * with a longer visit than before. Only they are checked against their weekly hours.
 */
function carersGivenMoreTime(
  employeeIds: string[],
  current: Array<{
    employeeId: string;
    scheduledStartDateTime: Date | null;
    scheduledEndDateTime: Date | null;
    durationMinutes: number | null;
  }>,
  newMinutes: number,
): string[] {
  return employeeIds.filter((id) => {
    const a = current.find((row) => row.employeeId === id);
    if (!a) return true;
    const oldMinutes =
      a.scheduledStartDateTime && a.scheduledEndDateTime
        ? Math.round((a.scheduledEndDateTime.getTime() - a.scheduledStartDateTime.getTime()) / 60000)
        : (a.durationMinutes ?? 0);
    return newMinutes > oldMinutes;
  });
}

@Injectable()
export class VisitPlanDateChangesService implements ExtraVisitCreator {
  private readonly logger = new Logger(VisitPlanDateChangesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly weeklyHours: VisitPlanWeeklyHoursService,
    private readonly hoursApprovalNotifications: EmployeeHoursApprovalNotificationHook,
    private readonly carerHours: CarerWeeklyHoursService,
    @Inject(forwardRef(() => ScheduledJobsHousekeepingService))
    private readonly housekeeping: ScheduledJobsHousekeepingService,
    @Optional() private readonly carerPush?: CarerVisitPushHook,
  ) {}

  private async getPlanOrThrow(serviceUserId: string, planId: string): Promise<DatePlanRow> {
    const row = await this.prisma.serviceUserVisitPlan.findFirst({
      where: { id: planId, serviceUserId, deletedAt: null, isActive: true },
      include: datePlanInclude,
    });
    if (!row) throw new NotFoundException('Visit plan not found');
    return row;
  }

  private async loadRoundNameMap(): Promise<Map<string, string>> {
    const rows = await this.prisma.medicationAdministrationRound.findMany({
      where: { deletedAt: null, isActive: true },
      select: { code: true, name: true },
    });
    return new Map(rows.map((r) => [r.code, r.name]));
  }

  /** Commissioned funding wins when a service user has several active funding lines. */
  private async resolveFundingType(serviceUserId: string): Promise<{ code: string; name: string } | null> {
    const lines = await this.prisma.serviceUserFunding.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
      orderBy: [{ isPrimary: 'desc' }, { splitPriority: 'asc' }],
      select: { fundingType: { select: { code: true, name: true } } },
    });
    if (!lines.length) return null;
    const commissioned = lines.find((l) =>
      (COMMISSIONED_FUNDING_TYPE_CODES as readonly string[]).includes(l.fundingType.code),
    );
    return (commissioned ?? lines[0]!).fundingType;
  }

  /**
   * Upcoming visits of the plan that can still be cancelled: on the rota and not started,
   * or due by the regular pattern but not generated yet. Past, started, completed and
   * already-cancelled visits are left out.
   */
  private async listCancellable(plan: DatePlanRow, fromIso: string, toIso: string): Promise<CancellableVisit[]> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const roundNameByCode = await this.loadRoundNameMap();
    // Switched-off slots can still hold an extra visit on a date.
    const enabledSlots = plan.slots.filter(
      (s) => s.isEnabled || s.exceptions.some((ex) => ex.exceptionType === VisitPlanSlotExceptionType.EXTRA),
    );
    if (!enabledSlots.length) return [];

    const rotaVisits = await this.prisma.scheduledVisit.findMany({
      where: {
        serviceUserId: plan.serviceUserId,
        visitPlanSlotId: { in: enabledSlots.map((s) => s.id) },
        deletedAt: null,
        isActive: true,
        scheduledStartDateTime: {
          gte: operationalDayBounds(fromIso, timeZone).start,
          lte: operationalDayBounds(toIso, timeZone).end,
        },
      },
      orderBy: { scheduledStartDateTime: 'asc' },
      select: {
        visitPlanSlotId: true,
        scheduledStartDateTime: true,
        scheduledEndDateTime: true,
        scheduledJob: {
          select: {
            id: true,
            status: true,
            deletedAt: true,
            allocations: {
              where: { deletedAt: null, isActive: true },
              select: { employeeId: true, status: true },
            },
          },
        },
      },
    });
    const rotaByKey = new Map<string, (typeof rotaVisits)[number][]>();
    for (const v of rotaVisits) {
      if (!v.visitPlanSlotId || v.scheduledJob.deletedAt) continue;
      const key = `${v.visitPlanSlotId}|${operationalTodayIso(v.scheduledStartDateTime, timeZone)}`;
      rotaByKey.set(key, [...(rotaByKey.get(key) ?? []), v]);
    }

    const now = Date.now();
    const out: CancellableVisit[] = [];
    for (let dayIso = fromIso; dayIso <= toIso; dayIso = addDaysIso(dayIso, 1)) {
      const day = isoToUtcDay(dayIso);
      for (const slot of enabledSlots) {
        const occurrence = buildVisitPlanOccurrence(slot, day, plan.effectiveFrom, plan.effectiveTo, { timeZone });
        if (!occurrence) continue;

        const baseLabel = slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNameByCode);
        const label = occurrence.isExtra ? `${baseLabel} (extra)` : baseLabel;
        const onRota = rotaByKey.get(`${slot.id}|${dayIso}`) ?? [];
        const base = {
          visitPlanSlotId: slot.id,
          slotCode: slot.slotCode,
          slotLabel: label,
          date: dayIso,
          timeCritical: slot.timeCritical,
        };

        if (onRota.length) {
          const live = onRota.find((v) => CANCELLABLE_JOB_STATUSES.includes(v.scheduledJob.status));
          // Started, completed or already cancelled on the rota — nothing left to cancel here.
          if (!live || onRota.some((v) => v.scheduledJob.status === ScheduledJobStatus.IN_PROGRESS)) continue;
          if (live.scheduledStartDateTime.getTime() <= now) continue;
          const liveEnd =
            live.scheduledEndDateTime ??
            new Date(live.scheduledStartDateTime.getTime() + occurrence.durationMinutes * 60000);
          out.push({
            ...base,
            startDateTime: live.scheduledStartDateTime.toISOString(),
            endDateTime: liveEnd.toISOString(),
            durationMinutes: Math.round((liveEnd.getTime() - live.scheduledStartDateTime.getTime()) / 60000),
            status: 'ON_ROTA',
            scheduledJobId: live.scheduledJob.id,
            carerEmployeeIds: live.scheduledJob.allocations
              .filter((a) => ACTIVE_ALLOCATION_STATUSES.includes(a.status))
              .map((a) => a.employeeId),
          });
          continue;
        }

        if (occurrence.start.getTime() <= now) continue;
        out.push({
          ...base,
          startDateTime: occurrence.start.toISOString(),
          endDateTime: occurrence.end.toISOString(),
          durationMinutes: occurrence.durationMinutes,
          status: 'NOT_ON_ROTA',
          scheduledJobId: null,
          carerEmployeeIds: [...new Set(occurrence.carerWindows.map((w) => w.employeeId))],
        });
      }
    }
    return out.sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
  }

  private async resolveRange(query: VisitPlanDateChangesRangeQueryDto) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const settings = (await this.orgSettings.get()).data;
    const today = operationalTodayIso(new Date(), timeZone);
    const from = query.from && query.from > today ? query.from : today;
    const to = query.to ?? addDaysIso(today, clampRotaHorizonDays(settings.domRotaHorizonDays) - 1);
    if (to < from) throw new BadRequestException('to must be on or after from');
    if (to > addDaysIso(from, MAX_RANGE_DAYS)) {
      throw new BadRequestException(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
    }
    return { from, to, settings };
  }

  async listCancellableVisits(serviceUserId: string, planId: string, query: VisitPlanDateChangesRangeQueryDto) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const { from, to } = await this.resolveRange(query);
    if (plan.status !== VisitPlanStatus.ACTIVE) {
      return { data: { from, to, visits: [] as CancellableVisit[] } };
    }
    return { data: { from, to, visits: await this.listCancellable(plan, from, to) } };
  }

  /** Every date change recorded on the plan (cancelled dates and extra visits), newest date first. */
  async listDateChanges(serviceUserId: string, planId: string) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const roundNameByCode = await this.loadRoundNameMap();
    const rows = plan.slots.flatMap((slot) =>
      slot.exceptions.map((ex) => ({ slot, ex })),
    );
    // Extra visits over the weekly hours that went to a manager (waiting, approved or rejected).
    const extraRequests = await this.prisma.employeeHoursApproval.findMany({
      where: {
        visitPlanId: planId,
        requestType: EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS,
        status: {
          in: [
            EmployeeHoursApprovalStatus.PENDING,
            EmployeeHoursApprovalStatus.APPROVED,
            EmployeeHoursApprovalStatus.REJECTED,
          ],
        },
      },
      orderBy: { requestedAt: 'desc' },
    });
    const userIds = [
      ...new Set(
        [
          ...rows.map((r) => r.ex.createdById),
          ...extraRequests.flatMap((r) => [r.requestedById, r.decidedById]),
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const userName = new Map(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]),
    );

    // Extra visits: their rota job decides whether they can still be edited or deleted.
    const extraIds = rows.filter((r) => r.ex.exceptionType === VisitPlanSlotExceptionType.EXTRA).map((r) => r.ex.id);
    const extraJobs = extraIds.length
      ? await this.prisma.scheduledJob.findMany({
          where: {
            serviceUserId,
            deletedAt: null,
            isActive: true,
            OR: extraIds.map((id) => ({ metadata: { path: ['visitPlanExceptionId'], equals: id } })),
          },
          select: {
            status: true,
            metadata: true,
            visits: { where: { deletedAt: null }, take: 1, select: { status: true, actualStartDateTime: true } },
            allocations: {
              where: { deletedAt: null, isActive: true, status: { in: ACTIVE_ALLOCATION_ENUMS } },
              orderBy: [{ isLeadCarer: 'desc' }, { createdAt: 'asc' }],
              select: { employeeId: true, actualStartDateTime: true },
            },
          },
        })
      : [];
    const extraJobByException = new Map(
      extraJobs.map((j) => [String((j.metadata as Record<string, unknown> | null)?.visitPlanExceptionId ?? ''), j]),
    );

    const approvedByException = new Map(
      extraRequests
        .filter((r) => r.status === EmployeeHoursApprovalStatus.APPROVED)
        .map((r) => [(r.requestPayload as Partial<ExtraVisitApprovalPayload> | null)?.createdExceptionId ?? '', r]),
    );
    const approvalFields = (r: (typeof extraRequests)[number] | null) => {
      const p = (r?.requestPayload ?? null) as Partial<ExtraVisitApprovalPayload> | null;
      return {
        approvalId: r?.id ?? null,
        approvalStatus: (r?.status ?? null) as 'PENDING' | 'APPROVED' | 'REJECTED' | null,
        decidedByName: r?.decidedById ? (userName.get(r.decidedById) ?? null) : null,
        decidedAt: r?.decidedAt?.toISOString() ?? null,
        decisionNotes: r?.decisionNotes ?? null,
        weekMinutes: p?.weekMinutes ?? null,
        limitWeeklyHours: p?.limitWeeklyHours ?? null,
      };
    };

    const changes = rows
      .map(({ slot, ex }) => {
        const isCancel = ex.exceptionType === VisitPlanSlotExceptionType.SKIP;
        const extraJob = isCancel ? undefined : extraJobByException.get(ex.id);
        const extraVisit = extraJob?.visits[0];
        const canChange = Boolean(
          extraJob &&
            EDITABLE_EXTRA_JOB_STATUSES.includes(extraJob.status) &&
            (!extraVisit ||
              ((extraVisit.status === ScheduledVisitStatus.PLANNED ||
                extraVisit.status === ScheduledVisitStatus.NEEDS_ATTENTION) &&
                !extraVisit.actualStartDateTime)) &&
            !extraJob.allocations.some((a) => a.actualStartDateTime),
        );
        const reason = ex.reasonCode ? visitCancellationReasonMeta(ex.reasonCode as VisitCancellationReasonCode) : null;
        return {
          id: ex.id,
          visitPlanSlotId: slot.id,
          slotCode: slot.slotCode,
          slotLabel: slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNameByCode),
          date: ex.exceptionDate.toISOString().slice(0, 10),
          type: isCancel ? ('CANCELLED' as const) : ('EXTRA' as const),
          plannedStartTime: ex.plannedStartTime ?? slot.plannedStartTime,
          plannedEndTime: ex.plannedEndTime ?? slot.plannedEndTime,
          cancelledByParty: ex.cancelledByParty,
          cancelledByDescription: ex.cancelledByDescription,
          reasonCode: ex.reasonCode,
          reasonLabel: reason?.label ?? null,
          notes: ex.notes,
          chargeDecision: ex.chargeDecision,
          // Carers on the rota visit now (lead first), so later rota changes show here too.
          assignedEmployeeIds: extraJob ? extraJob.allocations.map((a) => a.employeeId) : (ex.assignedEmployeeIds ?? []),
          roundCode: slot.medicationRoundCode ?? normalizeVisitPlanSlotCode(slot.slotCode).replace(/__X\d*$/, ''),
          durationMinutes: ex.durationMinutes,
          requiredCarers: ex.requiredCarers,
          nightDuty: extraJob ? resolveStoredNightDuty({ jobMetadata: extraJob.metadata }) : null,
          canEdit: canChange,
          canDelete: canChange,
          source: ex.notes.startsWith(ABSENCE_NOTE_MARKER) ? ('ABSENCE' as const) : ('MANUAL' as const),
          recordedByName: ex.createdById ? (userName.get(ex.createdById) ?? null) : null,
          recordedAt: ex.createdAt.toISOString(),
          ...approvalFields(approvedByException.get(ex.id) ?? null),
        };
      });

    // Waiting and rejected requests have no extra visit yet: list them from the request.
    const requestRows = extraRequests
      .filter((r) => r.status !== EmployeeHoursApprovalStatus.APPROVED)
      .map((r) => {
        const p = (r.requestPayload ?? {}) as Partial<ExtraVisitApprovalPayload>;
        return {
          id: r.id,
          visitPlanSlotId: null as string | null,
          slotCode: '',
          slotLabel: p.slotLabel ?? '',
          date: p.date ?? '',
          type: 'EXTRA_REQUEST' as const,
          plannedStartTime: p.startTime ?? '',
          plannedEndTime: p.endTime ?? '',
          cancelledByParty: null,
          cancelledByDescription: null,
          reasonCode: null,
          reasonLabel: null,
          notes: [p.reason, p.notes].filter(Boolean).join('\n\n'),
          chargeDecision: null,
          assignedEmployeeIds: p.employeeIds ?? [],
          roundCode: p.roundCode ?? '',
          durationMinutes: p.durationMinutes ?? null,
          requiredCarers: p.requiredCarers ?? null,
          nightDuty: p.nightDuty ?? null,
          canEdit: false,
          canDelete: false,
          source: 'MANUAL' as const,
          recordedByName: r.requestedById ? (userName.get(r.requestedById) ?? null) : null,
          recordedAt: r.requestedAt.toISOString(),
          ...approvalFields(r),
        };
      });

    const allChanges = [...changes, ...requestRows].sort(
      (a, b) => b.date.localeCompare(a.date) || a.plannedStartTime.localeCompare(b.plannedStartTime),
    );

    return { data: { planStatus: plan.status, changes: allChanges } };
  }

  private assertReasonAllowed(cancelledBy: 'SERVICE_USER' | 'AGENCY' | 'OTHER', reasonCode: VisitCancellationReasonCode) {
    if (!VISIT_CANCELLATION_REASONS_BY_PARTY[cancelledBy].includes(reasonCode)) {
      throw new BadRequestException('This reason is not available for the selected "Cancelled by" option');
    }
  }

  /** Match each requested item to a visit that can still be cancelled, with its policy result. */
  private async evaluateItems(
    plan: DatePlanRow,
    items: VisitPlanDateChangeItemDto[],
    cancelledBy: 'SERVICE_USER' | 'AGENCY' | 'OTHER',
    reasonCode: VisitCancellationReasonCode,
  ) {
    if (plan.status !== VisitPlanStatus.ACTIVE) {
      throw new BadRequestException('Visits can only be cancelled on an active visit plan');
    }
    this.assertReasonAllowed(cancelledBy, reasonCode);

    const unique = new Map(items.map((i) => [`${i.visitPlanSlotId}|${i.date}`, i]));
    const dates = [...unique.values()].map((i) => i.date).sort();
    const settings = (await this.orgSettings.get()).data;
    const funding = await this.resolveFundingType(plan.serviceUserId);
    const cancellable = await this.listCancellable(plan, dates[0]!, dates[dates.length - 1]!);
    const byKey = new Map(cancellable.map((v) => [`${v.visitPlanSlotId}|${v.date}`, v]));

    const now = Date.now();
    const evaluated = [...unique.entries()].map(([key, item]) => {
      const visit = byKey.get(key) ?? null;
      if (!visit) return { item, visit: null, policy: null as VisitCancellationPolicyResult | null };
      const policy = evaluateVisitCancellationPolicy({
        cancelledBy,
        reasonCode,
        noticeHours: (new Date(visit.startDateTime).getTime() - now) / 3600000,
        rules: settings.domJobCancellationRules,
        hospitalExemption: settings.domCancellationHospitalExemption,
        fundingTypeCode: funding?.code ?? null,
      });
      return { item, visit, policy };
    });
    return { evaluated, funding };
  }

  async previewCancelVisits(serviceUserId: string, planId: string, dto: VisitPlanCancelVisitsPreviewDto) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const { evaluated, funding } = await this.evaluateItems(plan, dto.items, dto.cancelledBy, dto.reasonCode);
    return {
      data: {
        fundingTypeCode: funding?.code ?? null,
        fundingTypeName: funding?.name ?? null,
        items: evaluated.map(({ item, visit, policy }) => ({
          visitPlanSlotId: item.visitPlanSlotId,
          date: item.date,
          available: Boolean(visit),
          status: visit?.status ?? null,
          timeCritical: visit?.timeCritical ?? false,
          noticeHours: policy ? Math.round(policy.snapshot.noticeHours * 10) / 10 : null,
          suggestedDecision: policy?.decision ?? null,
          chargePercent: policy?.chargePercent ?? null,
          explanation: policy?.explanation ?? null,
        })),
      },
    };
  }

  async cancelVisits(
    user: RequestUser,
    serviceUserId: string,
    planId: string,
    dto: VisitPlanCancelVisitsDto,
    meta?: RequestAuditMeta,
  ) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const description = dto.cancelledByDescription?.trim() ?? '';
    if (dto.cancelledBy === 'OTHER' && !description) {
      throw new BadRequestException('Describe who cancelled when "Other" is selected');
    }
    const reasonNotes = dto.reasonNotes?.trim() || (dto.cancelledBy === 'OTHER' ? description : '');
    const overrideNotes = dto.chargeDecisionNotes?.trim() ?? '';
    if (dto.chargeDecision && !overrideNotes) {
      throw new BadRequestException('Billing notes are required when you change the suggested billing decision');
    }

    const { evaluated } = await this.evaluateItems(plan, dto.items, dto.cancelledBy, dto.reasonCode);
    const unavailable = evaluated.filter((e) => !e.visit);
    if (unavailable.length) {
      throw new BadRequestException(
        `${unavailable.length} selected visit${unavailable.length === 1 ? '' : 's'} can no longer be cancelled — refresh the list and try again`,
      );
    }

    const resolved = evaluated.map((e) => {
      const visit = e.visit!;
      const policy = e.policy!;
      const chargeDecision = (dto.chargeDecision ?? policy.decision) as VisitChargeDecision;
      const chargeDecisionNotes = dto.chargeDecision ? overrideNotes : policy.explanation;
      return { visit, policy, chargeDecision, chargeDecisionNotes };
    });

    // Check every visit against the rota cancellation rules first, so nothing is half applied.
    for (const r of resolved) {
      assertVisitCancellationCompliance({
        reasonCode: dto.reasonCode,
        reasonNotes,
        outcome: 'CANCELLED',
        welfareChecked: dto.welfareChecked,
        familyNotified: dto.familyNotified,
        commissionerNotified: dto.commissionerNotified,
        chargeDecision: r.chargeDecision,
        chargeDecisionNotes: r.chargeDecisionNotes,
        timeCriticalVisit: r.visit.timeCritical,
      });
    }

    let cancelledOnRota = 0;
    let futureDatesStopped = 0;
    for (const r of resolved) {
      const { visit, policy } = r;
      if (visit.status === 'ON_ROTA' && visit.scheduledJobId) {
        await this.housekeeping.cancelJob(
          user,
          visit.scheduledJobId,
          {
            reasonCode: dto.reasonCode,
            reasonNotes: reasonNotes || undefined,
            outcome: 'CANCELLED',
            welfareChecked: dto.welfareChecked,
            familyNotified: dto.familyNotified,
            commissionerNotified: dto.commissionerNotified,
            chargeDecision: r.chargeDecision,
            chargeDecisionNotes: r.chargeDecisionNotes,
            cancelledByParty: dto.cancelledBy,
            cancelledByDescription: description || undefined,
            cancellationSource: 'VISIT_PLAN',
            noticeHours: Math.round(policy.snapshot.noticeHours * 100) / 100,
            suggestedChargeDecision: policy.decision as VisitChargeDecision,
            suggestedChargePercent: policy.chargePercent,
            policySnapshot: policy.snapshot,
          },
          meta,
        );
        cancelledOnRota += 1;
      } else {
        futureDatesStopped += 1;
      }

      // The cancelled date stays on the plan so the rota never recreates this visit.
      const data = {
        notes: reasonNotes,
        cancelledByParty: dto.cancelledBy,
        cancelledByDescription: description || null,
        reasonCode: dto.reasonCode,
        chargeDecision: r.chargeDecision,
        chargeDecisionNotes: r.chargeDecisionNotes,
        createdById: user.id,
      };
      await this.prisma.visitPlanSlotException.upsert({
        where: {
          visitPlanSlotId_exceptionDate_exceptionType: {
            visitPlanSlotId: visit.visitPlanSlotId,
            exceptionDate: isoToUtcDay(visit.date),
            exceptionType: VisitPlanSlotExceptionType.SKIP,
          },
        },
        create: {
          visitPlanSlotId: visit.visitPlanSlotId,
          exceptionDate: isoToUtcDay(visit.date),
          exceptionType: VisitPlanSlotExceptionType.SKIP,
          ...data,
        },
        update: data,
      });
    }

    const reasonLabel = visitCancellationReasonMeta(dto.reasonCode).label;
    const perSlot = new Map<string, number>();
    for (const r of resolved) perSlot.set(r.visit.slotLabel, (perSlot.get(r.visit.slotLabel) ?? 0) + 1);
    const slotSummary = [...perSlot.entries()].map(([label, n]) => `${label} ×${n}`).join(', ');
    const change = {
      type: 'CANCEL_VISITS',
      cancelledBy: dto.cancelledBy,
      reasonCode: dto.reasonCode,
      visits: resolved.map((r) => ({
        visitPlanSlotId: r.visit.visitPlanSlotId,
        date: r.visit.date,
        status: r.visit.status,
        chargeDecision: r.chargeDecision,
      })),
    };
    await this.prisma.visitPlanAmendment.create({
      data: {
        visitPlanId: planId,
        reason: `Cancelled ${resolved.length} visit${resolved.length === 1 ? '' : 's'} (${slotSummary}) — ${reasonLabel}${reasonNotes ? `: ${reasonNotes}` : ''}`,
        snapshotBefore: {} as Prisma.InputJsonValue,
        snapshotAfter: { dateChange: change } as Prisma.InputJsonValue,
        amendedById: user.id,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_VISIT_PLAN_UPDATED,
      recordType: 'ServiceUserVisitPlan',
      recordId: planId,
      newValues: auditSnapshot({ dateChange: change }),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      message: `${resolved.length} visit${resolved.length === 1 ? '' : 's'} cancelled`,
      data: { cancelledOnRota, futureDatesStopped },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Extra visits
  // ---------------------------------------------------------------------------------------------

  /**
   * The time slot an extra visit belongs to: the one staff chose (the start time must fall in its
   * window), or else the one whose window contains the start time.
   *
   * Extra visits never share a row with the plan's regular visits. Each time slot gets hidden,
   * switched-off "host" rows (`MORNING__X`, `MORNING__X2`, …) that only carry extra visits, so a
   * slot can have any number of regular and extra visits on the same day.
   */
  private async resolveExtraSlot(plan: DatePlanRow, startHm: string, roundCode?: string) {
    const rounds = await this.prisma.medicationAdministrationRound.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { code: true, name: true, windowStart: true, windowEnd: true, sortOrder: true },
    });
    // A window that ends before it starts runs past midnight (e.g. Night 20:00–07:00).
    const inWindow = (ws: string, we: string) =>
      we > ws ? startHm >= ws && startHm < we : startHm >= ws || startHm < we;
    // The last minute of the day belongs to the slot that ends there (e.g. Night 20:00–23:59).
    const endsAtMidnight = (r: (typeof rounds)[number]) => r.windowEnd! >= '23:59' && startHm === r.windowEnd;
    const noSlot = (message: string) => ({ hosts: [] as DatePlanRow['slots'], label: null, message });

    let round: (typeof rounds)[number] | undefined;
    if (roundCode?.trim()) {
      round = rounds.find((r) => r.code === roundCode.trim());
      if (!round) return noSlot('That time slot is no longer active. Choose another time slot.');
      if (round.windowStart && round.windowEnd && !inWindow(round.windowStart, round.windowEnd) && !endsAtMidnight(round)) {
        return noSlot(
          `${startHm} is outside ${round.name} (${round.windowStart}–${round.windowEnd}). Choose a start time within the time slot.`,
        );
      }
    } else {
      const withWindow = rounds.filter((r) => r.windowStart && r.windowEnd);
      round =
        withWindow.find((r) => inWindow(r.windowStart!, r.windowEnd!)) ?? withWindow.find((r) => endsAtMidnight(r));
      if (!round) {
        return noSlot(`No time slot covers ${startHm}. Extra visits outside the time slot windows are not available yet.`);
      }
    }
    const hostCode = new RegExp(`^${round.code}${EXTRA_HOST_CODE_SUFFIX}\\d*$`);
    const hosts = plan.slots.filter((s) => hostCode.test(normalizeVisitPlanSlotCode(s.slotCode)));
    return { hosts, label: round.name, round, message: null as string | null };
  }

  /** Per-date checks for an extra visit: no clash for the service user or the chosen carers. */
  private async checkExtraDates(
    plan: DatePlanRow,
    dto: VisitPlanExtraVisitsPreviewDto,
    /** When editing an extra visit, its own rota job is not a clash. */
    options: { excludeJobId?: string } = {},
  ) {
    const excludeJob = options.excludeJobId ? { id: { not: options.excludeJobId } } : {};
    if (plan.status !== VisitPlanStatus.ACTIVE) {
      throw new BadRequestException('Extra visits can only be added on an active visit plan');
    }
    const employeeIds = [...new Set(dto.employeeIds)];
    if (employeeIds.length > dto.requiredCarers) {
      throw new BadRequestException(`Choose at most ${dto.requiredCarers} carer${dto.requiredCarers === 1 ? '' : 's'}`);
    }
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const resolved = await this.resolveExtraSlot(plan, dto.startTime, dto.roundCode);
    const dates = [...new Set(dto.dates)].sort();
    if (!resolved.label) {
      return {
        timeZone,
        hostByDate: new Map<string, DatePlanRow['slots'][number] | null>(),
        slotLabel: null,
        slotMessage: resolved.message,
        employeeIds,
        checks: dates.map((date): ExtraVisitDateCheck => ({ date, ok: false, message: resolved.message, clashEmployeeIds: [] })),
      };
    }

    const label = resolved.label;
    /** Existing host row that is free on each date; null = a new host row is needed. */
    const hostByDate = new Map<string, DatePlanRow['slots'][number] | null>();
    const now = Date.now();
    const planEnd = plan.effectiveTo ? plan.effectiveTo.toISOString().slice(0, 10) : null;
    const enabledSlots = plan.slots.filter((s) => s.isEnabled);
    const checks: ExtraVisitDateCheck[] = [];

    for (const date of dates) {
      const fail = (message: string, clashEmployeeIds: string[] = []) =>
        checks.push({ date, ok: false, message, clashEmployeeIds });
      const start = combineOperationalDateAndHm(date, dto.startTime, timeZone);
      // Ends at the end time on the clock, so an overnight visit is right on clock-change nights.
      const end = wallClockVisitEnd(date, dto.startTime, addMinutesToHm(dto.startTime, dto.durationMinutes), timeZone);
      if (Number.isNaN(start.getTime())) {
        fail('Invalid date or time');
        continue;
      }
      if (start.getTime() <= now) {
        fail('This date and time is in the past');
        continue;
      }
      if (planEnd && date > planEnd) {
        fail('After the end date of the visit plan');
        continue;
      }

      const day = isoToUtcDay(date);
      const bounds = operationalDayBounds(date, timeZone);
      let host: DatePlanRow['slots'][number] | null = null;
      for (const candidate of resolved.hosts) {
        if (candidate.exceptions.some((ex) => ex.exceptionDate.toISOString().slice(0, 10) === date)) continue;
        const onRota = await this.prisma.scheduledVisit.count({
          where: {
            visitPlanSlotId: candidate.id,
            deletedAt: null,
            scheduledStartDateTime: { gte: bounds.start, lte: bounds.end },
          },
        });
        if (onRota === 0) {
          host = candidate;
          break;
        }
      }
      hostByDate.set(date, host);

      // The service user cannot have two visits at once — on the rota or still to be generated.
      const overlapping = await this.prisma.scheduledJob.findFirst({
        where: {
          ...excludeJob,
          serviceUserId: plan.serviceUserId,
          deletedAt: null,
          isActive: true,
          status: { notIn: NOT_OCCUPYING_JOB_STATUSES },
          scheduledStartDateTime: { lt: end },
          scheduledEndDateTime: { gt: start },
        },
        select: { scheduledStartDateTime: true, scheduledEndDateTime: true },
      });
      if (overlapping) {
        fail(
          `Overlaps another visit (${formatHmInZone(overlapping.scheduledStartDateTime, timeZone)}–${
            overlapping.scheduledEndDateTime ? formatHmInZone(overlapping.scheduledEndDateTime, timeZone) : '?'
          })`,
        );
        continue;
      }
      // Planned visits not on the rota yet can start the day before (overnight) or on the day.
      const planned = [addDaysIso(date, -1), date]
        .flatMap((d) =>
          enabledSlots.map((s) => buildVisitPlanOccurrence(s, isoToUtcDay(d), plan.effectiveFrom, plan.effectiveTo, { timeZone })),
        )
        .find((o) => o && o.start.getTime() < end.getTime() && o.end.getTime() > start.getTime());
      if (planned) {
        fail(
          `Overlaps a planned visit (${formatHmInZone(planned.start, timeZone)}–${formatHmInZone(planned.end, timeZone)})`,
        );
        continue;
      }

      if (employeeIds.length) {
        const busy = await this.prisma.jobAllocation.findMany({
          where: {
            employeeId: { in: employeeIds },
            deletedAt: null,
            isActive: true,
            status: { in: ACTIVE_ALLOCATION_ENUMS },
            scheduledJob: {
              ...excludeJob,
              deletedAt: null,
              isActive: true,
              status: { notIn: NOT_OCCUPYING_JOB_STATUSES },
              scheduledStartDateTime: { lt: end },
              scheduledEndDateTime: { gt: start },
            },
          },
          select: { employeeId: true },
        });
        if (busy.length) {
          const clash = [...new Set(busy.map((b) => b.employeeId))];
          fail(
            clash.length === 1
              ? 'The chosen carer already has a visit at this time'
              : `${clash.length} chosen carers already have a visit at this time`,
            clash,
          );
          continue;
        }
      }

      checks.push({ date, ok: true, message: null, clashEmployeeIds: [] });
    }

    return {
      timeZone,
      hostByDate,
      hosts: resolved.hosts,
      slotLabel: label,
      slotMessage: null as string | null,
      round: resolved.round,
      employeeIds,
      checks,
    };
  }

  async previewExtraVisits(serviceUserId: string, planId: string, dto: VisitPlanExtraVisitsPreviewDto) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const editingJob = dto.editingExceptionId
      ? await this.prisma.scheduledJob.findFirst({
          where: {
            serviceUserId,
            deletedAt: null,
            isActive: true,
            metadata: { path: ['visitPlanExceptionId'], equals: dto.editingExceptionId },
          },
          select: { id: true },
        })
      : null;
    const result = await this.checkExtraDates(plan, dto, { excludeJobId: editingJob?.id });
    // New extra visits: say which dates go over the weekly hours and what happens to them
    // (Settings → Dom Rules: manager approval, blocked, or added with a warning).
    let limitWeeklyHours: number | null = null;
    const { rules } = await this.weeklyHours.context();
    // The dialog puts "over the weekly contracted hours:" in front of this.
    const overMessage = (weekMinutes: number, limit: number | null) =>
      `that week would have ${formatMinutesAsHours(weekMinutes)} of ${formatMinutesAsHours(
        Math.round((limit ?? 0) * 60),
      )}`;
    if (!dto.editingExceptionId && result.slotLabel) {
      const hours = await this.weeklyHours.classifyExtraDates({
        serviceUserId,
        planId: plan.id,
        fallbackHours: plan.weeklyContractedHours,
        dates: result.checks.filter((c) => c.ok).map((c) => c.date),
        startTime: dto.startTime,
        endTime: addMinutesToHm(dto.startTime, dto.durationMinutes),
        durationMinutes: dto.durationMinutes,
        requiredCarers: dto.requiredCarers,
      });
      limitWeeklyHours = hours.limitWeeklyHours;
      const byDate = new Map(hours.dates.map((d) => [d.date, d]));
      for (const check of result.checks) {
        const h = byDate.get(check.date);
        if (!h) continue;
        check.weekStart = h.weekStart;
        check.weekMinutes = h.weekMinutes;
        if (!h.needsApproval) continue;
        if (rules.extraOverLimit === 'MANAGER_APPROVAL') {
          check.needsApproval = true;
        } else {
          check.overWeeklyHours = true;
          check.message = overMessage(h.weekMinutes, hours.limitWeeklyHours);
          if (rules.extraOverLimit === 'BLOCK') check.ok = false;
        }
      }
    }
    // Editing: the same hours rule as the save, so the dialog does not say "can be saved" when it can't.
    if (dto.editingExceptionId && result.slotLabel) {
      const hours = await this.weeklyHours.checkExtraEdit({
        serviceUserId,
        planId: plan.id,
        fallbackHours: plan.weeklyContractedHours,
        exceptionId: dto.editingExceptionId,
        startTime: dto.startTime,
        endTime: addMinutesToHm(dto.startTime, dto.durationMinutes),
        durationMinutes: dto.durationMinutes,
        requiredCarers: dto.requiredCarers,
      });
      if (hours) {
        limitWeeklyHours = hours.limitWeeklyHours;
        for (const check of result.checks) {
          check.weekStart = hours.weekStart;
          check.weekMinutes = hours.weekMinutes;
          if (check.ok && hours.over) {
            // Blocked by default; Settings → Dom Rules can make it a warning only.
            check.overWeeklyHours = true;
            check.message = overMessage(hours.weekMinutes, hours.limitWeeklyHours);
            if (hours.blocked) check.ok = false;
          }
        }
      }
    }
    // Carers over their contracted weekly hours: what saving will do for each date.
    if (result.slotLabel && result.employeeIds.length) {
      const endHm = addMinutesToHm(dto.startTime, dto.durationMinutes);
      const dates = result.checks.filter((c) => c.ok);
      const editingAllocations = editingJob
        ? await this.prisma.jobAllocation.findMany({
            where: {
              scheduledJobId: editingJob.id,
              deletedAt: null,
              isActive: true,
              status: { in: ACTIVE_ALLOCATION_ENUMS },
            },
            select: {
              id: true,
              employeeId: true,
              scheduledStartDateTime: true,
              scheduledEndDateTime: true,
              durationMinutes: true,
            },
          })
        : [];
      const excludeAllocationIds = editingAllocations.map((a) => a.id);
      const carers = await this.carerHoursForExtras(
        editingJob
          ? carersGivenMoreTime(result.employeeIds, editingAllocations, dto.durationMinutes)
          : result.employeeIds,
        dates.map((c) => ({
          date: c.date,
          start: combineOperationalDateAndHm(c.date, dto.startTime, result.timeZone),
          end: wallClockVisitEnd(c.date, dto.startTime, endHm, result.timeZone),
        })),
        serviceUserId,
        excludeAllocationIds,
        false,
      );
      if (carers.over.size) {
        const names = new Map(
          (
            await this.prisma.employeePersonalDetail.findMany({
              where: { employeeId: { in: result.employeeIds }, deletedAt: null },
              select: { employeeId: true, firstName: true, lastName: true },
            })
          ).map((p) => [p.employeeId, `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'Carer']),
        );
        for (const check of dates) {
          const over = result.employeeIds
            .filter((id) => carers.over.has(`${check.date}|${id}`))
            .map((id) => ({
              employeeId: id,
              message: `${names.get(id) ?? 'Carer'} would go ${carers.over.get(`${check.date}|${id}`)}`,
            }));
          if (!over.length) continue;
          if (carers.behavior === 'DONT_ALLOW') {
            check.ok = false;
            check.message = `${over[0].message} — not allowed (Settings → Dom Rules)`;
          } else {
            check.carerOverHours = over.map((o) => ({
              ...o,
              outcome: carers.behavior === 'MANAGER_APPROVAL' ? 'MANAGER_APPROVAL' : 'REQUEST_CONFIRMATION',
            }));
          }
        }
      }
    }
    return {
      data: {
        slotLabel: result.slotLabel,
        slotMessage: result.slotMessage,
        endTime: addMinutesToHm(dto.startTime, dto.durationMinutes),
        dates: result.checks,
        limitWeeklyHours,
      },
    };
  }

  async addExtraVisits(
    user: RequestUser,
    serviceUserId: string,
    planId: string,
    dto: VisitPlanAddExtraVisitsDto,
    meta?: RequestAuditMeta,
    /** A manager approved it over the weekly hours: create without checking the hours. */
    options: { approvedOverHours?: boolean } = {},
  ) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Give a reason for the extra visit');
    const result = await this.checkExtraDates(plan, dto);
    if (!result.slotLabel || !result.round) throw new BadRequestException(result.slotMessage ?? 'No time slot covers this time');
    const valid = result.checks.filter((c) => c.ok);
    if (!valid.length) {
      throw new BadRequestException(result.checks[0]?.message ?? 'None of the selected dates can take an extra visit');
    }

    const { timeZone, employeeIds, round } = result;
    const label = result.slotLabel;
    const endHm = addMinutesToHm(dto.startTime, dto.durationMinutes);
    // Waking / sleeping night applies to the Night time slot or a visit that runs past midnight.
    const nightTypeAllowed = isNightTimeSlotCode(round.code) || slotTimesCrossMidnight(dto.startTime, endHm);
    const nightDuty = dto.nightDuty ?? VisitPlanNightDuty.NONE;
    if (nightDuty !== VisitPlanNightDuty.NONE && !nightTypeAllowed) {
      throw new BadRequestException(
        'Waking or sleeping night is only for a visit in the Night time slot or one that runs past midnight',
      );
    }
    const visitName = `${label} (extra)`;
    const notes = [reason, dto.notes?.trim()].filter(Boolean).join('\n\n');

    // Dates whose week would go over the service user's weekly hours: by default they go to a
    // manager (one request per date) and the rest are created now. Settings → Dom Rules can block
    // them instead, or add them with a warning only. Night visits count their full hours.
    let toCreate = valid;
    const sentForApproval: Array<{ date: string; weekStart: string; weekMinutes: number; approvalId: string }> = [];
    const overWeeklyHours: Array<{ date: string; weekMinutes: number }> = [];
    const blockedOverHours: ExtraVisitDateCheck[] = [];
    if (!options.approvedOverHours) {
      const { rules } = await this.weeklyHours.context();
      const hours = await this.weeklyHours.classifyExtraDates({
        serviceUserId,
        planId: plan.id,
        fallbackHours: plan.weeklyContractedHours,
        dates: valid.map((c) => c.date),
        startTime: dto.startTime,
        endTime: endHm,
        durationMinutes: dto.durationMinutes,
        requiredCarers: dto.requiredCarers,
      });
      const over = hours.dates.filter((d) => d.needsApproval);
      const overDates = new Set(over.map((d) => d.date));
      const overLabel = (weekMinutes: number) =>
        `Over the weekly contracted hours: that week would have ${formatMinutesAsHours(weekMinutes)} of ${formatMinutesAsHours(
          Math.round((hours.limitWeeklyHours ?? 0) * 60),
        )}`;
      if (rules.extraOverLimit === 'WARN') {
        overWeeklyHours.push(...over.map((d) => ({ date: d.date, weekMinutes: d.weekMinutes })));
      } else {
        toCreate = valid.filter((c) => !overDates.has(c.date));
      }
      if (over.length && rules.extraOverLimit === 'BLOCK') {
        if (!toCreate.length) throw new BadRequestException(`${overLabel(over[0].weekMinutes)}.`);
        for (const d of over) {
          const check = valid.find((c) => c.date === d.date);
          if (check) blockedOverHours.push({ ...check, ok: false, message: overLabel(d.weekMinutes) });
        }
      }
      if (over.length && rules.extraOverLimit === 'MANAGER_APPROVAL') {
        const display = await this.orgSettings.getOperationalDisplaySettings();
        const limitMinutes = hours.limitWeeklyHours != null ? Math.round(hours.limitWeeklyHours * 60) : null;
        for (const d of over) {
          const payload: ExtraVisitApprovalPayload = {
            kind: 'EXTRA_VISIT',
            date: d.date,
            weekStart: d.weekStart,
            weekMinutes: d.weekMinutes,
            limitWeeklyHours: hours.limitWeeklyHours,
            roundCode: round.code,
            slotLabel: label,
            startTime: dto.startTime,
            endTime: endHm,
            durationMinutes: dto.durationMinutes,
            requiredCarers: dto.requiredCarers,
            employeeIds,
            nightDuty,
            reason,
            notes: dto.notes?.trim() || null,
          };
          const approval = await this.prisma.employeeHoursApproval.create({
            data: {
              requestType: EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS,
              status: EmployeeHoursApprovalStatus.PENDING,
              serviceUserId,
              visitPlanId: plan.id,
              contractedWeeklyHours: hours.limitWeeklyHours,
              projectedWeeklyHours: Math.round((d.weekMinutes / 60) * 10) / 10,
              extraHours:
                limitMinutes != null ? Math.round(((d.weekMinutes - limitMinutes) / 60) * 10) / 10 : null,
              requestPayload: payload as unknown as Prisma.InputJsonValue,
              reason,
              requestedById: user.id,
            },
          });
          sentForApproval.push({ date: d.date, weekStart: d.weekStart, weekMinutes: d.weekMinutes, approvalId: approval.id });
          void this.hoursApprovalNotifications.notifyExtraVisitRequested({
            approvalId: approval.id,
            serviceUserId,
            visitLabel: `${formatOrganisationIsoDate(d.date, display.dateDisplayFormat)} ${dto.startTime}–${endHm}`,
            weekHoursLabel: `${formatMinutesAsHours(d.weekMinutes)} of ${formatMinutesAsHours(limitMinutes ?? 0)}`,
            requestedById: user.id,
          });
        }
        await this.audit.logAudit({
          userId: user.id,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.EXTRA_VISIT_OVER_HOURS_REQUESTED,
          recordType: 'ServiceUserVisitPlan',
          recordId: planId,
          newValues: auditSnapshot({ sentForApproval, startTime: dto.startTime, durationMinutes: dto.durationMinutes }),
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
      }
    }

    // One new host row is enough for every date that has no free host: each date is used once.
    let newHost: DatePlanRow['slots'][number] | null = null;
    const hostFor = async (date: string) => {
      const existing = result.hostByDate.get(date);
      if (existing) return existing;
      if (newHost) return newHost;
      const taken = new Set(plan.slots.map((s) => normalizeVisitPlanSlotCode(s.slotCode)));
      let slotCode = `${round.code}${EXTRA_HOST_CODE_SUFFIX}`;
      for (let n = 2; taken.has(slotCode); n += 1) slotCode = `${round.code}${EXTRA_HOST_CODE_SUFFIX}${n}`;
      const created = await this.prisma.visitPlanSlot.create({
        data: {
          visitPlanId: plan.id,
          slotCode,
          medicationRoundCode: round.code,
          daysOfWeek: [],
          plannedStartTime: round.windowStart ?? dto.startTime,
          plannedEndTime: round.windowEnd ?? endHm,
          isEnabled: false,
          sortOrder: round.sortOrder,
        },
      });
      newHost = { ...created, carerAssignments: [], exceptions: [] };
      return newHost;
    };

    const su = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId }, include: { address: true } });
    const scheduledDueTimes = await loadScheduledMedicationDueTimes(this.prisma, serviceUserId);
    const address = su?.address
      ? [su.address.addressLine1, su.address.addressLine2, su.address.town, su.address.postcode].filter(Boolean).join(', ')
      : null;

    // Carers over their contracted weekly hours (Settings → Dom Rules "Carer over weekly hours").
    const carerCheck = await this.carerHoursForExtras(
      employeeIds,
      toCreate.map((c) => ({
        date: c.date,
        start: combineOperationalDateAndHm(c.date, dto.startTime, timeZone),
        end: wallClockVisitEnd(c.date, dto.startTime, endHm, timeZone),
      })),
      serviceUserId,
    );
    const carerApprovals: Array<{ date: string; employeeId: string; approvalId: string }> = [];
    const carerWarnings: Array<{ date: string; employeeId: string; message: string }> = [];
    const waitingForManager = (date: string, employeeId: string) =>
      carerCheck.behavior === 'MANAGER_APPROVAL' && carerCheck.over.has(`${date}|${employeeId}`);

    const createdJobIds: string[] = [];
    const createdExceptionIds: string[] = [];
    for (const check of toCreate) {
      const date = check.date;
      const day = isoToUtcDay(date);
      const start = combineOperationalDateAndHm(date, dto.startTime, timeZone);
      const end = wallClockVisitEnd(date, dto.startTime, endHm, timeZone);
      // Real length: differs from the chosen duration only on the nights the clocks change.
      const actualMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
      const isOvernight = operationalTodayIso(end, timeZone) !== date && formatHmInZone(end, timeZone) !== '00:00';

      const slot = await hostFor(date);
      const jobId = await this.prisma.$transaction(async (tx) => {
        const exception = await tx.visitPlanSlotException.create({
          data: {
            visitPlanSlotId: slot.id,
            exceptionDate: day,
            exceptionType: VisitPlanSlotExceptionType.EXTRA,
            plannedStartTime: dto.startTime,
            plannedEndTime: endHm,
            durationMinutes: dto.durationMinutes,
            requiredCarers: dto.requiredCarers,
            notes,
            assignedEmployeeIds: employeeIds,
            createdById: user.id,
          },
        });

        let batch = await tx.scheduleBatch.findFirst({ where: { scheduleDate: day, deletedAt: null, isActive: true } });
        if (!batch) {
          batch = await tx.scheduleBatch.create({
            data: {
              scheduleDate: day,
              status: 'BUILDING',
              buildSource: 'MANUAL',
              metadata: { visitPlanId: planId, extraVisit: true } as Prisma.InputJsonValue,
              createdById: user.id,
            },
          });
        }

        // Carers waiting for a manager (over their weekly hours) are not on the visit yet.
        const onVisit = employeeIds.filter((id) => !waitingForManager(date, id));
        const allocated = onVisit.length;
        const job = await tx.scheduledJob.create({
          data: {
            scheduleBatchId: batch.id,
            serviceUserId,
            jobName: `${visitName} — ${su?.preferredName ?? su?.firstName ?? 'Client'}`,
            scheduledStartDateTime: start,
            scheduledEndDateTime: end,
            estimatedDurationMinutes: actualMinutes,
            requiredCarers: dto.requiredCarers,
            status: allocated >= dto.requiredCarers ? ScheduledJobStatus.ALLOCATED : ScheduledJobStatus.NEEDS_ATTENTION,
            postcode: su?.address?.postcode ?? null,
            address,
            notes: notes || null,
            metadata: {
              ...visitPlanGeneratedJobMetadata({
                visitPlanId: planId,
                visitPlanSlotId: slot.id,
                date,
                isOvernight,
                // The hidden host row is always a normal visit; the extra visit's own night type lives here.
                nightDuty,
              }),
              [VISIT_PLAN_EXTRA_JOB_METADATA_KEY]: true,
              visitPlanExceptionId: exception.id,
            } as Prisma.InputJsonValue,
            createdById: user.id,
          },
        });

        const visit = await tx.scheduledVisit.create({
          data: {
            scheduledJobId: job.id,
            serviceUserId,
            visitName,
            scheduledStartDateTime: start,
            scheduledEndDateTime: end,
            requiredCarers: dto.requiredCarers,
            status: allocated >= dto.requiredCarers ? ScheduledVisitStatus.PLANNED : ScheduledVisitStatus.NEEDS_ATTENTION,
            medicationRequired: resolveMedicationRequiredForSlot({
              plannedStartTime: dto.startTime,
              plannedEndTime: endHm,
              scheduledDueTimes,
            }),
            notesRequired: slot.notesRequired,
            photoRequired: slot.photoAllowed,
            visitPlanSlotId: slot.id,
            createdById: user.id,
          },
        });

        for (const [index, employeeId] of onVisit.entries()) {
          const overMessage = carerCheck.over.get(`${date}|${employeeId}`);
          await tx.jobAllocation.create({
            data: {
              scheduledJobId: job.id,
              scheduledVisitId: visit.id,
              employeeId,
              // Over the weekly hours with "request confirmation": on the visit, to be confirmed.
              status: overMessage ? AllocationStatus.PENDING_CONFIRMATION : AllocationStatus.CONFIRMED,
              requiresConfirmation: Boolean(overMessage),
              ...(overMessage
                ? { warningTypes: ['CAPACITY_EXCEEDED'], warningMessages: [`Carer ${overMessage}`] }
                : {}),
              allocatedById: user.id,
              scheduledStartDateTime: start,
              scheduledEndDateTime: end,
              durationMinutes: actualMinutes,
              isLeadCarer: index === 0,
            },
          });
          if (overMessage) carerWarnings.push({ date, employeeId, message: overMessage });
        }
        createdExceptionIds.push(exception.id);
        return { jobId: job.id, visitId: visit.id };
      });
      createdJobIds.push(jobId.jobId);
      for (const employeeId of employeeIds.filter((id) => waitingForManager(date, id))) {
        const weekStart = await this.carerHours.weekStartOf(start);
        const count = await this.carerHours.count(this.prisma, employeeId, { weekStarts: [weekStart] });
        const request = await this.carerHours.requestRotaVisitApproval(this.prisma, {
          employeeId,
          scheduledJobId: jobId.jobId,
          serviceUserId,
          requestedById: user.id,
          start,
          end,
          weekStart,
          weekMinutes: (count.weeks[0]?.minutes ?? 0) + actualMinutes,
          limitMinutes: count.limitMinutes ?? 0,
          source: 'EXTRA_VISIT',
          allocation: { scheduledVisitId: jobId.visitId, isLeadCarer: false },
        });
        carerApprovals.push({ date, employeeId, approvalId: request.id });
      }
    }

    const skipped = [...result.checks.filter((c) => !c.ok), ...blockedOverHours];
    if (toCreate.length) {
      const change = {
        type: 'ADD_EXTRA_VISITS',
        timeSlot: round.code,
        startTime: dto.startTime,
        durationMinutes: dto.durationMinutes,
        requiredCarers: dto.requiredCarers,
        employeeIds,
        dates: toCreate.map((c) => c.date),
        ...(options.approvedOverHours ? { approvedOverWeeklyHours: true } : {}),
      };
      await this.prisma.visitPlanAmendment.create({
        data: {
          visitPlanId: planId,
          reason: `Added ${toCreate.length} extra visit${toCreate.length === 1 ? '' : 's'} (${label} ${dto.startTime}–${endHm}) — ${reason}`,
          snapshotBefore: {} as Prisma.InputJsonValue,
          snapshotAfter: { dateChange: change } as Prisma.InputJsonValue,
          amendedById: user.id,
        },
      });
      await this.audit.logAudit({
        userId: user.id,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_VISIT_PLAN_UPDATED,
        recordType: 'ServiceUserVisitPlan',
        recordId: planId,
        newValues: auditSnapshot({ dateChange: change }),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      await this.notifyCarersOfExtraVisits(createdJobIds, serviceUserId, timeZone);
    }

    const parts = [
      toCreate.length ? `${toCreate.length} extra visit${toCreate.length === 1 ? '' : 's'} added` : null,
      sentForApproval.length
        ? `${sentForApproval.length} sent for manager approval (over the weekly hours)`
        : null,
      overWeeklyHours.length
        ? `${overWeeklyHours.length} ${overWeeklyHours.length === 1 ? 'goes' : 'go'} over the weekly hours (allowed by settings)`
        : null,
      carerApprovals.length
        ? `${carerApprovals.length} carer place${carerApprovals.length === 1 ? '' : 's'} sent to a manager (carer over their weekly hours)`
        : null,
      carerWarnings.length
        ? `${carerWarnings.length} carer place${carerWarnings.length === 1 ? '' : 's'} need confirmation (carer over their weekly hours)`
        : null,
    ].filter(Boolean);
    return {
      message: parts.join('. ') || 'No extra visits added',
      data: {
        created: toCreate.length,
        createdDates: toCreate.map((c) => c.date),
        createdExceptionIds,
        sentForApproval,
        overWeeklyHours,
        carerApprovals,
        carerWarnings,
        skipped: skipped.map((c) => ({ date: c.date, message: c.message })),
      },
    };
  }

  /**
   * A manager approved an extra visit over the weekly hours: create it now, with the same
   * checks as any extra visit except the hours.
   */
  async createApprovedExtraVisit(
    userId: string,
    serviceUserId: string,
    planId: string,
    payload: Record<string, unknown>,
    meta?: RequestAuditMeta,
  ): Promise<{ exceptionId: string }> {
    const p = payload as unknown as ExtraVisitApprovalPayload;
    const result = await this.addExtraVisits(
      { id: userId } as RequestUser,
      serviceUserId,
      planId,
      {
        roundCode: p.roundCode,
        dates: [p.date],
        startTime: p.startTime,
        durationMinutes: p.durationMinutes,
        requiredCarers: p.requiredCarers,
        employeeIds: p.employeeIds ?? [],
        reason: p.reason,
        notes: p.notes ?? undefined,
        nightDuty: p.nightDuty,
      },
      meta,
      { approvedOverHours: true },
    );
    const exceptionId = result.data.createdExceptionIds[0];
    if (!exceptionId) {
      const why = result.data.skipped[0]?.message;
      throw new BadRequestException(`The extra visit could not be created${why ? `: ${why}` : ''}.`);
    }
    return { exceptionId };
  }

  /** That week's visit minutes today with this requested extra visit added. */
  async currentExtraVisitWeekHours(
    serviceUserId: string,
    planId: string,
    payload: Record<string, unknown>,
  ): Promise<{ weekMinutes: number; limitWeeklyHours: number | null }> {
    const p = payload as unknown as ExtraVisitApprovalPayload;
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const hours = await this.weeklyHours.classifyExtraDates({
      serviceUserId,
      planId: plan.id,
      fallbackHours: plan.weeklyContractedHours,
      dates: [p.date],
      startTime: p.startTime,
      endTime: p.endTime,
      durationMinutes: p.durationMinutes,
      requiredCarers: p.requiredCarers,
    });
    return {
      weekMinutes: hours.dates[0]?.weekMinutes ?? p.weekMinutes,
      limitWeeklyHours: hours.limitWeeklyHours,
    };
  }

  /**
   * Weekly hours lowered to `newHours`: which upcoming visits to cancel so no checked week goes
   * over. In each week over, the latest visits go first. Time-critical visits are never picked
   * (cancelling them needs welfare and family checks). Nothing is saved.
   */
  async planHoursDecrease(serviceUserId: string, newHours: number) {
    const empty = {
      planId: null as string | null,
      limitMinutes: Math.round(newHours * 60),
      overWeeks: [] as Array<{ weekStart: string; minutes: number }>,
      toCancel: [] as CancellableVisit[],
      stillOverWeeks: [] as Array<{ weekStart: string; minutes: number }>,
    };
    const active = await this.prisma.serviceUserVisitPlan.findFirst({
      where: { serviceUserId, status: VisitPlanStatus.ACTIVE, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!active) return empty;
    const plan = await this.getPlanOrThrow(serviceUserId, active.id);
    const ctx = await this.weeklyHours.context();
    const limitMinutes = Math.round(newHours * 60);
    const cancelledOnRota = await this.weeklyHours.cancelledOnRota(this.prisma, plan.id);
    const weeks = computeVisitPlanWeeklyHours({
      slots: plan.slots,
      planAnchor: plan.effectiveFrom,
      planEffectiveTo: plan.effectiveTo,
      timeZone: ctx.timeZone,
      mode: ctx.mode,
      weeks: ctx.checkWeeks,
      cancelledOnRota,
      additionalMinutesByDay: await this.weeklyHours.specialVisitMinutesByDay(this.prisma, serviceUserId),
    }).weeks;
    const overWeeks = weeks
      .filter((w) => w.minutes > limitMinutes)
      .map((w) => ({ weekStart: w.weekStart, minutes: w.minutes }));
    if (!overWeeks.length) return { ...empty, planId: plan.id };

    const today = operationalTodayIso(new Date(), ctx.timeZone);
    const lastDay = addDaysIso(weeks[weeks.length - 1].weekStart, 6);
    const candidates = (await this.listCancellable(plan, today, lastDay)).filter((v) => !v.timeCritical);
    const toCancel: CancellableVisit[] = [];
    const stillOverWeeks: Array<{ weekStart: string; minutes: number }> = [];
    for (const week of overWeeks) {
      const weekEnd = addDaysIso(week.weekStart, 6);
      const inWeek = candidates
        .filter((v) => v.date >= week.weekStart && v.date <= weekEnd)
        .sort((a, b) => b.startDateTime.localeCompare(a.startDateTime));
      // Visits count independently, so cancelling one lowers its week by exactly its own minutes.
      let minutes = week.minutes;
      for (const visit of inWeek) {
        if (minutes <= limitMinutes) break;
        const slot = plan.slots.find((sl) => sl.id === visit.visitPlanSlotId);
        if (!slot) continue;
        const visitMinutes = visitPlanOccurrenceMinutes({
          slot,
          dayIso: visit.date,
          planAnchor: plan.effectiveFrom,
          planEffectiveTo: plan.effectiveTo,
          timeZone: ctx.timeZone,
          mode: ctx.mode,
          cancelledOnRota,
        });
        if (visitMinutes <= 0) continue;
        minutes -= visitMinutes;
        toCancel.push(visit);
      }
      if (minutes > limitMinutes) stillOverWeeks.push({ weekStart: week.weekStart, minutes });
    }
    return { planId: plan.id, limitMinutes, overWeeks, toCancel, stillOverWeeks };
  }

  /**
   * Carers over their contracted weekly hours with these new visits — Settings → Dom Rules
   * "Carer over weekly hours": "don't allow" refuses the change; otherwise returns the
   * "date|employeeId" pairs over the hours with a message (manager approval: the carer waits;
   * request confirmation: they go on needing confirmation).
   */
  private async carerHoursForExtras(
    employeeIds: string[],
    visits: Array<{ date: string; start: Date; end: Date }>,
    serviceUserId: string,
    excludeAllocationIds: string[] = [],
    /** False for the preview: report "don't allow" instead of refusing. */
    throwOnBlock = true,
  ): Promise<{
    behavior: Awaited<ReturnType<CarerWeeklyHoursService['rule']>>['behavior'];
    over: Map<string, string>;
  }> {
    const rule = await this.carerHours.rule();
    const over = new Map<string, string>();
    if (rule.behavior === 'ALWAYS_ALLOW' || !employeeIds.length || !visits.length) {
      return { behavior: rule.behavior, over };
    }
    const hours = (m: number) => formatMinutesAsHours(m);
    for (const employeeId of employeeIds) {
      const check = await this.carerHours.checkNewVisits(
        this.prisma,
        employeeId,
        visits.map((v) => ({ start: v.start, end: v.end, serviceUserId })),
        { excludeAllocationIds },
      );
      for (const i of check.over) {
        const visit = visits[i];
        const weekStart = await this.carerHours.weekStartOf(visit.start);
        const week = check.weeks.find((w) => w.weekStart === weekStart);
        over.set(
          `${visit.date}|${employeeId}`,
          `over their contracted weekly hours (that week ${hours(week?.minutes ?? 0)} of ${hours(check.limitMinutes ?? 0)})`,
        );
      }
    }
    if (over.size && rule.behavior === 'DONT_ALLOW' && throwOnBlock) {
      const [key, message] = [...over.entries()][0];
      const [date, employeeId] = key.split('|');
      const person = await this.prisma.employeePersonalDetail.findFirst({
        where: { employeeId, deletedAt: null },
        select: { firstName: true, lastName: true },
      });
      const name = `${person?.firstName ?? ''} ${person?.lastName ?? ''}`.trim() || 'A carer';
      const display = await this.orgSettings.getOperationalDisplaySettings();
      throw new BadRequestException(
        `${name} would go ${message} on ${formatOrganisationIsoDate(date, display.dateDisplayFormat)}. Choose another carer or change the visit.`,
      );
    }
    return { behavior: rule.behavior, over };
  }

  /**
   * Put every carer of the plan back onto its upcoming rota visits as the plan says (after a
   * manager approves a carer over their weekly hours). Visits still held back stay without them.
   */
  async resyncPlanCarers(userId: string, planId: string): Promise<{ jobsUpdated: number }> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const plan = await this.prisma.serviceUserVisitPlan.findUnique({
      where: { id: planId },
      select: {
        status: true,
        respectWorkingPatternOnSync: true,
        slots: { where: { isActive: true }, include: { carerAssignments: true } },
      },
    });
    if (!plan || plan.status !== 'ACTIVE') return { jobsUpdated: 0 };
    let jobsUpdated = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const slot of plan.slots) {
        const result = await syncVisitPlanSlotCarersToScheduledJobs(tx, {
          visitPlanSlotId: slot.id,
          assignedEmployeeIds: visitPlanCarerEmployeeIds(
            [],
            resolveGlobalAssignedEmployeeIds(slot.assignedEmployeeIds, slot.carerAssignments),
            slot.requiredCarers,
          ),
          carerAssignments: mapDbCarerAssignmentsForSync(slot.carerAssignments ?? []),
          requiredCarers: slot.requiredCarers,
          userId,
          fromDateTime: visitPlanCarerSyncFromDateTime(undefined, timeZone),
          timeZone,
          respectWorkingPattern: plan.respectWorkingPatternOnSync !== false,
        });
        jobsUpdated += result.jobsUpdated;
      }
    });
    return { jobsUpdated };
  }

  /**
   * Cancel the visits `planHoursDecrease` picks, through the normal "Cancel visits" path (no
   * charge, cancelled by "other" with the hours change as the note). Returns how many were cancelled.
   */
  async applyHoursDecrease(
    userId: string,
    serviceUserId: string,
    newHours: number,
    meta?: RequestAuditMeta,
  ): Promise<{ cancelled: number }> {
    const plan = await this.planHoursDecrease(serviceUserId, newHours);
    if (!plan.planId || !plan.toCancel.length) return { cancelled: 0 };
    const note = `Weekly contracted hours reduced to ${newHours}h`;
    await this.cancelVisits(
      { id: userId } as RequestUser,
      serviceUserId,
      plan.planId,
      {
        items: plan.toCancel.map((v) => ({ visitPlanSlotId: v.visitPlanSlotId, date: v.date })),
        cancelledBy: 'OTHER',
        cancelledByDescription: note,
        // "Cancelled by: other" only takes the reason "other"; the note says why.
        reasonCode: 'OTHER',
        reasonNotes: note,
        chargeDecision: VisitChargeDecision.NO_CHARGE,
        chargeDecisionNotes: `${note} — the visit is no longer part of the package.`,
        welfareChecked: false,
        familyNotified: false,
        commissionerNotified: false,
      },
      meta,
    );
    return { cancelled: plan.toCancel.length };
  }

  /**
   * Edit one extra visit before it starts: time, duration, carers, night type and reason.
   * The date and time slot stay the same; the list row and its rota visit are updated together.
   */
  async editExtraVisit(
    user: RequestUser,
    serviceUserId: string,
    planId: string,
    exceptionId: string,
    dto: VisitPlanEditExtraVisitDto,
    meta?: RequestAuditMeta,
  ) {
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Give a reason for the extra visit');
    const { plan, host, exception, date, job, visit } = await this.loadEditableExtraVisit(
      serviceUserId,
      planId,
      exceptionId,
      'edited',
    );

    const roundCode = host.medicationRoundCode ?? normalizeVisitPlanSlotCode(host.slotCode).replace(/__X\d*$/, '');
    const result = await this.checkExtraDates(
      plan,
      {
        roundCode,
        dates: [date],
        startTime: dto.startTime,
        durationMinutes: dto.durationMinutes,
        requiredCarers: dto.requiredCarers,
        employeeIds: dto.employeeIds,
      },
      { excludeJobId: job.id },
    );
    if (!result.slotLabel) throw new BadRequestException(result.slotMessage ?? 'No time slot covers this time');
    const check = result.checks[0];
    if (!check?.ok) throw new BadRequestException(check?.message ?? 'This change cannot be saved');

    const { timeZone, employeeIds } = result;
    const endHm = addMinutesToHm(dto.startTime, dto.durationMinutes);
    const nightDuty = dto.nightDuty ?? VisitPlanNightDuty.NONE;
    if (
      nightDuty !== VisitPlanNightDuty.NONE &&
      !isNightTimeSlotCode(roundCode) &&
      !slotTimesCrossMidnight(dto.startTime, endHm)
    ) {
      throw new BadRequestException(
        'Waking or sleeping night is only for a visit in the Night time slot or one that runs past midnight',
      );
    }
    const start = combineOperationalDateAndHm(date, dto.startTime, timeZone);
    const end = wallClockVisitEnd(date, dto.startTime, endHm, timeZone);
    const actualMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
    const isOvernight = operationalTodayIso(end, timeZone) !== date && formatHmInZone(end, timeZone) !== '00:00';
    const scheduledDueTimes = await loadScheduledMedicationDueTimes(this.prisma, serviceUserId);
    // Carers over their contracted weekly hours with the edited visit (their current place on
    // it is left out of the count).
    // Only carers the edit gives more time to (new on the visit, or a longer visit) are checked:
    // a carer already on it — e.g. approved over their hours — keeps their place otherwise.
    const editMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
    const carerCheck = await this.carerHoursForExtras(
      carersGivenMoreTime(employeeIds, job.allocations, editMinutes),
      [{ date, start, end }],
      serviceUserId,
      job.allocations.map((a) => a.id),
    );
    const waiting = new Set(
      carerCheck.behavior === 'MANAGER_APPROVAL'
        ? employeeIds.filter((id) => carerCheck.over.has(`${date}|${id}`))
        : [],
    );
    const onVisit = employeeIds.filter((id) => !waiting.has(id));
    const fullyAllocated = onVisit.length >= dto.requiredCarers;

    const before = {
      startTime: exception.plannedStartTime,
      endTime: exception.plannedEndTime,
      durationMinutes: exception.durationMinutes,
      requiredCarers: exception.requiredCarers,
      employeeIds: job.allocations.map((a) => a.employeeId),
      notes: exception.notes,
    };
    const keptByEmployee = new Map(job.allocations.map((a) => [a.employeeId, a]));
    // Carers waiting for a manager come off the visit until approved.
    const removed = job.allocations.filter((a) => !onVisit.includes(a.employeeId));
    const added = onVisit.filter((id) => !keptByEmployee.has(id));
    const timeChanged =
      job.scheduledStartDateTime.getTime() !== start.getTime() ||
      (job.scheduledEndDateTime?.getTime() ?? 0) !== end.getTime();

    const hoursBefore = await this.weeklyHours.count(this.prisma, plan.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.visitPlanSlotException.update({
        where: { id: exceptionId },
        data: {
          plannedStartTime: dto.startTime,
          plannedEndTime: endHm,
          durationMinutes: dto.durationMinutes,
          requiredCarers: dto.requiredCarers,
          notes: reason,
          assignedEmployeeIds: employeeIds,
        },
      });
      // A longer extra visit may not take its week over the service user's weekly contracted hours.
      if (hoursBefore) {
        await this.weeklyHours.assertWithinLimit(
          tx,
          serviceUserId,
          plan.id,
          hoursBefore,
          plan.weeklyContractedHours,
          'EXTRA_EDIT',
        );
      }
      const oldMetadata =
        job.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)
          ? (job.metadata as Record<string, unknown>)
          : {};
      await tx.scheduledJob.update({
        where: { id: job.id },
        data: {
          scheduledStartDateTime: start,
          scheduledEndDateTime: end,
          estimatedDurationMinutes: actualMinutes,
          requiredCarers: dto.requiredCarers,
          status: fullyAllocated ? ScheduledJobStatus.ALLOCATED : ScheduledJobStatus.NEEDS_ATTENTION,
          notes: reason,
          metadata: { ...oldMetadata, isOvernight, nightDuty } as Prisma.InputJsonValue,
          updatedById: user.id,
        },
      });
      if (visit) {
        await tx.scheduledVisit.update({
          where: { id: visit.id },
          data: {
            scheduledStartDateTime: start,
            scheduledEndDateTime: end,
            requiredCarers: dto.requiredCarers,
            status: fullyAllocated ? ScheduledVisitStatus.PLANNED : ScheduledVisitStatus.NEEDS_ATTENTION,
            medicationRequired: resolveMedicationRequiredForSlot({
              plannedStartTime: dto.startTime,
              plannedEndTime: endHm,
              scheduledDueTimes,
            }),
          },
        });
      }
      for (const a of removed) {
        await tx.jobAllocation.update({
          where: { id: a.id },
          data: {
            status: AllocationStatus.UNALLOCATED,
            isActive: false,
            isLeadCarer: false,
            unallocatedAt: new Date(),
            unallocatedById: user.id,
            unallocationReason: 'Removed when the extra visit was edited',
          },
        });
      }
      for (const [index, employeeId] of onVisit.entries()) {
        const kept = keptByEmployee.get(employeeId);
        const times = { scheduledStartDateTime: start, scheduledEndDateTime: end, durationMinutes: actualMinutes };
        // Over the weekly hours with "request confirmation": on the visit, to be confirmed.
        const overMessage = carerCheck.over.get(`${date}|${employeeId}`);
        const confirm = overMessage
          ? {
              status: AllocationStatus.PENDING_CONFIRMATION,
              requiresConfirmation: true,
              warningTypes: ['CAPACITY_EXCEEDED'],
              warningMessages: [`Carer ${overMessage}`],
            }
          : null;
        if (kept) {
          await tx.jobAllocation.update({
            where: { id: kept.id },
            data: { ...times, isLeadCarer: index === 0, ...(confirm ?? {}) },
          });
        } else {
          await tx.jobAllocation.create({
            data: {
              scheduledJobId: job.id,
              scheduledVisitId: visit?.id ?? null,
              employeeId,
              status: AllocationStatus.CONFIRMED,
              requiresConfirmation: false,
              allocatedById: user.id,
              ...times,
              isLeadCarer: index === 0,
              ...(confirm ?? {}),
            },
          });
        }
      }
    });

    const label = result.slotLabel;
    for (const employeeId of waiting) {
      const weekStart = await this.carerHours.weekStartOf(start);
      const count = await this.carerHours.count(this.prisma, employeeId, { weekStarts: [weekStart] });
      await this.carerHours.requestRotaVisitApproval(this.prisma, {
        employeeId,
        scheduledJobId: job.id,
        serviceUserId,
        requestedById: user.id,
        start,
        end,
        weekStart,
        weekMinutes: (count.weeks[0]?.minutes ?? 0) + actualMinutes,
        limitMinutes: count.limitMinutes ?? 0,
        source: 'EXTRA_VISIT',
        allocation: { scheduledVisitId: visit?.id, isLeadCarer: false },
      });
    }
    const after = { startTime: dto.startTime, endTime: endHm, durationMinutes: dto.durationMinutes, requiredCarers: dto.requiredCarers, employeeIds, notes: reason };
    const change = { type: 'EDIT_EXTRA_VISIT', exceptionId, date, timeSlot: roundCode, before, after };
    await this.prisma.visitPlanAmendment.create({
      data: {
        visitPlanId: planId,
        reason: `Edited extra visit on ${date} (${label} ${dto.startTime}–${endHm}) — ${reason}`,
        snapshotBefore: { dateChange: { ...change, after: undefined } } as Prisma.InputJsonValue,
        snapshotAfter: { dateChange: { ...change, before: undefined } } as Prisma.InputJsonValue,
        amendedById: user.id,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_VISIT_PLAN_UPDATED,
      recordType: 'ServiceUserVisitPlan',
      recordId: planId,
      oldValues: auditSnapshot({ dateChange: { ...change, after: undefined } }),
      newValues: auditSnapshot({ dateChange: { ...change, before: undefined } }),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    // Tell carers: new ones get the usual "new visit" push, removed ones are told, kept ones hear about a time change.
    if (this.carerPush) {
      try {
        if (added.length) await this.notifyCarersOfExtraVisits([job.id], serviceUserId, timeZone, added);
        if (removed.length) {
          this.carerPush.notify({
            employeeIds: removed.map((a) => a.employeeId),
            kind: CarerVisitPushKind.VISIT_REMOVED,
            title: 'Removed from visit',
            body: `You have been taken off "${job.jobName}".`,
            scheduledJobId: job.id,
            serviceUserId,
          });
        }
        const keptIds = employeeIds.filter((id) => keptByEmployee.has(id));
        if (timeChanged && keptIds.length) {
          this.carerPush.notify({
            employeeIds: keptIds,
            kind: CarerVisitPushKind.VISIT_CHANGE,
            title: 'Visit updated',
            body: `Time changed for "${job.jobName}".`,
            scheduledJobId: job.id,
            serviceUserId,
          });
        }
      } catch (err) {
        this.logger.warn(`Extra visit edit push failed for service user ${serviceUserId}: ${(err as Error).message}`);
      }
    }

    return {
      message: waiting.size
        ? `Extra visit updated. ${waiting.size} carer${waiting.size === 1 ? ' is' : 's are'} over their weekly hours — sent to a manager, on the visit once approved`
        : 'Extra visit updated',
      data: { id: exceptionId, date, startTime: dto.startTime, endTime: endHm },
    };
  }

  /** An extra visit with its rota job, only while that visit has not started. */
  private async loadEditableExtraVisit(serviceUserId: string, planId: string, exceptionId: string, verb: 'edited' | 'deleted') {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    if (plan.status !== VisitPlanStatus.ACTIVE) {
      throw new BadRequestException(`Extra visits can only be ${verb} on an active visit plan`);
    }
    const host = plan.slots.find((s) =>
      s.exceptions.some((ex) => ex.id === exceptionId && ex.exceptionType === VisitPlanSlotExceptionType.EXTRA),
    );
    const exception = host?.exceptions.find((ex) => ex.id === exceptionId);
    if (!host || !exception) throw new NotFoundException('Extra visit not found');
    const date = exception.exceptionDate.toISOString().slice(0, 10);

    const job = await this.prisma.scheduledJob.findFirst({
      where: {
        serviceUserId,
        deletedAt: null,
        isActive: true,
        metadata: { path: ['visitPlanExceptionId'], equals: exceptionId },
      },
      include: {
        visits: { where: { deletedAt: null }, take: 1 },
        allocations: { where: { deletedAt: null, isActive: true, status: { in: ACTIVE_ALLOCATION_ENUMS } } },
      },
    });
    if (!job) throw new BadRequestException(`This extra visit is no longer on the rota, so it cannot be ${verb}`);
    const visit = job.visits[0] ?? null;
    const notStarted =
      EDITABLE_EXTRA_JOB_STATUSES.includes(job.status) &&
      (!visit ||
        ((visit.status === ScheduledVisitStatus.PLANNED || visit.status === ScheduledVisitStatus.NEEDS_ATTENTION) &&
          !visit.actualStartDateTime)) &&
      !job.allocations.some((a) => a.actualStartDateTime);
    if (!notStarted) throw new BadRequestException(`This visit has started or ended, so it can no longer be ${verb}`);
    return { plan, host, exception, date, job, visit };
  }

  /**
   * Delete one extra visit before it starts. The rota visit is soft-deleted and its carers are
   * taken off; the list row goes. What was removed, and why, stays in the plan amendments and audit log.
   */
  async deleteExtraVisit(
    user: RequestUser,
    serviceUserId: string,
    planId: string,
    exceptionId: string,
    dto: VisitPlanDeleteExtraVisitDto,
    meta?: RequestAuditMeta,
  ) {
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Give a reason for deleting the extra visit');
    const { host, exception, date, job, visit } = await this.loadEditableExtraVisit(
      serviceUserId,
      planId,
      exceptionId,
      'deleted',
    );
    const now = new Date();
    const carerIds = job.allocations.map((a) => a.employeeId);

    await this.prisma.$transaction(async (tx) => {
      for (const a of job.allocations) {
        await tx.jobAllocation.update({
          where: { id: a.id },
          data: {
            status: AllocationStatus.UNALLOCATED,
            isActive: false,
            isLeadCarer: false,
            unallocatedAt: now,
            unallocatedById: user.id,
            unallocationReason: 'Extra visit deleted',
          },
        });
      }
      if (visit) {
        await tx.scheduledVisit.update({
          where: { id: visit.id },
          data: { deletedAt: now, deletedById: user.id, isActive: false },
        });
      }
      await tx.scheduledJob.update({
        where: { id: job.id },
        data: { deletedAt: now, deletedById: user.id, isActive: false },
      });
      await tx.visitPlanSlotException.delete({ where: { id: exceptionId } });
    });

    const roundCode = host.medicationRoundCode ?? normalizeVisitPlanSlotCode(host.slotCode).replace(/__X\d*$/, '');
    const removedVisit = {
      exceptionId,
      date,
      timeSlot: roundCode,
      startTime: exception.plannedStartTime,
      endTime: exception.plannedEndTime,
      durationMinutes: exception.durationMinutes,
      requiredCarers: exception.requiredCarers,
      employeeIds: carerIds,
      notes: exception.notes,
      scheduledJobId: job.id,
    };
    const change = { type: 'DELETE_EXTRA_VISIT', reason, removedVisit };
    await this.prisma.visitPlanAmendment.create({
      data: {
        visitPlanId: planId,
        reason: `Deleted extra visit on ${date} (${exception.plannedStartTime ?? ''}–${exception.plannedEndTime ?? ''}) — ${reason}`,
        snapshotBefore: { dateChange: { type: 'DELETE_EXTRA_VISIT', removedVisit } } as Prisma.InputJsonValue,
        snapshotAfter: { dateChange: change } as Prisma.InputJsonValue,
        amendedById: user.id,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_VISIT_PLAN_UPDATED,
      recordType: 'ServiceUserVisitPlan',
      recordId: planId,
      oldValues: auditSnapshot({ dateChange: { type: 'DELETE_EXTRA_VISIT', removedVisit } }),
      newValues: auditSnapshot({ dateChange: change }),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    if (this.carerPush && carerIds.length) {
      try {
        this.carerPush.notify({
          employeeIds: carerIds,
          kind: CarerVisitPushKind.VISIT_REMOVED,
          title: 'Visit removed',
          body: `"${job.jobName}" has been removed from your rota.`,
          scheduledJobId: job.id,
          serviceUserId,
        });
      } catch (err) {
        this.logger.warn(`Extra visit delete push failed for service user ${serviceUserId}: ${(err as Error).message}`);
      }
    }

    return { message: 'Extra visit deleted', data: { id: exceptionId, date } };
  }

  /** Same "new visit" push the carers get when the rota is generated. */
  private async notifyCarersOfExtraVisits(
    jobIds: string[],
    serviceUserId: string,
    timeZone: string,
    /** Only these carers (e.g. the ones just added when editing); all carers on the jobs when left out. */
    onlyEmployeeIds?: string[],
  ) {
    if (!this.carerPush || !jobIds.length) return;
    try {
      const allocations = await this.prisma.jobAllocation.findMany({
        where: {
          scheduledJobId: { in: jobIds },
          deletedAt: null,
          isActive: true,
          ...(onlyEmployeeIds ? { employeeId: { in: onlyEmployeeIds } } : {}),
        },
        select: {
          employeeId: true,
          scheduledJobId: true,
          scheduledStartDateTime: true,
          scheduledEndDateTime: true,
          scheduledJob: {
            select: { jobName: true, serviceUserId: true, scheduledStartDateTime: true, scheduledEndDateTime: true },
          },
        },
      });
      const pushes = groupRotaGeneratedCarerPushes(
        allocations.map((row) => ({
          employeeId: row.employeeId,
          scheduledJobId: row.scheduledJobId,
          jobName: row.scheduledJob.jobName,
          serviceUserId: row.scheduledJob.serviceUserId || serviceUserId,
          scheduledStartDateTime: row.scheduledStartDateTime ?? row.scheduledJob.scheduledStartDateTime,
          scheduledEndDateTime: row.scheduledEndDateTime ?? row.scheduledJob.scheduledEndDateTime,
        })),
        timeZone,
      );
      for (const push of pushes) {
        this.carerPush.notify({
          employeeIds: [push.employeeId],
          kind: CarerVisitPushKind.VISIT_ASSIGN,
          title: push.title,
          body: push.body,
          scheduledJobId: push.scheduledJobId,
          serviceUserId: push.serviceUserId,
        });
      }
    } catch (err) {
      this.logger.warn(`Extra visit carer push failed for service user ${serviceUserId}: ${(err as Error).message}`);
    }
  }
}
