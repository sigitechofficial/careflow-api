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
import { UpdateMedicationAdministrationEventDto } from './dto/update-medication-administration-event.dto';
import { administrationStatusToCode } from '../medication-charts/medication-chart-display.util';
import {
  resolveAdministrationFromEnumOnly,
  resolveAdministrationFromStatusCode,
  type StatusCodeResolution,
} from '../medication-status-codes/medication-status-code-resolution.util';

const eventInclude = {
  medication: {
    include: { medicationType: true, medicationPack: true, route: true, category: true },
  },
  schedule: { include: { round: true, frequency: true } },
  round: true,
  administeredBy: { include: { personalDetail: true } },
  enteredBy: true,
  createdBy: true,
  managerReviewedBy: true,
  route: true,
  notGivenReason: true,
} satisfies Prisma.MedicationAdministrationEventInclude;

const REVIEWABLE_STATUSES: MedicationAdministrationStatus[] = [
  MedicationAdministrationStatus.REFUSED,
  MedicationAdministrationStatus.MISSED,
  MedicationAdministrationStatus.NOT_GIVEN,
  MedicationAdministrationStatus.HELD,
];

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

    if (query.medicationIds) {
      const ids = query.medicationIds
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids.length > 0) where.serviceUserMedicationId = { in: ids };
    } else if (query.medicationId) where.serviceUserMedicationId = query.medicationId;
    if (query.statusCode) {
      where.statusCode = query.statusCode.trim();
    } else if (query.status) {
      where.status = query.status;
    }
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

    if (query.needsReview) {
      where.status = { in: REVIEWABLE_STATUSES };
      where.managerReviewedAt = null;
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
      include: { route: true },
    });
    if (!med) throw new BadRequestException('Medication does not belong to this service user');

    if (dto.recordOnBehalfOfCarer && !dto.administeredById) {
      throw new BadRequestException('administeredById is required when recording on behalf of a carer');
    }
    await assertActiveEmployee(this.prisma, dto.administeredById);

    const enteredById = dto.recordOnBehalfOfCarer && dto.administeredById ? userId : undefined;

    const resolved = await this.resolveAdministrationInput(dto);
    if (resolved.statusCode === 'Pending') {
      throw new BadRequestException('Pending is not a recordable status');
    }

    const payload = { ...dto, status: resolved.status };
    validateMedicationAdministrationPayload(payload, med.medicationKind);

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

    let scheduleDose: string | null = null;
    if (dto.medicationScheduleId) {
      const sch = await this.prisma.medicationSchedule.findFirst({
        where: { id: dto.medicationScheduleId, serviceUserMedicationId: dto.serviceUserMedicationId, deletedAt: null },
      });
      if (!sch) throw new BadRequestException('Invalid medication schedule for this medication');
      scheduleDose = sch.dose;
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
        status: resolved.status,
        statusCode: resolved.statusCode,
        statusCodeId: resolved.statusCodeId ?? undefined,
        notGivenReasonId: dto.notGivenReasonId,
        reason: dto.reason,
        notes: dto.notes,
        doseGiven: dto.doseGiven,
        routeId: dto.routeId,
        visitId: dto.visitId,
        isPrn,
        prnReason: dto.prnReason,
        prnOutcome: dto.prnOutcome,
        enteredById,
        medicationNameSnapshot: med.medicationName,
        doseSnapshot: scheduleDose ?? med.dose,
        strengthSnapshot: med.strength,
        routeNameSnapshot: med.route?.name ?? null,
        createdById: userId,
        updatedById: userId,
      },
      include: eventInclude,
    });

    const action = auditActionForStatus(resolved.status);
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
      status: resolved.status,
      controlledMedication: med.isControlledMedication,
    };

    if (med.isControlledMedication) {
      await this.medNotifications.medicationAlert({
        recipientUserIds: [],
        title: 'Controlled medication event',
        message: `${med.medicationName}: ${resolved.status}`,
        metadata: hookMeta,
      });
    }
    if (resolved.status === MedicationAdministrationStatus.MISSED) {
      await this.medNotifications.medicationAlert({
        recipientUserIds: [],
        title: 'Medication missed',
        message: `${med.medicationName} was recorded as missed`,
        metadata: hookMeta,
      });
    }
    if (resolved.status === MedicationAdministrationStatus.REFUSED) {
      await this.medNotifications.medicationAlert({
        recipientUserIds: [],
        title: 'Medication refused',
        message: `${med.medicationName} was refused`,
        metadata: hookMeta,
      });
    }

    return created;
  }

  async update(
    userId: string,
    serviceUserId: string,
    eventId: string,
    dto: UpdateMedicationAdministrationEventDto,
    meta: RequestAuditMeta,
  ) {
    const existing = await this.prisma.medicationAdministrationEvent.findFirst({
      where: { id: eventId, serviceUserId, deletedAt: null },
      include: { medication: true },
    });
    if (!existing) throw new NotFoundException('Medication administration event not found');

    if (!dto.correctionNotes?.trim()) {
      throw new BadRequestException('correctionNotes is required when correcting a record');
    }

    const resolved =
      dto.statusCode?.trim() || dto.status
        ? await this.resolveAdministrationInput(
            { status: dto.status, statusCode: dto.statusCode },
            existing,
          )
        : {
            status: existing.status,
            statusCode: existing.statusCode ?? administrationStatusToCode(existing.status),
            statusCodeId: existing.statusCodeId,
          };

    const payload = {
      status: resolved.status,
      actualDateTime: existing.actualDateTime,
      reason: dto.reason ?? existing.reason,
      notGivenReasonId: existing.notGivenReasonId,
      isPrn: existing.isPrn,
      prnReason: existing.prnReason,
      prnOutcome: existing.prnOutcome,
      notes: dto.notes ?? existing.notes,
    };
    validateMedicationAdministrationPayload(payload, existing.medication.medicationKind);

    const updated = await this.prisma.medicationAdministrationEvent.update({
      where: { id: eventId },
      data: {
        status: resolved.status,
        statusCode: resolved.statusCode,
        statusCodeId: resolved.statusCodeId ?? undefined,
        reason: dto.reason ?? existing.reason,
        notes: dto.notes ?? existing.notes,
        doseGiven: dto.doseGiven ?? existing.doseGiven,
        correctionReason: dto.correctionReason ?? 'Correction',
        correctionNotes: dto.correctionNotes,
        updatedById: userId,
      },
      include: eventInclude,
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_ADMINISTERED,
      recordType: 'MedicationAdministrationEvent',
      recordId: eventId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      metadata: { serviceUserId, correction: true },
      ...meta,
    });

    return updated;
  }

  async review(
    userId: string,
    serviceUserId: string,
    eventId: string,
    notes: string | undefined,
    meta: RequestAuditMeta,
  ) {
    const existing = await this.prisma.medicationAdministrationEvent.findFirst({
      where: { id: eventId, serviceUserId, deletedAt: null },
      include: { medication: true },
    });
    if (!existing) throw new NotFoundException('Medication administration event not found');

    if (!REVIEWABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException('This administration status does not require manager review');
    }
    if (existing.managerReviewedAt) {
      throw new BadRequestException('This record has already been reviewed');
    }

    const updated = await this.prisma.medicationAdministrationEvent.update({
      where: { id: eventId },
      data: {
        managerReviewedAt: new Date(),
        managerReviewedById: userId,
        managerReviewNotes: notes?.trim() || null,
        updatedById: userId,
      },
      include: eventInclude,
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_REVIEW_UPDATED,
      recordType: 'MedicationAdministrationEvent',
      recordId: eventId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      metadata: { serviceUserId, managerReview: true },
      ...meta,
    });

    return updated;
  }

  /** MAR status code is source of truth; coarse enum is derived from configured row. */
  private async resolveAdministrationInput(
    dto: { status?: MedicationAdministrationStatus; statusCode?: string },
    existing?: {
      status: MedicationAdministrationStatus;
      statusCode: string | null;
      statusCodeId: string | null;
    },
  ): Promise<StatusCodeResolution> {
    const codeInput = dto.statusCode?.trim();
    if (codeInput) {
      const row = await this.prisma.medicationStatusCode.findFirst({
        where: { code: codeInput, deletedAt: null, isActive: true },
        select: { id: true, code: true, administrationStatus: true },
      });
      return resolveAdministrationFromStatusCode(codeInput, row);
    }
    if (dto.status) {
      const fallbackCode = administrationStatusToCode(dto.status);
      const row = await this.prisma.medicationStatusCode.findFirst({
        where: { code: fallbackCode, deletedAt: null, isActive: true },
        select: { id: true, code: true, administrationStatus: true },
      });
      if (row) {
        return {
          status: row.administrationStatus,
          statusCode: row.code,
          statusCodeId: row.id,
        };
      }
      return resolveAdministrationFromEnumOnly(dto.status, fallbackCode);
    }
    if (existing?.statusCode) {
      const row = existing.statusCodeId
        ? await this.prisma.medicationStatusCode.findFirst({
            where: { id: existing.statusCodeId, deletedAt: null },
            select: { id: true, code: true, administrationStatus: true },
          })
        : await this.prisma.medicationStatusCode.findFirst({
            where: { code: existing.statusCode, deletedAt: null, isActive: true },
            select: { id: true, code: true, administrationStatus: true },
          });
      if (row) {
        return {
          status: row.administrationStatus,
          statusCode: row.code,
          statusCodeId: row.id,
        };
      }
      return resolveAdministrationFromStatusCode(existing.statusCode, null);
    }
    if (existing) {
      return resolveAdministrationFromEnumOnly(
        existing.status,
        administrationStatusToCode(existing.status),
      );
    }
    throw new BadRequestException('Either status or statusCode is required');
  }
}
