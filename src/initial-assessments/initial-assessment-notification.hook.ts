import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationModule, NotificationSeverity, NotificationType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class InitialAssessmentNotificationHook {
  private readonly logger = new Logger(InitialAssessmentNotificationHook.name);

  constructor(@Optional() private readonly notifications?: NotificationsService) {}

  async onSubmitted(params: {
    submissionId: string;
    serviceUserId: string;
    submittedById: string;
  }): Promise<void> {
    if (!this.notifications) {
      this.logger.debug(`[TODO] Initial assessment submitted ${params.submissionId}: no notification service`);
      return;
    }
    try {
      await this.notifications.notifyUsers({
        recipientUserIds: [params.submittedById],
        type: NotificationType.SYSTEM_MESSAGE,
        title: 'Initial assessment submitted',
        message: `Initial assessment ${params.submissionId} submitted for service user ${params.serviceUserId}.`,
        severity: NotificationSeverity.INFO,
        module: NotificationModule.SERVICE_USER,
        metadata: params,
      });
    } catch (e) {
      this.logger.warn(`Failed to send initial assessment submitted notification: ${e}`);
    }
  }

  async onReviewed(params: {
    submissionId: string;
    serviceUserId: string;
    reviewedById: string;
  }): Promise<void> {
    if (!this.notifications) {
      this.logger.debug(`[TODO] Initial assessment reviewed ${params.submissionId}: no notification service`);
      return;
    }
    try {
      await this.notifications.notifyUsers({
        recipientUserIds: [params.reviewedById],
        type: NotificationType.SYSTEM_MESSAGE,
        title: 'Initial assessment reviewed',
        message: `Initial assessment ${params.submissionId} has been reviewed.`,
        severity: NotificationSeverity.INFO,
        module: NotificationModule.SERVICE_USER,
        metadata: params,
      });
    } catch (e) {
      this.logger.warn(`Failed to send initial assessment reviewed notification: ${e}`);
    }
  }
}
