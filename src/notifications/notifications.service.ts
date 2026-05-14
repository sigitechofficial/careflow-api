import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import {
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { NotificationsGateway } from './notifications.gateway';
import type { NotificationNewSocketPayload } from './types/notification-event.type';

const ALL_NOTIFICATION_TYPES: NotificationType[] = [
  NotificationType.COMPLIANCE_EXPIRING,
  NotificationType.COMPLIANCE_EXPIRED,
  NotificationType.EMPLOYEE_DOCUMENT_UPLOADED,
  NotificationType.EMPLOYEE_STATUS_CHANGED,
  NotificationType.SERVICE_USER_UPDATED,
  NotificationType.CARE_PLAN_REVIEW_DUE,
  NotificationType.MEDICATION_ALERT,
  NotificationType.INCIDENT_REPORTED,
  NotificationType.SCHEDULE_UNALLOCATED_VISIT,
  NotificationType.REPORT_READY,
  NotificationType.SECURITY_ALERT,
  NotificationType.SYSTEM_MESSAGE,
];

export type NotifyUsersParams = {
  recipientUserIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  module: NotificationModule;
  severity?: NotificationSeverity;
  recordType?: string;
  recordId?: string;
  metadata?: unknown;
  createdById?: string;
  expiresAt?: Date;
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    @Inject(forwardRef(() => NotificationsGateway))
    private readonly gateway: NotificationsGateway,
  ) {}

  private async effectivePreference(
    userId: string,
    type: NotificationType,
  ): Promise<{ inAppEnabled: boolean; soundEnabled: boolean }> {
    const row = await this.prisma.notificationPreference.findUnique({
      where: { userId_type: { userId, type } },
    });
    return {
      inAppEnabled: row?.inAppEnabled ?? true,
      soundEnabled: row?.soundEnabled ?? true,
    };
  }

  private buildNewPayload(
    n: {
      id: string;
      title: string;
      message: string;
      type: NotificationType;
      module: NotificationModule;
      severity: NotificationSeverity;
      recordType: string | null;
      recordId: string | null;
      metadata: Prisma.JsonValue | null;
      createdAt: Date;
    },
    recipient: { readAt: Date | null; dismissedAt: Date | null },
    playSound: boolean,
  ): NotificationNewSocketPayload {
    return {
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type,
      module: n.module,
      severity: n.severity,
      recordType: n.recordType,
      recordId: n.recordId,
      metadata: n.metadata ?? {},
      createdAt: n.createdAt.toISOString(),
      readAt: recipient.readAt?.toISOString() ?? null,
      dismissedAt: recipient.dismissedAt?.toISOString() ?? null,
      playSound,
    };
  }

  async notifyUsers(params: NotifyUsersParams) {
    const {
      recipientUserIds,
      type,
      title,
      message,
      module,
      severity = NotificationSeverity.INFO,
      recordType,
      recordId,
      metadata,
      createdById,
      expiresAt,
    } = params;

    const uniqueRecipients = [...new Set(recipientUserIds)];
    if (!uniqueRecipients.length) {
      throw new BadRequestException('At least one recipient is required');
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueRecipients }, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (users.length !== uniqueRecipients.length) {
      throw new BadRequestException('One or more recipient user ids are invalid');
    }

    const eligible: string[] = [];
    for (const uid of uniqueRecipients) {
      const pref = await this.effectivePreference(uid, type);
      if (pref.inAppEnabled) eligible.push(uid);
    }
    if (!eligible.length) {
      throw new BadRequestException('No recipients have in-app notifications enabled for this type');
    }

    const notification = await this.prisma.notification.create({
      data: {
        type,
        title,
        message,
        module,
        severity,
        recordType: recordType ?? undefined,
        recordId: recordId ?? undefined,
        metadata: metadata === undefined ? undefined : (metadata as Prisma.InputJsonValue),
        createdById: createdById ?? undefined,
        expiresAt: expiresAt ?? undefined,
        recipients: {
          create: eligible.map((userId) => ({ userId })),
        },
      },
      include: { recipients: true },
    });

    for (const recipient of notification.recipients) {
      const pref = await this.effectivePreference(recipient.userId, notification.type);
      const playSound = pref.soundEnabled && notification.createdById !== recipient.userId;
      const payload = this.buildNewPayload(notification, recipient, playSound);
      await this.prisma.notificationRecipient.update({
        where: { id: recipient.id },
        data: { deliveredAt: new Date() },
      });
      this.gateway.emitNotificationNew(recipient.userId, payload as unknown as Record<string, unknown>);
      const count = await this.getUnreadCount(recipient.userId);
      this.gateway.emitUnreadCount(recipient.userId, count);
    }

    return { id: notification.id, recipientCount: notification.recipients.length };
  }

  async createNotification(dto: CreateNotificationDto, currentUser: RequestUser) {
    const result = await this.notifyUsers({
      recipientUserIds: dto.recipientUserIds,
      type: dto.type,
      title: dto.title,
      message: dto.message,
      module: dto.module,
      severity: dto.severity,
      recordType: dto.recordType,
      recordId: dto.recordId,
      metadata: dto.metadata,
      createdById: currentUser.id,
      expiresAt: dto.expiresAt,
    });

    await this.auditLogs.logAudit({
      userId: currentUser.id,
      module: AuditModule.NOTIFICATION,
      action: AuditAction.NOTIFICATION_CREATED,
      recordType: 'Notification',
      recordId: result.id,
      newValues: { recipientCount: result.recipientCount, type: dto.type },
    });

    return result;
  }

  async getMyNotifications(userId: string, query: NotificationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortOrder = query.sortOrder ?? 'desc';
    const includeDismissed = query.includeDismissed === true;

    const where: Prisma.NotificationRecipientWhereInput = {
      userId,
      ...(!includeDismissed ? { dismissedAt: null } : {}),
      ...(query.unreadOnly ? { readAt: null } : {}),
      notification: {
        ...(query.type ? { type: query.type } : {}),
        ...(query.module ? { module: query.module } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.dateFrom || query.dateTo
          ? {
              createdAt: {
                ...(query.dateFrom ? { gte: query.dateFrom } : {}),
                ...(query.dateTo ? { lte: query.dateTo } : {}),
              },
            }
          : {}),
      },
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.notificationRecipient.count({ where }),
      this.prisma.notificationRecipient.findMany({
        where,
        include: { notification: true },
        orderBy: { notification: { createdAt: sortOrder } },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const data = rows.map((r) => ({
      id: r.notification.id,
      title: r.notification.title,
      message: r.notification.message,
      type: r.notification.type,
      module: r.notification.module,
      severity: r.notification.severity,
      recordType: r.notification.recordType,
      recordId: r.notification.recordId,
      metadata: r.notification.metadata ?? {},
      createdAt: r.notification.createdAt.toISOString(),
      readAt: r.readAt?.toISOString() ?? null,
      dismissedAt: r.dismissedAt?.toISOString() ?? null,
    }));

    return {
      data,
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notificationRecipient.count({
      where: { userId, readAt: null, dismissedAt: null },
    });
  }

  async getMyNotificationById(userId: string, notificationId: string) {
    const row = await this.prisma.notificationRecipient.findFirst({
      where: { userId, notificationId },
      include: { notification: true },
    });
    if (!row) throw new NotFoundException('Notification not found');
    return {
      id: row.notification.id,
      title: row.notification.title,
      message: row.notification.message,
      type: row.notification.type,
      module: row.notification.module,
      severity: row.notification.severity,
      recordType: row.notification.recordType,
      recordId: row.notification.recordId,
      metadata: row.notification.metadata ?? {},
      createdAt: row.notification.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
      dismissedAt: row.dismissedAt?.toISOString() ?? null,
    };
  }

  async markAsRead(userId: string, notificationId: string) {
    const row = await this.prisma.notificationRecipient.findFirst({
      where: { userId, notificationId },
    });
    if (!row) throw new NotFoundException('Notification not found');
    if (row.dismissedAt) throw new ForbiddenException('Notification is dismissed');
    const readAt = new Date();
    await this.prisma.notificationRecipient.update({
      where: { id: row.id },
      data: { readAt },
    });
    this.gateway.emitNotificationRead(userId, { id: notificationId, readAt: readAt.toISOString() });
    const count = await this.getUnreadCount(userId);
    this.gateway.emitUnreadCount(userId, count);
    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.NOTIFICATION,
      action: AuditAction.NOTIFICATION_READ,
      recordType: 'Notification',
      recordId: notificationId,
    });
    return { id: notificationId, readAt: readAt.toISOString() };
  }

  async markAllAsRead(userId: string) {
    const readAt = new Date();
    await this.prisma.notificationRecipient.updateMany({
      where: { userId, readAt: null, dismissedAt: null },
      data: { readAt },
    });
    this.gateway.emitNotificationReadAll(userId, { readAt: readAt.toISOString() });
    const count = await this.getUnreadCount(userId);
    this.gateway.emitUnreadCount(userId, count);
    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.NOTIFICATION,
      action: AuditAction.NOTIFICATION_READ_ALL,
    });
    return { readAt: readAt.toISOString(), unreadCount: count };
  }

  async dismiss(userId: string, notificationId: string) {
    const row = await this.prisma.notificationRecipient.findFirst({
      where: { userId, notificationId },
    });
    if (!row) throw new NotFoundException('Notification not found');
    const dismissedAt = new Date();
    await this.prisma.notificationRecipient.update({
      where: { id: row.id },
      data: { dismissedAt },
    });
    this.gateway.emitNotificationDismissed(userId, {
      id: notificationId,
      dismissedAt: dismissedAt.toISOString(),
    });
    const count = await this.getUnreadCount(userId);
    this.gateway.emitUnreadCount(userId, count);
    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.NOTIFICATION,
      action: AuditAction.NOTIFICATION_DISMISSED,
      recordType: 'Notification',
      recordId: notificationId,
    });
    return { id: notificationId, dismissedAt: dismissedAt.toISOString() };
  }

  async getMyPreferences(userId: string) {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const byType = new Map(rows.map((r) => [r.type, r]));
    return ALL_NOTIFICATION_TYPES.map((type) => {
      const r = byType.get(type);
      return {
        type,
        inAppEnabled: r?.inAppEnabled ?? true,
        soundEnabled: r?.soundEnabled ?? true,
        emailEnabled: r?.emailEnabled ?? false,
        smsEnabled: r?.smsEnabled ?? false,
        pushEnabled: r?.pushEnabled ?? false,
      };
    });
  }

  async updateMyPreferences(userId: string, dto: UpdateNotificationPreferencesDto) {
    for (const p of dto.preferences) {
      const inAppEnabled = p.inAppEnabled ?? true
      const soundEnabled = (p.soundEnabled ?? true) && inAppEnabled
      await this.prisma.notificationPreference.upsert({
        where: { userId_type: { userId, type: p.type } },
        create: {
          userId,
          type: p.type,
          inAppEnabled,
          soundEnabled,
        },
        update: {
          inAppEnabled,
          soundEnabled,
        },
      });
    }
    await this.auditLogs.logAudit({
      userId,
      module: AuditModule.NOTIFICATION,
      action: AuditAction.NOTIFICATION_PREFERENCES_UPDATED,
      newValues: dto.preferences,
    });
    return this.getMyPreferences(userId);
  }
}
