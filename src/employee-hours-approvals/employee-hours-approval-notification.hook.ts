import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationModule, NotificationSeverity, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class EmployeeHoursApprovalNotificationHook {
  private readonly logger = new Logger(EmployeeHoursApprovalNotificationHook.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private async approverUserIds(): Promise<string[]> {
    const perm = await this.prisma.permission.findFirst({
      where: { key: 'hours_approvals.manage', deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!perm) return [];
    const roleLinks = await this.prisma.rolePermission.findMany({
      where: { permissionId: perm.id, role: { deletedAt: null } },
      select: { roleId: true },
    });
    if (!roleLinks.length) return [];
    const userRoles = await this.prisma.userRole.findMany({
      where: {
        roleId: { in: roleLinks.map((r) => r.roleId) },
        user: { deletedAt: null, isActive: true },
      },
      select: { userId: true },
    });
    return [...new Set(userRoles.map((ur) => ur.userId))];
  }

  async notifyPendingCreated(params: {
    approvalId: string;
    employeeId: string;
    serviceUserId: string;
    visitPlanId: string;
    extraHours: number;
    projectedWeeklyHours: number;
    contractedWeeklyHours: number;
    requestedById?: string;
  }): Promise<void> {
    if (!this.notifications) return;
    try {
      const recipientUserIds = await this.approverUserIds();
      if (!recipientUserIds.length) return;

      const [employee, serviceUser] = await Promise.all([
        this.prisma.employee.findFirst({
          where: { id: params.employeeId },
          select: { personalDetail: { select: { firstName: true, lastName: true } } },
        }),
        this.prisma.serviceUser.findFirst({
          where: { id: params.serviceUserId },
          select: { firstName: true, lastName: true },
        }),
      ]);
      const employeeName =
        `${employee?.personalDetail?.firstName ?? ''} ${employee?.personalDetail?.lastName ?? ''}`.trim() ||
        'A carer';
      const serviceUserName =
        `${serviceUser?.firstName ?? ''} ${serviceUser?.lastName ?? ''}`.trim() || 'a service user';

      await this.notifications.notifyUsers({
        recipientUserIds,
        type: NotificationType.SYSTEM_MESSAGE,
        title: `+${params.extraHours}h over contract — ${employeeName}`,
        message: `${employeeName} would work ~${params.projectedWeeklyHours}h/week on ${serviceUserName}'s visit plan (contracted ${params.contractedWeeklyHours}h/week). Open Hours Approvals to approve or reject.`,
        module: NotificationModule.SERVICE_USER,
        severity: NotificationSeverity.WARNING,
        recordType: 'EmployeeHoursApproval',
        recordId: params.approvalId,
        metadata: {
          href: '/hours-approvals',
          approvalId: params.approvalId,
          employeeId: params.employeeId,
          serviceUserId: params.serviceUserId,
          visitPlanId: params.visitPlanId,
          extraHours: params.extraHours,
          projectedWeeklyHours: params.projectedWeeklyHours,
          contractedWeeklyHours: params.contractedWeeklyHours,
        },
        createdById: params.requestedById,
      });
    } catch (err) {
      this.logger.warn(`Hours approval notify failed: ${(err as Error).message}`);
    }
  }

  /** Tell approvers a carer's contracted weekly hours change is waiting for them. */
  async notifyContractedChangeRequested(params: {
    approvalId: string;
    employeeId: string;
    previousContractedWeeklyHours: number | null;
    requestedContractedWeeklyHours: number;
    rotaVisitsToUnassign: number;
    requestedById?: string;
  }): Promise<void> {
    if (!this.notifications) return;
    try {
      const recipientUserIds = await this.approverUserIds();
      if (!recipientUserIds.length) return;
      const employee = await this.prisma.employee.findFirst({
        where: { id: params.employeeId },
        select: { personalDetail: { select: { firstName: true, lastName: true } } },
      });
      const employeeName =
        `${employee?.personalDetail?.firstName ?? ''} ${employee?.personalDetail?.lastName ?? ''}`.trim() ||
        'A carer';
      const from = params.previousContractedWeeklyHours ?? 0;
      const unassignText =
        params.rotaVisitsToUnassign > 0
          ? ` If approved, ${params.rotaVisitsToUnassign} upcoming visit${params.rotaVisitsToUnassign === 1 ? '' : 's'} over the new limit will be unassigned.`
          : '';
      await this.notifications.notifyUsers({
        recipientUserIds,
        type: NotificationType.SYSTEM_MESSAGE,
        title: `Contracted hours change — ${employeeName}`,
        message: `${employeeName}: contracted weekly hours ${from}h → ${params.requestedContractedWeeklyHours}h needs approval.${unassignText} Open Hours Approvals to approve or reject.`,
        module: NotificationModule.SERVICE_USER,
        severity: NotificationSeverity.WARNING,
        recordType: 'EmployeeHoursApproval',
        recordId: params.approvalId,
        metadata: {
          href: '/hours-approvals',
          approvalId: params.approvalId,
          employeeId: params.employeeId,
          previousContractedWeeklyHours: params.previousContractedWeeklyHours,
          requestedContractedWeeklyHours: params.requestedContractedWeeklyHours,
        },
        createdById: params.requestedById,
      });
    } catch (err) {
      this.logger.warn(`Contracted hours request notify failed: ${(err as Error).message}`);
    }
  }

  async notifyServiceUserHoursChangeRequested(params: {
    approvalId: string;
    serviceUserId: string;
    previousWeeklyHours: number | null;
    requestedWeeklyHours: number;
    requestedById?: string;
  }): Promise<void> {
    if (!this.notifications) return;
    try {
      const recipientUserIds = await this.approverUserIds();
      if (!recipientUserIds.length) return;
      const su = await this.prisma.serviceUser.findFirst({
        where: { id: params.serviceUserId },
        select: { firstName: true, lastName: true },
      });
      const suName = `${su?.firstName ?? ''} ${su?.lastName ?? ''}`.trim() || 'A service user';
      const from = params.previousWeeklyHours ?? 0;
      await this.notifications.notifyUsers({
        recipientUserIds,
        type: NotificationType.SYSTEM_MESSAGE,
        title: `Weekly hours change — ${suName}`,
        message: `${suName}: weekly contracted hours ${from}h → ${params.requestedWeeklyHours}h needs approval. Open Hours Approvals to approve or reject.`,
        module: NotificationModule.SERVICE_USER,
        severity: NotificationSeverity.WARNING,
        recordType: 'EmployeeHoursApproval',
        recordId: params.approvalId,
        metadata: {
          href: '/hours-approvals',
          approvalId: params.approvalId,
          serviceUserId: params.serviceUserId,
          previousWeeklyHours: params.previousWeeklyHours,
          requestedWeeklyHours: params.requestedWeeklyHours,
        },
        createdById: params.requestedById,
      });
    } catch (err) {
      this.logger.warn(`Service user hours request notify failed: ${(err as Error).message}`);
    }
  }

  async notifyExtraVisitRequested(params: {
    approvalId: string;
    serviceUserId: string;
    /** "Wed 11/11/2026 14:00–16:00", already in the organisation's format. */
    visitLabel: string;
    weekHoursLabel: string;
    requestedById?: string;
  }): Promise<void> {
    if (!this.notifications) return;
    try {
      const recipientUserIds = await this.approverUserIds();
      if (!recipientUserIds.length) return;
      const su = await this.prisma.serviceUser.findFirst({
        where: { id: params.serviceUserId },
        select: { firstName: true, lastName: true },
      });
      const suName = `${su?.firstName ?? ''} ${su?.lastName ?? ''}`.trim() || 'A service user';
      await this.notifications.notifyUsers({
        recipientUserIds,
        type: NotificationType.SYSTEM_MESSAGE,
        title: `Extra visit over weekly hours — ${suName}`,
        message: `${suName}: extra visit on ${params.visitLabel} takes the week to ${params.weekHoursLabel}. Open Hours Approvals to approve or reject.`,
        module: NotificationModule.SERVICE_USER,
        severity: NotificationSeverity.WARNING,
        recordType: 'EmployeeHoursApproval',
        recordId: params.approvalId,
        metadata: { href: '/hours-approvals', approvalId: params.approvalId, serviceUserId: params.serviceUserId },
        createdById: params.requestedById,
      });
    } catch (err) {
      this.logger.warn(`Extra visit request notify failed: ${(err as Error).message}`);
    }
  }

  /** Tell the person who sent a request that a manager approved or rejected it. */
  async notifyRequesterDecided(params: {
    approvalId: string;
    requestedById: string | null;
    decidedById: string;
    approved: boolean;
    title: string;
    message: string;
    href?: string;
  }): Promise<void> {
    if (!this.notifications || !params.requestedById || params.requestedById === params.decidedById) return;
    try {
      await this.notifications.notifyUsers({
        recipientUserIds: [params.requestedById],
        type: NotificationType.SYSTEM_MESSAGE,
        title: params.title,
        message: params.message,
        module: NotificationModule.SERVICE_USER,
        severity: params.approved ? NotificationSeverity.INFO : NotificationSeverity.WARNING,
        recordType: 'EmployeeHoursApproval',
        recordId: params.approvalId,
        metadata: { href: params.href ?? '/hours-approvals', approvalId: params.approvalId },
        createdById: params.decidedById,
      });
    } catch (err) {
      this.logger.warn(`Hours request decision notify failed: ${(err as Error).message}`);
    }
  }
}
