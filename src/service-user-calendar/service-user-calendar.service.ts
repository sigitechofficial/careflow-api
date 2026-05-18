import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ServiceUserCalendarEventStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { DataAccessType } from '@prisma/client';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import { CalendarEventQueryDto } from './dto/calendar-event-query.dto';
import { CalendarViewQueryDto } from './dto/calendar-view-query.dto';
import { UpdateCalendarEventStatusDto } from './dto/update-calendar-event-status.dto';
import { GlobalCalendarEventsQueryDto } from './dto/global-calendar-events-query.dto';
import { CalendarView } from './enums/calendar-view.enum';
import { CalendarEventStatus } from './enums/calendar-event-status.enum';
import { ServiceUserCalendarNotificationHook } from './service-user-calendar-notification.hook';

const eventInclude = {
  eventType: true,
  serviceUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      serviceUserNumber: true,
      locationId: true,
      keyWorkerId: true,
      namedNurseId: true,
    },
  },
} satisfies Prisma.ServiceUserCalendarEventInclude;

type EventRow = Prisma.ServiceUserCalendarEventGetPayload<{ include: typeof eventInclude }>;

function parseCalendarDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new BadRequestException('Date must be YYYY-MM-DD');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
  if (Number.isNaN(dt.getTime())) throw new BadRequestException('Invalid date');
  return dt;
}

function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function mapEvent(row: EventRow) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    eventTypeId: row.eventTypeId,
    title: row.title,
    description: row.description,
    startDateTime: row.startDateTime.toISOString(),
    endDateTime: row.endDateTime?.toISOString() ?? null,
    allDay: row.allDay,
    location: row.location,
    status: row.status,
    isRecurring: row.isRecurring,
    recurrenceRule: row.recurrenceRule,
    reminderBeforeMinutes: row.reminderBeforeMinutes,
    notifyKeyWorker: row.notifyKeyWorker,
    notifyNamedNurse: row.notifyNamedNurse,
    notifyManager: row.notifyManager,
    metadata: row.metadata,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    eventType: row.eventType
      ? {
          id: row.eventType.id,
          name: row.eventType.name,
          code: row.eventType.code,
          color: row.eventType.color,
          icon: row.eventType.icon,
        }
      : null,
    serviceUser: row.serviceUser
      ? {
          id: row.serviceUser.id,
          firstName: row.serviceUser.firstName,
          lastName: row.serviceUser.lastName,
          preferredName: row.serviceUser.preferredName,
          serviceUserNumber: row.serviceUser.serviceUserNumber,
        }
      : undefined,
  };
}

