import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { VisitTimelineService } from '../employee-app/visit-timeline.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditEventType } from '@prisma/client';
import { CreateServiceUserObservationDto } from './dto/create-service-user-observation.dto';
import type { ObservationQueryDto } from './dto/observation-query.dto';
import { validateObservationCreate } from './observation-payload.validation';

type ObservationRow = Prisma.ServiceUserObservationGetPayload<{
  include: {
    observationType: true;
    shares: { include: { shareTarget: true } };
    wellbeingScores: { include: { dimension: true } };
    recordedByUser: { select: { id: true; firstName: true; lastName: true; email: true } };
    recordedByEmployee: {
      include: { personalDetail: { select: { firstName: true; lastName: true } } };
    };
  };
}>;

function carerDisplayName(row: ObservationRow): string | null {
  if (row.recordedByEmployee?.personalDetail) {
    const { firstName, lastName } = row.recordedByEmployee.personalDetail;
    const name = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (name) return name;
  }
  if (row.recordedByUser) {
    const { firstName, lastName, email } = row.recordedByUser;
    const name = [firstName, lastName].filter(Boolean).join(' ').trim();
    return name || email;
  }
  return null;
}

function formatObservationValueLabel(obs: {
  numericValue: number | null;
  unit: string | null;
  payload: unknown;
}): string | null {
  if (obs.numericValue != null) {
    const unit = obs.unit?.trim();
    return unit ? `${obs.numericValue} ${unit}` : String(obs.numericValue);
  }
  if (obs.payload && typeof obs.payload === 'object' && !Array.isArray(obs.payload)) {
    const p = obs.payload as Record<string, unknown>;
    const parts = Object.entries(p)
      .filter(([, v]) => v != null && v !== '')
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${v}`);
    if (parts.length > 0) return parts.join(', ');
  }
  return null;
}

function mapObservation(row: ObservationRow) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    observationType: {
      id: row.observationType.id,
      code: row.observationType.code,
      name: row.observationType.name,
      valueKind: row.observationType.valueKind,
      usesNews2: row.observationType.usesNews2,
      unitLabel: row.observationType.unitLabel,
    },
    recordedAt: row.recordedAt.toISOString(),
    notes: row.notes,
    numericValue: row.numericValue != null ? Number(row.numericValue) : null,
    unit: row.unit,
    payload: row.payload,
    shareTargets: row.shares.map((s) => ({
      code: s.shareTarget.code,
      name: s.shareTarget.name,
    })),
    wellbeingScores: row.wellbeingScores.map((s) => ({
      dimensionCode: s.dimension.code,
      dimensionName: s.dimension.name,
      level: s.level,
    })),
    carerName: carerDisplayName(row),
    recordedByUserId: row.recordedByUserId,
    recordedByEmployeeId: row.recordedByEmployeeId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const observationInclude = {
  observationType: true,
  shares: { include: { shareTarget: true } },
  wellbeingScores: { include: { dimension: true } },
  recordedByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
  recordedByEmployee: {
    include: { personalDetail: { select: { firstName: true, lastName: true } } },
  },
} satisfies Prisma.ServiceUserObservationInclude;

@Injectable()
export class ServiceUserObservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    @Optional() private readonly visitTimeline?: VisitTimelineService,
  ) {}

  /** Office observation recorded on a visit → office row in that visit Log (Office tag + who). */
  private async logOfficeObservationOnVisit(input: {
    userId: string;
    serviceUserId: string;
    scheduledJobId: string | undefined;
    observationId: string;
    typeName: string;
    valueLabel: string | null;
  }): Promise<void> {
    if (!this.visitTimeline || !input.scheduledJobId) return;
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: input.scheduledJobId, serviceUserId: input.serviceUserId, deletedAt: null },
      select: { id: true, visits: { where: { deletedAt: null }, select: { id: true }, take: 1 } },
    });
    if (!job) return;
    await this.visitTimeline.upsertEvent({
      scheduledJobId: job.id,
      scheduledVisitId: job.visits[0]?.id ?? null,
      eventType: 'observation',
      sourceType: 'observation',
      sourceId: input.observationId,
      title: input.typeName,
      detail: input.valueLabel,
      tone: 'teal',
      occurredAt: new Date(),
      actorKind: 'office',
      createdByUserId: input.userId,
    });
  }

  private async ensureServiceUser(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
    });
    if (!u) throw new NotFoundException('Service user not found');
  }

  private async resolveType(code: string) {
    const type = await this.prisma.observationType.findFirst({
      where: { code: code.toUpperCase(), isActive: true },
    });
    if (!type) throw new BadRequestException('Invalid observation type');
    return type;
  }


  async list(serviceUserId: string, query: ObservationQueryDto) {
    await this.ensureServiceUser(serviceUserId);

    const typeFilter = query.typeCode
      ? await this.resolveType(query.typeCode)
      : null;

    const rows = await this.prisma.serviceUserObservation.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        ...(typeFilter ? { observationTypeId: typeFilter.id } : {}),
      },
      orderBy: { recordedAt: 'desc' },
      include: observationInclude,
    });

    return { data: rows.map(mapObservation) };
  }

  async create(
    userId: string,
    serviceUserId: string,
    dto: CreateServiceUserObservationDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const type = await this.resolveType(dto.observationTypeCode);
    validateObservationCreate(type.code, type.valueKind, dto);

    const recordedAt = new Date(dto.recordedAt);
    if (Number.isNaN(recordedAt.getTime())) {
      throw new BadRequestException('recordedAt must be a valid ISO date-time');
    }

    const shareCodes = (dto.shareTargetCodes ?? []).map((c) => c.toUpperCase());
    const shareTargets =
      shareCodes.length > 0
        ? await this.prisma.observationShareTarget.findMany({
            where: { code: { in: shareCodes }, isActive: true },
          })
        : [];
    if (shareCodes.length > 0 && shareTargets.length !== shareCodes.length) {
      throw new BadRequestException('One or more share targets are invalid');
    }

    const dimensionCodes = (dto.wellbeingScores ?? []).map((s) => s.dimensionCode.toUpperCase());
    const dimensions =
      dimensionCodes.length > 0
        ? await this.prisma.wellbeingDimension.findMany({
            where: { code: { in: dimensionCodes }, isActive: true },
          })
        : [];
    if (dimensionCodes.length > 0 && dimensions.length !== dimensionCodes.length) {
      throw new BadRequestException('One or more wellbeing dimensions are invalid');
    }
    const dimensionByCode = new Map(dimensions.map((d) => [d.code, d]));

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.serviceUserObservation.create({
        data: {
          serviceUserId,
          observationTypeId: type.id,
          recordedAt,
          notes: dto.notes?.trim() || null,
          numericValue: dto.numericValue != null ? dto.numericValue : null,
          unit: dto.unit?.trim() || type.unitLabel,
          payload: dto.payload != null ? (dto.payload as Prisma.InputJsonValue) : undefined,
          recordedByUserId: userId,
          createdById: userId,
          shares:
            shareTargets.length > 0
              ? {
                  create: shareTargets.map((t) => ({ shareTargetId: t.id })),
                }
              : undefined,
          wellbeingScores:
            dto.wellbeingScores && dto.wellbeingScores.length > 0
              ? {
                  create: dto.wellbeingScores.map((s) => {
                    const dim = dimensionByCode.get(s.dimensionCode.toUpperCase());
                    if (!dim) throw new BadRequestException('Invalid wellbeing dimension');
                    return { dimensionId: dim.id, level: s.level };
                  }),
                }
              : undefined,
        },
      });

      const full = await tx.serviceUserObservation.findUniqueOrThrow({
        where: { id: created.id },
        include: observationInclude,
      });

      const mapped = mapObservation(full);
      const typeName = full.observationType.name;
      const valueLabel = formatObservationValueLabel(mapped);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.OBSERVATION,
        action: AuditAction.SERVICE_USER_OBSERVATION_CREATED,
        eventType: AuditEventType.CREATE,
        recordType: 'ServiceUserObservation',
        recordId: full.id,
        description: valueLabel
          ? `Recorded ${typeName}: ${valueLabel}`
          : `Recorded ${typeName}`,
        newValues: auditSnapshot(mapped),
        metadata: {
          serviceUserId,
          observationTypeName: typeName,
          observationTypeCode: full.observationType.code,
          valueLabel,
        },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return {
        message: 'Observation recorded',
        data: mapped,
        logInfo: { id: full.id, typeName, valueLabel: valueLabel || null },
      };
    });

    await this.logOfficeObservationOnVisit({
      userId,
      serviceUserId,
      scheduledJobId: dto.scheduledJobId,
      observationId: result.logInfo.id,
      typeName: result.logInfo.typeName,
      valueLabel: result.logInfo.valueLabel,
    });
    return { message: result.message, data: result.data };
  }

  async remove(
    userId: string,
    serviceUserId: string,
    observationId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserObservation.findFirst({
        where: { id: observationId, serviceUserId, deletedAt: null },
        include: observationInclude,
      });
      if (!before) throw new NotFoundException('Observation not found');

      const deleted = await tx.serviceUserObservation.update({
        where: { id: observationId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
        include: observationInclude,
      });

      const mapped = mapObservation(deleted);
      const typeName = before.observationType.name;
      const valueLabel = formatObservationValueLabel(mapObservation(before));
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.OBSERVATION,
        action: AuditAction.SERVICE_USER_OBSERVATION_DELETED,
        eventType: AuditEventType.DELETE,
        recordType: 'ServiceUserObservation',
        recordId: deleted.id,
        description: valueLabel
          ? `Removed ${typeName}: ${valueLabel}`
          : `Removed ${typeName}`,
        oldValues: auditSnapshot(mapObservation(before)),
        newValues: auditSnapshot(mapped),
        metadata: {
          serviceUserId,
          observationTypeName: typeName,
          observationTypeCode: before.observationType.code,
          valueLabel,
        },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Observation removed', data: mapped };
    });
  }
}
