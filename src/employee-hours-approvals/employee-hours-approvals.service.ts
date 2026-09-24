import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AllocationStatus, EmployeeHoursApprovalStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { deriveDurationFromTimes } from '../service-user-visit-plans/visit-plan-slot-window.util';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Hard weekly cap — extra hours pushing a carer above this can never be approved. */
export const MAX_APPROVABLE_WEEKLY_HOURS = 60;

@Injectable()
export class EmployeeHoursApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

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
    return new Set(rows.map((r) => r.employeeId));
  }

  async list(status?: EmployeeHoursApprovalStatus) {
    const rows = await this.prisma.employeeHoursApproval.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
    });

    const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
    const serviceUserIds = [...new Set(rows.map((r) => r.serviceUserId))];
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

    return {
      message: 'Employee hours approvals',
      data: rows.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        employeeName: empName.get(r.employeeId) ?? r.employeeId,
        serviceUserId: r.serviceUserId,
        serviceUserName: suName.get(r.serviceUserId) ?? r.serviceUserId,
        visitPlanId: r.visitPlanId,
        status: r.status,
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
        where: { employeeId: row.employeeId, visitPlanSlot: { visitPlanId: row.visitPlanId } },
      });
      const slots = await tx.visitPlanSlot.findMany({
        where: { visitPlanId: row.visitPlanId },
        select: { id: true, assignedEmployeeIds: true },
      });
      for (const s of slots) {
        if (s.assignedEmployeeIds.includes(row.employeeId)) {
          await tx.visitPlanSlot.update({
            where: { id: s.id },
            data: { assignedEmployeeIds: s.assignedEmployeeIds.filter((e) => e !== row.employeeId) },
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
              employeeId: row.employeeId,
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
