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
}
