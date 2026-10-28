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
import { CarerWeeklyHoursService } from './carer-weekly-hours.service';
import { rotaApprovedAfterRejection } from './rota-approval-override.util';
import { JobAllocationsService } from '../job-allocations/job-allocations.service';
import { ScheduleLifecycleImpactService } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.service';
import type { AllocateJobDto } from '../job-allocations/dto/allocate-job.dto';
import type { ContractedHoursImpact } from './carer-hours-reduction.service';
import { EmployeeHoursApprovalNotificationHook } from './employee-hours-approval-notification.hook';
import { EXTRA_VISIT_CREATOR, type ExtraVisitCreator } from './extra-visit-creator';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { suHoursChangeNeedsApproval } from '../organisation-general-settings/service-user-weekly-hours-settings.util';
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

  /**
   * Delete every request with this status (the list's current tab). A deleted pending carer-hours
   * request no longer holds visits back; the next plan save asks again if the carer is still over.
   * The deleted ids are kept in the audit entry, saved together with the delete.
   */
  async deleteAll(userId: string, status: EmployeeHoursApprovalStatus, meta?: RequestAuditMeta) {
    if (!Object.values(EmployeeHoursApprovalStatus).includes(status)) {
      throw new BadRequestException('A valid status is required.');
    }
    const count = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.employeeHoursApproval.findMany({ where: { status }, select: { id: true } });
      if (!rows.length) return 0;
      const ids = rows.map((r) => r.id);
      await tx.employeeHoursApproval.deleteMany({ where: { id: { in: ids } } });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_HOURS_APPROVALS_DELETED,
        recordType: 'EmployeeHoursApproval',
        recordId: status,
        oldValues: { status, ids },
        newValues: { deleted: ids.length },
        ...meta,
      });
      return ids.length;
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
    } = {},
  ): Promise<Set<string>> {
    const withheld = new Set<string>();
    const assignments = await client.visitPlanSlotCarerAssignment.findMany({
      where: { visitPlanSlot: { visitPlanId: planId, isActive: true } },
      select: { employeeId: true },
    });
    const employeeIds = [...new Set(assignments.map((a) => a.employeeId))];
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
        const threshold = count.limitMinutes + count.graceMinutes;
        const before = options.previousVisits?.get(employeeId);
        // Visits this request already holds back stay held while it waits.
        const heldBefore = new Set(
          (pending?.requestPayload as { withheld?: string[] } | null)?.withheld ?? [],
        );
        for (const week of count.overWeeks) {
          let excess = week.minutes - threshold;
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
            .sort((a, b) => b.start.getTime() - a.start.getTime());
          for (const v of candidates) {
            if (excess <= 0) break;
            held.push(`${v.visitPlanSlotId}|${v.date}`);
            excess -= v.minutes;
          }
        }
      }

      // This plan's visits are among those over the hours: a manager hears about it even when
      // there is nothing to hold back (e.g. visits the carer already has got longer).
      const planInOver =
        !approved &&
        count.overWeeks.some((w) => w.overVisits.some((v) => v.visitPlanId === planId));
      if (!held.length && !planInOver) {
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
    const [rules, carerRule] = await Promise.all([
      this.orgSettings.getServiceUserWeeklyHoursSettings(),
      this.carerHours.rule(),
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
        /** Pending extra visits only: that week now, with the visit added. */
        currentWeek: currentWeek.get(r.id) ?? null,
        /** Extra visits only: whether Reject needs a reason (Settings → Dom Rules). */
        rejectReasonRequired:
          r.requestType === EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS
            ? rules.extraRejectReasonRequired
            : r.requestType === EmployeeHoursApprovalType.DRAFT_PLAN_OVER_HOURS,
        reason: r.reason,
        contractedWeeklyHours: r.contractedWeeklyHours,
        projectedWeeklyHours: r.projectedWeeklyHours,
        extraHours: r.extraHours,
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
    const { maxApprovableHours } = await this.carerHours.rule();
    if ((row.projectedWeeklyHours ?? 0) > maxApprovableHours) {
      throw new BadRequestException(
        `Cannot approve — ${round1(row.projectedWeeklyHours ?? 0)}h exceeds the ${maxApprovableHours}h weekly maximum (Settings → Dom Rules).`,
      );
    }
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
    const { maxApprovableHours } = await this.carerHours.rule();
    if ((row.projectedWeeklyHours ?? 0) > maxApprovableHours) {
      throw new BadRequestException(
        `Cannot approve — ${round1(row.projectedWeeklyHours ?? 0)}h exceeds the ${maxApprovableHours}h weekly maximum (Settings → Dom Rules). Reduce this carer's assigned hours first, then re-check.`,
      );
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
      const count = await this.carerHours.count(this.prisma, employeeId, {
        planOverride: visitPlanId,
        skipPlanVisits: rejectedBefore,
      });
      const offKeys = new Set(held.map((h) => `${h.slotId}|${h.date}`));
      if (count.limitMinutes != null) {
        const threshold = count.limitMinutes + count.graceMinutes;
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
