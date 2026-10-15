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
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  VisitChargeDecision,
  VisitPlanNightDuty,
  VisitPlanSlotExceptionType,
  VisitPlanStatus,
} from '@prisma/client';
import { CarerVisitPushHook } from '../notifications/carer-visit-push.hook';
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
import { normalizeVisitPlanSlotCode, slotLabel } from './visit-plan-slot-defaults';
import { clampRotaHorizonDays } from './visit-plan-rolling-rota.util';
import { wallClockVisitEnd } from './visit-plan-slot-window.util';
import { slotTimesCrossMidnight, visitPlanGeneratedJobMetadata } from './visit-plan-night-duty.util';
import { loadScheduledMedicationDueTimes, resolveMedicationRequiredForSlot } from './visit-medication-required.util';
import { groupRotaGeneratedCarerPushes } from './visit-plan-rota-carer-push.util';
import { VISIT_PLAN_EXTRA_JOB_METADATA_KEY } from './visit-plan-extra-visit.util';
import type {
  VisitPlanAddExtraVisitsDto,
  VisitPlanCancelVisitsDto,
  VisitPlanCancelVisitsPreviewDto,
  VisitPlanDateChangeItemDto,
  VisitPlanDateChangesRangeQueryDto,
  VisitPlanExtraVisitsPreviewDto,
} from './dto/visit-plan-date-changes.dto';

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

export type ExtraVisitDateCheck = {
  date: string;
  ok: boolean;
  message: string | null;
  /** Carers who already have a visit at that time on this date. */
  clashEmployeeIds: string[];
};

@Injectable()
export class VisitPlanDateChangesService {
  private readonly logger = new Logger(VisitPlanDateChangesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
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
    const userIds = [...new Set(rows.map((r) => r.ex.createdById).filter((id): id is string => Boolean(id)))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const userName = new Map(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]),
    );

    const changes = rows
      .map(({ slot, ex }) => {
        const isCancel = ex.exceptionType === VisitPlanSlotExceptionType.SKIP;
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
          assignedEmployeeIds: ex.assignedEmployeeIds ?? [],
          source: ex.notes.startsWith(ABSENCE_NOTE_MARKER) ? ('ABSENCE' as const) : ('MANUAL' as const),
          recordedByName: ex.createdById ? (userName.get(ex.createdById) ?? null) : null,
          recordedAt: ex.createdAt.toISOString(),
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date) || a.plannedStartTime.localeCompare(b.plannedStartTime));

    return { data: { planStatus: plan.status, changes } };
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
  private async checkExtraDates(plan: DatePlanRow, dto: VisitPlanExtraVisitsPreviewDto) {
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
    const result = await this.checkExtraDates(plan, dto);
    return {
      data: {
        slotLabel: result.slotLabel,
        slotMessage: result.slotMessage,
        endTime: addMinutesToHm(dto.startTime, dto.durationMinutes),
        dates: result.checks,
      },
    };
  }

  async addExtraVisits(
    user: RequestUser,
    serviceUserId: string,
    planId: string,
    dto: VisitPlanAddExtraVisitsDto,
    meta?: RequestAuditMeta,
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
    // Waking / sleeping night only applies to a visit that runs past midnight; otherwise a normal visit.
    const runsPastMidnight = slotTimesCrossMidnight(dto.startTime, endHm);
    const nightDuty = dto.nightDuty ?? VisitPlanNightDuty.NONE;
    if (nightDuty !== VisitPlanNightDuty.NONE && !runsPastMidnight) {
      throw new BadRequestException('Waking or sleeping night is only for a visit that runs past midnight');
    }
    const visitName = `${label} (extra)`;
    const notes = [reason, dto.notes?.trim()].filter(Boolean).join('\n\n');

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

    const createdJobIds: string[] = [];
    for (const check of valid) {
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

        const allocated = employeeIds.length;
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

        for (const [index, employeeId] of employeeIds.entries()) {
          await tx.jobAllocation.create({
            data: {
              scheduledJobId: job.id,
              scheduledVisitId: visit.id,
              employeeId,
              status: AllocationStatus.CONFIRMED,
              requiresConfirmation: false,
              allocatedById: user.id,
              scheduledStartDateTime: start,
              scheduledEndDateTime: end,
              durationMinutes: actualMinutes,
              isLeadCarer: index === 0,
            },
          });
        }
        return job.id;
      });
      createdJobIds.push(jobId);
    }

    const change = {
      type: 'ADD_EXTRA_VISITS',
      timeSlot: round.code,
      startTime: dto.startTime,
      durationMinutes: dto.durationMinutes,
      requiredCarers: dto.requiredCarers,
      employeeIds,
      dates: valid.map((c) => c.date),
    };
    await this.prisma.visitPlanAmendment.create({
      data: {
        visitPlanId: planId,
        reason: `Added ${valid.length} extra visit${valid.length === 1 ? '' : 's'} (${label} ${dto.startTime}–${endHm}) — ${reason}`,
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

    const skipped = result.checks.filter((c) => !c.ok);
    return {
      message: `${valid.length} extra visit${valid.length === 1 ? '' : 's'} added`,
      data: {
        created: valid.length,
        skipped: skipped.map((c) => ({ date: c.date, message: c.message })),
      },
    };
  }

  /** Same "new visit" push the carers get when the rota is generated. */
  private async notifyCarersOfExtraVisits(jobIds: string[], serviceUserId: string, timeZone: string) {
    if (!this.carerPush || !jobIds.length) return;
    try {
      const allocations = await this.prisma.jobAllocation.findMany({
        where: { scheduledJobId: { in: jobIds }, deletedAt: null, isActive: true },
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
