import { Injectable } from '@nestjs/common';
import { DayOfWeek, EmployeeComplianceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { timeWindowsOverlap } from '../service-user-visit-plans/visit-plan-carer-suggest.util';
import { AllocationWarningType } from './enums/allocation-warning-type.enum';

export type AllocationWarningSeverity = 'blocking' | 'warning' | 'info';

export type AllocationWarning = {
  type: AllocationWarningType;
  message: string;
  severity: AllocationWarningSeverity;
};

export type AllocationCheckContext = {
  scheduledJobId: string;
  scheduledVisitId?: string | null;
  employeeId: string;
  serviceUserId: string;
  jobStart: Date;
  jobEnd: Date;
  jobMetadata?: Prisma.JsonValue;
};

const ACTIVE_ALLOCATION_STATUSES = ['PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED'] as const;

const DAY_MAP: Record<number, DayOfWeek> = {
  0: DayOfWeek.SUNDAY,
  1: DayOfWeek.MONDAY,
  2: DayOfWeek.TUESDAY,
  3: DayOfWeek.WEDNESDAY,
  4: DayOfWeek.THURSDAY,
  5: DayOfWeek.FRIDAY,
  6: DayOfWeek.SATURDAY,
};

@Injectable()
export class AllocationChecksService {
  constructor(private readonly prisma: PrismaService) {}

  async runAllChecks(ctx: AllocationCheckContext): Promise<AllocationWarning[]> {
    const results: AllocationWarning[] = [];
    const push = (w: AllocationWarning) => results.push(w);

    await this.checkEmployeeAvailability(ctx, push);
    await this.checkTimeConflict(ctx, push);
    await this.checkCapacity(ctx, push);
    await this.checkPreferredBlockedCarer(ctx, push);
    await this.checkRoleMismatch(ctx, push);
    await this.checkCompliance(ctx, push);

    return results;
  }

  hasBlockingWarnings(warnings: AllocationWarning[]): boolean {
    return warnings.some((w) => w.severity === 'blocking');
  }

  async checkEmployeeAvailability(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
  ): Promise<void> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: ctx.employeeId, deletedAt: null, isActive: true },
      include: {
        personalDetail: true,
        employment: true,
        workingPatterns: { where: { deletedAt: null, isActive: true } },
      },
    });
    if (!employee) {
      push({
        type: AllocationWarningType.EMPLOYEE_NOT_AVAILABLE,
        message: 'Employee not found or inactive',
        severity: 'blocking',
      });
      return;
    }
    if (!employee.personalDetail || employee.personalDetail.deletedAt) {
      push({
        type: AllocationWarningType.EMPLOYEE_NOT_AVAILABLE,
        message: 'Employee has no active personal details',
        severity: 'blocking',
      });
    }
    if (!employee.employment || employee.employment.deletedAt) {
      push({
        type: AllocationWarningType.EMPLOYEE_NOT_AVAILABLE,
        message: 'Employee has no active employment record',
        severity: 'warning',
      });
    }
    const dow = DAY_MAP[ctx.jobStart.getUTCDay()];
    const pattern = employee.workingPatterns.find((p) => p.dayOfWeek === dow);
    if (pattern && !pattern.isAvailable) {
      push({
        type: AllocationWarningType.EMPLOYEE_NOT_AVAILABLE,
        message: `Employee is marked unavailable on ${dow}`,
        severity: 'warning',
      });
    } else if (pattern?.isAvailable && pattern.startTime && pattern.endTime) {
      const pad = (n: number) => String(n).padStart(2, '0');
      const jobStartHm = `${pad(ctx.jobStart.getUTCHours())}:${pad(ctx.jobStart.getUTCMinutes())}`;
      const jobEndHm = `${pad(ctx.jobEnd.getUTCHours())}:${pad(ctx.jobEnd.getUTCMinutes())}`;
      if (!timeWindowsOverlap(jobStartHm, jobEndHm, pattern.startTime, pattern.endTime)) {
        push({
          type: AllocationWarningType.EMPLOYEE_NOT_AVAILABLE,
          message: `Visit is outside employee working hours (${pattern.startTime}–${pattern.endTime})`,
          severity: 'warning',
        });
      }
    }
  }

  async checkTimeConflict(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
  ): Promise<void> {
    const overlapping = await this.prisma.jobAllocation.findMany({
      where: {
        employeeId: ctx.employeeId,
        deletedAt: null,
        isActive: true,
        status: { in: [...ACTIVE_ALLOCATION_STATUSES] },
        scheduledJobId: { not: ctx.scheduledJobId },
        scheduledJob: {
          deletedAt: null,
          isActive: true,
          AND: [
            { scheduledStartDateTime: { lt: ctx.jobEnd } },
            {
              OR: [
                { scheduledEndDateTime: { gt: ctx.jobStart } },
                { scheduledEndDateTime: null },
              ],
            },
          ],
        },
      },
      include: { scheduledJob: { select: { id: true, jobName: true, scheduledStartDateTime: true } } },
      take: 5,
    });
    if (overlapping.length) {
      const names = overlapping.map((o) => o.scheduledJob.jobName).join(', ');
      push({
        type: AllocationWarningType.TIME_CONFLICT,
        message: `Employee already allocated to overlapping job(s): ${names}`,
        severity: 'blocking',
      });
    }
  }

  async checkCapacity(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
  ): Promise<void> {
    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId: ctx.employeeId, deletedAt: null },
    });
    const maxWeekly = employment?.maximumWeeklyHours ?? employment?.contractedWeeklyHours;
    if (!maxWeekly || maxWeekly <= 0) return;

    const weekStart = new Date(ctx.jobStart);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    weekStart.setUTCHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    const allocations = await this.prisma.jobAllocation.findMany({
      where: {
        employeeId: ctx.employeeId,
        deletedAt: null,
        isActive: true,
        status: { in: [...ACTIVE_ALLOCATION_STATUSES] },
        scheduledJob: {
          deletedAt: null,
          scheduledStartDateTime: { gte: weekStart, lt: weekEnd },
        },
      },
      include: {
        scheduledJob: {
          select: {
            scheduledStartDateTime: true,
            scheduledEndDateTime: true,
            estimatedDurationMinutes: true,
          },
        },
      },
    });

    let totalHours = 0;
    for (const a of allocations) {
      const j = a.scheduledJob;
      const end = j.scheduledEndDateTime ?? new Date(j.scheduledStartDateTime.getTime() + (j.estimatedDurationMinutes ?? 60) * 60_000);
      totalHours += (end.getTime() - j.scheduledStartDateTime.getTime()) / 3_600_000;
    }
    const jobHours =
      (ctx.jobEnd.getTime() - ctx.jobStart.getTime()) / 3_600_000 || 1;
    if (totalHours + jobHours > maxWeekly) {
      push({
        type: AllocationWarningType.CAPACITY_EXCEEDED,
        message: `Allocating would exceed maximum weekly hours (${maxWeekly}h); estimated ${(totalHours + jobHours).toFixed(1)}h`,
        severity: 'warning',
      });
    }
  }

  async checkPreferredBlockedCarer(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
  ): Promise<void> {
    const suId = ctx.serviceUserId;

    const domCare = await this.prisma.serviceUserDomCare.findFirst({
      where: { serviceUserId: suId, deletedAt: null },
      include: {
        blockedCarerLinks: { where: { isActive: true } },
        preferredCarerLinks: { where: { isActive: true } },
      },
    });
    if (domCare?.blockedCarerLinks.some((l) => l.employeeId === ctx.employeeId)) {
      push({
        type: AllocationWarningType.BLOCKED_CARER,
        message: 'Employee is blocked for this service user (domiciliary care)',
        severity: 'blocking',
      });
    }
    if (domCare?.preferredCarerLinks.some((l) => l.employeeId === ctx.employeeId)) {
      push({
        type: AllocationWarningType.PREFERRED_CARER_MATCH,
        message: 'Employee is a preferred carer for this service user',
        severity: 'info',
      });
    }

    const liveIn = await this.prisma.serviceUserLiveInProfile.findFirst({
      where: { serviceUserId: suId, deletedAt: null },
      include: {
        blockedCarers: true,
        preferredCarers: true,
      },
    });
    if (liveIn?.blockedCarers.some((l) => l.employeeId === ctx.employeeId)) {
      push({
        type: AllocationWarningType.BLOCKED_CARER,
        message: 'Employee is blocked for this service user (live-in profile)',
        severity: 'blocking',
      });
    }
    if (liveIn?.preferredCarers.some((l) => l.employeeId === ctx.employeeId)) {
      push({
        type: AllocationWarningType.PREFERRED_CARER_MATCH,
        message: 'Employee is a preferred carer (live-in profile)',
        severity: 'info',
      });
    }
  }

  async checkRoleMismatch(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
  ): Promise<void> {
    const meta = ctx.jobMetadata as Record<string, unknown> | null | undefined;
    const requiredRoleId = meta?.requiredRoleId as string | undefined;
    if (!requiredRoleId) return;

    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId: ctx.employeeId, deletedAt: null },
      include: { role: true },
    });
    if (employment?.roleId !== requiredRoleId) {
      push({
        type: AllocationWarningType.ROLE_MISMATCH,
        message: `Employee role does not match job requirement (${employment?.role?.name ?? 'unknown'})`,
        severity: 'warning',
      });
    }
  }

  async checkCompliance(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
  ): Promise<void> {
    const issues = await this.prisma.employeeCompliance.count({
      where: {
        employeeId: ctx.employeeId,
        deletedAt: null,
        status: {
          in: [
            EmployeeComplianceStatus.EXPIRED,
            EmployeeComplianceStatus.MISSING,
            EmployeeComplianceStatus.REJECTED,
            EmployeeComplianceStatus.EXPIRING_SOON,
          ],
        },
      },
    });
    if (issues > 0) {
      push({
        type: AllocationWarningType.COMPLIANCE_WARNING,
        message: `Employee has ${issues} compliance item(s) requiring attention`,
        severity: 'warning',
      });
    }
  }
}
