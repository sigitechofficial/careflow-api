import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MedicationKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { assertServiceUserExists } from '../medications/medication.asserts';
import { CreateMedicationScheduleDto } from './dto/create-medication-schedule.dto';
import { UpdateMedicationScheduleDto } from './dto/update-medication-schedule.dto';
import { MedicationSchedulePreviewDto } from './dto/medication-schedule-preview.dto';
import {
  computeSchedulePreview,
  defaultPreviewEndDate,
} from './medication-schedule-preview.util';

const scheduleInclude = {
  round: true,
  frequency: true,
} satisfies Prisma.MedicationScheduleInclude;

@Injectable()
export class MedicationSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async ensureMedication(serviceUserId: string, medicationId: string) {
    const med = await this.prisma.serviceUserMedication.findFirst({
      where: { id: medicationId, serviceUserId, deletedAt: null },
    });
    if (!med) throw new NotFoundException('Medication not found');
    if (med.medicationKind !== MedicationKind.REGULAR) {
      throw new BadRequestException('Schedules apply to regular medications only');
    }
    return med;
  }

  private validateDates(start?: string | null, end?: string | null) {
    if (start && end && new Date(end).getTime() < new Date(start).getTime()) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
  }

  async preview(serviceUserId: string, dto: MedicationSchedulePreviewDto) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    const endDate = dto.endDate ?? defaultPreviewEndDate(dto.startDate, dto.previewDays ?? 30);
    const roundIds = [
      ...new Set(dto.schedules.map(s => s.roundId).filter((id): id is string => Boolean(id))),
    ];
    const rounds =
      roundIds.length > 0
        ? await this.prisma.medicationAdministrationRound.findMany({
            where: { id: { in: roundIds }, deletedAt: null },
            select: { id: true, name: true, time: true },
          })
        : [];
    const roundById = new Map(rounds.map(r => [r.id, r]));
    const schedules = dto.schedules.map(s => {
      const round = s.roundId ? roundById.get(s.roundId) : undefined;
      return {
        dueTime: s.dueTime,
        dueVisitName: s.dueVisitName,
        roundId: s.roundId,
        roundName: round?.name ?? null,
        daysOfWeek: s.daysOfWeek ?? [],
      };
    });
    const data = computeSchedulePreview({
      startDate: dto.startDate,
      endDate,
      medicationKind: dto.medicationKind ?? MedicationKind.REGULAR,
      schedulePattern: dto.schedulePattern,
      frequencyIntervalDays: dto.frequencyIntervalDays,
      monthlyDayOfMonth: dto.monthlyDayOfMonth,
      monthlyAnchorToStartDate: dto.monthlyAnchorToStartDate,
      schedules,
    });
    return { data };
  }

  async list(serviceUserId: string, medicationId: string) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    await this.ensureMedication(serviceUserId, medicationId);
    return this.prisma.medicationSchedule.findMany({
      where: { serviceUserMedicationId: medicationId, deletedAt: null, isActive: true },
      include: scheduleInclude,
      orderBy: [{ dueTime: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(
    userId: string,
    serviceUserId: string,
    medicationId: string,
    dto: CreateMedicationScheduleDto,
    meta: RequestAuditMeta,
  ) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    await this.ensureMedication(serviceUserId, medicationId);
    this.validateDates(dto.startDate, dto.endDate);
    const created = await this.prisma.medicationSchedule.create({
      data: {
        serviceUserMedicationId: medicationId,
        roundId: dto.roundId,
        dueTime: dto.dueTime,
        dueVisitName: dto.dueVisitName,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        frequencyId: dto.frequencyId,
        frequencyText: dto.frequencyText,
        daysOfWeek: dto.daysOfWeek ?? [],
        instructions: dto.instructions,
        createdById: userId,
        updatedById: userId,
      },
      include: scheduleInclude,
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_SCHEDULE_CREATED,
      recordType: 'MedicationSchedule',
      recordId: created.id,
      newValues: auditSnapshot(created),
      metadata: { serviceUserId, medicationId },
      ...meta,
    });
    return created;
  }

  async update(
    userId: string,
    serviceUserId: string,
    medicationId: string,
    scheduleId: string,
    dto: UpdateMedicationScheduleDto,
    meta: RequestAuditMeta,
  ) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    await this.ensureMedication(serviceUserId, medicationId);
    const existing = await this.prisma.medicationSchedule.findFirst({
      where: { id: scheduleId, serviceUserMedicationId: medicationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Schedule not found');
    this.validateDates(dto.startDate ?? existing.startDate?.toISOString(), dto.endDate ?? existing.endDate?.toISOString());
    const updated = await this.prisma.medicationSchedule.update({
      where: { id: scheduleId },
      data: {
        roundId: dto.roundId,
        dueTime: dto.dueTime,
        dueVisitName: dto.dueVisitName,
        startDate: dto.startDate === undefined ? undefined : dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate === undefined ? undefined : dto.endDate ? new Date(dto.endDate) : null,
        frequencyId: dto.frequencyId,
        frequencyText: dto.frequencyText,
        daysOfWeek: dto.daysOfWeek,
        instructions: dto.instructions,
        updatedById: userId,
      },
      include: scheduleInclude,
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_SCHEDULE_UPDATED,
      recordType: 'MedicationSchedule',
      recordId: scheduleId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ...meta,
    });
    return updated;
  }

  async remove(userId: string, serviceUserId: string, medicationId: string, scheduleId: string, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    await this.ensureMedication(serviceUserId, medicationId);
    const existing = await this.prisma.medicationSchedule.findFirst({
      where: { id: scheduleId, serviceUserMedicationId: medicationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Schedule not found');
    await this.prisma.medicationSchedule.update({
      where: { id: scheduleId },
      data: { deletedAt: new Date(), deletedById: userId, isActive: false, updatedById: userId },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_SCHEDULE_DELETED,
      recordType: 'MedicationSchedule',
      recordId: scheduleId,
      oldValues: auditSnapshot(existing),
      ...meta,
    });
    return { id: scheduleId, deleted: true };
  }
}
