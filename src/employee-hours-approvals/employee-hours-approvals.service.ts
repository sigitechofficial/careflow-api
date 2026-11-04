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
  VisitPlanStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CarerHoursReductionService } from './carer-hours-reduction.service';
import {
  CarerWeeklyHoursService,
  carerNoContractedHoursError,
  carerMaxMinutes,
  carerOverMaxError,
  carerOverMaxMessage,
  mondayOf,
  overMaxAllowed,
  overMaxNeedsApproval,
  samePlanTime,
  visitsNeedApproval,
  type CarerHoursCount,
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
import { VisitPlanWeeklyHoursService, mondayOfIso } from '../service-user-visit-plans/visit-plan-weekly-hours.service';
import { EXTRA_WEEKLY_HOURS_GRANTER, type ExtraWeeklyHoursGranter } from './extra-weekly-hours-granter';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { suHoursChangeNeedsApproval } from '../organisation-general-settings/service-user-weekly-hours-settings.util';
import { addDaysToOperationalIso, dayKeyInTimeZone } from '../common/utils/operational-day.util';
import { formatOrganisationIsoDate } from '../common/utils/organisation-display-format.util';
import { ScheduleLifecycleNotificationHook } from '../schedule-lifecycle-impact/schedule-lifecycle-notification.hook';
import {
  currentServiceUserWeeklyHours,
  sameWeeklyHours,
  syncServiceUserWeeklyHours,
} from '../service-user-dom-care/service-user-weekly-hours-sync.util';
import { trackHoursRequest } from '../common/request-context/super-admin-context';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Hard weekly cap — extra hours pushing a carer above this can never be approved. */

/** 1550 → "25h 50m" (same as the plan page). */
function formatHoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** A carer request's week furthest over its own limit (contracted + extra + grace) now. */
export type CarerRequestWeekNow = {
  shortMinutes: number;
  weekStart: string;
  weekMinutes: number;
  limitMinutes: number | null;
  extraMinutes: number;
};

function worstCarerWeek(count: CarerHoursCount): CarerRequestWeekNow | null {
  let worst: CarerRequestWeekNow | null = null;
  for (const w of count.weeks) {
    const short = w.limitMinutes != null ? Math.max(0, w.minutes - (w.limitMinutes + count.graceMinutes)) : 0;
    if (!worst || short > worst.shortMinutes || (short === worst.shortMinutes && w.minutes > worst.weekMinutes)) {
      worst = {
        shortMinutes: short,
        weekStart: w.weekStart,
        weekMinutes: w.minutes,
        limitMinutes: w.limitMinutes,
        extraMinutes: w.extraMinutes,
      };
    }
  }
  return worst;
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
      select: { contractedWeeklyHours: true, maximumWeeklyHours: true },
    });
    const previous = employment?.contractedWeeklyHours ?? null;
    if (previous != null && Math.abs(previous - contractedWeeklyHours) <= 0.001) {
      throw new BadRequestException('The new contracted hours are the same as the current hours.');
    }
    // Contracted hours can never be above the carer's maximum weekly hours.
    const maximum = round1(carerMaxMinutes(employment?.maximumWeeklyHours) / 60);
    if (contractedWeeklyHours > maximum + 0.001) {
      throw new BadRequestException(
        `Contracted weekly hours (${round1(contractedWeeklyHours)}h) can't be more than the maximum weekly hours (${maximum}h${employment?.maximumWeeklyHours ? '' : ' — the default when Maximum is blank'}). Raise the maximum first.`,
      );
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
    trackHoursRequest(created.id);
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
    const needsApproval = (await this.carerHours.rule()).contractedChangeNeedsApproval;
    if (needsApproval) void this.notificationHook.notifyContractedChangeRequested({
      approvalId: created.id,
      employeeId,
      previousContractedWeeklyHours: previous,
      requestedContractedWeeklyHours: contractedWeeklyHours,
      rotaVisitsToUnassign: impact.rotaVisitsToUnassign,
      requestedById: userId,
    });
    // Settings → Dom Rules: no manager approval needed — the change applies now (same as an
    // approval, so visits over the new hours come off and the history keeps the record).
    if (!needsApproval) {
      const applied = await this.approveContractedHoursChange(userId, created, 'Applied at once (Settings → Dom Rules: no approval needed)', meta);
      return { ...applied, data: { ...applied.data, id: created.id, appliedAtOnce: true } };
    }
    return { message: 'Sent for manager approval', data: { id: created.id } };
  }

  /** Of these requests, the ones this user sent that still wait for a manager (Hours approvals rows). */
  async listOwnPending(userId: string, ids: string[]) {
    const own = await this.ownPendingIds(userId, ids);
    if (!own.length) return { message: 'No requests waiting', data: [] };
    return this.list(EmployeeHoursApprovalStatus.PENDING, own);
  }

  /**
   * "Approve now": a manager approves requests they just sent (e.g. a carer put over their weekly
   * hours), each exactly as on Hours approvals. Only their own pending requests; the reason is optional.
   */
  async approveOwn(userId: string, ids: string[], reason?: string, meta?: RequestAuditMeta) {
    const own = await this.ownPendingIds(userId, ids);
    const why = reason?.trim() || null;
    const notes = why ? `Approved when sent: ${why}` : 'Approved when sent';
    const sentBefore = new Date();
    const results: Array<{ id: string; approved: boolean; message: string | null }> = [];
    for (const id of own) {
      // Approving one can settle another (e.g. extra weekly hours approve visits that now fit).
      const now = await this.prisma.employeeHoursApproval.findUnique({ where: { id }, select: { status: true } });
      if (now?.status === EmployeeHoursApprovalStatus.APPROVED) {
        results.push({ id, approved: true, message: null });
        continue;
      }
      try {
        const res = (await this.approve(userId, id, notes, meta)) as { message?: string } | undefined;
        results.push({ id, approved: true, message: res?.message ?? null });
        await this.audit.logAudit({
          userId,
          module: AuditModule.EMPLOYEE,
          action: AuditAction.EMPLOYEE_HOURS_APPROVED_BY_REQUESTER,
          recordType: 'EmployeeHoursApproval',
          recordId: id,
          newValues: { status: 'APPROVED', approvedWhenSent: true, reason: why },
          ...meta,
        });
      } catch (err) {
        results.push({ id, approved: false, message: (err as Error).message });
      }
    }
    const approvedIds = results.filter((r) => r.approved).map((r) => r.id);
    await this.notificationHook.dismissWaiting(approvedIds, sentBefore);
    const approved = approvedIds.length;
    const failed = results.length - approved;
    return {
      message: failed
        ? `${approved} approved, ${failed} could not be approved — still on Hours approvals`
        : `${approved} request${approved === 1 ? '' : 's'} approved`,
      data: { results },
    };
  }

  private async ownPendingIds(userId: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.employeeHoursApproval.findMany({
      where: { id: { in: ids }, requestedById: userId, status: EmployeeHoursApprovalStatus.PENDING },
      orderBy: { requestedAt: 'asc' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
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

  /** Approve: the extra visit is created now, with no second hours check (the manager allowed it). */
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
    // Every rejection needs a reason (checked in reject()).
    const reason = notes?.trim() || null;
    if (!reason) throw new BadRequestException('Give a reason for rejecting the extra visit.');
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
        /** Settings → Dom Rules: whether a change needs a manager (the screens ask before saving). */
        changeNeedsApproval: rules.changeNeedsApproval,
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
    if (!suHoursChangeNeedsApproval(rules.changeNeedsApproval, previous, weeklyHours)) {
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
        data: { id: null, applied: true, cancelledVisits: after.cancelled, autoApproved: after.autoApproved },
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
    trackHoursRequest(created.id);
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
      data: { ...updated, cancelledVisits: after.cancelled, autoApproved: after.autoApproved },
    };
  }

  /**
   * After new weekly hours are saved. Lower: the visits over the new hours are cancelled (latest in
   * each week first; the dialog listed them before saving). Higher: pending visit requests that now
   * fit are approved automatically.
   */
  private async afterServiceUserHoursChanged(
    userId: string,
    serviceUserId: string,
    previous: number | null,
    next: number,
    meta?: RequestAuditMeta,
  ): Promise<{ cancelled: number; message: string | null; autoApproved: Array<{ id: string; label: string }> }> {
    if (previous == null || next === previous) return { cancelled: 0, message: null, autoApproved: [] };
    if (next > previous) {
      const { approved } = await this.autoApproveServiceUserVisits(userId, serviceUserId, meta);
      return {
        cancelled: 0,
        autoApproved: approved,
        message: approved.length
          ? `${approved.length} waiting visit${approved.length === 1 ? '' : 's'} now fit and were approved automatically`
          : null,
      };
    }
    const creator = this.moduleRef.get<ExtraVisitCreator>(EXTRA_VISIT_CREATOR, { strict: false });
    try {
      const { cancelled } = await creator.applyHoursDecrease(userId, serviceUserId, next, meta);
      return {
        cancelled,
        autoApproved: [],
        message: cancelled
          ? `${cancelled} visit${cancelled === 1 ? '' : 's'} over the new hours cancelled`
          : null,
      };
    } catch (err) {
      // The hours are already saved; say why the visits stayed so the office can cancel them by hand.
      this.logger.warn(`Hours decrease cancel failed for ${serviceUserId}: ${(err as Error).message}`);
      return {
        cancelled: 0,
        autoApproved: [],
        message: `Visits over the new hours could not be cancelled (${(err as Error).message}) — cancel them on the visit plan`,
      };
    }
  }

  /** What lowering a service user's weekly hours would do to their visits (nothing is saved). */
  async serviceUserHoursImpact(serviceUserId: string, weeklyHours: number) {
    const creator = this.moduleRef.get<ExtraVisitCreator>(EXTRA_VISIT_CREATOR, { strict: false });
    const plan = await creator.planHoursDecrease(serviceUserId, weeklyHours);
    return {
      message: 'Weekly hours change impact',
      data: {
        limitMinutes: plan.limitMinutes,
        overWeeks: plan.overWeeks,
        visitsToCancel: plan.toCancel.map((v) => ({
          date: v.date,
          slotLabel: v.slotLabel,
          startDateTime: v.startDateTime,
          endDateTime: v.endDateTime,
          kind: v.kind,
          timeCritical: v.timeCritical,
        })),
        stillOverWeeks: plan.stillOverWeeks,
      },
    };
  }

  // ── Service user visits held over the weekly hours (visit plan or special visit) ────────

  /** Tell approvers visits are waiting: they would take the service user over their weekly hours. */
  async notifyServiceUserVisitsHeld(params: {
    serviceUserId: string;
    approvalIds: string[];
    requestedById?: string;
  }): Promise<void> {
    if (!params.approvalIds.length) return;
    const first = await this.prisma.employeeHoursApproval.findUnique({ where: { id: params.approvalIds[0] } });
    if (!first) return;
    const p = (first.requestPayload ?? {}) as { kind?: string; weekMinutes?: number; limitWeeklyHours?: number | null; heldDeltas?: unknown[] };
    const kindLabel =
      p.kind === 'SPECIAL_VISIT'
        ? 'special visit'
        : p.kind === 'EXTRA_EDIT'
          ? 'longer extra visit'
          : p.kind === 'PLAN_TIME'
            ? 'longer visit plan visit'
            : 'visit plan visit';
    const n = params.approvalIds.length;
    const more = p.kind === 'PLAN_TIME' ? (p.heldDeltas?.length ?? 1) - 1 : n - 1;
    void this.notificationHook.notifyExtraVisitRequested({
      approvalId: first.id,
      serviceUserId: params.serviceUserId,
      kindLabel,
      visitLabel: more > 0 ? `${await this.extraVisitLabel(first)} and ${more} more` : await this.extraVisitLabel(first),
      weekHoursLabel: `${formatHoursMinutes(p.weekMinutes ?? 0)} of ${formatHoursMinutes(
        Math.round((p.limitWeeklyHours ?? first.contractedWeeklyHours ?? 0) * 60),
      )}`,
      requestedById: params.requestedById,
    });
  }

  /** Approve: the held visit is made now, with no second hours check (the manager allowed it). */
  private async approveServiceUserVisitOverHours(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    const payload = row.requestPayload as Record<string, unknown> | null;
    if (!payload || !row.serviceUserId) throw new BadRequestException('The request has no visit details.');
    if (payload.kind === 'PLAN_TIME') return this.approveHeldPlanTime(userId, row, payload, notes, meta);
    const isEdit = payload.kind === 'EXTRA_EDIT';
    const creator = this.moduleRef.get<ExtraVisitCreator>(EXTRA_VISIT_CREATOR, { strict: false });
    const { scheduledJobId } = await creator.createHeldServiceUserVisit(
      userId,
      row.serviceUserId,
      row.visitPlanId,
      payload,
      meta,
    );
    if (!scheduledJobId) {
      throw new BadRequestException('The visit could not be made (the plan or its time slot changed). Reject it instead.');
    }
    const updated = await this.prisma.employeeHoursApproval.update({
      where: { id: row.id },
      data: {
        status: EmployeeHoursApprovalStatus.APPROVED,
        decidedById: userId,
        decidedAt: new Date(),
        decisionNotes: notes?.trim() || null,
        requestPayload: { ...payload, createdJobId: scheduledJobId } as Prisma.InputJsonValue,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: { status: 'APPROVED', serviceUserId: row.serviceUserId, createdJobId: scheduledJobId },
      ...meta,
    });
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: true,
      title: isEdit ? 'Longer visit approved' : 'Visit approved',
      message: isEdit
        ? `The longer visit on ${await this.extraVisitLabel(row)} was approved — the rota visit has the new time.`
        : `The visit on ${await this.extraVisitLabel(row)} was approved and added to the rota.`,
      href: `/service-users/${row.serviceUserId}/visit-plan`,
    });
    return {
      message: isEdit ? 'Approved — the visit now has the new time' : 'Visit approved and added to the rota',
      data: updated,
    };
  }

  /**
   * Approve a plan amendment's longer visits: the rota visits that kept their old time move to the
   * plan's time now (only those still upcoming, and only when the plan still has that time).
   */
  private async approveHeldPlanTime(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    payload: Record<string, unknown>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    const change = payload.planTimeChange as {
      planId: string;
      changes: Array<{ slotId: string; slotLabel: string; fromStart: string; fromEnd: string; toStart: string; toEnd: string }>;
      held: Array<{ slotId: string; startsAt: string }>;
    };
    const serviceUserId = row.serviceUserId!;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    let moved = 0;
    for (const c of change.changes) {
      const slot = await this.prisma.visitPlanSlot.findFirst({
        where: { id: c.slotId, visitPlanId: change.planId, isActive: true },
        select: { plannedStartTime: true, plannedEndTime: true },
      });
      // The plan changed since (another time saved): that one stands.
      if (!slot || !samePlanTime(slot.plannedStartTime, c.toStart) || !samePlanTime(slot.plannedEndTime, c.toEnd)) continue;
      const starts = new Set(change.held.filter((h) => h.slotId === c.slotId).map((h) => h.startsAt));
      const result = await this.scheduleImpact.rescheduleSlotJobs(userId, {
        serviceUserId,
        visitPlanSlotId: c.slotId,
        fromDate: visitPlanTodayUtc(new Date(), timeZone),
        resolveNewTimes: (jobStart) =>
          starts.has(jobStart.toISOString()) ? resolveEndFromStartAndTimes(jobStart, c.toStart, c.toEnd, timeZone) : null,
        reason: `${c.slotLabel} visit time ${c.fromStart}–${c.fromEnd} → ${c.toStart}–${c.toEnd} (approved over the service user's weekly hours)`,
        source: 'visit_plan_amendment',
      }, meta);
      moved += result.jobsRescheduled ?? 0;
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
      newValues: { status: 'APPROVED', serviceUserId, visitsMoved: moved },
      ...meta,
    });
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: true,
      title: 'Longer visits approved',
      message: `${moved} visit${moved === 1 ? '' : 's'} moved to the new time.`,
      href: `/service-users/${serviceUserId}/visit-plan`,
    });
    return { message: `Approved — ${moved} visit${moved === 1 ? '' : 's'} moved to the new time`, data: updated };
  }

  /** Reject: the held visit is not made (and generation never makes it). */
  private async rejectServiceUserVisitOverHours(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    notes: string,
    meta?: RequestAuditMeta,
  ) {
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    const updated = await this.prisma.employeeHoursApproval.update({
      where: { id: row.id },
      data: {
        status: EmployeeHoursApprovalStatus.REJECTED,
        decidedById: userId,
        decidedAt: new Date(),
        decisionNotes: notes.trim(),
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: { status: 'REJECTED', serviceUserId: row.serviceUserId, reason: notes.trim() },
      ...meta,
    });
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: false,
      title: 'Visit rejected',
      message: `The visit on ${await this.extraVisitLabel(row)} was rejected: ${notes.trim()}`,
      href: `/service-users/${row.serviceUserId}/visit-plan`,
    });
    return { message: 'Visit rejected — it is not added to the rota', data: updated };
  }

  /**
   * Weekly hours went up: pending visit requests of the service user (extra visits and held
   * visits) that fit the new hours are approved, oldest first, each one counted with the ones
   * before it. A request that can't be made (e.g. it clashes with another visit) stays pending.
   */
  private async autoApproveServiceUserVisits(
    userId: string,
    serviceUserId: string,
    meta?: RequestAuditMeta,
  ): Promise<{ approved: Array<{ id: string; label: string }>; stillPending: number }> {
    await this.expireStaleRequests();
    const rows = await this.prisma.employeeHoursApproval.findMany({
      where: {
        serviceUserId,
        status: EmployeeHoursApprovalStatus.PENDING,
        requestType: {
          in: [EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS, EmployeeHoursApprovalType.SERVICE_USER_VISIT_OVER_HOURS],
        },
      },
      orderBy: { requestedAt: 'asc' },
    });
    const weeklyHours = this.moduleRef.get(VisitPlanWeeklyHoursService, { strict: false });
    const limit = await weeklyHours.limit(this.prisma, serviceUserId);
    const approved: Array<{ id: string; label: string }> = [];
    let stillPending = 0;
    const note = 'Approved automatically: the weekly hours went up and the visit now fits';
    for (const row of rows) {
      const p = (row.requestPayload ?? {}) as {
        date?: string;
        durationMinutes?: number;
        requiredCarers?: number;
        heldDeltas?: Array<{ date: string; minutes: number }>;
      };
      // What the request adds to each week (a longer visit adds only the extra time).
      const deltas = p.heldDeltas ?? (p.date ? [{ date: p.date, minutes: (p.durationMinutes ?? 0) * Math.max(1, p.requiredCarers ?? 1) }] : []);
      const addByWeek = new Map<string, { date: string; minutes: number }>();
      for (const d of deltas) {
        const key = mondayOfIso(d.date);
        addByWeek.set(key, { date: d.date, minutes: (addByWeek.get(key)?.minutes ?? 0) + d.minutes });
      }
      let fits = limit != null && addByWeek.size > 0;
      for (const add of addByWeek.values()) {
        if (!fits) break;
        const week = await weeklyHours.weekMinutes(this.prisma, serviceUserId, add.date);
        fits = week.minutes + add.minutes <= Math.round(limit! * 60);
      }
      if (!fits) {
        stillPending += 1;
        continue;
      }
      try {
        if (row.requestType === EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS) {
          await this.approveExtraVisitOverHours(userId, row, note, meta);
        } else {
          await this.approveServiceUserVisitOverHours(userId, row, note, meta);
        }
        approved.push({ id: row.id, label: await this.extraVisitLabel(row) });
      } catch (err) {
        stillPending += 1;
        this.logger.warn(`Auto-approve of ${row.id} skipped: ${(err as Error).message}`);
      }
    }
    return { approved, stillPending };
  }

  /**
   * Requests whose visit can no longer happen are marked EXPIRED (kept, shown on their own tab):
   * the visit's start time has passed, or the request is no longer valid — plan ended or deleted,
   * service user inactive, the time slot removed, the date cancelled, or the visit already on the
   * rota. Service user and carer visit requests. Runs when Hours approvals opens, in the nightly
   * rolling rota and before an approve.
   */
  async expireStaleRequests(onlyId?: string): Promise<number> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const now = new Date();
    const today = dayKeyInTimeZone(now, timeZone);
    const nowLocal = `${today}T${new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now)}`;
    const rows = await this.prisma.employeeHoursApproval.findMany({
      where: {
        ...(onlyId ? { id: onlyId } : {}),
        status: EmployeeHoursApprovalStatus.PENDING,
        requestType: {
          in: [
            EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS,
            EmployeeHoursApprovalType.SERVICE_USER_VISIT_OVER_HOURS,
            EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS,
            EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS,
          ],
        },
      },
    });
    let expired = 0;
    for (const row of rows) {
      const why = await this.expiryReason(row, { now, today, nowLocal });
      if (!why) continue;
      await this.prisma.employeeHoursApproval.update({
        where: { id: row.id },
        data: { status: EmployeeHoursApprovalStatus.EXPIRED, decidedAt: now, decisionNotes: why },
      });
      expired += 1;
    }
    return expired;
  }

  private async expiryReason(
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    clock: { now: Date; today: string; nowLocal: string },
  ): Promise<string | null> {
    const p = (row.requestPayload ?? {}) as {
      kind?: string;
      date?: string;
      startTime?: string;
      startsAt?: string;
      start?: string;
      visitPlanSlotId?: string;
      scheduledJobId?: string;
      withheld?: string[];
    };
    // Time: the visit's start has passed.
    if (p.startsAt && new Date(p.startsAt) <= clock.now) return 'Visit time has passed';
    if (p.start && new Date(p.start) <= clock.now) return 'Visit time has passed';
    if (!p.startsAt && p.date && p.startTime && `${p.date}T${p.startTime}` <= clock.nowLocal) {
      return 'Visit time has passed';
    }
    if (row.requestType === EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS && p.withheld?.length) {
      const dates = p.withheld.map((k) => k.split('|').pop() ?? '');
      if (dates.every((d) => d && d < clock.today)) return 'Visit time has passed';
    }
    // Validity.
    if (row.serviceUserId) {
      const su = await this.prisma.serviceUser.findFirst({
        where: { id: row.serviceUserId },
        select: { isActive: true, deletedAt: true, dateOfDeath: true },
      });
      if (!su || !su.isActive || su.deletedAt || su.dateOfDeath) return 'No longer valid: the service user is not active';
    }
    if (row.visitPlanId) {
      const plan = await this.prisma.serviceUserVisitPlan.findFirst({
        where: { id: row.visitPlanId },
        select: { status: true, deletedAt: true, isActive: true },
      });
      if (!plan || plan.deletedAt || !plan.isActive || plan.status === 'ENDED') {
        return 'No longer valid: the visit plan ended';
      }
    }
    if (row.requestType === EmployeeHoursApprovalType.SERVICE_USER_VISIT_OVER_HOURS && p.kind === 'PLAN_VISIT') {
      const slot = p.visitPlanSlotId
        ? await this.prisma.visitPlanSlot.findFirst({
            where: { id: p.visitPlanSlotId },
            select: { isEnabled: true, exceptions: { where: { exceptionType: 'SKIP' }, select: { exceptionDate: true } } },
          })
        : null;
      if (!slot || !slot.isEnabled) return 'No longer valid: the time slot was removed';
      if (slot.exceptions.some((e) => e.exceptionDate.toISOString().slice(0, 10) === p.date)) {
        return 'No longer valid: the date was cancelled';
      }
      const onRota = await this.prisma.scheduledJob.findFirst({
        where: {
          deletedAt: null,
          status: { not: 'CANCELLED' },
          AND: [
            { metadata: { path: ['visitPlanSlotId'], equals: p.visitPlanSlotId } },
            { metadata: { path: ['date'], equals: p.date } },
          ],
        },
        select: { id: true },
      });
      if (onRota) return 'No longer valid: the visit is already on the rota';
    }
    if (row.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS && p.scheduledJobId) {
      const job = await this.prisma.scheduledJob.findFirst({
        where: { id: p.scheduledJobId },
        select: { deletedAt: true, status: true },
      });
      if (!job || job.deletedAt || job.status === 'CANCELLED') return 'No longer valid: the visit was removed from the rota';
    }
    return null;
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
      /** Filled with "assigned over their weekly hours" warnings (Settings → Dom Rules: no approval). */
      warnings?: string[];
    } = {},
  ): Promise<Set<string>> {
    const withheld = new Set<string>();
    // Draft plans are not checked: carers are checked once the plan is active and visits are made.
    const planRow = await client.serviceUserVisitPlan.findUnique({ where: { id: planId }, select: { status: true } });
    if (planRow?.status === VisitPlanStatus.DRAFT) return withheld;
    const rule = await this.carerHours.rule();
    const needsApproval = visitsNeedApproval(rule);
    const display = await this.orgSettings.getOperationalDisplaySettings();
    const nameOf = async (employeeId: string) => {
      const person = await client.employeePersonalDetail.findFirst({
        where: { employeeId, deletedAt: null },
        select: { firstName: true, lastName: true },
      });
      return `${person?.firstName ?? ''} ${person?.lastName ?? ''}`.trim() || 'A carer';
    };
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
      const before = options.previousVisits?.get(employeeId);
      const planVisitsNow = count.weeks.flatMap((w) => w.visits).filter((v) => v.visitPlanId === planId && v.visitPlanSlotId);
      const newKeys = planVisitsNow
        .map((v) => `${v.visitPlanSlotId}|${v.date}`)
        .filter((k) => options.previousVisits != null && !before?.has(k));
      // Plan save: new visits that take a week above the carer's maximum weekly hours are refused
      // unless Settings → Dom Rules allows going over the maximum.
      const refuseOverMax = async (newDays: Set<string>, longer: string[]) => {
        if (options.previousVisits == null || overMaxAllowed(rule)) return;
        const tooMuch = count.weeks.find(
          (w) =>
            w.minutes > count.maxMinutes &&
            ([...newDays].some((d) => d >= w.weekStart && d <= addDaysToOperationalIso(w.weekStart, 6)) ||
              w.visits.some((v) => v.visitPlanSlotId != null && longer.includes(v.visitPlanSlotId))),
        );
        if (!tooMuch) return;
        throw carerOverMaxError(
          employeeId,
          `${await nameOf(employeeId)}: ${carerOverMaxMessage(tooMuch.minutes, count.maxMinutes)} in the week of ${formatOrganisationIsoDate(tooMuch.weekStart, display.dateDisplayFormat)}. Choose another carer or change the visits.`,
        );
      };
      // No contracted weekly hours: the carer can't be given visits. A save that gives them new
      // visits is refused; the rota leaves them off this plan's visits.
      if (count.limitMinutes == null) {
        if (newKeys.length) throw carerNoContractedHoursError(employeeId, await nameOf(employeeId));
        if (options.previousVisits == null) {
          for (const v of planVisitsNow) withheld.add(`${employeeId}|${v.visitPlanSlotId}|${v.date}`);
        }
        continue;
      }
      // Settings → Dom Rules: visits over the hours are assigned with a warning — nothing waits.
      if (!needsApproval) {
        await refuseOverMax(
          new Set(newKeys.map((k) => k.split('|')[1])),
          [...timeOptions.keys()].filter((slotId) => savedTimes.has(slotId)),
        );
        if (options.previousVisits != null && options.warnings) {
          const h = (m: number) => `${Math.round((m / 60) * 10) / 10}h`;
          const weeks = count.overWeeks.filter((w) => w.overVisits.some((v) => v.visitPlanId === planId));
          if (weeks.length) {
            const w = weeks[0];
            options.warnings.push(
              `${await nameOf(employeeId)} goes over their weekly hours (week of ${formatOrganisationIsoDate(w.weekStart, display.dateDisplayFormat)}: ${h(w.minutes)} of ${h(w.limitMinutes ?? count.limitMinutes)}${weeks.length > 1 ? `, and ${weeks.length - 1} more week${weeks.length > 2 ? 's' : ''}` : ''})`,
            );
          }
        }
        heldTimesBy.set(employeeId, new Set());
        for (const [slotId, c] of timeOptions) releasedTimes.set(slotId, c);
        continue;
      }
      if (!approved) {
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
        // Each week's own limit: contracted + extra weekly hours given for it.
        const limit = count.limitMinutes;
        const thresholdOf = (week: { limitMinutes: number | null }) =>
          Math.max((week.limitMinutes ?? limit) + count.graceMinutes, approvedMinutes);
        // Visits this request already holds back stay held while it waits.
        const heldBefore = new Set(
          (pending?.requestPayload as { withheld?: string[] } | null)?.withheld ?? [],
        );
        for (const week of count.overWeeks) {
          let excess = week.minutes - thresholdOf(week);
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
        // Above the maximum (when allowed) the visits stay held back in this request like any other.
        await refuseOverMax(
          new Set(held.filter((k) => !heldBefore.has(k) && !before?.has(k)).map((k) => k.split('|')[1])),
          [...heldTimes.keys()].filter((slotId) => savedTimes.has(slotId)),
        );
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
        trackHoursRequest(pending.id);
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
        trackHoursRequest(row.id);
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

  async list(status?: EmployeeHoursApprovalStatus, ids?: string[]) {
    const rows = await this.prisma.employeeHoursApproval.findMany({
      where: { ...(status ? { status } : {}), ...(ids ? { id: { in: ids } } : {}) },
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
    });

    const employeeIds = [
      ...new Set(rows.map((r) => r.employeeId).filter((id): id is string => Boolean(id))),
    ];
    const serviceUserIds = [
      ...new Set(rows.map((r) => r.serviceUserId).filter((id): id is string => Boolean(id))),
    ];
    const [employees, serviceUsers, employments] = await Promise.all([
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
      employeeIds.length
        ? this.prisma.employeeEmployment.findMany({
            where: { employeeId: { in: employeeIds }, deletedAt: null },
            select: { employeeId: true, maximumWeeklyHours: true },
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
    const maxHoursById = new Map(employments.map((e) => [e.employeeId, e.maximumWeeklyHours]));
    const [rules, carerRule, changesById] = await Promise.all([
      this.orgSettings.getServiceUserWeeklyHoursSettings(),
      this.carerHours.rule(),
      this.requestChanges(rows),
    ]);
    // Pending extra visits: that week as it is now (it may have changed since the request).
    const currentWeek = new Map<string, { weekMinutes: number; limitWeeklyHours: number | null; timebankMinutes: number }>();
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
    const carerLimitNow = new Map<string, CarerRequestWeekNow>();
    const carerBlockedNow = new Map<string, string>();
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
            const count = await this.carerRequestWeeksNow(r);
            if (count) {
              carerWeekNow.set(r.id, Math.max(0, ...count.weeks.map((w) => w.minutes)));
              const worst = worstCarerWeek(count);
              if (worst) carerLimitNow.set(r.id, worst);
              // Back within the hours but still waiting: what stops the approval.
              if (worst && worst.shortMinutes <= 0) {
                const reason = await this.rotaApprovalBlockedReason(r);
                if (reason) carerBlockedNow.set(r.id, reason);
              }
            }
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
        /** Every rejection needs a reason. */
        rejectReasonRequired: true,
        reason: r.reason,
        contractedWeeklyHours: r.contractedWeeklyHours,
        /** Pending carer requests: that week now, every waiting request included. */
        projectedWeeklyHours: projectedOf(r),
        extraHours:
          carerWeekNow.has(r.id) && r.contractedWeeklyHours != null
            ? round1((projectedOf(r) ?? 0) - r.contractedWeeklyHours)
            : r.extraHours,
        /**
         * Pending carer requests: the week furthest over its own limit now — limit = contracted +
         * extra weekly hours given for it; shortHours 0 = it fits now.
         */
        weekNow: (() => {
          const w = carerLimitNow.get(r.id);
          return w
            ? {
                weekStart: w.weekStart,
                weekHours: round1(w.weekMinutes / 60),
                limitHours: w.limitMinutes != null ? round1(w.limitMinutes / 60) : null,
                extraHours: round1(w.extraMinutes / 60),
                shortHours: round1(w.shortMinutes / 60),
                /** Within the hours, but another rota check stops the approval (why). */
                blockedReason: carerBlockedNow.get(r.id) ?? null,
              }
            : null;
        })(),
        requestedAt: r.requestedAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        decisionNotes: r.decisionNotes,
        /** Carer over weekly hours: the carer's maximum weekly hours (Employment; blank = 60h). */
        maxApprovableHours:
          r.requestType === EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS ||
          r.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS
            ? round1(carerMaxMinutes(maxHoursById.get(r.employeeId ?? '')) / 60)
            : null,
        /** Carer over weekly hours: true = above the carer's maximum a manager can still approve. */
        allowOverMax:
          (r.requestType === EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS ||
            r.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS) &&
          overMaxAllowed(carerRule),
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
    trackHoursRequest(created.id);
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

  /** Extra weekly hours waiting for a manager: give them now (checked again), then mark approved. */
  private async approveExtraWeeklyHours(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    const extraHours = this.moduleRef.get<ExtraWeeklyHoursGranter>(EXTRA_WEEKLY_HOURS_GRANTER, { strict: false });
    const applied = await extraHours.applyApprovedRequest(userId, row, meta);
    await this.prisma.employeeHoursApproval.update({
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
      module: AuditModule.EMPLOYEE,
      action: AuditAction.EMPLOYEE_HOURS_APPROVAL_DECIDED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: { status: 'APPROVED', employeeId: row.employeeId, extraWeeklyHoursId: applied.data.id },
      ...meta,
    });
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: true,
      title: 'Extra weekly hours approved',
      message: applied.message,
    });
    return { message: `Approved — ${applied.message}`, data: { ...applied.data, id: row.id, extraWeeklyHoursId: applied.data.id } };
  }

  async approve(userId: string, id: string, notes?: string, meta?: RequestAuditMeta) {
    const row = await this.requireApproval(id);
    if (row.requestType === EmployeeHoursApprovalType.CONTRACTED_HOURS_CHANGE) {
      return this.approveContractedHoursChange(userId, row, notes, meta);
    }
    if (row.requestType === EmployeeHoursApprovalType.EXTRA_WEEKLY_HOURS) {
      return this.approveExtraWeeklyHours(userId, row, notes, meta);
    }
    if (row.requestType === EmployeeHoursApprovalType.SERVICE_USER_WEEKLY_HOURS_CHANGE) {
      return this.approveServiceUserHoursChange(userId, row, notes, meta);
    }
    // A visit that can no longer happen can't be approved (it moves to Expired).
    if (await this.expireStaleRequests(row.id)) {
      throw new BadRequestException('This request has expired — the visit time has passed or it is no longer valid.');
    }
    if (row.requestType === EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS) {
      return this.approveExtraVisitOverHours(userId, row, notes, meta);
    }
    if (row.requestType === EmployeeHoursApprovalType.SERVICE_USER_VISIT_OVER_HOURS) {
      return this.approveServiceUserVisitOverHours(userId, row, notes, meta);
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
  private async carerRequestWeeksNow(
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    addExtraMinutes?: Map<string, Map<string, number>>,
  ): Promise<CarerHoursCount | null> {
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
    return this.carerHours.count(this.prisma, row.employeeId, { weekStarts, addExtraMinutes });
  }

  /**
   * How far a carer request's weeks are over their own limit now (contracted + extra weekly
   * hours for each week, + grace), every visit waiting for a manager counted as if approved.
   * Null: not a carer request, or nothing left to count.
   */
  async carerRequestShortMinutesNow(
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    /** Extra weekly hours not saved yet (a preview), minutes per carer per week. */
    addExtraMinutes?: Map<string, Map<string, number>>,
  ): Promise<CarerRequestWeekNow | null> {
    const count = await this.carerRequestWeeksNow(row, addExtraMinutes);
    return count ? worstCarerWeek(count) : null;
  }

  private async carerRequestWeekMinutesNow(
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
  ): Promise<number | null> {
    const count = await this.carerRequestWeeksNow(row);
    return count ? Math.max(0, ...count.weeks.map((w) => w.minutes)) : null;
  }

  /**
   * Approve is refused while the week would go above the carer's maximum weekly hours — unless
   * Settings → Dom Rules allows going over the maximum.
   */
  private async assertWithinMaxApprovable(row: Prisma.EmployeeHoursApprovalGetPayload<object>): Promise<void> {
    const rule = await this.carerHours.rule();
    if (overMaxAllowed(rule)) return;
    const count = await this.carerRequestWeeksNow(row);
    const minutes = count ? Math.max(0, ...count.weeks.map((w) => w.minutes)) : Math.round((row.projectedWeeklyHours ?? 0) * 60);
    const maxMinutes = count?.maxMinutes ?? carerMaxMinutes(null);
    if (minutes > maxMinutes) {
      throw carerOverMaxError(
        row.employeeId ?? '',
        `Cannot approve — that week would have ${round1(minutes / 60)}h (visits waiting for approval included), above the carer's ${round1(maxMinutes / 60)}h weekly maximum (Employment → Working hours). Reject this or another request, or reduce this carer's hours first.`,
      );
    }
  }

  // ── Rota visits over a carer's weekly hours (rota board, extra, special visits) ──

  /** The allocation approving a rota visit request makes (the same one the preview checks). */
  private async rotaApprovalAllocation(
    scheduledJobId: string,
    employeeId: string,
    payload: {
      source?: 'ROTA' | 'EXTRA_VISIT' | 'SPECIAL_VISIT';
      start?: string;
      end?: string;
      allocation?: Record<string, unknown>;
      replaceEmployeeIds?: string[];
    },
  ): Promise<{
    dto: AllocateJobDto;
    options: { weeklyHoursApproved: boolean; skipAllocationChecks: boolean; replacingEmployeeIds: string[] };
    /** Carers still on the visit that approving takes off (a run carer taking it over). */
    replacing: string[];
  }> {
    // Extra and special visits put the carer on without the rota checks, as when they are made.
    const direct = payload.source === 'EXTRA_VISIT' || payload.source === 'SPECIAL_VISIT';
    const replacing = payload.replaceEmployeeIds?.length
      ? (
          await this.prisma.jobAllocation.findMany({
            where: {
              scheduledJobId,
              employeeId: { in: payload.replaceEmployeeIds },
              deletedAt: null,
              isActive: true,
              status: { in: ['PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED'] },
            },
            select: { employeeId: true },
          })
        ).map((a) => a.employeeId)
      : [];
    // A visit with no lead yet gets this carer as lead (they were first in line when it was made).
    const hasLead = await this.prisma.jobAllocation.count({
      where: {
        scheduledJobId,
        deletedAt: null,
        isActive: true,
        isLeadCarer: true,
        status: { in: ['PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED'] },
      },
    });
    return {
      dto: {
        ...(payload.allocation ?? {}),
        ...(direct && payload.start && payload.end
          ? { scheduledStartDateTime: payload.start, scheduledEndDateTime: payload.end }
          : {}),
        ...(hasLead ? {} : { isLeadCarer: true }),
        employeeId,
      } as AllocateJobDto,
      options: { weeklyHoursApproved: true, skipAllocationChecks: direct, replacingEmployeeIds: replacing },
      replacing,
    };
  }

  /**
   * Why approving this rota visit request would fail now, other than the weekly hours (null: it
   * would go through). Nothing is saved. Plan requests and held extra visit edits: null.
   */
  async rotaApprovalBlockedReason(row: Prisma.EmployeeHoursApprovalGetPayload<object>): Promise<string | null> {
    if (row.requestType !== EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS || !row.employeeId) return null;
    const payload = (row.requestPayload ?? {}) as {
      scheduledJobId?: string;
      source?: 'ROTA' | 'EXTRA_VISIT' | 'SPECIAL_VISIT';
      start?: string;
      end?: string;
      allocation?: Record<string, unknown>;
      pendingEdit?: { editId?: string };
      replaceEmployeeIds?: string[];
    };
    if (!payload.scheduledJobId || payload.pendingEdit?.editId) return null;
    const allocation = await this.rotaApprovalAllocation(payload.scheduledJobId, row.employeeId, payload);
    return this.jobAllocations.allocationBlockedReason(payload.scheduledJobId, allocation.dto, allocation.options);
  }

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
    const allocation = await this.rotaApprovalAllocation(payload.scheduledJobId, row.employeeId, payload);
    if (allocation.replacing.length) {
      // A run carer taking over the visit: check first, then the carer on it comes off.
      const reason = await this.jobAllocations.allocationBlockedReason(
        payload.scheduledJobId,
        allocation.dto,
        allocation.options,
      );
      if (reason) throw new BadRequestException(reason);
      for (const employeeId of allocation.replacing) {
        await this.jobAllocations.unallocate(
          userId,
          payload.scheduledJobId,
          { employeeId, reason: 'Visit moved to the run carer (approved)' },
          meta,
        );
      }
    }
    await this.jobAllocations.allocate(
      userId,
      payload.scheduledJobId,
      allocation.dto,
      meta,
      undefined,
      { ...allocation.options, replacingEmployeeIds: [] },
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
  /**
   * What Reject would leave without the carer (shown in the reject dialog). Nothing is saved.
   * Visit plan: the held visits plus — latest first — visits the carer has until each week fits;
   * rota / extra / special visit: that one visit. Other requests change no visits.
   */
  async rejectPreview(id: string) {
    const row = await this.requireApproval(id);
    const visits: Array<{ date?: string; slotLabel: string; startTime?: string; endTime?: string }> = [];
    if (row.status === EmployeeHoursApprovalStatus.PENDING && row.employeeId) {
      if (row.requestType === EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS && row.visitPlanId) {
        const { offKeys } = await this.planRejectOffKeys(row, row.visitPlanId, row.employeeId);
        const changes = await this.requestChanges([
          { ...row, requestPayload: { withheld: [...offKeys] } as Prisma.JsonValue },
        ]);
        for (const c of changes.get(row.id) ?? []) {
          if (c.kind === 'HELD_VISIT') {
            visits.push({ date: c.date, slotLabel: c.slotLabel, startTime: c.startTime, endTime: c.endTime });
          }
        }
      } else if (row.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS) {
        const payload = (row.requestPayload ?? {}) as { start?: string; end?: string; source?: string };
        if (payload.start && payload.end) {
          const timeZone = await this.orgSettings.getOperationalTimezone();
          const hm = (iso: string) =>
            new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
          visits.push({
            date: dayKeyInTimeZone(new Date(payload.start), timeZone),
            slotLabel: payload.source === 'SPECIAL_VISIT' ? 'Special visit' : payload.source === 'EXTRA_VISIT' ? 'Extra visit' : 'Rota visit',
            startTime: hm(payload.start),
            endTime: hm(payload.end),
          });
        }
      }
    }
    return { message: 'Reject preview', data: { id, unassignedVisits: visits } };
  }

  /**
   * The plan visits a rejected carer request leaves without the carer ("slotId|YYYY-MM-DD"): the
   * held-back ones, plus — latest first — plan visits they already have, until each week fits.
   */
  private async planRejectOffKeys(
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    visitPlanId: string,
    employeeId: string,
  ): Promise<{ offKeys: Set<string>; count: CarerHoursCount }> {
    const held = ((row.requestPayload as { withheld?: string[] } | null)?.withheld ?? []).map((k) => {
      const [slotId, date] = k.split('|');
      return { slotId, date };
    });
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
      const limit = count.limitMinutes;
      for (const week of count.overWeeks) {
        // Each week's own limit: contracted + extra weekly hours given for it.
        const threshold = Math.max((week.limitMinutes ?? limit) + count.graceMinutes, approvedMinutes);
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
    return { offKeys, count };
  }

  async reject(userId: string, id: string, notes?: string, meta?: RequestAuditMeta) {
    const row = await this.requireApproval(id);
    // Every rejection needs a reason, so the person who asked knows why.
    if (!notes?.trim()) throw new BadRequestException('Give a reason for rejecting this request.');
    if (row.requestType === EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS) {
      return this.rejectExtraVisitOverHours(userId, row, notes, meta);
    }
    if (row.requestType === EmployeeHoursApprovalType.SERVICE_USER_VISIT_OVER_HOURS) {
      return this.rejectServiceUserVisitOverHours(userId, row, notes, meta);
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
    {
      // Only the visits over the hours come off the carer: the held-back ones, plus — latest
      // first — plan visits they already have, until each week fits. The rejected request keeps
      // them (they stay off the carer and are not counted again). A weekday taken off every
      // week it happens is taken off the carer in the plan.
      const { offKeys, count } = await this.planRejectOffKeys(row, visitPlanId, employeeId);
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
      newValues: { status: 'REJECTED', employeeId: row.employeeId },
      metadata: { serviceUserId: row.serviceUserId, visitPlanId: row.visitPlanId },
      ...meta,
    });
    void this.notificationHook.notifyRequesterDecided({
      approvalId: row.id,
      requestedById: row.requestedById,
      decidedById: userId,
      approved: false,
      title: 'Carer weekly hours rejected',
      message: `The carer stays off the visits over their weekly hours: ${notes.trim()}.`,
      href: row.serviceUserId ? `/service-users/${row.serviceUserId}/visit-plan` : undefined,
    });
    return {
      message: 'Extra hours rejected — the carer stays off the visits over their hours',
      data: { id },
    };
  }
}
