import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationModule, NotificationSeverity, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveManagerUserIds } from '../notifications/resolve-manager-recipients';
import {
  formatNotificationDate,
  loadNotificationDisplay,
} from '../common/utils/notification-display.util';
import {
  buildInitialAssessmentReviewedNotification,
  buildInitialAssessmentSubmittedNotification,
} from './initial-assessment-notification.util';

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

  /** Short (preferred) + full name, e.g. { short: 'Harry', full: 'Harry Max' }. */
  private async serviceUserNames(
    serviceUserId: string,
  ): Promise<{ short: string | null; full: string | null }> {
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId },
      select: { firstName: true, lastName: true, preferredName: true },
    });
    const full = [su?.firstName, su?.lastName].filter(Boolean).join(' ').trim() || null;
    return { short: su?.preferredName?.trim() || full, full };
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

    const names = await this.serviceUserNames(params.serviceUserId);
    const { title, message } = buildInitialAssessmentSubmittedNotification({
      managerReviewRequired: Boolean(params.managerReviewRequired),
      serviceUserShortName: names.short,
      serviceUserFullName: names.full ?? params.serviceUserName,
    });
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
        title,
        message,
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
      const submission = await this.prisma.initialAssessmentSubmission.findUnique({
        where: { id: params.submissionId },
        select: {
          status: true,
          submittedById: true,
          reviewedAt: true,
          reviewNotes: true,
          metadata: true,
        },
      });
      // The submitter is the one waiting on the outcome; nobody to tell when they reviewed it themselves.
      if (!submission?.submittedById || submission.submittedById === params.reviewedById) return;

      const meta =
        submission.metadata && typeof submission.metadata === 'object' && !Array.isArray(submission.metadata)
          ? (submission.metadata as Record<string, unknown>)
          : {};
      const reviewer = await this.prisma.user.findUnique({
        where: { id: params.reviewedById },
        select: { firstName: true, lastName: true, email: true },
      });
      const reviewerName =
        [reviewer?.firstName, reviewer?.lastName].filter(Boolean).join(' ').trim() ||
        reviewer?.email ||
        'A manager';
      const names = await this.serviceUserNames(params.serviceUserId);
      const display = await loadNotificationDisplay(this.prisma);
      const { title, message } = buildInitialAssessmentReviewedNotification({
        status: submission.status,
        approvedForCareStart:
          typeof meta.approvedForCareStart === 'boolean' ? meta.approvedForCareStart : null,
        careStartConditions:
          typeof meta.careStartConditions === 'string' ? meta.careStartConditions : null,
        reviewNotes: submission.reviewNotes,
        reviewerName,
        reviewedOnLabel: submission.reviewedAt
          ? formatNotificationDate(submission.reviewedAt, display)
          : null,
        serviceUserShortName: names.short,
        serviceUserFullName: names.full,
      });

      await this.notifications.notifyUsers({
        recipientUserIds: [submission.submittedById],
        type: NotificationType.SYSTEM_MESSAGE,
        title,
        message,
        severity: NotificationSeverity.INFO,
        module: NotificationModule.SERVICE_USER,
        recordType: 'InitialAssessmentSubmission',
        recordId: params.submissionId,
        metadata: params,
        createdById: params.reviewedById,
      });
    } catch (e) {
      this.logger.warn(`Failed to send initial assessment reviewed notification: ${e}`);
    }
  }
}
