import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  AllocationStatus,
  CarerVisitPushKind,
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  VisitPlanSlotKind,
  VisitPlanStatus,
  VisitPlanStatusEventType,
} from '@prisma/client';
import { CarerVisitPushHook } from '../notifications/carer-visit-push.hook';
import { groupRotaGeneratedCarerPushes } from './visit-plan-rota-carer-push.util';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { resolveApprovedWeeklyHoursThreshold } from '../common/utils/approved-weekly-hours.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { isPreferredVisitTimesFieldKey } from '../initial-assessments/initial-assessment-preferred-visit-times.util';
import { assertWeeklyContractedHoursForCreate } from './visit-plan-contracted-hours.util';
import { CreateVisitPlanDto } from './dto/create-visit-plan.dto';
import { UpdateVisitPlanDto } from './dto/update-visit-plan.dto';
import { GenerateVisitPlanScheduleDto } from './dto/generate-visit-plan-schedule.dto';
import { VisitPlanSlotDto } from './dto/visit-plan-slot.dto';
import {
  defaultVisitPlanSlotsFromRounds,
  normalizeVisitPlanSlotCode,
  slotLabel,
  type MedicationRoundCatalogRow,
} from './visit-plan-slot-defaults';
import { mergeSlotSchedulingOptions } from './visit-plan-slot-options.defaults';
import { buildSlotsFromPreferredVisitTimes } from './visit-plan-from-assessment.util';
import { SuggestVisitPlanCarersDto } from './dto/suggest-visit-plan-carers.dto';
import { VisitPlanCalendarVisitsQueryDto } from './dto/visit-plan-calendar-visits-query.dto';
import { RecordVisitPlanCalendarOutcomeDto } from './dto/record-visit-plan-calendar-outcome.dto';
import { SuspendVisitPlanDto } from './dto/suspend-visit-plan.dto';
import { VisitPlanStatusChangeDto } from './dto/visit-plan-status.dto';
import { VisitPlanScheduleImpactPreviewQueryDto } from './dto/visit-plan-schedule-impact-preview-query.dto';
import { defaultSuspensionReviewDueAt, parseVisitPlanDateOnly } from './visit-plan-pause.util';
import {
  assertRetrospectiveReasonWhenBackdated,
  isCalendarDateAfter,
  parseOptionalVisitPlanDateOnly,
  visitPlanTodayUtc,
} from './visit-plan-effective-dates.util';
import {
  loadScheduledMedicationDueTimes,
  resolveMedicationRequiredForSlot,
} from './visit-medication-required.util';
import { ScheduledJobsService } from '../scheduled-jobs/scheduled-jobs.service';
import { VisitReconciliationsService } from '../billing/visit-reconciliations.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { AllocationComplianceService } from '../employee-compliance/allocation-compliance.service';
import {
  EMPTY_COMPLIANCE_ALLOCATION_RESULT,
  formatComplianceAllocationMessages,
} from '../employee-compliance/allocation-compliance.util';
import {
  addDaysToOperationalIso,
  combineOperationalDateAndHm,
  dayKeyInTimeZone,
  operationalDayBounds,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import { weekdayIndexInTimeZone } from '../scheduling/schedule-date-range.util';
import { ScheduleLifecycleImpactService } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.service';
import type { ScheduleImpactResult } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.util';
import {
  carerFitScore,
  evaluateCarerAvailability,
  matchEmployeeSkills,
  requiredSkillKeywords,
  scheduledJobOverlapsVisitPlanSlot,
  visitPlanPatternRotaLookaheadEnd,
  visitPlanSuggestJobWindow,
  resolveServiceUserLocationIds,
  buildEmployeeEmploymentLocationWhere,
} from './visit-plan-carer-suggest.util';
import { buildVisitPlanOccurrence } from './visit-plan-generate-occurrence.util';
import { activeServiceUserAbsenceWhere, calendarDayUtcNoon } from '../service-user-absences/active-absence.util';
import { computeGenerationStart, maxAllowedBackfillDays } from './visit-plan-slot-carer-resolve.util';
import { CARER_ROTA_CONFLICT_MESSAGE } from './visit-carer-rota-conflict.util';
import {
  syncVisitPlanSlotCarersToScheduledJobs,
  visitPlanCarerEmployeeIds,
  visitPlanCarerSyncFromDateTime,
  loadEmployeePatternContexts,
  resolveVisitCarerAssignment,
  countVisitsSkippedIfRespecting,
  mapDbCarerAssignmentsForSync,
} from './visit-plan-slot-carer-sync.util';
import { collectCarerPatternConflicts, employmentToPatternContext, type EmployeePatternContext, type SlotCarerPatternInput } from './visit-plan-carer-job-fit.util';
import { VisitPlanCarerSyncPatternPreviewDto } from './dto/visit-plan-carer-sync-pattern-preview.dto';
import { clearVisitPlansAndRota } from './clear-visit-plans-and-rota.util';
import {
  resolveGlobalAssignedEmployeeIds,
  slotAssignedEmployeeIds,
} from './visit-plan-readiness.util';
import { deriveDurationFromTimes } from './visit-plan-slot-window.util';
import type { SuDraftOverLimit, SuPlanOverLimit } from '../organisation-general-settings/service-user-weekly-hours-settings.util';
import { EmployeeHoursApprovalsService } from '../employee-hours-approvals/employee-hours-approvals.service';
import {
  currentServiceUserWeeklyHours,
  sameWeeklyHours,
  SERVICE_USER_HOURS_NEED_APPROVAL_MESSAGE,
  syncServiceUserWeeklyHours,
} from '../service-user-dom-care/service-user-weekly-hours-sync.util';
import type { VisitPlanWeeklyHoursSummary } from './visit-plan-weekly-hours.util';
import { VisitPlanWeeklyHoursService } from './visit-plan-weekly-hours.service';
import type { VisitPlanSlotCarerAssignmentDto, VisitPlanSlotExceptionDto } from './dto/visit-plan-slot-enterprise.dto';
import type { NormalizedVisitPlanSlot } from './visit-plan-normalized-slot.types';
import { VisitPlanAmendmentImpactService } from './visit-plan-amendment-impact.service';
import type { VisitPlanSnapshotShape } from './visit-plan-amendment-impact.util';
import {
  previewGenerateScheduleFromPlan,
  slotAsWithRelations,
} from './visit-plan-generate-preview.util';
import {
  resolveStoredNightDuty,
  resolveVisitPlanNightDuty,
  visitPlanGeneratedJobMetadata,
} from './visit-plan-night-duty.util';
import { syncVisitPlanSlotNightDutyToScheduledJobs } from './visit-plan-night-duty-sync.util';
import type { ActivateVisitPlanDto } from './dto/suspend-visit-plan.dto';
import type {
  VisitPlanReturnImpactPreviewQueryDto,
  VisitPlanSkipImpactPreviewQueryDto,
} from './dto/visit-plan-impact-preview.dto';

const planInclude = {
  slots: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      carerAssignments: { orderBy: [{ sortOrder: 'asc' as const }, { role: 'asc' as const }] },
      exceptions: { orderBy: { exceptionDate: 'asc' as const } },
    },
  },
  amendments: { orderBy: { amendedAt: 'desc' as const }, take: 20 },
  pauseReasonCatalog: { select: { id: true, name: true, code: true, suggestsUseAbsence: true } },
  statusEvents: {
    orderBy: { createdAt: 'desc' as const },
    take: 30,
    include: { pauseReasonCatalog: { select: { id: true, name: true, code: true } } },
  },
} satisfies Prisma.ServiceUserVisitPlanInclude;

const CALENDAR_VISIT_ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const calendarVisitInclude = {
  scheduledJob: {
    select: {
      status: true,
      requiredCarers: true,
      metadata: true,
      allocations: {
        where: { deletedAt: null, isActive: true },
        select: { employeeId: true, status: true },
      },
    },
  },
  visitPlanSlot: {
    select: {
      slotCode: true,
      linkedCarePlanFormIds: true,
      nightDuty: true,
    },
  },
} satisfies Prisma.ScheduledVisitInclude;

/** Fields only set from "Changes for specific dates" — blank on simulated rows. */
const EMPTY_DATE_CHANGE_FIELDS = {
  cancelledByParty: null,
  cancelledByDescription: null,
  reasonCode: null,
  chargeDecision: null,
  chargeDecisionNotes: null,
  assignedEmployeeIds: [] as string[],
  createdById: null,
};

type CalendarVisitRow = Prisma.ScheduledVisitGetPayload<{ include: typeof calendarVisitInclude }>;

type PlanRow = Prisma.ServiceUserVisitPlanGetPayload<{ include: typeof planInclude }>;

/** Thrown to roll back the weekly-hours preview transaction (nothing is saved). */
class WeeklyHoursPreviewRollback extends Error {}

@Injectable()
export class ServiceUserVisitPlansService {
  private readonly logger = new Logger(ServiceUserVisitPlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly scheduledJobsService: ScheduledJobsService,
    private readonly scheduleImpact: ScheduleLifecycleImpactService,
    private readonly amendmentImpact: VisitPlanAmendmentImpactService,
    private readonly visitReconciliationsService: VisitReconciliationsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly weeklyHours: VisitPlanWeeklyHoursService,
    private readonly allocationCompliance: AllocationComplianceService,
    private readonly hoursApprovals: EmployeeHoursApprovalsService,
    @Optional() private readonly carerPush?: CarerVisitPushHook,
  ) {}

  private async ensureServiceUser(serviceUserId: string) {
    const row = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Service user not found');
    return row;
  }

  private async getPlanOrThrow(serviceUserId: string, planId: string): Promise<PlanRow> {
    const row = await this.prisma.serviceUserVisitPlan.findFirst({
      where: { id: planId, serviceUserId, deletedAt: null, isActive: true },
      include: planInclude,
    });
    if (!row) throw new NotFoundException('Visit plan not found');
    return row;
  }

