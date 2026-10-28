import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  AllocationStatus,
  EmployeeHoursApprovalStatus,
  EmployeeHoursApprovalType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CarerHoursReductionService } from './carer-hours-reduction.service';
import {
  CarerWeeklyHoursService,
  carerOverMaxMessage,
  mondayOf,
  samePlanTime,
  type PendingPlanTimeChange,
} from './carer-weekly-hours.service';
import { resolveEndFromStartAndTimes } from '../service-user-visit-plans/visit-plan-amendment-impact.util';
import { visitPlanTodayUtc } from '../service-user-visit-plans/visit-plan-effective-dates.util';
import { slotLabel } from '../service-user-visit-plans/visit-plan-slot-defaults';

/** One thing a carer-hours request waits on (Hours approvals). */
type HoursRequestChange = {
  /** HELD_VISIT: a plan visit the carer is not on until approved; TIME_CHANGE: a plan visit's new time; EXTRA_EDIT: an extra visit's change. */
  kind: 'HELD_VISIT' | 'TIME_CHANGE' | 'EXTRA_EDIT';
  date?: string;
  slotLabel: string;
  startTime?: string;
  endTime?: string;
  fromStart?: string;
  fromEnd?: string;
  toStart?: string;
  toEnd?: string;
};
import { rotaApprovedAfterRejection } from './rota-approval-override.util';
import { JobAllocationsService } from '../job-allocations/job-allocations.service';
import { ScheduleLifecycleImpactService } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.service';
import type { AllocateJobDto } from '../job-allocations/dto/allocate-job.dto';
import type { ContractedHoursImpact } from './carer-hours-reduction.service';
import { EmployeeHoursApprovalNotificationHook } from './employee-hours-approval-notification.hook';
import { EXTRA_VISIT_CREATOR, type ExtraVisitCreator } from './extra-visit-creator';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { suHoursChangeNeedsApproval } from '../organisation-general-settings/service-user-weekly-hours-settings.util';
import { addDaysToOperationalIso } from '../common/utils/operational-day.util';
import { formatOrganisationIsoDate } from '../common/utils/organisation-display-format.util';
import { ScheduleLifecycleNotificationHook } from '../schedule-lifecycle-impact/schedule-lifecycle-notification.hook';
import {
  currentServiceUserWeeklyHours,
  sameWeeklyHours,
  syncServiceUserWeeklyHours,
} from '../service-user-dom-care/service-user-weekly-hours-sync.util';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Hard weekly cap — extra hours pushing a carer above this can never be approved. */

/** 1550 → "25h 50m" (same as the plan page). */
function formatHoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

@Injectable()
export class EmployeeHoursApprovalsService {
  private readonly logger = new Logger(EmployeeHoursApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly hoursReduction: CarerHoursReductionService,
    private readonly notificationHook: EmployeeHoursApprovalNotificationHook,
    private readonly scheduleNotifications: ScheduleLifecycleNotificationHook,
    private readonly moduleRef: ModuleRef,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly carerHours: CarerWeeklyHoursService,
    private readonly jobAllocations: JobAllocationsService,
    private readonly scheduleImpact: ScheduleLifecycleImpactService,
  ) {}

  // ── Contracted weekly hours change requests ─────────────────────────────

  /** What approving this contracted-hours value would change now (nothing is written). */
  async previewContractedHoursChange(employeeId: string, contractedWeeklyHours: number) {
    await this.requireEmployee(employeeId);
    const { allocationIds: _allocationIds, ...impact } = await this.hoursReduction.preview(
      employeeId,
      contractedWeeklyHours,
    );
    return { message: 'Contracted hours change preview', data: impact };
  }

  /** The carer's open contracted-hours request, if any (drives the "pending approval" tag). */
  async pendingContractedHoursChange(employeeId: string) {
    const row = await this.prisma.employeeHoursApproval.findFirst({
      where: {
        employeeId,
        requestType: EmployeeHoursApprovalType.CONTRACTED_HOURS_CHANGE,
        status: EmployeeHoursApprovalStatus.PENDING,
      },
      orderBy: { requestedAt: 'desc' },
    });
    // Wrapped so a "none" answer is not replaced by the response interceptor.
    return {
      message: 'Pending contracted hours change',
      data: {
        pending: row
          ? {
              id: row.id,
              previousContractedWeeklyHours: row.previousContractedWeeklyHours,
              requestedContractedWeeklyHours: row.requestedContractedWeeklyHours,
              reason: row.reason,
              requestedAt: row.requestedAt.toISOString(),
              impactSummary: row.impactSummary,
            }
          : null,
      },
    };
  }

  /** Send a contracted-hours change for manager review. Nothing changes until it is approved. */
  async requestContractedHoursChange(
    userId: string,
    employeeId: string,
    contractedWeeklyHours: number,
    reason?: string,
    meta?: RequestAuditMeta,
  ) {
    await this.requireEmployee(employeeId);
    const employment = await this.prisma.employeeEmployment.findUnique({
      where: { employeeId },
      select: { contractedWeeklyHours: true },
    });
    const previous = employment?.contractedWeeklyHours ?? null;
    if (previous != null && Math.abs(previous - contractedWeeklyHours) <= 0.001) {
      throw new BadRequestException('The new contracted hours are the same as the current hours.');
    }
    const open = await this.prisma.employeeHoursApproval.findFirst({
      where: {
        employeeId,
        requestType: EmployeeHoursApprovalType.CONTRACTED_HOURS_CHANGE,
        status: EmployeeHoursApprovalStatus.PENDING,
      },
      select: { id: true },
    });
    if (open) {
      throw new ConflictException(
        'A contracted hours change is already waiting for approval. Cancel it before sending another.',
      );
    }
    const { allocationIds: _allocationIds, ...impact } = await this.hoursReduction.preview(
      employeeId,
      contractedWeeklyHours,
    );
    const created = await this.prisma.employeeHoursApproval.create({
      data: {
        employeeId,
        requestType: EmployeeHoursApprovalType.CONTRACTED_HOURS_CHANGE,
        status: EmployeeHoursApprovalStatus.PENDING,
        previousContractedWeeklyHours: previous,
        requestedContractedWeeklyHours: contractedWeeklyHours,
        contractedWeeklyHours: previous,
        extraHours: previous != null ? round1(contractedWeeklyHours - previous) : null,
        impactSummary: impact as unknown as Prisma.InputJsonValue,
        reason: reason?.trim() || null,
        requestedById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.EMPLOYEE,
      action: AuditAction.EMPLOYEE_CONTRACTED_HOURS_CHANGE_REQUESTED,
      recordType: 'EmployeeHoursApproval',
      recordId: created.id,
      newValues: {
        employeeId,
        previousContractedWeeklyHours: previous,
        requestedContractedWeeklyHours: contractedWeeklyHours,
      },
      ...meta,
    });
    void this.notificationHook.notifyContractedChangeRequested({
      approvalId: created.id,
      employeeId,
      previousContractedWeeklyHours: previous,
      requestedContractedWeeklyHours: contractedWeeklyHours,
      rotaVisitsToUnassign: impact.rotaVisitsToUnassign,
      requestedById: userId,
    });
    return { message: 'Sent for manager approval', data: { id: created.id } };
  }

  /** Withdraw a pending request (contracted hours change or over-hours). */
  async cancel(userId: string, id: string, notes?: string, meta?: RequestAuditMeta) {
    const row = await this.requireApproval(id);
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('Only a pending request can be cancelled.');
    }
    await this.prisma.employeeHoursApproval.update({
      where: { id },
      data: {
        status: EmployeeHoursApprovalStatus.CANCELLED,
        decidedById: userId,
        decidedAt: new Date(),
        decisionNotes: notes?.trim() || null,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.EMPLOYEE,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: id,
      newValues: { status: 'CANCELLED', employeeId: row.employeeId },
      ...meta,
    });
    return { message: 'Request cancelled', data: { id } };
  }

  /** Delete every request with this status (the list's current tab). */
  async deleteAll(userId: string, status: EmployeeHoursApprovalStatus, meta?: RequestAuditMeta) {
    if (!Object.values(EmployeeHoursApprovalStatus).includes(status)) {
      throw new BadRequestException('A valid status is required.');
    }
    const { count } = await this.prisma.employeeHoursApproval.deleteMany({ where: { status } });
    await this.audit.logAudit({
      userId,
      module: AuditModule.EMPLOYEE,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: status,
      newValues: { deleted: count, status },
      ...meta,
    });
    return { message: `${count} request${count === 1 ? '' : 's'} deleted`, data: { count } };
  }

  private async approveContractedHoursChange(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    const requested = row.requestedContractedWeeklyHours;
    if (requested == null) throw new BadRequestException('The request has no contracted hours.');
    const employeeId = row.employeeId;
    if (!employeeId) throw new BadRequestException('The request has no carer.');

    let applied: ContractedHoursImpact | null = null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.employeeEmployment.findUnique({ where: { employeeId } });
      // Unassign against the hours as they are now (before the change is written).
      applied = await this.hoursReduction.apply(tx, userId, employeeId, requested, meta);
      await tx.employeeEmployment.upsert({
        where: { employeeId },
        update: { contractedWeeklyHours: requested, updatedById: userId },
        create: { employeeId, contractedWeeklyHours: requested, createdById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYMENT_DETAILS_UPDATED,
        recordType: 'EmployeeEmployment',
        recordId: before?.id ?? employeeId,
        oldValues: { contractedWeeklyHours: before?.contractedWeeklyHours ?? null },
        newValues: { contractedWeeklyHours: requested },
        metadata: { employeeId, hoursApprovalId: row.id },
        ...meta,
      });
      return tx.employeeHoursApproval.update({
        where: { id: row.id },
        data: {
          status: EmployeeHoursApprovalStatus.APPROVED,
          decidedById: userId,
          decidedAt: new Date(),
          decisionNotes: notes?.trim() || null,
          impactSummary: { requested: row.impactSummary, applied } as unknown as Prisma.InputJsonValue,
        },
      });
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.EMPLOYEE,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: { status: 'APPROVED', employeeId: row.employeeId },
      ...meta,
    });
    const result = applied as ContractedHoursImpact | null;
    // The rota unassign ran inside the transaction, which skips its own coordinator notice.
    if (result?.rotaVisitsToUnassign) {
      void this.scheduleNotifications.notifyBulkScheduleImpact({
        source: 'employee_hours_reduced',
        reason: 'Contracted weekly hours reduced',
        jobsCancelled: 0,
        jobsUnallocated: result.rotaVisitsToUnassign,
        employeeId,
        actorUserId: userId,
      });
    }
    // Over-hours requests on the plans the carer was taken off may no longer apply.
    for (const change of result?.planChanges ?? []) {
      await this.reconcileForPlan(userId, change.serviceUserId, change.visitPlanId);
    }
    return { message: 'Contracted hours change approved', data: { ...updated, applied: result } };
  }

