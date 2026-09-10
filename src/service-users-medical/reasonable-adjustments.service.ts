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
  CreateReasonableAdjustmentDto,
  UpdateReasonableAdjustmentDto,
} from './dto/medical.dto';

function mapAdj(row: {
  id: string;
  serviceUserId: string;
  type: string;
  description: string;
  notes: string;
  isActive: boolean;
  source: ServiceUserClinicalDataSource;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    type: row.type,
    description: row.description,
    notes: row.notes,
    isActive: row.isActive,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ReasonableAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  async list(user: RequestUser, serviceUserId: string) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    const rows = await this.prisma.serviceUserReasonableAdjustment.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    });
    return { data: rows.map(mapAdj) };
  }

  async create(
    user: RequestUser,
    serviceUserId: string,
    dto: CreateReasonableAdjustmentDto,
    meta?: RequestAuditMeta,
  ) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.serviceUserReasonableAdjustment.create({
        data: {
          serviceUserId,
          type: dto.type,
          description: dto.description.trim(),
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
        action: AuditAction.SERVICE_USER_REASONABLE_ADJUSTMENT_CREATED,
        recordType: 'ServiceUserReasonableAdjustment',
        recordId: created.id,
        newValues: auditSnapshot({ id: created.id, serviceUserId, type: created.type }),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Reasonable adjustment recorded', data: mapAdj(created) };
    });
  }

  async update(
    user: RequestUser,
    serviceUserId: string,
    id: string,
    dto: UpdateReasonableAdjustmentDto,
    meta?: RequestAuditMeta,
  ) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserReasonableAdjustment.findFirst({
        where: { id, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Reasonable adjustment not found');

      const updated = await tx.serviceUserReasonableAdjustment.update({
        where: { id },
        data: {
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.source !== undefined ? { source: dto.source } : {}),
          updatedById: user.id,
        },
      });
      const oldS = auditSnapshot({ id: before.id, type: before.type, isActive: before.isActive });
      const newS = auditSnapshot({
        id: updated.id,
        type: updated.type,
        isActive: updated.isActive,
      });
      const deactivated = dto.isActive === false;
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.SERVICE_USER,
        action: deactivated
          ? AuditAction.SERVICE_USER_REASONABLE_ADJUSTMENT_DEACTIVATED
          : AuditAction.SERVICE_USER_REASONABLE_ADJUSTMENT_UPDATED,
        recordType: 'ServiceUserReasonableAdjustment',
        recordId: id,
        oldValues: oldS,
        newValues: newS,
        metadata: { serviceUserId, changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Reasonable adjustment updated', data: mapAdj(updated) };
    });
  }

  async deactivate(user: RequestUser, serviceUserId: string, id: string, meta?: RequestAuditMeta) {
    return this.update(user, serviceUserId, id, { isActive: false }, meta);
  }
}