  private async loadMedicationRoundCatalog(): Promise<MedicationRoundCatalogRow[]> {
    const rows = await this.prisma.medicationAdministrationRound.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    if (rows.length === 0) {
      return defaultVisitPlanSlotsFromRounds().map((s) => ({
        code: s.slotCode,
        name: s.slotCode,
        time: s.plannedStartTime,
        windowStart: s.plannedStartTime,
        windowEnd: s.plannedEndTime,
        sortOrder: s.sortOrder,
      }));
    }
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      time: r.time,
      windowStart: r.windowStart,
      windowEnd: r.windowEnd,
      sortOrder: r.sortOrder,
    }));
  }

  private async loadRoundNameMap(): Promise<Map<string, string>> {
    const rounds = await this.loadMedicationRoundCatalog();
    return new Map(rounds.map((r) => [r.code, r.name]));
  }

  private mapPlan(row: PlanRow, roundNameByCode?: Map<string, string>) {
    return {
      id: row.id,
      serviceUserId: row.serviceUserId,
      status: row.status,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveTo: row.effectiveTo?.toISOString() ?? null,
      weeklyContractedHours: row.weeklyContractedHours,
      numberOfCarers: row.numberOfCarers,
      sourceSubmissionId: row.sourceSubmissionId,
      reviewDueAt: row.reviewDueAt?.toISOString() ?? null,
      notes: row.notes,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      approvedById: row.approvedById,
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
      suspendedById: row.suspendedById,
      pauseReasonCatalogId: row.pauseReasonCatalogId,
      pauseReasonCatalog: row.pauseReasonCatalog
        ? {
            id: row.pauseReasonCatalog.id,
            name: row.pauseReasonCatalog.name,
            code: row.pauseReasonCatalog.code,
            suggestsUseAbsence: row.pauseReasonCatalog.suggestsUseAbsence,
          }
        : null,
      expectedResumeAt: row.expectedResumeAt?.toISOString() ?? null,
      suspensionReviewDueAt: row.suspensionReviewDueAt?.toISOString() ?? null,
      suspensionContingencyNotes: row.suspensionContingencyNotes ?? '',
      respectWorkingPatternOnSync: row.respectWorkingPatternOnSync,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      slots: (row.slots ?? []).map((s) => ({
        id: s.id,
        slotCode: s.slotCode,
        label: slotLabel(s.medicationRoundCode ?? s.slotCode, roundNameByCode),
        daysOfWeek: s.daysOfWeek,
        plannedStartTime: s.plannedStartTime,
        plannedEndTime: s.plannedEndTime,
        requiredCarers: s.requiredCarers,
        isEnabled: s.isEnabled,
        medicationRoundCode: s.medicationRoundCode,
        notes: s.notes,
        sortOrder: s.sortOrder,
        scheduleFrequency: s.scheduleFrequency,
        repeatEvery: s.repeatEvery,
        repeatUnit: s.repeatUnit,
        timeCritical: s.timeCritical,
        timeToleranceMinutes: s.timeToleranceMinutes,
        durationMinutes: s.durationMinutes,
        notesRequired: s.notesRequired,
        photoAllowed: s.photoAllowed,
        shareOutcomeWithFamily: s.shareOutcomeWithFamily,
        analysisArea: s.analysisArea,
        monthlyDayMode: s.monthlyDayMode,
        monthlyDaysOfMonth: s.monthlyDaysOfMonth,
        monthlyPatternOrdinal: s.monthlyPatternOrdinal,
        monthlyPatternWeekday: s.monthlyPatternWeekday,
        linkedCarePlanFormIds: s.linkedCarePlanFormIds ?? [],
        assignedEmployeeIds: s.assignedEmployeeIds ?? [],
        slotKind: s.slotKind,
        nightDuty: s.nightDuty,
        slotEffectiveFrom: s.slotEffectiveFrom?.toISOString() ?? null,
        slotEffectiveTo: s.slotEffectiveTo?.toISOString() ?? null,
        oneOffDate: s.oneOffDate?.toISOString() ?? null,
        allowBackfillDays: s.allowBackfillDays,
        carerAssignments: (s.carerAssignments ?? []).map((a) => ({
          id: a.id,
          dayOfWeek: a.dayOfWeek,
          employeeId: a.employeeId,
          role: a.role,
          requiredCarers: a.requiredCarers,
          durationMinutes: a.durationMinutes,
          plannedStartTime: a.plannedStartTime,
          plannedEndTime: a.plannedEndTime,
          sortOrder: a.sortOrder,
        })),
        exceptions: (s.exceptions ?? []).map((ex) => ({
          id: ex.id,
          exceptionDate: ex.exceptionDate.toISOString().slice(0, 10),
          exceptionType: ex.exceptionType,
          plannedStartTime: ex.plannedStartTime,
          plannedEndTime: ex.plannedEndTime,
          durationMinutes: ex.durationMinutes,
          requiredCarers: ex.requiredCarers,
          notes: ex.notes,
        })),
      })),
      amendments: (row.amendments ?? []).map((a) => ({
        id: a.id,
        reason: a.reason,
        amendedAt: a.amendedAt.toISOString(),
        amendedById: a.amendedById,
      })),
      statusEvents: (row.statusEvents ?? []).map((e) => ({
        id: e.id,
        eventType: e.eventType,
        reason: e.reason,
        pauseReasonCatalogId: e.pauseReasonCatalogId,
        pauseReasonCatalog: e.pauseReasonCatalog
          ? { id: e.pauseReasonCatalog.id, name: e.pauseReasonCatalog.name, code: e.pauseReasonCatalog.code }
          : null,
        expectedResumeAt: e.expectedResumeAt?.toISOString() ?? null,
        reviewDueAt: e.reviewDueAt?.toISOString() ?? null,
        contingencyNotes: e.contingencyNotes,
        cancelFutureVisits: e.cancelFutureVisits,
        effectiveFrom: e.effectiveFrom?.toISOString() ?? null,
        effectiveTo: e.effectiveTo?.toISOString() ?? null,
        retrospectiveReason: e.retrospectiveReason ?? '',
        createdAt: e.createdAt.toISOString(),
        createdById: e.createdById,
      })),
    };
  }

  private snapshot(plan: PlanRow, roundNameByCode?: Map<string, string>) {
    return this.mapPlan(plan, roundNameByCode);
  }

  private normalizeSlots(slots: VisitPlanSlotDto[] | undefined, rounds: MedicationRoundCatalogRow[]): NormalizedVisitPlanSlot[] {
    const catalogue = defaultVisitPlanSlotsFromRounds(rounds);
    const enterpriseDefaults = (row: (typeof catalogue)[number]): NormalizedVisitPlanSlot => {
      const slotKind =
        row.plannedEndTime <= row.plannedStartTime ? VisitPlanSlotKind.OVERNIGHT : VisitPlanSlotKind.STANDARD;
      return {
        ...row,
        slotKind,
        nightDuty: resolveVisitPlanNightDuty({ ...row, slotKind }),
        slotEffectiveFrom: null,
        slotEffectiveTo: null,
        oneOffDate: null,
        allowBackfillDays: 0,
        carerAssignments: [],
        exceptions: [],
        durationMinutes: row.durationMinutes ?? deriveDurationFromTimes(row.plannedStartTime, row.plannedEndTime, slotKind),
      };
    };
    if (!slots?.length) return catalogue.map(enterpriseDefaults);

    const byCode = new Map(
      slots.map((s) => [normalizeVisitPlanSlotCode(s.slotCode), { ...s, slotCode: normalizeVisitPlanSlotCode(s.slotCode) }]),
    );
    const orderedCodes = [
      ...catalogue.map((c) => c.slotCode),
      ...[...byCode.keys()].filter((code) => !catalogue.some((c) => c.slotCode === code)),
    ];

    return orderedCodes.map((slotCode, index): NormalizedVisitPlanSlot => {
      const input = byCode.get(slotCode);
      // A time slot can hold several visits: further rows carry their own code and point at the
      // time slot through medicationRoundCode, so they take that slot's defaults and position.
      const linkedRound = input?.medicationRoundCode
        ? catalogue.find((d) => d.slotCode === normalizeVisitPlanSlotCode(input.medicationRoundCode!))
        : undefined;
      if (/__\d+$/.test(slotCode) && !linkedRound) {
        throw new BadRequestException('A visit must belong to an active time slot');
      }
      const defaults =
        catalogue.find((d) => d.slotCode === slotCode) ??
        (linkedRound
          ? { ...linkedRound, slotCode, medicationRoundCode: linkedRound.slotCode }
          : {
              ...catalogue[0]!,
              slotCode,
              medicationRoundCode: slotCode,
              sortOrder: index,
            });
      const plannedStart = input?.plannedStartTime ?? defaults.plannedStartTime;
      const plannedEnd = input?.plannedEndTime ?? defaults.plannedEndTime;
      const slotKind =
        input?.slotKind ??
        (plannedEnd <= plannedStart ? VisitPlanSlotKind.OVERNIGHT : VisitPlanSlotKind.STANDARD);
      const durationMinutes =
        input?.durationMinutes ??
        defaults.durationMinutes ??
        deriveDurationFromTimes(plannedStart, plannedEnd, slotKind);

      return {
        slotCode,
        daysOfWeek: input?.daysOfWeek?.length ? [...new Set(input.daysOfWeek)].sort() : defaults.daysOfWeek,
        plannedStartTime: plannedStart,
        plannedEndTime: plannedEnd,
        requiredCarers: input?.requiredCarers ?? defaults.requiredCarers,
        isEnabled: input?.isEnabled ?? defaults.isEnabled,
        medicationRoundCode: input?.medicationRoundCode ?? defaults.medicationRoundCode,
        notes: input?.notes?.trim() ?? '',
        sortOrder: defaults.sortOrder ?? index,
        linkedCarePlanFormIds: input?.linkedCarePlanFormIds ?? [],
        // Default carers = global rows only; day-specific advanced rows stay per-day (they
        // must not leak into the slot fallback used for days without a specific carer).
        assignedEmployeeIds: resolveGlobalAssignedEmployeeIds(
          input?.assignedEmployeeIds,
          input?.carerAssignments,
        ),
        slotKind: input?.slotKind ?? slotKind,
        nightDuty: resolveVisitPlanNightDuty({
          slotKind: input?.slotKind ?? slotKind,
          plannedStartTime: plannedStart,
          plannedEndTime: plannedEnd,
          slotCode,
          medicationRoundCode: input?.medicationRoundCode,
          nightDuty: input?.nightDuty,
        }),
        slotEffectiveFrom: input?.slotEffectiveFrom ?? null,
        slotEffectiveTo: input?.slotEffectiveTo ?? null,
        oneOffDate: input?.oneOffDate ?? null,
        allowBackfillDays: input?.allowBackfillDays ?? 0,
        carerAssignments: input?.carerAssignments ?? [],
        exceptions: input?.exceptions,
        ...mergeSlotSchedulingOptions(input ?? null),
        durationMinutes,
      };
    });
  }

  private slotPersistFields(slot: NormalizedVisitPlanSlot) {
    return {
      daysOfWeek: slot.daysOfWeek,
      plannedStartTime: slot.plannedStartTime,
      plannedEndTime: slot.plannedEndTime,
      requiredCarers: slot.requiredCarers,
      isEnabled: slot.isEnabled,
      medicationRoundCode: slot.medicationRoundCode,
      notes: slot.notes,
      scheduleFrequency: slot.scheduleFrequency,
      repeatEvery: slot.repeatEvery,
      repeatUnit: slot.repeatUnit,
      timeCritical: slot.timeCritical,
      timeToleranceMinutes: slot.timeToleranceMinutes,
      durationMinutes: slot.durationMinutes,
      notesRequired: slot.notesRequired,
      photoAllowed: slot.photoAllowed,
      shareOutcomeWithFamily: slot.shareOutcomeWithFamily,
      analysisArea: slot.analysisArea,
      monthlyDayMode: slot.monthlyDayMode,
      monthlyDaysOfMonth: slot.monthlyDaysOfMonth,
      monthlyPatternOrdinal: slot.monthlyPatternOrdinal,
      monthlyPatternWeekday: slot.monthlyPatternWeekday,
      linkedCarePlanFormIds: slot.linkedCarePlanFormIds ?? [],
      assignedEmployeeIds: slot.assignedEmployeeIds ?? [],
      slotKind: slot.slotKind ?? VisitPlanSlotKind.STANDARD,
      nightDuty: resolveVisitPlanNightDuty(slot),
      slotEffectiveFrom: slot.slotEffectiveFrom ? new Date(slot.slotEffectiveFrom) : null,
      slotEffectiveTo: slot.slotEffectiveTo ? new Date(slot.slotEffectiveTo) : null,
      oneOffDate: slot.oneOffDate ? new Date(slot.oneOffDate) : null,
      allowBackfillDays: slot.allowBackfillDays ?? 0,
    };
  }

  private async persistSlotRelations(
    tx: Prisma.TransactionClient,
    visitPlanSlotId: string,
    carerAssignments: VisitPlanSlotCarerAssignmentDto[],
    /** Omitted = leave the slot's date changes as they are (they are saved from their own dialogs). */
    exceptions?: VisitPlanSlotExceptionDto[],
  ) {
    await tx.visitPlanSlotCarerAssignment.deleteMany({ where: { visitPlanSlotId } });
    if (carerAssignments.length) {
      await tx.visitPlanSlotCarerAssignment.createMany({
        data: carerAssignments
          .filter((a) => Boolean(a.employeeId?.trim()))
          .map((a, index) => ({
            visitPlanSlotId,
            dayOfWeek: a.dayOfWeek ?? null,
            employeeId: a.employeeId.trim(),
            role: a.role ?? 'SECONDARY',
            requiredCarers: a.requiredCarers ?? null,
            durationMinutes: a.durationMinutes ?? null,
            plannedStartTime: a.plannedStartTime ?? null,
            plannedEndTime: a.plannedEndTime ?? null,
            sortOrder: a.sortOrder ?? index,
          })),
      });
    }

    if (exceptions === undefined) return;
    await tx.visitPlanSlotException.deleteMany({ where: { visitPlanSlotId } });
    if (exceptions.length) {
      await tx.visitPlanSlotException.createMany({
        data: exceptions.map((ex) => ({
          visitPlanSlotId,
          exceptionDate: new Date(ex.exceptionDate),
          exceptionType: ex.exceptionType,
          plannedStartTime: ex.plannedStartTime ?? null,
          plannedEndTime: ex.plannedEndTime ?? null,
          durationMinutes: ex.durationMinutes ?? null,
          requiredCarers: ex.requiredCarers ?? null,
          notes: ex.notes?.trim() ?? '',
        })),
      });
    }
  }

  private async upsertPlanSlot(tx: Prisma.TransactionClient, planId: string, slot: NormalizedVisitPlanSlot) {
    const fields = this.slotPersistFields(slot);
    const existing = await tx.visitPlanSlot.findFirst({
      where: { visitPlanId: planId, slotCode: slot.slotCode },
      select: { id: true },
    });

    let slotId: string;
    if (existing) {
      await tx.visitPlanSlot.update({ where: { id: existing.id }, data: fields });
      slotId = existing.id;
    } else {
      const created = await tx.visitPlanSlot.create({
        data: {
          visitPlanId: planId,
          slotCode: slot.slotCode,
          sortOrder: slot.sortOrder,
          ...fields,
        },
      });
      slotId = created.id;
    }

    await this.persistSlotRelations(
      tx,
      slotId,
      slot.carerAssignments ?? [],
      slot.exceptions,
    );
    return slotId;
  }

  async suggestCarers(serviceUserId: string, dto: SuggestVisitPlanCarersDto) {
    const serviceUser = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: {
        id: true,
        locationId: true,
        assignments: {
          where: { deletedAt: null },
          select: { locationId: true },
        },
      },
    });
    if (!serviceUser) throw new NotFoundException('Service user not found');

    const serviceUserLocationIds = resolveServiceUserLocationIds(serviceUser);
    const employmentLocationWhere = buildEmployeeEmploymentLocationWhere(serviceUserLocationIds);

    const domCare = await this.prisma.serviceUserDomCare.findFirst({
      where: { serviceUserId, deletedAt: null },
      include: {
        preferredCarerLinks: { where: { isActive: true } },
        blockedCarerLinks: { where: { isActive: true } },
      },
    });
    const preferredIds = new Set(domCare?.preferredCarerLinks.map((l) => l.employeeId) ?? []);
    const blockedIds = new Set(domCare?.blockedCarerLinks.map((l) => l.employeeId) ?? []);

    const linkedFormIds = dto.linkedCarePlanFormIds ?? [];
    const careForms =
      linkedFormIds.length > 0
        ? await this.prisma.carePathwayForm.findMany({
            where: { id: { in: linkedFormIds }, deletedAt: null },
            select: { id: true, name: true },
          })
        : [];
    const skillKeywords = requiredSkillKeywords([], careForms.map((f) => f.name));

    const employeeInclude = {
      personalDetail: true,
      employment: { include: { role: true, jobTitle: true } },
      workingPatterns: { where: { deletedAt: null, isActive: true } },
      skills: {
        where: { deletedAt: null, isActive: true },
        include: { skillType: { select: { id: true, name: true } } },
      },
    } as const;

    const baseEmployees = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(employmentLocationWhere ? { employment: employmentLocationWhere } : {}),
      },
      include: employeeInclude,
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    const includeIds = [...new Set((dto.includeEmployeeIds ?? []).filter((id) => id.trim()))];
    const knownIds = new Set(baseEmployees.map((row) => row.id));
    const missingIds = includeIds.filter((id) => !knownIds.has(id));
    const extraEmployees = missingIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: missingIds }, deletedAt: null, isActive: true },
          include: employeeInclude,
        })
      : [];
    const employees = [...baseEmployees, ...extraEmployees];

    const slotDays = [...new Set(dto.daysOfWeek)].sort();
    const rotaConflictByEmployee = await this.loadRotaConflictJobNamesByEmployee(
      employees.map((e) => e.id),
      dto,
      serviceUserId,
    );
    const complianceByEmployee = await this.allocationCompliance.evaluateForEmployees(
      employees.map((e) => e.id),
    );

    // Weekly assigned hours per carer across all ACTIVE visit plans — used to flag
    // carers whose total assigned hours would exceed their contracted weekly hours.
    // This service user's own copy of the slot being edited is left out, so a carer
    // already saved on it is not counted twice (it is added back as the proposed visit).
    const assignedMinutesByEmployee = new Map<string, number>();
    const assignmentRows = await this.prisma.visitPlanSlotCarerAssignment.findMany({
      where: {
        employeeId: { in: employees.map((e) => e.id) },
        visitPlanSlot: { isActive: true, visitPlan: { status: { in: ['ACTIVE', 'DRAFT'] } } },
      },
      select: {
        employeeId: true,
        dayOfWeek: true,
        durationMinutes: true,
        plannedStartTime: true,
        plannedEndTime: true,
        visitPlanSlot: {
          select: {
            slotCode: true,
            daysOfWeek: true,
            plannedStartTime: true,
            plannedEndTime: true,
            durationMinutes: true,
            slotKind: true,
            visitPlan: { select: { serviceUserId: true } },
          },
        },
      },
    });
    for (const a of assignmentRows) {
      const slot = a.visitPlanSlot;
      if (
        slot.visitPlan.serviceUserId === serviceUserId &&
        slot.slotCode === dto.slotCode
      ) {
        continue;
      }
      const start = a.plannedStartTime ?? slot.plannedStartTime;
      const end = a.plannedEndTime ?? slot.plannedEndTime;
      const perDay =
        a.durationMinutes ??
        slot.durationMinutes ??
        deriveDurationFromTimes(start, end, slot.slotKind ?? undefined);
      const days = a.dayOfWeek != null ? 1 : slot.daysOfWeek?.length ?? 0;
      assignedMinutesByEmployee.set(
        a.employeeId,
        (assignedMinutesByEmployee.get(a.employeeId) ?? 0) + perDay * days,
      );
    }
    const completedMinutesByEmployee = await this.completedMinutesThisWeek(
      employees.map((e) => e.id),
    );
    const proposedPerDayMinutes = deriveDurationFromTimes(
      dto.plannedStartTime,
      dto.plannedEndTime,
    );
    const proposedWeeklyMinutes = proposedPerDayMinutes * slotDays.length;

    const candidates = [];

    for (const emp of employees) {
      if (!emp.personalDetail || emp.personalDetail.deletedAt) continue;
      const name = `${emp.personalDetail.firstName ?? ''} ${emp.personalDetail.lastName ?? ''}`.trim();
      const isBlocked = blockedIds.has(emp.id);
      const isPreferred = preferredIds.has(emp.id);
      const rotaConflictJobs = rotaConflictByEmployee.get(emp.id) ?? [];
      const hasRotaConflict = rotaConflictJobs.length > 0;

      const availability = evaluateCarerAvailability(
        emp.workingPatterns.map((p) => ({
          weekInCycle: p.weekInCycle,
          dayOfWeek: p.dayOfWeek,
          startTime: p.startTime,
          endTime: p.endTime,
          isAvailable: p.isAvailable,
          notes: p.notes,
        })),
        slotDays,
        dto.plannedStartTime,
        dto.plannedEndTime,
        {
          workingPatternCycleWeeks: emp.employment?.workingPatternCycleWeeks ?? 1,
          workingPatternCycleAnchorDate: emp.employment?.workingPatternCycleAnchorDate ?? null,
          startDate: emp.employment?.startDate ?? null,
          employeeCreatedAt: emp.createdAt,
        },
      );

      const skillRows = emp.skills.map((s) => ({
        skillTypeId: s.skillTypeId,
        skillName: s.skillType?.name ?? null,
        expiryDate: s.expiryDate,
      }));
      const skills = matchEmployeeSkills(skillRows, skillKeywords);

      const compliance = complianceByEmployee.get(emp.id) ?? EMPTY_COMPLIANCE_ALLOCATION_RESULT;
      const complianceMessages = formatComplianceAllocationMessages(compliance);
      const complianceIssues = compliance.attentionCount;
      const complianceBlocksAllocation = compliance.blocksAllocation;

      const warnings: string[] = [];
      if (isBlocked) warnings.push('Blocked for this service user');
      if (isPreferred) warnings.push('Preferred carer');
      if (hasRotaConflict) {
        warnings.push(CARER_ROTA_CONFLICT_MESSAGE);
      }
      // Availability summary is shown separately in the UI — only add extras not already in it.
      const availabilitySummaryNorm = availability.summary.trim().toLowerCase();
      for (const message of availability.timeMismatchMessages) {
        const norm = message.trim().toLowerCase();
        if (!norm) continue;
        if (availabilitySummaryNorm && availabilitySummaryNorm.includes(norm)) continue;
        warnings.push(message);
      }
      if (
        !availability.timeWindowOk &&
        availability.timeMismatchMessages.length === 0 &&
        !availabilitySummaryNorm.includes('outside')
      ) {
        warnings.push('Visit time outside working hours on some days');
      }
      if (skills.missing.length) warnings.push(`Missing skills: ${skills.missing.join(', ')}`);
      if (complianceMessages.block) warnings.push(complianceMessages.block);
      else if (complianceMessages.warn) warnings.push(complianceMessages.warn);

      // Weekly-hours flag: total assigned + this visit would exceed the allowed weekly hours
      // (active approved extra hours, else contracted).
      const contractedWeeklyHours = emp.employment?.contractedWeeklyHours ?? null;
      const allowedWeeklyHours = resolveApprovedWeeklyHoursThreshold(
        emp.employment,
      );
      const assignedWeeklyHours =
        Math.round(((assignedMinutesByEmployee.get(emp.id) ?? 0) / 60) * 10) / 10;
      const projectedWeeklyHours =
        Math.round(
          (((assignedMinutesByEmployee.get(emp.id) ?? 0) + proposedWeeklyMinutes) / 60) * 10,
        ) / 10;
      const exceedsContractedHours =
        allowedWeeklyHours != null &&
        allowedWeeklyHours > 0 &&
        projectedWeeklyHours > allowedWeeklyHours + 0.01;
      if (exceedsContractedHours) {
        warnings.push(
          `Exceeds weekly hours (~${projectedWeeklyHours}h of ${allowedWeeklyHours}h/wk)`,
        );
      }

      const fit = carerFitScore({
        isBlocked,
        hasRotaConflict,
        unavailableDays: availability.unavailableDays,
        slotDaysCount: slotDays.length,
        missingSkills: skills.missing,
        requiredSkillCount: skillKeywords.length,
        complianceIssues,
        complianceBlocksAllocation,
        isPreferred,
        timeOutsidePattern: !availability.timeWindowOk,
      });

      candidates.push({
        employeeId: emp.id,
        displayName: name || emp.id,
        role: emp.employment?.role?.name ?? null,
        jobTitle: emp.employment?.jobTitle?.name ?? null,
        fit,
        isPreferred,
        isBlocked,
        hasRotaConflict,
        rotaConflictJobs,
        availability,
        skills,
        complianceIssues,
        complianceBlocksAllocation,
        contractedWeeklyHours,
        allowedWeeklyHours,
        assignedWeeklyHours,
        completedWeeklyHours:
          Math.round(((completedMinutesByEmployee.get(emp.id) ?? 0) / 60) * 10) / 10,
        projectedWeeklyHours,
        exceedsContractedHours,
        warnings,
      });
    }

    const fitOrder = { good: 0, partial: 1, poor: 2 };
    candidates.sort((a, b) => {
      if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
      const fo = fitOrder[a.fit] - fitOrder[b.fit];
      if (fo !== 0) return fo;
      return a.displayName.localeCompare(b.displayName);
    });

    return {
      data: {
        candidates,
        preferredCarerIds: [...preferredIds],
        blockedCarerIds: [...blockedIds],
        requiredSkillKeywords: skillKeywords,
        requiredCarers: dto.requiredCarers ?? 1,
        locationFilterApplied: serviceUserLocationIds.length > 0,
        serviceUserLocationIds,
      },
    };
  }

  /**
   * Minutes of COMPLETED visits per carer in the current rota week (Sunday start, org
   * timezone — same week as the rota capacity check). Shown as "Done" in the carer picker.
   */
  private async completedMinutesThisWeek(
    employeeIds: string[],
  ): Promise<Map<string, number>> {
    const minutesByEmployee = new Map<string, number>();
    if (!employeeIds.length) return minutesByEmployee;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const now = new Date();
    const weekStartKey = addDaysToOperationalIso(
      dayKeyInTimeZone(now, timeZone),
      -weekdayIndexInTimeZone(now, timeZone),
    );
    const weekStart = operationalDayBounds(weekStartKey, timeZone).start;
    const weekEnd = operationalDayBounds(
      addDaysToOperationalIso(weekStartKey, 7),
      timeZone,
    ).start;
    const rows = await this.prisma.jobAllocation.findMany({
      where: {
        employeeId: { in: employeeIds },
        deletedAt: null,
        isActive: true,
        scheduledJob: {
          deletedAt: null,
          scheduledStartDateTime: { gte: weekStart, lt: weekEnd },
          visits: { some: { status: ScheduledVisitStatus.COMPLETED } },
        },
      },
      select: {
        employeeId: true,
        scheduledStartDateTime: true,
        scheduledEndDateTime: true,
        scheduledJob: {
          select: { scheduledStartDateTime: true, scheduledEndDateTime: true },
        },
      },
    });
    for (const row of rows) {
      const start =
        row.scheduledStartDateTime ?? row.scheduledJob.scheduledStartDateTime;
      const end =
        row.scheduledEndDateTime ?? row.scheduledJob.scheduledEndDateTime;
      if (!start || !end) continue;
      const minutes = Math.max(0, (end.getTime() - start.getTime()) / 60000);
      minutesByEmployee.set(
        row.employeeId,
        (minutesByEmployee.get(row.employeeId) ?? 0) + minutes,
      );
    }
    return minutesByEmployee;
  }

  private async loadRotaConflictJobNamesByEmployee(
    employeeIds: string[],
    dto: SuggestVisitPlanCarersDto,
    serviceUserId: string,
  ): Promise<Map<string, string[]>> {
    const conflicts = new Map<string, string[]>();
    if (!employeeIds.length) return conflicts;

    const timeZone = await this.orgSettings.getOperationalTimezone();
    const activeStatuses: AllocationStatus[] = [
      AllocationStatus.PENDING_CONFIRMATION,
      AllocationStatus.ALLOCATED,
      AllocationStatus.CONFIRMED,
    ];

    if (dto.scheduledDate) {
      const window = visitPlanSuggestJobWindow(
        dto.scheduledDate,
        dto.plannedStartTime,
        dto.plannedEndTime,
        timeZone,
      );
      if (!window) return conflicts;

      const { jobStart, jobEnd } = window;
      const rows = await this.prisma.jobAllocation.findMany({
        where: {
          employeeId: { in: employeeIds },
          deletedAt: null,
          isActive: true,
          status: { in: activeStatuses },
          ...(dto.excludeScheduledJobId
            ? { scheduledJobId: { not: dto.excludeScheduledJobId } }
            : {}),
          scheduledJob: {
            deletedAt: null,
            isActive: true,
            AND: [
              { scheduledStartDateTime: { lt: jobEnd } },
              {
                OR: [{ scheduledEndDateTime: { gt: jobStart } }, { scheduledEndDateTime: null }],
              },
            ],
          },
        },
        select: {
          employeeId: true,
          scheduledJob: { select: { jobName: true } },
        },
        take: 500,
      });

      for (const row of rows) {
        const jobName = row.scheduledJob.jobName;
        const list = conflicts.get(row.employeeId) ?? [];
        if (!list.includes(jobName)) list.push(jobName);
        conflicts.set(row.employeeId, list);
      }

      return conflicts;
    }

    const slotDays = [...new Set(dto.daysOfWeek ?? [])];
    if (!slotDays.length) return conflicts;

    const rangeStart = operationalDayBounds(
      operationalTodayIso(new Date(), timeZone),
      timeZone,
    ).start;
    const rangeEnd = visitPlanPatternRotaLookaheadEnd(rangeStart, timeZone);

    const rows = await this.prisma.jobAllocation.findMany({
      where: {
        employeeId: { in: employeeIds },
        deletedAt: null,
        isActive: true,
        status: { in: activeStatuses },
        ...(dto.excludeScheduledJobId
          ? { scheduledJobId: { not: dto.excludeScheduledJobId } }
          : {}),
        scheduledJob: {
          deletedAt: null,
          isActive: true,
          scheduledStartDateTime: { gte: rangeStart, lt: rangeEnd },
        },
      },
      select: {
        employeeId: true,
        scheduledJob: {
          select: {
            jobName: true,
            scheduledStartDateTime: true,
            scheduledEndDateTime: true,
            serviceUserId: true,
            visits: {
              select: { visitPlanSlot: { select: { slotCode: true } } },
            },
          },
        },
      },
      take: 500,
    });

    for (const row of rows) {
      const job = row.scheduledJob;
      // The visit being edited already has rota jobs for its carers — those are not a clash.
      const isThisVisit =
        job.serviceUserId === serviceUserId &&
        job.visits.some((v) => v.visitPlanSlot?.slotCode === dto.slotCode);
      if (isThisVisit) continue;
      if (
        !scheduledJobOverlapsVisitPlanSlot({
          jobStart: job.scheduledStartDateTime,
          jobEnd: job.scheduledEndDateTime,
          slotDaysOfWeek: slotDays,
          plannedStartTime: dto.plannedStartTime,
          plannedEndTime: dto.plannedEndTime,
          timeZone,
        })
      ) {
        continue;
      }

      const list = conflicts.get(row.employeeId) ?? [];
      if (!list.includes(job.jobName)) list.push(job.jobName);
      conflicts.set(row.employeeId, list);
    }

    return conflicts;
  }

  /** Organisation-local "today" as a UTC-midnight calendar label (org timezone setting). */
  private async opsTodayUtc(): Promise<Date> {
    return visitPlanTodayUtc(new Date(), await this.orgSettings.getOperationalTimezone());
  }

  private parseDateOnly(value: string, field: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) throw new BadRequestException(`${field} must be YYYY-MM-DD`);
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} is invalid`);
    return d;
  }

  private combineDateAndTime(date: Date, time: string, timeZone: string): Date {
    const m = /^(\d{2}):(\d{2})$/.exec(time);
    if (!m) throw new BadRequestException('Invalid time');
    const combined = combineOperationalDateAndHm(date.toISOString().slice(0, 10), time, timeZone);
    if (Number.isNaN(combined.getTime())) throw new BadRequestException('Invalid time');
    return combined;
  }

  private resolveActualVisitTimes(
    day: Date,
    dto: RecordVisitPlanCalendarOutcomeDto,
    timeZone: string,
  ): { actualStart?: Date; actualEnd?: Date } {
    let actualStart: Date | undefined;
    let actualEnd: Date | undefined;

    if (dto.actualStartTime) {
      actualStart = this.combineDateAndTime(day, dto.actualStartTime, timeZone);
    } else if (dto.status === ScheduledVisitStatus.STARTED) {
      actualStart = new Date();
    }

    if (dto.actualEndTime) {
      actualEnd = this.combineDateAndTime(day, dto.actualEndTime, timeZone);
      if (actualStart && actualEnd.getTime() <= actualStart.getTime()) {
        // Next day at that clock time (not +24 hours, which is an hour out on clock-change nights).
        actualEnd = this.combineDateAndTime(new Date(day.getTime() + 86400000), dto.actualEndTime, timeZone);
      }
    } else if (dto.status === ScheduledVisitStatus.COMPLETED && !dto.actualStartTime) {
      actualEnd = new Date();
    }

    if (
      dto.status === ScheduledVisitStatus.COMPLETED &&
      dto.actualStartTime &&
      dto.actualEndTime &&
      !actualStart
    ) {
      actualStart = this.combineDateAndTime(day, dto.actualStartTime, timeZone);
    }

    return { actualStart, actualEnd };
  }

  private async ensureVisitEmployeeAllocation(
    tx: Prisma.TransactionClient,
    userId: string,
    visit: { id: string; scheduledJobId: string },
    employeeId: string,
    requiredCarers: number,
  ): Promise<void> {
    const existing = await tx.jobAllocation.findFirst({
      where: {
        scheduledJobId: visit.scheduledJobId,
        employeeId,
        deletedAt: null,
        isActive: true,
      },
    });
    if (!existing) {
      await tx.jobAllocation.create({
        data: {
          scheduledJobId: visit.scheduledJobId,
          scheduledVisitId: visit.id,
          employeeId,
          status: AllocationStatus.CONFIRMED,
          requiresConfirmation: false,
          allocatedById: userId,
        },
      });
    }

    const activeCount = await tx.jobAllocation.count({
      where: {
        scheduledJobId: visit.scheduledJobId,
        deletedAt: null,
        isActive: true,
        status: { in: CALENDAR_VISIT_ACTIVE_ALLOCATION },
      },
    });

    const job = await tx.scheduledJob.findFirst({
      where: { id: visit.scheduledJobId },
      select: { metadata: true },
    });
    const prevMeta =
      job?.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)
        ? (job.metadata as Record<string, unknown>)
        : {};

    await tx.scheduledJob.update({
      where: { id: visit.scheduledJobId },
      data: {
        status:
          activeCount >= requiredCarers
            ? ScheduledJobStatus.ALLOCATED
            : ScheduledJobStatus.NEEDS_ATTENTION,
        metadata: {
          ...prevMeta,
          visitPlanAttendingEmployeeId: employeeId,
        } as Prisma.InputJsonValue,
      },
    });
  }

  async list(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const roundNameByCode = await this.loadRoundNameMap();
    const rows = await this.prisma.serviceUserVisitPlan.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
      include: planInclude,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    return { data: rows.map((r) => this.mapPlan(r, roundNameByCode)) };
  }

  async getActive(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const roundNameByCode = await this.loadRoundNameMap();
    const row = await this.prisma.serviceUserVisitPlan.findFirst({
      where: { serviceUserId, status: VisitPlanStatus.ACTIVE, deletedAt: null, isActive: true },
      include: planInclude,
    });
    return { data: row ? this.mapPlan(row, roundNameByCode) : null };
  }

  /**
   * Planned visit hours per week for the next weeks, against the service user's weekly
   * contracted hours (DOM Care / approved value). Read only.
   */
  async weeklyHoursSummary(serviceUserId: string, planId: string) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const context = await this.weeklyHours.context();
    const summary = await this.weeklyHours.count(this.prisma, planId, context);
    const limit = await this.weeklyHours.limit(this.prisma, serviceUserId, plan.weeklyContractedHours);
    return { data: await this.withPlanLimit(plan, summary, limit, context.rules) };
  }

  /**
   * Same count for an unsaved visit schedule (the plan page while editing). The slots are
   * written inside a transaction that is always rolled back, so nothing is saved.
   */
  async previewWeeklyHours(serviceUserId: string, planId: string, slots: VisitPlanSlotDto[] | undefined) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const rounds = await this.loadMedicationRoundCatalog();
    const context = await this.weeklyHours.context();
    const limit = await this.weeklyHours.limit(this.prisma, serviceUserId, plan.weeklyContractedHours);
    const result: { summary?: VisitPlanWeeklyHoursSummary } = {};
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const slot of this.normalizeSlots(slots, rounds)) {
          await this.upsertPlanSlot(tx, planId, slot);
        }
        result.summary = await this.weeklyHours.count(tx, planId, context);
        throw new WeeklyHoursPreviewRollback();
      });
    } catch (e) {
      if (!(e instanceof WeeklyHoursPreviewRollback)) throw e;
    }
    return { data: await this.withPlanLimit(plan, result.summary!, limit, context.rules) };
  }

  /** A draft follows the draft rule and carries its manager-approval request, if any. */
  private async withPlanLimit(
    plan: { id: string; status: VisitPlanStatus },
    summary: VisitPlanWeeklyHoursSummary,
    limit: number | null,
    rules: { planOverLimit: SuPlanOverLimit; draftOverLimit: SuDraftOverLimit },
  ) {
    if (plan.status !== VisitPlanStatus.DRAFT) {
      return this.weeklyHours.withLimit(summary, limit, rules.planOverLimit);
    }
    return {
      ...this.weeklyHours.withLimit(summary, limit, rules.draftOverLimit),
      draftApproval:
        rules.draftOverLimit === 'MANAGER_APPROVAL'
          ? await this.hoursApprovals.latestDraftPlanRequest(plan.id)
          : null,
    };
  }

  async getById(serviceUserId: string, planId: string) {
    const roundNameByCode = await this.loadRoundNameMap();
    const row = await this.getPlanOrThrow(serviceUserId, planId);
    return { data: this.mapPlan(row, roundNameByCode) };
  }

  async create(
    userId: string,
    serviceUserId: string,
    dto: CreateVisitPlanDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const weeklyContractedHours = assertWeeklyContractedHoursForCreate(dto.weeklyContractedHours);
    const rounds = await this.loadMedicationRoundCatalog();
    const roundNameByCode = new Map(rounds.map((r) => [r.code, r.name]));
    const slots = this.normalizeSlots(dto.slots, rounds);
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      // A new plan starts from the service user's current weekly hours; changing them needs approval.
      const currentHours = await currentServiceUserWeeklyHours(tx, serviceUserId);
      if (currentHours != null && !sameWeeklyHours(currentHours, weeklyContractedHours)) {
        throw new BadRequestException(
          `Weekly contracted hours must match the service user's current hours (${currentHours}h). ${SERVICE_USER_HOURS_NEED_APPROVAL_MESSAGE}`,
        );
      }
      const plan = await tx.serviceUserVisitPlan.create({
        data: {
          serviceUserId,
          status: VisitPlanStatus.DRAFT,
          effectiveFrom,
          weeklyContractedHours,
          numberOfCarers: dto.numberOfCarers ?? 1,
          sourceSubmissionId: dto.sourceSubmissionId ?? null,
          reviewDueAt: dto.reviewDueAt ? new Date(dto.reviewDueAt) : null,
          notes: dto.notes?.trim() ?? '',
          createdById: userId,
        },
      });
      await tx.visitPlanSlot.createMany({
        data: slots.map((s) => ({
          visitPlanId: plan.id,
          slotCode: s.slotCode,
          sortOrder: s.sortOrder,
          ...this.slotPersistFields(s),
        })),
      });
      for (const slot of slots) {
        const row = await tx.visitPlanSlot.findFirstOrThrow({
          where: { visitPlanId: plan.id, slotCode: slot.slotCode },
          select: { id: true },
        });
        await this.persistSlotRelations(tx, row.id, slot.carerAssignments ?? [], slot.exceptions ?? []);
      }
      // Visits may not take any week over the service user's weekly contracted hours.
      await this.weeklyHours.assertWithinLimit(tx, serviceUserId, plan.id, null, weeklyContractedHours, 'DRAFT');
      await syncServiceUserWeeklyHours(tx, this.audit, {
        serviceUserId,
        value: weeklyContractedHours,
        userId,
        source: 'visit_plan',
        sourceVisitPlanId: plan.id,
        meta,
      });
      const full = await tx.serviceUserVisitPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: planInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_VISIT_PLAN_CREATED,
        recordType: 'ServiceUserVisitPlan',
        recordId: plan.id,
        newValues: auditSnapshot(full),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return full;
    });

    await this.syncDraftOverHoursRequest(userId, serviceUserId, created.id, meta);
    return { message: 'Visit plan created', data: this.mapPlan(created, roundNameByCode) };
  }

  async update(
    userId: string,
    serviceUserId: string,
    planId: string,
    dto: UpdateVisitPlanDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.getPlanOrThrow(serviceUserId, planId);
    if (existing.status === VisitPlanStatus.ENDED) {
      throw new BadRequestException('Ended visit plans cannot be edited');
    }
    const rounds = await this.loadMedicationRoundCatalog();
    const roundNameByCode = new Map(rounds.map((r) => [r.code, r.name]));

    const snapshotBefore = this.snapshot(existing, roundNameByCode) as VisitPlanSnapshotShape;

    const respectWorkingPattern =
      dto.respectWorkingPatternOnSync ?? existing.respectWorkingPatternOnSync !== false;
    const weeklyHoursBefore = dto.slots?.length ? await this.weeklyHours.count(this.prisma, planId) : null;
    const timeZone = await this.orgSettings.getOperationalTimezone();

    const updated = await this.prisma.$transaction(async (tx) => {
      // Once set, weekly hours change only through a manager-approved request.
      if (
        dto.weeklyContractedHours !== undefined &&
        !sameWeeklyHours(dto.weeklyContractedHours, existing.weeklyContractedHours)
      ) {
        const currentHours = await currentServiceUserWeeklyHours(tx, serviceUserId);
        if (currentHours != null && !sameWeeklyHours(currentHours, dto.weeklyContractedHours)) {
          throw new BadRequestException(SERVICE_USER_HOURS_NEED_APPROVAL_MESSAGE);
        }
      }
      if (dto.slots?.length) {
        for (const slot of this.normalizeSlots(dto.slots, rounds)) {
          await this.upsertPlanSlot(tx, planId, slot);
        }
        // Visits may not take any week over the service user's weekly contracted hours.
        await this.weeklyHours.assertWithinLimit(
          tx,
          serviceUserId,
          planId,
          weeklyHoursBefore,
          existing.weeklyContractedHours,
          existing.status === VisitPlanStatus.DRAFT ? 'DRAFT' : 'PLAN',
        );
        for (const slot of this.normalizeSlots(dto.slots, rounds)) {
          const row = await tx.visitPlanSlot.findFirst({
            where: { visitPlanId: planId, slotCode: slot.slotCode },
            include: { carerAssignments: true },
          });
          if (row) {
            const carerAssignments = mapDbCarerAssignmentsForSync(row.carerAssignments ?? []);
            const assignedEmployeeIds = visitPlanCarerEmployeeIds(
              [],
              resolveGlobalAssignedEmployeeIds(row.assignedEmployeeIds, row.carerAssignments),
              row.requiredCarers,
            );
            await syncVisitPlanSlotCarersToScheduledJobs(tx, {
              visitPlanSlotId: row.id,
              assignedEmployeeIds,
              carerAssignments,
              requiredCarers: row.requiredCarers,
              userId,
              fromDateTime: visitPlanCarerSyncFromDateTime(undefined, timeZone),
              timeZone,
              respectWorkingPattern,
            });
            await syncVisitPlanSlotNightDutyToScheduledJobs(tx, {
              visitPlanSlotId: row.id,
              nightDuty: row.nightDuty,
              fromDateTime: visitPlanCarerSyncFromDateTime(undefined, timeZone),
            });
          }
        }
      }
      await tx.serviceUserVisitPlan.update({
        where: { id: planId },
        data: {
          ...(dto.effectiveFrom !== undefined ? { effectiveFrom: new Date(dto.effectiveFrom) } : {}),
          ...(dto.weeklyContractedHours !== undefined
            ? { weeklyContractedHours: dto.weeklyContractedHours?.trim() ?? null }
            : {}),
          ...(dto.numberOfCarers !== undefined ? { numberOfCarers: dto.numberOfCarers } : {}),
          ...(dto.reviewDueAt !== undefined
            ? { reviewDueAt: dto.reviewDueAt ? new Date(dto.reviewDueAt) : null }
            : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          ...(dto.respectWorkingPatternOnSync !== undefined
            ? { respectWorkingPatternOnSync: dto.respectWorkingPatternOnSync }
            : {}),
          updatedById: userId,
        },
      });
      if (dto.weeklyContractedHours !== undefined) {
        await syncServiceUserWeeklyHours(tx, this.audit, {
          serviceUserId,
          value: dto.weeklyContractedHours,
          userId,
          source: 'visit_plan',
          sourceVisitPlanId: planId,
          meta,
        });
      }
      const after = await tx.serviceUserVisitPlan.findUniqueOrThrow({
        where: { id: planId },
        include: planInclude,
      });
      await tx.visitPlanAmendment.create({
        data: {
          visitPlanId: planId,
          reason: dto.amendmentReason.trim(),
          snapshotBefore: this.snapshot(existing, roundNameByCode) as Prisma.InputJsonValue,
          snapshotAfter: this.snapshot(after, roundNameByCode) as Prisma.InputJsonValue,
          amendedById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_VISIT_PLAN_UPDATED,
        recordType: 'ServiceUserVisitPlan',
        recordId: planId,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(after),
        metadata: { serviceUserId, amendmentReason: dto.amendmentReason.trim() },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return after;
    });

    const snapshotAfter = this.snapshot(updated, roundNameByCode) as VisitPlanSnapshotShape;
    // Flag carers now assigned beyond their contracted weekly hours for manager approval.
    await this.hoursApprovals.reconcileForPlan(userId, serviceUserId, planId);
    if (existing.status === VisitPlanStatus.DRAFT) {
      await this.syncDraftOverHoursRequest(userId, serviceUserId, planId, meta);
    }
    let scheduleImpact: ScheduleImpactResult | undefined;
    if (existing.status === VisitPlanStatus.ACTIVE && dto.applyScheduleImpact) {
      scheduleImpact = await this.amendmentImpact.applyAmendmentImpact(userId, {
        serviceUserId,
        amendmentReason: dto.amendmentReason.trim(),
        before: snapshotBefore,
        after: snapshotAfter,
      }, meta);
    }

    return {
      message: 'Visit plan updated',
      data: this.mapPlan(updated, roundNameByCode),
      ...(scheduleImpact ? { scheduleImpact } : {}),
    };
  }

  async previewAmendmentScheduleImpact(
    serviceUserId: string,
    planId: string,
    dto: UpdateVisitPlanDto,
  ) {
    const existing = await this.getPlanOrThrow(serviceUserId, planId);
    const rounds = await this.loadMedicationRoundCatalog();
    const roundNameByCode = new Map(rounds.map((r) => [r.code, r.name]));
    const snapshotBefore = this.snapshot(existing, roundNameByCode) as VisitPlanSnapshotShape;
    const snapshotAfter = this.buildSimulatedAfterSnapshot(existing, dto, rounds, roundNameByCode);
    const preview = await this.amendmentImpact.previewAmendmentImpact({
      serviceUserId,
      planStatus: existing.status,
      before: snapshotBefore,
      after: snapshotAfter,
    });
    return { data: preview };
  }

  async previewCarerSyncPattern(
    serviceUserId: string,
    planId: string,
    dto: VisitPlanCarerSyncPatternPreviewDto,
  ) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const rounds = await this.loadMedicationRoundCatalog();
    const roundNameByCode = new Map(rounds.map((r) => [r.code, r.name]));

    const normalized = dto.slots?.length
      ? this.normalizeSlots(dto.slots, rounds)
      : this.normalizeSlots(
          plan.slots.map((slot) => ({
            slotCode: slot.slotCode,
            daysOfWeek: slot.daysOfWeek,
            plannedStartTime: slot.plannedStartTime,
            plannedEndTime: slot.plannedEndTime,
            requiredCarers: slot.requiredCarers,
            isEnabled: slot.isEnabled,
            medicationRoundCode: slot.medicationRoundCode,
            assignedEmployeeIds: slot.assignedEmployeeIds,
            carerAssignments: slot.carerAssignments?.map((a) => ({
              employeeId: a.employeeId,
              dayOfWeek: a.dayOfWeek,
              requiredCarers: a.requiredCarers,
              plannedStartTime: a.plannedStartTime,
              plannedEndTime: a.plannedEndTime,
            })),
          })),
          rounds,
        );

    const patternSlots: SlotCarerPatternInput[] = normalized
      .filter((slot) => slot.isEnabled)
      .map((slot) => ({
        slotCode: slot.slotCode,
        slotLabel: slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNameByCode),
        daysOfWeek: slot.daysOfWeek,
        plannedStartTime: slot.plannedStartTime,
        plannedEndTime: slot.plannedEndTime,
        isEnabled: slot.isEnabled,
        assignedEmployeeIds: slot.assignedEmployeeIds ?? [],
        carerAssignments: slot.carerAssignments ?? [],
      }));

    const employeeIds = [
      ...new Set(
        patternSlots.flatMap((slot) => {
          if (slot.carerAssignments?.length) {
            return slot.carerAssignments.map((a) => a.employeeId?.trim()).filter(Boolean) as string[];
          }
          return slot.assignedEmployeeIds.filter((id) => id.trim());
        }),
      ),
    ];

    const employees = employeeIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: employeeIds }, deletedAt: null },
          include: {
            personalDetail: true,
            employment: true,
            workingPatterns: { where: { deletedAt: null, isActive: true } },
          },
        })
      : [];

    const contexts = employees.map(employmentToPatternContext);
    const conflicts = collectCarerPatternConflicts(patternSlots, contexts);
    const patternByEmployee = await loadEmployeePatternContexts(this.prisma, employeeIds);

    const slotByCode = new Map(plan.slots.map((s) => [s.slotCode, s]));
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const from = visitPlanCarerSyncFromDateTime(undefined, timeZone);
    let visitsSkippedIfRespecting = 0;

    for (const slot of normalized) {
      if (!slot.isEnabled) continue;
      const row = slotByCode.get(slot.slotCode);
      if (!row) continue;

      const assignedEmployeeIds = visitPlanCarerEmployeeIds(
        [],
        slot.assignedEmployeeIds ?? [],
        slot.requiredCarers ?? row.requiredCarers,
      );
      if (!assignedEmployeeIds.length) continue;

      const visits = await this.prisma.scheduledVisit.findMany({
        where: {
          visitPlanSlotId: row.id,
          deletedAt: null,
          scheduledStartDateTime: { gte: from },
          status: { in: [ScheduledVisitStatus.PLANNED, ScheduledVisitStatus.NEEDS_ATTENTION] },
          scheduledJob: { deletedAt: null },
        },
        select: {
          scheduledStartDateTime: true,
          scheduledEndDateTime: true,
          requiredCarers: true,
        },
      });

      visitsSkippedIfRespecting += countVisitsSkippedIfRespecting(
        visits,
        assignedEmployeeIds,
        row.requiredCarers,
        patternByEmployee,
        timeZone,
      );
    }

    return { data: { conflicts, visitsSkippedIfRespecting } };
  }

  private buildSimulatedAfterSnapshot(
    existing: PlanRow,
    dto: UpdateVisitPlanDto,
    rounds: MedicationRoundCatalogRow[],
    roundNameByCode: Map<string, string>,
  ): VisitPlanSnapshotShape {
    if (!dto.slots?.length) {
      return this.snapshot(existing, roundNameByCode) as VisitPlanSnapshotShape;
    }
    const normalized = this.normalizeSlots(dto.slots, rounds);
    const byCode = new Map(normalized.map((s) => [s.slotCode, s]));
    const merged: PlanRow = {
      ...existing,
      slots: existing.slots.map((slot) => {
        const input = byCode.get(slot.slotCode);
        if (!input) return slot;
        return {
          ...slot,
          daysOfWeek: input.daysOfWeek,
          plannedStartTime: input.plannedStartTime,
          plannedEndTime: input.plannedEndTime,
          isEnabled: input.isEnabled,
          requiredCarers: input.requiredCarers,
          durationMinutes: input.durationMinutes ?? slot.durationMinutes,
          slotKind: input.slotKind,
          nightDuty: input.nightDuty,
          exceptions: (input.exceptions ?? []).map((ex, idx) => ({
            ...EMPTY_DATE_CHANGE_FIELDS,
            id: `sim-${slot.slotCode}-${idx}`,
            visitPlanSlotId: slot.id,
            exceptionDate: new Date(`${ex.exceptionDate.slice(0, 10)}T12:00:00.000Z`),
            exceptionType: ex.exceptionType,
            plannedStartTime: ex.plannedStartTime ?? null,
            plannedEndTime: ex.plannedEndTime ?? null,
            durationMinutes: ex.durationMinutes ?? null,
            requiredCarers: ex.requiredCarers ?? null,
            notes: ex.notes ?? '',
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
          // Date changes are saved from their own dialogs; a plan save without them keeps what is stored.
          ...(input.exceptions === undefined ? { exceptions: slot.exceptions } : {}),
        };
      }),
    };
    return this.snapshot(merged, roundNameByCode) as VisitPlanSnapshotShape;
  }

  async previewActivateScheduleImpact(serviceUserId: string, planId: string) {
    await this.ensureServiceUser(serviceUserId);
    const otherActive = await this.prisma.serviceUserVisitPlan.findMany({
      where: {
        serviceUserId,
        status: VisitPlanStatus.ACTIVE,
        deletedAt: null,
        id: { not: planId },
      },
      include: { slots: { where: { isEnabled: true }, select: { id: true, slotCode: true } } },
    });
    if (!otherActive.length) {
      return {
        data: {
          otherActivePlans: [],
          scheduleImpact: { jobsCancelled: 0, jobsUnallocated: 0, jobIds: [] },
        },
      };
    }
    const from = await this.opsTodayUtc();
    const scheduleImpact = await this.scheduleImpact.previewCancelScopedServiceUserJobs({
      serviceUserId,
      fromDate: from,
      scope: { visitPlanIds: otherActive.map((p) => p.id) },
    });
    return {
      data: {
        otherActivePlans: otherActive.map((p) => ({
          id: p.id,
          effectiveFrom: p.effectiveFrom.toISOString(),
          effectiveTo: p.effectiveTo?.toISOString() ?? null,
          enabledSlotCount: p.slots.length,
        })),
        scheduleImpact,
      },
    };
  }

  async previewGenerateSchedule(
    serviceUserId: string,
    planId: string,
    dto: GenerateVisitPlanScheduleDto,
  ) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    if (plan.status !== VisitPlanStatus.ACTIVE) {
      throw new BadRequestException('Only active visit plans can preview schedule generation');
    }
    const from = this.parseDateOnly(dto.fromDate, 'fromDate');
    const to = this.parseDateOnly(dto.toDate, 'toDate');
    if (to.getTime() < from.getTime()) {
      throw new BadRequestException('toDate must be on or after fromDate');
    }
    const maxDays = 31;
    const dayMs = 86400000;
    if (to.getTime() - from.getTime() > maxDays * dayMs) {
      throw new BadRequestException(`Date range cannot exceed ${maxDays} days`);
    }
    const backfillDays = dto.backfillDays ?? 0;
    const backfillOnly = dto.backfillOnly === true;
    if (backfillOnly && backfillDays < 1) {
      throw new BadRequestException('backfillDays must be at least 1 when backfillOnly is true');
    }
    const enabledSlots = plan.slots.filter((s) => s.isEnabled);
    const bankHolidayDates = await this.loadBankHolidayDateKeys(from, to, backfillDays);
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const preview = await previewGenerateScheduleFromPlan(this.prisma, {
      serviceUserId,
      planId,
      fromDate: from,
      toDate: to,
      backfillDays,
      backfillOnly,
      enabledSlots: enabledSlots.map((s) => slotAsWithRelations(s)),
      scheduleAnchor: plan.effectiveFrom,
      planEffectiveTo: plan.effectiveTo,
      bankHolidayDates,
      absenceDays: new Set(),
      timeZone,
    });
    // Shown before confirming: weeks over the weekly hours and whether generating is refused.
    const weeklyHoursWarning = await this.weeklyHoursRunWarning(
      serviceUserId,
      plan.id,
      plan.weeklyContractedHours,
      dto,
    );
    const { rules } = await this.weeklyHours.context();
    return {
      data: {
        ...preview,
        weeklyHoursWarning: weeklyHoursWarning ? `This plan is ${weeklyHoursWarning}` : null,
        weeklyHoursBlocked: Boolean(weeklyHoursWarning) && rules.bulkOverLimit !== 'WARN',
      },
    };
  }

  async previewSkipScheduleImpact(
    serviceUserId: string,
    planId: string,
    slotId: string,
    query: VisitPlanSkipImpactPreviewQueryDto,
  ) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const slot = plan.slots.find((s) => s.id === slotId);
    if (!slot) throw new NotFoundException('Visit plan slot not found');
    // Calendar label — ScheduleLifecycleImpactService maps it to org-local day bounds.
    const skipDay = this.parseDateOnly(query.date, 'date');
    const scheduleImpact = await this.scheduleImpact.previewCancelScopedServiceUserJobs({
      serviceUserId,
      fromDate: skipDay,
      toDate: skipDay,
      scope: { visitPlanSlotId: slotId },
    });
    return { data: { scheduleImpact, slotLabel: slotLabel(slot.medicationRoundCode ?? slot.slotCode) } };
  }

  async previewReturnScheduleImpact(
    serviceUserId: string,
    query: VisitPlanReturnImpactPreviewQueryDto,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const activePlan = await this.prisma.serviceUserVisitPlan.findFirst({
      where: { serviceUserId, status: VisitPlanStatus.ACTIVE, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!activePlan) {
      const suspendedPlan = await this.prisma.serviceUserVisitPlan.findFirst({
        where: { serviceUserId, status: VisitPlanStatus.SUSPENDED, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (suspendedPlan) {
        return { data: { planSuspended: true, planId: suspendedPlan.id, generatePreview: null } };
      }
      return { data: { planSuspended: false, noActivePlan: true, generatePreview: null } };
    }
    const returnDate = this.parseDateOnly(query.returnDate, 'returnDate');
    const daysAhead = query.daysAhead ?? 14;
    const toDate = new Date(returnDate);
    toDate.setUTCDate(toDate.getUTCDate() + daysAhead - 1);
    const dto: GenerateVisitPlanScheduleDto = {
      fromDate: query.returnDate,
      toDate: toDate.toISOString().slice(0, 10),
      backfillDays: 0,
    };
    const generatePreview = await this.previewGenerateSchedule(serviceUserId, activePlan.id, dto);
    return {
      data: {
        planSuspended: false,
        planId: activePlan.id,
        returnDate: query.returnDate,
        generatePreview: generatePreview.data,
      },
    };
  }

  async listSuspensionReviewsOverdue() {
    const today = await this.opsTodayUtc();
    const rows = await this.prisma.serviceUserVisitPlan.findMany({
      where: {
        status: VisitPlanStatus.SUSPENDED,
        deletedAt: null,
        isActive: true,
        suspensionReviewDueAt: { lte: today },
      },
      include: {
        serviceUser: {
          select: { id: true, firstName: true, lastName: true, preferredName: true },
        },
        pauseReasonCatalog: { select: { id: true, name: true, code: true } },
      },
      orderBy: { suspensionReviewDueAt: 'asc' },
      take: 200,
    });
    return {
      data: rows.map((r) => ({
        planId: r.id,
        serviceUserId: r.serviceUserId,
        serviceUserName:
          r.serviceUser.preferredName?.trim() ||
          `${r.serviceUser.firstName} ${r.serviceUser.lastName}`.trim(),
        suspendedAt: r.suspendedAt?.toISOString() ?? null,
        suspensionReviewDueAt: r.suspensionReviewDueAt?.toISOString() ?? null,
        expectedResumeAt: r.expectedResumeAt?.toISOString() ?? null,
        pauseReason: r.pauseReasonCatalog
          ? { id: r.pauseReasonCatalog.id, name: r.pauseReasonCatalog.name, code: r.pauseReasonCatalog.code }
          : null,
      })),
    };
  }

  async clearAllVisitPlansAndRota(dryRun: boolean) {
    const result = await clearVisitPlansAndRota(this.prisma, { dryRun });
    return {
      data: {
        dryRun,
        counts: result.counts,
        deleted: result.deleted ?? null,
      },
      message: dryRun
        ? 'Dry run — visit plans and rota counts only'
        : 'Visit plans and rota cleared for all service users',
    };
  }

  private async loadBankHolidayDateKeys(from: Date, to: Date, backfillDays: number): Promise<Set<string>> {
    const rangeStart = new Date(from);
    if (backfillDays > 0) {
      rangeStart.setUTCDate(rangeStart.getUTCDate() - backfillDays);
    }
    const rows = await this.prisma.bankHoliday.findMany({
      where: {
        isActive: true,
        region: 'UK',
        holidayDate: { gte: rangeStart, lte: to },
      },
      select: { holidayDate: true },
    });
    return new Set(rows.map((r) => r.holidayDate.toISOString().slice(0, 10)));
  }

  async processScheduledEndPlans(userId: string): Promise<number> {
    const today = await this.opsTodayUtc();
    const plans = await this.prisma.serviceUserVisitPlan.findMany({
      where: {
        status: VisitPlanStatus.ACTIVE,
        deletedAt: null,
        effectiveTo: { lt: today },
      },
      select: { id: true, serviceUserId: true, effectiveTo: true },
      take: 500,
    });
    let ended = 0;
    for (const plan of plans) {
      const hasScheduledEnd = await this.prisma.visitPlanStatusEvent.findFirst({
        where: { visitPlanId: plan.id, eventType: VisitPlanStatusEventType.SCHEDULED_END },
      });
      if (!hasScheduledEnd) continue;
      await this.prisma.serviceUserVisitPlan.update({
        where: { id: plan.id },
        data: { status: VisitPlanStatus.ENDED, updatedById: userId },
      });
      await this.audit.logAudit({
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_VISIT_PLAN_ENDED,
        recordType: 'ServiceUserVisitPlan',
        recordId: plan.id,
        metadata: {
          serviceUserId: plan.serviceUserId,
          autoScheduledEnd: true,
          effectiveTo: plan.effectiveTo?.toISOString(),
        },
      });
      ended += 1;
    }
    return ended;
  }

  /**
   * Settings → Dom Rules "draft visit plan over the hours" on manager approval: keep the draft's
   * approval request in step with its busiest week. Other settings need no request.
   */
  private async syncDraftOverHoursRequest(
    userId: string,
    serviceUserId: string,
    planId: string,
    meta?: RequestAuditMeta,
  ): Promise<{ heaviestMinutes: number } | null> {
    const { rules } = await this.weeklyHours.context();
    if (rules.draftOverLimit !== 'MANAGER_APPROVAL') return null;
    const over = await this.weeklyHours.draftOverWeeks(serviceUserId, planId);
    await this.hoursApprovals.syncDraftPlanRequest(userId, { serviceUserId, planId, ...over }, meta);
    return { heaviestMinutes: Math.max(0, ...over.overWeeks.map((w) => w.minutes)) };
  }

  /** Why this draft can't be activated yet because of its weekly hours (null when it can). */
  private async draftOverHoursActivationBlock(
    userId: string,
    serviceUserId: string,
    planId: string,
    meta?: RequestAuditMeta,
  ): Promise<string | null> {
    const synced = await this.syncDraftOverHoursRequest(userId, serviceUserId, planId, meta);
    if (!synced) return null;
    return this.hoursApprovals.draftPlanActivationBlock(planId, synced.heaviestMinutes);
  }

  async activate(
    userId: string,
    serviceUserId: string,
    planId: string,
    meta?: RequestAuditMeta,
    dto?: ActivateVisitPlanDto,
  ) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    if (plan.status !== VisitPlanStatus.DRAFT && plan.status !== VisitPlanStatus.SUSPENDED) {
      throw new BadRequestException('Only draft or suspended plans can be activated');
    }
    const enabledSlots = plan.slots.filter((s) => s.isEnabled);
    if (!enabledSlots.length) {
      throw new BadRequestException('Enable at least one visit slot before activation');
    }
    if (plan.status === VisitPlanStatus.DRAFT) {
      const blocked = await this.draftOverHoursActivationBlock(userId, serviceUserId, planId, meta);
      if (blocked) throw new BadRequestException(blocked);
    }
    const wasSuspended = plan.status === VisitPlanStatus.SUSPENDED;
    const reactivationNote = dto?.reactivationReason?.trim() || '';

    const otherActivePlans = await this.prisma.serviceUserVisitPlan.findMany({
      where: {
        serviceUserId,
        status: VisitPlanStatus.ACTIVE,
        deletedAt: null,
        id: { not: planId },
      },
      select: { id: true },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.serviceUserVisitPlan.updateMany({
        where: {
          serviceUserId,
          status: VisitPlanStatus.ACTIVE,
          deletedAt: null,
          id: { not: planId },
        },
        data: { status: VisitPlanStatus.ENDED, effectiveTo: new Date(), updatedById: userId },
      });
      const activated = await tx.serviceUserVisitPlan.update({
        where: { id: planId },
        data: {
          status: VisitPlanStatus.ACTIVE,
          ...(plan.status === VisitPlanStatus.DRAFT ? { effectiveFrom: new Date() } : {}),
          effectiveTo: null,
          approvedById: userId,
          approvedAt: new Date(),
          updatedById: userId,
          ...(wasSuspended
            ? {
                suspendedAt: null,
                suspendedById: null,
                pauseReasonCatalogId: null,
                expectedResumeAt: null,
                suspensionReviewDueAt: null,
                suspensionContingencyNotes: '',
              }
            : {}),
        },
        include: planInclude,
      });
      if (wasSuspended) {
        await tx.visitPlanStatusEvent.create({
          data: {
            visitPlanId: planId,
            eventType: VisitPlanStatusEventType.REACTIVATED,
            reason: reactivationNote || 'Package re-activated',
            createdById: userId,
          },
        });
      }
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: wasSuspended
          ? AuditAction.SERVICE_USER_VISIT_PLAN_REACTIVATED
          : AuditAction.SERVICE_USER_VISIT_PLAN_ACTIVATED,
        recordType: 'ServiceUserVisitPlan',
        recordId: planId,
        newValues: auditSnapshot(activated),
        metadata: {
          serviceUserId,
          ...(reactivationNote ? { reactivationReason: reactivationNote } : {}),
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return activated;
    });
    if (!wasSuspended) {
      // A live plan no longer needs its draft weekly-hours request.
      await this.hoursApprovals.cancelPendingDraftPlanRequests(planId, 'Plan activated');
    }

    let scheduleImpact: ScheduleImpactResult | undefined;
    if (dto?.cancelEndedPlanJobs && otherActivePlans.length) {
      scheduleImpact = await this.scheduleImpact.cancelScopedServiceUserJobs(userId, {
        serviceUserId,
        fromDate: await this.opsTodayUtc(),
        reason: 'Activating new visit plan package',
        source: 'visit_plan_activate',
        scope: { visitPlanIds: otherActivePlans.map((p) => p.id) },
      }, meta);
    }

    const roundNameByCode = await this.loadRoundNameMap();
    return {
      message: wasSuspended ? 'Visit plan re-activated' : 'Visit plan activated',
      data: this.mapPlan(result, roundNameByCode),
      ...(scheduleImpact ? { scheduleImpact } : {}),
    };
  }

  async suspend(
    userId: string,
    serviceUserId: string,
    planId: string,
    dto: SuspendVisitPlanDto,
    meta?: RequestAuditMeta,
  ) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    if (plan.status !== VisitPlanStatus.ACTIVE) {
      throw new BadRequestException('Only active visit plans can be suspended');
    }

    const pauseReason = await this.prisma.visitPlanPauseReasonCatalog.findFirst({
      where: { id: dto.pauseReasonCatalogId, isActive: true },
    });
    if (!pauseReason) {
      throw new BadRequestException('Pause reason not found or inactive');
    }

    const reason = dto.reason.trim();
    const contingencyNotes = dto.contingencyNotes?.trim() ?? '';
    const cancelFutureVisits = dto.cancelFutureVisits !== false;
    const now = new Date();
    const today = await this.opsTodayUtc();

    let effectiveFrom = today;
    if (dto.effectiveFrom?.trim()) {
      try {
        effectiveFrom = parseVisitPlanDateOnly(dto.effectiveFrom, 'effectiveFrom');
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : 'Invalid effectiveFrom');
      }
      if (isCalendarDateAfter(effectiveFrom, today)) {
        throw new BadRequestException(
          'effectiveFrom cannot be in the future — use Record Absences for future-dated visit pauses',
        );
      }
    }

    let retrospectiveReason = '';
    try {
      retrospectiveReason = assertRetrospectiveReasonWhenBackdated(
        effectiveFrom,
        today,
        dto.retrospectiveReason,
      );
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid retrospectiveReason');
    }

    let expectedResumeAt: Date | null = null;
    if (dto.expectedResumeAt?.trim()) {
      try {
        expectedResumeAt = parseVisitPlanDateOnly(dto.expectedResumeAt, 'expectedResumeAt');
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : 'Invalid expectedResumeAt');
      }
      if (expectedResumeAt.getTime() < today.getTime()) {
        throw new BadRequestException('expectedResumeAt cannot be in the past');
      }
    }

    let suspensionReviewDueAt: Date;
    try {
      suspensionReviewDueAt = dto.reviewDueAt?.trim()
        ? parseVisitPlanDateOnly(dto.reviewDueAt, 'reviewDueAt')
        : defaultSuspensionReviewDueAt(today);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid reviewDueAt');
    }

    const roundNameByCode = await this.loadRoundNameMap();
    const result = await this.prisma.serviceUserVisitPlan.update({
      where: { id: planId },
      data: {
        status: VisitPlanStatus.SUSPENDED,
        suspendedAt: now,
        suspendedById: userId,
        pauseReasonCatalogId: pauseReason.id,
        expectedResumeAt,
        suspensionReviewDueAt,
        suspensionContingencyNotes: contingencyNotes,
        updatedById: userId,
      },
      include: planInclude,
    });
    await this.prisma.visitPlanStatusEvent.create({
      data: {
        visitPlanId: planId,
        eventType: VisitPlanStatusEventType.SUSPENDED,
        reason,
        pauseReasonCatalogId: pauseReason.id,
        expectedResumeAt,
        reviewDueAt: suspensionReviewDueAt,
        contingencyNotes,
        cancelFutureVisits,
        effectiveFrom,
        retrospectiveReason,
        createdById: userId,
      },
    });
    await this.prisma.visitPlanAmendment.create({
      data: {
        visitPlanId: planId,
        reason: `Suspended (${pauseReason.name}): ${reason}`,
        snapshotBefore: this.snapshot(plan, roundNameByCode) as Prisma.InputJsonValue,
        snapshotAfter: this.snapshot(result, roundNameByCode) as Prisma.InputJsonValue,
        amendedById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_VISIT_PLAN_SUSPENDED,
      recordType: 'ServiceUserVisitPlan',
      recordId: planId,
      metadata: {
        serviceUserId,
        reason,
        pauseReasonCode: pauseReason.code,
        expectedResumeAt: expectedResumeAt?.toISOString() ?? null,
        reviewDueAt: suspensionReviewDueAt.toISOString(),
        effectiveFrom: effectiveFrom.toISOString(),
        ...(retrospectiveReason ? { retrospectiveReason } : {}),
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    let scheduleImpact: ScheduleImpactResult | undefined;
    if (cancelFutureVisits) {
      scheduleImpact = await this.scheduleImpact.cancelServiceUserJobsInRange(
        userId,
        {
          serviceUserId,
          fromDate: effectiveFrom,
          toDate: null,
          reason: `Visit plan suspended: ${reason}`,
          source: 'visit_plan_suspend',
        },
        meta,
      );
    }

    return {
      message: 'Visit plan suspended',
      data: this.mapPlan(result, roundNameByCode),
      ...(scheduleImpact ? { scheduleImpact } : {}),
    };
  }

  async previewEndScheduleImpact(
    serviceUserId: string,
    planId: string,
    query: VisitPlanScheduleImpactPreviewQueryDto,
  ) {
    await this.getPlanOrThrow(serviceUserId, planId);
    let fromDate: Date;
    try {
      fromDate = parseVisitPlanDateOnly(query.fromDate, 'fromDate');
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid fromDate');
    }
    let toDate: Date | null = null;
    if (query.toDate?.trim()) {
      try {
        toDate = parseVisitPlanDateOnly(query.toDate, 'toDate');
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : 'Invalid toDate');
      }
    }
    const data = await this.scheduleImpact.previewCancelServiceUserJobsInRange({
      serviceUserId,
      fromDate,
      toDate,
    });
    return { data };
  }

  async previewSuspendScheduleImpact(
    serviceUserId: string,
    planId: string,
    query: VisitPlanScheduleImpactPreviewQueryDto,
  ) {
    return this.previewEndScheduleImpact(serviceUserId, planId, query);
  }

  async end(
    userId: string,
    serviceUserId: string,
    planId: string,
    dto: VisitPlanStatusChangeDto,
    meta?: RequestAuditMeta,
  ) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    if (plan.status === VisitPlanStatus.ENDED) {
      throw new BadRequestException('Visit plan is already ended');
    }

    const reason = dto.reason.trim();
    const cancelFutureVisits = dto.cancelFutureVisits !== false;
    const today = await this.opsTodayUtc();
    let effectiveTo: Date;
    try {
      effectiveTo = parseOptionalVisitPlanDateOnly(dto.effectiveTo, 'effectiveTo', today);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid effectiveTo');
    }

    let retrospectiveReason = '';
    try {
      retrospectiveReason = assertRetrospectiveReasonWhenBackdated(
        effectiveTo,
        today,
        dto.retrospectiveReason,
      );
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid retrospectiveReason');
    }

    const isScheduledEnd = isCalendarDateAfter(effectiveTo, today);
    const roundNameByCode = await this.loadRoundNameMap();

    const result = await this.prisma.serviceUserVisitPlan.update({
      where: { id: planId },
      data: isScheduledEnd
        ? {
            status: VisitPlanStatus.ACTIVE,
            effectiveTo,
            updatedById: userId,
            suspendedAt: null,
            suspendedById: null,
            pauseReasonCatalogId: null,
            expectedResumeAt: null,
            suspensionReviewDueAt: null,
            suspensionContingencyNotes: '',
          }
        : {
            status: VisitPlanStatus.ENDED,
            effectiveTo,
            updatedById: userId,
            suspendedAt: null,
            suspendedById: null,
            pauseReasonCatalogId: null,
            expectedResumeAt: null,
            suspensionReviewDueAt: null,
            suspensionContingencyNotes: '',
          },
      include: planInclude,
    });

    const eventType = isScheduledEnd
      ? VisitPlanStatusEventType.SCHEDULED_END
      : VisitPlanStatusEventType.ENDED;
    const amendmentPrefix = isScheduledEnd
      ? `Scheduled end (${effectiveTo.toISOString().slice(0, 10)})`
      : retrospectiveReason
        ? `Ended (${effectiveTo.toISOString().slice(0, 10)}, retrospective)`
        : 'Ended';

    await this.prisma.visitPlanStatusEvent.create({
      data: {
        visitPlanId: planId,
        eventType,
        reason,
        effectiveTo,
        retrospectiveReason,
        cancelFutureVisits,
        createdById: userId,
      },
    });
    await this.prisma.visitPlanAmendment.create({
      data: {
        visitPlanId: planId,
        reason: `${amendmentPrefix}: ${reason}`,
        snapshotBefore: this.snapshot(plan, roundNameByCode) as Prisma.InputJsonValue,
        snapshotAfter: this.snapshot(result, roundNameByCode) as Prisma.InputJsonValue,
        amendedById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_VISIT_PLAN_ENDED,
      recordType: 'ServiceUserVisitPlan',
      recordId: planId,
      metadata: {
        serviceUserId,
        reason,
        effectiveTo: effectiveTo.toISOString(),
        scheduledEnd: isScheduledEnd,
        ...(retrospectiveReason ? { retrospectiveReason } : {}),
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    let scheduleImpact: ScheduleImpactResult | undefined;
    if (cancelFutureVisits) {
      scheduleImpact = await this.scheduleImpact.cancelServiceUserJobsInRange(
        userId,
        {
          serviceUserId,
          fromDate: effectiveTo,
          toDate: null,
          reason: isScheduledEnd
            ? `Visit plan scheduled to end: ${reason}`
            : `Visit plan ended: ${reason}`,
          source: 'visit_plan_end',
        },
        meta,
      );
    }

    return {
      message: isScheduledEnd ? 'Visit plan scheduled to end' : 'Visit plan ended',
      data: this.mapPlan(result, roundNameByCode),
      ...(scheduleImpact ? { scheduleImpact } : {}),
    };
  }

  async prefillFromDomCare(userId: string, serviceUserId: string, planId: string, meta?: RequestAuditMeta) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const dom = await this.prisma.serviceUserDomCare.findUnique({ where: { serviceUserId } });
    return this.update(
      userId,
      serviceUserId,
      planId,
      {
        amendmentReason: 'Prefilled from domiciliary care profile',
        weeklyContractedHours: dom?.weeklyContractedHours ?? plan.weeklyContractedHours,
        numberOfCarers: dom?.numberOfCarers ?? plan.numberOfCarers,
      },
      meta,
    );
  }

  async createDraftFromAssessment(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const submission = await this.prisma.initialAssessmentSubmission.findFirst({
      where: { id: submissionId, serviceUserId, deletedAt: null },
      include: {
        answers: {
          include: { question: { select: { metadata: true } } },
        },
      },
    });
    if (!submission) throw new NotFoundException('Initial assessment submission not found');

    const existing = await this.prisma.serviceUserVisitPlan.findFirst({
      where: { serviceUserId, sourceSubmissionId: submissionId, deletedAt: null },
    });
    if (existing) {
      const full = await this.getPlanOrThrow(serviceUserId, existing.id);
      const roundNameByCode = await this.loadRoundNameMap();
      return { message: 'Visit plan already exists for this assessment', data: this.mapPlan(full, roundNameByCode) };
    }

    const rounds = await this.loadMedicationRoundCatalog();
    const preferred = submission.answers.find((a) =>
      isPreferredVisitTimesFieldKey(a.question.metadata as Prisma.JsonValue),
    );
    const dom = await this.prisma.serviceUserDomCare.findUnique({ where: { serviceUserId } });
    const weeklyContractedHours = dom?.weeklyContractedHours?.trim() ?? '';
    if (!weeklyContractedHours) {
      throw new BadRequestException(
        'Weekly contracted hours must be set on the DOM Care profile before a visit plan can be created',
      );
    }
    assertWeeklyContractedHoursForCreate(weeklyContractedHours);
    const numberOfCarers = dom?.numberOfCarers ?? 1;
    const slotSeeds = buildSlotsFromPreferredVisitTimes(
      preferred?.selectedOptions ?? null,
      numberOfCarers,
      rounds,
    );

    const reviewDueAt = new Date();
    reviewDueAt.setDate(reviewDueAt.getDate() + 42);

    return this.create(
      userId,
      serviceUserId,
      {
        sourceSubmissionId: submissionId,
        weeklyContractedHours,
        numberOfCarers,
        reviewDueAt: reviewDueAt.toISOString(),
        notes: 'Draft created from approved initial assessment',
        slots: slotSeeds.map((s) => ({
          slotCode: s.slotCode,
          daysOfWeek: s.daysOfWeek,
          plannedStartTime: s.plannedStartTime,
          plannedEndTime: s.plannedEndTime,
          requiredCarers: s.requiredCarers,
          isEnabled: s.isEnabled,
          medicationRoundCode: s.medicationRoundCode,
        })),
      },
      meta,
    );
  }

  async generateSchedule(
    userId: string,
    serviceUserId: string,
    planId: string,
    dto: GenerateVisitPlanScheduleDto,
    meta?: RequestAuditMeta,
    options?: {
      assignCarers?: boolean;
      /**
       * false = never bring back visits the office deleted (job or visit soft-deleted for that
       * slot/day). Used by the nightly rolling-rota catch-up; manual "Regenerate" keeps restoring.
       */
      restoreDeletedJobs?: boolean;
      /** Bulk generate and the rolling rota check the weekly hours themselves before calling this. */
      skipWeeklyHoursCheck?: boolean;
    },
  ) {
    const assignCarers = options?.assignCarers !== false;
    const restoreDeletedJobs = options?.restoreDeletedJobs !== false;
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    if (plan.status !== VisitPlanStatus.ACTIVE) {
      throw new BadRequestException('Only active visit plans can generate scheduled visits');
    }

    const from = this.parseDateOnly(dto.fromDate, 'fromDate');
    const to = this.parseDateOnly(dto.toDate, 'toDate');
    if (to.getTime() < from.getTime()) {
      throw new BadRequestException('toDate must be on or after fromDate');
    }
    const maxDays = 31;
    const dayMs = 86400000;
    if (to.getTime() - from.getTime() > maxDays * dayMs) {
      throw new BadRequestException(`Date range cannot exceed ${maxDays} days`);
    }

    const backfillDays = dto.backfillDays ?? 0;
    const backfillOnly = dto.backfillOnly === true;
    if (backfillOnly && backfillDays < 1) {
      throw new BadRequestException('backfillDays must be at least 1 when backfillOnly is true');
    }

    // Weekly contracted hours (Settings → Dom Rules, same rule as bulk generate): warn, or refuse
    // when generating by hand is set to skip plans over the hours. Past days are never counted.
    const weeklyHoursWarning = options?.skipWeeklyHoursCheck
      ? null
      : await this.weeklyHoursRunWarning(serviceUserId, plan.id, plan.weeklyContractedHours, dto);
    if (weeklyHoursWarning) {
      const { rules } = await this.weeklyHours.context();
      if (rules.bulkOverLimit !== 'WARN') {
        throw new BadRequestException(
          `This plan is ${weeklyHoursWarning}. No visits were generated (Settings → Dom Rules). Fix the visit plan or the weekly contracted hours first.`,
        );
      }
    }
    const clampToSlot = !backfillOnly;
    const rangeStart = new Date(from);
    if (backfillDays > 0) {
      rangeStart.setUTCDate(rangeStart.getUTCDate() - backfillDays);
    }
    const rangeEnd = backfillOnly ? new Date(from.getTime() - dayMs) : to;
    if (rangeEnd.getTime() < rangeStart.getTime()) {
      throw new BadRequestException('Backfill window is empty — increase backfillDays');
    }

    const enabledSlots = plan.slots.filter((s) => s.isEnabled);
    if (!enabledSlots.length) {
      throw new BadRequestException('No enabled visit slots on this plan');
    }

    // Carers with a PENDING over-contracted-hours approval must not be rostered
    // until a manager approves — strip them from the slots used for generation.
    if (assignCarers) {
      const pending = await this.hoursApprovals.pendingEmployeeIdsForPlan(planId);
      if (pending.size) {
        for (const s of enabledSlots) {
          s.assignedEmployeeIds = (s.assignedEmployeeIds ?? []).filter((id) => !pending.has(id));
          s.carerAssignments = (s.carerAssignments ?? []).filter(
            (a) => !pending.has(a.employeeId),
          );
        }
      }
    }

    if (dto.scheduleAreaId) {
      const area = await this.prisma.scheduleArea.findFirst({
        where: { id: dto.scheduleAreaId, deletedAt: null, isActive: true },
      });
      if (!area) throw new BadRequestException('Schedule area is invalid or inactive');
    }

    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId },
      include: { address: true },
    });
    const roundNameByCode = await this.loadRoundNameMap();
    const scheduledDueTimes = await loadScheduledMedicationDueTimes(
      this.prisma,
      serviceUserId,
    );

    let visitsCreated = 0;
    let visitsSkipped = 0;
    let visitsWithPatternWarnings = 0;
    const createdJobIds: string[] = [];
    const patternWarnings: string[] = [];
    let visitsWithRotaConflicts = 0;
    const rotaConflictWarnings: string[] = [];

    const respectWorkingPattern =
      dto.respectWorkingPatternOnSync ?? plan.respectWorkingPatternOnSync !== false;

    if (
      dto.respectWorkingPatternOnSync !== undefined &&
      dto.respectWorkingPatternOnSync !== plan.respectWorkingPatternOnSync
    ) {
      await this.prisma.serviceUserVisitPlan.update({
        where: { id: planId },
        data: { respectWorkingPatternOnSync: dto.respectWorkingPatternOnSync },
      });
    }

    const scheduleAnchor = plan.effectiveFrom;
    const planEffectiveTo = plan.effectiveTo;

    const timeZone = await this.orgSettings.getOperationalTimezone();

    await this.prisma.$transaction(async (tx) => {
      let patternByEmployee = new Map<string, EmployeePatternContext>();
      if (assignCarers) {
        const allEmployeeIds = [
          ...new Set(
            enabledSlots.flatMap((slot) => [
              ...slotAssignedEmployeeIds(slot),
              ...(slot.carerAssignments ?? []).map((a) => a.employeeId?.trim()).filter(Boolean),
            ]),
          ),
        ] as string[];
        patternByEmployee = await loadEmployeePatternContexts(tx, allEmployeeIds);
      }

      for (let t = rangeStart.getTime(); t <= rangeEnd.getTime(); t += dayMs) {
        const day = new Date(t);
        const dateStr = day.toISOString().slice(0, 10);
        const isBackfillDay = backfillOnly || t < from.getTime();

        // Bank holidays no longer suppress visit generation — home-care visits
        // still occur on bank holidays (holiday only affects carer pay banding).
        const absentOnDay = await tx.serviceUserAbsence.count({
          where: { serviceUserId, ...activeServiceUserAbsenceWhere(calendarDayUtcNoon(day)) },
        });
        if (absentOnDay > 0) continue;

        if (isBackfillDay) {
          const anySlotAllowsBackfill = enabledSlots.some((slot) => {
            const allowed = maxAllowedBackfillDays(slot.allowBackfillDays, backfillDays);
            if (allowed <= 0) return false;
            const slotStart = computeGenerationStart(from, backfillDays, slot.slotEffectiveFrom, {
              clampToSlotEffectiveFrom: clampToSlot,
            });
            return day.getTime() >= slotStart.getTime();
          });
          if (!anySlotAllowsBackfill) continue;
        }

        let batch = await tx.scheduleBatch.findFirst({
          where: { scheduleDate: day, deletedAt: null, isActive: true },
        });
        if (!batch) {
          batch = await tx.scheduleBatch.create({
            data: {
              scheduleDate: day,
              status: 'BUILDING',
              buildSource: 'MANUAL',
              metadata: { visitPlanId: planId, generated: true, backfillDays, backfillOnly } as Prisma.InputJsonValue,
              createdById: userId,
            },
          });
        }

        for (const slot of enabledSlots) {
          let extendBefore = 0;
          if (isBackfillDay) {
            const allowed = maxAllowedBackfillDays(slot.allowBackfillDays, backfillDays);
            if (allowed <= 0) continue;
            const slotStart = computeGenerationStart(from, backfillDays, slot.slotEffectiveFrom, {
              clampToSlotEffectiveFrom: clampToSlot,
            });
            if (day.getTime() < slotStart.getTime()) continue;
            extendBefore = allowed;
          }

          const occurrence = buildVisitPlanOccurrence(slot, day, scheduleAnchor, planEffectiveTo, {
            extendBeforeEffectiveFromDays: extendBefore,
            timeZone,
          });
          if (!occurrence) continue;

          const { start, end, requiredCarers, carerWindows, durationMinutes, isOvernight } = occurrence;

          const dayIso = day.toISOString().slice(0, 10);
          const { start: dayStart, end: dayEnd } = operationalDayBounds(dayIso, timeZone);
          const existingVisit = await tx.scheduledVisit.findFirst({
            where: {
              visitPlanSlotId: slot.id,
              deletedAt: null,
              scheduledStartDateTime: { gte: dayStart, lte: dayEnd },
            },
            orderBy: { scheduledStartDateTime: 'asc' },
          });
          if (!existingVisit && !restoreDeletedJobs) {
            const deletedVisit = await tx.scheduledVisit.findFirst({
              where: {
                visitPlanSlotId: slot.id,
                deletedAt: { not: null },
                scheduledStartDateTime: { gte: dayStart, lte: dayEnd },
              },
              select: { id: true },
            });
            if (deletedVisit) {
              visitsSkipped += 1;
              continue;
            }
          }
          if (existingVisit) {
            const liveJob = await tx.scheduledJob.findFirst({
              where: { id: existingVisit.scheduledJobId, deletedAt: null },
            });
            if (liveJob) {
              if (assignCarers) {
                const syncEmployeeIds = visitPlanCarerEmployeeIds(
                  carerWindows,
                  resolveGlobalAssignedEmployeeIds(slot.assignedEmployeeIds, slot.carerAssignments),
                  requiredCarers,
                );
                await syncVisitPlanSlotCarersToScheduledJobs(tx, {
                  visitPlanSlotId: slot.id,
                  assignedEmployeeIds: syncEmployeeIds,
                  carerAssignments: mapDbCarerAssignmentsForSync(slot.carerAssignments ?? []),
                  requiredCarers,
                  userId,
                  scheduledVisitId: existingVisit.id,
                  timeZone,
                  respectWorkingPattern,
                  carerWindows,
                });
                const resolved = await resolveVisitCarerAssignment(
                  tx,
                  syncEmployeeIds,
                  {
                    scheduledStartDateTime: existingVisit.scheduledStartDateTime,
                    scheduledEndDateTime: existingVisit.scheduledEndDateTime,
                    requiredCarers,
                  },
                  requiredCarers,
                  {
                    respectWorkingPattern,
                    patternByEmployee,
                    excludeScheduledJobId: liveJob.id,
                    timeZone,
                  },
                );
                if (resolved.patternWarnings.length) {
                  visitsWithPatternWarnings += 1;
                  patternWarnings.push(...resolved.patternWarnings);
                }
                if (resolved.rotaConflictWarnings.length) {
                  visitsWithRotaConflicts += 1;
                  rotaConflictWarnings.push(...resolved.rotaConflictWarnings);
                }
              }
              visitsSkipped += 1;
              continue;
            }
            if (!restoreDeletedJobs) {
              // The office deleted this job — leave it deleted.
              visitsSkipped += 1;
              continue;
            }

            const job = await tx.scheduledJob.create({
              data: {
                scheduleBatchId: batch.id,
                scheduleAreaId: dto.scheduleAreaId ?? null,
                serviceUserId,
                jobName: `${slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNameByCode)} — ${su?.preferredName ?? su?.firstName ?? 'Client'}`,
                scheduledStartDateTime: start,
                scheduledEndDateTime: end,
                estimatedDurationMinutes: durationMinutes,
                requiredCarers,
                status: ScheduledJobStatus.UNALLOCATED,
                postcode: su?.address?.postcode ?? null,
                address: su?.address
                  ? [
                      su.address.addressLine1,
                      su.address.addressLine2,
                      su.address.town,
                      su.address.postcode,
                    ]
                      .filter(Boolean)
                      .join(', ')
                  : null,
                metadata: visitPlanGeneratedJobMetadata({
                  visitPlanId: planId,
                  visitPlanSlotId: slot.id,
                  date: dateStr,
                  isOvernight,
                  nightDuty: resolveVisitPlanNightDuty(slot),
                }) as Prisma.InputJsonValue,
                createdById: userId,
              },
            });
            createdJobIds.push(job.id);
            await tx.scheduledVisit.update({
              where: { id: existingVisit.id },
              data: {
                scheduledJobId: job.id,
                scheduledEndDateTime: end,
                requiredCarers,
                status: ScheduledVisitStatus.PLANNED,
                updatedById: userId,
              },
            });
            if (assignCarers) {
              await syncVisitPlanSlotCarersToScheduledJobs(tx, {
                visitPlanSlotId: slot.id,
                assignedEmployeeIds: visitPlanCarerEmployeeIds(
                  carerWindows,
                  resolveGlobalAssignedEmployeeIds(slot.assignedEmployeeIds, slot.carerAssignments),
                  requiredCarers,
                ),
                carerAssignments: mapDbCarerAssignmentsForSync(slot.carerAssignments ?? []),
                requiredCarers,
                userId,
                scheduledVisitId: existingVisit.id,
                timeZone,
                respectWorkingPattern,
                carerWindows,
              });
            }
            visitsCreated += 1;
            continue;
          }

          const job = await tx.scheduledJob.create({
            data: {
              scheduleBatchId: batch.id,
              scheduleAreaId: dto.scheduleAreaId ?? null,
              serviceUserId,
              jobName: `${slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNameByCode)} — ${su?.preferredName ?? su?.firstName ?? 'Client'}`,
              scheduledStartDateTime: start,
              scheduledEndDateTime: end,
              estimatedDurationMinutes: durationMinutes,
              requiredCarers,
              status: ScheduledJobStatus.UNALLOCATED,
              postcode: su?.address?.postcode ?? null,
              address: su?.address
                ? [
                    su.address.addressLine1,
                    su.address.addressLine2,
                    su.address.town,
                    su.address.postcode,
                  ]
                    .filter(Boolean)
                    .join(', ')
                : null,
              metadata: visitPlanGeneratedJobMetadata({
                visitPlanId: planId,
                visitPlanSlotId: slot.id,
                date: dateStr,
                isOvernight,
                nightDuty: resolveVisitPlanNightDuty(slot),
              }) as Prisma.InputJsonValue,
              createdById: userId,
            },
          });
          createdJobIds.push(job.id);

          const visit = await tx.scheduledVisit.create({
            data: {
              scheduledJobId: job.id,
              serviceUserId,
              visitName: slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNameByCode),
              scheduledStartDateTime: start,
              scheduledEndDateTime: end,
              requiredCarers,
              status: ScheduledVisitStatus.PLANNED,
              medicationRequired: resolveMedicationRequiredForSlot({
                plannedStartTime: slot.plannedStartTime,
                plannedEndTime: slot.plannedEndTime,
                scheduledDueTimes,
              }),
              notesRequired: slot.notesRequired,
              photoRequired: slot.photoAllowed,
              visitPlanSlotId: slot.id,
              createdById: userId,
            },
          });

          if (assignCarers) {
            const globalCarerIds = resolveGlobalAssignedEmployeeIds(
              slot.assignedEmployeeIds,
              slot.carerAssignments,
            );
            let employeeIds = visitPlanCarerEmployeeIds(carerWindows, globalCarerIds, requiredCarers);
            if (!employeeIds.length) {
              employeeIds = globalCarerIds.slice(0, Math.max(1, requiredCarers));
            }
            const visitRow = {
              scheduledStartDateTime: start,
              scheduledEndDateTime: end,
              requiredCarers,
            };
            const resolved = await resolveVisitCarerAssignment(
              tx,
              employeeIds,
              visitRow,
              requiredCarers,
              {
                respectWorkingPattern,
                patternByEmployee,
                excludeScheduledJobId: job.id,
                timeZone,
              },
            );
            if (resolved.patternWarnings.length) {
              visitsWithPatternWarnings += 1;
              patternWarnings.push(...resolved.patternWarnings);
            }
            if (resolved.rotaConflictWarnings.length) {
              visitsWithRotaConflicts += 1;
              rotaConflictWarnings.push(...resolved.rotaConflictWarnings);
            }
            const windowByEmployee = new Map(
              carerWindows.map((c) => [c.employeeId, c] as const),
            );
            const allocations = resolved.employeeIds.map((employeeId, index) => {
              const carer = windowByEmployee.get(employeeId);
              return {
                employeeId,
                start: carer?.start ?? start,
                end: carer?.end ?? end,
                durationMinutes: carer?.durationMinutes ?? durationMinutes,
                isLeadCarer: carer?.isLeadCarer ?? index === 0,
              };
            });

            if (allocations.length > 0) {
              for (const carer of allocations) {
                await tx.jobAllocation.create({
                  data: {
                    scheduledJobId: job.id,
                    scheduledVisitId: visit.id,
                    employeeId: carer.employeeId,
                    status: AllocationStatus.CONFIRMED,
                    requiresConfirmation: false,
                    allocatedById: userId,
                    scheduledStartDateTime: carer.start,
                    scheduledEndDateTime: carer.end,
                    durationMinutes: carer.durationMinutes,
                    isLeadCarer: carer.isLeadCarer,
                  },
                });
              }
            }

            const allocatedCount = allocations.length;
            const jobStatus =
              allocatedCount >= requiredCarers
                ? ScheduledJobStatus.ALLOCATED
                : ScheduledJobStatus.NEEDS_ATTENTION;

            await tx.scheduledJob.update({
              where: { id: job.id },
              data: { status: jobStatus },
            });

            if (jobStatus === ScheduledJobStatus.NEEDS_ATTENTION) {
              await tx.scheduledVisit.update({
                where: { id: visit.id },
                data: { status: ScheduledVisitStatus.NEEDS_ATTENTION },
              });
            }
          }

          visitsCreated += 1;
        }
      }

      if (assignCarers) {
        for (const slot of enabledSlots) {
          const assignedEmployeeIds = visitPlanCarerEmployeeIds(
            [],
            resolveGlobalAssignedEmployeeIds(slot.assignedEmployeeIds, slot.carerAssignments),
            slot.requiredCarers,
          );
          if (!assignedEmployeeIds.length && !(slot.carerAssignments ?? []).length) continue;
          await syncVisitPlanSlotCarersToScheduledJobs(tx, {
            visitPlanSlotId: slot.id,
            assignedEmployeeIds,
            carerAssignments: mapDbCarerAssignmentsForSync(slot.carerAssignments ?? []),
            requiredCarers: slot.requiredCarers,
            userId,
            // rangeStart is a UTC-midnight calendar label — sync from org-local midnight.
            fromDateTime: operationalDayBounds(rangeStart.toISOString().slice(0, 10), timeZone).start,
            timeZone,
            respectWorkingPattern,
          });
        }
      }

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SERVICE_USER_VISIT_PLAN_SCHEDULE_GENERATED,
        recordType: 'ServiceUserVisitPlan',
        recordId: planId,
        metadata: {
          serviceUserId,
          fromDate: dto.fromDate,
          toDate: dto.toDate,
          backfillDays,
          visitsCreated,
          visitsSkipped,
          visitsWithPatternWarnings,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    }, {
      // Multi-slot + 2–4 carer ranges exceed Prisma's 5s interactive default.
      timeout: 120_000,
    });

    if (assignCarers) {
      await this.notifyCarersOfGeneratedRota(createdJobIds, serviceUserId);
    }

    return {
      message: 'Schedule generated from visit plan',
      data: {
        visitsCreated,
        visitsSkipped,
        visitsWithPatternWarnings,
        visitsWithRotaConflicts,
        patternWarnings: [...new Set(patternWarnings)],
        rotaConflictWarnings: [...new Set(rotaConflictWarnings)],
        fromDate: dto.fromDate,
        toDate: dto.toDate,
        backfillDays,
        ...(weeklyHoursWarning ? { weeklyHoursWarning: `This plan is ${weeklyHoursWarning}` } : {}),
      },
    };
  }

  /** Weeks of this run over the service user's weekly hours, in words (null when none). */
  private async weeklyHoursRunWarning(
    serviceUserId: string,
    planId: string,
    fallbackHours: string | null,
    dto: GenerateVisitPlanScheduleDto,
  ): Promise<string | null> {
    const over = await this.weeklyHours.overLimitWeeksForRange({
      serviceUserId,
      planId,
      fallbackHours,
      fromIso: dto.fromDate.slice(0, 10),
      toIso: dto.toDate.slice(0, 10),
    });
    return this.weeklyHours.describeOverLimit(over);
  }

  private async notifyCarersOfGeneratedRota(createdJobIds: string[], serviceUserId: string) {
    if (!this.carerPush || createdJobIds.length === 0) return;
    try {
      const timeZone = await this.orgSettings.getOperationalTimezone();
      const allocations = await this.prisma.jobAllocation.findMany({
        where: {
          scheduledJobId: { in: createdJobIds },
          deletedAt: null,
          isActive: true,
          status: {
            in: [
              AllocationStatus.PENDING_CONFIRMATION,
              AllocationStatus.ALLOCATED,
              AllocationStatus.CONFIRMED,
            ],
          },
        },
        select: {
          employeeId: true,
          scheduledJobId: true,
          scheduledStartDateTime: true,
          scheduledEndDateTime: true,
          scheduledJob: {
            select: {
              jobName: true,
              serviceUserId: true,
              scheduledStartDateTime: true,
              scheduledEndDateTime: true,
            },
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
      this.logger.warn(
        `Rota generate carer push failed for service user ${serviceUserId}: ${(err as Error).message}`,
      );
    }
  }

  async listCalendarVisits(
    serviceUserId: string,
    planId: string,
    query: VisitPlanCalendarVisitsQueryDto,
  ) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const from = this.parseDateOnly(query.from, 'from');
    const to = this.parseDateOnly(query.to, 'to');
    if (to.getTime() < from.getTime()) {
      throw new BadRequestException('to must be on or after from');
    }

    const slotIds = plan.slots.map((s) => s.id).filter(Boolean);
    if (!slotIds.length) {
      return { data: [] as ReturnType<ServiceUserVisitPlansService['mapCalendarVisit']>[] };
    }

    const timeZone = await this.orgSettings.getOperationalTimezone();
    const fromBound = operationalDayBounds(query.from, timeZone).start;
    const toBound = operationalDayBounds(query.to, timeZone).end;

    const rows = await this.prisma.scheduledVisit.findMany({
      where: {
        serviceUserId,
        visitPlanSlotId: { in: slotIds },
        deletedAt: null,
        isActive: true,
        scheduledStartDateTime: { gte: fromBound, lte: toBound },
      },
      orderBy: { scheduledStartDateTime: 'asc' },
      include: calendarVisitInclude,
    });

    return { data: rows.map((row) => this.mapCalendarVisit(row)) };
  }

  async recordCalendarOutcome(
    userId: string,
    serviceUserId: string,
    planId: string,
    dto: RecordVisitPlanCalendarOutcomeDto,
    meta?: RequestAuditMeta,
  ) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    const slot = plan.slots.find((s) => s.id === dto.visitPlanSlotId);
    if (!slot) throw new BadRequestException('Visit plan slot not found on this plan');
    if (!slot.isEnabled) throw new BadRequestException('Visit plan slot is not enabled');

    const day = this.parseDateOnly(dto.date, 'date');
    const scheduleAnchor = plan.effectiveFrom;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const occurrence = buildVisitPlanOccurrence(slot, day, scheduleAnchor, plan.effectiveTo, {
      timeZone,
    });
    if (!occurrence) {
      throw new BadRequestException('This visit is not scheduled on the selected date');
    }

    const roundNameByCode = await this.loadRoundNameMap();
    const scheduledDueTimes = await loadScheduledMedicationDueTimes(
      this.prisma,
      serviceUserId,
    );
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId },
      include: { address: true },
    });

    const { start, end, requiredCarers, carerWindows, durationMinutes, isOvernight } = occurrence;

    const result = await this.prisma.$transaction(async (tx) => {
      let visit = await tx.scheduledVisit.findFirst({
        where: {
          visitPlanSlotId: slot.id,
          deletedAt: null,
          scheduledStartDateTime: start,
        },
      });

      if (!visit) {
        const dateStr = dto.date;
        let batch = await tx.scheduleBatch.findFirst({
          where: { scheduleDate: day, deletedAt: null, isActive: true },
        });
        if (!batch) {
          batch = await tx.scheduleBatch.create({
            data: {
              scheduleDate: day,
              status: 'BUILDING',
              buildSource: 'MANUAL',
              metadata: { visitPlanId: planId, calendarOutcome: true } as Prisma.InputJsonValue,
              createdById: userId,
            },
          });
        }

        const job = await tx.scheduledJob.create({
          data: {
            scheduleBatchId: batch.id,
            serviceUserId,
            jobName: `${slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNameByCode)} — ${su?.preferredName ?? su?.firstName ?? 'Client'}`,
            scheduledStartDateTime: start,
            scheduledEndDateTime: end,
            estimatedDurationMinutes: durationMinutes,
            requiredCarers,
            status: ScheduledJobStatus.UNALLOCATED,
            postcode: su?.address?.postcode ?? null,
            address: su?.address
              ? [su.address.addressLine1, su.address.addressLine2, su.address.town, su.address.postcode]
                  .filter(Boolean)
                  .join(', ')
              : null,
            metadata: visitPlanGeneratedJobMetadata({
              visitPlanId: planId,
              visitPlanSlotId: slot.id,
              date: dateStr,
              isOvernight,
              nightDuty: resolveVisitPlanNightDuty(slot),
            }) as Prisma.InputJsonValue,
            createdById: userId,
          },
        });

        visit = await tx.scheduledVisit.create({
          data: {
            scheduledJobId: job.id,
            serviceUserId,
            visitName: slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNameByCode),
            scheduledStartDateTime: start,
            scheduledEndDateTime: end,
            requiredCarers,
            status: ScheduledVisitStatus.PLANNED,
            medicationRequired: resolveMedicationRequiredForSlot({
              plannedStartTime: slot.plannedStartTime,
              plannedEndTime: slot.plannedEndTime,
              scheduledDueTimes,
            }),
            notesRequired: slot.notesRequired,
            photoRequired: slot.photoAllowed,
            visitPlanSlotId: slot.id,
            createdById: userId,
          },
        });

        const toAllocate = carerWindows.length
          ? carerWindows
          : (slot.assignedEmployeeIds ?? []).slice(0, requiredCarers).map((employeeId, index) => ({
              employeeId,
              start,
              end,
              durationMinutes,
              isLeadCarer: index === 0,
            }));

        if (toAllocate.length > 0) {
          for (const carer of toAllocate) {
            await tx.jobAllocation.create({
              data: {
                scheduledJobId: job.id,
                scheduledVisitId: visit.id,
                employeeId: carer.employeeId,
                status: AllocationStatus.CONFIRMED,
                requiresConfirmation: false,
                allocatedById: userId,
                scheduledStartDateTime: carer.start,
                scheduledEndDateTime: carer.end,
                durationMinutes: carer.durationMinutes,
                isLeadCarer: carer.isLeadCarer,
              },
            });
          }
          await tx.scheduledJob.update({
            where: { id: job.id },
            data: {
              status:
                toAllocate.length >= requiredCarers
                  ? ScheduledJobStatus.ALLOCATED
                  : ScheduledJobStatus.NEEDS_ATTENTION,
            },
          });
        }
      }

      const { actualStart, actualEnd } = this.resolveActualVisitTimes(day, dto, timeZone);

      if (dto.status === ScheduledVisitStatus.COMPLETED) {
        if (!dto.employeeId) {
          throw new BadRequestException('Select the carer who attended when completing a visit');
        }
        if (!dto.actualStartTime || !dto.actualEndTime) {
          throw new BadRequestException('Actual start and end times are required when completing a visit');
        }
      }

      if (dto.employeeId) {
        await this.ensureVisitEmployeeAllocation(tx, userId, visit, dto.employeeId, slot.requiredCarers);
      }

      const updated = await tx.scheduledVisit.update({
        where: { id: visit.id },
        data: {
          status: dto.status as ScheduledVisitStatus,
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          ...(actualStart ? { actualStartDateTime: actualStart } : {}),
          ...(actualEnd ? { actualEndDateTime: actualEnd } : {}),
          updatedById: userId,
        },
      });

      await this.scheduledJobsService.syncJobStatusFromVisits(tx, updated.scheduledJobId, userId);

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULED_VISIT_STATUS_CHANGED,
        recordType: 'ScheduledVisit',
        recordId: updated.id,
        metadata: { visitPlanId: planId, visitPlanSlotId: slot.id, date: dto.date },
        newValues: auditSnapshot({
          status: updated.status,
          notes: updated.notes,
          actualStartDateTime: updated.actualStartDateTime,
          actualEndDateTime: updated.actualEndDateTime,
          employeeId: dto.employeeId,
        }),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      const enriched = await tx.scheduledVisit.findFirstOrThrow({
        where: { id: updated.id },
        include: calendarVisitInclude,
      });

      return { message: 'Visit outcome recorded', data: this.mapCalendarVisit(enriched) };
    });

    const visitId = (result.data as { id?: string }).id;
    if (visitId) {
      // The outcome is already saved. A failure here is kept as an open pay evaluation failure
      // for the office, with a retry (R-17).
      await this.visitReconciliationsService.ensureForVisitSafe(visitId);
    }

    return result;
  }

  private mapCalendarVisit(row: CalendarVisitRow) {
    const activeAllocations = row.scheduledJob.allocations.filter((a) =>
      CALENDAR_VISIT_ACTIVE_ALLOCATION.includes(a.status),
    );
    const allocatedCount = activeAllocations.length;
    const underAllocated = allocatedCount < row.requiredCarers;
    const jobNeedsAttention =
      row.scheduledJob.status === ScheduledJobStatus.NEEDS_ATTENTION ||
      row.scheduledJob.status === ScheduledJobStatus.UNALLOCATED ||
      underAllocated;

    let displayStatus: ScheduledVisitStatus = row.status;
    if (
      jobNeedsAttention &&
      (row.status === ScheduledVisitStatus.PLANNED || row.status === ScheduledVisitStatus.NEEDS_ATTENTION)
    ) {
      displayStatus = ScheduledVisitStatus.NEEDS_ATTENTION;
    }

    const jobMeta =
      row.scheduledJob.metadata &&
      typeof row.scheduledJob.metadata === 'object' &&
      !Array.isArray(row.scheduledJob.metadata)
        ? (row.scheduledJob.metadata as Record<string, unknown>)
        : {};
    const attendingEmployeeId =
      typeof jobMeta.visitPlanAttendingEmployeeId === 'string'
        ? jobMeta.visitPlanAttendingEmployeeId
        : activeAllocations[0]?.employeeId ?? null;

    return {
      id: row.id,
      visitPlanSlotId: row.visitPlanSlotId,
      status: row.status,
      displayStatus,
      jobStatus: row.scheduledJob.status,
      requiredCarers: row.requiredCarers,
      allocatedCount,
      allocatedEmployeeIds: activeAllocations.map((a) => a.employeeId),
      attendingEmployeeId,
      slotLabel: row.visitName,
      slotCode: row.visitPlanSlot?.slotCode ?? null,
      // Same rule as billing and the carer app: the slot's night type, else the job's (extra visits).
      nightDuty: resolveStoredNightDuty({
        slotNightDuty: row.visitPlanSlot?.nightDuty,
        jobMetadata: row.scheduledJob.metadata,
      }),
      linkedCarePlanFormIds: row.visitPlanSlot?.linkedCarePlanFormIds ?? [],
      notes: row.notes,
      scheduledStartDateTime: row.scheduledStartDateTime.toISOString(),
      scheduledEndDateTime: row.scheduledEndDateTime?.toISOString() ?? null,
      actualStartDateTime: row.actualStartDateTime?.toISOString() ?? null,
      actualEndDateTime: row.actualEndDateTime?.toISOString() ?? null,
      occurrenceDate: row.scheduledStartDateTime.toISOString().slice(0, 10),
    };
  }
}
