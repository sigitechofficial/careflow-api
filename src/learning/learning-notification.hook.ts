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

/** Manager copy of the expiry warning (kept apart from the carer's CERTIFICATE_EXPIRING). */
const MANAGER_EXPIRING_EVENT = 'CERTIFICATE_EXPIRING_MANAGER';
const MANAGER_EXPIRED_EVENT = 'CERTIFICATE_EXPIRED_MANAGER';

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
    // Once per certificate (18 Nov 2026): the nightly job used to send this every night.
    if (await this.certificateNotified(params.certificateId, LearningNotificationEventType.CERTIFICATE_EXPIRING)) return;
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

  /**
   * Training managers for the carer's branch (trainingManagerUserIds), once per certificate,
   * when it enters the expiry warning window (18 Nov 2026, user decision).
   */
  async notifyManagersCertificateExpiring(params: {
    employeeId: string;
    certificateId: string;
    certificateNumber: string;
    courseTitle: string;
    expiresAt: Date;
  }) {
    if (!this.notifications) return;
    if (await this.certificateNotified(params.certificateId, MANAGER_EXPIRING_EVENT)) return;
    const recipientUserIds = await this.trainingManagerUserIds(params.employeeId);
    if (!recipientUserIds.length) return;
    const display = await loadNotificationDisplay(this.prisma);
    const name = await this.employeeName(params.employeeId);
    await this.notifications.notifyUsers({
      recipientUserIds,
      type: NotificationType.COMPLIANCE_EXPIRING,
      module: NotificationModule.EMPLOYEE_COMPLIANCE,
      severity: NotificationSeverity.WARNING,
      title: 'Carer certificate expiring',
      message: `${name}'s "${params.courseTitle}" certificate (${params.certificateNumber}) expires on ${formatNotificationDate(params.expiresAt, display)}. See Learning › Certificates.`,
      recordType: 'LearningCertificate',
      recordId: params.certificateId,
      metadata: { eventType: MANAGER_EXPIRING_EVENT, employeeId: params.employeeId },
    });
  }

  /** A course became overdue (18 Nov 2026, user decision): tell the carer's training managers. */
  async notifyManagersOverdue(params: {
    employeeId: string;
    assignmentId: string;
    courseTitle: string;
    dueAt: Date | null;
  }) {
    if (!this.notifications) return;
    const recipientUserIds = await this.trainingManagerUserIds(params.employeeId);
    if (!recipientUserIds.length) return;
    const display = await loadNotificationDisplay(this.prisma);
    const name = await this.employeeName(params.employeeId);
    const due = params.dueAt ? ` (due ${formatNotificationDate(params.dueAt, display)})` : '';
    await this.notifications.notifyUsers({
      recipientUserIds,
      type: NotificationType.SYSTEM_MESSAGE,
      module: NotificationModule.SYSTEM,
      severity: NotificationSeverity.WARNING,
      title: 'Carer training overdue',
      message: `${name} has not finished "${params.courseTitle}"${due}. Review it in Learning › Assignments.`,
      recordType: 'LearningAssignment',
      recordId: params.assignmentId,
      metadata: { eventType: 'OVERDUE_MANAGER', employeeId: params.employeeId },
    });
  }

  /** A certificate has expired (18 Nov 2026, user decision): tell the carer's training managers. */
  async notifyManagersCertificateExpired(params: {
    employeeId: string;
    certificateId: string;
    certificateNumber: string;
    courseTitle: string;
  }) {
    if (!this.notifications) return;
    if (await this.certificateNotified(params.certificateId, MANAGER_EXPIRED_EVENT)) return;
    const recipientUserIds = await this.trainingManagerUserIds(params.employeeId);
    if (!recipientUserIds.length) return;
    const name = await this.employeeName(params.employeeId);
    await this.notifications.notifyUsers({
      recipientUserIds,
      type: NotificationType.COMPLIANCE_EXPIRED,
      module: NotificationModule.EMPLOYEE_COMPLIANCE,
      severity: NotificationSeverity.WARNING,
      title: 'Carer certificate expired',
      message: `${name}'s "${params.courseTitle}" certificate (${params.certificateNumber}) has expired. See Learning › Certificates.`,
      recordType: 'LearningCertificate',
      recordId: params.certificateId,
      metadata: { eventType: MANAGER_EXPIRED_EVENT, employeeId: params.employeeId },
    });
  }

  /** A notification of this kind was already sent for this certificate. */
  private async certificateNotified(certificateId: string, eventType: string): Promise<boolean> {
    const row = await this.prisma.notification.findFirst({
      where: {
        recordType: 'LearningCertificate',
        recordId: certificateId,
        metadata: { path: ['eventType'], equals: eventType },
      },
      select: { id: true },
    });
    return !!row;
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

  /**
   * Users who manage training for this carer: holders of learning.assignments.manage linked to the
   * carer's branch; everyone with the permission when nobody is linked to that branch (16 Nov 2026).
   */
  async trainingManagerUserIds(employeeId: string): Promise<string[]> {
    const perm = await this.prisma.permission.findFirst({
      where: { key: 'learning.assignments.manage', deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!perm) return [];
    const roleLinks = await this.prisma.rolePermission.findMany({
      where: { permissionId: perm.id, role: { deletedAt: null } },
      select: { roleId: true },
    });
    if (!roleLinks.length) return [];
    const holders = await this.prisma.userRole.findMany({
      where: {
        roleId: { in: roleLinks.map((r) => r.roleId) },
        user: { deletedAt: null, isActive: true },
      },
      select: { userId: true },
    });
    const all = [...new Set(holders.map((h) => h.userId))];
    if (!all.length) return [];
    const jobs = await this.prisma.employeeEmployment.findMany({
      where: { employeeId, isActive: true },
      select: { locationId: true, baseLocationId: true },
    });
    const branches = [
      ...new Set(jobs.flatMap((j) => [j.locationId, j.baseLocationId]).filter((x): x is string => !!x)),
    ];
    if (!branches.length) return all;
    const linked = await this.prisma.userLocation.findMany({
      where: { userId: { in: all }, locationId: { in: branches } },
      select: { userId: true },
    });
    const branchManagers = [...new Set(linked.map((l) => l.userId))];
    return branchManagers.length ? branchManagers : all;
  }

  private async employeeName(employeeId: string): Promise<string> {
    const p = await this.prisma.employeePersonalDetail.findFirst({
      where: { employeeId },
      select: { firstName: true, lastName: true },
    });
    return `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim() || 'A carer';
  }

  /** A course was finished after its due date. */
  async notifyCompletedLate(params: {
    assignmentId: string;
    employeeId: string;
    courseTitle: string;
    dueAt: Date;
    completedAt: Date;
  }) {
    if (!this.notifications) return;
    const recipientUserIds = await this.trainingManagerUserIds(params.employeeId);
    if (!recipientUserIds.length) return;
    const display = await loadNotificationDisplay(this.prisma);
    const name = await this.employeeName(params.employeeId);
    await this.notifications.notifyUsers({
      recipientUserIds,
      type: NotificationType.SYSTEM_MESSAGE,
      module: NotificationModule.SYSTEM,
      severity: NotificationSeverity.WARNING,
      title: 'Training completed late',
      message: `${name} completed "${params.courseTitle}" late (due ${formatNotificationDate(params.dueAt, display)}, completed ${formatNotificationDate(params.completedAt, display)}). Review it in Learning › Assignments.`,
      recordType: 'LearningAssignment',
      recordId: params.assignmentId,
      metadata: { eventType: 'COMPLETED_LATE' },
    });
  }

  /** The carer said in the app why an overdue course is late. */
  async notifyCarerLateReason(params: {
    assignmentId: string;
    employeeId: string;
    courseTitle: string;
    reason: string;
  }) {
    if (!this.notifications) return;
    const recipientUserIds = await this.trainingManagerUserIds(params.employeeId);
    if (!recipientUserIds.length) return;
    const name = await this.employeeName(params.employeeId);
    await this.notifications.notifyUsers({
      recipientUserIds,
      type: NotificationType.SYSTEM_MESSAGE,
      module: NotificationModule.SYSTEM,
      severity: NotificationSeverity.INFO,
      title: 'Reason for overdue training',
      message: `${name} says "${params.courseTitle}" is late: ${params.reason}. Review it in Learning › Assignments.`,
      recordType: 'LearningAssignment',
      recordId: params.assignmentId,
      metadata: { eventType: 'CARER_LATE_REASON' },
    });
  }

  /** Face to face / workplace course: the carer has done everything, the manager must decide. */
  async notifyAwaitingOutcome(params: {
    assignmentId: string;
    employeeId: string;
    courseTitle: string;
  }) {
    if (!this.notifications) return;
    const recipientUserIds = await this.trainingManagerUserIds(params.employeeId);
    if (!recipientUserIds.length) return;
    const name = await this.employeeName(params.employeeId);
    await this.notifications.notifyUsers({
      recipientUserIds,
      type: NotificationType.SYSTEM_MESSAGE,
      module: NotificationModule.SYSTEM,
      severity: NotificationSeverity.INFO,
      title: 'Training outcome needed',
      message: `${name} has finished "${params.courseTitle}". Record the outcome (Passed / Not passed) in Learning › Assignments.`,
      recordType: 'LearningAssignment',
      recordId: params.assignmentId,
      metadata: { eventType: 'AWAITING_OUTCOME' },
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
