import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AllocationStatus,
  EmployeeComplianceStatus,
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  VisitPlanStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { isPreferredVisitTimesFieldKey } from '../initial-assessments/initial-assessment-preferred-visit-times.util';
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
import { visitPlanSlotMatchesDay } from './visit-plan-schedule-match.util';
import { buildSlotsFromPreferredVisitTimes } from './visit-plan-from-assessment.util';
import { SuggestVisitPlanCarersDto } from './dto/suggest-visit-plan-carers.dto';
import { VisitPlanCalendarVisitsQueryDto } from './dto/visit-plan-calendar-visits-query.dto';
import { RecordVisitPlanCalendarOutcomeDto } from './dto/record-visit-plan-calendar-outcome.dto';
import { ScheduledJobsService } from '../scheduled-jobs/scheduled-jobs.service';
import {
  carerFitScore,
  evaluateCarerAvailability,
  matchEmployeeSkills,
  requiredSkillKeywords,
  visitPlanSuggestJobWindow,
} from './visit-plan-carer-suggest.util';
import { syncVisitPlanSlotCarersToScheduledJobs } from './visit-plan-slot-carer-sync.util';

const planInclude = {
  slots: { orderBy: { sortOrder: 'asc' as const } },
  amendments: { orderBy: { amendedAt: 'desc' as const }, take: 20 },
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
    },
  },
} satisfies Prisma.ScheduledVisitInclude;

type CalendarVisitRow = Prisma.ScheduledVisitGetPayload<{ include: typeof calendarVisitInclude }>;

type PlanRow = Prisma.ServiceUserVisitPlanGetPayload<{ include: typeof planInclude }>;

