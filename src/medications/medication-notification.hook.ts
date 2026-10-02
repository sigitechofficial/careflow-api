import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  MedicationAdministrationStatus,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  formatNotificationDate,
  formatNotificationTime,
  loadNotificationDisplay,
} from '../common/utils/notification-display.util';
import { resolveManagerUserIds } from '../notifications/resolve-manager-recipients';

const STATUS_LABEL: Record<MedicationAdministrationStatus, string> = {
  GIVEN: 'given',
  NOT_GIVEN: 'not given',
  REFUSED: 'refused',
  MISSED: 'missed',
  HELD: 'held',
  CANCELLED: 'cancelled',
  PENDING: 'pending',
};

/**
 * Optional notification fan-out for medication safety events.
 * Recipients: the service user's key worker + named nurse, and managers for the
 * service user's branch (same audience as care plan review reminders), minus
 * whoever recorded the event.
 * Never throws: failures are logged and ignored so MAR writes are not blocked.
 */
@Injectable()
export class MedicationNotificationHook {
  private readonly logger = new Logger(MedicationNotificationHook.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * One office alert per MAR event when it is missed/refused or involves a
   * controlled medication. Other outcomes are ignored.
   */
  async notifyAdministrationEvent(params: {
    eventId: string;
    serviceUserId: string;
    medicationName: string;
    status: MedicationAdministrationStatus;
    controlled: boolean;
    occurredAt?: Date | null;
    actorUserId?: string | null;
    actorEmployeeId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const missed = params.status === MedicationAdministrationStatus.MISSED;
    const refused = params.status === MedicationAdministrationStatus.REFUSED;
    if (!missed && !refused && !params.controlled) return;
    if (!this.notifications) return;

    try {
      const su = await this.prisma.serviceUser.findFirst({
        where: { id: params.serviceUserId, deletedAt: null },
        select: {
          firstName: true,
          lastName: true,
          preferredName: true,
          keyWorkerId: true,
          namedNurseId: true,
          locationId: true,
        },
      });
      if (!su) return;

      const recipientIds = new Set<string>(
        await resolveManagerUserIds(this.prisma, { locationId: su.locationId }),
      );
      for (const employeeId of [su.keyWorkerId, su.namedNurseId]) {
        if (!employeeId) continue;
        const uid = await this.userIdForEmployee(employeeId);
        if (uid) recipientIds.add(uid);
      }
      if (params.actorUserId) recipientIds.delete(params.actorUserId);
      if (params.actorEmployeeId) {
        const actorUid = await this.userIdForEmployee(params.actorEmployeeId);
        if (actorUid) recipientIds.delete(actorUid);
      }
      if (!recipientIds.size) return;

      const fullName =
        [su.firstName, su.lastName].filter(Boolean).join(' ').trim() ||
        su.preferredName?.trim() ||
        'Service user';
      const suName = su.preferredName?.trim() || fullName;
      const statusLabel = STATUS_LABEL[params.status] ?? params.status.toLowerCase();

      const title = missed
        ? `Medication missed — ${suName}`
        : refused
          ? `Medication refused — ${suName}`
          : `Controlled medication ${statusLabel} — ${suName}`;

      let when = '';
      if (params.occurredAt) {
        const display = await loadNotificationDisplay(this.prisma);
        when = ` at ${formatNotificationTime(params.occurredAt, display)} on ${formatNotificationDate(params.occurredAt, display)}`;
      }
      const drug = params.controlled
        ? `${params.medicationName} (controlled)`
        : params.medicationName;
      const message = `${drug} was ${statusLabel}${when} — ${fullName}.`;

      await this.notifications.notifyUsers({
        recipientUserIds: [...recipientIds],
        type: NotificationType.MEDICATION_ALERT,
        title,
        message,
        module: NotificationModule.SERVICE_CARE,
        severity: NotificationSeverity.WARNING,
        recordType: 'MedicationAdministrationEvent',
        recordId: params.eventId,
        metadata: {
          serviceUserId: params.serviceUserId,
          status: params.status,
          controlledMedication: params.controlled,
          ...(params.metadata ?? {}),
        },
      });
    } catch (err) {
      this.logger.warn(`Medication notification failed: ${(err as Error).message}`);
    }
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
}
