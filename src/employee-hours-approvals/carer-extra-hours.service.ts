import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeExtraHoursPeriod,
  EmployeeHoursApprovalStatus,
  EmployeeHoursApprovalType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
  formatHmInTimeZone,
} from '../common/utils/operational-day.util';
import {
  formatOrganisationHm,
  formatOrganisationIsoDate,
} from '../common/utils/organisation-display-format.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  CarerWeeklyHoursService,
  carerMaxMinutes,
  carerNoContractedHoursError,
  carerOverMaxError,
  extraMinutesByWeek,
  mondayOf,
  overMaxAllowed,
  weeksTouched,
} from './carer-weekly-hours.service';
import { EmployeeHoursApprovalsService } from './employee-hours-approvals.service';
import { EmployeeHoursApprovalNotificationHook } from './employee-hours-approval-notification.hook';
import { allocationErrorReason } from '../job-allocations/job-allocations.service';
import type { GrantExtraWeeklyHoursDto } from './dto/grant-extra-weekly-hours.dto';
import { trackHoursRequest } from '../common/request-context/super-admin-context';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Carer requests the weekly limit decides (rota / extra / special visits and visit plans). */
const CARER_REQUEST_TYPES = [
  EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS,
  EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS,
];

/** What adding extra hours did to the carer's requests waiting for a manager. */
export type ExtraHoursOutcome = {
  approved: Array<{ approvalId: string; label: string }>;
  stillOver: Array<{
    approvalId: string;
    label: string;
    shortHours: number;
    weekStart: string;
  }>;
  failed: Array<{ approvalId: string; label: string; message: string }>;
};

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Extra weekly hours a manager gives a carer for a day, a week or a date range (Add extra
 * hours). Every Monday–Sunday week the dates touch gets the extra on top of the contracted
 * weekly hours, extras on the same week add up, and a week can never go above the most a
 * manager can approve (Settings → Dom Rules). Requests that fit once the extra is added are
 * approved straight away; the rest stay waiting.
 */
