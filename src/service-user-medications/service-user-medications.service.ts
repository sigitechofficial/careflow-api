import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MedicationRecordStatus,
  MedicationSchedulePattern,
  MedicationStatusEndReason,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { DataAccessType } from '@prisma/client';
import { assertServiceUserExists } from '../medications/medication.asserts';
import { CreateServiceUserMedicationDto } from './dto/create-service-user-medication.dto';
import { UpdateServiceUserMedicationDto } from './dto/update-service-user-medication.dto';
import { ServiceUserMedicationQueryDto } from './dto/service-user-medication-query.dto';
import { UpdateMedicationStatusDto } from './dto/update-medication-status.dto';
import { matchRoundIdByDueTime } from '../medication-charts/medication-chart-rounds.util';
import { buildScheduleFrequencyText } from '../medications/medication-schedule-applies.util';
import { resolveFrequencyIdForPattern } from '../medications/medication-frequency-lookup.util';
import { MEDICATION_DOW } from '../medications/medication-schedule-applies.util';
import {
  auditAutoEndedMedications,
  clearStatusEndTracking,
  manualStatusEndPatch,
  startOfUtcDay,
  syncMedicationsPastEndDate,
} from './medication-status-end.util';
import { AuditLogQueryDto } from '../audit-logs/dto/audit-log-query.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

const userBriefSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

const medInclude = {
  medicationType: true,
  route: true,
  category: true,
  frequency: true,
  statusEndedBy: { select: userBriefSelect },
  medicationPack: { select: { id: true, name: true } },
  schedules: {
    where: { deletedAt: null, isActive: true },
    orderBy: [{ dueTime: 'asc' as const }, { createdAt: 'asc' as const }],
    select: {
      id: true,
      dueTime: true,
      dueVisitName: true,
      roundId: true,
      dose: true,
      frequencyText: true,
      daysOfWeek: true,
    },
  },
} satisfies Prisma.ServiceUserMedicationInclude;

function buildAllergyWarnings(
  medicationName: string,
  allergies: { allergyName: string }[],
): string[] | undefined {
  const n = medicationName.toLowerCase();
  const hits = allergies.filter((a) => {
    const an = a.allergyName.toLowerCase();
    return n.includes(an) || an.includes(n);
  });
  if (!hits.length) return undefined;
  return hits.map((h) => `Possible interaction with recorded allergy: "${h.allergyName}"`);
}

