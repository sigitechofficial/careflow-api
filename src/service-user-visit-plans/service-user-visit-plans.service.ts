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
import {
  CARER_HOURS_CHECK_WEEKS,
  CARER_NO_CONTRACTED_HOURS_MESSAGE,
  CarerWeeklyHoursService,
  mondayOf,
} from '../employee-hours-approvals/carer-weekly-hours.service';
import { formatOrganisationIsoDate } from '../common/utils/organisation-display-format.util';
import { ScheduleLifecycleImpactService } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.service';
import {
  CANCELLABLE_JOB_STATUSES,
  type ScheduleImpactResult,
} from '../schedule-lifecycle-impact/schedule-lifecycle-impact.util';
import { isVisitPlanExtraJobMetadata } from './visit-plan-extra-visit.util';
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
  evaluateAllocationRuleHits,
  skillKeywordsForVisitPlanSlot,
  type AllocationRuleHit,
} from '../job-allocations/allocation-rule-hits.util';
import {
  allocationRuleBehavior,
  loadDomCareAllocationRules,
} from '../organisation-general-settings/dom-care-allocation-rules.util';
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
import {
  formatHoursMinutes,
  mondayOfIso,
  type ServiceUserVisitHoldPayload,
} from './visit-plan-weekly-hours.service';
import {
  PARENTAL_LEAVE_TYPES,
  ROTA_BLOCKING_LEAVE_TYPES,
} from '../employee-absences/dto/employee-absence.dto';
import { EmployeeHoursApprovalsService } from '../employee-hours-approvals/employee-hours-approvals.service';
import {
  hmMinutes,
  samePlanTime,
  type PendingPlanTimeChange,
} from '../employee-hours-approvals/carer-weekly-hours.service';
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
    private readonly carerHours: CarerWeeklyHoursService,
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

  /** Saved slots whose visits got longer than before the save (time and length, before → after). */
  private async longerVisitTimes(
    tx: Prisma.TransactionClient,
    before: Array<{
      id: string;
      slotCode: string;
      medicationRoundCode: string | null;
      plannedStartTime: string;
      plannedEndTime: string;
      durationMinutes: number | null;
      isEnabled: boolean;
      isActive: boolean;
    }>,
    roundNameByCode: Map<string, string>,
  ): Promise<PendingPlanTimeChange[]> {
    const minutesOf = (start: string, end: string, duration: number | null) => {
      if (duration != null && duration > 0) return duration;
      const diff = hmMinutes(end) - hmMinutes(start);
      return diff > 0 ? diff : diff + 24 * 60;
    };
    const ids = before.filter((b) => b.isEnabled && b.isActive).map((b) => b.id);
    if (!ids.length) return [];
    const after = await tx.visitPlanSlot.findMany({
      where: { id: { in: ids }, isEnabled: true, isActive: true },
      select: { id: true, plannedStartTime: true, plannedEndTime: true, durationMinutes: true },
    });
    const out: PendingPlanTimeChange[] = [];
    for (const a of after) {
      const b = before.find((x) => x.id === a.id)!;
      if (samePlanTime(a.plannedStartTime, b.plannedStartTime) && samePlanTime(a.plannedEndTime, b.plannedEndTime)) continue;
      const fromMinutes = minutesOf(b.plannedStartTime, b.plannedEndTime, b.durationMinutes);
      const toMinutes = minutesOf(a.plannedStartTime, a.plannedEndTime, a.durationMinutes);
      if (toMinutes <= fromMinutes) continue;
      out.push({
        slotId: a.id,
        slotLabel: slotLabel(b.medicationRoundCode ?? b.slotCode, roundNameByCode),
        fromStart: b.plannedStartTime.slice(0, 5),
        fromEnd: b.plannedEndTime.slice(0, 5),
        fromMinutes,
        fromDurationMinutes: b.durationMinutes,
        toStart: a.plannedStartTime.slice(0, 5),
        toEnd: a.plannedEndTime.slice(0, 5),
        toMinutes,
        toDurationMinutes: a.durationMinutes,
      });
    }
    return out;
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
    // Dated suggest (rota): judge compliance expiry on the visit date, not today.
    const visitDay = dto.scheduledDate ? new Date(`${dto.scheduledDate}T12:00:00.000Z`) : null;
    const complianceByEmployee = await this.allocationCompliance.evaluateForEmployees(
      employees.map((e) => e.id),
      visitDay && visitDay.getTime() > Date.now() ? visitDay : new Date(),
    );

    // Carers' weekly hours (Monday–Sunday) with the same count as the hours approvals: rota
    // visits (plan, extra, special), and plan visits on days without a rota yet. The visit being
    // chosen for is left out and added back as the proposed visit: a rota visit (scheduledDate)
    // counts in its own week; a plan visit in the busiest of the coming weeks.
    const timeZone = await this.orgSettings.getOperationalTimezone();

    // Settings → Allocation rules: "Don't allow" hides the carer from assign lists,
    // "Request confirmation" shows a warning. Dated rules need a concrete visit date.
    const allocationRules = await loadDomCareAllocationRules(this.prisma);
    let ruleHitsByEmployee = new Map<string, AllocationRuleHit[]>();
    if (dto.scheduledDate) {
      const window = visitPlanSuggestJobWindow(
        dto.scheduledDate,
        dto.plannedStartTime,
        dto.plannedEndTime,
        timeZone,
      );
      const visit = dto.excludeScheduledJobId
        ? await this.prisma.scheduledVisit.findFirst({
            where: { scheduledJobId: dto.excludeScheduledJobId, deletedAt: null },
            select: { medicationRequired: true, visitPlanSlotId: true },
          })
        : null;
      if (window) {
        ruleHitsByEmployee = await evaluateAllocationRuleHits(this.prisma, {
          employeeIds: employees.map((e) => e.id),
          jobStart: window.jobStart,
          jobEnd: window.jobEnd,
          rules: allocationRules,
          excludeScheduledJobId: dto.excludeScheduledJobId,
          medicationRequired: visit?.medicationRequired ?? false,
          skillKeywords: skillKeywords.length
            ? skillKeywords
            : await skillKeywordsForVisitPlanSlot(this.prisma, visit?.visitPlanSlotId),
          timeZone,
        });
      }
    }
    const patternBehavior = allocationRuleBehavior(allocationRules, 'job_outside_working_pattern');
    const skillsBehavior = allocationRuleBehavior(allocationRules, 'missing_client_skills');

    const proposedPerDayMinutes = deriveDurationFromTimes(
      dto.plannedStartTime,
      dto.plannedEndTime,
    );
    const todayIso = dayKeyInTimeZone(new Date(), timeZone);
    const proposedByWeek = new Map<string, number>();
    if (dto.scheduledDate) {
      proposedByWeek.set(mondayOf(dto.scheduledDate), proposedPerDayMinutes);
    } else {
      const days = new Set(slotDays);
      for (let w = 0; w < CARER_HOURS_CHECK_WEEKS; w += 1) {
        const weekStart = addDaysToOperationalIso(mondayOf(todayIso), w * 7);
        let minutes = 0;
        for (let d = 0; d < 7; d += 1) {
          const day = addDaysToOperationalIso(weekStart, d);
          if (day < todayIso) continue;
          if (days.has(new Date(`${day}T12:00:00Z`).getUTCDay())) minutes += proposedPerDayMinutes;
        }
        proposedByWeek.set(weekStart, minutes);
      }
    }
    const editedSlotIds = dto.scheduledDate
      ? []
      : (
          await this.prisma.visitPlanSlot.findMany({
            where: {
              slotCode: dto.slotCode,
              isActive: true,
              visitPlan: { serviceUserId, deletedAt: null },
            },
            select: { id: true },
          })
        ).map((row) => row.id);
    const hoursByEmployee = await this.carerHours.countMany(
      this.prisma,
      employees.map((e) => e.id),
      {
        weekStarts: [...proposedByWeek.keys()],
        excludeSlotIds: editedSlotIds,
        excludeScheduledJobIds: dto.excludeScheduledJobId ? [dto.excludeScheduledJobId] : [],
      },
    );
    /**
     * The week shown for a carer: the one furthest over its own limit (contracted + extra weekly
     * hours for that week) with this visit added; the busiest when the carer has no limit.
     */
    const pickerWeek = (employeeId: string) => {
      const count = hoursByEmployee.get(employeeId);
      let best: {
        weekStart: string;
        existing: number;
        withVisit: number;
        limitMinutes: number | null;
        extraMinutes: number;
        margin: number;
      } | null = null;
      for (const week of count?.weeks ?? []) {
        const withVisit = week.minutes + (proposedByWeek.get(week.weekStart) ?? 0);
        const margin = withVisit - (week.limitMinutes ?? 0);
        if (!best || margin > best.margin) {
          best = {
            weekStart: week.weekStart,
            existing: week.minutes,
            withVisit,
            limitMinutes: week.limitMinutes,
            extraMinutes: week.extraMinutes,
            margin,
          };
        }
      }
      return { ...best, graceMinutes: count?.graceMinutes ?? 0 };
    };
    const display = await this.orgSettings.getOperationalDisplaySettings();
    const completedMinutesByEmployee = await this.completedMinutesThisWeek(
      employees.map((e) => e.id),
    );

    // Upcoming time off (leave / holiday) so the picker can flag a carer who is off for
    // some of the plan's visits. Uses the same leave types the allocation engine recognises;
    // `blocks` reflects whether the org's allocation rule for that type is "Don't allow".
    const timeOffEmployeeIds = employees.map((e) => e.id);
    const leaveBlocks = allocationRuleBehavior(allocationRules, 'carer_on_leave') === 'DONT_ALLOW';
    const holidayBlocks = allocationRuleBehavior(allocationRules, 'carer_on_holiday') === 'DONT_ALLOW';
    const timeOffWindowStart = new Date();
    const timeOffWindowEnd = new Date(timeOffWindowStart.getTime() + 56 * 24 * 60 * 60 * 1000);
    const [absenceRows, holidayRows] = await Promise.all([
      this.prisma.employeeAbsenceRecord.findMany({
        where: {
          employeeId: { in: timeOffEmployeeIds },
          deletedAt: null,
          isActive: true,
          fromDateTime: { lte: timeOffWindowEnd },
          toDateTime: { gte: timeOffWindowStart },
          OR: [
            { absenceType: { in: [...ROTA_BLOCKING_LEAVE_TYPES] } },
            { absenceType: { in: [...PARENTAL_LEAVE_TYPES] }, permissionStatus: 'Authorised' },
          ],
        },
        select: { employeeId: true, absenceType: true, fromDateTime: true, toDateTime: true },
        orderBy: { fromDateTime: 'asc' },
      }),
      this.prisma.employeeHoliday.findMany({
        where: {
          employeeId: { in: timeOffEmployeeIds },
          deletedAt: null,
          isActive: true,
          startDate: { lte: timeOffWindowEnd },
          endDate: { gte: timeOffWindowStart },
        },
        select: { employeeId: true, startDate: true, endDate: true },
        orderBy: { startDate: 'asc' },
      }),
    ]);
    const leaveLabel = (type: string) =>
      type === 'Sickness'
        ? 'sick leave'
        : type === 'Casual leave'
          ? 'casual leave'
          : `${type.toLowerCase()} leave`;
    const timeOffByEmployee = new Map<
      string,
      { kind: 'leave' | 'holiday'; label: string; from: Date; to: Date; blocks: boolean }
    >();
    const considerTimeOff = (
      employeeId: string,
      entry: { kind: 'leave' | 'holiday'; label: string; from: Date; to: Date; blocks: boolean },
    ) => {
      const existing = timeOffByEmployee.get(employeeId);
      // Keep the earliest-starting time off for this carer.
      if (!existing || entry.from < existing.from) timeOffByEmployee.set(employeeId, entry);
    };
    for (const r of absenceRows) {
      considerTimeOff(r.employeeId, {
        kind: 'leave',
        label: leaveLabel(r.absenceType),
        from: r.fromDateTime,
        to: r.toDateTime,
        blocks: leaveBlocks,
      });
    }
    for (const r of holidayRows) {
      considerTimeOff(r.employeeId, {
        kind: 'holiday',
        label: 'holiday',
        from: r.startDate,
        to: r.endDate,
        blocks: holidayBlocks,
      });
    }

    // Carers on authorised maternity / paternity leave are hidden from assign lists (rule-blocked).
    // Dated suggest checks the visit day; the visit-plan picker checks the next 8 weeks.
    const parentalWindowStart = dto.scheduledDate
      ? new Date(`${dto.scheduledDate}T00:00:00.000Z`)
      : timeOffWindowStart;
    const parentalWindowEnd = dto.scheduledDate
      ? new Date(`${dto.scheduledDate}T23:59:59.999Z`)
      : timeOffWindowEnd;
    const parentalLeaveRows = await this.prisma.employeeAbsenceRecord.findMany({
      where: {
        employeeId: { in: timeOffEmployeeIds },
        deletedAt: null,
        isActive: true,
        absenceType: { in: [...PARENTAL_LEAVE_TYPES] },
        permissionStatus: 'Authorised',
        fromDateTime: { lte: parentalWindowEnd },
        toDateTime: { gte: parentalWindowStart },
      },
      select: { employeeId: true, absenceType: true, fromDateTime: true, toDateTime: true },
      orderBy: { fromDateTime: 'asc' },
    });
    const parentalLeaveByEmployee = new Map<string, (typeof parentalLeaveRows)[number]>();
    for (const r of parentalLeaveRows) {
      if (!parentalLeaveByEmployee.has(r.employeeId)) parentalLeaveByEmployee.set(r.employeeId, r);
    }

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

      // Weekly-hours flag: that week with this visit goes over the carer's contracted weekly
      // hours (+ grace in Settings → Dom Rules) — the same rule as the hours approvals.
      const contractedWeeklyHours = emp.employment?.contractedWeeklyHours ?? null;
      const week = pickerWeek(emp.id);
      const assignedWeeklyHours = Math.round(((week.existing ?? 0) / 60) * 10) / 10;
      const projectedWeeklyHours = Math.round(((week.withVisit ?? 0) / 60) * 10) / 10;
      const weeklyHoursWeekStart = week.weekStart ?? null;
      // That week's limit: contracted + extra weekly hours given for it.
      const weekLimitMinutes =
        week.limitMinutes ??
        (contractedWeeklyHours != null && contractedWeeklyHours > 0
          ? Math.round(contractedWeeklyHours * 60)
          : null);
      const allowedWeeklyHours =
        weekLimitMinutes != null ? Math.round((weekLimitMinutes / 60) * 10) / 10 : contractedWeeklyHours;
      const exceedsContractedHours =
        weekLimitMinutes != null && (week.withVisit ?? 0) > weekLimitMinutes + week.graceMinutes;
      if (exceedsContractedHours) {
        const weekLimitHours = Math.round((weekLimitMinutes / 60) * 10) / 10;
        const extraNote = week.extraMinutes
          ? ` incl. ${Math.round((week.extraMinutes / 60) * 10) / 10}h extra`
          : '';
        warnings.push(
          `Exceeds weekly hours (~${projectedWeeklyHours}h of ${weekLimitHours}h${extraNote}${
            weeklyHoursWeekStart
              ? `, week of ${formatOrganisationIsoDate(weeklyHoursWeekStart, display.dateDisplayFormat)}`
              : ''
          })`,
        );
      }

      const ruleHits = [...(ruleHitsByEmployee.get(emp.id) ?? [])];
      // Pattern warnings are already shown via `availability`; only a block is added here.
      if (
        patternBehavior === 'DONT_ALLOW' &&
        (availability.unavailableDays.length > 0 || !availability.timeWindowOk)
      ) {
        ruleHits.push({
          key: 'job_outside_working_pattern',
          message: availability.summary || 'Visit is outside working pattern',
          block: true,
        });
      }
      if (!dto.scheduledDate && skills.missing.length && skillsBehavior === 'DONT_ALLOW') {
        ruleHits.push({
          key: 'missing_client_skills',
          message: `Missing skills: ${skills.missing.join(', ')}`,
          block: true,
        });
      }
      const parentalLeave = parentalLeaveByEmployee.get(emp.id);
      if (parentalLeave && !ruleHits.some((h) => h.key === 'carer_on_leave' && h.block)) {
        const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        ruleHits.push({
          key: 'carer_on_leave',
          message: `On ${parentalLeave.absenceType.toLowerCase()} leave ${fmt(parentalLeave.fromDateTime)} – ${fmt(parentalLeave.toDateTime)}`,
          block: true,
        });
      }
      const ruleBlockReasons = ruleHits.filter((h) => h.block).map((h) => h.message);
      // No contracted weekly hours: the carer can't be given visits until hours are set.
      const noContractedHours = contractedWeeklyHours == null || contractedWeeklyHours <= 0;
      if (noContractedHours) ruleBlockReasons.push(CARER_NO_CONTRACTED_HOURS_MESSAGE);
      const ruleBlocked = ruleBlockReasons.length > 0;
      for (const hit of ruleHits) {
        if (!hit.block && !warnings.includes(hit.message)) warnings.push(hit.message);
      }

      const fit = ruleBlocked ? 'poor' : carerFitScore({
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
        weeklyHoursWeekStart,
        completedWeeklyHours:
          Math.round(((completedMinutesByEmployee.get(emp.id) ?? 0) / 60) * 10) / 10,
        projectedWeeklyHours,
        exceedsContractedHours,
        noContractedHours,
        ruleBlocked,
        ruleBlockReasons,
        timeOff: timeOffByEmployee.get(emp.id) ?? null,
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
    // An active plan is counted from its visits on the rota; a draft or suspended one from its rows.
    const summary = await this.weeklyHours.weeks(
      this.prisma,
      serviceUserId,
      plan.status === VisitPlanStatus.ACTIVE ? undefined : { planFromRows: planId },
    );
    const limit = await this.weeklyHours.limit(this.prisma, serviceUserId, plan.weeklyContractedHours);
    const timebank = await this.weeklyHours.timebankBudget(serviceUserId);
    return { data: this.weeklyHours.withLimit(summary, limit, context.rules.visitsNeedApproval, timebank) };
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
    const result: { summary?: Awaited<ReturnType<VisitPlanWeeklyHoursService['weeks']>> } = {};
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const slot of this.normalizeSlots(slots, rounds)) {
          await this.upsertPlanSlot(tx, planId, slot);
        }
        result.summary = await this.weeklyHours.weeks(tx, serviceUserId, { planFromRows: planId });
        throw new WeeklyHoursPreviewRollback();
      });
    } catch (e) {
      if (!(e instanceof WeeklyHoursPreviewRollback)) throw e;
    }
    void plan;
    const timebank = await this.weeklyHours.timebankBudget(serviceUserId);
    return { data: this.weeklyHours.withLimit(result.summary!, limit, context.rules.visitsNeedApproval, timebank) };
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
      // Carers over their contracted weekly hours need a manager's approval (every visit is new).
      await this.hoursApprovals.reconcileForPlan(userId, serviceUserId, plan.id, tx, {
        previousVisits: new Map(),
      });
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
    // Carers' visits before the save: new ones in a week already over their hours need approval.
    const carerVisitsBefore = dto.slots?.length
      ? await this.hoursApprovals.planVisitsByCarer(planId)
      : undefined;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    // Longer visits that keep their old time until a manager approves the new one.
    const heldTimeSlotIds = new Set<string>();
    const heldTimeChanges: PendingPlanTimeChange[] = [];
    const carerHoursWarnings: string[] = [];

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
        // Carers over their contracted weekly hours need a manager's approval; until then the
        // sync below leaves them off the visits that go over, and a visit made longer keeps its
        // old time.
        const timeChanges = await this.longerVisitTimes(tx, existing.slots, roundNameByCode);
        await this.hoursApprovals.reconcileForPlan(userId, serviceUserId, planId, tx, {
          previousVisits: carerVisitsBefore,
          timeChanges,
          heldTimeSlotIds,
          warnings: carerHoursWarnings,
        });
        for (const c of timeChanges.filter((t) => heldTimeSlotIds.has(t.slotId))) {
          heldTimeChanges.push(c);
          await tx.visitPlanSlot.update({
            where: { id: c.slotId },
            data: { plannedStartTime: c.fromStart, plannedEndTime: c.fromEnd, durationMinutes: c.fromDurationMinutes ?? null },
          });
        }
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
    let scheduleImpact: ScheduleImpactResult | undefined;
    let longerVisitsMessage: string | null = null;
    if (existing.status === VisitPlanStatus.ACTIVE && dto.applyScheduleImpact) {
      // Service user weekly hours: longer rota visits over the hours keep their old time until approved.
      const longer = dto.slots?.length
        ? await this.holdLongerPlanVisits(userId, serviceUserId, existing, existing.slots, updated.slots, roundNameByCode)
        : { keepOldTime: new Set<string>(), message: null, timebank: [] };
      longerVisitsMessage = longer.message;
      scheduleImpact = await this.amendmentImpact.applyAmendmentImpact(userId, {
        serviceUserId,
        amendmentReason: dto.amendmentReason.trim(),
        before: snapshotBefore,
        after: snapshotAfter,
        keepOldTime: longer.keepOldTime,
      }, meta);
      // Longer visits whose hours over the weekly hours the timebank pays for (same rota jobs, new time).
      await this.weeklyHours.reserveTimebank(this.prisma, longer.timebank);
    }

    return {
      message: [
        heldTimeChanges.length
          ? `Visit plan updated. ${heldTimeChanges
              .map((c) => `${c.slotLabel} ${c.fromStart}–${c.fromEnd} → ${c.toStart}–${c.toEnd}`)
              .join(', ')}: a carer goes over their weekly hours — the visit keeps its current time until a manager approves (Hours approvals)`
          : 'Visit plan updated',
        // Settings → Dom Rules: carers over their weekly hours are assigned with a warning.
        ...carerHoursWarnings.map((w) => `Warning: ${w}.`),
        ...(longerVisitsMessage ? [longerVisitsMessage] : []),
      ].join(' '),
      data: this.mapPlan(updated, roundNameByCode),
      ...(heldTimeChanges.length ? { heldTimeChanges } : {}),
      ...(scheduleImpact ? { scheduleImpact } : {}),
      // Only data / meta / message reach the client (response interceptor), so the admin reads these from meta.
      meta: {
        ...(heldTimeChanges.length ? { heldTimeChanges } : {}),
        ...(scheduleImpact ? { scheduleImpact } : {}),
        ...(carerHoursWarnings.length ? { carerHoursWarnings } : {}),
      },
    };
  }

  /**
   * A plan amendment made visits longer (Settings → Dom Rules "Visits over the weekly hours need
   * approval"): rota visits whose week would go over the service user's weekly hours keep their old
   * time — one request for the whole amendment on Hours approvals; the rest move to the new time.
   * Weeks are taken in time order. Without approval they all move, with a warning.
   */
  private async holdLongerPlanVisits(
    userId: string,
    serviceUserId: string,
    plan: { id: string; weeklyContractedHours: string | null },
    before: Array<{ id: string; plannedStartTime: string; plannedEndTime: string; durationMinutes: number | null; isEnabled: boolean }>,
    after: Array<{
      id: string;
      slotCode: string;
      medicationRoundCode: string | null;
      plannedStartTime: string;
      plannedEndTime: string;
      durationMinutes: number | null;
      isEnabled: boolean;
    }>,
    roundNameByCode: Map<string, string>,
  ): Promise<{
    keepOldTime: Set<string>;
    message: string | null;
    timebank: Parameters<VisitPlanWeeklyHoursService['reserveTimebank']>[1];
  }> {
    const keepOldTime = new Set<string>();
    const timebank: Parameters<VisitPlanWeeklyHoursService['reserveTimebank']>[1] = [];
    const limit = await this.weeklyHours.limit(this.prisma, serviceUserId, plan.weeklyContractedHours);
    if (limit == null) return { keepOldTime, message: null, timebank };
    const minutesOf = (start: string, end: string, duration: number | null) => {
      if (duration != null && duration > 0) return duration;
      const diff = hmMinutes(end) - hmMinutes(start);
      return diff > 0 ? diff : diff + 24 * 60;
    };
    const changes = after
      .filter((a) => a.isEnabled)
      .flatMap((a) => {
        const b = before.find((x) => x.id === a.id);
        if (!b || !b.isEnabled) return [];
        if (samePlanTime(a.plannedStartTime, b.plannedStartTime) && samePlanTime(a.plannedEndTime, b.plannedEndTime)) {
          return [];
        }
        const fromMinutes = minutesOf(b.plannedStartTime, b.plannedEndTime, b.durationMinutes);
        const toMinutes = minutesOf(a.plannedStartTime, a.plannedEndTime, a.durationMinutes);
        if (toMinutes <= fromMinutes) return [];
        return [
          {
            slotId: a.id,
            slotLabel: slotLabel(a.medicationRoundCode ?? a.slotCode, roundNameByCode),
            fromStart: b.plannedStartTime.slice(0, 5),
            fromEnd: b.plannedEndTime.slice(0, 5),
            toStart: a.plannedStartTime.slice(0, 5),
            toEnd: a.plannedEndTime.slice(0, 5),
            extraMinutes: toMinutes - fromMinutes,
          },
        ];
      });
    if (!changes.length) return { keepOldTime, message: null, timebank };
    const ctx = await this.weeklyHours.context();
    const budget = await this.weeklyHours.timebankBudget(serviceUserId);
    const { edge } = await this.weeklyHours.window(ctx.timeZone);
    const bySlot = new Map(changes.map((c) => [c.slotId, c]));
    const jobs = (
      await this.prisma.scheduledJob.findMany({
        where: {
          serviceUserId,
          deletedAt: null,
          status: { in: CANCELLABLE_JOB_STATUSES },
          scheduledStartDateTime: { gt: new Date() },
        },
        select: { id: true, scheduledStartDateTime: true, requiredCarers: true, metadata: true },
        orderBy: { scheduledStartDateTime: 'asc' },
      })
    ).filter((j) => {
      const slotId = (j.metadata as { visitPlanSlotId?: string } | null)?.visitPlanSlotId;
      return Boolean(slotId && bySlot.has(slotId)) && !isVisitPlanExtraJobMetadata(j.metadata);
    });
    const limitMinutes = Math.round(limit * 60);
    const weekTotals = new Map<string, number>();
    const overWeeks = new Map<string, number>();
    const held: Array<{ jobId: string; slotId: string; date: string; startsAt: string; minutes: number }> = [];
    for (const job of jobs) {
      const date = dayKeyInTimeZone(job.scheduledStartDateTime, ctx.timeZone);
      if (date > edge) continue;
      const change = bySlot.get((job.metadata as { visitPlanSlotId: string }).visitPlanSlotId)!;
      const weekStart = mondayOfIso(date);
      if (!weekTotals.has(weekStart)) {
        weekTotals.set(weekStart, (await this.weeklyHours.weekMinutes(this.prisma, serviceUserId, date)).minutes);
      }
      const delta = change.extraMinutes * Math.max(1, job.requiredCarers ?? 1);
      const before = weekTotals.get(weekStart)!;
      const total = before + delta;
      const room = limitMinutes + budget.reservedIn(weekStart);
      if (total > room && budget.cover(weekStart, total - Math.max(before, room))) {
        timebank.push({
          serviceUserId,
          scheduledJobId: job.id,
          weekStart,
          minutes: total - Math.max(before, room),
          reason: 'LONGER_VISIT',
          note: 'Plan visit made longer, over the weekly hours',
          userId,
        });
        weekTotals.set(weekStart, total);
        continue;
      }
      if (total > room && ctx.rules.visitsNeedApproval) {
        keepOldTime.add(`${change.slotId}|${job.scheduledStartDateTime.toISOString()}`);
        held.push({ jobId: job.id, slotId: change.slotId, date, startsAt: job.scheduledStartDateTime.toISOString(), minutes: delta });
        overWeeks.set(weekStart, Math.max(overWeeks.get(weekStart) ?? 0, total));
        continue;
      }
      if (total > room) overWeeks.set(weekStart, total);
      weekTotals.set(weekStart, total);
    }
    const timebankText = timebank.length
      ? `${formatHoursMinutes(timebank.reduce((s, t) => s + t.minutes, 0))} over the weekly hours taken from the timebank.`
      : null;
    if (!overWeeks.size) return { keepOldTime, message: timebankText, timebank };
    const weeksText = [...overWeeks]
      .map(([week, minutes]) => `week of ${formatOrganisationIsoDate(week, ctx.dateDisplayFormat)}: ${formatHoursMinutes(minutes)}`)
      .join('; ');
    const limitText = formatHoursMinutes(limitMinutes);
    if (!held.length) {
      return {
        keepOldTime,
        message: [timebankText, `Warning: over the weekly contracted hours (${limitText}) — ${weeksText}.`]
          .filter(Boolean)
          .join(' '),
        timebank,
      };
    }
    const first = held[0];
    const last = held[held.length - 1];
    const firstChange = bySlot.get(first.slotId)!;
    const [busiestWeek] = [...overWeeks].reduce((a, b) => (b[1] > a[1] ? b : a));
    const approvalId = await this.weeklyHours.holdVisit(this.prisma, {
      userId,
      serviceUserId,
      visitPlanId: plan.id,
      reason: 'Visit plan amendment: longer visits over the weekly hours',
      payload: {
        kind: 'PLAN_TIME',
        date: first.date,
        // Expires once the last held visit has started.
        startsAt: last.startsAt,
        endsAt: last.startsAt,
        startTime: firstChange.toStart,
        endTime: firstChange.toEnd,
        durationMinutes: firstChange.extraMinutes,
        requiredCarers: 1,
        slotLabel: changes.map((c) => c.slotLabel).join(', '),
        weekStart: mondayOfIso(first.date),
        weekMinutes: Math.max(...overWeeks.values()),
        limitWeeklyHours: limit,
        timebankMinutes: budget.reservedIn(busiestWeek),
        fromStartTime: firstChange.fromStart,
        fromEndTime: firstChange.fromEnd,
        heldDeltas: held.map((h) => ({ date: h.date, minutes: h.minutes })),
        planTimeChange: { planId: plan.id, changes, held },
      },
    });
    void this.hoursApprovals.notifyServiceUserVisitsHeld({ serviceUserId, approvalIds: [approvalId], requestedById: userId });
    return {
      keepOldTime,
      message: [
        timebankText,
        `${held.length} visit${held.length === 1 ? '' : 's'} made longer would go over the weekly contracted hours (${limitText}) — ${weeksText}. They keep their current time until a manager approves (Hours approvals).`,
      ]
        .filter(Boolean)
        .join(' '),
      timebank,
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
    // Shown before confirming: weeks of this run over the weekly hours (visits are never refused as a whole).
    const weeklyHours = await this.weeklyHoursRunWarning(
      serviceUserId,
      plan.id,
      plan.weeklyContractedHours,
      dto,
    );
    return {
      data: {
        ...preview,
        weeklyHoursWarning: weeklyHours.warning,
        weeklyHoursTimebank: weeklyHours.timebank,
        weeklyHoursBlocked: false,
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

    const activationWarnings: string[] = [];
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
      // A draft was not checked for carers' weekly hours: check now (every visit is new). A carer
      // with no contracted hours, or above their maximum when not allowed, stops the activation;
      // visits over the hours wait for a manager when Settings → Dom Rules asks for approval.
      if (!wasSuspended) {
        await this.hoursApprovals.reconcileForPlan(userId, serviceUserId, planId, tx, {
          previousVisits: new Map(),
          warnings: activationWarnings,
        });
      }
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
      message: [
        wasSuspended ? 'Visit plan re-activated' : 'Visit plan activated',
        ...activationWarnings.map((w) => `Warning: ${w}.`),
      ].join(' '),
      data: this.mapPlan(result, roundNameByCode),
      ...(scheduleImpact ? { scheduleImpact } : {}),
      // Only data / meta / message reach the client (response interceptor).
      meta: scheduleImpact ? { scheduleImpact } : {},
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
      // Only data / meta / message reach the client (response interceptor).
      meta: scheduleImpact ? { scheduleImpact } : {},
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
      // Only data / meta / message reach the client (response interceptor).
      meta: scheduleImpact ? { scheduleImpact } : {},
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
      /**
       * Visits held over the service user's weekly hours that may be made now ("slotId|YYYY-MM-DD"):
       * a manager approved them. They are made without a second hours check.
       */
      allowHeldKeys?: Set<string>;
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

    // Service user weekly hours (Settings → Dom Rules): from today on, a visit that takes its week
    // over the hours is held for a manager (not made) or made with a warning. Visits already held
    // or rejected are never made here; approving one makes it through `allowHeldKeys`.
    const hoursCtx = await this.weeklyHours.context();
    const hoursLimit = await this.weeklyHours.limit(this.prisma, serviceUserId, plan.weeklyContractedHours);
    const heldKeys = await this.weeklyHours.heldPlanVisits(this.prisma, planId);
    // Timebank (docs/SU_TIMEBANK_USE_PLAN.md): a week also has the minutes visits hold from the bank;
    // when the setting is on, the bank pays for a visit's hours over if it has all of them.
    const timebank = await this.weeklyHours.timebankBudget(serviceUserId);
    /** "slotId|YYYY-MM-DD" → bank minutes to reserve once the visit's job is made. */
    const timebankByKey = new Map<string, { weekStart: string; minutes: number }>();
    /** Week → bank minutes reserved by this run (for the result message). */
    const timebankUsed = new Map<string, number>();
    const hoursToday = dayKeyInTimeZone(new Date(), hoursCtx.timeZone);
    const weekTotals = new Map<string, number>();
    const overWeeks = new Map<string, number>();
    const heldApprovalIds: string[] = [];
    let visitsHeld = 0;
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

    // Carers over their contracted weekly hours stay off the visits a manager has not approved
    // yet ("employeeId|slotId|date"); the count is refreshed first as the weeks move on.
    const withheld = assignCarers
      ? (await this.hoursApprovals.reconcileForPlan(userId, serviceUserId, planId),
        await this.hoursApprovals.withheldVisitsForPlan(planId))
      : new Set<string>();

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
      /**
       * 'held' = held now over the weekly hours (a new request); 'heldBefore' = already waiting for a
       * manager or rejected; false = make it.
       */
      const heldOverHours = async (
        slot: (typeof enabledSlots)[number],
        dateStr: string,
        visit: { start: Date; end: Date; durationMinutes: number; requiredCarers: number },
        isBackfillDay: boolean,
      ): Promise<'held' | 'heldBefore' | false> => {
        if (isBackfillDay || dateStr < hoursToday) return false;
        const key = `${slot.id}|${dateStr}`;
        if (options?.allowHeldKeys?.has(key)) return false;
        if (heldKeys.has(key)) return 'heldBefore';
        if (hoursLimit == null) return false;
        const weekStart = mondayOfIso(dateStr);
        if (!weekTotals.has(weekStart)) {
          weekTotals.set(weekStart, (await this.weeklyHours.weekMinutes(tx, serviceUserId, dateStr)).minutes);
        }
        const before = weekTotals.get(weekStart)!;
        const after = before + visit.durationMinutes * Math.max(1, visit.requiredCarers);
        const limitMinutes = Math.round(hoursLimit * 60) + timebank.reservedIn(weekStart);
        if (after > limitMinutes && timebank.cover(weekStart, after - Math.max(before, limitMinutes))) {
          timebankByKey.set(key, { weekStart, minutes: after - Math.max(before, limitMinutes) });
          weekTotals.set(weekStart, after);
          return false;
        }
        if (after <= limitMinutes || !hoursCtx.rules.visitsNeedApproval) {
          weekTotals.set(weekStart, after);
          if (after > limitMinutes) overWeeks.set(weekStart, after);
          return false;
        }
        const payload: ServiceUserVisitHoldPayload = {
          kind: 'PLAN_VISIT',
          date: dateStr,
          startsAt: visit.start.toISOString(),
          endsAt: visit.end.toISOString(),
          startTime: slot.plannedStartTime,
          endTime: slot.plannedEndTime,
          durationMinutes: visit.durationMinutes,
          requiredCarers: visit.requiredCarers,
          slotLabel: slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNameByCode),
          weekStart,
          weekMinutes: after,
          limitWeeklyHours: hoursLimit,
          timebankMinutes: timebank.reservedIn(weekStart),
          visitPlanSlotId: slot.id,
        };
        heldApprovalIds.push(
          await this.weeklyHours.holdVisit(tx, { userId, serviceUserId, visitPlanId: planId, payload }),
        );
        heldKeys.add(key);
        return 'held';
      };
      const reserveTimebankFor = async (key: string, jobId: string) => {
        const bank = timebankByKey.get(key);
        if (!bank) return;
        await this.weeklyHours.reserveTimebank(tx, [
          {
            serviceUserId,
            scheduledJobId: jobId,
            weekStart: bank.weekStart,
            minutes: bank.minutes,
            reason: 'NEW_VISIT',
            note: 'Plan visit over the weekly hours',
            userId: userId || null,
          },
        ]);
        timebankUsed.set(bank.weekStart, (timebankUsed.get(bank.weekStart) ?? 0) + bank.minutes);
      };
      // Time order within a day, so the earlier visits of a week use its hours first.
      const slotsInTimeOrder = [...enabledSlots].sort((a, b) =>
        (a.plannedStartTime ?? '').localeCompare(b.plannedStartTime ?? ''),
      );

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

        for (const slot of slotsInTimeOrder) {
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
                    medicationRequired: existingVisit.medicationRequired,
                    visitPlanSlotId: slot.id,
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
            const held = await heldOverHours(slot, dateStr, { start, end, durationMinutes, requiredCarers }, isBackfillDay);
            if (held) {
              if (held === 'held') visitsHeld += 1;
              else visitsSkipped += 1;
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
            await reserveTimebankFor(`${slot.id}|${dateStr}`, job.id);
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

          const held = await heldOverHours(slot, dateStr, { start, end, durationMinutes, requiredCarers }, isBackfillDay);
          if (held) {
            if (held === 'held') visitsHeld += 1;
            else visitsSkipped += 1;
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
          await reserveTimebankFor(`${slot.id}|${dateStr}`, job.id);

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
            employeeIds = employeeIds.filter((id) => !withheld.has(`${id}|${slot.id}|${dateStr}`));
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
                medicationRequired: visit.medicationRequired,
                visitPlanSlotId: slot.id,
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
                    fromVisitPlan: true,
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
          visitsHeldOverWeeklyHours: visitsHeld,
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
    if (heldApprovalIds.length) {
      void this.hoursApprovals.notifyServiceUserVisitsHeld({
        serviceUserId,
        approvalIds: heldApprovalIds,
        requestedById: userId,
      });
    }
    const weeklyHoursWarning = await this.weeklyHoursRunResult(hoursLimit, visitsHeld, overWeeks);
    const weeklyHoursTimebank = timebankUsed.size
      ? this.timebankRunText(timebankUsed, hoursCtx.dateDisplayFormat, 'taken')
      : null;

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
        visitsHeldOverWeeklyHours: visitsHeld,
        ...(weeklyHoursWarning ? { weeklyHoursWarning } : {}),
        ...(weeklyHoursTimebank ? { weeklyHoursTimebank } : {}),
      },
    };
  }

  /**
   * Before a run (generate preview): weeks of the run over the service user's weekly hours with
   * this plan, in words, and what will happen to the visits over (null when none). A week counts
   * its weekly hours plus what visits already hold from the timebank; with "Use timebank hours
   * automatically" on, weeks the bank can pay for in full are listed under `timebank` instead.
   * Like the run, the bank pays only for the time this run's new visits add above the room
   * (never for a week already over before it). The run decides visit by visit (all or nothing).
   */
  private async weeklyHoursRunWarning(
    serviceUserId: string,
    planId: string,
    fallbackHours: string | null,
    dto: GenerateVisitPlanScheduleDto,
  ): Promise<{ warning: string | null; timebank: string | null }> {
    const limit = await this.weeklyHours.limit(this.prisma, serviceUserId, fallbackHours);
    if (limit == null) return { warning: null, timebank: null };
    const { rules, dateDisplayFormat } = await this.weeklyHours.context();
    const summary = await this.weeklyHours.weeks(this.prisma, serviceUserId, { planFromRows: planId });
    const budget = await this.weeklyHours.timebankBudget(serviceUserId);
    // The rota as it is now: what the run's new visits are added to.
    const now = budget.enabled ? await this.weeklyHours.weeks(this.prisma, serviceUserId) : null;
    const nowMinutes = new Map((now?.weeks ?? []).map((w) => [w.weekStart, w.minutes]));
    const from = mondayOfIso(dto.fromDate.slice(0, 10));
    const to = dto.toDate.slice(0, 10);
    const limitMinutes = Math.round(limit * 60);
    const over: typeof summary.weeks = [];
    const fromBank = new Map<string, number>();
    for (const w of summary.weeks) {
      if (w.weekStart < from || w.weekStart > to) continue;
      const room = limitMinutes + budget.reservedIn(w.weekStart);
      if (w.minutes <= room) continue;
      const before = nowMinutes.get(w.weekStart) ?? 0;
      const need = w.minutes - Math.max(before, room);
      const covered = need > 0 && budget.cover(w.weekStart, need);
      if (covered) fromBank.set(w.weekStart, need);
      if (!covered || before > room) over.push(w);
    }
    let timebank = this.timebankRunText(fromBank, dateDisplayFormat, 'will be taken');
    if (timebank && over.length && budget.availableMinutes > 0) {
      timebank += `. The ${formatHoursMinutes(budget.availableMinutes)} left is used only for a visit whose whole time over it can pay`;
    }
    if (!over.length) return { warning: null, timebank };
    const weeks = over
      .map((w) => `week of ${formatOrganisationIsoDate(w.weekStart, dateDisplayFormat)}: ${formatHoursMinutes(w.minutes)}`)
      .join('; ');
    return {
      warning:
        `Over the weekly contracted hours (${formatHoursMinutes(limitMinutes)}) — ${weeks}. ` +
        (rules.visitsNeedApproval
          ? 'Visits over the hours go to Hours approvals and are made only once a manager approves.'
          : 'All visits are made (warning only).'),
      timebank,
    };
  }

  /** "Timebank: 1h taken for visits over the weekly hours — week of 10 Nov: 1h" (null when none). */
  private timebankRunText(
    byWeek: Map<string, number>,
    dateDisplayFormat: Parameters<typeof formatOrganisationIsoDate>[1],
    verb: 'will be taken' | 'taken',
  ): string | null {
    const weeks = [...byWeek].filter(([, m]) => m > 0).sort(([a], [b]) => a.localeCompare(b));
    if (!weeks.length) return null;
    const total = weeks.reduce((s, [, m]) => s + m, 0);
    const list = weeks
      .map(([week, m]) => `week of ${formatOrganisationIsoDate(week, dateDisplayFormat)}: ${formatHoursMinutes(m)}`)
      .join('; ');
    return `Timebank: ${formatHoursMinutes(total)} ${verb} for visits over the weekly hours — ${list}`;
  }

  /** After a run: what happened to the visits over the service user's weekly hours. */
  private async weeklyHoursRunResult(
    limit: number | null,
    held: number,
    overWeeks: Map<string, number>,
  ): Promise<string | null> {
    if (limit == null) return null;
    if (held > 0) {
      return `${held} visit${held === 1 ? '' : 's'} over the weekly contracted hours (${formatHoursMinutes(
        Math.round(limit * 60),
      )}) sent to Hours approvals — made only once a manager approves`;
    }
    if (!overWeeks.size) return null;
    const { dateDisplayFormat } = await this.weeklyHours.context();
    return `Over the weekly contracted hours (${formatHoursMinutes(Math.round(limit * 60))}) — ${[...overWeeks]
      .map(([week, minutes]) => `week of ${formatOrganisationIsoDate(week, dateDisplayFormat)} has ${formatHoursMinutes(minutes)}`)
      .join('; ')}`;
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
                fromVisitPlan: true,
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
