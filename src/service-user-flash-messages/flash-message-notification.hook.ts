import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  NotificationModule,
  NotificationSeverity,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class FlashMessageNotificationHook {
  private readonly logger = new Logger(FlashMessageNotificationHook.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

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

  private async managerUserIds(): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: { name: { in: ['Admin', 'Manager'] }, deletedAt: null },
      select: { id: true },
    });
    if (!roles.length) return [];
    const links = await this.prisma.userRole.findMany({
      where: { roleId: { in: roles.map((r) => r.id) } },
      select: { userId: true },
    });
    return [...new Set(links.map((l) => l.userId))];
  }

  async notifyFlashMessageChanged(params: {
    serviceUserId: string;
    serviceUserName: string;
    flashMessageId: string;
    action: 'created' | 'updated' | 'cleared';
    createdById?: string;
  }): Promise<void> {
    if (!this.notifications) {
      this.logger.debug(
        `[TODO] Flash message ${params.action} for ${params.serviceUserId}: NotificationsService not configured`,
      );
      return;
    }

    try {
      const su = await this.prisma.serviceUser.findFirst({
        where: { id: params.serviceUserId, deletedAt: null },
        select: { keyWorkerId: true, namedNurseId: true },
      });
      const recipientIds = new Set<string>();
      if (su?.keyWorkerId) {
        const uid = await this.userIdForEmployee(su.keyWorkerId);
        if (uid) recipientIds.add(uid);
      }
      if (su?.namedNurseId) {
        const uid = await this.userIdForEmployee(su.namedNurseId);
        if (uid) recipientIds.add(uid);
      }
      for (const uid of await this.managerUserIds()) {
        recipientIds.add(uid);
      }
      if (params.createdById) {
        recipientIds.delete(params.createdById);
      }

      if (!recipientIds.size) {
        this.logger.debug(
          `[TODO] Flash message notify: no linked user accounts for key worker / named nurse / managers`,
        );
        return;
      }

      const verb =
        params.action === 'cleared'
          ? 'cleared'
          : params.action === 'created'
            ? 'set'
            : 'updated';

      await this.notifications.notifyUsers({
        recipientUserIds: [...recipientIds],
        type: NotificationType.SERVICE_USER_UPDATED,
        title: 'Service User Flash Message Updated',
        message: `A flash message was ${verb} for ${params.serviceUserName}.`,
        module: NotificationModule.SERVICE_USER,
        severity: NotificationSeverity.INFO,
        recordType: 'ServiceUserFlashMessage',
        recordId: params.flashMessageId,
        createdById: params.createdById,
        metadata: {
          serviceUserId: params.serviceUserId,
          action: params.action,
        },
      });
    } catch (err) {
      this.logger.warn(`Flash message notification failed: ${(err as Error).message}`);
    }
  }
}
