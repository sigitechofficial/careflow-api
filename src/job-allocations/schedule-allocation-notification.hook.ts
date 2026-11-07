import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import {
  AllocationStatus,
  CarerVisitPushKind,
  NotificationModule,
  NotificationSeverity,
  NotificationType,
} from '@prisma/client';
import { resolveLeadEmployeeId } from '../employee-app/employee-app-multi-carer.util';
import { planLeadChangePushes, visitAssignPushBody } from './lead-carer.util';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CarerVisitPushHook } from '../notifications/carer-visit-push.hook';
import {
  formatHmInTimeZone,
  getOperationalTimeZone,
} from '../common/utils/operational-day.util';
import {
  formatNotificationDateTime,
  loadNotificationDisplay,
} from '../common/utils/notification-display.util';

/** Wait for multi-step admin edits (e.g. remove lead, then add replacement) to settle. */
const LEAD_CHANGE_PUSH_DELAY_MS = 3000;

const ACTIVE_ALLOCATION_STATUSES: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

@Injectable()
export class ScheduleAllocationNotificationHook implements OnModuleDestroy {
  private readonly logger = new Logger(ScheduleAllocationNotificationHook.name);
  private readonly pendingLeadPushes = new Map<
    string,
    {
      timer: ReturnType<typeof setTimeout>;
      previousLeadEmployeeId: string | null;
      newlyAssignedEmployeeIds: Set<string>;
    }
  >();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly carerPush?: CarerVisitPushHook,
  ) {}

  onModuleDestroy() {
    for (const pending of this.pendingLeadPushes.values()) clearTimeout(pending.timer);
    this.pendingLeadPushes.clear();
  }

  /**
   * Multi-carer visits: after the lead may have changed, tell the carers on the visit
   * (existing VISIT_CHANGE carer push — tap opens the visit; the app reads the new
   * role on its next load). Debounced per job and compared against the lead *before*
   * the first change, so a replace (remove lead → add new lead) sends one final set
   * of pushes instead of a promote-then-demote pair. Carers assigned in the same
   * change (`newlyAssignedEmployeeIds`) only get their "New visit assigned — you are
   * Lead/Support" push. See planLeadChangePushes.
   */
  scheduleLeadChangePush(params: {
    scheduledJobId: string;
    previousLeadEmployeeId: string | null;
    newlyAssignedEmployeeIds?: string[];
  }): void {
    if (!this.carerPush) return;
    const existing = this.pendingLeadPushes.get(params.scheduledJobId);
    if (existing) clearTimeout(existing.timer);
    const previousLeadEmployeeId = existing
      ? existing.previousLeadEmployeeId
      : params.previousLeadEmployeeId;
    const newlyAssignedEmployeeIds = new Set([
      ...(existing?.newlyAssignedEmployeeIds ?? []),
      ...(params.newlyAssignedEmployeeIds ?? []),
    ]);
    const timer = setTimeout(() => {
      this.pendingLeadPushes.delete(params.scheduledJobId);
      void this.sendLeadChangePush(
        params.scheduledJobId,
        previousLeadEmployeeId,
        newlyAssignedEmployeeIds,
      );
    }, LEAD_CHANGE_PUSH_DELAY_MS);
    timer.unref?.();
    this.pendingLeadPushes.set(params.scheduledJobId, {
      timer,
      previousLeadEmployeeId,
      newlyAssignedEmployeeIds,
    });
  }

  /** Remember carers assigned while a lead-change push is pending (they already got VISIT_ASSIGN). */
  noteAssignedDuringLeadChange(scheduledJobId: string, employeeId: string): void {
    this.pendingLeadPushes.get(scheduledJobId)?.newlyAssignedEmployeeIds.add(employeeId);
  }

  private async sendLeadChangePush(
    scheduledJobId: string,
    previousLeadEmployeeId: string | null,
    newlyAssignedEmployeeIds: Set<string>,
  ): Promise<void> {
    if (!this.carerPush || !previousLeadEmployeeId) return;
    try {
      const job = await this.prisma.scheduledJob.findFirst({
        where: { id: scheduledJobId, deletedAt: null },
        select: {
          jobName: true,
          serviceUserId: true,
          requiredCarers: true,
          allocations: {
            where: {
              deletedAt: null,
              isActive: true,
              status: { in: ACTIVE_ALLOCATION_STATUSES },
            },
            select: {
              id: true,
              employeeId: true,
              status: true,
              isLeadCarer: true,
              allocatedAt: true,
            },
          },
        },
      });
      if (!job) return;
      const currentLead = resolveLeadEmployeeId(job.requiredCarers, job.allocations);
      const plan = planLeadChangePushes({
        previousLeadEmployeeId,
        currentLeadEmployeeId: currentLead,
        activeEmployeeIds: job.allocations.map((a) => a.employeeId),
        newlyAssignedEmployeeIds,
      });
      this.logger.debug(
        `Lead change push job=${scheduledJobId} previousLead=${previousLeadEmployeeId} currentLead=${currentLead ?? '-'} newLeadPush=${plan.newLeadEmployeeId ?? '-'} inform=[${plan.informEmployeeIds.join(',')}]`,
      );

      if (plan.newLeadEmployeeId) {
        this.carerPush.notify({
          employeeIds: [plan.newLeadEmployeeId],
          kind: CarerVisitPushKind.VISIT_CHANGE,
          title: 'You are now the lead carer',
          body: `You are the lead carer for "${job.jobName}".`,
          scheduledJobId,
          serviceUserId: job.serviceUserId,
        });
      }
      if (plan.informEmployeeIds.length && currentLead) {
        const leadName = await this.employeeName(currentLead);
        this.carerPush.notify({
          employeeIds: plan.informEmployeeIds,
          kind: CarerVisitPushKind.VISIT_CHANGE,
          title: 'Lead carer changed',
          body: `${leadName} is now the lead carer for "${job.jobName}".`,
          scheduledJobId,
          serviceUserId: job.serviceUserId,
        });
      }
    } catch (err) {
      this.logger.warn(`Lead change push failed for job ${scheduledJobId}: ${(err as Error).message}`);
    }
  }

  private async userIdForEmployee(employeeId: string): Promise<string | null> {
    const pd = await this.prisma.employeePersonalDetail.findFirst({
      where: { employeeId, deletedAt: null, email: { not: null } },
    });
    if (!pd?.email) return null;
    const user = await this.prisma.user.findFirst({
      where: { email: pd.email, deletedAt: null, isActive: true },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  private async managerUserIds(): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: { name: { in: ['Admin', 'Manager', 'Staff Allocation'] }, deletedAt: null },
      select: { id: true },
    });
    if (!roles.length) return [];
    const links = await this.prisma.userRole.findMany({
      where: { roleId: { in: roles.map((r) => r.id) } },
      select: { userId: true },
    });
    return [...new Set(links.map((l) => l.userId))];
  }

  /** ` (09:00–10:00)` in the organisation's operational timezone. */
  private async visitTimeSuffix(start?: Date, end?: Date): Promise<string> {
    if (!start || !end) return '';
    try {
      const settings = await this.prisma.organisationGeneralSettings.findFirst({
        select: { timezone: true },
      });
      const timeZone = getOperationalTimeZone(settings?.timezone);
      return ` (${formatHmInTimeZone(start, timeZone)}–${formatHmInTimeZone(end, timeZone)})`;
    } catch (err) {
      this.logger.warn(`Allocation time format failed: ${(err as Error).message}`);
      return '';
    }
  }

  async notifyAllocated(params: {
    employeeId: string;
    scheduledJobId: string;
    jobName: string;
    serviceUserId: string;
    scheduledStartDateTime?: Date;
    scheduledEndDateTime?: Date;
    /** Multi-carer visits only: the carer's role, added to the push text. */
    role?: 'lead' | 'support' | null;
  }): Promise<void> {
    const timeSuffix = await this.visitTimeSuffix(
      params.scheduledStartDateTime,
      params.scheduledEndDateTime,
    );
    const body = visitAssignPushBody(params.jobName, timeSuffix, params.role);
    this.logger.debug(
      `VISIT_ASSIGN push job=${params.scheduledJobId} employee=${params.employeeId}: ${body}`,
    );
    this.carerPush?.notify({
      employeeIds: [params.employeeId],
      kind: CarerVisitPushKind.VISIT_ASSIGN,
      title: 'New visit assigned',
      body,
      scheduledJobId: params.scheduledJobId,
      serviceUserId: params.serviceUserId,
    });
    if (!this.notifications) return;
    try {
      const userId = await this.userIdForEmployee(params.employeeId);
      if (userId) {
        await this.notifications.notifyUsers({
          recipientUserIds: [userId],
          type: NotificationType.SYSTEM_MESSAGE,
          title: 'New schedule allocation',
          message: `You have been allocated to "${params.jobName}"${timeSuffix}.`,
          module: NotificationModule.SCHEDULING,
          recordType: 'ScheduledJob',
          recordId: params.scheduledJobId,
          metadata: {
            serviceUserId: params.serviceUserId,
            employeeId: params.employeeId,
            scheduledStartDateTime: params.scheduledStartDateTime?.toISOString() ?? null,
            scheduledEndDateTime: params.scheduledEndDateTime?.toISOString() ?? null,
          },
        });
      }
    } catch (err) {
      this.logger.warn(`Allocation notify employee failed: ${(err as Error).message}`);
    }
  }

  /** Visit label for office alerts, e.g. `"Morning — Harry" on 28/09/2026 at 07:00`. */
  private async visitLabel(jobName: string, start?: Date | null): Promise<string> {
    if (!start) return `"${jobName}"`;
    const display = await loadNotificationDisplay(this.prisma);
    return `"${jobName}" on ${formatNotificationDateTime(start, display)}`;
  }

  private async employeeName(employeeId: string): Promise<string> {
    const pd = await this.prisma.employeePersonalDetail.findFirst({
      where: { employeeId },
      select: { firstName: true, lastName: true },
    });
    return pd ? `${pd.firstName} ${pd.lastName}`.trim() : 'A carer';
  }

  /** Title with the client preferred name when known, e.g. `Allocation needs confirmation — Harry`. */
  private async confirmationTitle(serviceUserId?: string): Promise<string> {
    if (!serviceUserId) return 'Allocation needs confirmation';
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId },
      select: { firstName: true, lastName: true, preferredName: true },
    });
    const name =
      su?.preferredName?.trim() ||
      [su?.firstName, su?.lastName].filter(Boolean).join(' ').trim();
    return name ? `Allocation needs confirmation — ${name}` : 'Allocation needs confirmation';
  }

  /**
   * Single office alert for an allocation that has warnings (Admin / Manager /
   * Staff Allocation). Carries carer, visit time and the warning list.
   */
  async notifyRequiresConfirmation(params: {
    scheduledJobId: string;
    jobName: string;
    employeeId: string;
    serviceUserId?: string;
    scheduledStartDateTime?: Date | null;
    warningMessages?: string[];
  }): Promise<void> {
    if (!this.notifications) return;
    try {
      const managers = await this.managerUserIds();
      if (!managers.length) return;
      await this.notifications.notifyUsers({
        recipientUserIds: managers,
        type: NotificationType.SCHEDULE_UNALLOCATED_VISIT,
        title: await this.confirmationTitle(params.serviceUserId),
        message: `${await this.employeeName(params.employeeId)} was allocated to ${await this.visitLabel(params.jobName, params.scheduledStartDateTime)} and needs manager confirmation.${
          params.warningMessages?.length ? ` Warnings: ${params.warningMessages.join('; ')}.` : ''
        }`,
        module: NotificationModule.SCHEDULING,
        severity: NotificationSeverity.WARNING,
        recordType: 'ScheduledJob',
        recordId: params.scheduledJobId,
        metadata: { employeeId: params.employeeId },
      });
    } catch (err) {
      this.logger.warn(`Allocation notify manager failed: ${(err as Error).message}`);
    }
  }
}