@Injectable()
export class CarerExtraHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly carerHours: CarerWeeklyHoursService,
    private readonly approvals: EmployeeHoursApprovalsService,
    private readonly notificationHook: EmployeeHoursApprovalNotificationHook,
  ) {}

  /** The carer's extra weekly hours, newest first (cancelled ones included, as the record). */
  async list(employeeId: string) {
    await this.requireEmployee(employeeId);
    const rows = await this.prisma.employeeExtraWeeklyHours.findMany({
      where: { employeeId },
      orderBy: [{ grantedAt: 'desc' }],
    });
    const userIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.grantedById, r.cancelledById])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const userName = new Map(
      users.map((u) => [
        u.id,
        `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || u.id,
      ]),
    );
    return {
      message: 'Extra weekly hours',
      data: rows.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        periodType: r.periodType,
        startDate: isoDay(r.startDate),
        endDate: isoDay(r.endDate),
        extraHours: r.extraHours,
        reason: r.reason,
        grantedById: r.grantedById,
        grantedByName: r.grantedById
          ? (userName.get(r.grantedById) ?? null)
          : null,
        grantedAt: r.grantedAt.toISOString(),
        outcome: r.outcome,
        cancelledById: r.cancelledById,
        cancelledByName: r.cancelledById
          ? (userName.get(r.cancelledById) ?? null)
          : null,
        cancelledAt: r.cancelledAt?.toISOString() ?? null,
        cancelReason: r.cancelReason,
      })),
    };
  }

  /**
   * The carer's extra-hours requests still waiting for a manager, or rejected, newest first.
   * Approved ones are not listed: they are the extra hours themselves (`list`).
   */
  async listRequests(employeeId: string) {
    await this.requireEmployee(employeeId);
    const rows = await this.prisma.employeeHoursApproval.findMany({
      where: {
        employeeId,
        requestType: EmployeeHoursApprovalType.EXTRA_WEEKLY_HOURS,
        status: {
          in: [
            EmployeeHoursApprovalStatus.PENDING,
            EmployeeHoursApprovalStatus.REJECTED,
          ],
        },
      },
      orderBy: [{ requestedAt: 'desc' }],
    });
    const userIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.requestedById, r.decidedById])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const userName = new Map(
      users.map((u) => [
        u.id,
        `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || u.id,
      ]),
    );
    return {
      message: 'Extra weekly hours requests',
      data: rows.map((r) => {
        const p = (r.requestPayload ?? {}) as Partial<
          GrantExtraWeeklyHoursDto & { periodStart: string; periodEnd: string }
        >;
        return {
          id: r.id,
          status: r.status,
          periodType: p.periodType ?? null,
          startDate: p.periodStart ?? p.startDate ?? null,
          endDate: p.periodEnd ?? p.endDate ?? p.startDate ?? null,
          extraHours: r.extraHours ?? p.extraHours ?? null,
          reason: r.reason,
          requestedByName: r.requestedById
            ? (userName.get(r.requestedById) ?? null)
            : null,
          requestedAt: r.requestedAt.toISOString(),
          decidedByName: r.decidedById
            ? (userName.get(r.decidedById) ?? null)
            : null,
          decidedAt: r.decidedAt?.toISOString() ?? null,
          decisionNotes: r.decisionNotes,
        };
      }),
    };
  }

  /**
   * What adding these extra hours would do, nothing saved: refused (above the weekly maximum),
   * or which waiting requests would be approved and which would still be over.
   */
  async preview(dto: GrantExtraWeeklyHoursDto) {
    const needsApproval = (await this.carerHours.rule()).extraHoursNeedApproval;
    let checked: Awaited<ReturnType<CarerExtraHoursService['checkGrant']>>;
    try {
      checked = await this.checkGrant(dto);
    } catch (err) {
      if (err instanceof BadRequestException) {
        return {
          message: 'Extra hours preview',
          data: {
            blockedMessage: err.message,
            needsApproval,
            overMaxWarning: null,
            willApprove: [],
            stillOver: [],
            wontApprove: [],
          },
        };
      }
      throw err;
    }
    const addMinutes = Math.round(dto.extraHours * 60);
    const added = new Map([
      [dto.employeeId, new Map(checked.weeks.map((w) => [w, addMinutes]))],
    ]);
    const display = await this.orgSettings.getOperationalDisplaySettings();
    const weekSet = new Set(checked.weeks);
    const willApprove: Array<{ approvalId: string; label: string }> = [];
    const stillOver: ExtraHoursOutcome['stillOver'] = [];
    const wontApprove: ExtraHoursOutcome['failed'] = [];
    for (const row of await this.waitingRequests(dto.employeeId)) {
      if (!this.requestWeeks(row).some((w) => weekSet.has(w))) continue;
      const label = await this.requestLabel(row, display);
      const now = await this.approvals.carerRequestShortMinutesNow(row, added);
      if (now && now.shortMinutes > 0) {
        stillOver.push({
          approvalId: row.id,
          label,
          shortHours: round1(now.shortMinutes / 60),
          weekStart: now.weekStart,
        });
        continue;
      }
      // Fits the hours: approving still runs the other rota checks (blocked carer, clash…).
      const reason = await this.approvals.rotaApprovalBlockedReason(row);
      if (reason)
        wontApprove.push({ approvalId: row.id, label, message: reason });
      else willApprove.push({ approvalId: row.id, label });
    }
    return {
      message: 'Extra hours preview',
      data: {
        blockedMessage: null,
        /** Settings → Dom Rules: the extra hours wait for a manager (nothing applies until approved). */
        needsApproval,
        overMaxWarning: checked.overMaxWarning,
        willApprove,
        stillOver,
        wontApprove,
      },
    };
  }

  /**
   * Give the carer extra weekly hours, then approve their requests that now fit. When Settings →
   * Dom Rules says extra hours need a manager's approval, a request goes to Hours approvals
   * instead and nothing applies until it is approved.
   */
  async grant(userId: string, dto: GrantExtraWeeklyHoursDto, meta?: RequestAuditMeta) {
    const checked = await this.checkGrant(dto);
    if ((await this.carerHours.rule()).extraHoursNeedApproval) {
      return this.requestApproval(userId, dto, checked, meta);
    }
    return this.applyGrant(userId, dto, checked, meta);
  }

  /** A manager approved extra hours waiting on Hours approvals: give them now (checked again). */
  async applyApprovedRequest(
    userId: string,
    approval: Prisma.EmployeeHoursApprovalGetPayload<object>,
    meta?: RequestAuditMeta,
  ) {
    const dto = (approval.requestPayload ?? {}) as unknown as GrantExtraWeeklyHoursDto;
    const checked = await this.checkGrant(dto);
    return this.applyGrant(userId, dto, checked, meta);
  }

  private async requestApproval(
    userId: string,
    dto: GrantExtraWeeklyHoursDto,
    checked: Awaited<ReturnType<CarerExtraHoursService['checkGrant']>>,
    meta?: RequestAuditMeta,
  ) {
    const display = await this.orgSettings.getOperationalDisplaySettings();
    const fmt = (iso: string) => formatOrganisationIsoDate(iso, display.dateDisplayFormat);
    const weekStarts =
      checked.periods.length > 1 ? checked.periods.map((p) => p.startDate) : undefined;
    const periodLabel = weekStarts
      ? `weeks of ${weekStarts.map(fmt).join(', ')}`
      : checked.startDate === checked.endDate
        ? fmt(checked.startDate)
        : `${fmt(checked.startDate)} – ${fmt(checked.endDate)}`;
    const row = await this.prisma.employeeHoursApproval.create({
      data: {
        requestType: EmployeeHoursApprovalType.EXTRA_WEEKLY_HOURS,
        employeeId: dto.employeeId,
        status: EmployeeHoursApprovalStatus.PENDING,
        requestedById: userId,
        contractedWeeklyHours: checked.contracted,
        projectedWeeklyHours: round1(checked.contracted + dto.extraHours),
        extraHours: dto.extraHours,
        reason: dto.reason?.trim() || null,
        requestPayload: {
          employeeId: dto.employeeId,
          periodType: dto.periodType,
          startDate: dto.startDate,
          ...(dto.endDate ? { endDate: dto.endDate } : {}),
          ...(weekStarts ? { weekStarts } : {}),
          extraHours: dto.extraHours,
          ...(dto.reason?.trim() ? { reason: dto.reason.trim() } : {}),
          periodStart: checked.startDate,
          periodEnd: checked.endDate,
          ...(checked.overMaxWarning ? { overMaxWarning: checked.overMaxWarning } : {}),
        } as Prisma.InputJsonValue,
      },
    });
    trackHoursRequest(row.id);
    await this.audit.logAudit({
      userId,
      module: AuditModule.EMPLOYEE,
      action: AuditAction.EMPLOYEE_EXTRA_WEEKLY_HOURS_REQUESTED,
      recordType: 'EmployeeHoursApproval',
      recordId: row.id,
      newValues: {
        employeeId: dto.employeeId,
        extraHours: dto.extraHours,
        startDate: checked.startDate,
        endDate: checked.endDate,
        ...(weekStarts ? { weekStarts } : {}),
      },
      ...meta,
    });
    void this.notificationHook.notifyExtraHoursRequested({
      approvalId: row.id,
      employeeId: dto.employeeId,
      extraHours: dto.extraHours,
      periodLabel,
      requestedById: userId,
    });
    return {
      message: `${round1(dto.extraHours)}h extra sent for manager approval — nothing changes until it is approved`,
      data: { id: row.id, sentForApproval: true, startDate: checked.startDate, endDate: checked.endDate, extraHours: dto.extraHours },
    };
  }

  private async applyGrant(
    userId: string,
    dto: GrantExtraWeeklyHoursDto,
    checked: Awaited<ReturnType<CarerExtraHoursService['checkGrant']>>,
    meta?: RequestAuditMeta,
  ) {
    const { startDate, endDate, periods, weeks, overMaxWarning } = checked;
    // One row per period (several weeks: one per week), so each week can be cancelled on its own.
    const rows = await this.prisma.$transaction(
      periods.map((p) =>
        this.prisma.employeeExtraWeeklyHours.create({
          data: {
            employeeId: dto.employeeId,
            periodType: dto.periodType,
            startDate: new Date(`${p.startDate}T00:00:00.000Z`),
            endDate: new Date(`${p.endDate}T00:00:00.000Z`),
            extraHours: dto.extraHours,
            reason: dto.reason?.trim() || null,
            grantedById: userId,
          },
        }),
      ),
    );
    for (const [i, row] of rows.entries()) {
      await this.audit.logAudit({
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_EXTRA_WEEKLY_HOURS_GRANTED,
        recordType: 'EmployeeExtraWeeklyHours',
        recordId: row.id,
        newValues: {
          employeeId: dto.employeeId,
          periodType: dto.periodType,
          startDate: periods[i].startDate,
          endDate: periods[i].endDate,
          extraHours: dto.extraHours,
          reason: row.reason,
          ...(overMaxWarning ? { aboveWeeklyMaximum: overMaxWarning } : {}),
        },
        ...meta,
      });
    }

    // Approved once all the weeks are raised: a request over two of them fits only then.
    const outcome = await this.approveRequestsThatFit(
      userId,
      dto.employeeId,
      weeks,
      meta,
    );
    await this.prisma.employeeExtraWeeklyHours.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { outcome: outcome as unknown as Prisma.InputJsonValue },
    });
    const parts = [
      `${round1(dto.extraHours)}h extra added${rows.length > 1 ? ` to each of ${rows.length} weeks` : ''}`,
    ];
    if (overMaxWarning) parts.push("above the carer's weekly maximum");
    if (outcome.approved.length)
      parts.push(`${outcome.approved.length} waiting request(s) approved`);
    if (outcome.stillOver.length)
      parts.push(`${outcome.stillOver.length} still over the hours`);
    if (outcome.failed.length)
      parts.push(`${outcome.failed.length} could not be approved`);
    return {
      message: parts.join(' — '),
      data: {
        id: rows[0].id,
        ids: rows.map((r) => r.id),
        startDate,
        endDate,
        extraHours: dto.extraHours,
        outcome,
      },
    };
  }

  /**
   * The dates and weeks, once the carer has contracted hours and no week goes above the carer's
   * maximum weekly hours (Employment; blank = 60h). Above it is refused — unless Settings → Dom
   * Rules allows going over the maximum: then it goes ahead with `overMaxWarning` set.
   */
  private async checkGrant(dto: GrantExtraWeeklyHoursDto) {
    await this.requireEmployee(dto.employeeId);
    const periods = this.periodDates(dto);
    const startDate = periods[0].startDate;
    const endDate = periods[periods.length - 1].endDate;
    const employment = await this.prisma.employeeEmployment.findUnique({
      where: { employeeId: dto.employeeId },
      select: { contractedWeeklyHours: true, maximumWeeklyHours: true },
    });
    const contracted = employment?.contractedWeeklyHours ?? null;
    if (contracted == null || contracted <= 0) throw carerNoContractedHoursError(dto.employeeId);

    // Every week the dates touch: contracted + extras already given + this one ≤ the maximum.
    const weeks = [
      ...new Set(periods.flatMap((p) => weeksTouched(p.startDate, p.endDate))),
    ].sort();
    const rule = await this.carerHours.rule();
    const canGoOverMax = overMaxAllowed(rule);
    let overMaxWarning: string | null = null;
    const given =
      (
        await extraMinutesByWeek(
          this.prisma,
          [dto.employeeId],
          weeks[0],
          weeks[weeks.length - 1],
        )
      ).get(dto.employeeId) ?? new Map<string, number>();
    const display = await this.orgSettings.getOperationalDisplaySettings();
    const addMinutes = Math.round(dto.extraHours * 60);
    const maxMinutes = carerMaxMinutes(employment?.maximumWeeklyHours);
    const maxHours = round1(maxMinutes / 60);
    const contractedMinutes = Math.round(contracted * 60);
    for (const week of weeks) {
      const already = given.get(week) ?? 0;
      const total = contractedMinutes + already + addMinutes;
      if (total > maxMinutes && canGoOverMax) {
        overMaxWarning ??=
          `Week of ${formatOrganisationIsoDate(week, display.dateDisplayFormat)} would have ${round1(total / 60)}h — ` +
          `above the carer's ${maxHours}h weekly maximum (allowed by Settings → Dom Rules).`;
        continue;
      }
      if (total > maxMinutes) {
        const room = Math.max(0, maxMinutes - contractedMinutes - already);
        throw carerOverMaxError(
          dto.employeeId,
          `Week of ${formatOrganisationIsoDate(week, display.dateDisplayFormat)} would have ${round1(total / 60)}h ` +
            `(${round1(contracted)}h contracted${already ? ` + ${round1(already / 60)}h extra already given` : ''} + ${round1(dto.extraHours)}h) — ` +
            `above the carer's ${maxHours}h weekly maximum (Employment → Working hours). ` +
            (room > 0
              ? `At most ${round1(room / 60)}h more can be added for that week.`
              : 'No more hours can be added for that week.'),
        );
      }
    }

    return { startDate, endDate, periods, weeks, overMaxWarning, contracted };
  }

  /** Cancel extra hours given by mistake (kept as the record). Requests already approved stay. */
  async cancel(
    userId: string,
    id: string,
    reason?: string,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.prisma.employeeExtraWeeklyHours.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Extra weekly hours not found');
    if (row.cancelledAt)
      throw new BadRequestException('These extra hours are already cancelled.');
    const outcome = row.outcome as unknown as ExtraHoursOutcome | null;
    if (outcome?.approved?.length)
      throw new BadRequestException(
        'These extra hours approved a request, so they cannot be cancelled.',
      );
    const updated = await this.prisma.employeeExtraWeeklyHours.update({
      where: { id },
      data: {
        cancelledAt: new Date(),
        cancelledById: userId,
        cancelReason: reason?.trim() || null,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.EMPLOYEE,
      action: AuditAction.EMPLOYEE_EXTRA_WEEKLY_HOURS_CANCELLED,
      recordType: 'EmployeeExtraWeeklyHours',
      recordId: id,
      oldValues: { cancelledAt: null },
      newValues: {
        cancelledAt: updated.cancelledAt?.toISOString(),
        cancelReason: updated.cancelReason,
      },
      ...meta,
    });
    return { message: 'Extra weekly hours cancelled', data: { id } };
  }

  /**
   * The dates a day / week(s) / range covers, earliest first (a week is always Monday–Sunday).
   * Several weeks (`weekStarts`) give one Monday–Sunday period each.
   */
  private periodDates(dto: GrantExtraWeeklyHoursDto): Array<{
    startDate: string;
    endDate: string;
  }> {
    if (dto.periodType === EmployeeExtraHoursPeriod.DAY) {
      return [{ startDate: dto.startDate, endDate: dto.startDate }];
    }
    if (dto.periodType === EmployeeExtraHoursPeriod.WEEK) {
      const mondays = [
        ...new Set((dto.weekStarts?.length ? dto.weekStarts : [dto.startDate]).map(mondayOf)),
      ].sort();
      return mondays.map((monday) => ({
        startDate: monday,
        endDate: addDaysToOperationalIso(monday, 6),
      }));
    }
    if (!dto.endDate)
      throw new BadRequestException('Choose the last day of the date range.');
    if (dto.endDate < dto.startDate) {
      throw new BadRequestException(
        'The last day of the range must be on or after the first day.',
      );
    }
    return [{ startDate: dto.startDate, endDate: dto.endDate }];
  }

  /**
   * The carer's requests waiting for a manager in these weeks: each one whose weeks now fit
   * (every waiting visit counted as if approved) is approved; the rest stay, with how many
   * hours they are still over.
   */
  private async approveRequestsThatFit(
    userId: string,
    employeeId: string,
    weeks: string[],
    meta?: RequestAuditMeta,
  ): Promise<ExtraHoursOutcome> {
    const outcome: ExtraHoursOutcome = {
      approved: [],
      stillOver: [],
      failed: [],
    };
    const weekSet = new Set(weeks);
    const rows = await this.waitingRequests(employeeId);
    const display = await this.orgSettings.getOperationalDisplaySettings();
    for (const row of rows) {
      if (!this.requestWeeks(row).some((w) => weekSet.has(w))) continue;
      const label = await this.requestLabel(row, display);
      const now = await this.approvals.carerRequestShortMinutesNow(row);
      if (now && now.shortMinutes > 0) {
        outcome.stillOver.push({
          approvalId: row.id,
          label,
          shortHours: round1(now.shortMinutes / 60),
          weekStart: now.weekStart,
        });
        continue;
      }
      try {
        await this.approvals.approve(
          userId,
          row.id,
          'Approved automatically: extra weekly hours were added',
          meta,
        );
        outcome.approved.push({ approvalId: row.id, label });
      } catch (err) {
        outcome.failed.push({
          approvalId: row.id,
          label,
          message: allocationErrorReason(err),
        });
      }
    }
    return outcome;
  }

  /** The carer's requests waiting for a manager that the weekly limit decides, oldest first. */
  private waitingRequests(employeeId?: string) {
    return this.prisma.employeeHoursApproval.findMany({
      where: {
        ...(employeeId ? { employeeId } : {}),
        status: EmployeeHoursApprovalStatus.PENDING,
        requestType: { in: CARER_REQUEST_TYPES },
      },
      orderBy: { requestedAt: 'asc' },
    });
  }

  /**
   * Carer requests that are back within the weekly hours (e.g. a visit was cancelled or the
   * carer was taken off one) are approved automatically, as a manager would: the carer goes on
   * the visit. One that another rota check still stops (blocked carer, clash…) stays waiting.
   * Runs when Hours approvals opens and with the nightly rolling rota. Managers are told.
   */
  async approveBackWithinLimit(): Promise<{
    approved: Array<{ approvalId: string; label: string }>;
  }> {
    const approved: Array<{ approvalId: string; label: string }> = [];
    const rows = await this.waitingRequests();
    if (!rows.length) return { approved };
    const systemUser = await this.prisma.user.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!systemUser) return { approved };
    const display = await this.orgSettings.getOperationalDisplaySettings();
    for (const row of rows) {
      const now = await this.approvals.carerRequestShortMinutesNow(row);
      if (!now || now.shortMinutes > 0) continue;
      if (await this.approvals.rotaApprovalBlockedReason(row)) continue;
      try {
        await this.approvals.approve(
          systemUser.id,
          row.id,
          'Approved automatically: the carer is back within their weekly hours',
        );
        approved.push({
          approvalId: row.id,
          label: `${await this.carerName(row.employeeId)} — ${await this.requestLabel(row, display)}`,
        });
      } catch {
        // Decided meanwhile, or the visit changed: it stays as it is for a manager.
      }
    }
    if (approved.length) {
      void this.notificationHook.notifyAutoApproved({
        approved,
        requestedById: systemUser.id,
      });
    }
    return { approved };
  }

  private async carerName(employeeId: string | null): Promise<string> {
    if (!employeeId) return 'Carer';
    const p = await this.prisma.employeePersonalDetail.findFirst({
      where: { employeeId, deletedAt: null },
      select: { firstName: true, lastName: true },
    });
    return `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim() || 'Carer';
  }

  /** Mondays of the weeks a carer request is about. */
  private requestWeeks(
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
  ): string[] {
    const p = (row.requestPayload ?? {}) as {
      weekStart?: string;
      withheld?: string[];
      overWeeks?: Array<{ weekStart?: string }>;
      pendingTimes?: unknown[];
    };
    if (row.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS) {
      return p.weekStart ? [p.weekStart] : [];
    }
    return [
      ...new Set([
        ...(p.withheld ?? [])
          .map((k) => k.split('|')[1])
          .filter(Boolean)
          .map(mondayOf),
        ...(p.overWeeks ?? [])
          .map((w) => w.weekStart)
          .filter((w): w is string => Boolean(w)),
      ]),
    ];
  }

  /** "12/11/2026 06:00–07:00 · ClientTwo" for a rota visit, "Visit plan · ClientOne (3 visits)" for a plan. */
  private async requestLabel(
    row: Prisma.EmployeeHoursApprovalGetPayload<object>,
    display: Awaited<
      ReturnType<
        OrganisationGeneralSettingsService['getOperationalDisplaySettings']
      >
    >,
  ): Promise<string> {
    const su = row.serviceUserId
      ? await this.prisma.serviceUser.findUnique({
          where: { id: row.serviceUserId },
          select: { firstName: true, lastName: true },
        })
      : null;
    const suName = su
      ? `${su.firstName ?? ''} ${su.lastName ?? ''}`.trim()
      : '';
    const p = (row.requestPayload ?? {}) as {
      start?: string;
      end?: string;
      withheld?: string[];
    };
    if (
      row.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS &&
      p.start &&
      p.end
    ) {
      const start = new Date(p.start);
      const end = new Date(p.end);
      const when = `${formatOrganisationIsoDate(dayKeyInTimeZone(start, display.timeZone), display.dateDisplayFormat)} ${formatOrganisationHm(formatHmInTimeZone(start, display.timeZone), display.timeDisplayFormat)}–${formatOrganisationHm(formatHmInTimeZone(end, display.timeZone), display.timeDisplayFormat)}`;
      return suName ? `${when} · ${suName}` : when;
    }
    const held = p.withheld?.length ?? 0;
    return `Visit plan${suName ? ` · ${suName}` : ''}${held ? ` (${held} visit${held === 1 ? '' : 's'} held)` : ''}`;
  }

  private async requireEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Carer not found');
  }
}
