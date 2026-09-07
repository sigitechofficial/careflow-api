import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationModule, NotificationSeverity, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveManagerUserIds } from '../notifications/resolve-manager-recipients';

@Injectable()
export class InitialAssessmentNotificationHook {
  private readonly logger = new Logger(InitialAssessmentNotificationHook.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private async managerUserIds(serviceUserId?: string): Promise<string[]> {
    let locationId: string | null = null;
    if (serviceUserId) {
      const su = await this.prisma.serviceUser.findFirst({
        where: { id: serviceUserId, deletedAt: null },
        select: { locationId: true },
      });
      locationId = su?.locationId ?? null;
    }
    return resolveManagerUserIds(this.prisma, { locationId });
  }

  async onSubmitted(params: {
    submissionId: string;
    serviceUserId: string;
    serviceUserName?: string;
    submittedById: string;
    managerReviewRequired?: boolean;
    notifyManagers?: boolean;
  }): Promise<void> {
    if (!this.notifications) {
      this.logger.debug(`[TODO] Initial assessment submitted ${params.submissionId}: no notification service`);
      return;
    }

    const label = params.serviceUserName?.trim() || params.serviceUserId;
    const recipients = new Set<string>([params.submittedById]);
    const notifyManagers = params.notifyManagers !== false && params.managerReviewRequired;

    if (notifyManagers) {
      for (const id of await this.managerUserIds(params.serviceUserId)) {
        if (id !== params.submittedById) recipients.add(id);
      }
    }

    try {
      await this.notifications.notifyUsers({
        recipientUserIds: [...recipients],
        type: NotificationType.SYSTEM_MESSAGE,
        title: params.managerReviewRequired
          ? 'Initial assessment — manager review required'
          : 'Initial assessment submitted',
        message: params.managerReviewRequired
          ? `Initial assessment for ${label} was submitted and requires manager review.`
          : `Initial assessment for ${label} was submitted successfully.`,
        severity: params.managerReviewRequired
          ? NotificationSeverity.WARNING
          : NotificationSeverity.INFO,
        module: NotificationModule.SERVICE_USER,
        recordType: 'InitialAssessmentSubmission',
        recordId: params.submissionId,
        metadata: params,
        createdById: params.submittedById,
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
