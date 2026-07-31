import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationModule, NotificationSeverity, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ScheduleAllocationNotificationHook {
  private readonly logger = new Logger(ScheduleAllocationNotificationHook.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private async userIdForEmployee(employeeId: string): Promise<string | null> {
    const pd = await this.prisma.employeePersonalDetail.findFirst({
      where: { employeeId, deletedAt: null, email: { not: null } },
    });
    if (!pd?.email) return null;
    const user = await this.prisma.user.findFirst({
      where: { email: pd.email, deletedAt: null, isActive: true },
    });
    return user?.id ?? null;
  }

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

  async notifyAllocated(params: {
    employeeId: string;
    scheduledJobId: string;
    jobName: string;
    serviceUserId: string;
    scheduledStartDateTime?: Date;
    scheduledEndDateTime?: Date;
  }): Promise<void> {
    if (!this.notifications) return;
    try {
      const userId = await this.userIdForEmployee(params.employeeId);
      if (userId) {
        const timeSuffix =
          params.scheduledStartDateTime && params.scheduledEndDateTime
            ? ` (${params.scheduledStartDateTime.toISOString().slice(11, 16)}–${params.scheduledEndDateTime.toISOString().slice(11, 16)} UTC)`
            : '';
        await this.notifications.notifyUsers({
          recipientUserIds: [userId],
          type: NotificationType.SYSTEM_MESSAGE,
          title: 'New schedule allocation',
          message: `You have been allocated to "${params.jobName}"${timeSuffix}.`,
          module: NotificationModule.SCHEDULING,
          recordType: 'ScheduledJob',
          recordId: params.scheduledJobId,
          metadata: {
            serviceUserId: params.serviceUserId,
            employeeId: params.employeeId,
            scheduledStartDateTime: params.scheduledStartDateTime?.toISOString() ?? null,
            scheduledEndDateTime: params.scheduledEndDateTime?.toISOString() ?? null,
          },
        });
      }
    } catch (err) {
      this.logger.warn(`Allocation notify employee failed: ${(err as Error).message}`);
    }
  }

  async notifyJobNeedsAttention(params: {
    scheduledJobId: string;
    jobName: string;
    serviceUserId: string;
  }): Promise<void> {
    if (!this.notifications) return;
    try {
      const staffAllocation = await this.prisma.role.findFirst({
        where: { name: 'Staff Allocation', deletedAt: null },
        select: { id: true },
      });
      if (!staffAllocation) return;
      const links = await this.prisma.userRole.findMany({
        where: { roleId: staffAllocation.id },
        select: { userId: true },
      });
      const recipientUserIds = [...new Set(links.map((l) => l.userId))];
      if (!recipientUserIds.length) return;
      await this.notifications.notifyUsers({
        recipientUserIds,
        type: NotificationType.SCHEDULE_UNALLOCATED_VISIT,
        title: 'Scheduled job needs attention',
        message: `"${params.jobName}" is under-allocated or has allocation warnings.`,
        module: NotificationModule.SCHEDULING,
        severity: NotificationSeverity.WARNING,
        recordType: 'ScheduledJob',
        recordId: params.scheduledJobId,
        metadata: { serviceUserId: params.serviceUserId },
      });
    } catch (err) {
      this.logger.warn(`Needs-attention notify failed: ${(err as Error).message}`);
    }
  }

  async notifyRequiresConfirmation(params: {
    scheduledJobId: string;
    jobName: string;
    employeeId: string;
  }): Promise<void> {
    if (!this.notifications) return;
    try {
      const managers = await this.managerUserIds();
      if (!managers.length) return;
      await this.notifications.notifyUsers({
        recipientUserIds: managers,
        type: NotificationType.SCHEDULE_UNALLOCATED_VISIT,
        title: 'Allocation needs confirmation',
        message: `Allocation to "${params.jobName}" has warnings and requires manager confirmation.`,
        module: NotificationModule.SCHEDULING,
        severity: NotificationSeverity.WARNING,
        recordType: 'ScheduledJob',
        recordId: params.scheduledJobId,
        metadata: { employeeId: params.employeeId },
      });
    } catch (err) {
      this.logger.warn(`Allocation notify manager failed: ${(err as Error).message}`);
    }
  }
}