@Injectable()
export class ServiceUserVisitPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly scheduledJobsService: ScheduledJobsService,
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
      })),
      amendments: (row.amendments ?? []).map((a) => ({
        id: a.id,
        reason: a.reason,
        amendedAt: a.amendedAt.toISOString(),
        amendedById: a.amendedById,
      })),
    };
  }

  private snapshot(plan: PlanRow, roundNameByCode?: Map<string, string>) {
    return this.mapPlan(plan, roundNameByCode);
  }

  private normalizeSlots(slots: VisitPlanSlotDto[] | undefined, rounds: MedicationRoundCatalogRow[]) {
    const catalogue = defaultVisitPlanSlotsFromRounds(rounds);
    if (!slots?.length) return catalogue;

    const byCode = new Map(
      slots.map((s) => [normalizeVisitPlanSlotCode(s.slotCode), { ...s, slotCode: normalizeVisitPlanSlotCode(s.slotCode) }]),
    );
    const orderedCodes = [
      ...catalogue.map((c) => c.slotCode),
      ...[...byCode.keys()].filter((code) => !catalogue.some((c) => c.slotCode === code)),
    ];

    return orderedCodes.map((slotCode, index) => {
      const defaults = catalogue.find((d) => d.slotCode === slotCode) ?? {
        ...catalogue[0]!,
        slotCode,
        medicationRoundCode: slotCode,
        sortOrder: index,
      };
      const input = byCode.get(slotCode);
      return {
        slotCode,
        daysOfWeek: input?.daysOfWeek?.length ? [...new Set(input.daysOfWeek)].sort() : defaults.daysOfWeek,
        plannedStartTime: input?.plannedStartTime ?? defaults.plannedStartTime,
        plannedEndTime: input?.plannedEndTime ?? defaults.plannedEndTime,
        requiredCarers: input?.requiredCarers ?? defaults.requiredCarers,
        isEnabled: input?.isEnabled ?? defaults.isEnabled,
        medicationRoundCode: input?.medicationRoundCode ?? defaults.medicationRoundCode,
        notes: input?.notes?.trim() ?? '',
        sortOrder: defaults.sortOrder ?? index,
        linkedCarePlanFormIds: input?.linkedCarePlanFormIds ?? [],
        assignedEmployeeIds: input?.assignedEmployeeIds ?? [],
        ...mergeSlotSchedulingOptions(input ?? null),
      };
    });
  }

  private slotPersistFields(
    slot: ReturnType<ServiceUserVisitPlansService['normalizeSlots']>[number],
  ) {
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
    };
  }

  async suggestCarers(serviceUserId: string, dto: SuggestVisitPlanCarersDto) {
    await this.ensureServiceUser(serviceUserId);

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

    const employees = await this.prisma.employee.findMany({
      where: { deletedAt: null, isActive: true },
      include: {
        personalDetail: true,
        employment: { include: { role: true, jobTitle: true } },
        workingPatterns: { where: { deletedAt: null, isActive: true } },
        skills: {
          where: { deletedAt: null, isActive: true },
          include: { skillType: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    const slotDays = [...new Set(dto.daysOfWeek)].sort();
    const rotaConflictByEmployee = await this.loadRotaConflictJobNamesByEmployee(
      employees.map((e) => e.id),
      dto,
    );
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
          dayOfWeek: p.dayOfWeek,
          startTime: p.startTime,
          endTime: p.endTime,
          isAvailable: p.isAvailable,
          notes: p.notes,
        })),
        slotDays,
        dto.plannedStartTime,
        dto.plannedEndTime,
      );

      const skillRows = emp.skills.map((s) => ({
        skillTypeId: s.skillTypeId,
        skillName: s.skillType?.name ?? null,
        expiryDate: s.expiryDate,
      }));
      const skills = matchEmployeeSkills(skillRows, skillKeywords);

      const complianceIssues = await this.prisma.employeeCompliance.count({
        where: {
          employeeId: emp.id,
          deletedAt: null,
          status: {
            in: [
              EmployeeComplianceStatus.EXPIRED,
              EmployeeComplianceStatus.MISSING,
              EmployeeComplianceStatus.REJECTED,
              EmployeeComplianceStatus.EXPIRING_SOON,
            ],
          },
        },
      });

      const warnings: string[] = [];
      if (isBlocked) warnings.push('Blocked for this service user');
      if (isPreferred) warnings.push('Preferred carer');
      if (hasRotaConflict) {
        warnings.push(`Already booked: ${rotaConflictJobs.join(', ')}`);
      }
      if (availability.unavailableDays.length) warnings.push(availability.summary);
      if (skills.missing.length) warnings.push(`Missing skills: ${skills.missing.join(', ')}`);
      if (complianceIssues > 0) warnings.push(`${complianceIssues} compliance item(s) need attention`);

      const fit = carerFitScore({
        isBlocked,
        hasRotaConflict,
        unavailableDays: availability.unavailableDays,
        slotDaysCount: slotDays.length,
        missingSkills: skills.missing,
        requiredSkillCount: skillKeywords.length,
        complianceIssues,
        isPreferred,
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
      },
    };
  }

  private async loadRotaConflictJobNamesByEmployee(
    employeeIds: string[],
    dto: SuggestVisitPlanCarersDto,
  ): Promise<Map<string, string[]>> {
    const conflicts = new Map<string, string[]>();
    if (!dto.scheduledDate || employeeIds.length === 0) return conflicts;

    const window = visitPlanSuggestJobWindow(
      dto.scheduledDate,
      dto.plannedStartTime,
      dto.plannedEndTime,
    );
    if (!window) return conflicts;

    const { jobStart, jobEnd } = window;
    const activeStatuses: AllocationStatus[] = [
      AllocationStatus.PENDING_CONFIRMATION,
      AllocationStatus.ALLOCATED,
      AllocationStatus.CONFIRMED,
    ];

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
              OR: [
                { scheduledEndDateTime: { gt: jobStart } },
                { scheduledEndDateTime: null },
              ],
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

  private parseDateOnly(value: string, field: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) throw new BadRequestException(`${field} must be YYYY-MM-DD`);
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} is invalid`);
    return d;
  }

  private combineDateAndTime(date: Date, time: string): Date {
    const m = /^(\d{2}):(\d{2})$/.exec(time);
    if (!m) throw new BadRequestException('Invalid time');
    const dt = new Date(date);
    dt.setUTCHours(Number(m[1]), Number(m[2]), 0, 0);
    return dt;
  }

  private resolveActualVisitTimes(
    day: Date,
    dto: RecordVisitPlanCalendarOutcomeDto,
  ): { actualStart?: Date; actualEnd?: Date } {
    let actualStart: Date | undefined;
    let actualEnd: Date | undefined;

    if (dto.actualStartTime) {
      actualStart = this.combineDateAndTime(day, dto.actualStartTime);
    } else if (dto.status === ScheduledVisitStatus.STARTED) {
      actualStart = new Date();
    }

    if (dto.actualEndTime) {
      actualEnd = this.combineDateAndTime(day, dto.actualEndTime);
      if (actualStart && actualEnd.getTime() <= actualStart.getTime()) {
        actualEnd = new Date(actualEnd.getTime() + 86400000);
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
      actualStart = this.combineDateAndTime(day, dto.actualStartTime);
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
    const rounds = await this.loadMedicationRoundCatalog();
    const roundNameByCode = new Map(rounds.map((r) => [r.code, r.name]));
    const slots = this.normalizeSlots(dto.slots, rounds);
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.serviceUserVisitPlan.create({
        data: {
          serviceUserId,
          status: VisitPlanStatus.DRAFT,
          effectiveFrom,
          weeklyContractedHours: dto.weeklyContractedHours?.trim() ?? null,
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

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.slots?.length) {
        for (const slot of this.normalizeSlots(dto.slots, rounds)) {
          const result = await tx.visitPlanSlot.updateMany({
            where: { visitPlanId: planId, slotCode: slot.slotCode },
            data: this.slotPersistFields(slot),
          });
          if (result.count === 0) {
            await tx.visitPlanSlot.create({
              data: {
                visitPlanId: planId,
                slotCode: slot.slotCode,
                sortOrder: slot.sortOrder,
                ...this.slotPersistFields(slot),
              },
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
          updatedById: userId,
        },
      });
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

      if (dto.slots?.length) {
        for (const slot of after.slots) {
          await syncVisitPlanSlotCarersToScheduledJobs(tx, {
            visitPlanSlotId: slot.id,
            assignedEmployeeIds: slot.assignedEmployeeIds ?? [],
            requiredCarers: slot.requiredCarers,
            userId,
          });
        }
      }

      return after;
    });

    return { message: 'Visit plan updated', data: this.mapPlan(updated, roundNameByCode) };
  }

  async activate(userId: string, serviceUserId: string, planId: string, meta?: RequestAuditMeta) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    if (plan.status !== VisitPlanStatus.DRAFT && plan.status !== VisitPlanStatus.SUSPENDED) {
      throw new BadRequestException('Only draft or suspended plans can be activated');
    }
    const enabledSlots = plan.slots.filter((s) => s.isEnabled);
    if (!enabledSlots.length) {
      throw new BadRequestException('Enable at least one visit slot before activation');
    }

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
          effectiveFrom: new Date(),
          effectiveTo: null,
          approvedById: userId,
          approvedAt: new Date(),
          updatedById: userId,
        },
        include: planInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_VISIT_PLAN_ACTIVATED,
        recordType: 'ServiceUserVisitPlan',
        recordId: planId,
        newValues: auditSnapshot(activated),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return activated;
    });

    const roundNameByCode = await this.loadRoundNameMap();
    return { message: 'Visit plan activated', data: this.mapPlan(result, roundNameByCode) };
  }

  async suspend(
    userId: string,
    serviceUserId: string,
    planId: string,
    reason: string,
    meta?: RequestAuditMeta,
  ) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    if (plan.status !== VisitPlanStatus.ACTIVE) {
      throw new BadRequestException('Only active visit plans can be suspended');
    }
    const roundNameByCode = await this.loadRoundNameMap();
    const result = await this.prisma.serviceUserVisitPlan.update({
      where: { id: planId },
      data: { status: VisitPlanStatus.SUSPENDED, updatedById: userId },
      include: planInclude,
    });
    await this.prisma.visitPlanAmendment.create({
      data: {
        visitPlanId: planId,
        reason: reason.trim(),
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
      metadata: { serviceUserId, reason: reason.trim() },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Visit plan suspended', data: this.mapPlan(result, roundNameByCode) };
  }

  async end(userId: string, serviceUserId: string, planId: string, reason: string, meta?: RequestAuditMeta) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    if (plan.status === VisitPlanStatus.ENDED) {
      throw new BadRequestException('Visit plan is already ended');
    }
    const roundNameByCode = await this.loadRoundNameMap();
    const result = await this.prisma.serviceUserVisitPlan.update({
      where: { id: planId },
      data: {
        status: VisitPlanStatus.ENDED,
        effectiveTo: new Date(),
        updatedById: userId,
      },
      include: planInclude,
    });
    await this.prisma.visitPlanAmendment.create({
      data: {
        visitPlanId: planId,
        reason: reason.trim(),
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
      metadata: { serviceUserId, reason: reason.trim() },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Visit plan ended', data: this.mapPlan(result, roundNameByCode) };
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
        weeklyContractedHours: dom?.weeklyContractedHours ?? null,
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
  ) {
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

    const enabledSlots = plan.slots.filter((s) => s.isEnabled);
    if (!enabledSlots.length) {
      throw new BadRequestException('No enabled visit slots on this plan');
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

    let visitsCreated = 0;
    let visitsSkipped = 0;

    const scheduleAnchor = plan.effectiveFrom;

    await this.prisma.$transaction(async (tx) => {
      for (let t = from.getTime(); t <= to.getTime(); t += dayMs) {
        const day = new Date(t);
        const dateStr = day.toISOString().slice(0, 10);

        let batch = await tx.scheduleBatch.findFirst({
          where: { scheduleDate: day, deletedAt: null, isActive: true },
        });
        if (!batch) {
          batch = await tx.scheduleBatch.create({
            data: {
              scheduleDate: day,
              status: 'BUILDING',
              buildSource: 'MANUAL',
              metadata: { visitPlanId: planId, generated: true } as Prisma.InputJsonValue,
              createdById: userId,
            },
          });
        }

        for (const slot of enabledSlots) {
          if (!visitPlanSlotMatchesDay(slot, day, scheduleAnchor)) continue;

          const start = this.combineDateAndTime(day, slot.plannedStartTime);
          let end = this.combineDateAndTime(day, slot.plannedEndTime);
          if (end.getTime() <= start.getTime()) {
            end = new Date(end.getTime() + dayMs);
          }

          const existingVisit = await tx.scheduledVisit.findFirst({
            where: {
              visitPlanSlotId: slot.id,
              deletedAt: null,
              scheduledStartDateTime: start,
            },
          });
          if (existingVisit) {
            await syncVisitPlanSlotCarersToScheduledJobs(tx, {
              visitPlanSlotId: slot.id,
              assignedEmployeeIds: slot.assignedEmployeeIds ?? [],
              requiredCarers: slot.requiredCarers,
              userId,
              scheduledVisitId: existingVisit.id,
              fromDateTime: start,
            });
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
              requiredCarers: slot.requiredCarers,
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
              metadata: { visitPlanId: planId, visitPlanSlotId: slot.id, date: dateStr } as Prisma.InputJsonValue,
              createdById: userId,
            },
          });

          const visit = await tx.scheduledVisit.create({
            data: {
              scheduledJobId: job.id,
              serviceUserId,
              visitName: slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNameByCode),
              scheduledStartDateTime: start,
              scheduledEndDateTime: end,
              requiredCarers: slot.requiredCarers,
              status: ScheduledVisitStatus.PLANNED,
              medicationRequired: Boolean(slot.medicationRoundCode),
              notesRequired: slot.notesRequired,
              photoRequired: slot.photoAllowed,
              visitPlanSlotId: slot.id,
              createdById: userId,
            },
          });

          const assignedCarers = slot.assignedEmployeeIds ?? [];
          const toAllocate = assignedCarers.slice(0, slot.requiredCarers);
          if (toAllocate.length > 0) {
            for (const employeeId of toAllocate) {
              await tx.jobAllocation.create({
                data: {
                  scheduledJobId: job.id,
                  scheduledVisitId: visit.id,
                  employeeId,
                  status: AllocationStatus.CONFIRMED,
                  requiresConfirmation: false,
                  allocatedById: userId,
                },
              });
            }
          }

          const jobStatus =
            toAllocate.length >= slot.requiredCarers
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

          visitsCreated += 1;
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
          visitsCreated,
          visitsSkipped,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    });

    return {
      message: 'Schedule generated from visit plan',
      data: { visitsCreated, visitsSkipped, fromDate: dto.fromDate, toDate: dto.toDate },
    };
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

    const endInclusive = new Date(to);
    endInclusive.setUTCHours(23, 59, 59, 999);

    const rows = await this.prisma.scheduledVisit.findMany({
      where: {
        serviceUserId,
        visitPlanSlotId: { in: slotIds },
        deletedAt: null,
        isActive: true,
        scheduledStartDateTime: { gte: from, lte: endInclusive },
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
    if (!visitPlanSlotMatchesDay(slot, day, scheduleAnchor)) {
      throw new BadRequestException('This visit is not scheduled on the selected date');
    }

    const roundNameByCode = await this.loadRoundNameMap();
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId },
      include: { address: true },
    });

    const start = this.combineDateAndTime(day, slot.plannedStartTime);
    let end = this.combineDateAndTime(day, slot.plannedEndTime);
    if (end.getTime() <= start.getTime()) {
      end = new Date(end.getTime() + 86400000);
    }

    return this.prisma.$transaction(async (tx) => {
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
            requiredCarers: slot.requiredCarers,
            status: ScheduledJobStatus.UNALLOCATED,
            postcode: su?.address?.postcode ?? null,
            address: su?.address
              ? [su.address.addressLine1, su.address.addressLine2, su.address.town, su.address.postcode]
                  .filter(Boolean)
                  .join(', ')
              : null,
            metadata: { visitPlanId: planId, visitPlanSlotId: slot.id, date: dateStr } as Prisma.InputJsonValue,
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
            requiredCarers: slot.requiredCarers,
            status: ScheduledVisitStatus.PLANNED,
            medicationRequired: Boolean(slot.medicationRoundCode),
            notesRequired: slot.notesRequired,
            photoRequired: slot.photoAllowed,
            visitPlanSlotId: slot.id,
            createdById: userId,
          },
        });

        const assignedCarers = slot.assignedEmployeeIds ?? [];
        if (assignedCarers.length > 0) {
          const toAllocate = assignedCarers.slice(0, slot.requiredCarers);
          for (const employeeId of toAllocate) {
            await tx.jobAllocation.create({
              data: {
                scheduledJobId: job.id,
                scheduledVisitId: visit.id,
                employeeId,
                status: AllocationStatus.CONFIRMED,
                requiresConfirmation: false,
                allocatedById: userId,
              },
            });
          }
          await tx.scheduledJob.update({
            where: { id: job.id },
            data: {
              status:
                toAllocate.length >= slot.requiredCarers
                  ? ScheduledJobStatus.ALLOCATED
                  : ScheduledJobStatus.NEEDS_ATTENTION,
            },
          });
        }
      }

      const { actualStart, actualEnd } = this.resolveActualVisitTimes(day, dto);

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
