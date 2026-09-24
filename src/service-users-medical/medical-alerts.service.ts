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
  CreateMedicalAlertDto,
  UpdateMedicalAlertDto,
} from './dto/medical.dto';

function mapAlert(row: {
  id: string;
  serviceUserId: string;
  title: string;
  category: string | null;
  severity: string | null;
  description: string;
  actionForCarer: string;
  notes: string;
  isActive: boolean;
  source: ServiceUserClinicalDataSource;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    title: row.title,
    category: row.category,
    severity: row.severity,
    description: row.description,
    actionForCarer: row.actionForCarer,
    notes: row.notes,
    isActive: row.isActive,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class MedicalAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  async list(user: RequestUser, serviceUserId: string) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    const rows = await this.prisma.serviceUserMedicalAlert.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    });
    return { data: rows.map(mapAlert) };
  }

  async create(
    user: RequestUser,
    serviceUserId: string,
    dto: CreateMedicalAlertDto,
    meta?: RequestAuditMeta,
  ) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.serviceUserMedicalAlert.create({
        data: {
          serviceUserId,
          title: dto.title.trim(),
          category: dto.category,
          severity: dto.severity,
          description: dto.description?.trim() ?? '',
          actionForCarer: dto.actionForCarer?.trim() ?? '',
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
        action: AuditAction.SERVICE_USER_MEDICAL_ALERT_CREATED,
        recordType: 'ServiceUserMedicalAlert',
        recordId: created.id,
        newValues: auditSnapshot({ id: created.id, serviceUserId, title: created.title }),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Medical alert created', data: mapAlert(created) };
    });
  }

  async update(
    user: RequestUser,
    serviceUserId: string,
    id: string,
    dto: UpdateMedicalAlertDto,
    meta?: RequestAuditMeta,
  ) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserMedicalAlert.findFirst({
        where: { id, serviceUserId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Medical alert not found');

      const updated = await tx.serviceUserMedicalAlert.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.severity !== undefined ? { severity: dto.severity } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
          ...(dto.actionForCarer !== undefined ? { actionForCarer: dto.actionForCarer.trim() } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.source !== undefined ? { source: dto.source } : {}),
          updatedById: user.id,
        },
      });
      const oldS = auditSnapshot({ id: before.id, title: before.title, isActive: before.isActive });
      const newS = auditSnapshot({ id: updated.id, title: updated.title, isActive: updated.isActive });
      const deactivated = dto.isActive === false;
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.SERVICE_USER,
        action: deactivated
          ? AuditAction.SERVICE_USER_MEDICAL_ALERT_DEACTIVATED
          : AuditAction.SERVICE_USER_MEDICAL_ALERT_UPDATED,
        recordType: 'ServiceUserMedicalAlert',
        recordId: id,
        oldValues: oldS,
        newValues: newS,
        metadata: { serviceUserId, changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Medical alert updated', data: mapAlert(updated) };
    });
  }

  async deactivate(user: RequestUser, serviceUserId: string, id: string, meta?: RequestAuditMeta) {
    return this.update(user, serviceUserId, id, { isActive: false }, meta);
  }
}