@Injectable()
export class ServiceUserMedicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async logDataView(userId: string, serviceUserId: string, meta: RequestAuditMeta, detail: string) {
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.MEDICATION,
      recordType: 'ServiceUserMedication',
      recordId: serviceUserId,
      accessType: DataAccessType.VIEW,
      ...meta,
      metadata: { serviceUserId, detail },
    });
  }

  private async syncExpiredMedications(serviceUserId: string, meta?: RequestAuditMeta) {
    const autoEnded = await syncMedicationsPastEndDate(this.prisma, serviceUserId);
    if (autoEnded.length) {
      await auditAutoEndedMedications(this.audit, serviceUserId, autoEnded, meta);
    }
  }

  async list(userId: string, serviceUserId: string, query: ServiceUserMedicationQueryDto, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    if (!query.archivedOnly) {
      await this.syncExpiredMedications(serviceUserId, meta);
    }
    await this.logDataView(
      userId,
      serviceUserId,
      meta,
      query.archivedOnly ? 'medications_archived_list' : 'medications_list',
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.ServiceUserMedicationWhereInput = {
      serviceUserId,
      ...(query.archivedOnly
        ? { deletedAt: { not: null } }
        : { deletedAt: null, isActive: true }),
    };

    if (query.medicationKind) where.medicationKind = query.medicationKind;
    if (!query.archivedOnly) {
      if (query.status) {
        where.status = query.status;
      } else if (!query.showPastEndDate) {
        where.status = { in: [MedicationRecordStatus.ACTIVE, MedicationRecordStatus.PAUSED] };
      }
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.medicationTypeId) where.medicationTypeId = query.medicationTypeId;
    if (query.routeId) where.routeId = query.routeId;
    if (query.isControlledMedication !== undefined) where.isControlledMedication = query.isControlledMedication;

    if (query.search?.trim()) {
      where.medicationName = { contains: query.search.trim(), mode: 'insensitive' };
    }

    const today = startOfUtcDay(new Date());
    if (!query.archivedOnly && !query.showPastEndDate) {
      where.AND = [
        ...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []),
        {
          OR: [{ endDate: null }, { endDate: { gte: today } }],
        },
      ];
    }

    if (query.startDateFrom || query.startDateTo) {
      where.startDate = {};
      if (query.startDateFrom) where.startDate.gte = new Date(query.startDateFrom);
      if (query.startDateTo) where.startDate.lte = new Date(query.startDateTo);
    }
    if (query.endDateFrom || query.endDateTo) {
      where.endDate = {};
      if (query.endDateFrom) where.endDate.gte = new Date(query.endDateFrom);
      if (query.endDateTo) where.endDate.lte = new Date(query.endDateTo);
    }

    const orderField = ['createdAt', 'updatedAt', 'medicationName', 'startDate', 'endDate'].includes(
      query.sortBy ?? '',
    )
      ? (query.sortBy as string)
      : 'updatedAt';
    const orderDir = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const [rows, total] = await Promise.all([
      this.prisma.serviceUserMedication.findMany({
        where,
        include: medInclude,
        orderBy: { [orderField]: orderDir },
        skip,
        take: limit,
      }),
      this.prisma.serviceUserMedication.count({ where }),
    ]);

    return {
      data: rows,
      meta: {
        ...buildPaginationMeta({ page, limit, total }),
      },
    };
  }

  async getOne(userId: string, serviceUserId: string, medicationId: string, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    await this.syncExpiredMedications(serviceUserId, meta);
    await this.logDataView(userId, serviceUserId, meta, 'medication_detail');
    const row = await this.prisma.serviceUserMedication.findFirst({
      where: { id: medicationId, serviceUserId, deletedAt: null },
      include: medInclude,
    });
    if (!row) throw new NotFoundException('Medication not found');
    return row;
  }

  private validateDates(start?: string | Date | null, end?: string | Date | null) {
    if (start && end && new Date(end).getTime() < new Date(start).getTime()) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
  }

  private validateSchedules(
    medicationKind: string,
    schedules?: { dueTime: string }[] | null,
  ) {
    if (!schedules?.length) return;
    if (medicationKind === 'PRN') {
      throw new BadRequestException('PRN medications cannot have administration schedules');
    }
    const times = schedules.map((s) => s.dueTime);
    const unique = new Set(times);
    if (unique.size !== times.length) {
      throw new BadRequestException('Duplicate administration times are not allowed');
    }
  }

  private validateSchedulePattern(dto: CreateServiceUserMedicationDto) {
    if (dto.medicationKind === 'PRN') return;
    const pattern =
      dto.schedulePattern ?? MedicationSchedulePattern.DAILY;
    const days = dto.schedules?.flatMap(s => s.daysOfWeek ?? []) ?? [];
    if (pattern === MedicationSchedulePattern.WEEKLY && days.length === 0) {
      throw new BadRequestException('Select at least one weekday for a weekly pattern');
    }
    if (pattern === MedicationSchedulePattern.MONTHLY) {
      const anchor = dto.monthlyAnchorToStartDate ?? true;
      if (anchor && !dto.startDate) {
        throw new BadRequestException(
          'Start date is required when monthly doses use the same day as the start date',
        );
      }
      if (!anchor && (dto.monthlyDayOfMonth == null || dto.monthlyDayOfMonth < 1)) {
        throw new BadRequestException('Select a day of the month for monthly pattern');
      }
    }
    for (const day of days) {
      if (!MEDICATION_DOW.includes(day as (typeof MEDICATION_DOW)[number])) {
        throw new BadRequestException(`Invalid weekday: ${day}`);
      }
    }
  }

  private async resolveFrequencyId(
    dto: CreateServiceUserMedicationDto,
    timesPerDay: number,
  ): Promise<string | undefined> {
    if (dto.frequencyId) return dto.frequencyId;
    if (!dto.schedulePattern) return undefined;
    const frequencies = await this.prisma.medicationFrequency.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, code: true },
    });
    return resolveFrequencyIdForPattern(frequencies, dto.schedulePattern, timesPerDay);
  }

  private buildMedicationFrequencyText(
    dto: CreateServiceUserMedicationDto,
    timesPerDay: number,
  ): string | undefined {
    if (dto.frequencyText?.trim()) return dto.frequencyText.trim();
    if (!dto.schedulePattern) {
      if (dto.frequencyIntervalDays != null && dto.frequencyIntervalDays > 1) {
        return `Every ${dto.frequencyIntervalDays} day(s)`;
      }
      return undefined;
    }
    const days = dto.schedules?.flatMap(s => s.daysOfWeek ?? []) ?? [];
    return buildScheduleFrequencyText({
      schedulePattern: dto.schedulePattern,
      frequencyIntervalDays: dto.frequencyIntervalDays ?? 1,
      daysOfWeek: days,
      monthlyDayOfMonth: dto.monthlyDayOfMonth ?? null,
      monthlyAnchorToStartDate: dto.monthlyAnchorToStartDate ?? true,
      medicationStartDate: dto.startDate ? new Date(dto.startDate) : null,
      timesPerDay,
    });
  }

  private async ensurePackForUser(serviceUserId: string, packId?: string | null) {
    if (!packId) return;
    const pack = await this.prisma.medicationPack.findFirst({
      where: { id: packId, serviceUserId, deletedAt: null },
    });
    if (!pack) throw new BadRequestException('Medication pack does not belong to this service user');
  }

  async create(
    userId: string,
    serviceUserId: string,
    dto: CreateServiceUserMedicationDto,
    meta: RequestAuditMeta,
  ) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    this.validateDates(dto.startDate, dto.endDate);
    if (dto.expiryDate && dto.startDate) {
      this.validateDates(dto.startDate, dto.expiryDate);
    }
    await this.ensurePackForUser(serviceUserId, dto.medicationPackId);
    this.validateSchedules(dto.medicationKind, dto.schedules);
    this.validateSchedulePattern(dto);

    const allergies = await this.prisma.medicationAllergy.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
    });
    const warnings = buildAllergyWarnings(dto.medicationName, allergies);
    const timesPerDay = dto.schedules?.length ?? 0;
    const frequencyId = await this.resolveFrequencyId(dto, timesPerDay);
    const scheduleFrequencyText = this.buildMedicationFrequencyText(dto, timesPerDay);
    const intervalDays = Math.max(1, dto.frequencyIntervalDays ?? 1);
    const schedulePattern =
      dto.medicationKind === 'PRN'
        ? null
        : (dto.schedulePattern ?? MedicationSchedulePattern.DAILY);

    const created = await this.prisma.$transaction(async (tx) => {
      const med = await tx.serviceUserMedication.create({
        data: {
          serviceUserId,
          medicationPackId: dto.medicationPackId,
          medicationName: dto.medicationName,
          dose: dto.dose,
          strength: dto.strength,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
          howAssisted: dto.howAssisted,
          medicationTypeId: dto.medicationTypeId,
          routeId: dto.routeId,
          categoryId: dto.categoryId,
          frequencyId,
          frequencyText: scheduleFrequencyText,
          schedulePattern,
          frequencyIntervalDays: intervalDays,
          monthlyDayOfMonth:
            schedulePattern === MedicationSchedulePattern.MONTHLY &&
            !(dto.monthlyAnchorToStartDate ?? true)
              ? dto.monthlyDayOfMonth
              : null,
          monthlyAnchorToStartDate: dto.monthlyAnchorToStartDate ?? true,
          instructions: dto.instructions,
          notes: dto.notes,
          isControlledMedication: dto.isControlledMedication ?? false,
          isDecongestantMedication: dto.isDecongestantMedication ?? false,
          medicationKind: dto.medicationKind,
          status: dto.status ?? MedicationRecordStatus.ACTIVE,
          createdById: userId,
          updatedById: userId,
        },
      });

      if (dto.schedules?.length) {
        const administrationRounds = await tx.medicationAdministrationRound.findMany({
          where: { deletedAt: null, isActive: true },
          orderBy: [{ sortOrder: 'asc' }],
        });
        for (const slot of dto.schedules) {
          const roundId =
            slot.roundId ??
            matchRoundIdByDueTime(administrationRounds, slot.dueTime) ??
            undefined;
          const schedule = await tx.medicationSchedule.create({
            data: {
              serviceUserMedicationId: med.id,
              roundId,
              dueTime: slot.dueTime,
              dose: slot.dose?.trim() || dto.dose?.trim() || undefined,
              dueVisitName: slot.dueVisitName,
              startDate: dto.startDate ? new Date(dto.startDate) : undefined,
              endDate: dto.endDate ? new Date(dto.endDate) : undefined,
              frequencyId,
              frequencyText: scheduleFrequencyText,
              daysOfWeek: slot.daysOfWeek ?? [],
              instructions: dto.instructions,
              createdById: userId,
              updatedById: userId,
            },
          });
          await this.audit.logAudit({
            tx,
            userId,
            module: AuditModule.MEDICATION,
            action: AuditAction.MEDICATION_SCHEDULE_CREATED,
            recordType: 'MedicationSchedule',
            recordId: schedule.id,
            newValues: auditSnapshot(schedule),
            metadata: { serviceUserId, medicationId: med.id, dueTime: slot.dueTime },
            ...meta,
          });
        }
      }

      return tx.serviceUserMedication.findUniqueOrThrow({
        where: { id: med.id },
        include: medInclude,
      });
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_CREATED,
      recordType: 'ServiceUserMedication',
      recordId: created.id,
      newValues: auditSnapshot(created),
      metadata: {
        serviceUserId,
        controlledMedication: created.isControlledMedication,
        allergyWarnings: warnings,
        scheduleCount: dto.schedules?.length ?? 0,
      },
      ...meta,
    });

    return {
      data: created,
      meta: { allergyWarnings: warnings, scheduleCount: dto.schedules?.length ?? 0 },
    };
  }

  async update(
    userId: string,
    serviceUserId: string,
    medicationId: string,
    dto: UpdateServiceUserMedicationDto,
    meta: RequestAuditMeta,
  ) {
    const existing = await this.prisma.serviceUserMedication.findFirst({
      where: { id: medicationId, serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Medication not found');
    this.validateDates(dto.startDate ?? existing.startDate, dto.endDate ?? existing.endDate);
    if (dto.medicationPackId) await this.ensurePackForUser(serviceUserId, dto.medicationPackId);
    const nextKind = dto.medicationKind ?? existing.medicationKind;
    if (dto.schedules !== undefined) {
      this.validateSchedules(nextKind, dto.schedules);
    }

    const nextEndDate =
      dto.endDate === undefined
        ? existing.endDate
        : dto.endDate
          ? new Date(dto.endDate)
          : null;
    const nextStatus = dto.status ?? existing.status;
    const today = startOfUtcDay(new Date());
    const endDateTriggersAutoEnd =
      nextEndDate &&
      nextEndDate < today &&
      (nextStatus === MedicationRecordStatus.ACTIVE || nextStatus === MedicationRecordStatus.PAUSED);

    const statusPatch: Prisma.ServiceUserMedicationUncheckedUpdateInput = endDateTriggersAutoEnd
      ? {
          status: MedicationRecordStatus.ENDED,
          statusEndReason: MedicationStatusEndReason.END_DATE,
          statusEndedAt: nextEndDate,
          statusEndedById: null,
        }
      : nextStatus === MedicationRecordStatus.ACTIVE || nextStatus === MedicationRecordStatus.PAUSED
        ? clearStatusEndTracking()
        : {};

    const updateData: Prisma.ServiceUserMedicationUncheckedUpdateInput = {
      medicationPackId: dto.medicationPackId === undefined ? undefined : dto.medicationPackId,
      medicationName: dto.medicationName,
      dose: dto.dose,
      strength: dto.strength,
      startDate: dto.startDate === undefined ? undefined : dto.startDate ? new Date(dto.startDate) : null,
      endDate: dto.endDate === undefined ? undefined : dto.endDate ? new Date(dto.endDate) : null,
      medicationTypeId: dto.medicationTypeId,
      routeId: dto.routeId,
      categoryId: dto.categoryId,
      frequencyId: dto.frequencyId,
      frequencyText: dto.frequencyText,
      schedulePattern: dto.schedulePattern,
      frequencyIntervalDays: dto.frequencyIntervalDays,
      monthlyDayOfMonth: dto.monthlyDayOfMonth,
      monthlyAnchorToStartDate: dto.monthlyAnchorToStartDate,
      instructions: dto.instructions,
      notes: dto.notes,
      isControlledMedication: dto.isControlledMedication,
      isDecongestantMedication: dto.isDecongestantMedication,
      medicationKind: dto.medicationKind,
      status: endDateTriggersAutoEnd ? MedicationRecordStatus.ENDED : dto.status,
      updatedById: userId,
      ...statusPatch,
    };

    const updated = await this.prisma.serviceUserMedication.update({
      where: { id: medicationId },
      data: updateData,
      include: medInclude,
    });

    const oldS = auditSnapshot(existing);
    const newS = auditSnapshot(updated);
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_UPDATED,
      recordType: 'ServiceUserMedication',
      recordId: medicationId,
      oldValues: oldS,
      newValues: newS,
      metadata: {
        changedFields: this.audit.getChangedFields(oldS, newS),
        controlledMedication: updated.isControlledMedication,
        serviceUserId,
      },
      ...meta,
    });

    const nameForWarn = dto.medicationName ?? existing.medicationName;
    const allergies = await this.prisma.medicationAllergy.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
    });
    const warnings = buildAllergyWarnings(nameForWarn, allergies);

    return { data: updated, meta: { allergyWarnings: warnings } };
  }

  async remove(userId: string, serviceUserId: string, medicationId: string, meta: RequestAuditMeta) {
    const existing = await this.prisma.serviceUserMedication.findFirst({
      where: { id: medicationId, serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Medication not found');
    const now = new Date();
    const updated = await this.prisma.serviceUserMedication.update({
      where: { id: medicationId },
      data: { deletedAt: now, deletedById: userId, isActive: false, updatedById: userId },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_DELETED,
      recordType: 'ServiceUserMedication',
      recordId: medicationId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ...meta,
    });
    return { data: { id: medicationId, deleted: true } };
  }

  async restore(
    userId: string,
    serviceUserId: string,
    medicationId: string,
    meta: RequestAuditMeta,
  ) {
    const existing = await this.prisma.serviceUserMedication.findFirst({
      where: { id: medicationId, serviceUserId, deletedAt: { not: null } },
    });
    if (!existing) {
      throw new NotFoundException('Archived medication not found');
    }
    const updated = await this.prisma.serviceUserMedication.update({
      where: { id: medicationId },
      data: {
        deletedAt: null,
        deletedById: null,
        isActive: true,
        updatedById: userId,
      },
      include: medInclude,
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_RESTORED,
      recordType: 'ServiceUserMedication',
      recordId: medicationId,
      description: `Restored ${existing.medicationName} from archive`,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      metadata: {
        serviceUserId,
        restored: true,
        medicationName: existing.medicationName,
      },
      ...meta,
    });
    return { data: updated };
  }

  async patchStatus(
    userId: string,
    serviceUserId: string,
    medicationId: string,
    dto: UpdateMedicationStatusDto,
    meta: RequestAuditMeta,
  ) {
    const existing = await this.prisma.serviceUserMedication.findFirst({
      where: { id: medicationId, serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Medication not found');
    const now = new Date();
    const endDatePatch =
      dto.status === MedicationRecordStatus.ENDED && !existing.endDate
        ? { endDate: now }
        : {};
    const terminal =
      dto.status === MedicationRecordStatus.ENDED ||
      dto.status === MedicationRecordStatus.CANCELLED;
    const reactivated =
      dto.status === MedicationRecordStatus.ACTIVE ||
      dto.status === MedicationRecordStatus.PAUSED;
    const endTrackingPatch = terminal
      ? manualStatusEndPatch(userId, now)
      : reactivated
        ? clearStatusEndTracking()
        : {};
    const updated = await this.prisma.serviceUserMedication.update({
      where: { id: medicationId },
      data: {
        status: dto.status,
        updatedById: userId,
        ...endDatePatch,
        ...endTrackingPatch,
      },
      include: medInclude,
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_STATUS_CHANGED,
      recordType: 'ServiceUserMedication',
      recordId: medicationId,
      oldValues: {
        status: existing.status,
        statusEndReason: existing.statusEndReason,
      },
      newValues: {
        status: dto.status,
        statusEndReason: updated.statusEndReason,
      },
      metadata: { serviceUserId },
      ...meta,
    });
    return updated;
  }

  async medicationActivityLog(
    userId: string,
    serviceUserId: string,
    query: PaginationQueryDto,
    meta: RequestAuditMeta,
  ) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    await this.syncExpiredMedications(serviceUserId, meta);
    await this.logDataView(userId, serviceUserId, meta, 'medication_activity_log');
    const auditQuery: AuditLogQueryDto = {
      page: query.page,
      limit: query.limit,
      serviceUserId,
      module: AuditModule.MEDICATION,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    };
    return this.audit.findAuditLogs(auditQuery);
  }
}
