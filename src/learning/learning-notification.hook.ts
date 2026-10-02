import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  LearningAssignmentStatus,
  LearningCertificateStatus,
  LearningNotificationEventType,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
} from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatNotificationDate,
  loadNotificationDisplay,
} from '../common/utils/notification-display.util';

@Injectable()
export class LearningNotificationHook {
  private readonly logger = new Logger(LearningNotificationHook.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async resolveUserIdsForEmployees(employeeIds: string[]): Promise<string[]> {
    if (employeeIds.length === 0) return [];
    const accounts = await this.prisma.employeePortalAccount.findMany({
      where: { employeeId: { in: employeeIds }, deletedAt: null, isEnabled: true },
      select: { email: true },
    });
    if (accounts.length === 0) return [];
    const emails = accounts.map((a) => a.email);
    const users = await this.prisma.user.findMany({
      where: { email: { in: emails }, deletedAt: null, isActive: true },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  async notifyAssignmentCreated(params: {
    employeeIds: string[];
    courseTitle: string;
    assignmentId: string;
    dueAt?: Date | null;
  }) {
    if (!this.notifications) return;
    const recipientUserIds = await this.resolveUserIdsForEmployees(params.employeeIds);
    if (recipientUserIds.length === 0) return;

    const display = params.dueAt ? await loadNotificationDisplay(this.prisma) : null;
    await this.notifications.notifyUsers({
      recipientUserIds,
      type: NotificationType.SYSTEM_MESSAGE,
      module: NotificationModule.SYSTEM,
      severity: NotificationSeverity.INFO,
      title: 'New learning assignment',
      message: `You have been assigned "${params.courseTitle}"${
        params.dueAt && display ? `, due ${formatNotificationDate(params.dueAt, display)}` : ''
      }.`,
      recordType: 'LearningAssignment',
      recordId: params.assignmentId,
      metadata: { eventType: LearningNotificationEventType.ASSIGNMENT_CREATED },
    });
  }

  async notifyDueOrOverdue(params: {
    employeeId: string;
    courseTitle: string;
    assignmentId: string;
    eventType: 'DUE_SOON' | 'OVERDUE';
  }) {
    if (!this.notifications) return;
    const recipientUserIds = await this.resolveUserIdsForEmployees([params.employeeId]);
    if (recipientUserIds.length === 0) return;

    const overdue = params.eventType === 'OVERDUE';
    await this.notifications.notifyUsers({
      recipientUserIds,
      type: NotificationType.SYSTEM_MESSAGE,
      module: NotificationModule.SYSTEM,
      severity: overdue ? NotificationSeverity.WARNING : NotificationSeverity.INFO,
      title: overdue ? 'Learning assignment overdue' : 'Learning assignment due soon',
      message: `"${params.courseTitle}" is ${overdue ? 'overdue' : 'due soon'}.`,
      recordType: 'LearningAssignment',
      recordId: params.assignmentId,
      metadata: { eventType: params.eventType },
    });
  }

  async notifyCertificateExpiring(params: {
    employeeId: string;
    certificateNumber: string;
    certificateId: string;
    expiresAt: Date;
  }) {
    if (!this.notifications) return;
    const recipientUserIds = await this.resolveUserIdsForEmployees([params.employeeId]);
    if (recipientUserIds.length === 0) return;

    const display = await loadNotificationDisplay(this.prisma);
    await this.notifications.notifyUsers({
      recipientUserIds,
      type: NotificationType.COMPLIANCE_EXPIRING,
      module: NotificationModule.EMPLOYEE_COMPLIANCE,
      severity: NotificationSeverity.WARNING,
      title: 'Learning certificate expiring',
      message: `Certificate ${params.certificateNumber} expires on ${formatNotificationDate(params.expiresAt, display)}.`,
      recordType: 'LearningCertificate',
      recordId: params.certificateId,
      metadata: { eventType: LearningNotificationEventType.CERTIFICATE_EXPIRING },
    });
  }

  async notifyCertificateExpired(params: {
    employeeId: string;
    certificateNumber: string;
    certificateId: string;
  }) {
    if (!this.notifications) return;
    const recipientUserIds = await this.resolveUserIdsForEmployees([params.employeeId]);
    if (recipientUserIds.length === 0) return;

    await this.notifications.notifyUsers({
      recipientUserIds,
      type: NotificationType.COMPLIANCE_EXPIRED,
      module: NotificationModule.EMPLOYEE_COMPLIANCE,
      severity: NotificationSeverity.WARNING,
      title: 'Learning certificate expired',
      message: `Certificate ${params.certificateNumber} has expired.`,
      recordType: 'LearningCertificate',
      recordId: params.certificateId,
      metadata: { eventType: LearningNotificationEventType.CERTIFICATE_EXPIRED },
    });
  }

  async isLearningModuleActive(): Promise<boolean> {
    const profile = await this.prisma.companyProfile.findFirst({
      select: { activeModules: true },
    });
    return profile?.activeModules?.includes('Learning') ?? false;
  }

  logSkipped(reason: string) {
    this.logger.debug(`Learning job skipped: ${reason}`);
  }

  activeAssignmentStatuses(): LearningAssignmentStatus[] {
    return [
      LearningAssignmentStatus.ASSIGNED,
      LearningAssignmentStatus.NOT_STARTED,
      LearningAssignmentStatus.IN_PROGRESS,
      LearningAssignmentStatus.AWAITING_ASSESSMENT,
      LearningAssignmentStatus.AWAITING_APPROVAL,
      LearningAssignmentStatus.OVERDUE,
    ];
  }

  expiredCertificateStatuses(): LearningCertificateStatus[] {
    return [LearningCertificateStatus.ACTIVE];
  }
}
