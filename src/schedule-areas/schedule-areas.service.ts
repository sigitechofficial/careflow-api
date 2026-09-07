import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { andWhereFragment, OrgScopeService } from '../common/org-scope/org-scope.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { ScheduleAreaQueryDto } from './dto/schedule-area-query.dto';
import { CreateScheduleAreaDto } from './dto/create-schedule-area.dto';
import { UpdateScheduleAreaDto } from './dto/update-schedule-area.dto';

const areaInclude = {
  location: { select: { id: true, name: true } },
  zone: { select: { id: true, name: true } },
} satisfies Prisma.ScheduleAreaInclude;

@Injectable()
export class ScheduleAreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  async list(query: ScheduleAreaQueryDto, actor?: RequestUser) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const where: Prisma.ScheduleAreaWhereInput = { deletedAt: null };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.locationId) where.locationId = query.locationId;
    if (query.zoneId) where.zoneId = query.zoneId;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { code: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
      ];
    }

    if (actor) {
      const scope = this.orgScope.fromRequestUser(actor);
      const locationIds = this.orgScope.resolveListLocationIds(
        scope,
        query.locationId,
        undefined,
      );
      if (locationIds && locationIds.length === 0) {
        return { data: [], meta: buildPaginationMeta({ page, limit, total: 0 }) };
      }
      if (locationIds?.length === 1) {
        where.locationId = locationIds[0];
      } else if (locationIds && locationIds.length > 1) {
        // Drop single client locationId; enforce multi-branch scope.
        delete (where as { locationId?: string }).locationId;
        andWhereFragment(where, { locationId: { in: locationIds } });
      }
    }

    const sortBy = query.sortBy ?? 'sortOrder';
    const sortOrder = query.sortOrder ?? 'asc';
    const orderBy: Prisma.ScheduleAreaOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.scheduleArea.count({ where }),
      this.prisma.scheduleArea.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: areaInclude,
      }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string, actor?: RequestUser) {
    if (actor) {
      await this.orgScope.assertScheduleAreaInScope(this.orgScope.fromRequestUser(actor), id);
    }
    const row = await this.prisma.scheduleArea.findFirst({
      where: { id, deletedAt: null },
      include: areaInclude,
    });
    if (!row) throw new NotFoundException('Schedule area not found');
    return { data: row };
  }

  private async assertLocation(id: string | null | undefined) {
    if (!id) return;
    const loc = await this.prisma.location.findFirst({ where: { id, deletedAt: null } });
    if (!loc) throw new BadRequestException('Location not found');
  }

  private async assertZone(id: string | null | undefined) {
    if (!id) return;
    const zone = await this.prisma.zone.findFirst({ where: { id, deletedAt: null } });
    if (!zone) throw new BadRequestException('Zone not found');
  }

  async create(userId: string, dto: CreateScheduleAreaDto, meta?: RequestAuditMeta) {
    await this.assertLocation(dto.locationId);
    await this.assertZone(dto.zoneId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.scheduleArea.create({
          data: {
            name: dto.name.trim(),
            code: dto.code.trim().toUpperCase(),
            description: dto.description?.trim() ?? null,
            locationId: dto.locationId ?? null,
            zoneId: dto.zoneId ?? null,
            sortOrder: dto.sortOrder ?? 0,
            createdById: userId,
          },
          include: areaInclude,
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SCHEDULING,
          action: AuditAction.SCHEDULE_AREA_CREATED,
          recordType: 'ScheduleArea',
          recordId: created.id,
          newValues: auditSnapshot(created),
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
        return { message: 'Schedule area created', data: created };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A schedule area with this code already exists');
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdateScheduleAreaDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduleArea.findFirst({
      where: { id, deletedAt: null },
      include: areaInclude,
    });
    if (!existing) throw new NotFoundException('Schedule area not found');
    if (dto.locationId !== undefined) await this.assertLocation(dto.locationId ?? undefined);
    if (dto.zoneId !== undefined) await this.assertZone(dto.zoneId ?? undefined);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.scheduleArea.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.code !== undefined ? { code: dto.code.trim().toUpperCase() } : {}),
            ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
            ...(dto.locationId !== undefined ? { locationId: dto.locationId } : {}),
            ...(dto.zoneId !== undefined ? { zoneId: dto.zoneId } : {}),
            ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            updatedById: userId,
          },
          include: areaInclude,
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SCHEDULING,
          action: AuditAction.SCHEDULE_AREA_UPDATED,
          recordType: 'ScheduleArea',
          recordId: id,
          oldValues: auditSnapshot(existing),
          newValues: auditSnapshot(updated),
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
        return { message: 'Schedule area updated', data: updated };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A schedule area with this code already exists');
      }
      throw e;
    }
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.scheduleArea.findFirst({
      where: { id, deletedAt: null },
      include: areaInclude,
    });
    if (!existing) throw new NotFoundException('Schedule area not found');
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.scheduleArea.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedById: userId,
          isActive: false,
          updatedById: userId,
        },
        include: areaInclude,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_AREA_DELETED,
        recordType: 'ScheduleArea',
        recordId: id,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Schedule area deleted', data: deleted };
    });
  }
}
