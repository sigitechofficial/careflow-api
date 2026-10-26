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
import { deriveDurationFromTimes } from '../service-user-visit-plans/visit-plan-slot-window.util';
import { CarerHoursReductionService } from './carer-hours-reduction.service';
import type { ContractedHoursImpact } from './carer-hours-reduction.service';
import { EmployeeHoursApprovalNotificationHook } from './employee-hours-approval-notification.hook';
import { EXTRA_VISIT_CREATOR, type ExtraVisitCreator } from './extra-visit-creator';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { formatOrganisationIsoDate } from '../common/utils/organisation-display-format.util';
import { ScheduleLifecycleNotificationHook } from '../schedule-lifecycle-impact/schedule-lifecycle-notification.hook';
import {
  currentServiceUserWeeklyHours,
  sameWeeklyHours,
  syncServiceUserWeeklyHours,
} from '../service-user-dom-care/service-user-weekly-hours-sync.util';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Hard weekly cap — extra hours pushing a carer above this can never be approved. */
export const MAX_APPROVABLE_WEEKLY_HOURS = 60;

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

  /** Approve: the extra visit is created now (no second hours check — the manager allowed it). */
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

  /** Reject: nothing is created. A reason is required so the requester knows why. */
  private async rejectExtraVisitOverHours(
    userId: string,
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    notes?: string,
    meta?: RequestAuditMeta,
  ) {
    if (row.status !== EmployeeHoursApprovalStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    const reason = notes?.trim();
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
      message: `Your extra visit on ${await this.extraVisitLabel(row)} was rejected: ${reason}`,
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
    return {
      message: 'Pending weekly hours change',
      data: {
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
    return { message: 'Sent for manager approval', data: { id: created.id } };
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
    return { message: 'Weekly hours change approved', data: updated };
  }

  private async requireEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
  }

  /**
   * Total weekly minutes a carer is assigned across in-progress visit plans
   * (ACTIVE + DRAFT) — DRAFT is included so hours count while a plan is still
   * being built, which is when carers get assigned.
   */
  private async assignedWeeklyMinutes(employeeIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!employeeIds.length) return map;
    const rows = await this.prisma.visitPlanSlotCarerAssignment.findMany({
      where: {
        employeeId: { in: employeeIds },
        visitPlanSlot: { isActive: true, visitPlan: { status: { in: ['ACTIVE', 'DRAFT'] } } },
      },
      select: {
        employeeId: true,
        dayOfWeek: true,
        durationMinutes: true,
        plannedStartTime: true,
        plannedEndTime: true,
        visitPlanSlot: {
          select: {
            daysOfWeek: true,
            plannedStartTime: true,
            plannedEndTime: true,
            durationMinutes: true,
            slotKind: true,
          },
        },
      },
    });
    for (const a of rows) {
      const slot = a.visitPlanSlot;
      const perDay =
        a.durationMinutes ??
        slot.durationMinutes ??
        deriveDurationFromTimes(
          a.plannedStartTime ?? slot.plannedStartTime,
          a.plannedEndTime ?? slot.plannedEndTime,
          slot.slotKind ?? undefined,
        );
      const days = a.dayOfWeek != null ? 1 : slot.daysOfWeek?.length ?? 0;
      map.set(a.employeeId, (map.get(a.employeeId) ?? 0) + perDay * days);
    }
    return map;
  }

  /**
   * After a plan is saved, ensure a PENDING approval exists for each carer whose
   * total assigned hours exceed their contracted weekly hours, and clear stale
   * PENDING ones for carers no longer over. Best-effort — never throws.
   */
  async reconcileForPlan(userId: string, serviceUserId: string, planId: string): Promise<void> {
    try {
      const assignments = await this.prisma.visitPlanSlotCarerAssignment.findMany({
        where: { visitPlanSlot: { visitPlanId: planId } },
        select: { employeeId: true },
      });
      const employeeIds = [...new Set(assignments.map((a) => a.employeeId))];
      if (!employeeIds.length) {
        // No carers left — clear any pending approvals for this plan.
        await this.prisma.employeeHoursApproval.deleteMany({
          where: { visitPlanId: planId, status: EmployeeHoursApprovalStatus.PENDING },
        });
        return;
      }

      const [assignedMinutes, employees, existing] = await Promise.all([
        this.assignedWeeklyMinutes(employeeIds),
        this.prisma.employee.findMany({
          where: { id: { in: employeeIds } },
          select: { id: true, employment: { select: { contractedWeeklyHours: true } } },
        }),
        this.prisma.employeeHoursApproval.findMany({
          where: { visitPlanId: planId, employeeId: { in: employeeIds } },
        }),
      ]);
      const contractedById = new Map(
        employees.map((e) => [e.id, e.employment?.contractedWeeklyHours ?? null]),
      );

      for (const employeeId of employeeIds) {
        const contracted = contractedById.get(employeeId) ?? null;
        const projected = round1((assignedMinutes.get(employeeId) ?? 0) / 60);
        const isOver = contracted != null && contracted > 0 && projected > contracted + 0.01;
        const rows = existing.filter((r) => r.employeeId === employeeId);
        const activeRow = rows.find(
          (r) =>
            r.status === EmployeeHoursApprovalStatus.PENDING ||
            r.status === EmployeeHoursApprovalStatus.APPROVED,
        );

        if (isOver) {
          if (activeRow) {
            // Keep APPROVED as-is; refresh the numbers on a still-PENDING row.
            if (activeRow.status === EmployeeHoursApprovalStatus.PENDING) {
              await this.prisma.employeeHoursApproval.update({
                where: { id: activeRow.id },
                data: {
                  projectedWeeklyHours: projected,
                  contractedWeeklyHours: contracted,
                  extraHours: round1(projected - (contracted ?? 0)),
                },
              });
            }
          } else {
            await this.prisma.employeeHoursApproval.create({
              data: {
                employeeId,
                serviceUserId,
                visitPlanId: planId,
                status: EmployeeHoursApprovalStatus.PENDING,
                contractedWeeklyHours: contracted,
                projectedWeeklyHours: projected,
                extraHours: round1(projected - (contracted ?? 0)),
                requestedById: userId,
              },
            });
          }
        } else {
          // No longer over — drop any stale PENDING request (leave decided history).
          const stale = rows.filter((r) => r.status === EmployeeHoursApprovalStatus.PENDING);
          if (stale.length) {
            await this.prisma.employeeHoursApproval.deleteMany({
              where: { id: { in: stale.map((r) => r.id) } },
            });
          }
        }
      }
    } catch {
      // Reconciliation is best-effort; a failure must not block the plan save.
    }
  }

  /** Employee ids with a PENDING hours approval for a plan (blocked from rostering). */
  async pendingEmployeeIdsForPlan(planId: string): Promise<Set<string>> {
    const rows = await this.prisma.employeeHoursApproval.findMany({
      where: { visitPlanId: planId, status: EmployeeHoursApprovalStatus.PENDING },
      select: { employeeId: true },
    });
    return new Set(rows.map((r) => r.employeeId).filter((id): id is string => Boolean(id)));
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
        reason: r.reason,
        contractedWeeklyHours: r.contractedWeeklyHours,
        projectedWeeklyHours: r.projectedWeeklyHours,
        extraHours: r.extraHours,
        requestedAt: r.requestedAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        decisionNotes: r.decisionNotes,
      })),
    };
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
    if ((row.projectedWeeklyHours ?? 0) > MAX_APPROVABLE_WEEKLY_HOURS) {
      throw new BadRequestException(
        `Cannot approve — ${round1(row.projectedWeeklyHours ?? 0)}h exceeds the ${MAX_APPROVABLE_WEEKLY_HOURS}h weekly maximum. Reduce this carer's assigned hours first, then re-check.`,
      );
    }
    const updated = await this.prisma.employeeHoursApproval.update({
      where: { id },
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
      recordId: id,
      newValues: { status: 'APPROVED', employeeId: row.employeeId },
      metadata: { serviceUserId: row.serviceUserId, visitPlanId: row.visitPlanId },
      ...meta,
    });
    return { message: 'Extra hours approved', data: updated };
  }

  /** Reject and remove the carer's assignments from the plan's slots. */
  async reject(userId: string, id: string, notes?: string, meta?: RequestAuditMeta) {
    const row = await this.requireApproval(id);
    if (row.requestType === EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS) {
      return this.rejectExtraVisitOverHours(userId, row, notes, meta);
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
      // Remove the carer from this plan's slots (assignment rows + legacy id array).
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
    return { message: 'Extra hours rejected — carer removed from plan', data: { id } };
  }
}
