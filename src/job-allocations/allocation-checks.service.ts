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
import { AllocationWarningType } from './enums/allocation-warning-type.enum';
import {
  allocationRuleWarning,
  parseDomCareAllocationRules,
  type DomCareAllocationRule,
} from '../organisation-general-settings/dom-care-allocation-rules.util';
import { resolveAllocationWindow } from './allocation-window.util';
import {
  evaluateAllocationRuleHits,
  skillKeywordsForVisitPlanSlot,
  type AllocationRuleKey,
} from './allocation-rule-hits.util';
import { adjacentVisits, hmDifferenceMinutes } from './allocation-job-rules.util';
import { AllocationComplianceService } from '../employee-compliance/allocation-compliance.service';
import { formatComplianceAllocationMessages } from '../employee-compliance/allocation-compliance.util';
import { dayKeyInTimeZone, getOperationalTimeZone } from '../common/utils/operational-day.util';
import { weekdayIndexInTimeZone } from '../scheduling/schedule-date-range.util';
import { CarerWeeklyHoursService, carerOverMaxMessage } from '../employee-hours-approvals/carer-weekly-hours.service';

export type AllocationWarningSeverity = 'blocking' | 'warning' | 'info';

export type AllocationWarning = {
  type: AllocationWarningType;
  message: string;
  severity: AllocationWarningSeverity;
  /** Set when an allocation rule in Settings is "Don't allow": cannot be forced. */
  hardBlock?: boolean;
};

const RULE_WARNING_TYPE: Record<AllocationRuleKey, AllocationWarningType> = {
  carer_on_holiday: AllocationWarningType.EMPLOYEE_ON_HOLIDAY,
  carer_on_nca: AllocationWarningType.EMPLOYEE_ON_NCA,
  carer_on_leave: AllocationWarningType.EMPLOYEE_ON_LEAVE,
  allow_overlap: AllocationWarningType.TIME_CONFLICT,
  time_between_jobs: AllocationWarningType.TRAVEL_TIME,
  medication_not_trained: AllocationWarningType.MEDICATION_NOT_TRAINED,
  missing_client_skills: AllocationWarningType.MISSING_SKILLS,
  job_outside_working_pattern: AllocationWarningType.EMPLOYEE_NOT_AVAILABLE,
};

