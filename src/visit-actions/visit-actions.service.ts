import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { ensureActiveEmployee } from '../scheduling/scheduling-validation.util';
import { CreateVisitActionDto } from './dto/create-visit-action.dto';
import { UpdateVisitActionDto } from './dto/update-visit-action.dto';

const actionInclude = {
  scheduledJob: { select: { id: true, jobName: true } },
  scheduledVisit: { select: { id: true, visitName: true } },
  completedBy: {
    select: {
      id: true,
      personalDetail: { select: { firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.VisitActionInclude;

@Injectable()
export class VisitActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(scheduledJobId?: string, scheduledVisitId?: string) {
    const where: Prisma.VisitActionWhereInput = { deletedAt: null, isActive: true };
    if (scheduledJobId) where.scheduledJobId = scheduledJobId;
    if (scheduledVisitId) where.scheduledVisitId = scheduledVisitId;
    const rows = await this.prisma.visitAction.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: actionInclude,
    });
    return { data: rows.map((r) => this.mapAction(r)) };
  }

  async create(userId: string, dto: CreateVisitActionDto, meta?: RequestAuditMeta) {
    if (!dto.scheduledJobId && !dto.scheduledVisitId) {
      throw new BadRequestException('scheduledJobId or scheduledVisitId is required');
    }
    if (dto.scheduledJobId) {
      const job = await this.prisma.scheduledJob.findFirst({
        where: { id: dto.scheduledJobId, deletedAt: null },
      });
      if (!job) throw new NotFoundException('Scheduled job not found');
    }
    if (dto.scheduledVisitId) {
      const visit = await this.prisma.scheduledVisit.findFirst({
        where: { id: dto.scheduledVisitId, deletedAt: null },
      });
      if (!visit) throw new NotFoundException('Scheduled visit not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.visitAction.create({
        data: {
          scheduledJobId: dto.scheduledJobId ?? null,
          scheduledVisitId: dto.scheduledVisitId ?? null,
          name: dto.name.trim(),
          description: dto.description?.trim() ?? null,
          actionType: dto.actionType ?? null,
          isRequired: dto.isRequired ?? false,
          sortOrder: dto.sortOrder ?? 0,
          notes: dto.notes?.trim() ?? null,
        },
        include: actionInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.VISIT_ACTION_CREATED,
        recordType: 'VisitAction',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Visit action created', data: this.mapAction(created) };
    });
  }

  async update(userId: string, id: string, dto: UpdateVisitActionDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.visitAction.findFirst({
      where: { id, deletedAt: null },
      include: actionInclude,
    });
    if (!existing) throw new NotFoundException('Visit action not found');
    if (dto.completedById) await ensureActiveEmployee(this.prisma, dto.completedById);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.visitAction.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
          ...(dto.actionType !== undefined ? { actionType: dto.actionType ?? null } : {}),
          ...(dto.isRequired !== undefined ? { isRequired: dto.isRequired } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes?.trim() ?? null } : {}),
          ...(dto.completedById !== undefined ? { completedById: dto.completedById } : {}),
        },
        include: actionInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.VISIT_ACTION_UPDATED,
        recordType: 'VisitAction',
        recordId: id,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Visit action updated', data: this.mapAction(updated) };
    });
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.visitAction.findFirst({
      where: { id, deletedAt: null },
      include: actionInclude,
    });
    if (!existing) throw new NotFoundException('Visit action not found');

    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.visitAction.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
        include: actionInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.VISIT_ACTION_DELETED,
        recordType: 'VisitAction',
        recordId: id,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Visit action deleted', data: this.mapAction(deleted) };
    });
  }

  private mapAction(row: Prisma.VisitActionGetPayload<{ include: typeof actionInclude }>) {
    return {
      id: row.id,
      scheduledJobId: row.scheduledJobId,
      scheduledVisitId: row.scheduledVisitId,
      name: row.name,
      description: row.description,
      actionType: row.actionType,
      isRequired: row.isRequired,
      sortOrder: row.sortOrder,
      completedAt: row.completedAt?.toISOString() ?? null,
      completedById: row.completedById,
      status: row.status,
      notes: row.notes,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      scheduledJob: row.scheduledJob,
      scheduledVisit: row.scheduledVisit,
      completedBy: row.completedBy,
    };
  }
}
