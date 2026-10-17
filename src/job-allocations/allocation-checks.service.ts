import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  employmentToCycleConfig,
  resolvePatternForDateTime,
  type WorkingPatternRow,
} from '../employee-working-patterns/working-pattern-cycle.util';
import {
  hmFromJobDate,
  visitTimeFitsWithinPattern,
  visitPatternTimeMismatch,
  formatVisitPatternTimeMismatchMessage,
} from '../employee-working-patterns/working-pattern-time.util';
import { CARER_ROTA_CONFLICT_MESSAGE } from '../service-user-visit-plans/visit-carer-rota-conflict.util';
import { AllocationWarningType } from './enums/allocation-warning-type.enum';
import {
  PARENTAL_LEAVE_TYPES,
  ROTA_BLOCKING_LEAVE_TYPES,
} from '../employee-absences/dto/employee-absence.dto';
import {
  allocationRuleWarning,
  parseDomCareAllocationRules,
  type DomCareAllocationRule,
} from '../organisation-general-settings/dom-care-allocation-rules.util';
import {
  intervalsOverlap,
  resolveAllocationWindow,
} from './allocation-window.util';
import { AllocationComplianceService } from '../employee-compliance/allocation-compliance.service';
import { formatComplianceAllocationMessages } from '../employee-compliance/allocation-compliance.util';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
  getOperationalTimeZone,
  operationalDayBounds,
} from '../common/utils/operational-day.util';
import { weekdayIndexInTimeZone } from '../scheduling/schedule-date-range.util';

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

const DAY_LABEL: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

const ORG_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';

