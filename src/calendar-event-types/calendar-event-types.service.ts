import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CalendarEventTypeQueryDto } from './dto/calendar-event-type-query.dto';
import { CreateCalendarEventTypeDto } from './dto/create-calendar-event-type.dto';
import { UpdateCalendarEventTypeDto } from './dto/update-calendar-event-type.dto';

@Injectable()
export class CalendarEventTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(query: CalendarEventTypeQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.CalendarEventTypeWhereInput = { deletedAt: null };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { code: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
      ];
    }
    const sortBy = query.sortBy ?? 'sortOrder';
    const sortOrder = query.sortOrder ?? 'asc';
    const orderBy: Prisma.CalendarEventTypeOrderByWithRelationInput = { [sortBy]: sortOrder };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.calendarEventType.count({ where }),
      this.prisma.calendarEventType.findMany({ where, orderBy, skip, take: limit }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.calendarEventType.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Calendar event type not found');
    return { data: row };
  }

  async create(userId: string, dto: CreateCalendarEventTypeDto, meta?: RequestAuditMeta) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.calendarEventType.create({
          data: {
            name: dto.name.trim(),
            code: dto.code.trim().toUpperCase(),
            description: dto.description?.trim() ?? null,
            color: dto.color?.trim() ?? null,
            icon: dto.icon?.trim() ?? null,
            sortOrder: dto.sortOrder ?? 0,
          },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SERVICE_CARE,
          action: AuditAction.CALENDAR_EVENT_TYPE_CREATED,
          recordType: 'CalendarEventType',
          recordId: created.id,
          newValues: auditSnapshot(created),
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
        return { message: 'Calendar event type created', data: created };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A calendar event type with this code already exists');
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdateCalendarEventTypeDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.calendarEventType.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Calendar event type not found');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.calendarEventType.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.code !== undefined ? { code: dto.code.trim().toUpperCase() } : {}),
            ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
            ...(dto.color !== undefined ? { color: dto.color?.trim() ?? null } : {}),
            ...(dto.icon !== undefined ? { icon: dto.icon?.trim() ?? null } : {}),
            ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SERVICE_CARE,
          action: AuditAction.CALENDAR_EVENT_TYPE_UPDATED,
          recordType: 'CalendarEventType',
          recordId: id,
          oldValues: auditSnapshot(existing),
          newValues: auditSnapshot(updated),
          metadata: {
            changedFields: this.audit.getChangedFields(auditSnapshot(existing), auditSnapshot(updated)),
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
        return { message: 'Calendar event type updated', data: updated };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A calendar event type with this code already exists');
      }
      throw e;
    }
  }

  async remove(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.calendarEventType.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Calendar event type not found');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.calendarEventType.update({
        where: { id },
        data: { deletedAt: now, isActive: false },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_CARE,
        action: AuditAction.CALENDAR_EVENT_TYPE_DELETED,
        recordType: 'CalendarEventType',
        recordId: id,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { message: 'Calendar event type deleted', data: {} };
    });
  }
}
