import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { ensureScheduleArea, ensureScheduleBatch } from '../scheduling/scheduling-validation.util';
import { parseScheduleDate } from '../schedules/schedules-date.util';
import { ScheduleRunQueryDto } from './dto/schedule-run-query.dto';
import { CreateScheduleRunDto } from './dto/create-schedule-run.dto';
import { UpdateScheduleRunDto } from './dto/update-schedule-run.dto';

const runInclude = {
  scheduleBatch: { select: { id: true, scheduleDate: true } },
  scheduleArea: { select: { id: true, name: true, code: true } },
  _count: { select: { jobs: true } },
} satisfies Prisma.ScheduleRunInclude;

@Injectable()
export class ScheduleRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(query: ScheduleRunQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const where: Prisma.ScheduleRunWhereInput = { deletedAt: null, isActive: true };
    if (query.scheduleBatchId) where.scheduleBatchId = query.scheduleBatchId;
    if (query.scheduleAreaId) where.scheduleAreaId = query.scheduleAreaId;
    if (query.runDateFrom || query.runDateTo) {
      where.runDate = {};
      if (query.runDateFrom) where.runDate.gte = parseScheduleDate(query.runDateFrom);
      if (query.runDateTo) where.runDate.lte = parseScheduleDate(query.runDateTo);
    }
    const orderBy: Prisma.ScheduleRunOrderByWithRelationInput = {
      [query.sortBy ?? 'sortOrder']: query.sortOrder ?? 'asc',
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.scheduleRun.count({ where }),
      this.prisma.scheduleRun.findMany({ where, orderBy, skip, take: limit, include: runInclude }),
    ]);
    return { data: rows.map((r) => this.mapRun(r)), meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null },
      include: runInclude,
    });
    if (!row) throw new NotFoundException('Schedule run not found');
    return { data: this.mapRun(row) };
  }

  async create(userId: string, dto: CreateScheduleRunDto, meta?: RequestAuditMeta) {
    await ensureScheduleBatch(this.prisma, dto.scheduleBatchId);
    await ensureScheduleArea(this.prisma, dto.scheduleAreaId);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.scheduleRun.create({
        data: {
          scheduleBatchId: dto.scheduleBatchId,
          scheduleAreaId: dto.scheduleAreaId ?? null,
          name: dto.name.trim(),
          description: dto.description?.trim() ?? null,
          runDate: parseScheduleDate(dto.runDate),
          startTime: dto.startTime ?? null,
          endTime: dto.endTime ?? null,
          sortOrder: dto.sortOrder ?? 0,
          createdById: userId,
        },
        include: runInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_RUN_CREATED,
        recordType: 'ScheduleRun',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Schedule run created', data: this.mapRun(created) };
    });
  }

  async update(userId: string, id: string, dto: UpdateScheduleRunDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null },
      include: runInclude,
    });
    if (!existing) throw new NotFoundException('Schedule run not found');
    if (dto.scheduleBatchId) await ensureScheduleBatch(this.prisma, dto.scheduleBatchId);
    if (dto.scheduleAreaId) await ensureScheduleArea(this.prisma, dto.scheduleAreaId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.scheduleRun.update({
        where: { id },
        data: {
          ...(dto.scheduleBatchId !== undefined ? { scheduleBatchId: dto.scheduleBatchId } : {}),
          ...(dto.scheduleAreaId !== undefined ? { scheduleAreaId: dto.scheduleAreaId ?? null } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
          ...(dto.runDate !== undefined ? { runDate: parseScheduleDate(dto.runDate) } : {}),
          ...(dto.startTime !== undefined ? { startTime: dto.startTime ?? null } : {}),
          ...(dto.endTime !== undefined ? { endTime: dto.endTime ?? null } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          updatedById: userId,
        },
        include: runInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_RUN_UPDATED,
        recordType: 'ScheduleRun',
        recordId: id,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updated),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Schedule run updated', data: this.mapRun(updated) };
    });
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduleRun.findFirst({
      where: { id, deletedAt: null },
      include: runInclude,
    });
    if (!existing) throw new NotFoundException('Schedule run not found');

    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.scheduleRun.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false, updatedById: userId },
        include: runInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_RUN_DELETED,
        recordType: 'ScheduleRun',
        recordId: id,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Schedule run deleted', data: this.mapRun(deleted) };
    });
  }

  private mapRun(row: Prisma.ScheduleRunGetPayload<{ include: typeof runInclude }>) {
    return {
      id: row.id,
      scheduleBatchId: row.scheduleBatchId,
      scheduleAreaId: row.scheduleAreaId,
      name: row.name,
      description: row.description,
      runDate: row.runDate.toISOString().slice(0, 10),
      startTime: row.startTime,
      endTime: row.endTime,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      jobCount: row._count?.jobs ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      scheduleBatch: row.scheduleBatch
        ? { ...row.scheduleBatch, scheduleDate: row.scheduleBatch.scheduleDate.toISOString().slice(0, 10) }
        : null,
      scheduleArea: row.scheduleArea,
    };
  }
}