@Injectable()
export class ServiceUserCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly calendarNotifications: ServiceUserCalendarNotificationHook,
  ) {}

  calculateDateRange(view: CalendarView, dateStr: string): { dateFrom: Date; dateTo: Date; dateLabel: string } {
    const base = parseCalendarDate(dateStr);
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth();
    const d = base.getUTCDate();

    if (view === CalendarView.DAY) {
      return {
        dateFrom: new Date(Date.UTC(y, m, d, 0, 0, 0, 0)),
        dateTo: endOfUtcDay(base),
        dateLabel: dateStr,
      };
    }

    if (view === CalendarView.WEEK) {
      const dayOfWeek = base.getUTCDay();
      const weekStart = new Date(Date.UTC(y, m, d - dayOfWeek, 0, 0, 0, 0));
      const weekEnd = endOfUtcDay(new Date(Date.UTC(y, m, d - dayOfWeek + 6, 0, 0, 0, 0)));
      return { dateFrom: weekStart, dateTo: weekEnd, dateLabel: dateStr };
    }

    const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const monthEnd = endOfUtcDay(new Date(Date.UTC(y, m, lastDay, 0, 0, 0, 0)));
    const label = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return { dateFrom: monthStart, dateTo: monthEnd, dateLabel: label };
  }

  groupEventsByDate(events: ReturnType<typeof mapEvent>[]): Record<string, ReturnType<typeof mapEvent>[]> {
    const grouped: Record<string, ReturnType<typeof mapEvent>[]> = {};
    for (const ev of events) {
      const key = ev.startDateTime.slice(0, 10);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(ev);
    }
    return grouped;
  }

  private async ensureServiceUserExists(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
    return u;
  }

  private async validateEventType(eventTypeId?: string | null) {
    if (!eventTypeId) return;
    const t = await this.prisma.calendarEventType.findFirst({
      where: { id: eventTypeId, deletedAt: null, isActive: true },
    });
    if (!t) throw new BadRequestException('Invalid event type');
  }

  private async ensureEventBelongsToServiceUser(serviceUserId: string, eventId: string) {
    const row = await this.prisma.serviceUserCalendarEvent.findFirst({
      where: { id: eventId, serviceUserId, deletedAt: null },
      include: eventInclude,
    });
    if (!row) throw new NotFoundException('Calendar event not found');
    return row;
  }

  private buildEventWhere(
    serviceUserId: string | undefined,
    query: CalendarEventQueryDto | GlobalCalendarEventsQueryDto,
    dateFrom?: Date,
    dateTo?: Date,
  ): Prisma.ServiceUserCalendarEventWhereInput {
    const where: Prisma.ServiceUserCalendarEventWhereInput = { deletedAt: null };
    if (serviceUserId) where.serviceUserId = serviceUserId;
    if (!('includeInactive' in query) || !query.includeInactive) {
      where.isActive = true;
    }
    if ('eventTypeId' in query && query.eventTypeId) where.eventTypeId = query.eventTypeId;
    if ('status' in query && query.status) where.status = query.status as ServiceUserCalendarEventStatus;
    if ('allDay' in query && query.allDay !== undefined) where.allDay = query.allDay;

    const fromStr = 'dateFrom' in query ? query.dateFrom : undefined;
    const toStr = 'dateTo' in query ? query.dateTo : undefined;
    const rangeFrom = dateFrom ?? (fromStr ? parseCalendarDate(fromStr) : undefined);
    const rangeTo = dateTo ?? (toStr ? endOfUtcDay(parseCalendarDate(toStr)) : undefined);

    if (rangeFrom || rangeTo) {
      where.AND = [
        ...(rangeTo
          ? [{ startDateTime: { lte: rangeTo } }]
          : []),
        ...(rangeFrom
          ? [
              {
                OR: [
                  { endDateTime: { gte: rangeFrom } },
                  { endDateTime: null, startDateTime: { gte: rangeFrom } },
                ],
              },
            ]
          : []),
      ];
    }

    if ('search' in query && query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { location: { contains: s, mode: 'insensitive' } },
      ];
    }

    if ('locationId' in query && query.locationId) {
      where.serviceUser = { locationId: query.locationId, deletedAt: null };
    }
    if ('keyWorkerId' in query && query.keyWorkerId) {
      where.serviceUser = { ...(where.serviceUser as object), keyWorkerId: query.keyWorkerId, deletedAt: null };
    }
    if ('namedNurseId' in query && query.namedNurseId) {
      where.serviceUser = { ...(where.serviceUser as object), namedNurseId: query.namedNurseId, deletedAt: null };
    }
    if ('serviceUserId' in query && query.serviceUserId) {
      where.serviceUserId = query.serviceUserId;
    }

    return where;
  }

  private async logDataView(
    userId: string,
    meta: RequestAuditMeta | undefined,
    params: {
      recordType: string;
      recordId?: string;
      serviceUserId?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.SERVICE_USER,
      recordType: params.recordType,
      recordId: params.recordId,
      accessType: DataAccessType.VIEW,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        serviceUserId: params.serviceUserId,
        ...params.metadata,
      },
    });
  }

  private async userIdForEmployee(employeeId: string): Promise<string | null> {
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: { personalDetail: { select: { email: true } } },
    });
    const email = emp?.personalDetail?.email?.trim();
    if (!email) return null;
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null, isActive: true },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  private async resolveNotificationRecipients(
    serviceUser: { keyWorkerId: string | null; namedNurseId: string | null },
    flags: { notifyKeyWorker: boolean; notifyNamedNurse: boolean; notifyManager: boolean },
  ): Promise<string[]> {
    const ids = new Set<string>();
    if (flags.notifyKeyWorker && serviceUser.keyWorkerId) {
      const uid = await this.userIdForEmployee(serviceUser.keyWorkerId);
      if (uid) ids.add(uid);
    }
    if (flags.notifyNamedNurse && serviceUser.namedNurseId) {
      const uid = await this.userIdForEmployee(serviceUser.namedNurseId);
      if (uid) ids.add(uid);
    }
    if (flags.notifyManager) {
      const managers = await this.prisma.userRole.findMany({
        where: { role: { name: { in: ['Manager', 'Admin'] }, deletedAt: null } },
        select: { userId: true },
        take: 20,
      });
      for (const m of managers) ids.add(m.userId);
    }
    return [...ids];
  }

  async getEventsForServiceUser(
    serviceUserId: string,
    query: CalendarEventQueryDto,
    currentUserId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUserExists(serviceUserId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where = this.buildEventWhere(serviceUserId, query);
    const sortBy = query.sortBy ?? 'startDateTime';
    const sortOrder = query.sortOrder ?? 'asc';
    const orderBy: Prisma.ServiceUserCalendarEventOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.serviceUserCalendarEvent.count({ where }),
      this.prisma.serviceUserCalendarEvent.findMany({
        where,
        include: eventInclude,
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    await this.logDataView(currentUserId, meta, {
      recordType: 'ServiceUserCalendarEvent',
      serviceUserId,
      metadata: { route: 'service_users.calendar.events.list', filters: query },
    });

    return {
      data: rows.map(mapEvent),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getEventById(
    serviceUserId: string,
    eventId: string,
    currentUserId: string,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.ensureEventBelongsToServiceUser(serviceUserId, eventId);
    await this.logDataView(currentUserId, meta, {
      recordType: 'ServiceUserCalendarEvent',
      recordId: eventId,
      serviceUserId,
      metadata: { route: 'service_users.calendar.events.detail' },
    });
    return { data: mapEvent(row) };
  }

  async createEvent(
    serviceUserId: string,
    dto: CreateCalendarEventDto,
    currentUser: { id: string },
    meta?: RequestAuditMeta,
  ) {
    const su = await this.ensureServiceUserExists(serviceUserId);
    await this.validateEventType(dto.eventTypeId);
    const start = new Date(dto.startDateTime);
    const end = dto.endDateTime ? new Date(dto.endDateTime) : null;
    if (end && end <= start) throw new BadRequestException('endDateTime must be after startDateTime');

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceUserCalendarEvent.create({
        data: {
          serviceUserId,
          eventTypeId: dto.eventTypeId ?? null,
          title: dto.title.trim(),
          description: dto.description?.trim() ?? null,
          startDateTime: start,
          endDateTime: end,
          allDay: dto.allDay ?? false,
          location: dto.location?.trim() ?? null,
          status: (dto.status ?? CalendarEventStatus.SCHEDULED) as ServiceUserCalendarEventStatus,
          isRecurring: dto.isRecurring ?? false,
          recurrenceRule: dto.recurrenceRule?.trim() ?? null,
          reminderBeforeMinutes: dto.reminderBeforeMinutes ?? null,
          notifyKeyWorker: dto.notifyKeyWorker ?? false,
          notifyNamedNurse: dto.notifyNamedNurse ?? false,
          notifyManager: dto.notifyManager ?? false,
          metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          createdById: currentUser.id,
        },
        include: eventInclude,
      });
      await this.audit.logAudit({
        tx,
        userId: currentUser.id,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_CALENDAR_EVENT_CREATED,
        recordType: 'ServiceUserCalendarEvent',
        recordId: row.id,
        newValues: auditSnapshot(row),
        metadata: {
          serviceUserId,
          eventTypeId: row.eventTypeId,
          startDateTime: row.startDateTime.toISOString(),
          endDateTime: row.endDateTime?.toISOString(),
          status: row.status,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return row;
    });

    const recipients = await this.resolveNotificationRecipients(su, {
      notifyKeyWorker: created.notifyKeyWorker,
      notifyNamedNurse: created.notifyNamedNurse,
      notifyManager: created.notifyManager,
    });
    await this.calendarNotifications.createReminderNotificationIfNeeded({
      event: created,
      recipientUserIds: recipients,
      notifyKeyWorker: created.notifyKeyWorker,
      notifyNamedNurse: created.notifyNamedNurse,
      notifyManager: created.notifyManager,
      reminderBeforeMinutes: created.reminderBeforeMinutes,
    });

    return { message: 'Calendar event created', data: mapEvent(created) };
  }

  async updateEvent(
    serviceUserId: string,
    eventId: string,
    dto: UpdateCalendarEventDto,
    currentUser: { id: string },
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.ensureEventBelongsToServiceUser(serviceUserId, eventId);
    if (dto.eventTypeId !== undefined) await this.validateEventType(dto.eventTypeId);
    const start = dto.startDateTime ? new Date(dto.startDateTime) : existing.startDateTime;
    const end =
      dto.endDateTime !== undefined
        ? dto.endDateTime
          ? new Date(dto.endDateTime)
          : null
        : existing.endDateTime;
    if (end && end <= start) throw new BadRequestException('endDateTime must be after startDateTime');

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceUserCalendarEvent.update({
        where: { id: eventId },
        data: {
          ...(dto.eventTypeId !== undefined ? { eventTypeId: dto.eventTypeId } : {}),
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
          ...(dto.startDateTime !== undefined ? { startDateTime: start } : {}),
          ...(dto.endDateTime !== undefined ? { endDateTime: end } : {}),
          ...(dto.allDay !== undefined ? { allDay: dto.allDay } : {}),
          ...(dto.location !== undefined ? { location: dto.location?.trim() ?? null } : {}),
          ...(dto.status !== undefined
            ? { status: dto.status as ServiceUserCalendarEventStatus }
            : {}),
          ...(dto.isRecurring !== undefined ? { isRecurring: dto.isRecurring } : {}),
          ...(dto.recurrenceRule !== undefined ? { recurrenceRule: dto.recurrenceRule?.trim() ?? null } : {}),
          ...(dto.reminderBeforeMinutes !== undefined
            ? { reminderBeforeMinutes: dto.reminderBeforeMinutes }
            : {}),
          ...(dto.notifyKeyWorker !== undefined ? { notifyKeyWorker: dto.notifyKeyWorker } : {}),
          ...(dto.notifyNamedNurse !== undefined ? { notifyNamedNurse: dto.notifyNamedNurse } : {}),
          ...(dto.notifyManager !== undefined ? { notifyManager: dto.notifyManager } : {}),
          ...(dto.metadata !== undefined ? { metadata: dto.metadata as Prisma.InputJsonValue } : {}),
          updatedById: currentUser.id,
        },
        include: eventInclude,
      });
      await this.audit.logAudit({
        tx,
        userId: currentUser.id,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_CALENDAR_EVENT_UPDATED,
        recordType: 'ServiceUserCalendarEvent',
        recordId: eventId,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot(row),
        metadata: {
          serviceUserId,
          eventTypeId: row.eventTypeId,
          startDateTime: row.startDateTime.toISOString(),
          endDateTime: row.endDateTime?.toISOString(),
          status: row.status,
          changedFields: this.audit.getChangedFields(auditSnapshot(existing), auditSnapshot(row)),
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return row;
    });

    const su = await this.ensureServiceUserExists(serviceUserId);
    const recipients = await this.resolveNotificationRecipients(su, {
      notifyKeyWorker: updated.notifyKeyWorker,
      notifyNamedNurse: updated.notifyNamedNurse,
      notifyManager: updated.notifyManager,
    });
    await this.calendarNotifications.createReminderNotificationIfNeeded({
      event: updated,
      recipientUserIds: recipients,
      notifyKeyWorker: updated.notifyKeyWorker,
      notifyNamedNurse: updated.notifyNamedNurse,
      notifyManager: updated.notifyManager,
      reminderBeforeMinutes: updated.reminderBeforeMinutes,
    });

    return { message: 'Calendar event updated', data: mapEvent(updated) };
  }

  async softDeleteEvent(
    serviceUserId: string,
    eventId: string,
    currentUser: { id: string },
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.ensureEventBelongsToServiceUser(serviceUserId, eventId);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.serviceUserCalendarEvent.update({
        where: { id: eventId },
        data: { deletedAt: now, deletedById: currentUser.id, isActive: false, updatedById: currentUser.id },
      });
      await this.audit.logAudit({
        tx,
        userId: currentUser.id,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_CALENDAR_EVENT_DELETED,
        recordType: 'ServiceUserCalendarEvent',
        recordId: eventId,
        oldValues: auditSnapshot(existing),
        metadata: { serviceUserId, eventId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    });
    return { message: 'Calendar event deleted', data: {} };
  }

  async updateEventStatus(
    serviceUserId: string,
    eventId: string,
    dto: UpdateCalendarEventStatusDto,
    currentUser: { id: string },
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.ensureEventBelongsToServiceUser(serviceUserId, eventId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceUserCalendarEvent.update({
        where: { id: eventId },
        data: {
          status: dto.status as ServiceUserCalendarEventStatus,
          updatedById: currentUser.id,
          metadata: dto.reason
            ? ({
                ...(typeof existing.metadata === 'object' && existing.metadata
                  ? (existing.metadata as Record<string, unknown>)
                  : {}),
                statusChangeReason: dto.reason,
              } as Prisma.InputJsonValue)
            : undefined,
        },
        include: eventInclude,
      });
      await this.audit.logAudit({
        tx,
        userId: currentUser.id,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_CALENDAR_EVENT_STATUS_CHANGED,
        recordType: 'ServiceUserCalendarEvent',
        recordId: eventId,
        oldValues: { status: existing.status },
        newValues: { status: row.status },
        metadata: {
          serviceUserId,
          reason: dto.reason,
          status: row.status,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return row;
    });
    return { message: 'Calendar event status updated', data: mapEvent(updated) };
  }

  async getCalendarView(
    serviceUserId: string,
    query: CalendarViewQueryDto,
    currentUserId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUserExists(serviceUserId);
    const { dateFrom, dateTo, dateLabel } = this.calculateDateRange(query.view, query.date);
    const where = this.buildEventWhere(serviceUserId, query, dateFrom, dateTo);

    const rows = await this.prisma.serviceUserCalendarEvent.findMany({
      where,
      include: eventInclude,
      orderBy: { startDateTime: 'asc' },
    });
    const events = rows.map(mapEvent);

    await this.logDataView(currentUserId, meta, {
      recordType: 'ServiceUserCalendarView',
      serviceUserId,
      metadata: {
        view: query.view,
        date: query.date,
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
      },
    });
    await this.audit.logAudit({
      userId: currentUserId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_CALENDAR_VIEW_OPENED,
      recordType: 'ServiceUserCalendarView',
      recordId: serviceUserId,
      metadata: { view: query.view, date: query.date, serviceUserId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: {
        view: query.view,
        date: dateLabel,
        dateFrom: dateFrom.toISOString().slice(0, 10),
        dateTo: dateTo.toISOString().slice(0, 10),
        events,
        groupedByDate: this.groupEventsByDate(events),
      },
    };
  }

  async getGlobalCalendarEvents(
    query: GlobalCalendarEventsQueryDto,
    currentUserId: string,
    meta?: RequestAuditMeta,
  ) {
    const dateFrom = parseCalendarDate(query.dateFrom);
    const dateTo = endOfUtcDay(parseCalendarDate(query.dateTo));
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const where = this.buildEventWhere(undefined, query, dateFrom, dateTo);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.serviceUserCalendarEvent.count({ where }),
      this.prisma.serviceUserCalendarEvent.findMany({
        where,
        include: eventInclude,
        orderBy: { startDateTime: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    await this.logDataView(currentUserId, meta, {
      recordType: 'ServiceUserCalendarEvent',
      metadata: {
        route: 'service_users.global_calendar',
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        filters: query,
      },
    });
    await this.audit.logAudit({
      userId: currentUserId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_GLOBAL_CALENDAR_VIEWED,
      recordType: 'ServiceUserCalendarView',
      metadata: { dateFrom: query.dateFrom, dateTo: query.dateTo },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: rows.map(mapEvent),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }
}