@Injectable()
export class AllocationChecksService {
  private allocationRulesCache: DomCareAllocationRule[] | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly allocationCompliance: AllocationComplianceService,
  ) {}

  private async loadAllocationRules(): Promise<DomCareAllocationRule[]> {
    if (this.allocationRulesCache) return this.allocationRulesCache;
    const row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: ORG_SETTINGS_ID },
      select: { domCareAllocationRules: true },
    });
    this.allocationRulesCache = parseDomCareAllocationRules(
      row?.domCareAllocationRules as Parameters<typeof parseDomCareAllocationRules>[0],
    );
    return this.allocationRulesCache;
  }

  /** Organisation operational timezone (not cached — settings can change at runtime). */
  private async loadOperationalTimezone(): Promise<string> {
    const row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: ORG_SETTINGS_ID },
      select: { timezone: true },
    });
    return getOperationalTimeZone(row?.timezone);
  }

  async runAllChecks(ctx: AllocationCheckContext): Promise<AllocationWarning[]> {
    const results: AllocationWarning[] = [];
    const push = (w: AllocationWarning) => results.push(w);
    const rules = await this.loadAllocationRules();

    await this.checkEmployeeAvailability(ctx, push);
    await this.checkEmployeeHoliday(ctx, push, rules);
    await this.checkEmployeeParentalLeave(ctx, push);
    await this.checkEmployeeNca(ctx, push, rules);
    await this.checkEmployeeOnLeave(ctx, push);
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

  /** Blocking warnings that must never be bypassed with force=true (e.g. rota double-booking). */
  hasNonOverridableBlockingWarnings(warnings: AllocationWarning[]): boolean {
    return warnings.some(
      (w) =>
        w.severity === 'blocking' &&
        (w.type === AllocationWarningType.TIME_CONFLICT ||
          w.type === AllocationWarningType.BLOCKED_CARER ||
          w.type === AllocationWarningType.COMPLIANCE_BLOCK),
    );
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
      return;
    }
    const inactiveStatus = await this.prisma.employeeStatus.findFirst({
      where: { deletedAt: null, name: { equals: 'Inactive', mode: 'insensitive' } },
      select: { id: true },
    });
    if (
      inactiveStatus &&
      employee.personalDetail.statusId === inactiveStatus.id
    ) {
      push({
        type: AllocationWarningType.EMPLOYEE_NOT_AVAILABLE,
        message: 'Employee status is inactive',
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

    const patternRows: WorkingPatternRow[] = employee.workingPatterns.map((p) => ({
      weekInCycle: p.weekInCycle,
      dayOfWeek: p.dayOfWeek,
      startTime: p.startTime,
      endTime: p.endTime,
      isAvailable: p.isAvailable,
      notes: p.notes,
    }));
    const cycleConfig = employmentToCycleConfig(employee.employment, employee.createdAt);
    const timeZone = await this.loadOperationalTimezone();
    const pattern = resolvePatternForDateTime(patternRows, cycleConfig, ctx.jobStart, timeZone);
    const dowLabel = DAY_LABEL[weekdayIndexInTimeZone(ctx.jobStart, timeZone)] ?? 'this day';

    if (pattern && !pattern.isAvailable) {
      push({
        type: AllocationWarningType.EMPLOYEE_NOT_AVAILABLE,
        message: `Employee is marked unavailable on ${dowLabel}`,
        severity: 'warning',
      });
      return;
    }

    if (pattern && pattern.notes === 'partial') {
      push({
        type: AllocationWarningType.EMPLOYEE_NOT_AVAILABLE,
        message: `Employee has partial availability on ${dowLabel}`,
        severity: 'warning',
      });
      return;
    }

    if (pattern) {
      const jobStartHm = hmFromJobDate(ctx.jobStart, timeZone);
      const jobEndHm = hmFromJobDate(ctx.jobEnd, timeZone);
      if (
        !visitTimeFitsWithinPattern(jobStartHm, jobEndHm, pattern.startTime, pattern.endTime)
      ) {
        const mismatch = visitPatternTimeMismatch(
          jobStartHm,
          jobEndHm,
          pattern.startTime,
          pattern.endTime,
        );
        const message =
          mismatch && pattern.startTime && pattern.endTime
            ? formatVisitPatternTimeMismatchMessage(
                dowLabel,
                mismatch,
                pattern.startTime,
                pattern.endTime,
              )
            : 'Visit is outside employee working hours';
        push({
          type: AllocationWarningType.EMPLOYEE_NOT_AVAILABLE,
          message,
          severity: 'warning',
        });
      }
    }
  }

  async checkEmployeeHoliday(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
    rules: DomCareAllocationRule[],
  ): Promise<void> {
    const rule = allocationRuleWarning(rules, 'carer_on_holiday');
    if (!rule.warn) return;

    // Holiday dates are calendar labels; compare against the visit's org-local calendar day.
    const timeZone = await this.loadOperationalTimezone();
    const jobDay = new Date(`${dayKeyInTimeZone(ctx.jobStart, timeZone)}T12:00:00.000Z`);
    const holiday = await this.prisma.employeeHoliday.findFirst({
      where: {
        employeeId: ctx.employeeId,
        deletedAt: null,
        isActive: true,
        startDate: { lte: jobDay },
        endDate: { gte: jobDay },
      },
    });
    if (!holiday) return;
    push({
      type: AllocationWarningType.EMPLOYEE_ON_HOLIDAY,
      message: 'Employee is on holiday for this visit date',
      severity: rule.severity,
    });
  }

  /** Block allocating a carer who has approved maternity/paternity leave over the visit. */
  async checkEmployeeParentalLeave(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
  ): Promise<void> {
    const leave = await this.prisma.employeeAbsenceRecord.findFirst({
      where: {
        employeeId: ctx.employeeId,
        deletedAt: null,
        absenceType: { in: [...PARENTAL_LEAVE_TYPES] },
        permissionStatus: 'Authorised',
        fromDateTime: { lte: ctx.jobEnd },
        toDateTime: { gte: ctx.jobStart },
      },
      select: { absenceType: true },
    });
    if (!leave) return;
    push({
      type: AllocationWarningType.EMPLOYEE_ON_PARENTAL_LEAVE,
      message: `Employee is on ${leave.absenceType.toLowerCase()} leave for this visit date`,
      severity: 'blocking',
    });
  }

  async checkEmployeeNca(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
    rules: DomCareAllocationRule[],
  ): Promise<void> {
    const rule = allocationRuleWarning(rules, 'carer_on_nca');
    if (!rule.warn) return;

    const nca = await this.prisma.employeeNonCoreActivity.findFirst({
      where: {
        employeeId: ctx.employeeId,
        deletedAt: null,
        isActive: true,
        dateFrom: { lte: ctx.jobEnd },
        dateTo: { gte: ctx.jobStart },
      },
    });
    if (!nca) return;
    push({
      type: AllocationWarningType.EMPLOYEE_ON_NCA,
      message: 'Employee has non-core activity during this visit',
      severity: rule.severity,
    });
  }

  /** Block allocating a carer who is on sick or casual leave over the visit date. */
  async checkEmployeeOnLeave(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
  ): Promise<void> {
    const leave = await this.prisma.employeeAbsenceRecord.findFirst({
      where: {
        employeeId: ctx.employeeId,
        deletedAt: null,
        absenceType: { in: [...ROTA_BLOCKING_LEAVE_TYPES] },
        fromDateTime: { lte: ctx.jobEnd },
        toDateTime: { gte: ctx.jobStart },
      },
      select: { absenceType: true },
    });
    if (!leave) return;
    const message =
      leave.absenceType === 'Sickness'
        ? 'Employee is off sick for this visit date'
        : 'Employee is on casual leave for this visit date';
    push({
      type: AllocationWarningType.EMPLOYEE_ON_LEAVE,
      message,
      severity: 'blocking',
    });
  }

  async checkTimeConflict(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
  ): Promise<void> {
    // Broad job-window query, then filter by each allocation's resolved timing
    // so staggered multi-carer visits do not falsely block.
    const candidates = await this.prisma.jobAllocation.findMany({
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
      include: {
        scheduledJob: {
          select: {
            id: true,
            jobName: true,
            scheduledStartDateTime: true,
            scheduledEndDateTime: true,
            estimatedDurationMinutes: true,
          },
        },
      },
      take: 20,
    });

    const overlapping = candidates.filter((row) => {
      const other = resolveAllocationWindow(row, row.scheduledJob);
      return intervalsOverlap(ctx.jobStart, ctx.jobEnd, other.start, other.end);
    });

    if (overlapping.length) {
      push({
        type: AllocationWarningType.TIME_CONFLICT,
        message: CARER_ROTA_CONFLICT_MESSAGE,
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

    // Sunday-start week of the visit's org-local calendar day, as true-UTC bounds.
    const timeZone = await this.loadOperationalTimezone();
    const jobDayKey = dayKeyInTimeZone(ctx.jobStart, timeZone);
    const weekStartKey = addDaysToOperationalIso(
      jobDayKey,
      -weekdayIndexInTimeZone(ctx.jobStart, timeZone),
    );
    const weekStart = operationalDayBounds(weekStartKey, timeZone).start;
    const weekEnd = operationalDayBounds(addDaysToOperationalIso(weekStartKey, 7), timeZone).start;

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
      const window = resolveAllocationWindow(a, a.scheduledJob);
      totalHours += (window.end.getTime() - window.start.getTime()) / 3_600_000;
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
    const result = await this.allocationCompliance.evaluateForEmployee(ctx.employeeId);
    const messages = formatComplianceAllocationMessages(result);
    if (result.blocksAllocation && messages.block) {
      push({
        type: AllocationWarningType.COMPLIANCE_BLOCK,
        message: messages.block,
        severity: 'blocking',
      });
    }
    if (messages.warn) {
      push({
        type: AllocationWarningType.COMPLIANCE_WARNING,
        message: messages.warn,
        severity: 'warning',
      });
    }
  }
}
