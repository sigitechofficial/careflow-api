import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataAccessType, Prisma, ScheduleStatus as PrismaScheduleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { ScheduleQueryDto } from './dto/schedule-query.dto';
import { BuildScheduleDto } from './dto/build-schedule.dto';
import { UpdateScheduleStatusDto } from './dto/update-schedule-status.dto';
import { formatScheduleDate, parseScheduleDate } from './schedules-date.util';
import { ScheduleStatus } from './enums/schedule-status.enum';
import { ScheduledJobsService } from '../scheduled-jobs/scheduled-jobs.service';

const batchInclude = {
  builtBy: { select: { id: true, email: true, firstName: true, lastName: true } },
  areaStatuses: {
    where: { deletedAt: null },
    include: {
      scheduleArea: {
        select: { id: true, name: true, code: true, sortOrder: true },
      },
      builtBy: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
    orderBy: { scheduleArea: { sortOrder: 'asc' as const } },
  },
} satisfies Prisma.ScheduleBatchInclude;

const BUILD_PLACEHOLDER_META = {
  phase: 1,
  jobGeneration: false,
  message:
    'Schedule batch and area statuses recorded only. Pass a jobs array to create scheduled jobs and visits.',
};

@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
    private readonly scheduledJobsService: ScheduledJobsService,
  ) {}

  private batchWhereActive(): Prisma.ScheduleBatchWhereInput {
    return { deletedAt: null, isActive: true };
  }

  async list(query: ScheduleQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.ScheduleBatchWhereInput = { ...this.batchWhereActive() };
    if (query.status) where.status = query.status as PrismaScheduleStatus;
    if (query.dateFrom || query.dateTo) {
      where.scheduleDate = {};
      if (query.dateFrom) where.scheduleDate.gte = parseScheduleDate(query.dateFrom);
      if (query.dateTo) where.scheduleDate.lte = parseScheduleDate(query.dateTo);
    }
    const sortBy = query.sortBy ?? 'scheduleDate';
    const sortOrder = query.sortOrder ?? 'desc';
    const orderBy: Prisma.ScheduleBatchOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.scheduleBatch.count({ where }),
      this.prisma.scheduleBatch.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: batchInclude,
      }),
    ]);
    return {
      data: rows.map((r) => this.mapBatch(r)),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async listPrevious(userId: string, query: ScheduleQueryDto, meta?: RequestAuditMeta) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.ScheduleBatchWhereInput = { ...this.batchWhereActive() };
    if (query.status) where.status = query.status as PrismaScheduleStatus;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.scheduleBatch.count({ where }),
      this.prisma.scheduleBatch.findMany({
        where,
        orderBy: { scheduleDate: 'desc' },
        skip,
        take: limit,
        include: batchInclude,
      }),
    ]);

    await this.audit.logDataAccess({
      userId,
      module: AuditModule.SCHEDULING,
      recordType: 'ScheduleBatch',
      accessType: DataAccessType.VIEW,
      metadata: { route: 'schedules.previous', page, limit, total },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: rows.map((r) => this.mapBatch(r)),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getStatusForDate(user: RequestUser, dateStr: string, meta?: RequestAuditMeta) {
    const userId = user.id;
    const scope = this.orgScope.fromRequestUser(user);
    const scheduleDate = parseScheduleDate(dateStr);
    const batch = await this.prisma.scheduleBatch.findFirst({
      where: { scheduleDate, ...this.batchWhereActive() },
      include: batchInclude,
    });

    const areaWhere: Prisma.ScheduleAreaWhereInput = {
      deletedAt: null,
      isActive: true,
      ...(this.orgScope.scheduleAreaScopeWhere(scope) ?? {}),
    };

    const areas = await this.prisma.scheduleArea.findMany({
      where: areaWhere,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        location: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
      },
    });

    const statusByAreaId = new Map(
      (batch?.areaStatuses ?? []).map((s) => [s.scheduleAreaId, s]),
    );

    const areaStatuses = areas.map((area) => {
      const row = statusByAreaId.get(area.id);
      return {
        scheduleAreaId: area.id,
        scheduleArea: {
          id: area.id,
          name: area.name,
          code: area.code,
          sortOrder: area.sortOrder,
          location: area.location,
          zone: area.zone,
        },
        status: row?.status ?? ScheduleStatus.NOT_BUILT,
        builtAt: row?.builtAt?.toISOString() ?? null,
        builtBy: row?.builtBy ?? null,
        notes: row?.notes ?? null,
        metadata: row?.metadata ?? null,
      };
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.SCHEDULE_STATUS_VIEWED,
      recordType: 'ScheduleBatch',
      recordId: batch?.id,
      metadata: { scheduleDate: dateStr },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    await this.audit.logDataAccess({
      userId,
      module: AuditModule.SCHEDULING,
      recordType: 'ScheduleBatch',
      recordId: batch?.id,
      accessType: DataAccessType.VIEW,
      metadata: { route: 'schedules.status', scheduleDate: dateStr },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: {
        scheduleDate: dateStr,
        batch: batch ? this.mapBatch(batch) : null,
        areaStatuses,
      },
    };
  }

  async getById(id: string) {
    const row = await this.prisma.scheduleBatch.findFirst({
      where: { id, ...this.batchWhereActive() },
      include: batchInclude,
    });
    if (!row) throw new NotFoundException('Schedule batch not found');
    return { data: this.mapBatch(row) };
  }

  async build(user: RequestUser, dto: BuildScheduleDto, meta?: RequestAuditMeta) {
    const userId = user.id;
    const scope = this.orgScope.fromRequestUser(user);
    const scheduleDate = parseScheduleDate(dto.scheduleDate);
    const now = new Date();

    const areaScope = this.orgScope.scheduleAreaScopeWhere(scope);
    let targetAreas = await this.prisma.scheduleArea.findMany({
      where: { deletedAt: null, isActive: true, ...(areaScope ?? {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    if (dto.areaIds?.length) {
      for (const areaId of dto.areaIds) {
        await this.orgScope.assertScheduleAreaInScope(scope, areaId);
      }
      const idSet = new Set(dto.areaIds);
      targetAreas = targetAreas.filter((a) => idSet.has(a.id));
      if (targetAreas.length !== dto.areaIds.length) {
        throw new BadRequestException('One or more schedule areas are invalid or inactive');
      }
    }

    if (!targetAreas.length) {
      throw new BadRequestException('No active schedule areas available to build');
    }

    return this.prisma.$transaction(async (tx) => {
      let batch = await tx.scheduleBatch.findFirst({
        where: { scheduleDate, deletedAt: null, isActive: true },
      });

      const batchMetadata = {
        ...(dto.jobs?.length
          ? { phase: 2, jobGeneration: true, jobsRequested: dto.jobs.length }
          : BUILD_PLACEHOLDER_META),
        buildSource: dto.buildSource,
        templateId: dto.templateId ?? null,
        areaCount: targetAreas.length,
      };

      if (batch) {
        batch = await tx.scheduleBatch.update({
          where: { id: batch.id },
          data: {
            status: PrismaScheduleStatus.BUILDING,
            buildSource: dto.buildSource,
            templateId: dto.templateId ?? null,
            notes: dto.notes?.trim() ?? batch.notes,
            metadata: batchMetadata as Prisma.InputJsonValue,
            updatedById: userId,
          },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SCHEDULING,
          action: AuditAction.SCHEDULE_BATCH_UPDATED,
          recordType: 'ScheduleBatch',
          recordId: batch.id,
          newValues: auditSnapshot(batch),
          metadata: { reason: 'build_schedule' },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
      } else {
        batch = await tx.scheduleBatch.create({
          data: {
            scheduleDate,
            status: PrismaScheduleStatus.BUILDING,
            buildSource: dto.buildSource,
            templateId: dto.templateId ?? null,
            notes: dto.notes?.trim() ?? null,
            metadata: batchMetadata as Prisma.InputJsonValue,
            createdById: userId,
          },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SCHEDULING,
          action: AuditAction.SCHEDULE_BATCH_CREATED,
          recordType: 'ScheduleBatch',
          recordId: batch.id,
          newValues: auditSnapshot(batch),
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
      }

      for (const area of targetAreas) {
        await tx.scheduleAreaStatus.upsert({
          where: {
            scheduleBatchId_scheduleAreaId: {
              scheduleBatchId: batch.id,
              scheduleAreaId: area.id,
            },
          },
          create: {
            scheduleBatchId: batch.id,
            scheduleAreaId: area.id,
            status: PrismaScheduleStatus.BUILT,
            builtAt: now,
            builtById: userId,
            notes: dto.notes?.trim() ?? null,
            metadata: BUILD_PLACEHOLDER_META as Prisma.InputJsonValue,
          },
          update: {
            status: PrismaScheduleStatus.BUILT,
            builtAt: now,
            builtById: userId,
            deletedAt: null,
            isActive: true,
            notes: dto.notes?.trim() ?? undefined,
            metadata: BUILD_PLACEHOLDER_META as Prisma.InputJsonValue,
          },
        });
      }

      const allActiveAreaCount = await tx.scheduleArea.count({
        where: { deletedAt: null, isActive: true },
      });
      const builtCount = await tx.scheduleAreaStatus.count({
        where: {
          scheduleBatchId: batch.id,
          deletedAt: null,
          status: PrismaScheduleStatus.BUILT,
        },
      });

      const batchStatus =
        builtCount >= allActiveAreaCount
          ? PrismaScheduleStatus.BUILT
          : PrismaScheduleStatus.BUILDING;

      const finalBatch = await tx.scheduleBatch.update({
        where: { id: batch.id },
        data: {
          status: batchStatus,
          builtAt: batchStatus === PrismaScheduleStatus.BUILT ? now : null,
          builtById: batchStatus === PrismaScheduleStatus.BUILT ? userId : null,
          updatedById: userId,
        },
        include: batchInclude,
      });

      let jobsCreated = 0;
      let visitsCreated = 0;
      if (dto.jobs?.length) {
        const result = await this.scheduledJobsService.createJobsFromBuild(
          tx,
          userId,
          finalBatch.id,
          dto.jobs,
          meta,
        );
        jobsCreated = result.jobIds.length;
        visitsCreated = result.visitCount;
        await tx.scheduleBatch.update({
          where: { id: finalBatch.id },
          data: {
            metadata: {
              ...batchMetadata,
              jobsCreated,
              visitsCreated,
            } as Prisma.InputJsonValue,
          },
        });
      }

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_BUILD_REQUESTED,
        recordType: 'ScheduleBatch',
        recordId: finalBatch.id,
        newValues: auditSnapshot(finalBatch),
        metadata: {
          scheduleDate: dto.scheduleDate,
          areaIds: dto.areaIds ?? 'all',
          jobsCreated,
          visitsCreated,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      const batchWithJobs = await tx.scheduleBatch.findUnique({
        where: { id: finalBatch.id },
        include: batchInclude,
      });

      return {
        message: dto.jobs?.length
          ? `Schedule built with ${jobsCreated} job(s) and ${visitsCreated} visit(s)`
          : 'Schedule build recorded (no jobs in request — area statuses only)',
        data: this.mapBatch(batchWithJobs ?? finalBatch),
        jobsCreated,
        visitsCreated,
      };
    });
  }

  async updateStatus(
    user: RequestUser,
    id: string,
    dto: UpdateScheduleStatusDto,
    meta?: RequestAuditMeta,
  ) {
    const userId = user.id;
    const scope = this.orgScope.fromRequestUser(user);
    const existing = await this.prisma.scheduleBatch.findFirst({
      where: { id, ...this.batchWhereActive() },
      include: batchInclude,
    });
    if (!existing) throw new NotFoundException('Schedule batch not found');

    if (dto.areaStatuses?.length) {
      for (const item of dto.areaStatuses) {
        await this.orgScope.assertScheduleAreaInScope(scope, item.scheduleAreaId);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.areaStatuses?.length) {
        for (const item of dto.areaStatuses) {
          const areaStatus = await tx.scheduleAreaStatus.findFirst({
            where: {
              scheduleBatchId: id,
              scheduleAreaId: item.scheduleAreaId,
              deletedAt: null,
            },
          });
          const before = areaStatus ? auditSnapshot(areaStatus) : null;
          const updated = await tx.scheduleAreaStatus.upsert({
            where: {
              scheduleBatchId_scheduleAreaId: {
                scheduleBatchId: id,
                scheduleAreaId: item.scheduleAreaId,
              },
            },
            create: {
              scheduleBatchId: id,
              scheduleAreaId: item.scheduleAreaId,
              status: item.status as PrismaScheduleStatus,
              notes: item.notes?.trim() ?? null,
              builtAt: item.status === ScheduleStatus.BUILT ? new Date() : null,
              builtById: item.status === ScheduleStatus.BUILT ? userId : null,
            },
            update: {
              status: item.status as PrismaScheduleStatus,
              notes: item.notes?.trim() ?? undefined,
              builtAt: item.status === ScheduleStatus.BUILT ? new Date() : undefined,
              builtById: item.status === ScheduleStatus.BUILT ? userId : undefined,
            },
          });
          await this.audit.logAudit({
            tx,
            userId,
            module: AuditModule.SCHEDULING,
            action: AuditAction.SCHEDULE_AREA_STATUS_UPDATED,
            recordType: 'ScheduleAreaStatus',
            recordId: updated.id,
            oldValues: before,
            newValues: auditSnapshot(updated),
            ipAddress: meta?.ipAddress,
            userAgent: meta?.userAgent,
          });
        }
      }

      const updatedBatch = await tx.scheduleBatch.update({
        where: { id },
        data: {
          ...(dto.status !== undefined ? { status: dto.status as PrismaScheduleStatus } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          updatedById: userId,
        },
        include: batchInclude,
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_BATCH_UPDATED,
        recordType: 'ScheduleBatch',
        recordId: id,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(updatedBatch),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return { message: 'Schedule status updated', data: this.mapBatch(updatedBatch) };
    });
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduleBatch.findFirst({
      where: { id, deletedAt: null },
      include: batchInclude,
    });
    if (!existing) throw new NotFoundException('Schedule batch not found');

    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.scheduleBatch.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedById: userId,
          isActive: false,
          updatedById: userId,
        },
        include: batchInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_BATCH_DELETED,
        recordType: 'ScheduleBatch',
        recordId: id,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Schedule batch deleted', data: this.mapBatch(deleted) };
    });
  }

  private mapBatch(
    row: Prisma.ScheduleBatchGetPayload<{ include: typeof batchInclude }>,
  ) {
    return {
      id: row.id,
      scheduleDate: formatScheduleDate(row.scheduleDate),
      name: row.name,
      status: row.status,
      buildSource: row.buildSource,
      templateId: row.templateId,
      builtAt: row.builtAt?.toISOString() ?? null,
      builtBy: row.builtBy,
      notes: row.notes,
      metadata: row.metadata,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      areaStatuses: row.areaStatuses.map((s) => ({
        id: s.id,
        scheduleAreaId: s.scheduleAreaId,
        status: s.status,
        builtAt: s.builtAt?.toISOString() ?? null,
        builtBy: s.builtBy,
        notes: s.notes,
        metadata: s.metadata,
        scheduleArea: s.scheduleArea,
      })),
    };
  }
}
