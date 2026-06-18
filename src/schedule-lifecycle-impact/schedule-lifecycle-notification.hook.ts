import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationModule, NotificationSeverity, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { ScheduleImpactSource } from './schedule-lifecycle-impact.util';

@Injectable()
export class ScheduleLifecycleNotificationHook {
  private readonly logger = new Logger(ScheduleLifecycleNotificationHook.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private async coordinatorUserIds(): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: {
        name: { in: ['Staff Allocation', 'Manager', 'Admin'] },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!roles.length) return [];
    const links = await this.prisma.userRole.findMany({
      where: { roleId: { in: roles.map((r) => r.id) } },
      select: { userId: true },
    });
    return [...new Set(links.map((l) => l.userId))];
  }

  async notifyBulkScheduleImpact(params: {
    source: ScheduleImpactSource;
    reason: string;
    jobsCancelled: number;
    jobsUnallocated: number;
    serviceUserId?: string;
    employeeId?: string;
    planSkipExceptionsAdded?: number;
    actorUserId?: string;
  }): Promise<void> {
    if (!this.notifications) return;
    const total = params.jobsCancelled + params.jobsUnallocated;
    if (total === 0 && !(params.planSkipExceptionsAdded ?? 0)) return;

    try {
      const recipientUserIds = await this.coordinatorUserIds();
      if (!recipientUserIds.length) return;

      const parts: string[] = [];
      if (params.jobsCancelled) {
        parts.push(`${params.jobsCancelled} visit${params.jobsCancelled === 1 ? '' : 's'} cancelled or called off`);
      }
      if (params.jobsUnallocated) {
        parts.push(`${params.jobsUnallocated} visit${params.jobsUnallocated === 1 ? '' : 's'} need cover (carer removed)`);
      }
      if (params.planSkipExceptionsAdded) {
        parts.push(
          `${params.planSkipExceptionsAdded} visit-plan skip date${params.planSkipExceptionsAdded === 1 ? '' : 's'} added`,
        );
      }

      const title =
        params.source === 'service_user_absence'
          ? 'Rota updated — client absence'
          : params.source === 'employee_holiday' || params.source === 'employee_non_core_activity'
            ? 'Rota updated — carer unavailable'
            : params.source === 'employee_inactive'
              ? 'Rota updated — employee inactive'
              : 'Rota updated — visit plan change';

      await this.notifications.notifyUsers({
        recipientUserIds,
        type: NotificationType.SCHEDULE_UNALLOCATED_VISIT,
        title,
        message: `${parts.join('; ')}. ${params.reason}`.trim(),
        module: NotificationModule.SCHEDULING,
        severity: NotificationSeverity.WARNING,
        recordType: 'ScheduleLifecycleImpact',
        recordId: params.serviceUserId ?? params.employeeId ?? undefined,
        metadata: {
          source: params.source,
          jobsCancelled: params.jobsCancelled,
          jobsUnallocated: params.jobsUnallocated,
          planSkipExceptionsAdded: params.planSkipExceptionsAdded ?? 0,
          serviceUserId: params.serviceUserId,
          employeeId: params.employeeId,
        },
        createdById: params.actorUserId,
      });
    } catch (err) {
      this.logger.warn(`Bulk schedule impact notify failed: ${(err as Error).message}`);
    }
  }
}