export type AllocationCheckContext = {
  scheduledJobId: string;
  scheduledVisitId?: string | null;
  employeeId: string;
  serviceUserId: string;
  jobStart: Date;
  jobEnd: Date;
  jobMetadata?: Prisma.JsonValue;
  /** A manager already approved this carer over their weekly hours for this visit. */
  skipWeeklyHours?: boolean;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocationCompliance: AllocationComplianceService,
    private readonly carerHours: CarerWeeklyHoursService,
  ) {}

  /** Read fresh each time so changes in Settings apply without a restart. */
  private async loadAllocationRules(): Promise<DomCareAllocationRule[]> {
    const row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: ORG_SETTINGS_ID },
      select: { domCareAllocationRules: true },
    });
    return parseDomCareAllocationRules(
      row?.domCareAllocationRules as Parameters<typeof parseDomCareAllocationRules>[0],
    );
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

    await this.checkEmployeeAvailability(ctx, push, rules);
    await this.checkAllocationRules(ctx, push, rules);
    await this.checkJobContextRules(ctx, push, rules);
    if (!ctx.skipWeeklyHours) await this.checkCapacity(ctx, push);
    await this.checkPreferredBlockedCarer(ctx, push, rules);
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
        (w.hardBlock === true ||
          w.type === AllocationWarningType.TIME_CONFLICT ||
          w.type === AllocationWarningType.BLOCKED_CARER ||
          w.type === AllocationWarningType.COMPLIANCE_BLOCK ||
          // Over the weekly hours with Settings → Dom Rules on "Don't allow".
          w.type === AllocationWarningType.CAPACITY_EXCEEDED),
    );
  }

  async checkEmployeeAvailability(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
    rules: DomCareAllocationRule[],
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

    // "Job or jobs outside working pattern" rule decides warn / hard block / ignore.
    const patternRule = allocationRuleWarning(rules, 'job_outside_working_pattern');
    if (!patternRule.warn) return;
    const patternWarning = (message: string): AllocationWarning => ({
      type: AllocationWarningType.EMPLOYEE_NOT_AVAILABLE,
      message,
      severity: patternRule.severity,
      ...(patternRule.severity === 'blocking' ? { hardBlock: true } : {}),
    });

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
      push(patternWarning(`Employee is marked unavailable on ${dowLabel}`));
      return;
    }

    if (pattern && pattern.notes === 'partial') {
      push(patternWarning(`Employee has partial availability on ${dowLabel}`));
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
        push(patternWarning(message));
      }
    }
  }

  /** Settings-driven rules: leave, holiday, NCA, overlap, travel gap, medication, skills. */
  async checkAllocationRules(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
    rules: DomCareAllocationRule[],
  ): Promise<void> {
    const visit = await this.prisma.scheduledVisit.findFirst({
      where: ctx.scheduledVisitId
        ? { id: ctx.scheduledVisitId, deletedAt: null }
        : { scheduledJobId: ctx.scheduledJobId, deletedAt: null },
      select: { medicationRequired: true, visitPlanSlotId: true },
    });
    const skillKeywords = await skillKeywordsForVisitPlanSlot(this.prisma, visit?.visitPlanSlotId);
    const hits = await evaluateAllocationRuleHits(this.prisma, {
      employeeIds: [ctx.employeeId],
      jobStart: ctx.jobStart,
      jobEnd: ctx.jobEnd,
      rules,
      excludeScheduledJobId: ctx.scheduledJobId,
      medicationRequired: visit?.medicationRequired ?? false,
      skillKeywords,
      timeZone: await this.loadOperationalTimezone(),
    });
    for (const hit of hits.get(ctx.employeeId) ?? []) {
      push({
        type: RULE_WARNING_TYPE[hit.key],
        message: hit.message,
        severity: hit.block ? 'blocking' : 'warning',
        ...(hit.block ? { hardBlock: true } : {}),
      });
    }
  }

  /**
   * Carer over their contracted weekly hours (Monday–Sunday, + grace) with this visit —
   * Settings → Dom Rules "Carer over weekly hours": don't allow (hard block), request
   * confirmation (warning), manager approval (not allocated; a request goes to a manager) or
   * always allow.
   */
  async checkCapacity(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
  ): Promise<void> {
    const rule = await this.carerHours.rule();
    const check = await this.carerHours.checkNewVisits(this.prisma, ctx.employeeId, [
      { start: ctx.jobStart, end: ctx.jobEnd, serviceUserId: ctx.serviceUserId },
    ]);
    const week = check.weeks[0];
    const hours = (m: number) => `${Math.round((m / 60) * 10) / 10}h`;
    // Above the most weekly hours a manager can approve: never, whatever the setting.
    if (check.overMax.length) {
      push({
        type: AllocationWarningType.CAPACITY_EXCEEDED,
        message: `${carerOverMaxMessage(week?.minutes ?? 0, check.maxMinutes)}. Choose another carer`,
        severity: 'blocking',
        hardBlock: true,
      });
      return;
    }
    if (rule.behavior === 'ALWAYS_ALLOW') return;
    if (!check.over.length || check.limitMinutes == null) return;
    const base = `Over contracted weekly hours: that week would have ${hours(week?.minutes ?? 0)} of ${hours(check.limitMinutes)}`;
    if (rule.behavior === 'MANAGER_APPROVAL') {
      push({
        type: AllocationWarningType.CAPACITY_NEEDS_APPROVAL,
        message: `${base} — a manager must approve before the carer is put on this visit`,
        severity: 'info',
      });
    } else {
      push({
        type: AllocationWarningType.CAPACITY_EXCEEDED,
        message: base,
        severity: rule.behavior === 'DONT_ALLOW' ? 'blocking' : 'warning',
      });
    }
  }

  async checkPreferredBlockedCarer(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
    rules: DomCareAllocationRule[],
  ): Promise<void> {
    const suId = ctx.serviceUserId;
    // "Carer blocked with 1 SU on run or job allocated to" decides block / confirm / ignore.
    const blockedRule = allocationRuleWarning(rules, 'carer_blocked_su_on_run');
    const pushBlocked = (message: string) => {
      if (!blockedRule.warn) return;
      push({
        type: AllocationWarningType.BLOCKED_CARER,
        message,
        severity: blockedRule.severity,
        ...(blockedRule.severity === 'blocking' ? { hardBlock: true } : {}),
      });
    };

    const domCare = await this.prisma.serviceUserDomCare.findFirst({
      where: { serviceUserId: suId, deletedAt: null },
      include: {
        blockedCarerLinks: { where: { isActive: true } },
        preferredCarerLinks: { where: { isActive: true } },
      },
    });
    if (domCare?.blockedCarerLinks.some((l) => l.employeeId === ctx.employeeId)) {
      pushBlocked('Employee is blocked for this service user (domiciliary care)');
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
      pushBlocked('Employee is blocked for this service user (live-in profile)');
    }
    if (liveIn?.preferredCarers.some((l) => l.employeeId === ctx.employeeId)) {
      push({
        type: AllocationWarningType.PREFERRED_CARER_MATCH,
        message: 'Employee is a preferred carer (live-in profile)',
        severity: 'info',
      });
    }

    // Same rule for the other service users on this job's run.
    if (!blockedRule.warn) return;
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: ctx.scheduledJobId, deletedAt: null },
      select: { scheduleRunId: true },
    });
    if (!job?.scheduleRunId) return;
    const runJobs = await this.prisma.scheduledJob.findMany({
      where: {
        scheduleRunId: job.scheduleRunId,
        deletedAt: null,
        isActive: true,
        serviceUserId: { not: suId },
      },
      select: { serviceUserId: true },
    });
    const runSuIds = [...new Set(runJobs.map((j) => j.serviceUserId))];
    if (!runSuIds.length) return;
    const [domBlocked, liveInBlocked] = await Promise.all([
      this.prisma.serviceUserDomCare.findFirst({
        where: {
          serviceUserId: { in: runSuIds },
          deletedAt: null,
          blockedCarerLinks: { some: { employeeId: ctx.employeeId, isActive: true } },
        },
        select: { id: true },
      }),
      this.prisma.serviceUserLiveInProfile.findFirst({
        where: {
          serviceUserId: { in: runSuIds },
          deletedAt: null,
          blockedCarers: { some: { employeeId: ctx.employeeId } },
        },
        select: { id: true },
      }),
    ]);
    if (domBlocked || liveInBlocked) {
      pushBlocked('Employee is blocked for another service user on this run');
    }
  }

  /** Settings-driven rules that need the job itself: visit time tolerance, other run, zone change. */
  async checkJobContextRules(
    ctx: AllocationCheckContext,
    push: (w: AllocationWarning) => void,
    rules: DomCareAllocationRule[],
  ): Promise<void> {
    const ruleWarning = (type: AllocationWarningType, key: string, message: string) => {
      const rule = allocationRuleWarning(rules, key);
      if (!rule.warn) return;
      push({
        type,
        message,
        severity: rule.severity,
        ...(rule.severity === 'blocking' ? { hardBlock: true } : {}),
      });
    };
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: ctx.scheduledJobId, deletedAt: null },
      select: {
        scheduledStartDateTime: true,
        scheduleRunId: true,
        scheduleRun: { select: { runDate: true } },
        scheduleArea: { select: { zoneId: true, zone: { select: { name: true } } } },
      },
    });
    if (!job) return;

    // Visit Time Tolerance: carer's start vs the client's planned visit time.
    if (allocationRuleWarning(rules, 'visit_time_tolerance').warn) {
      const visit = await this.prisma.scheduledVisit.findFirst({
        where: ctx.scheduledVisitId
          ? { id: ctx.scheduledVisitId, deletedAt: null }
          : { scheduledJobId: ctx.scheduledJobId, deletedAt: null },
        select: { visitPlanSlot: { select: { plannedStartTime: true, timeToleranceMinutes: true } } },
      });
      const slot = visit?.visitPlanSlot;
      let toleranceMinutes = slot?.timeToleranceMinutes;
      if (toleranceMinutes == null) {
        const settings = await this.prisma.organisationGeneralSettings.findUnique({
          where: { id: ORG_SETTINGS_ID },
          select: { domGlobalToleranceMinutes: true },
        });
        toleranceMinutes = settings?.domGlobalToleranceMinutes ?? 30;
      }
      const timeZone = await this.loadOperationalTimezone();
      const plannedHm = slot?.plannedStartTime ?? hmFromJobDate(job.scheduledStartDateTime, timeZone);
      const diff = hmDifferenceMinutes(plannedHm, hmFromJobDate(ctx.jobStart, timeZone));
      if (diff != null && diff > toleranceMinutes) {
        ruleWarning(
          AllocationWarningType.VISIT_TIME_TOLERANCE,
          'visit_time_tolerance',
          `Visit starts ${diff} min from the planned time ${plannedHm} (tolerance ${toleranceMinutes} min)`,
        );
      }
    }

    // Carer allocated to another run on the same day.
    if (
      job.scheduleRunId &&
      job.scheduleRun &&
      allocationRuleWarning(rules, 'carer_allocated_another_run').warn
    ) {
      const otherRun = { runDate: job.scheduleRun.runDate, id: { not: job.scheduleRunId }, deletedAt: null };
      const ownRun = await this.prisma.scheduleRun.findFirst({
        where: { ...otherRun, employeeId: ctx.employeeId, isActive: true },
        select: { name: true },
      });
      const viaJob = ownRun
        ? null
        : await this.prisma.jobAllocation.findFirst({
            where: {
              employeeId: ctx.employeeId,
              deletedAt: null,
              isActive: true,
              status: { in: [...ACTIVE_ALLOCATION_STATUSES] },
              scheduledJob: { deletedAt: null, isActive: true, scheduleRun: { is: otherRun } },
            },
            select: { scheduledJob: { select: { scheduleRun: { select: { name: true } } } } },
          });
      const runName = ownRun?.name ?? viaJob?.scheduledJob.scheduleRun?.name;
      if (runName) {
        ruleWarning(
          AllocationWarningType.ANOTHER_RUN,
          'carer_allocated_another_run',
          `Employee is already on another run (${runName}) on this day`,
        );
      }
    }

    // Visit change across zones: the carer's previous / next visit is in a different zone.
    const zoneId = job.scheduleArea?.zoneId;
    if (zoneId && allocationRuleWarning(rules, 'visit_change_across_zones').warn) {
      const rows = await this.prisma.jobAllocation.findMany({
        where: {
          employeeId: ctx.employeeId,
          deletedAt: null,
          isActive: true,
          status: { in: [...ACTIVE_ALLOCATION_STATUSES] },
          scheduledJobId: { not: ctx.scheduledJobId },
          scheduledJob: {
            deletedAt: null,
            isActive: true,
            scheduledStartDateTime: {
              gte: new Date(ctx.jobStart.getTime() - 24 * 3_600_000),
              lt: new Date(ctx.jobEnd.getTime() + 24 * 3_600_000),
            },
          },
        },
        select: {
          scheduledStartDateTime: true,
          scheduledEndDateTime: true,
          durationMinutes: true,
          scheduledJob: {
            select: {
              scheduledStartDateTime: true,
              scheduledEndDateTime: true,
              estimatedDurationMinutes: true,
              scheduleArea: { select: { zoneId: true, zone: { select: { name: true } } } },
            },
          },
        },
      });
      const visits = rows.map((r) => ({
        ...resolveAllocationWindow(r, r.scheduledJob),
        zoneId: r.scheduledJob.scheduleArea?.zoneId ?? null,
        zoneName: r.scheduledJob.scheduleArea?.zone?.name ?? null,
      }));
      const { previous, next } = adjacentVisits(visits, ctx.jobStart, ctx.jobEnd);
      const crossing = [previous, next].find((v) => v?.zoneId && v.zoneId !== zoneId);
      if (crossing) {
        const here = job.scheduleArea?.zone?.name ?? 'this zone';
        ruleWarning(
          AllocationWarningType.ZONE_CHANGE,
          'visit_change_across_zones',
          `Carer's ${crossing === previous ? 'previous' : 'next'} visit is in ${crossing.zoneName ?? 'another zone'}; this visit is in ${here}`,
        );
      }
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
    // Judge expiry on the visit date (not today) so documents lapsing before the visit count.
    const asOf = new Date(Math.max(Date.now(), ctx.jobStart.getTime()));
    const result = await this.allocationCompliance.evaluateForEmployee(ctx.employeeId, asOf);
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
