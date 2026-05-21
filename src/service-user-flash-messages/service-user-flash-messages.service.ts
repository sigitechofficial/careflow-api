import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DataAccessType,
  FlashMessageStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { assertServiceUserExists } from '../medications/medication.asserts';
import { UpsertFlashMessageDto } from './dto/upsert-flash-message.dto';
import { FlashMessageQueryDto } from './dto/flash-message-query.dto';
import { FlashMessageNotificationHook } from './flash-message-notification.hook';
import {
  isDisplayUntilExpired,
  isDisplayUntilOnOrAfterToday,
  parseDisplayUntilInput,
} from './utils/flash-message-date.util';

const userBriefSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

const flashInclude = {
  createdBy: { select: userBriefSelect },
  clearedBy: { select: userBriefSelect },
} satisfies Prisma.ServiceUserFlashMessageInclude;

type FlashRow = Prisma.ServiceUserFlashMessageGetPayload<{ include: typeof flashInclude }>;

function mapUserBrief(user: FlashRow['createdBy']) {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return {
    id: user.id,
    name: name || user.email,
    email: user.email,
  };
}

function mapFlashMessage(row: FlashRow) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    message: row.message,
    displayUntil: row.displayUntil.toISOString(),
    status: row.status,
    isCurrent: row.isCurrent,
    clearedAt: row.clearedAt?.toISOString() ?? null,
    clearReason: row.clearReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: mapUserBrief(row.createdBy),
    clearedBy: mapUserBrief(row.clearedBy),
  };
}

function auditFlashSnapshot(row: FlashRow | null) {
  if (!row) return null;
  return auditSnapshot({
    id: row.id,
    serviceUserId: row.serviceUserId,
    message: row.message,
    displayUntil: row.displayUntil,
    status: row.status,
    isCurrent: row.isCurrent,
  });
}

