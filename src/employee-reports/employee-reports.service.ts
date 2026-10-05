import { BadRequestException, Injectable } from '@nestjs/common';
import { DataAccessType, Prisma, ScheduledJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { ComplianceReportsService } from '../compliance-reports/compliance-reports.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import {
  addDaysToOperationalIso,
  operationalDayBounds,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import type { EmployeeReportQueryDto } from './dto/employee-report-query.dto';

type ReportAudit = RequestAuditMeta & { userId: string };

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;

/** Employee row identity used by every report. */
const EMPLOYEE_SELECT = {
  id: true,
  isActive: true,
  personalDetail: { select: { firstName: true, lastName: true, email: true } },
  employment: {
    select: {
      employeeNumber: true,
      location: { select: { id: true, name: true } },
      role: { select: { name: true } },
      jobTitle: { select: { name: true } },
    },
  },
} satisfies Prisma.EmployeeSelect;

type EmployeeRef = Prisma.EmployeeGetPayload<{
  select: typeof EMPLOYEE_SELECT;
}>;

function employeeOut(e: EmployeeRef) {
  return {
    id: e.id,
    name:
      [e.personalDetail?.firstName, e.personalDetail?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Employee',
    employeeNumber: e.employment?.employeeNumber ?? null,
    branch: e.employment?.location?.name ?? null,
    role: e.employment?.role?.name ?? null,
    jobTitle: e.employment?.jobTitle?.name ?? null,
    isActive: e.isActive,
  };
}

/**
 * Carer (employee) reports — activity, compliance, staff analysis, roles, leaving, details, holidays.
 * Every report respects the caller's branch scope and the optional branch filter.
 */
@Injectable()
export class EmployeeReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly complianceReports: ComplianceReportsService,
  ) {}

  private async logReportView(
    slug: string,
    audit: ReportAudit | undefined,
    recordCount?: number,
  ) {
    if (!audit?.userId) return;
    await this.audit.logAudit({
      userId: audit.userId,
      module: AuditModule.EMPLOYEE_REPORT,
      action: AuditAction.EMPLOYEE_REPORT_VIEWED,
      recordType: 'EmployeeReport',
      recordId: slug,
      metadata: { recordCount },
      ipAddress: audit.ipAddress ?? undefined,
      userAgent: audit.userAgent ?? undefined,
    });
    await this.audit.logDataAccess({
      userId: audit.userId,
      module: AuditModule.EMPLOYEE_REPORT,
      recordType: 'EmployeeReport',
      recordId: slug,
      accessType: DataAccessType.VIEW,
      ipAddress: audit.ipAddress ?? undefined,
      userAgent: audit.userAgent ?? undefined,
      metadata: { recordCount },
    });
  }

  async dashboardSummary(audit?: ReportAudit) {
    const [total, active] = await this.prisma.$transaction([
      this.prisma.employee.count({ where: { deletedAt: null } }),
      this.prisma.employee.count({
        where: { deletedAt: null, isActive: true },
      }),
    ]);
    await this.logReportView('dashboard-summary', audit, total);
    return { data: { totalEmployees: total, activeEmployees: active } };
  }

  async staffSummary(audit?: ReportAudit) {
    const [total, active] = await this.prisma.$transaction([
      this.prisma.employee.count({ where: { deletedAt: null } }),
      this.prisma.employee.count({
        where: { deletedAt: null, isActive: true },
      }),
    ]);
    await this.logReportView('staff-summary', audit, total);
    return { data: { totalEmployees: total, activeEmployees: active } };
  }

  // ── shared helpers ──────────────────────────────────────────────────────

  /** Employees the caller may see, narrowed by branch / status / search. Null = nothing in scope. */
  private employeeWhere(
    user: RequestUser,
    query: EmployeeReportQueryDto,
    defaultStatus: 'active' | 'inactive' | 'all' = 'active',
  ): Prisma.EmployeeWhereInput | null {
    const scope = this.orgScope.fromRequestUser(user);
    const locationIds = this.orgScope.resolveListLocationIds(
      scope,
      query.locationId,
      undefined,
    );
    if (locationIds && locationIds.length === 0) return null;
    const status = query.status ?? defaultStatus;
    const and: Prisma.EmployeeWhereInput[] = [{ deletedAt: null }];
    if (status === 'active') and.push({ isActive: true });
    if (status === 'inactive') and.push({ isActive: false });
    if (locationIds)
      and.push({ employment: { is: { locationId: { in: locationIds } } } });
    const q = query.search?.trim();
    if (q) {
      and.push({
        OR: [
          {
            personalDetail: {
              is: { firstName: { contains: q, mode: 'insensitive' } },
            },
          },
          {
            personalDetail: {
              is: { lastName: { contains: q, mode: 'insensitive' } },
            },
          },
          {
            personalDetail: {
              is: { email: { contains: q, mode: 'insensitive' } },
            },
          },
          {
            employment: {
              is: { employeeNumber: { contains: q, mode: 'insensitive' } },
            },
          },
        ],
      });
    }
    return { AND: and };
  }

  private paging(query: EmployeeReportQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    return { page, limit, skip: (page - 1) * limit };
  }

  private empty(
    query: EmployeeReportQueryDto,
    extra: Record<string, unknown> = {},
  ) {
    const { page, limit } = this.paging(query);
    return {
      data: { rows: [], ...extra },
      meta: buildPaginationMeta({ page, limit, total: 0 }),
    };
  }

  /** Organisation-day range; defaults to the last `defaultDays` days up to today. */
  private async dateRange(query: EmployeeReportQueryDto, defaultDays: number) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const toIso = query.dateTo?.slice(0, 10) ?? today;
    const fromIso =
      query.dateFrom?.slice(0, 10) ??
      addDaysToOperationalIso(toIso, -(defaultDays - 1));
    if (fromIso > toIso)
      throw new BadRequestException('dateFrom must be on or before dateTo');
    const days =
      Math.round(
        (Date.parse(`${toIso}T00:00:00Z`) -
          Date.parse(`${fromIso}T00:00:00Z`)) /
          DAY_MS,
      ) + 1;
    if (days > MAX_RANGE_DAYS)
      throw new BadRequestException(
        `Date range must not exceed ${MAX_RANGE_DAYS} days`,
      );
    return {
      fromIso,
      toIso,
      today,
      timeZone,
      from: operationalDayBounds(fromIso, timeZone).start,
      to: operationalDayBounds(toIso, timeZone).end,
    };
  }

  private async pageEmployees(
    where: Prisma.EmployeeWhereInput,
    query: EmployeeReportQueryDto,
  ) {
    const { page, limit, skip } = this.paging(query);
    const [total, employees] = await this.prisma.$transaction([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        select: EMPLOYEE_SELECT,
        orderBy: [{ personalDetail: { firstName: 'asc' } }, { id: 'asc' }],
        skip,
        take: limit,
      }),
    ]);
    return {
      total,
      employees,
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  private paginateArray<T>(rows: T[], query: EmployeeReportQueryDto) {
    const { page, limit, skip } = this.paging(query);
    return {
      rows: rows.slice(skip, skip + limit),
      meta: buildPaginationMeta({ page, limit, total: rows.length }),
    };
  }

  // ── Carer activity summary ──────────────────────────────────────────────

  async activitySummary(
    user: RequestUser,
    query: EmployeeReportQueryDto,
    audit?: ReportAudit,
  ) {
    const where = this.employeeWhere(user, query);
    if (!where) return this.empty(query);
    const range = await this.dateRange(query, 30);
    const { employees, meta, total } = await this.pageEmployees(where, query);
    const ids = employees.map((e) => e.id);

    const [allocations, taskDone, taskNotes, actionDone, actionNotes] =
      await Promise.all([
        this.prisma.jobAllocation.findMany({
          where: {
            employeeId: { in: ids },
            deletedAt: null,
            isActive: true,
            unallocatedAt: null,
            scheduledJob: {
              deletedAt: null,
              scheduledStartDateTime: { gte: range.from, lte: range.to },
            },
          },
          select: {
            employeeId: true,
            durationMinutes: true,
            scheduledStartDateTime: true,
            scheduledEndDateTime: true,
            actualStartDateTime: true,
            actualEndDateTime: true,
            scheduledJob: {
              select: {
                id: true,
                status: true,
                scheduledStartDateTime: true,
                scheduledEndDateTime: true,
              },
            },
          },
        }),
        this.prisma.scheduledVisitTaskCompletion.groupBy({
          by: ['completedById'],
          where: {
            completedById: { in: ids },
            isCompleted: true,
            completedAt: { gte: range.from, lte: range.to },
          },
          _count: { _all: true },
        }),
        this.prisma.scheduledVisitTaskCompletion.groupBy({
          by: ['completedById'],
          where: {
            completedById: { in: ids },
            completedAt: { gte: range.from, lte: range.to },
            AND: [{ notes: { not: null } }, { notes: { not: '' } }],
          },
          _count: { _all: true },
        }),
        this.prisma.visitAction.groupBy({
          by: ['completedById'],
          where: {
            completedById: { in: ids },
            deletedAt: null,
            completedAt: { gte: range.from, lte: range.to },
          },
          _count: { _all: true },
        }),
        this.prisma.visitAction.groupBy({
          by: ['completedById'],
          where: {
            completedById: { in: ids },
            deletedAt: null,
            completedAt: { gte: range.from, lte: range.to },
            AND: [{ notes: { not: null } }, { notes: { not: '' } }],
          },
          _count: { _all: true },
        }),
      ]);

    const jobIds = [...new Set(allocations.map((a) => a.scheduledJob.id))];
    const late = jobIds.length
      ? await this.prisma.ecmVisitEvaluation.findMany({
          where: {
            scheduledJobId: { in: jobIds },
            arrivalClassification: {
              in: ['LATE_ARRIVAL', 'VERY_LATE_ARRIVAL'],
            },
          },
          select: { scheduledJobId: true },
        })
      : [];
    const lateJobs = new Set(late.map((l) => l.scheduledJobId));
    const countBy = (
      groups: Array<{ completedById: string | null; _count: { _all: number } }>,
    ) => new Map(groups.map((g) => [g.completedById, g._count._all]));
    const tasks = countBy(taskDone);
    const notes = countBy(taskNotes);
    const actions = countBy(actionDone);
    const actionNoteCount = countBy(actionNotes);
    const minutes = (a?: Date | null, b?: Date | null) =>
      a && b && b > a ? (b.getTime() - a.getTime()) / 60_000 : 0;

    const rows = employees.map((e) => {
      const mine = allocations.filter((a) => a.employeeId === e.id);
      const status = (s: ScheduledJobStatus[]) =>
        mine.filter((a) => s.includes(a.scheduledJob.status)).length;
      const planned = mine.reduce(
        (n, a) =>
          n +
          (a.durationMinutes ??
            minutes(
              a.scheduledStartDateTime ?? a.scheduledJob.scheduledStartDateTime,
              a.scheduledEndDateTime ?? a.scheduledJob.scheduledEndDateTime,
            )),
        0,
      );
      const actual = mine.reduce(
        (n, a) => n + minutes(a.actualStartDateTime, a.actualEndDateTime),
        0,
      );
      return {
        employee: employeeOut(e),
        visits: mine.length,
        completed: status([ScheduledJobStatus.COMPLETED]),
        missed: status([ScheduledJobStatus.MISSED]),
        cancelled: status([
          ScheduledJobStatus.CANCELLED,
          ScheduledJobStatus.CALLED_OFF,
        ]),
        plannedHours: round2(planned / 60),
        actualHours: round2(actual / 60),
        lateStarts: mine.filter((a) => lateJobs.has(a.scheduledJob.id)).length,
        tasksCompleted: (tasks.get(e.id) ?? 0) + (actions.get(e.id) ?? 0),
        notesLeft: (notes.get(e.id) ?? 0) + (actionNoteCount.get(e.id) ?? 0),
      };
    });

    await this.logReportView('activity-summary', audit, total);
    return {
      data: { dateFrom: range.fromIso, dateTo: range.toIso, rows },
      meta,
    };
  }

  // ── Compliance (expiring / expired items) ───────────────────────────────

  private async expiringItems(
    where: Prisma.EmployeeWhereInput,
    withinDays: number,
    today: string,
  ) {
    const cutoff = new Date(
      `${addDaysToOperationalIso(today, withinDays)}T23:59:59.999Z`,
    );
    const base = {
      deletedAt: null,
      isActive: true,
      expiryDate: { not: null, lte: cutoff },
      employee: where,
    };
    const [skills, certs, records] = await Promise.all([
      this.prisma.employeeSkill.findMany({
        where: base,
        select: {
          id: true,
          expiryDate: true,
          skillType: { select: { name: true } },
          employee: { select: EMPLOYEE_SELECT },
        },
      }),
      this.prisma.employeeWorkCertification.findMany({
        where: base,
        select: {
          id: true,
          expiryDate: true,
          certificationType: { select: { name: true } },
          employee: { select: EMPLOYEE_SELECT },
        },
      }),
      this.prisma.employeeCompliance.findMany({
        where: { ...base, isNoLongerRequired: false },
        select: {
          id: true,
          expiryDate: true,
          complianceType: { select: { name: true } },
          employee: { select: EMPLOYEE_SELECT },
        },
      }),
    ]);
    const todayMs = Date.parse(`${today}T00:00:00Z`);
    const toRow = (
      kind: 'Skill' | 'Certification' | 'Compliance document',
      id: string,
      name: string | null | undefined,
      expiry: Date,
      employee: EmployeeRef,
    ) => {
      const expiryIso = iso(expiry)!;
      const daysLeft = Math.round(
        (Date.parse(`${expiryIso}T00:00:00Z`) - todayMs) / DAY_MS,
      );
      return {
        id,
        employee: employeeOut(employee),
        kind,
        item: name || kind,
        expiryDate: expiryIso,
        daysLeft,
        state: daysLeft < 0 ? ('EXPIRED' as const) : ('DUE_SOON' as const),
      };
    };
    return [
      ...skills.map((s) =>
        toRow('Skill', s.id, s.skillType?.name, s.expiryDate!, s.employee),
      ),
      ...certs.map((c) =>
        toRow(
          'Certification',
          c.id,
          c.certificationType?.name,
          c.expiryDate!,
          c.employee,
        ),
      ),
      ...records.map((r) =>
        toRow(
          'Compliance document',
          r.id,
          r.complianceType?.name,
          r.expiryDate!,
          r.employee,
        ),
      ),
    ].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  }

  async compliance(
    user: RequestUser,
    query: EmployeeReportQueryDto,
    audit?: ReportAudit,
  ) {
    const where = this.employeeWhere(user, query);
    if (!where) return this.empty(query, { expiredCount: 0, dueSoonCount: 0 });
    const withinDays = query.withinDays ?? 30;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const items = await this.expiringItems(where, withinDays, today);
    const { rows, meta } = this.paginateArray(items, query);
    await this.logReportView('compliance', audit, items.length);
    return {
      data: {
        withinDays,
        expiredCount: items.filter((i) => i.state === 'EXPIRED').length,
        dueSoonCount: items.filter((i) => i.state === 'DUE_SOON').length,
        rows,
      },
      meta,
    };
  }

  // ── Compliance detail (same rows as the Compliance board) ───────────────

  async complianceDetail(
    user: RequestUser,
    query: EmployeeReportQueryDto,
    audit?: ReportAudit,
  ) {
    const where = this.employeeWhere(user, query);
    if (!where) return this.empty(query, { fullyCompliant: 0, needsAction: 0 });
    const allowed = new Set(
      (
        await this.prisma.employee.findMany({ where, select: { id: true } })
      ).map((e) => e.id),
    );
    // No actor → the board does not write a report-view audit entry; this report logs its own.
    const board = await this.complianceReports.board({});
    const filtered = board.data.rows.filter((r) => allowed.has(r.employeeId));
    const all = filtered.map((r) => ({
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      jobTitle: r.jobTitle ?? null,
      roleName: r.roleName ?? null,
      compliancePercent: r.compliancePercent ?? null,
      status: r.overallDisplayStatus,
      blockingIssues: r.blockingIssueCount,
      totalIssues: r.totalIssueCount,
      nearestExpiryDate: r.nearestExpiryDate ?? null,
      issues: r.cells
        .filter(
          (c) =>
            c.applicable &&
            [
              'MISSING',
              'EXPIRED',
              'REJECTED',
              'EXPIRING_SOON',
              'REQUIRED',
            ].includes(String(c.effectiveStatus)),
        )
        .map((c) => ({
          item: c.typeName,
          status: c.effectiveStatus,
          expiryDate: c.expiryDate ?? null,
        })),
    }));
    const { rows, meta } = this.paginateArray(all, query);
    await this.logReportView('compliance-detail', audit, all.length);
    return {
      data: {
        fullyCompliant: all.filter((r) => r.status === 'COMPLIANT').length,
        needsAction: all.filter((r) => r.status !== 'COMPLIANT').length,
        rows,
      },
      meta,
    };
  }

  // ── Staff analysis (overdue / due soon per carer) ───────────────────────

  async staffAnalysis(
    user: RequestUser,
    query: EmployeeReportQueryDto,
    audit?: ReportAudit,
  ) {
    const where = this.employeeWhere(user, query);
    if (!where) return this.empty(query);
    const withinDays = query.withinDays ?? 30;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const cutoff = new Date(
      `${addDaysToOperationalIso(today, withinDays)}T23:59:59.999Z`,
    );
    const todayStart = new Date(`${today}T00:00:00.000Z`);

    const [items, reviews] = await Promise.all([
      this.expiringItems(where, withinDays, today),
      this.prisma.employeeReview.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          nextDue: { not: null, lte: cutoff },
          employee: where,
        },
        select: {
          id: true,
          nextDue: true,
          reviewType: { select: { name: true } },
          employee: { select: EMPLOYEE_SELECT },
        },
      }),
    ]);

    type Bucket = { overdue: number; dueSoon: number };
    const byEmployee = new Map<
      string,
      {
        employee: ReturnType<typeof employeeOut>;
        reviews: Bucket;
        skills: Bucket;
        certifications: Bucket;
        compliance: Bucket;
        items: Array<{
          item: string;
          kind: string;
          date: string;
          overdue: boolean;
        }>;
      }
    >();
    const entry = (employee: ReturnType<typeof employeeOut>) => {
      let row = byEmployee.get(employee.id);
      if (!row) {
        const zero = () => ({ overdue: 0, dueSoon: 0 });
        row = {
          employee,
          reviews: zero(),
          skills: zero(),
          certifications: zero(),
          compliance: zero(),
          items: [],
        };
        byEmployee.set(employee.id, row);
      }
      return row;
    };
    for (const r of reviews) {
      const overdue = r.nextDue! < todayStart;
      const row = entry(employeeOut(r.employee));
      row.reviews[overdue ? 'overdue' : 'dueSoon'] += 1;
      row.items.push({
        item: r.reviewType?.name || 'Review',
        kind: 'Review',
        date: iso(r.nextDue)!,
        overdue,
      });
    }
    for (const i of items) {
      const key =
        i.kind === 'Skill'
          ? 'skills'
          : i.kind === 'Certification'
            ? 'certifications'
            : 'compliance';
      const overdue = i.state === 'EXPIRED';
      const row = entry(i.employee);
      row[key][overdue ? 'overdue' : 'dueSoon'] += 1;
      row.items.push({
        item: i.item,
        kind: i.kind,
        date: i.expiryDate,
        overdue,
      });
    }

    const all = [...byEmployee.values()]
      .map((r) => {
        const overdue =
          r.reviews.overdue +
          r.skills.overdue +
          r.certifications.overdue +
          r.compliance.overdue;
        const dueSoon =
          r.reviews.dueSoon +
          r.skills.dueSoon +
          r.certifications.dueSoon +
          r.compliance.dueSoon;
        return {
          ...r,
          overdue,
          dueSoon,
          items: r.items.sort((a, b) => a.date.localeCompare(b.date)),
        };
      })
      .sort(
        (a, b) =>
          b.overdue - a.overdue ||
          b.dueSoon - a.dueSoon ||
          a.employee.name.localeCompare(b.employee.name),
      );
    const { rows, meta } = this.paginateArray(all, query);
    await this.logReportView('staff-analysis', audit, all.length);
    return { data: { withinDays, rows }, meta };
  }

  // ── Roles ───────────────────────────────────────────────────────────────

  async roles(
    user: RequestUser,
    query: EmployeeReportQueryDto,
    audit?: ReportAudit,
  ) {
    const where = this.employeeWhere(user, query);
    if (!where) return this.empty(query);
    const { page, limit, skip } = this.paging(query);
    const [total, employees] = await this.prisma.$transaction([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        orderBy: [{ personalDetail: { firstName: 'asc' } }, { id: 'asc' }],
        skip,
        take: limit,
        select: {
          ...EMPLOYEE_SELECT,
          employment: {
            select: {
              employeeNumber: true,
              startDate: true,
              isAgencyStaff: true,
              isBankStaff: true,
              location: { select: { id: true, name: true } },
              role: { select: { name: true } },
              jobTitle: { select: { name: true } },
              rbacLevel: { select: { name: true } },
              workArea: { select: { name: true } },
              contractType: { select: { name: true } },
              grade: { select: { name: true } },
            },
          },
        },
      }),
    ]);
    const rows = employees.map((e) => ({
      employee: employeeOut(e),
      accessLevel: e.employment?.rbacLevel?.name ?? null,
      workArea: e.employment?.workArea?.name ?? null,
      contractType: e.employment?.contractType?.name ?? null,
      grade: e.employment?.grade?.name ?? null,
      startDate: iso(e.employment?.startDate),
      staffType: e.employment?.isAgencyStaff
        ? 'Agency'
        : e.employment?.isBankStaff
          ? 'Bank'
          : 'Employed',
    }));
    await this.logReportView('roles', audit, total);
    return {
      data: { rows },
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  // ── Leaving ─────────────────────────────────────────────────────────────

  async leaving(
    user: RequestUser,
    query: EmployeeReportQueryDto,
    audit?: ReportAudit,
  ) {
    const where = this.employeeWhere(user, query, 'all');
    if (!where) return this.empty(query);
    const range = await this.dateRange(query, 365);
    const fromDay = new Date(`${range.fromIso}T00:00:00.000Z`);
    const toDay = new Date(`${range.toIso}T23:59:59.999Z`);
    const [records, endedEmployments] = await Promise.all([
      this.prisma.employeeLeavingRecord.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          leavingDate: { gte: fromDay, lte: toDay },
          employee: where,
        },
        select: {
          id: true,
          leavingDate: true,
          notes: true,
          leavingReason: { select: { name: true } },
          employee: {
            select: {
              ...EMPLOYEE_SELECT,
              employment: {
                select: {
                  ...EMPLOYEE_SELECT.employment.select,
                  startDate: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.employeeEmployment.findMany({
        where: {
          deletedAt: null,
          endDate: { gte: fromDay, lte: toDay },
          employee: where,
        },
        select: {
          id: true,
          endDate: true,
          startDate: true,
          leavingNotes: true,
          leavingReason: { select: { name: true } },
          employee: { select: EMPLOYEE_SELECT },
        },
      }),
    ]);
    const seen = new Set(
      records.map((r) => `${r.employee.id}:${iso(r.leavingDate)}`),
    );
    const all = [
      ...records.map((r) => ({
        id: r.id,
        employee: employeeOut(r.employee),
        startDate: iso(r.employee.employment?.startDate),
        leavingDate: iso(r.leavingDate)!,
        reason: r.leavingReason?.name ?? null,
        notes: r.notes ?? null,
      })),
      ...endedEmployments
        .filter((e) => !seen.has(`${e.employee.id}:${iso(e.endDate)}`))
        .map((e) => ({
          id: e.id,
          employee: employeeOut(e.employee),
          startDate: iso(e.startDate),
          leavingDate: iso(e.endDate)!,
          reason: e.leavingReason?.name ?? null,
          notes: e.leavingNotes ?? null,
        })),
    ].sort((a, b) => b.leavingDate.localeCompare(a.leavingDate));
    const { rows, meta } = this.paginateArray(all, query);
    await this.logReportView('leaving', audit, all.length);
    return {
      data: { dateFrom: range.fromIso, dateTo: range.toIso, rows },
      meta,
    };
  }

  // ── Details ─────────────────────────────────────────────────────────────

  async details(
    user: RequestUser,
    query: EmployeeReportQueryDto,
    audit?: ReportAudit,
  ) {
    const where = this.employeeWhere(user, query);
    if (!where) return this.empty(query);
    const { page, limit, skip } = this.paging(query);
    const [total, employees] = await this.prisma.$transaction([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        orderBy: [{ personalDetail: { firstName: 'asc' } }, { id: 'asc' }],
        skip,
        take: limit,
        select: {
          ...EMPLOYEE_SELECT,
          personalDetail: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              mobileTelephone: true,
              homeTelephone: true,
              town: true,
              postcode: true,
            },
          },
          employment: {
            select: {
              ...EMPLOYEE_SELECT.employment.select,
              startDate: true,
              contractedWeeklyHours: true,
              contractType: { select: { name: true } },
            },
          },
        },
      }),
    ]);
    const rows = employees.map((e) => ({
      employee: employeeOut(e),
      email: e.personalDetail?.email ?? null,
      phone:
        e.personalDetail?.mobileTelephone ||
        e.personalDetail?.homeTelephone ||
        null,
      town: e.personalDetail?.town ?? null,
      postcode: e.personalDetail?.postcode ?? null,
      startDate: iso(e.employment?.startDate),
      contractType: e.employment?.contractType?.name ?? null,
      contractedWeeklyHours: e.employment?.contractedWeeklyHours ?? null,
    }));
    await this.logReportView('details', audit, total);
    return {
      data: { rows },
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  // ── Holidays & absences ─────────────────────────────────────────────────

  async holidays(
    user: RequestUser,
    query: EmployeeReportQueryDto,
    audit?: ReportAudit,
  ) {
    const where = this.employeeWhere(user, query, 'all');
    if (!where) return this.empty(query, { totalsByType: {} });
    const range = await this.dateRange(query, 90);
    const fromDay = new Date(`${range.fromIso}T00:00:00.000Z`);
    const toDay = new Date(`${range.toIso}T23:59:59.999Z`);
    const [absences, holidays] = await Promise.all([
      this.prisma.employeeAbsenceRecord.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          fromDateTime: { lte: toDay },
          toDateTime: { gte: fromDay },
          employee: where,
        },
        select: {
          id: true,
          absenceType: true,
          fromDateTime: true,
          toDateTime: true,
          sicknessFlag: true,
          permissionStatus: true,
          notes: true,
          holidayId: true,
          employee: { select: EMPLOYEE_SELECT },
        },
      }),
      this.prisma.employeeHoliday.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          startDate: { lte: toDay },
          endDate: { gte: fromDay },
          absenceRecord: { is: null },
          employee: where,
        },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          notes: true,
          employee: { select: EMPLOYEE_SELECT },
        },
      }),
    ]);
    const days = (a: Date, b: Date) =>
      Math.max(
        1,
        Math.round(
          (Date.parse(`${iso(b)}T00:00:00Z`) -
            Date.parse(`${iso(a)}T00:00:00Z`)) /
            DAY_MS,
        ) + 1,
      );
    const all = [
      ...absences.map((a) => ({
        id: a.id,
        employee: employeeOut(a.employee),
        type: a.absenceType || 'Absence',
        from: iso(a.fromDateTime)!,
        to: iso(a.toDateTime)!,
        days: days(a.fromDateTime, a.toDateTime),
        sickness: a.sicknessFlag,
        status: a.permissionStatus,
        notes: a.notes ?? null,
      })),
      ...holidays.map((h) => ({
        id: h.id,
        employee: employeeOut(h.employee),
        type: 'Holiday',
        from: iso(h.startDate)!,
        to: iso(h.endDate)!,
        days: days(h.startDate, h.endDate),
        sickness: false,
        status: 'Authorised',
        notes: h.notes ?? null,
      })),
    ].sort((a, b) => b.from.localeCompare(a.from));
    const totalsByType: Record<string, number> = {};
    for (const r of all)
      totalsByType[r.type] = (totalsByType[r.type] ?? 0) + r.days;
    const { rows, meta } = this.paginateArray(all, query);
    await this.logReportView('holidays', audit, all.length);
    return {
      data: {
        dateFrom: range.fromIso,
        dateTo: range.toIso,
        totalsByType,
        rows,
      },
      meta,
    };
  }
}
