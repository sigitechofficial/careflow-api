import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  EcmAuditEventType,
  EcmCriticality,
  EcmExceptionLifecycle,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EcmAuditService } from './ecm-audit.service';
import { slaTargetsForCriticality } from './ecm-sla.util';

export type EcmAlertChannels = {
  notification: boolean;
  email: boolean;
  text: boolean;
};

/**
 * Generate ECM operational alerts from exceptions (BE1.12 / GAP2 foundation).
 * Ownership + SLA timers live on EcmException; channels honour org Dom Care flags.
 */
@Injectable()
export class EcmAlertService {
  private readonly logger = new Logger(EcmAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: EcmAuditService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async applySlaAndAlert(params: {
    exceptionId: string;
    criticality?: EcmCriticality | string | null;
    notify?: boolean;
  }) {
    const row = await this.prisma.ecmException.findUnique({
      where: { id: params.exceptionId },
      include: {
        scheduledJob: {
          select: {
            id: true,
            jobName: true,
            serviceUser: {
              select: { firstName: true, lastName: true, preferredName: true },
            },
          },
        },
      },
    });
    if (!row) return null;

    const sla = slaTargetsForCriticality(params.criticality);
    const now = new Date();
    const escalationDeadlineAt =
      sla.escalationMinutes > 0
        ? new Date(now.getTime() + sla.escalationMinutes * 60_000)
        : now;

    const updated = await this.prisma.ecmException.update({
      where: { id: row.id },
      data: {
        lifecycle:
          row.lifecycle === EcmExceptionLifecycle.DETECTED
            ? EcmExceptionLifecycle.ALERT_GENERATED
            : row.lifecycle,
        responseTargetMinutes: row.responseTargetMinutes ?? sla.responseTargetMinutes,
        escalationDeadlineAt: row.escalationDeadlineAt ?? escalationDeadlineAt,
        overdue: escalationDeadlineAt.getTime() < Date.now() && !row.acknowledgedAt,
      },
    });

    await this.audit.append({
      eventType: EcmAuditEventType.ALERT_GENERATED,
      scheduledJobId: row.scheduledJobId,
      ecmExceptionId: row.id,
      summary: `Alert generated: ${row.kind} — ${row.title}`,
      detail: {
        kind: row.kind,
        criticality: params.criticality ?? null,
        responseTargetMinutes: sla.responseTargetMinutes,
        escalationMinutes: sla.escalationMinutes,
      },
    });

    if (params.notify !== false) {
      await this.routeChannels(updated.id, row);
    }

    return updated;
  }

  async refreshOverdueFlags(limit = 200) {
    const now = new Date();
    const open = await this.prisma.ecmException.findMany({
      where: {
        lifecycle: {
          in: [
            EcmExceptionLifecycle.DETECTED,
            EcmExceptionLifecycle.ALERT_GENERATED,
            EcmExceptionLifecycle.ASSIGNED,
            EcmExceptionLifecycle.ACKNOWLEDGED,
            EcmExceptionLifecycle.INVESTIGATING,
            EcmExceptionLifecycle.ACTION_TAKEN,
          ],
        },
        acknowledgedAt: null,
        escalationDeadlineAt: { lt: now },
        overdue: false,
      },
      take: limit,
      select: { id: true },
    });
    if (open.length === 0) return 0;
    await this.prisma.ecmException.updateMany({
      where: { id: { in: open.map((r) => r.id) } },
      data: { overdue: true },
    });
    return open.length;
  }

  private async routeChannels(
    exceptionId: string,
    row: {
      id: string;
      kind: string;
      title: string;
      scheduledJobId: string;
      scheduledJob: {
        jobName: string;
        serviceUser: {
          firstName: string | null;
          lastName: string | null;
          preferredName: string | null;
        };
      };
    },
  ) {
    const settings = await this.prisma.organisationGeneralSettings.findFirst({
      select: {
        domLateVisitAlertEmail: true,
        domLateVisitAlertText: true,
        domLateVisitAlertNotification: true,
      },
    });

    const channels: EcmAlertChannels = {
      notification: Boolean(settings?.domLateVisitAlertNotification),
      email: Boolean(settings?.domLateVisitAlertEmail),
      text: Boolean(settings?.domLateVisitAlertText),
    };

    const suName =
      row.scheduledJob.serviceUser.preferredName?.trim() ||
      [row.scheduledJob.serviceUser.firstName, row.scheduledJob.serviceUser.lastName]
        .filter(Boolean)
        .join(' ') ||
      'Service user';
    const message = `ECM ${row.kind}: ${row.title} — ${row.scheduledJob.jobName} (${suName})`;

    let recipientCount = 0;
    if (channels.notification && this.notifications) {
      try {
        const recipients = await this.managerUserIds();
        if (recipients.length) {
          await this.notifications.notifyUsers({
            recipientUserIds: recipients,
            type: NotificationType.SCHEDULE_UNALLOCATED_VISIT,
            title: `ECM alert — ${row.kind}`,
            message,
            module: NotificationModule.SCHEDULING,
            severity:
              row.kind.includes('MISSED') || row.kind.includes('VERY_LATE')
                ? NotificationSeverity.CRITICAL
                : NotificationSeverity.WARNING,
            recordType: 'EcmException',
            recordId: exceptionId,
            metadata: {
              kind: row.kind,
              scheduledJobId: row.scheduledJobId,
            },
          });
          recipientCount = recipients.length;
        }
      } catch (err) {
        this.logger.warn(`ECM notify failed for ${exceptionId}: ${String(err)}`);
      }
    }

    if (channels.email) {
      this.logger.warn(`[ECM alert EMAIL channel] ${message}`);
    }
    if (channels.text) {
      this.logger.warn(`[ECM alert SMS channel] ${message}`);
    }

    this.logger.debug(
      `ECM alert routed exception=${exceptionId} channels=${JSON.stringify(channels)} recipients=${recipientCount}`,
    );
  }

  private async managerUserIds(): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: {
        name: { in: ['Admin', 'Manager', 'Staff Allocation', 'Coordinator'] },
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
}
