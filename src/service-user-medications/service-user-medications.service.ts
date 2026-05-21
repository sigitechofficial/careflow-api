import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MedicationRecordStatus,
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

const medInclude = {
  medicationType: true,
  route: true,
  category: true,
  frequency: true,
  medicationPack: { select: { id: true, name: true } },
  schedules: {
    where: { deletedAt: null, isActive: true },
    orderBy: [{ dueTime: 'asc' as const }, { createdAt: 'asc' as const }],
    select: {
      id: true,
      dueTime: true,
      dueVisitName: true,
      roundId: true,
      frequencyText: true,
    },
  },
} satisfies Prisma.ServiceUserMedicationInclude;

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

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
      metadata: { detail },
    });
  }

  async list(userId: string, serviceUserId: string, query: ServiceUserMedicationQueryDto, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    await this.logDataView(userId, serviceUserId, meta, 'medications_list');

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.ServiceUserMedicationWhereInput = {
      serviceUserId,
      deletedAt: null,
      isActive: true,
    };

    if (query.medicationKind) where.medicationKind = query.medicationKind;
    if (query.status) {
      where.status = query.status;
    } else if (!query.showPastEndDate) {
      where.status = { in: [MedicationRecordStatus.ACTIVE, MedicationRecordStatus.PAUSED] };
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.medicationTypeId) where.medicationTypeId = query.medicationTypeId;
    if (query.routeId) where.routeId = query.routeId;
    if (query.isControlledMedication !== undefined) where.isControlledMedication = query.isControlledMedication;

    if (query.search?.trim()) {
      where.medicationName = { contains: query.search.trim(), mode: 'insensitive' };
    }

    const today = startOfUtcDay(new Date());
    if (!query.showPastEndDate) {
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

  private buildScheduleFrequencyText(
    dto: CreateServiceUserMedicationDto,
  ): string | undefined {
    if (dto.frequencyIntervalDays != null) {
      return `Every ${dto.frequencyIntervalDays} day(s)`;
    }
    return dto.frequencyText;
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

    const allergies = await this.prisma.medicationAllergy.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
    });
    const warnings = buildAllergyWarnings(dto.medicationName, allergies);
    const scheduleFrequencyText = this.buildScheduleFrequencyText(dto);

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
          frequencyId: dto.frequencyId,
          frequencyText: scheduleFrequencyText ?? dto.frequencyText,
          instructions: dto.instructions,
          notes: dto.notes,
          isControlledMedication: dto.isControlledMedication ?? false,
          medicationKind: dto.medicationKind,
          status: dto.status ?? MedicationRecordStatus.ACTIVE,
          createdById: userId,
          updatedById: userId,
        },
      });

      if (dto.schedules?.length) {
        for (const slot of dto.schedules) {
          const schedule = await tx.medicationSchedule.create({
            data: {
              serviceUserMedicationId: med.id,
              roundId: slot.roundId,
              dueTime: slot.dueTime,
              dueVisitName: slot.dueVisitName,
              startDate: dto.startDate ? new Date(dto.startDate) : undefined,
              endDate: dto.endDate ? new Date(dto.endDate) : undefined,
              frequencyId: dto.frequencyId,
              frequencyText: scheduleFrequencyText,
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

    const updated = await this.prisma.serviceUserMedication.update({
      where: { id: medicationId },
      data: {
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
        instructions: dto.instructions,
        notes: dto.notes,
        isControlledMedication: dto.isControlledMedication,
        medicationKind: dto.medicationKind,
        status: dto.status,
        updatedById: userId,
      },
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
    const updated = await this.prisma.serviceUserMedication.update({
      where: { id: medicationId },
      data: { status: dto.status, updatedById: userId },
      include: medInclude,
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_STATUS_CHANGED,
      recordType: 'ServiceUserMedication',
      recordId: medicationId,
      oldValues: { status: existing.status },
      newValues: { status: dto.status },
      ...meta,
    });
    return updated;
  }
}