@Injectable()
export class ServiceUserFlashMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly notifications: FlashMessageNotificationHook,
  ) {}

  private async logDataView(
    userId: string,
    meta: RequestAuditMeta,
    params: {
      recordType: string;
      recordId: string;
      serviceUserId: string;
      flashMessageId?: string;
      route: string;
    },
  ) {
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.SERVICE_USER,
      recordType: params.recordType,
      recordId: params.recordId,
      accessType: DataAccessType.VIEW,
      ...meta,
      metadata: {
        serviceUserId: params.serviceUserId,
        flashMessageId: params.flashMessageId ?? null,
        route: params.route,
      },
    });
  }

  private validateDisplayUntilInput(displayUntil: string): Date {
    try {
      const parsed = parseDisplayUntilInput(displayUntil);
      if (!isDisplayUntilOnOrAfterToday(parsed)) {
        throw new BadRequestException('displayUntil must be today or a future date');
      }
      return parsed;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        err instanceof Error ? err.message : 'displayUntil is invalid',
      );
    }
  }

  private currentWhere(serviceUserId: string): Prisma.ServiceUserFlashMessageWhereInput {
    return {
      serviceUserId,
      deletedAt: null,
      isActive: true,
      isCurrent: true,
      status: FlashMessageStatus.ACTIVE,
    };
  }

  /**
   * Mark expired current messages; safe to call from read paths.
   * TODO: wire a daily `@nestjs/schedule` cron when the scheduler module is added.
   */
  async expireOldMessages(serviceUserId?: string, meta?: RequestAuditMeta, userId?: string) {
    const now = new Date();
    const rows = await this.prisma.serviceUserFlashMessage.findMany({
      where: {
        ...(serviceUserId ? { serviceUserId } : {}),
        deletedAt: null,
        isCurrent: true,
        status: FlashMessageStatus.ACTIVE,
        displayUntil: { lt: now },
      },
    });

    if (!rows.length) return;

    await this.prisma.$transaction(
      rows.map((row) =>
        this.prisma.serviceUserFlashMessage.update({
          where: { id: row.id },
          data: {
            status: FlashMessageStatus.EXPIRED,
            isCurrent: false,
            updatedAt: now,
          },
        }),
      ),
    );

    for (const row of rows) {
      await this.audit.logAudit({
        userId: userId ?? null,
        module: AuditModule.FLASH_MESSAGE,
        action: AuditAction.SERVICE_USER_FLASH_MESSAGE_EXPIRED,
        recordType: 'ServiceUserFlashMessage',
        recordId: row.id,
        oldValues: auditFlashSnapshot(row as FlashRow),
        newValues: auditSnapshot({
          ...row,
          status: FlashMessageStatus.EXPIRED,
          isCurrent: false,
        }),
        metadata: {
          serviceUserId: row.serviceUserId,
          flashMessageId: row.id,
          displayUntil: row.displayUntil,
          status: FlashMessageStatus.EXPIRED,
        },
        ...meta,
      });
    }
  }

  async getCurrent(serviceUserId: string, userId: string, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    await this.expireOldMessages(serviceUserId, meta, userId);

    const row = await this.prisma.serviceUserFlashMessage.findFirst({
      where: this.currentWhere(serviceUserId),
      include: flashInclude,
      orderBy: { createdAt: 'desc' },
    });

    await this.logDataView(userId, meta, {
      recordType: 'ServiceUserFlashMessage',
      recordId: serviceUserId,
      serviceUserId,
      flashMessageId: row?.id,
      route: 'service_users.flash_message.current',
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.FLASH_MESSAGE,
      action: AuditAction.SERVICE_USER_FLASH_MESSAGE_VIEWED,
      recordType: 'ServiceUserFlashMessage',
      recordId: row?.id ?? serviceUserId,
      metadata: {
        serviceUserId,
        flashMessageId: row?.id ?? null,
        hasActiveMessage: !!row,
      },
      ...meta,
    });

    if (!row) {
      return { message: 'No active flash message', data: null };
    }

    if (isDisplayUntilExpired(row.displayUntil)) {
      await this.expireOldMessages(serviceUserId, meta, userId);
      return { message: 'No active flash message', data: null };
    }

    return { data: mapFlashMessage(row) };
  }

  private async archiveCurrentMessage(
    tx: Prisma.TransactionClient,
    serviceUserId: string,
    userId: string,
    meta: RequestAuditMeta,
  ): Promise<FlashRow | null> {
    const current = await tx.serviceUserFlashMessage.findFirst({
      where: this.currentWhere(serviceUserId),
      include: flashInclude,
    });
    if (!current) return null;

    const archived = await tx.serviceUserFlashMessage.update({
      where: { id: current.id },
      data: {
        status: FlashMessageStatus.ARCHIVED,
        isCurrent: false,
        updatedById: userId,
      },
      include: flashInclude,
    });

    await this.audit.logAudit({
      tx,
      userId,
      module: AuditModule.FLASH_MESSAGE,
      action: AuditAction.SERVICE_USER_FLASH_MESSAGE_ARCHIVED,
      recordType: 'ServiceUserFlashMessage',
      recordId: current.id,
      oldValues: auditFlashSnapshot(current),
      newValues: auditFlashSnapshot(archived),
      metadata: {
        serviceUserId,
        flashMessageId: current.id,
        displayUntil: current.displayUntil,
        status: FlashMessageStatus.ARCHIVED,
      },
      ...meta,
    });

    return archived;
  }

  async upsert(
    serviceUserId: string,
    dto: UpsertFlashMessageDto,
    userId: string,
    meta: RequestAuditMeta,
  ) {
    const su = await assertServiceUserExists(this.prisma, serviceUserId);
    const displayUntil = this.validateDisplayUntilInput(dto.displayUntil);

    const result = await this.prisma.$transaction(async (tx) => {
      const previous = await this.archiveCurrentMessage(tx, serviceUserId, userId, meta);

      const created = await tx.serviceUserFlashMessage.create({
        data: {
          serviceUserId,
          message: dto.message,
          displayUntil,
          status: FlashMessageStatus.ACTIVE,
          isCurrent: true,
          isActive: true,
          createdById: userId,
          updatedById: userId,
        },
        include: flashInclude,
      });

      return { previous, created };
    });

    const action = result.previous
      ? AuditAction.SERVICE_USER_FLASH_MESSAGE_UPDATED
      : AuditAction.SERVICE_USER_FLASH_MESSAGE_CREATED;

    await this.audit.logAudit({
      userId,
      module: AuditModule.FLASH_MESSAGE,
      action,
      recordType: 'ServiceUserFlashMessage',
      recordId: result.created.id,
      oldValues: auditFlashSnapshot(result.previous),
      newValues: auditFlashSnapshot(result.created),
      metadata: {
        serviceUserId,
        flashMessageId: result.created.id,
        displayUntil: result.created.displayUntil,
        status: result.created.status,
      },
      ...meta,
    });

    const serviceUserName = [su.firstName, su.lastName].filter(Boolean).join(' ').trim() || 'Service user';
    await this.notifications.notifyFlashMessageChanged({
      serviceUserId,
      serviceUserName,
      flashMessageId: result.created.id,
      action: result.previous ? 'updated' : 'created',
      createdById: userId,
    });

    return {
      message: result.previous ? 'Flash message updated' : 'Flash message created',
      data: mapFlashMessage(result.created),
    };
  }

  async clear(
    serviceUserId: string,
    reason: string | undefined,
    userId: string,
    meta: RequestAuditMeta,
    auditAction: AuditAction = AuditAction.SERVICE_USER_FLASH_MESSAGE_CLEARED,
  ) {
    const su = await assertServiceUserExists(this.prisma, serviceUserId);
    await this.expireOldMessages(serviceUserId, meta, userId);

    const current = await this.prisma.serviceUserFlashMessage.findFirst({
      where: this.currentWhere(serviceUserId),
      include: flashInclude,
    });

    if (!current) {
      return { message: 'No active flash message to clear', data: null };
    }

    const cleared = await this.prisma.serviceUserFlashMessage.update({
      where: { id: current.id },
      data: {
        status: FlashMessageStatus.CLEARED,
        isCurrent: false,
        clearedAt: new Date(),
        clearedById: userId,
        clearReason: reason ?? null,
        updatedById: userId,
      },
      include: flashInclude,
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.FLASH_MESSAGE,
      action: auditAction,
      recordType: 'ServiceUserFlashMessage',
      recordId: cleared.id,
      oldValues: auditFlashSnapshot(current),
      newValues: auditFlashSnapshot(cleared),
      metadata: {
        serviceUserId,
        flashMessageId: cleared.id,
        displayUntil: cleared.displayUntil,
        status: FlashMessageStatus.CLEARED,
        clearReason: reason ?? null,
      },
      ...meta,
    });

    const serviceUserName = [su.firstName, su.lastName].filter(Boolean).join(' ').trim() || 'Service user';
    await this.notifications.notifyFlashMessageChanged({
      serviceUserId,
      serviceUserName,
      flashMessageId: cleared.id,
      action: 'cleared',
      createdById: userId,
    });

    return { message: 'Flash message cleared', data: mapFlashMessage(cleared) };
  }

  async getHistory(
    serviceUserId: string,
    query: FlashMessageQueryDto,
    userId: string,
    meta: RequestAuditMeta,
  ) {
    await assertServiceUserExists(this.prisma, serviceUserId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ServiceUserFlashMessageWhereInput = {
      serviceUserId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) {
        const end = new Date(query.dateTo);
        end.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.ServiceUserFlashMessageOrderByWithRelationInput = {
      [sortBy]: sortOrder,
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.serviceUserFlashMessage.count({ where }),
      this.prisma.serviceUserFlashMessage.findMany({
        where,
        include: flashInclude,
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    await this.logDataView(userId, meta, {
      recordType: 'ServiceUserFlashMessage',
      recordId: serviceUserId,
      serviceUserId,
      route: 'service_users.flash_message.history',
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.FLASH_MESSAGE,
      action: AuditAction.SERVICE_USER_FLASH_MESSAGE_HISTORY_VIEWED,
      recordType: 'ServiceUserFlashMessage',
      recordId: serviceUserId,
      metadata: {
        serviceUserId,
        page,
        limit,
        total,
        filters: query,
      },
      ...meta,
    });

    return {
      data: rows.map(mapFlashMessage),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }
}
