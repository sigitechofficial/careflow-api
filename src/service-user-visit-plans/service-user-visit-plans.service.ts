import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  VisitPlanSlotCode,
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
  defaultVisitPlanSlots,
  slotLabel,
  VISIT_PLAN_SLOT_ORDER,
} from './visit-plan-slot-defaults';
import { mergeSlotSchedulingOptions } from './visit-plan-slot-options.defaults';
import { visitPlanSlotMatchesDay } from './visit-plan-schedule-match.util';
import { buildSlotsFromPreferredVisitTimes } from './visit-plan-from-assessment.util';

const planInclude = {
  slots: { orderBy: { sortOrder: 'asc' as const } },
  amendments: { orderBy: { amendedAt: 'desc' as const }, take: 20 },
} satisfies Prisma.ServiceUserVisitPlanInclude;

type PlanRow = Prisma.ServiceUserVisitPlanGetPayload<{ include: typeof planInclude }>;

@Injectable()
export class ServiceUserVisitPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
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

  private mapPlan(row: PlanRow) {
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
        label: slotLabel(s.slotCode),
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
      })),
      amendments: (row.amendments ?? []).map((a) => ({
        id: a.id,
        reason: a.reason,
        amendedAt: a.amendedAt.toISOString(),
        amendedById: a.amendedById,
      })),
    };
  }

  private snapshot(plan: PlanRow) {
    return this.mapPlan(plan);
  }

  private normalizeSlots(slots?: VisitPlanSlotDto[]) {
    if (!slots?.length) return defaultVisitPlanSlots();
    const byCode = new Map(slots.map((s) => [s.slotCode, s]));
    return VISIT_PLAN_SLOT_ORDER.map((slotCode) => {
      const input = byCode.get(slotCode);
      const defaults = defaultVisitPlanSlots().find((d) => d.slotCode === slotCode)!;
      return {
        slotCode,
        daysOfWeek: input?.daysOfWeek?.length ? [...new Set(input.daysOfWeek)].sort() : defaults.daysOfWeek,
        plannedStartTime: input?.plannedStartTime ?? defaults.plannedStartTime,
        plannedEndTime: input?.plannedEndTime ?? defaults.plannedEndTime,
        requiredCarers: input?.requiredCarers ?? defaults.requiredCarers,
        isEnabled: input?.isEnabled ?? defaults.isEnabled,
        medicationRoundCode: input?.medicationRoundCode ?? null,
        notes: input?.notes?.trim() ?? '',
        sortOrder: defaults.sortOrder,
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
    };
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

  async list(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const rows = await this.prisma.serviceUserVisitPlan.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
      include: planInclude,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    return { data: rows.map((r) => this.mapPlan(r)) };
  }

  async getActive(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const row = await this.prisma.serviceUserVisitPlan.findFirst({
      where: { serviceUserId, status: VisitPlanStatus.ACTIVE, deletedAt: null, isActive: true },
      include: planInclude,
    });
    return { data: row ? this.mapPlan(row) : null };
  }

  async getById(serviceUserId: string, planId: string) {
    const row = await this.getPlanOrThrow(serviceUserId, planId);
    return { data: this.mapPlan(row) };
  }

  async create(
    userId: string,
    serviceUserId: string,
    dto: CreateVisitPlanDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const slots = this.normalizeSlots(dto.slots);
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

    return { message: 'Visit plan created', data: this.mapPlan(created) };
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

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.slots?.length) {
        for (const slot of this.normalizeSlots(dto.slots)) {
          await tx.visitPlanSlot.updateMany({
            where: { visitPlanId: planId, slotCode: slot.slotCode },
            data: this.slotPersistFields(slot),
          });
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
          snapshotBefore: this.snapshot(existing) as Prisma.InputJsonValue,
          snapshotAfter: this.snapshot(after) as Prisma.InputJsonValue,
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

    return { message: 'Visit plan updated', data: this.mapPlan(updated) };
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

    return { message: 'Visit plan activated', data: this.mapPlan(result) };
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
    const result = await this.prisma.serviceUserVisitPlan.update({
      where: { id: planId },
      data: { status: VisitPlanStatus.SUSPENDED, updatedById: userId },
      include: planInclude,
    });
    await this.prisma.visitPlanAmendment.create({
      data: {
        visitPlanId: planId,
        reason: reason.trim(),
        snapshotBefore: this.snapshot(plan) as Prisma.InputJsonValue,
        snapshotAfter: this.snapshot(result) as Prisma.InputJsonValue,
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
    return { message: 'Visit plan suspended', data: this.mapPlan(result) };
  }

  async end(userId: string, serviceUserId: string, planId: string, reason: string, meta?: RequestAuditMeta) {
    const plan = await this.getPlanOrThrow(serviceUserId, planId);
    if (plan.status === VisitPlanStatus.ENDED) {
      throw new BadRequestException('Visit plan is already ended');
    }
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
        snapshotBefore: this.snapshot(plan) as Prisma.InputJsonValue,
        snapshotAfter: this.snapshot(result) as Prisma.InputJsonValue,
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
    return { message: 'Visit plan ended', data: this.mapPlan(result) };
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
      return { message: 'Visit plan already exists for this assessment', data: this.mapPlan(full) };
    }

    const preferred = submission.answers.find((a) =>
      isPreferredVisitTimesFieldKey(a.question.metadata as Prisma.JsonValue),
    );
    const dom = await this.prisma.serviceUserDomCare.findUnique({ where: { serviceUserId } });
    const numberOfCarers = dom?.numberOfCarers ?? 1;
    const slotSeeds = buildSlotsFromPreferredVisitTimes(preferred?.selectedOptions ?? null, numberOfCarers);

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
          slotCode: s.slotCode as VisitPlanSlotCode,
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
            visitsSkipped += 1;
            continue;
          }

          const job = await tx.scheduledJob.create({
            data: {
              scheduleBatchId: batch.id,
              scheduleAreaId: dto.scheduleAreaId ?? null,
              serviceUserId,
              jobName: `${slotLabel(slot.slotCode)} — ${su?.preferredName ?? su?.firstName ?? 'Client'}`,
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

          await tx.scheduledVisit.create({
            data: {
              scheduledJobId: job.id,
              serviceUserId,
              visitName: slotLabel(slot.slotCode),
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
}
