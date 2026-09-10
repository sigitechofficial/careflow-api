import { Injectable, NotFoundException } from '@nestjs/common';
import { ServiceUserClinicalDataSource } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { assertServiceUserAccessible } from './medical-access.util';
import type {
  CreateMedicalHistoryEventDto,
  UpdateMedicalHistoryEventDto,
} from './dto/medical.dto';

function mapHist(row: {
  id: string;
  serviceUserId: string;
  title: string;
  eventDate: Date | null;
  approximateDate: string | null;
  description: string;
  notes: string;
  source: ServiceUserClinicalDataSource;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    title: row.title,
    eventDate: row.eventDate?.toISOString().slice(0, 10) ?? null,
    approximateDate: row.approximateDate,
    description: row.description,
    notes: row.notes,
    source: row.source,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class MedicalHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  async list(user: RequestUser, serviceUserId: string) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    const rows = await this.prisma.serviceUserMedicalHistoryEvent.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
    });
    return { data: rows.map(mapHist) };
  }

  async create(
    user: RequestUser,
    serviceUserId: string,
    dto: CreateMedicalHistoryEventDto,
    meta?: RequestAuditMeta,
  ) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.serviceUserMedicalHistoryEvent.create({
        data: {
          serviceUserId,
          title: dto.title.trim(),
          eventDate: dto.eventDate ? new Date(dto.eventDate) : null,
          approximateDate: dto.approximateDate?.trim() || null,
          description: dto.description?.trim() ?? '',
          notes: dto.notes?.trim() ?? '',
          source: dto.source ?? ServiceUserClinicalDataSource.MANUAL,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_MEDICAL_HISTORY_CREATED,
        recordType: 'ServiceUserMedicalHistoryEvent',
        recordId: created.id,
        newValues: auditSnapshot({ id: created.id, serviceUserId, title: created.title }),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Medical history event recorded', data: mapHist(created) };
    });
  }

  async update(
    user: RequestUser,
    serviceUserId: string,
    id: string,
    dto: UpdateMedicalHistoryEventDto,
    meta?: RequestAuditMeta,
  ) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserMedicalHistoryEvent.findFirst({
        where: { id, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Medical history event not found');

      const updated = await tx.serviceUserMedicalHistoryEvent.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.eventDate !== undefined
            ? { eventDate: dto.eventDate ? new Date(dto.eventDate) : null }
            : {}),
          ...(dto.approximateDate !== undefined
            ? { approximateDate: dto.approximateDate?.trim() || null }
            : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          ...(dto.source !== undefined ? { source: dto.source } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedById: user.id,
        },
      });
      const oldS = auditSnapshot({ id: before.id, title: before.title, isActive: before.isActive });
      const newS = auditSnapshot({
        id: updated.id,
        title: updated.title,
        isActive: updated.isActive,
      });
      const deactivated = dto.isActive === false;
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.SERVICE_USER,
        action: deactivated
          ? AuditAction.SERVICE_USER_MEDICAL_HISTORY_DEACTIVATED
          : AuditAction.SERVICE_USER_MEDICAL_HISTORY_UPDATED,
        recordType: 'ServiceUserMedicalHistoryEvent',
        recordId: id,
        oldValues: oldS,
        newValues: newS,
        metadata: { serviceUserId, changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Medical history event updated', data: mapHist(updated) };
    });
  }

  async deactivate(user: RequestUser, serviceUserId: string, id: string, meta?: RequestAuditMeta) {
    return this.update(user, serviceUserId, id, { isActive: false }, meta);
  }
}
