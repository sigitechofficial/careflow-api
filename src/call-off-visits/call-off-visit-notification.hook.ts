import { Injectable, Logger, Optional } from '@nestjs/common';
import { CarerVisitPushKind, NotificationModule, NotificationSeverity, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CarerVisitPushHook } from '../notifications/carer-visit-push.hook';

@Injectable()
export class CallOffVisitNotificationHook {
  private readonly logger = new Logger(CallOffVisitNotificationHook.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly carerPush?: CarerVisitPushHook,
  ) {}

  private async managerUserIds(): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: { name: { in: ['Admin', 'Manager', 'Staff Allocation'] }, deletedAt: null },
      select: { id: true },
    });
    if (!roles.length) return [];
    const links = await this.prisma.userRole.findMany({
      where: { roleId: { in: roles.map((r) => r.id) } },
      select: { userId: true },
    });
    return [...new Set(links.map((l) => l.userId))];
  }

  private async userIdForEmployee(employeeId: string): Promise<string | null> {
    const pd = await this.prisma.employeePersonalDetail.findFirst({
      where: { employeeId, deletedAt: null, email: { not: null } },
    });
    if (!pd?.email) return null;
    const user = await this.prisma.user.findFirst({
      where: { email: pd.email, deletedAt: null, isActive: true },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  async notifyCallOffCreated(params: {
    callOffVisitId: string;
    serviceUserId: string;
    reason: string;
    jobName?: string | null;
  }): Promise<void> {
    if (!this.notifications) return;
    try {
      const managers = await this.managerUserIds();
      if (!managers.length) return;
      await this.notifications.notifyUsers({
        recipientUserIds: managers,
        type: NotificationType.SYSTEM_MESSAGE,
        title: 'Call-off visit requested',
        message: params.jobName
          ? `Call-off requested for "${params.jobName}": ${params.reason}`
          : `Call-off visit requested: ${params.reason}`,
        module: NotificationModule.SCHEDULING,
        severity: NotificationSeverity.WARNING,
        recordType: 'CallOffVisit',
        recordId: params.callOffVisitId,
        metadata: { serviceUserId: params.serviceUserId },
      });
    } catch (err) {
      this.logger.warn(`Call-off created notify failed: ${(err as Error).message}`);
    }
  }

  async notifyJobCalledOff(params: {
    scheduledJobId: string;
    jobName: string;
    employeeIds: string[];
  }): Promise<void> {
    this.carerPush?.notify({
      employeeIds: params.employeeIds,
      kind: CarerVisitPushKind.VISIT_CALLED_OFF,
      title: 'Visit called off',
      body: `Your visit "${params.jobName}" has been called off.`,
      scheduledJobId: params.scheduledJobId,
    });
    if (!this.notifications) return;
    try {
      const userIds: string[] = [];
      for (const employeeId of params.employeeIds) {
        const uid = await this.userIdForEmployee(employeeId);
        if (uid) userIds.push(uid);
      }
      if (!userIds.length) return;
      await this.notifications.notifyUsers({
        recipientUserIds: [...new Set(userIds)],
        type: NotificationType.SYSTEM_MESSAGE,
        title: 'Visit called off',
        message: `Your allocation for "${params.jobName}" has been called off.`,
        module: NotificationModule.SCHEDULING,
        severity: NotificationSeverity.INFO,
        recordType: 'ScheduledJob',
        recordId: params.scheduledJobId,
        metadata: { employeeIds: params.employeeIds },
      });
    } catch (err) {
      this.logger.warn(`Call-off carer notify failed: ${(err as Error).message}`);
    }
  }
}
