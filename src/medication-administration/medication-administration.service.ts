import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MedicationAdministrationStatus,
  MedicationKind,
  Prisma,
} from '@prisma/client';
import { DataAccessType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { assertActiveEmployee, assertServiceUserExists } from '../medications/medication.asserts';
import { validateMedicationAdministrationPayload } from '../medications/medication-administration.validation';
import { MedicationNotificationHook } from '../medications/medication-notification.hook';
import { MedicationAdministrationQueryDto, MedicationEventReportTypeFilter } from './dto/medication-administration-query.dto';
import { CreateMedicationAdministrationEventDto } from './dto/create-medication-administration-event.dto';

const eventInclude = {
  medication: {
    include: { medicationType: true, medicationPack: true, route: true, category: true },
  },
  schedule: { include: { round: true, frequency: true } },
  round: true,
  administeredBy: { include: { personalDetail: true } },
  route: true,
  notGivenReason: true,
} satisfies Prisma.MedicationAdministrationEventInclude;

function auditActionForStatus(status: MedicationAdministrationStatus): AuditAction {
  switch (status) {
    case MedicationAdministrationStatus.GIVEN:
      return AuditAction.MEDICATION_ADMINISTERED;
    case MedicationAdministrationStatus.NOT_GIVEN:
      return AuditAction.MEDICATION_NOT_GIVEN;
    case MedicationAdministrationStatus.REFUSED:
      return AuditAction.MEDICATION_REFUSED;
    case MedicationAdministrationStatus.MISSED:
      return AuditAction.MEDICATION_MISSED;
    case MedicationAdministrationStatus.HELD:
      return AuditAction.MEDICATION_HELD;
    default:
      return AuditAction.MEDICATION_ADMINISTERED;
  }
}

@Injectable()
export class MedicationAdministrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly medNotifications: MedicationNotificationHook,
  ) {}

  private async logData(userId: string, serviceUserId: string, meta: RequestAuditMeta, detail: string) {
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.MEDICATION,
      recordType: 'MedicationAdministrationEvent',
      recordId: serviceUserId,
      accessType: DataAccessType.VIEW,
      ...meta,
      metadata: { detail },
    });
  }

  async list(
    userId: string,
    serviceUserId: string,
    query: MedicationAdministrationQueryDto,
    meta: RequestAuditMeta,
  ) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    await this.logData(userId, serviceUserId, meta, 'medication_events_list');

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.MedicationAdministrationEventWhereInput = {
      serviceUserId,
      deletedAt: null,
      isActive: true,
    };

    if (query.medicationId) where.serviceUserMedicationId = query.medicationId;
    if (query.status) where.status = query.status;
    if (query.administeredById) where.administeredById = query.administeredById;
    if (query.roundId) where.roundId = query.roundId;
    if (query.isPrn !== undefined) where.isPrn = query.isPrn;

    if (query.reportType === MedicationEventReportTypeFilter.GIVEN) {
      where.status = MedicationAdministrationStatus.GIVEN;
    } else if (query.reportType === MedicationEventReportTypeFilter.NOT_GIVEN) {
      where.status = { in: [MedicationAdministrationStatus.NOT_GIVEN, MedicationAdministrationStatus.REFUSED] };
    } else if (query.reportType === MedicationEventReportTypeFilter.MISSED) {
      where.status = MedicationAdministrationStatus.MISSED;
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const orderField = ['createdAt', 'actualDateTime', 'scheduledDateTime'].includes(query.sortBy ?? '')
      ? (query.sortBy as string)
      : 'createdAt';
    const dir = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const [rows, total] = await Promise.all([
      this.prisma.medicationAdministrationEvent.findMany({
        where,
        include: eventInclude,
        orderBy: { [orderField]: dir },
        skip,
        take: limit,
      }),
      this.prisma.medicationAdministrationEvent.count({ where }),
    ]);

    return {
      data: rows,
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async findOne(userId: string, serviceUserId: string, eventId: string, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    await this.logData(userId, serviceUserId, meta, 'medication_event_detail');
    const row = await this.prisma.medicationAdministrationEvent.findFirst({
      where: { id: eventId, serviceUserId, deletedAt: null },
      include: eventInclude,
    });
    if (!row) throw new NotFoundException('Medication administration event not found');
    return row;
  }

  async create(
    userId: string,
    serviceUserId: string,
    dto: CreateMedicationAdministrationEventDto,
    meta: RequestAuditMeta,
  ) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    const med = await this.prisma.serviceUserMedication.findFirst({
      where: { id: dto.serviceUserMedicationId, serviceUserId, deletedAt: null },
    });
    if (!med) throw new BadRequestException('Medication does not belong to this service user');

    await assertActiveEmployee(this.prisma, dto.administeredById);

    validateMedicationAdministrationPayload(dto, med.medicationKind);

    if (dto.medicationScheduleId && dto.scheduledDateTime) {
      const dup = await this.prisma.medicationAdministrationEvent.findFirst({
        where: {
          serviceUserMedicationId: dto.serviceUserMedicationId,
          medicationScheduleId: dto.medicationScheduleId,
          scheduledDateTime: new Date(dto.scheduledDateTime),
          deletedAt: null,
        },
      });
      if (dup) {
        throw new BadRequestException('An administration event already exists for this schedule and time');
      }
    }

    if (dto.medicationScheduleId) {
      const sch = await this.prisma.medicationSchedule.findFirst({
        where: { id: dto.medicationScheduleId, serviceUserMedicationId: dto.serviceUserMedicationId, deletedAt: null },
      });
      if (!sch) throw new BadRequestException('Invalid medication schedule for this medication');
    }

    const isPrn = dto.isPrn ?? med.medicationKind === MedicationKind.PRN;

    const created = await this.prisma.medicationAdministrationEvent.create({
      data: {
        serviceUserId,
        serviceUserMedicationId: dto.serviceUserMedicationId,
        medicationScheduleId: dto.medicationScheduleId,
        roundId: dto.roundId,
        administeredById: dto.administeredById,
        scheduledDateTime: dto.scheduledDateTime ? new Date(dto.scheduledDateTime) : undefined,
        actualDateTime: dto.actualDateTime ? new Date(dto.actualDateTime) : undefined,
        status: dto.status,
        notGivenReasonId: dto.notGivenReasonId,
        reason: dto.reason,
        notes: dto.notes,
        doseGiven: dto.doseGiven,
        routeId: dto.routeId,
        visitId: dto.visitId,
        isPrn,
        prnReason: dto.prnReason,
        prnOutcome: dto.prnOutcome,
        createdById: userId,
        updatedById: userId,
      },
      include: eventInclude,
    });

    const action = auditActionForStatus(dto.status);
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action,
      recordType: 'MedicationAdministrationEvent',
      recordId: created.id,
      newValues: auditSnapshot(created),
      metadata: {
        serviceUserId,
        controlledMedication: med.isControlledMedication,
      },
      ...meta,
    });

    const hookMeta = {
      serviceUserId,
      medicationId: med.id,
      eventId: created.id,
      status: dto.status,
      controlledMedication: med.isControlledMedication,
    };

    if (med.isControlledMedication) {
      await this.medNotifications.medicationAlert({
        recipientUserIds: [],
        title: 'Controlled medication event',
        message: `${med.medicationName}: ${dto.status}`,
        metadata: hookMeta,
      });
    }
    if (dto.status === MedicationAdministrationStatus.MISSED) {
      await this.medNotifications.medicationAlert({
        recipientUserIds: [],
        title: 'Medication missed',
        message: `${med.medicationName} was recorded as missed`,
        metadata: hookMeta,
      });
    }
    if (dto.status === MedicationAdministrationStatus.REFUSED) {
      await this.medNotifications.medicationAlert({
        recipientUserIds: [],
        title: 'Medication refused',
        message: `${med.medicationName} was refused`,
        metadata: hookMeta,
      });
    }

    return created;
  }
}
