import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationModule, NotificationSeverity, NotificationType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Optional notification fan-out for medication safety events.
 * Never throws: failures are logged and ignored so MAR writes are not blocked.
 */
@Injectable()
export class MedicationNotificationHook {
  private readonly logger = new Logger(MedicationNotificationHook.name);

  constructor(@Optional() private readonly notifications?: NotificationsService) {}

  async medicationAlert(params: {
    recipientUserIds: string[];
    title: string;
    message: string;
    metadata?: unknown;
  }): Promise<void> {
    if (!this.notifications || !params.recipientUserIds.length) {
      return;
    }
    try {
      await this.notifications.notifyUsers({
        recipientUserIds: params.recipientUserIds,
        type: NotificationType.MEDICATION_ALERT,
        title: params.title,
        message: params.message,
        module: NotificationModule.SERVICE_CARE,
        severity: NotificationSeverity.WARNING,
        metadata: params.metadata,
      });
    } catch (err) {
      this.logger.warn(`Medication notification failed: ${(err as Error).message}`);
    }
  }
}