  // ── Extra visits over a service user's weekly hours ─────────────────────

  /** "11/11/2026 14:00–16:00" in the organisation's date format. */
  private async extraVisitLabel(row: Prisma.EmployeeHoursApprovalGetPayload<object>): Promise<string> {
    const p = (row.requestPayload ?? {}) as { date?: string; startTime?: string; endTime?: string };
    const { dateDisplayFormat } = await this.orgSettings.getOperationalDisplaySettings();
    const date = formatOrganisationIsoDate(p.date ?? '', dateDisplayFormat);
    return `${date} ${p.startTime ?? ''}–${p.endTime ?? ''}`.trim();
  }

  /**
   * Approve: the extra visit is created now. By default there is no second hours check (the
   * manager allowed it); Settings → Dom Rules can refuse it when the week grew since the request.
   */
  private async approveExtraVisitOverHours(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    const payload = row.requestPayload as Record<string, unknown> | null;
    if (!payload || !row.serviceUserId || !row.visitPlanId) {
      throw new BadRequestException('The request has no extra visit details.');
    }
    const creator = this.moduleRef.get<ExtraVisitCreator>(EXTRA_VISIT_CREATOR, { strict: false });
    const rules = await this.orgSettings.getServiceUserWeeklyHoursSettings();
    const askedMinutes = Number(payload.weekMinutes);
    if (rules.extraApproveRecheck && Number.isFinite(askedMinutes)) {
      const now = await creator.currentExtraVisitWeekHours(row.serviceUserId, row.visitPlanId, payload);
      if (now.weekMinutes > askedMinutes) {
        throw new BadRequestException(
          `That week has more visits than when this was asked for: it would now have ${formatHoursMinutes(
            now.weekMinutes,
          )} (it was ${formatHoursMinutes(askedMinutes)}). Reject it and ask for the visit again.`,
        );
      }
    }
    const { exceptionId } = await creator.createApprovedExtraVisit(
      userId,
      row.serviceUserId,
      row.visitPlanId,
      payload,
      meta,
    );
    const updated = await this.prisma.employeeHoursApproval.update({
      where: { id: row.id },
      data: {
        status: EmployeeHoursApprovalStatus.APPROVED,
        decidedById: userId,
        decidedAt: new Date(),
        decisionNotes: notes?.trim() || null,
        requestPayload: { ...payload, createdExceptionId: exceptionId } as Prisma.InputJsonValue,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: { status: 'APPROVED', serviceUserId: row.serviceUserId, createdExceptionId: exceptionId },
      ...meta,
    });
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: true,
      title: 'Extra visit approved',
      message: `Your extra visit on ${await this.extraVisitLabel(row)} was approved and added to the rota.`,
      href: `/service-users/${row.serviceUserId}/visit-plan`,
    });
    return { message: 'Extra visit approved and added to the rota', data: updated };
  }

  /** Reject: nothing is created. A reason is required by default (Settings → Dom Rules) so the requester knows why. */
  private async rejectExtraVisitOverHours(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    const reason = notes?.trim() || null;
    const rules = await this.orgSettings.getServiceUserWeeklyHoursSettings();
    if (!reason && rules.extraRejectReasonRequired) {
      throw new BadRequestException('Give a reason for rejecting the extra visit.');
    }
    await this.prisma.employeeHoursApproval.update({
      where: { id: row.id },
      data: {
        status: EmployeeHoursApprovalStatus.REJECTED,
        decidedById: userId,
        decidedAt: new Date(),
        decisionNotes: reason,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: { status: 'REJECTED', serviceUserId: row.serviceUserId, reason },
      ...meta,
    });
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: false,
      title: 'Extra visit rejected',
      message: `Your extra visit on ${await this.extraVisitLabel(row)} was rejected${reason ? `: ${reason}` : '.'}`,
      href: row.serviceUserId ? `/service-users/${row.serviceUserId}/visit-plan` : undefined,
    });
    return { message: 'Extra visit rejected — it was not added', data: { id: row.id } };
  }

  // ── Service user weekly contracted hours change requests ────────────────

  /** The service user's open weekly-hours request, if any (locks the field on both screens). */
  async pendingServiceUserHoursChange(serviceUserId: string) {
    const row = await this.prisma.employeeHoursApproval.findFirst({
      where: {
        serviceUserId,
        requestType: EmployeeHoursApprovalType.SERVICE_USER_WEEKLY_HOURS_CHANGE,
        status: EmployeeHoursApprovalStatus.PENDING,
      },
      orderBy: { requestedAt: 'desc' },
    });
    const rules = await this.orgSettings.getServiceUserWeeklyHoursSettings();
    return {
      message: 'Pending weekly hours change',
      data: {
        /** Settings → Dom Rules: which changes need a manager (the screens ask before saving). */
        changeApproval: rules.changeApproval,
        pending: row
          ? {
              id: row.id,
              previousWeeklyHours: row.previousContractedWeeklyHours,
              requestedWeeklyHours: row.requestedContractedWeeklyHours,
              reason: row.reason,
              requestedAt: row.requestedAt.toISOString(),
            }
          : null,
      },
    };
  }

  /** Send a service user's weekly hours change for manager review. Nothing changes until approved. */
  async requestServiceUserHoursChange(
    userId: string,
    serviceUserId: string,
    weeklyHours: number,
    reason?: string,
    meta?: RequestAuditMeta,
  ) {
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { id: true },
    });
    if (!su) throw new NotFoundException('Service user not found');
    const current = await currentServiceUserWeeklyHours(this.prisma, serviceUserId);
    if (sameWeeklyHours(current, String(weeklyHours))) {
      throw new BadRequestException('The new weekly hours are the same as the current hours.');
    }
    const open = await this.prisma.employeeHoursApproval.findFirst({
      where: {
        serviceUserId,
        requestType: EmployeeHoursApprovalType.SERVICE_USER_WEEKLY_HOURS_CHANGE,
        status: EmployeeHoursApprovalStatus.PENDING,
      },
      select: { id: true },
    });
    if (open) {
      throw new ConflictException('A weekly hours change is already waiting for approval.');
    }
    const parsed = current != null ? Number.parseFloat(current) : NaN;
    const previous = Number.isFinite(parsed) ? parsed : null;
    const rules = await this.orgSettings.getServiceUserWeeklyHoursSettings();
    if (!suHoursChangeNeedsApproval(rules.changeApproval, previous, weeklyHours)) {
      // Settings → Dom Rules: this change does not need a manager, so it applies now.
      await this.prisma.$transaction((tx) =>
        syncServiceUserWeeklyHours(tx, this.audit, {
          serviceUserId,
          value: String(weeklyHours),
          userId,
          source: 'direct',
          meta,
        }),
      );
      const after = await this.afterServiceUserHoursChanged(userId, serviceUserId, previous, weeklyHours, meta);
      return {
        message: ['Weekly hours changed', after.message].filter(Boolean).join('. '),
        data: { id: null, applied: true, cancelledVisits: after.cancelled },
      };
    }
    const created = await this.prisma.employeeHoursApproval.create({
      data: {
        serviceUserId,
        requestType: EmployeeHoursApprovalType.SERVICE_USER_WEEKLY_HOURS_CHANGE,
        status: EmployeeHoursApprovalStatus.PENDING,
        previousContractedWeeklyHours: previous,
        requestedContractedWeeklyHours: weeklyHours,
        extraHours: previous != null ? round1(weeklyHours - previous) : null,
        reason: reason?.trim() || null,
        requestedById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_WEEKLY_HOURS_CHANGE_REQUESTED,
      recordType: 'EmployeeHoursApproval',
      recordId: created.id,
      newValues: { serviceUserId, previousWeeklyHours: current, requestedWeeklyHours: weeklyHours },
      ...meta,
    });
    void this.notificationHook.notifyServiceUserHoursChangeRequested({
      approvalId: created.id,
      serviceUserId,
      previousWeeklyHours: previous,
      requestedWeeklyHours: weeklyHours,
      requestedById: userId,
    });
    return { message: 'Sent for manager approval', data: { id: created.id, applied: false } };
  }

  /** Approve: the new hours go to DOM Care and every open visit plan. Visits are not changed. */
  private async approveServiceUserHoursChange(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    const requested = row.requestedContractedWeeklyHours;
    const serviceUserId = row.serviceUserId;
    if (requested == null || !serviceUserId) {
      throw new BadRequestException('The request has no service user or hours.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await syncServiceUserWeeklyHours(tx, this.audit, {
        serviceUserId,
        value: String(requested),
        userId,
        source: 'approval',
        meta,
      });
      return tx.employeeHoursApproval.update({
        where: { id: row.id },
        data: {
          status: EmployeeHoursApprovalStatus.APPROVED,
          decidedById: userId,
          decidedAt: new Date(),
          decisionNotes: notes?.trim() || null,
        },
      });
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: { status: 'APPROVED', serviceUserId },
      ...meta,
    });
    const after = await this.afterServiceUserHoursChanged(
      userId,
      serviceUserId,
      row.previousContractedWeeklyHours,
      requested,
      meta,
    );
    return {
      message: ['Weekly hours change approved', after.message].filter(Boolean).join('. '),
      data: { ...updated, cancelledVisits: after.cancelled },
    };
  }

  /**
   * After lower weekly hours are saved: Settings → Dom Rules either keeps the visits (the plan
   * shows the weeks over as a warning) or cancels the latest visits in each week over.
   */
  private async afterServiceUserHoursChanged(
    userId: string,
    serviceUserId: string,
    previous: number | null,
    next: number,
    meta?: RequestAuditMeta,
  ): Promise<{ cancelled: number; message: string | null }> {
    if (previous == null || next >= previous) return { cancelled: 0, message: null };
    const rules = await this.orgSettings.getServiceUserWeeklyHoursSettings();
    if (rules.decreaseAction !== 'CANCEL_LATEST') return { cancelled: 0, message: null };
    const creator = this.moduleRef.get<ExtraVisitCreator>(EXTRA_VISIT_CREATOR, { strict: false });
    try {
      const { cancelled } = await creator.applyHoursDecrease(userId, serviceUserId, next, meta);
      return {
        cancelled,
        message: cancelled
          ? `${cancelled} visit${cancelled === 1 ? '' : 's'} over the new hours cancelled`
          : null,
      };
    } catch (err) {
      // The hours are already saved; say why the visits stayed so the office can cancel them by hand.
      this.logger.warn(`Hours decrease cancel failed for ${serviceUserId}: ${(err as Error).message}`);
      return {
        cancelled: 0,
        message: `Visits over the new hours could not be cancelled (${(err as Error).message}) — cancel them on the visit plan`,
      };
    }
  }

  /** What lowering a service user's weekly hours would do to their visits (nothing is saved). */
  async serviceUserHoursImpact(serviceUserId: string, weeklyHours: number) {
    const rules = await this.orgSettings.getServiceUserWeeklyHoursSettings();
    const creator = this.moduleRef.get<ExtraVisitCreator>(EXTRA_VISIT_CREATOR, { strict: false });
    const plan = await creator.planHoursDecrease(serviceUserId, weeklyHours);
    return {
      message: 'Weekly hours change impact',
      data: {
        decreaseAction: rules.decreaseAction,
        limitMinutes: plan.limitMinutes,
        overWeeks: plan.overWeeks,
        visitsToCancel:
          rules.decreaseAction === 'CANCEL_LATEST'
            ? plan.toCancel.map((v) => ({
                date: v.date,
                slotLabel: v.slotLabel,
                startDateTime: v.startDateTime,
                endDateTime: v.endDateTime,
                onRota: v.status === 'ON_ROTA',
              }))
            : [],
        stillOverWeeks: rules.decreaseAction === 'CANCEL_LATEST' ? plan.stillOverWeeks : plan.overWeeks,
      },
    };
  }

  private async requireEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
  }

  /**
   * After a plan's carers change (inside the save, before the rota is synced): for each carer
   * whose weeks go over their contracted weekly hours (+ grace) because of this plan, keep one
   * PENDING request listing the plan visits held back until a manager approves. Newly added
   * visits are held back first (latest first) — visits the carer already has stay. An approval
   * covers the same or a lighter busiest week. Returns the held-back visits as
   * "employeeId|slotId|YYYY-MM-DD"; the rota sync and generation leave the carer off them.
   */
  async reconcileForPlan(
    userId: string,
    serviceUserId: string,
    planId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
    options: {
      /**
       * Plan save: this plan's visits each carer had before the save ("slotId|YYYY-MM-DD",
       * from `planVisitsByCarer`). Visits not in it are new, and new visits in a week already
       * over the hours wait for a manager too. Left out (rolling rota, generate): only visits
       * from the one that crosses the limit on.
       */
      previousVisits?: Map<string, Set<string>>;
      /**
       * Plan save: visits this save made longer (the plan already has the new time). A carer
       * it takes over their hours keeps the old time until a manager approves the new one.
       */
      timeChanges?: PendingPlanTimeChange[];
      /** Filled with the slots whose new time now waits for a manager. */
      heldTimeSlotIds?: Set<string>;
    } = {},
  ): Promise<Set<string>> {
    const withheld = new Set<string>();
    const assignments = await client.visitPlanSlotCarerAssignment.findMany({
      where: { visitPlanSlot: { visitPlanId: planId, isActive: true } },
      select: { employeeId: true, visitPlanSlotId: true },
    });
    const employeeIds = [...new Set(assignments.map((a) => a.employeeId))];
    const slotsOf = (employeeId: string) =>
      new Set(assignments.filter((a) => a.employeeId === employeeId).map((a) => a.visitPlanSlotId));
    const savedTimes = new Map((options.timeChanges ?? []).map((c) => [c.slotId, c]));
    // New times already waiting stay waiting while the plan still has the old time.
    const slotTimesNow = new Map(
      (
        await client.visitPlanSlot.findMany({
          where: { visitPlanId: planId, isActive: true },
          select: { id: true, plannedStartTime: true, plannedEndTime: true },
        })
      ).map((s) => [s.id, s]),
    );
    const stillWaiting = (c: PendingPlanTimeChange) => {
      const slot = slotTimesNow.get(c.slotId);
      return Boolean(slot && samePlanTime(slot.plannedStartTime, c.fromStart) && samePlanTime(slot.plannedEndTime, c.fromEnd));
    };
    const all = await client.employeeHoursApproval.findMany({
      where: {
        visitPlanId: planId,
        requestType: EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS,
        status: {
          in: [
            EmployeeHoursApprovalStatus.PENDING,
            EmployeeHoursApprovalStatus.APPROVED,
            EmployeeHoursApprovalStatus.REJECTED,
          ],
        },
      },
      orderBy: { requestedAt: 'desc' },
    });
    const existing = all.filter((r) => r.status !== EmployeeHoursApprovalStatus.REJECTED);
    // Visits a manager rejected stay off the carer, so they don't count for them.
    const rejectedKeys = (employeeId: string) =>
      new Set(
        all
          .filter((r) => r.status === EmployeeHoursApprovalStatus.REJECTED && r.employeeId === employeeId)
          .flatMap((r) => (r.requestPayload as { withheld?: string[] } | null)?.withheld ?? []),
      );
    // New visit times no carer needs approval for any more: put on the plan and the rota.
    const releasedTimes = new Map<string, PendingPlanTimeChange>();
    const heldTimesBy = new Map<string, Set<string>>();
    // Carers no longer on the plan: their open requests no longer apply.
    const gone = existing.filter(
      (r) => r.status === EmployeeHoursApprovalStatus.PENDING && !employeeIds.includes(r.employeeId ?? ''),
    );
    if (gone.length) {
      await client.employeeHoursApproval.updateMany({
        where: { id: { in: gone.map((r) => r.id) } },
        data: { status: EmployeeHoursApprovalStatus.CANCELLED, decidedAt: new Date(), decisionNotes: 'Carer no longer on the plan' },
      });
    }
    if (!employeeIds.length) return withheld;

    const created: Array<{ id: string; employeeId: string; projected: number; contracted: number; extra: number }> = [];
    for (const employeeId of employeeIds) {
      const skip = rejectedKeys(employeeId);
      const count = await this.carerHours.count(client, employeeId, {
        planOverride: planId,
        skipPlanVisits: skip,
      });
      const rows = existing.filter((r) => r.employeeId === employeeId);
      const pending = rows.find((r) => r.status === EmployeeHoursApprovalStatus.PENDING);
      const heaviestOf = (r: (typeof rows)[number]) =>
        Number(
          (r.requestPayload as { heaviestMinutes?: number } | null)?.heaviestMinutes ??
            Math.round((r.projectedWeeklyHours ?? 0) * 60),
        );
      const approved = rows.find(
        (r) => r.status === EmployeeHoursApprovalStatus.APPROVED && heaviestOf(r) >= count.heaviestMinutes,
      );

      // Which of this plan's visits push each over week past the limit.
      const held: string[] = [];
      // New visit times of this carer's visits: from this save, or already waiting.
      const carerSlots = slotsOf(employeeId);
      const timeOptions = new Map<string, PendingPlanTimeChange>();
      for (const c of (pending?.requestPayload as { pendingTimes?: PendingPlanTimeChange[] } | null)?.pendingTimes ?? []) {
        if (carerSlots.has(c.slotId) && stillWaiting(c)) timeOptions.set(c.slotId, c);
      }
      for (const c of savedTimes.values()) if (carerSlots.has(c.slotId)) timeOptions.set(c.slotId, c);
      const heldTimes = new Map<string, PendingPlanTimeChange>();
      if (count.limitMinutes != null && !approved) {
        const allocated = new Set(
          (
            await client.jobAllocation.findMany({
              where: {
                employeeId,
                deletedAt: null,
                isActive: true,
                status: { in: ['PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED'] },
                scheduledJob: { deletedAt: null, metadata: { path: ['visitPlanId'], equals: planId } },
              },
              select: { scheduledJob: { select: { metadata: true } } },
            })
          ).map((a) => {
            const m = a.scheduledJob.metadata as { visitPlanSlotId?: string; date?: string } | null;
            return `${m?.visitPlanSlotId}|${m?.date?.slice(0, 10)}`;
          }),
        );
        // Hours a manager already approved for this carer on this plan stay approved: only what
        // goes above them waits for a manager again.
        const approvedMinutes = Math.max(
          0,
          ...rows.filter((r) => r.status === EmployeeHoursApprovalStatus.APPROVED).map(heaviestOf),
        );
        const threshold = Math.max(count.limitMinutes + count.graceMinutes, approvedMinutes);
        const before = options.previousVisits?.get(employeeId);
        // Visits this request already holds back stay held while it waits.
        const heldBefore = new Set(
          (pending?.requestPayload as { withheld?: string[] } | null)?.withheld ?? [],
        );
        for (const week of count.overWeeks) {
          let excess = week.minutes - threshold;
          // A longer visit waits for the manager at its old time first: its extra minutes are
          // what the approval is for, so no visit is held back for them.
          for (const v of week.visits) {
            const c = v.visitPlanId === planId && v.visitPlanSlotId ? timeOptions.get(v.visitPlanSlotId) : undefined;
            if (!c || excess <= 0) continue;
            heldTimes.set(c.slotId, c);
            excess -= Math.max(0, c.toMinutes - c.fromMinutes);
          }
          // This plan's visits from the one that crosses the limit on: a week taken over by
          // another visit (e.g. an extra a manager approved) does not hold back earlier plan
          // visits — unless a plan save adds them to that week, or they are already held.
          const over = new Set(week.overVisits.map((v) => `${v.visitPlanSlotId}|${v.date}`));
          const candidates = week.visits
            .filter((v) => {
              if (v.visitPlanId !== planId || !v.visitPlanSlotId) return false;
              const key = `${v.visitPlanSlotId}|${v.date}`;
              if (allocated.has(key)) return false;
              return (
                over.has(key) ||
                heldBefore.has(key) ||
                (options.previousVisits != null && !before?.has(key))
              );
            })
            // Held first: visits this save adds, then visits already held, then the rest — each
            // latest first — so a new visit waits for the manager instead of an existing one.
            .sort((a, b) => {
              const rank = (v: (typeof candidates)[number]) => {
                const key = `${v.visitPlanSlotId}|${v.date}`;
                if (options.previousVisits != null && !before?.has(key)) return 0;
                return heldBefore.has(key) ? 1 : 2;
              };
              return rank(a) - rank(b) || b.start.getTime() - a.start.getTime();
            });
          for (const v of candidates) {
            if (excess <= 0) break;
            held.push(`${v.visitPlanSlotId}|${v.date}`);
            excess -= v.minutes;
          }
        }
        // Plan save: new visits that take a week above the most a manager can approve are
        // refused outright (a request for them could never be approved).
        if (options.previousVisits != null) {
          const maxMinutes = Math.round((await this.carerHours.rule()).maxApprovableHours * 60);
          const newDays = new Set(
            held.filter((k) => !heldBefore.has(k) && !before?.has(k)).map((k) => k.split('|')[1]),
          );
          const longer = [...heldTimes.keys()].filter((slotId) => savedTimes.has(slotId));
          const tooMuch = count.weeks.find(
            (w) =>
              w.minutes > maxMinutes &&
              ([...newDays].some((d) => d >= w.weekStart && d <= addDaysToOperationalIso(w.weekStart, 6)) ||
                w.visits.some((v) => v.visitPlanSlotId != null && longer.includes(v.visitPlanSlotId))),
          );
          if (tooMuch) {
            const person = await client.employeePersonalDetail.findFirst({
              where: { employeeId, deletedAt: null },
              select: { firstName: true, lastName: true },
            });
            const name = `${person?.firstName ?? ''} ${person?.lastName ?? ''}`.trim() || 'A carer';
            const display = await this.orgSettings.getOperationalDisplaySettings();
            throw new BadRequestException(
              `${name}: ${carerOverMaxMessage(tooMuch.minutes, maxMinutes)} in the week of ${formatOrganisationIsoDate(tooMuch.weekStart, display.dateDisplayFormat)}. Choose another carer or change the visits.`,
            );
          }
        }
      }

      // This plan's visits are among those over the hours: a manager hears about it even when
      // there is nothing to hold back (e.g. visits the carer already has got longer).
      const planInOver =
        !approved &&
        count.overWeeks.some((w) => w.overVisits.some((v) => v.visitPlanId === planId));
      heldTimesBy.set(employeeId, new Set(heldTimes.keys()));
      for (const [slotId, c] of timeOptions) if (!heldTimes.has(slotId)) releasedTimes.set(slotId, c);
      if (!held.length && !planInOver && !heldTimes.size) {
        if (pending) {
          await client.employeeHoursApproval.update({
            where: { id: pending.id },
            data: { status: EmployeeHoursApprovalStatus.CANCELLED, decidedAt: new Date(), decisionNotes: 'No longer over the weekly hours' },
          });
        }
        continue;
      }
      for (const key of held) withheld.add(`${employeeId}|${key}`);
      if (count.limitMinutes == null) continue;
      const contracted = round1(count.limitMinutes / 60);
      const projected = round1(count.heaviestMinutes / 60);
      const data = {
        contractedWeeklyHours: contracted,
        projectedWeeklyHours: projected,
        extraHours: round1(projected - contracted),
        requestPayload: {
          kind: 'PLAN',
          heaviestMinutes: count.heaviestMinutes,
          graceMinutes: count.graceMinutes,
          withheld: held,
          pendingTimes: [...heldTimes.values()],
          overWeeks: count.overWeeks.map((w) => ({ weekStart: w.weekStart, minutes: w.minutes })),
        } as Prisma.InputJsonValue,
      };
      if (pending) {
        await client.employeeHoursApproval.update({ where: { id: pending.id }, data });
      } else {
        const row = await client.employeeHoursApproval.create({
          data: {
            ...data,
            requestType: EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS,
            employeeId,
            serviceUserId,
            visitPlanId: planId,
            status: EmployeeHoursApprovalStatus.PENDING,
            requestedById: userId,
          },
        });
        created.push({ id: row.id, employeeId, projected, contracted, extra: data.extraHours });
      }
    }
    const heldTimeSlots = new Set([...heldTimesBy.values()].flatMap((set) => [...set]));
    for (const slotId of heldTimeSlots) options.heldTimeSlotIds?.add(slotId);
    // A new time this save made needs nothing more (the plan already has it); one that was
    // waiting goes on the plan and the rota now no carer needs approval for it.
    const release = [...releasedTimes.values()].filter(
      (c) => !heldTimeSlots.has(c.slotId) && !savedTimes.has(c.slotId) && stillWaiting(c),
    );
    if (release.length) {
      await this.applyPlanTimeChanges(client, userId, serviceUserId, planId, release, 'no longer over the weekly hours');
    }
    // Managers always hear about a new request (sent once the save is done).
    if (created.length) {
      setImmediate(() => {
        for (const c of created) {
          void this.notificationHook.notifyPendingCreated({
            approvalId: c.id,
            employeeId: c.employeeId,
            serviceUserId,
            visitPlanId: planId,
            extraHours: c.extra,
            projectedWeeklyHours: c.projected,
            contractedWeeklyHours: c.contracted,
            requestedById: userId,
          });
        }
      });
    }
    return withheld;
  }

  /**
   * What each carer-hours request waits on, in plain terms for Hours approvals: plan visits held
   * back from the carer, plan visits' new times, and extra visit edits.
   */
  private async requestChanges(
    rows: Array<Prisma.EmployeeHoursApprovalGetPayload<object>>,
  ): Promise<Map<string, HoursRequestChange[]>> {
    const out = new Map<string, HoursRequestChange[]>();
    const slotIds = new Set<string>();
    for (const r of rows) {
      if (r.requestType !== EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS) continue;
      for (const key of (r.requestPayload as { withheld?: string[] } | null)?.withheld ?? []) {
        const slotId = key.split('|')[0];
        if (slotId) slotIds.add(slotId);
      }
    }
    const roundNames = new Map(
      slotIds.size
        ? (
            await this.prisma.medicationAdministrationRound.findMany({
              where: { deletedAt: null },
              select: { code: true, name: true },
            })
          ).map((r) => [r.code, r.name])
        : [],
    );
    const slots = new Map(
      (slotIds.size
        ? await this.prisma.visitPlanSlot.findMany({
            where: { id: { in: [...slotIds] } },
            select: { id: true, slotCode: true, medicationRoundCode: true, plannedStartTime: true, plannedEndTime: true },
          })
        : []
      ).map((s) => [s.id, s]),
    );
    for (const r of rows) {
      const list: HoursRequestChange[] = [];
      if (r.requestType === EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS) {
        const payload = (r.requestPayload ?? {}) as { withheld?: string[]; pendingTimes?: PendingPlanTimeChange[] };
        for (const c of payload.pendingTimes ?? []) {
          list.push({
            kind: 'TIME_CHANGE',
            slotLabel: c.slotLabel,
            fromStart: c.fromStart,
            fromEnd: c.fromEnd,
            toStart: c.toStart,
            toEnd: c.toEnd,
          });
        }
        for (const key of [...(payload.withheld ?? [])].sort((a, b) => a.split('|')[1].localeCompare(b.split('|')[1]))) {
          const [slotId, date] = key.split('|');
          const slot = slots.get(slotId);
          list.push({
            kind: 'HELD_VISIT',
            date,
            slotLabel: slot ? slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNames) : 'Visit',
            startTime: slot?.plannedStartTime.slice(0, 5),
            endTime: slot?.plannedEndTime.slice(0, 5),
          });
        }
      } else if (r.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS) {
        const edit = (r.requestPayload as {
          pendingEdit?: {
            date?: string;
            slotLabel?: string;
            before?: { startTime?: string; endTime?: string };
            after?: { startTime?: string; endTime?: string };
          };
        } | null)?.pendingEdit;
        if (edit) {
          list.push({
            kind: 'EXTRA_EDIT',
            date: edit.date,
            slotLabel: edit.slotLabel ?? 'Extra visit',
            fromStart: edit.before?.startTime?.slice(0, 5),
            fromEnd: edit.before?.endTime?.slice(0, 5),
            toStart: edit.after?.startTime?.slice(0, 5),
            toEnd: edit.after?.endTime?.slice(0, 5),
          });
        }
      }
      if (list.length) out.set(r.id, list);
    }
    return out;
  }

  /** Slots of a plan whose new time another carer's request (still waiting) holds. */
  private async pendingTimeSlotIds(visitPlanId: string, exceptId: string): Promise<Set<string>> {
    const rows = await this.prisma.employeeHoursApproval.findMany({
      where: {
        visitPlanId,
        id: { not: exceptId },
        requestType: EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS,
        status: EmployeeHoursApprovalStatus.PENDING,
      },
      select: { requestPayload: true },
    });
    return new Set(
      rows.flatMap((r) =>
        ((r.requestPayload as { pendingTimes?: PendingPlanTimeChange[] } | null)?.pendingTimes ?? []).map((c) => c.slotId),
      ),
    );
  }

  /** Take these slots' waiting new times off the plan's other open requests. */
  private async dropPendingTimes(visitPlanId: string, slotIds: string[]): Promise<void> {
    const rows = await this.prisma.employeeHoursApproval.findMany({
      where: {
        visitPlanId,
        requestType: EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS,
        status: EmployeeHoursApprovalStatus.PENDING,
      },
      select: { id: true, requestPayload: true },
    });
    for (const r of rows) {
      const payload = (r.requestPayload ?? {}) as { pendingTimes?: PendingPlanTimeChange[] } & Record<string, unknown>;
      const times = payload.pendingTimes ?? [];
      const kept = times.filter((c) => !slotIds.includes(c.slotId));
      if (kept.length === times.length) continue;
      await this.prisma.employeeHoursApproval.update({
        where: { id: r.id },
        data: { requestPayload: { ...payload, pendingTimes: kept } as Prisma.InputJsonValue },
      });
    }
  }

  /**
   * Put new visit times that waited for a manager on the plan and its upcoming rota visits
   * (a manager approved them, or the carer no longer goes over), with an amendment record.
   */
  async applyPlanTimeChanges(
    client: Prisma.TransactionClient | PrismaService,
    userId: string,
    serviceUserId: string,
    planId: string,
    changes: PendingPlanTimeChange[],
    why: string,
  ): Promise<void> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const run = async (tx: Prisma.TransactionClient) => {
      for (const c of changes) {
        const slot = await tx.visitPlanSlot.findFirst({
          where: { id: c.slotId, visitPlanId: planId, isActive: true },
        });
        // The plan changed since (another time saved): that one stands.
        if (!slot || !samePlanTime(slot.plannedStartTime, c.fromStart) || !samePlanTime(slot.plannedEndTime, c.fromEnd)) {
          continue;
        }
        await tx.visitPlanSlot.update({
          where: { id: slot.id },
          data: { plannedStartTime: c.toStart, plannedEndTime: c.toEnd, durationMinutes: c.toDurationMinutes ?? null },
        });
        const reason = `${c.slotLabel} visit time ${c.fromStart}–${c.fromEnd} → ${c.toStart}–${c.toEnd} (${why})`;
        await this.scheduleImpact.rescheduleSlotJobs(
          userId,
          {
            serviceUserId,
            visitPlanSlotId: slot.id,
            fromDate: visitPlanTodayUtc(new Date(), timeZone),
            resolveNewTimes: (jobStart) => resolveEndFromStartAndTimes(jobStart, c.toStart, c.toEnd, timeZone),
            reason,
            source: 'visit_plan_amendment',
          },
          undefined,
          tx,
        );
        const change = { type: 'VISIT_TIME_CHANGE', slotId: slot.id, slotCode: slot.slotCode };
        await tx.visitPlanAmendment.create({
          data: {
            visitPlanId: planId,
            reason: `Visit time change applied: ${reason}`,
            snapshotBefore: { timeChange: { ...change, startTime: c.fromStart, endTime: c.fromEnd } } as Prisma.InputJsonValue,
            snapshotAfter: { timeChange: { ...change, startTime: c.toStart, endTime: c.toEnd } } as Prisma.InputJsonValue,
            amendedById: userId,
          },
        });
      }
    };
    if ('$transaction' in client) await client.$transaction(run);
    else await run(client);
  }

  /** This plan's visits each of its carers has now ("slotId|YYYY-MM-DD"), taken before a save. */
  async planVisitsByCarer(
    planId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Map<string, Set<string>>> {
    const assignments = await client.visitPlanSlotCarerAssignment.findMany({
      where: { visitPlanSlot: { visitPlanId: planId, isActive: true } },
      select: { employeeId: true },
    });
    const employeeIds = [...new Set(assignments.map((a) => a.employeeId))];
    const counts = await this.carerHours.countMany(client, employeeIds, { planOverride: planId });
    const out = new Map<string, Set<string>>();
    for (const [employeeId, count] of counts) {
      out.set(
        employeeId,
        new Set(
          count.weeks
            .flatMap((w) => w.visits)
            .filter((v) => v.visitPlanId === planId && v.visitPlanSlotId)
            .map((v) => `${v.visitPlanSlotId}|${v.date}`),
        ),
      );
    }
    return out;
  }

  /**
   * Plan visits held back from carers by a request waiting for a manager or rejected:
   * "employeeId|slotId|YYYY-MM-DD".
   */
  async withheldVisitsForPlan(
    planId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Set<string>> {
    const rows = await client.employeeHoursApproval.findMany({
      where: {
        visitPlanId: planId,
        requestType: EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS,
        status: { in: [EmployeeHoursApprovalStatus.PENDING, EmployeeHoursApprovalStatus.REJECTED] },
      },
      select: { employeeId: true, status: true, decidedAt: true, requestPayload: true },
    });
    // A rejected visit a manager later approved on the rota stays with the carer.
    const approvedLater = await rotaApprovedAfterRejection(
      client,
      rows.filter((r) => r.status === EmployeeHoursApprovalStatus.REJECTED),
    );
    const out = new Set<string>();
    for (const r of rows) {
      const keys = (r.requestPayload as { withheld?: string[] } | null)?.withheld ?? [];
      for (const k of keys) {
        const key = `${r.employeeId}|${k}`;
        if (r.status === EmployeeHoursApprovalStatus.REJECTED && approvedLater.has(key)) continue;
        out.add(key);
      }
    }
    return out;
  }

  async list(status?: EmployeeHoursApprovalStatus) {
    const rows = await this.prisma.employeeHoursApproval.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
    });

    const employeeIds = [
      ...new Set(rows.map((r) => r.employeeId).filter((id): id is string => Boolean(id))),
    ];
    const serviceUserIds = [
      ...new Set(rows.map((r) => r.serviceUserId).filter((id): id is string => Boolean(id))),
    ];
    const [employees, serviceUsers] = await Promise.all([
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
          })
        : Promise.resolve([]),
      serviceUserIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: serviceUserIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : Promise.resolve([]),
    ]);
    const empName = new Map(
      employees.map((e) => [
        e.id,
        `${e.personalDetail?.firstName ?? ''} ${e.personalDetail?.lastName ?? ''}`.trim() || e.id,
      ]),
    );
    const suName = new Map(
      serviceUsers.map((s) => [s.id, `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || s.id]),
    );
    const [rules, carerRule, changesById] = await Promise.all([
      this.orgSettings.getServiceUserWeeklyHoursSettings(),
      this.carerHours.rule(),
      this.requestChanges(rows),
    ]);
    // Pending extra visits: that week as it is now (it may have changed since the request).
    const currentWeek = new Map<string, { weekMinutes: number; limitWeeklyHours: number | null }>();
    const pendingExtras = rows.filter(
      (r) =>
        r.requestType === EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS &&
        r.status === EmployeeHoursApprovalStatus.PENDING &&
        r.serviceUserId &&
        r.visitPlanId &&
        r.requestPayload,
    );
    if (pendingExtras.length) {
      const creator = this.moduleRef.get<ExtraVisitCreator>(EXTRA_VISIT_CREATOR, { strict: false });
      await Promise.all(
        pendingExtras.map(async (r) => {
          try {
            currentWeek.set(
              r.id,
              await creator.currentExtraVisitWeekHours(
                r.serviceUserId!,
                r.visitPlanId!,
                r.requestPayload as Record<string, unknown>,
              ),
            );
          } catch (err) {
            this.logger.warn(`Current week hours for request ${r.id} failed: ${(err as Error).message}`);
          }
        }),
      );
    }

    // Pending carer requests: the week as it is now, with every waiting request counted.
    const carerWeekNow = new Map<string, number>();
    await Promise.all(
      rows
        .filter(
          (r) =>
            r.status === EmployeeHoursApprovalStatus.PENDING &&
            (r.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS ||
              r.requestType === EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS),
        )
        .map(async (r) => {
          try {
            const minutes = await this.carerRequestWeekMinutesNow(r);
            if (minutes != null) carerWeekNow.set(r.id, minutes);
          } catch (err) {
            this.logger.warn(`Carer week hours for request ${r.id} failed: ${(err as Error).message}`);
          }
        }),
    );
    const projectedOf = (r: (typeof rows)[number]) => {
      const now = carerWeekNow.get(r.id);
      return now != null ? round1(now / 60) : r.projectedWeeklyHours;
    };

    return {
      message: 'Employee hours approvals',
      data: rows.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        employeeName: r.employeeId ? (empName.get(r.employeeId) ?? r.employeeId) : null,
        requestType: r.requestType,
        serviceUserId: r.serviceUserId,
        serviceUserName: r.serviceUserId ? (suName.get(r.serviceUserId) ?? r.serviceUserId) : null,
        visitPlanId: r.visitPlanId,
        status: r.status,
        previousContractedWeeklyHours: r.previousContractedWeeklyHours,
        requestedContractedWeeklyHours: r.requestedContractedWeeklyHours,
        impactSummary: r.impactSummary,
        requestPayload: r.requestPayload,
        /** Carer over their hours: what waits for the manager (visits held back, new times). */
        changes: changesById.get(r.id) ?? [],
        /** Pending extra visits only: that week now, with the visit added. */
        currentWeek: currentWeek.get(r.id) ?? null,
        /** Extra visits only: whether Reject needs a reason (Settings → Dom Rules). */
        rejectReasonRequired:
          r.requestType === EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS
            ? rules.extraRejectReasonRequired
            : r.requestType === EmployeeHoursApprovalType.DRAFT_PLAN_OVER_HOURS,
        reason: r.reason,
        contractedWeeklyHours: r.contractedWeeklyHours,
        /** Pending carer requests: that week now, every waiting request included. */
        projectedWeeklyHours: projectedOf(r),
        extraHours:
          carerWeekNow.has(r.id) && r.contractedWeeklyHours != null
            ? round1((projectedOf(r) ?? 0) - r.contractedWeeklyHours)
            : r.extraHours,
        requestedAt: r.requestedAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        decisionNotes: r.decisionNotes,
        /** Carer over weekly hours: Approve is refused above this (Settings → Dom Rules). */
        maxApprovableHours:
          r.requestType === EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS ||
          r.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS
            ? carerRule.maxApprovableHours
            : null,
        /** Carer over weekly hours on a plan: what Reject does (Settings → Dom Rules). */
        rejectAction:
          r.requestType === EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS ? carerRule.rejectAction : null,
      })),
    };
  }

  // ── Draft visit plan over the service user's weekly hours ────────────────

  /**
   * After a draft is saved with Settings → Dom Rules on manager approval: keep one request in
   * step with its busiest week over the hours. Not over any more → the open request is cancelled;
   * already approved at this level → nothing to do; otherwise a new request goes to managers.
   */
  async syncDraftPlanRequest(
    userId: string,
    params: {
      serviceUserId: string;
      planId: string;
      limitWeeklyHours: number | null;
      overWeeks: Array<{ weekStart: string; minutes: number }>;
      weekHoursLabel: string | null;
    },
    meta?: RequestAuditMeta,
  ): Promise<void> {
    const heaviest = params.overWeeks.reduce<{ weekStart: string; minutes: number } | null>(
      (best, w) => (!best || w.minutes > best.minutes ? w : best),
      null,
    );
    const open = await this.prisma.employeeHoursApproval.findMany({
      where: {
        visitPlanId: params.planId,
        requestType: EmployeeHoursApprovalType.DRAFT_PLAN_OVER_HOURS,
        status: { in: [EmployeeHoursApprovalStatus.PENDING, EmployeeHoursApprovalStatus.APPROVED] },
      },
      orderBy: { requestedAt: 'desc' },
    });
    const minutesOf = (r: (typeof open)[number]) =>
      Number((r.requestPayload as { heaviestMinutes?: number } | null)?.heaviestMinutes ?? 0);
    const cancelPending = async (except?: string) => {
      const ids = open
        .filter((r) => r.status === EmployeeHoursApprovalStatus.PENDING && r.id !== except)
        .map((r) => r.id);
      if (!ids.length) return;
      await this.prisma.employeeHoursApproval.updateMany({
        where: { id: { in: ids } },
        data: { status: EmployeeHoursApprovalStatus.CANCELLED, decidedAt: new Date(), decisionNotes: 'Plan changed' },
      });
    };
    if (!heaviest) {
      await cancelPending();
      return;
    }
    if (open.some((r) => r.status === EmployeeHoursApprovalStatus.APPROVED && minutesOf(r) >= heaviest.minutes)) {
      await cancelPending();
      return;
    }
    // Rejected at this same busiest week and limit: stays rejected until the visits or hours change.
    const lastRejected = await this.prisma.employeeHoursApproval.findFirst({
      where: {
        visitPlanId: params.planId,
        requestType: EmployeeHoursApprovalType.DRAFT_PLAN_OVER_HOURS,
        status: { not: EmployeeHoursApprovalStatus.CANCELLED },
      },
      orderBy: { requestedAt: 'desc' },
    });
    if (
      lastRejected?.status === EmployeeHoursApprovalStatus.REJECTED &&
      minutesOf(lastRejected as (typeof open)[number]) === heaviest.minutes &&
      Number(lastRejected.contractedWeeklyHours ?? NaN) === Number(params.limitWeeklyHours ?? NaN)
    ) {
      await cancelPending();
      return;
    }
    const samePending = open.find(
      (r) => r.status === EmployeeHoursApprovalStatus.PENDING && minutesOf(r) === heaviest.minutes,
    );
    if (samePending) {
      await cancelPending(samePending.id);
      return;
    }
    await cancelPending();
    const limitMinutes = params.limitWeeklyHours != null ? Math.round(params.limitWeeklyHours * 60) : null;
    const created = await this.prisma.employeeHoursApproval.create({
      data: {
        requestType: EmployeeHoursApprovalType.DRAFT_PLAN_OVER_HOURS,
        status: EmployeeHoursApprovalStatus.PENDING,
        serviceUserId: params.serviceUserId,
        visitPlanId: params.planId,
        contractedWeeklyHours: params.limitWeeklyHours,
        projectedWeeklyHours: round1(heaviest.minutes / 60),
        extraHours: limitMinutes != null ? round1((heaviest.minutes - limitMinutes) / 60) : null,
        requestPayload: {
          kind: 'DRAFT_PLAN',
          heaviestWeekStart: heaviest.weekStart,
          heaviestMinutes: heaviest.minutes,
          limitWeeklyHours: params.limitWeeklyHours,
          overWeeks: params.overWeeks,
        } as Prisma.InputJsonValue,
        reason: 'Draft visit plan over the weekly contracted hours',
        requestedById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.DRAFT_PLAN_OVER_HOURS_REQUESTED,
      recordType: 'EmployeeHoursApproval',
      recordId: created.id,
      newValues: { serviceUserId: params.serviceUserId, visitPlanId: params.planId, heaviest },
      ...meta,
    });
    void this.notificationHook.notifyDraftPlanRequested({
      approvalId: created.id,
      serviceUserId: params.serviceUserId,
      weekHoursLabel: params.weekHoursLabel ?? 'busiest week is over the weekly contracted hours',
      requestedById: userId,
    });
  }

  /** Cancel a plan's open draft weekly-hours requests (e.g. once the plan is live). */
  async cancelPendingDraftPlanRequests(planId: string, note: string): Promise<void> {
    await this.prisma.employeeHoursApproval.updateMany({
      where: {
        visitPlanId: planId,
        requestType: EmployeeHoursApprovalType.DRAFT_PLAN_OVER_HOURS,
        status: EmployeeHoursApprovalStatus.PENDING,
      },
      data: { status: EmployeeHoursApprovalStatus.CANCELLED, decidedAt: new Date(), decisionNotes: note },
    });
  }

  /** The draft's latest (not cancelled) weekly-hours request, for the visit plan page. */
  async latestDraftPlanRequest(planId: string) {
    const row = await this.prisma.employeeHoursApproval.findFirst({
      where: {
        visitPlanId: planId,
        requestType: EmployeeHoursApprovalType.DRAFT_PLAN_OVER_HOURS,
        status: { not: EmployeeHoursApprovalStatus.CANCELLED },
      },
      orderBy: { requestedAt: 'desc' },
    });
    if (!row) return null;
    const by = row.decidedById
      ? await this.prisma.user.findUnique({
          where: { id: row.decidedById },
          select: { firstName: true, lastName: true, email: true },
        })
      : null;
    return {
      id: row.id,
      status: row.status,
      heaviestMinutes: Number((row.requestPayload as { heaviestMinutes?: number } | null)?.heaviestMinutes ?? 0),
      requestedAt: row.requestedAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decidedByName: by ? [by.firstName, by.lastName].filter(Boolean).join(' ') || by.email : null,
      decisionNotes: row.decisionNotes,
    };
  }

  /** Why a draft over the hours can't be activated yet (null when it can). */
  async draftPlanActivationBlock(planId: string, heaviestMinutes: number): Promise<string | null> {
    if (heaviestMinutes <= 0) return null;
    const latest = await this.prisma.employeeHoursApproval.findFirst({
      where: {
        visitPlanId: planId,
        requestType: EmployeeHoursApprovalType.DRAFT_PLAN_OVER_HOURS,
        status: { not: EmployeeHoursApprovalStatus.CANCELLED },
      },
      orderBy: { requestedAt: 'desc' },
    });
    const approvedMinutes = Number(
      (latest?.requestPayload as { heaviestMinutes?: number } | null)?.heaviestMinutes ?? 0,
    );
    if (latest?.status === EmployeeHoursApprovalStatus.APPROVED && approvedMinutes >= heaviestMinutes) {
      return null;
    }
    if (latest?.status === EmployeeHoursApprovalStatus.REJECTED) {
      return `A manager rejected this draft plan's weekly hours${latest.decisionNotes ? ` (${latest.decisionNotes})` : ''}. Change the visits or increase the weekly contracted hours, then save the draft again.`;
    }
    return "This draft plan is over the weekly contracted hours and is waiting for a manager's approval (Hours approvals). It can be activated once approved.";
  }

  private async approveDraftPlanOverHours(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    const updated = await this.prisma.employeeHoursApproval.update({
      where: { id: row.id },
      data: {
        status: EmployeeHoursApprovalStatus.APPROVED,
        decidedById: userId,
        decidedAt: new Date(),
        decisionNotes: notes?.trim() || null,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: { status: 'APPROVED', serviceUserId: row.serviceUserId, visitPlanId: row.visitPlanId },
      ...meta,
    });
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: true,
      title: 'Draft visit plan approved',
      message: 'The draft visit plan over the weekly hours was approved — it can now be activated.',
      href: row.serviceUserId ? `/service-users/${row.serviceUserId}/visit-plan` : undefined,
    });
    return { message: 'Draft visit plan approved — it can now be activated', data: updated };
  }

  /** Reject: the draft stays as it is and can't be activated; a reason is required. */
  private async rejectDraftPlanOverHours(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    const reason = notes?.trim();
    if (!reason) throw new BadRequestException('Give a reason for rejecting the draft visit plan.');
    await this.prisma.employeeHoursApproval.update({
      where: { id: row.id },
      data: {
        status: EmployeeHoursApprovalStatus.REJECTED,
        decidedById: userId,
        decidedAt: new Date(),
        decisionNotes: reason,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: { status: 'REJECTED', serviceUserId: row.serviceUserId, visitPlanId: row.visitPlanId, reason },
      ...meta,
    });
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: false,
      title: 'Draft visit plan rejected',
      message: `The draft visit plan over the weekly hours was rejected: ${reason}`,
      href: row.serviceUserId ? `/service-users/${row.serviceUserId}/visit-plan` : undefined,
    });
    return { message: 'Draft visit plan rejected — it stays a draft', data: { id: row.id } };
  }

  private async requireApproval(id: string) {
    const row = await this.prisma.employeeHoursApproval.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Hours approval not found');
    return row;
  }

  async approve(userId: string, id: string, notes?: string, meta?: RequestAuditMeta) {
    const row = await this.requireApproval(id);
    if (row.requestType === EmployeeHoursApprovalType.CONTRACTED_HOURS_CHANGE) {
      return this.approveContractedHoursChange(userId, row, notes, meta);
    }
    if (row.requestType === EmployeeHoursApprovalType.SERVICE_USER_WEEKLY_HOURS_CHANGE) {
      return this.approveServiceUserHoursChange(userId, row, notes, meta);
    }
    if (row.requestType === EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS) {
      return this.approveExtraVisitOverHours(userId, row, notes, meta);
    }
    if (row.requestType === EmployeeHoursApprovalType.DRAFT_PLAN_OVER_HOURS) {
      return this.approveDraftPlanOverHours(userId, row, notes, meta);
    }
    if (row.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS) {
      return this.approveRotaVisitOverHours(userId, row, notes, meta);
    }
    return this.approveVisitPlanOverHours(userId, row, notes, meta);
  }

  /**
   * A carer request's week as it is now, counting every visit waiting for a manager (this one
   * included) as if approved: minutes of the busiest week its visits are in. Null: not a carer
   * request, or nothing left to count.
   */
  private async carerRequestWeekMinutesNow(
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
  ): Promise<number | null> {
    if (!row.employeeId) return null;
    const payload = (row.requestPayload ?? {}) as {
      weekStart?: string;
      start?: string;
      withheld?: string[];
      overWeeks?: Array<{ weekStart?: string }>;
    };
    let weekStarts: string[] = [];
    if (row.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS) {
      const weekStart =
        payload.weekStart ?? (payload.start ? await this.carerHours.weekStartOf(new Date(payload.start)) : null);
      if (weekStart) weekStarts = [weekStart];
    } else if (row.requestType === EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS) {
      const fromHeld = (payload.withheld ?? []).map((k) => k.split('|')[1]).filter(Boolean).map(mondayOf);
      weekStarts = [
        ...new Set(
          fromHeld.length
            ? fromHeld
            : (payload.overWeeks ?? []).map((w) => w.weekStart).filter((w): w is string => Boolean(w)),
        ),
      ];
    }
    if (!weekStarts.length) return null;
    const count = await this.carerHours.count(this.prisma, row.employeeId, { weekStarts });
    return Math.max(0, ...count.weeks.map((w) => w.minutes));
  }

  /** Approve is refused while the week would go above the most a manager can approve. */
  private async assertWithinMaxApprovable(row: Prisma.EmployeeHoursApprovalGetPayload<object>): Promise<void> {
    const { maxApprovableHours } = await this.carerHours.rule();
    const now = await this.carerRequestWeekMinutesNow(row);
    const minutes = now ?? Math.round((row.projectedWeeklyHours ?? 0) * 60);
    if (minutes > Math.round(maxApprovableHours * 60)) {
      throw new BadRequestException(
        `Cannot approve — that week would have ${round1(minutes / 60)}h (visits waiting for approval included), above the ${maxApprovableHours}h weekly maximum (Settings → Dom Rules). Reject this or another request, or reduce this carer's hours first.`,
      );
    }
  }

  // ── Rota visits over a carer's weekly hours (rota board, extra, special visits) ──

  /** Approve: the carer is allocated to the visit as it was asked for (other checks still apply). */
  private async approveRotaVisitOverHours(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    await this.assertWithinMaxApprovable(row);
    const payload = (row.requestPayload ?? {}) as {
      scheduledJobId?: string;
      source?: 'ROTA' | 'EXTRA_VISIT' | 'SPECIAL_VISIT';
      start?: string;
      end?: string;
      allocation?: Record<string, unknown>;
    };
    if (!payload.scheduledJobId || !row.employeeId) {
      throw new BadRequestException('This request has no visit or carer.');
    }
    const pendingEdit = (row.requestPayload as { pendingEdit?: { editId?: string } & Record<string, unknown> } | null)
      ?.pendingEdit;
    if (pendingEdit?.editId) return this.approveHeldExtraEdit(userId, row, pendingEdit, notes, meta);
    // Allocate first: if the visit changed (cancelled, filled, carer now busy) approve fails
    // with that reason and the request stays waiting.
    // Extra and special visits put the carer on without the rota checks, as when they are made.
    const direct = payload.source === 'EXTRA_VISIT' || payload.source === 'SPECIAL_VISIT';
    // A visit with no lead yet gets this carer as lead (they were first in line when it was made).
    const hasLead = await this.prisma.jobAllocation.count({
      where: {
        scheduledJobId: payload.scheduledJobId,
        deletedAt: null,
        isActive: true,
        isLeadCarer: true,
        status: { in: ['PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED'] },
      },
    });
    await this.jobAllocations.allocate(
      userId,
      payload.scheduledJobId,
      {
        ...(payload.allocation ?? {}),
        ...(direct && payload.start && payload.end
          ? { scheduledStartDateTime: payload.start, scheduledEndDateTime: payload.end }
          : {}),
        ...(hasLead ? {} : { isLeadCarer: true }),
        employeeId: row.employeeId,
      } as AllocateJobDto,
      meta,
      undefined,
      { weeklyHoursApproved: true, skipAllocationChecks: direct },
    );
    const updated = await this.prisma.employeeHoursApproval.update({
      where: { id: row.id },
      data: {
        status: EmployeeHoursApprovalStatus.APPROVED,
        decidedById: userId,
        decidedAt: new Date(),
        decisionNotes: notes?.trim() || null,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: { status: 'APPROVED', employeeId: row.employeeId, scheduledJobId: payload.scheduledJobId },
      ...meta,
    });
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: true,
      title: 'Visit over weekly hours approved',
      message: 'The carer was put on the visit.',
      href: '/scheduling/schedule-jobs',
    });
    return { message: 'Approved — the carer is on the visit', data: updated };
  }

  /** Requests waiting on the same held extra visit edit (same visit, same edit). */
  private async heldEditRequests(scheduledJobId: string, editId: string) {
    const rows = await this.prisma.employeeHoursApproval.findMany({
      where: {
        requestType: EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS,
        status: { in: [EmployeeHoursApprovalStatus.PENDING, EmployeeHoursApprovalStatus.APPROVED] },
        requestPayload: { path: ['scheduledJobId'], equals: scheduledJobId },
      },
      select: { id: true, status: true, employeeId: true, requestPayload: true },
    });
    return rows.filter(
      (r) => (r.requestPayload as { pendingEdit?: { editId?: string } } | null)?.pendingEdit?.editId === editId,
    );
  }

  /**
   * Approve one carer of a held extra visit edit. The edit is applied (new time, carers) once
   * every carer it waits on is approved; until then the visit stays as it was.
   */
  private async approveHeldExtraEdit(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    pendingEdit: { editId?: string } & Record<string, unknown>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    const scheduledJobId = (row.requestPayload as { scheduledJobId: string }).scheduledJobId;
    const group = await this.heldEditRequests(scheduledJobId, pendingEdit.editId!);
    const othersWaiting = group.filter((r) => r.id !== row.id && r.status === EmployeeHoursApprovalStatus.PENDING);
    if (!othersWaiting.length) {
      // Apply first: if the visit changed since, approve fails with that reason and the request stays.
      const creator = this.moduleRef.get<ExtraVisitCreator>(EXTRA_VISIT_CREATOR, { strict: false });
      const approvedIds = group
        .filter((r) => r.id === row.id || r.status === EmployeeHoursApprovalStatus.APPROVED)
        .map((r) => r.employeeId)
        .filter((id): id is string => Boolean(id));
      await creator.applyHeldExtraVisitEdit(userId, row.serviceUserId ?? '', pendingEdit, approvedIds);
    }
    const updated = await this.prisma.employeeHoursApproval.update({
      where: { id: row.id },
      data: {
        status: EmployeeHoursApprovalStatus.APPROVED,
        decidedById: userId,
        decidedAt: new Date(),
        decisionNotes: notes?.trim() || null,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: { status: 'APPROVED', employeeId: row.employeeId, scheduledJobId, heldEdit: pendingEdit.editId },
      ...meta,
    });
    const message = othersWaiting.length
      ? `Approved — the change is made once the other ${othersWaiting.length === 1 ? 'carer is' : `${othersWaiting.length} carers are`} approved too`
      : 'Approved — the extra visit change is made';
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: true,
      title: 'Extra visit change approved',
      message,
      href: row.serviceUserId ? `/service-users/${row.serviceUserId}/visit-plan` : '/scheduling/schedule-jobs',
    });
    return { message, data: updated };
  }

  /** Reject: the visit stays without this carer. */
  private async rejectRotaVisitOverHours(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    const reason = notes?.trim() || null;
    await this.prisma.employeeHoursApproval.update({
      where: { id: row.id },
      data: {
        status: EmployeeHoursApprovalStatus.REJECTED,
        decidedById: userId,
        decidedAt: new Date(),
        decisionNotes: reason,
      },
    });
    // A held extra visit edit is dropped as a whole: the visit keeps its time and carers.
    const pendingEdit = (row.requestPayload as { scheduledJobId?: string; pendingEdit?: { editId?: string } } | null);
    if (pendingEdit?.scheduledJobId && pendingEdit.pendingEdit?.editId) {
      const others = (await this.heldEditRequests(pendingEdit.scheduledJobId, pendingEdit.pendingEdit.editId)).filter(
        (r) => r.id !== row.id && r.status === EmployeeHoursApprovalStatus.PENDING,
      );
      if (others.length) {
        await this.prisma.employeeHoursApproval.updateMany({
          where: { id: { in: others.map((r) => r.id) } },
          data: {
            status: EmployeeHoursApprovalStatus.CANCELLED,
            decidedAt: new Date(),
            decisionNotes: 'The extra visit change was rejected for another carer',
          },
        });
      }
      void this.notificationHook.notifyRequesterDecided({
        approvalId: row.id,
        requestedById: row.requestedById,
        decidedById: userId,
        approved: false,
        title: 'Extra visit change rejected',
        message: `The extra visit keeps its current time and carers${reason ? `: ${reason}` : ''}.`,
        href: row.serviceUserId ? `/service-users/${row.serviceUserId}/visit-plan` : '/scheduling/schedule-jobs',
      });
      await this.audit.logAudit({
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
        recordType: 'EmployeeHoursApproval',
        recordId: row.id,
        newValues: { status: 'REJECTED', employeeId: row.employeeId, heldEdit: pendingEdit.pendingEdit.editId },
        ...meta,
      });
      return { message: 'Rejected — the extra visit keeps its current time and carers', data: { id: row.id } };
    }
    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: { status: 'REJECTED', employeeId: row.employeeId },
      ...meta,
    });
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: false,
      title: 'Visit over weekly hours rejected',
      message: `The carer was not put on the visit${reason ? `: ${reason}` : ''}. Choose another carer.`,
      href: '/scheduling/schedule-jobs',
    });
    return { message: 'Rejected — the visit stays without this carer', data: { id: row.id } };
  }

  /** Approve a carer over their weekly hours on a plan: they are put on the held-back visits. */
  private async approveVisitPlanOverHours(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    await this.assertWithinMaxApprovable(row);
    const updated = await this.prisma.employeeHoursApproval.update({
      where: { id: row.id },
      data: {
        status: EmployeeHoursApprovalStatus.APPROVED,
        decidedById: userId,
        decidedAt: new Date(),
        decisionNotes: notes?.trim() || null,
      },
    });
    // New visit times that waited go on the plan and the rota once every carer they put over
    // their hours is approved.
    if (row.visitPlanId && row.serviceUserId) {
      const times = (row.requestPayload as { pendingTimes?: PendingPlanTimeChange[] } | null)?.pendingTimes ?? [];
      if (times.length) {
        const stillWaiting = await this.pendingTimeSlotIds(row.visitPlanId, row.id);
        const ready = times.filter((c) => !stillWaiting.has(c.slotId));
        if (ready.length) {
          await this.applyPlanTimeChanges(this.prisma, userId, row.serviceUserId, row.visitPlanId, ready, 'approved by a manager');
        }
      }
    }
    // The held-back visits on the rota get the carer now.
    if (row.visitPlanId) {
      const creator = this.moduleRef.get<ExtraVisitCreator>(EXTRA_VISIT_CREATOR, { strict: false });
      await creator.resyncPlanCarers(userId, row.visitPlanId);
    }
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: { status: 'APPROVED', employeeId: row.employeeId },
      metadata: { serviceUserId: row.serviceUserId, visitPlanId: row.visitPlanId },
      ...meta,
    });
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: true,
      title: 'Carer weekly hours approved',
      message: 'The carer over their weekly hours on the visit plan was approved and put on the visits.',
      href: row.serviceUserId ? `/service-users/${row.serviceUserId}/visit-plan` : undefined,
    });
    return { message: 'Extra hours approved', data: updated };
  }

  /** Reject and remove the carer's assignments from the plan's slots. */
  async reject(userId: string, id: string, notes?: string, meta?: RequestAuditMeta) {
    const row = await this.requireApproval(id);
    if (row.requestType === EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS) {
      return this.rejectExtraVisitOverHours(userId, row, notes, meta);
    }
    if (row.requestType === EmployeeHoursApprovalType.DRAFT_PLAN_OVER_HOURS) {
      return this.rejectDraftPlanOverHours(userId, row, notes, meta);
    }
    if (row.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS) {
      return this.rejectRotaVisitOverHours(userId, row, notes, meta);
    }
    if (row.requestType !== EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS) {
      // Rejecting an hours change (carer or service user) leaves hours and visits exactly as they are.
      if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
        throw new BadRequestException('This request has already been decided.');
      }
      await this.prisma.employeeHoursApproval.update({
        where: { id },
        data: {
          status: EmployeeHoursApprovalStatus.REJECTED,
          decidedById: userId,
          decidedAt: new Date(),
          decisionNotes: notes?.trim() || null,
        },
      });
      await this.audit.logAudit({
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
        recordType: 'EmployeeHoursApproval',
        recordId: id,
        newValues: { status: 'REJECTED', employeeId: row.employeeId },
        ...meta,
      });
      return { message: 'Hours change rejected — nothing changed', data: { id } };
    }
    const visitPlanId = row.visitPlanId;
    if (!visitPlanId) throw new BadRequestException('This request has no visit plan.');
    const employeeId = row.employeeId;
    if (!employeeId) throw new BadRequestException('This request has no carer.');
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    const { rejectAction } = await this.carerHours.rule();
    const held = ((row.requestPayload as { withheld?: string[] } | null)?.withheld ?? []).map((k) => {
      const [slotId, date] = k.split('|');
      return { slotId, date };
    });
    if (rejectAction === 'REMOVE_EXTRA_VISITS') {
      // Only the visits over the hours come off the carer: the held-back ones, plus — latest
      // first — plan visits they already have, until each week fits. The rejected request keeps
      // them (they stay off the carer and are not counted again). A weekday taken off every
      // week it happens is taken off the carer in the plan.
      const rejectedBefore = new Set(
        (
          await this.prisma.employeeHoursApproval.findMany({
            where: {
              visitPlanId,
              employeeId,
              requestType: EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS,
              status: EmployeeHoursApprovalStatus.REJECTED,
            },
            select: { requestPayload: true },
          })
        ).flatMap((r) => (r.requestPayload as { withheld?: string[] } | null)?.withheld ?? []),
      );
      // A new visit time this request waited on is dropped, so it is not counted.
      const count = await this.carerHours.count(this.prisma, employeeId, {
        planOverride: visitPlanId,
        skipPlanVisits: rejectedBefore,
        excludeApprovalIds: [row.id],
      });
      const offKeys = new Set(held.map((h) => `${h.slotId}|${h.date}`));
      if (count.limitMinutes != null) {
        // Hours a manager already approved for this carer on this plan stay (e.g. an earlier
        // longer visit): only what goes above them comes off.
        const approvedRows = await this.prisma.employeeHoursApproval.findMany({
          where: {
            visitPlanId,
            employeeId,
            requestType: EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS,
            status: EmployeeHoursApprovalStatus.APPROVED,
          },
          select: { projectedWeeklyHours: true, requestPayload: true },
        });
        const approvedMinutes = Math.max(
          0,
          ...approvedRows.map((r) =>
            Number(
              (r.requestPayload as { heaviestMinutes?: number } | null)?.heaviestMinutes ??
                Math.round((r.projectedWeeklyHours ?? 0) * 60),
            ),
          ),
        );
        const threshold = Math.max(count.limitMinutes + count.graceMinutes, approvedMinutes);
        for (const week of count.overWeeks) {
          // Only this plan's visits from the one that crosses the limit on.
          const planVisits = week.overVisits
            .filter((v) => v.visitPlanId === visitPlanId && v.visitPlanSlotId)
            .sort((a, b) => b.start.getTime() - a.start.getTime());
          let excess = week.minutes - threshold;
          for (const v of planVisits) {
            if (offKeys.has(`${v.visitPlanSlotId}|${v.date}`)) excess -= v.minutes;
          }
          for (const v of planVisits) {
            if (excess <= 0) break;
            const key = `${v.visitPlanSlotId}|${v.date}`;
            if (offKeys.has(key)) continue;
            offKeys.add(key);
            excess -= v.minutes;
          }
        }
      }
      const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
      const planVisits = count.weeks.flatMap((w) => w.visits).filter((v) => v.visitPlanId === visitPlanId);
      const removeDays = new Map<string, number[]>();
      const off = [...offKeys].map((k) => {
        const [slotId, date] = k.split('|');
        return { slotId, date };
      });
      for (const slotId of new Set(off.map((h) => h.slotId))) {
        const days = new Set(off.filter((h) => h.slotId === slotId).map((h) => weekdayOf(h.date)));
        const everyTime = [...days].filter((day) =>
          planVisits
            .filter((v) => v.visitPlanSlotId === slotId && weekdayOf(v.date) === day)
            .every((v) => offKeys.has(`${slotId}|${v.date}`)),
        );
        if (everyTime.length) removeDays.set(slotId, everyTime);
      }
      // Upcoming rota visits of the plan the carer is on, on those dates.
      const now = new Date();
      const allocationIds = (
        await this.prisma.jobAllocation.findMany({
          where: {
            employeeId,
            deletedAt: null,
            isActive: true,
            status: { in: ['PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED'] },
            scheduledJob: {
              deletedAt: null,
              scheduledStartDateTime: { gt: now },
              status: { notIn: ['IN_PROGRESS', 'COMPLETED'] },
              metadata: { path: ['visitPlanId'], equals: visitPlanId },
            },
          },
          select: { id: true, scheduledJob: { select: { metadata: true } } },
        })
      )
        .filter((a) => {
          const m = a.scheduledJob.metadata as { visitPlanSlotId?: string; date?: string } | null;
          return offKeys.has(`${m?.visitPlanSlotId}|${m?.date?.slice(0, 10)}`);
        })
        .map((a) => a.id);
      await this.prisma.$transaction(async (tx) => {
        await tx.employeeHoursApproval.update({
          where: { id },
          data: {
            status: EmployeeHoursApprovalStatus.REJECTED,
            decidedById: userId,
            decidedAt: new Date(),
            decisionNotes: notes?.trim() || null,
            requestPayload: {
              ...((row.requestPayload ?? {}) as Record<string, unknown>),
              withheld: [...offKeys],
            } as Prisma.InputJsonValue,
          },
        });
        for (const [slotId, days] of removeDays) {
          await this.hoursReduction.removeCarerFromSlotDays(tx, employeeId, slotId, days);
        }
        await this.scheduleImpact.unallocateEmployeeAllocations(
          userId,
          employeeId,
          allocationIds,
          'Over contracted weekly hours — rejected by a manager',
          'employee_hours_reduced',
          meta,
          tx,
        );
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        await tx.employeeHoursApproval.update({
          where: { id },
          data: {
            status: EmployeeHoursApprovalStatus.REJECTED,
            decidedById: userId,
            decidedAt: new Date(),
            decisionNotes: notes?.trim() || null,
          },
        });
        // Settings → Dom Rules: remove the carer from the whole plan.
        await tx.visitPlanSlotCarerAssignment.deleteMany({
          where: { employeeId, visitPlanSlot: { visitPlanId } },
        });
        const slots = await tx.visitPlanSlot.findMany({
          where: { visitPlanId },
          select: { id: true, assignedEmployeeIds: true },
        });
        for (const s of slots) {
          if (s.assignedEmployeeIds.includes(employeeId)) {
            await tx.visitPlanSlot.update({
              where: { id: s.id },
              data: { assignedEmployeeIds: s.assignedEmployeeIds.filter((e) => e !== employeeId) },
            });
          }
        }
        // Strip the carer from the already-generated rota for this plan (upcoming,
        // non-locked visits only — past/completed allocations are left intact).
        const now = new Date();
        const slotIds = slots.map((s) => s.id);
        if (slotIds.length) {
          const visits = await tx.scheduledVisit.findMany({
            where: {
              visitPlanSlotId: { in: slotIds },
              deletedAt: null,
              scheduledStartDateTime: { gte: now },
            },
            select: { scheduledJobId: true },
          });
          const jobIds = [...new Set(visits.map((v) => v.scheduledJobId))];
          if (jobIds.length) {
            await tx.jobAllocation.updateMany({
              where: {
                scheduledJobId: { in: jobIds },
                employeeId,
                isActive: true,
              },
              data: {
                status: AllocationStatus.UNALLOCATED,
                isActive: false,
                unallocatedAt: now,
                unallocatedById: userId,
                unallocationReason: 'Extra hours rejected — over contracted weekly hours',
              },
            });
          }
        }
      });
    }
    // A rejected new visit time is dropped for every carer: the visit keeps its current time.
    const rejectedTimes = (row.requestPayload as { pendingTimes?: PendingPlanTimeChange[] } | null)?.pendingTimes ?? [];
    if (rejectedTimes.length) await this.dropPendingTimes(visitPlanId, rejectedTimes.map((c) => c.slotId));
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: id,
      newValues: { status: 'REJECTED', employeeId: row.employeeId, rejectAction },
      metadata: { serviceUserId: row.serviceUserId, visitPlanId: row.visitPlanId },
      ...meta,
    });
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: false,
      title: 'Carer weekly hours rejected',
      message:
        rejectAction === 'REMOVE_EXTRA_VISITS'
          ? `The carer stays off the visits over their weekly hours${notes?.trim() ? `: ${notes.trim()}` : ''}.`
          : `The carer was removed from the visit plan${notes?.trim() ? `: ${notes.trim()}` : ''}.`,
      href: row.serviceUserId ? `/service-users/${row.serviceUserId}/visit-plan` : undefined,
    });
    return {
      message:
        rejectAction === 'REMOVE_EXTRA_VISITS'
          ? 'Extra hours rejected — the carer stays off the visits over their hours'
          : 'Extra hours rejected — carer removed from plan',
      data: { id },
    };
  }
}
