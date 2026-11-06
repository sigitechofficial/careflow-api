import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DataAccessType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ComplianceReportsService } from '../compliance-reports/compliance-reports.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { collectReviewDues, currentStaffWhere, reviewKey } from '../employee-reviews/review-dues';
import { deriveReviewStatus, REVIEW_DUE_SOON_DAYS } from '../employee-reviews/employee-review-schedule.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { EmployeeQueryDto } from './dto/employee-query.dto';
import type { EmployeeDocumentsRegistryQueryDto } from './dto/employee-documents-registry-query.dto';
import { buildEmployeeListOrderBy } from './employee-list-order.util';
import { buildEmployeeListWhere, hasEmployeeListCohortFilters } from './employee-list-where.util';
import { buildEmployeeListEmploymentWhere } from './employee-list-filter.util';
import {
  buildEmployeeListFacets,
  loadEmployeeListFacetLocationIds,
} from './employee-list-facets.util';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateEmployeeStatusDto } from './dto/update-employee-status.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { ScheduleLifecycleImpactService } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.service';
import type { ScheduleImpactResult } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.util';
import type { ScheduleImpactPreviewQueryDto } from '../schedule-lifecycle-impact/dto/schedule-impact-preview-query.dto';
import { mapEmployeeListRow } from './mappers/employee.mapper';
import { loadEmployeeListHolidaySnapshots } from './employee-list-enrichment.util';
import { parseEmployeeVisaTypes } from '../organisation-general-settings/employee-visa-types.util';

export type EmployeeAuditMeta = RequestAuditMeta & { actorUserId: string };

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly scheduleImpact: ScheduleLifecycleImpactService,
    private readonly orgScope: OrgScopeService,
    @Optional() private readonly complianceReports?: ComplianceReportsService,
    @Optional() private readonly orgSettings?: OrganisationGeneralSettingsService,
  ) {}

  async list(query: EmployeeQueryDto, actor?: RequestUser) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const scopedQuery = this.applyActorLocationScope(query, actor);
    if (scopedQuery === null) {
      return {
        data: [],
        meta: buildPaginationMeta({ page, limit, total: 0 }),
      };
    }

    const { listWhere, isEmpty } = await buildEmployeeListWhere(this.prisma, scopedQuery);

    if (isEmpty) {
      return {
        data: [],
        meta: buildPaginationMeta({ page, limit, total: 0 }),
      };
    }

    const [total, rows, settings] = await this.prisma.$transaction([
      this.prisma.employee.count({
        where: listWhere,
      }),
      this.prisma.employee.findMany({
        where: listWhere,
        include: {
          personalDetail: { include: { status: true } },
          employment: {
            include: {
              jobTitle: true,
              role: true,
              grade: true,
              contractType: true,
              location: true,
              leavingReason: true,
              floorLocations: { include: { location: true } },
            },
          },
        },
        skip,
        take: limit,
        orderBy: buildEmployeeListOrderBy(scopedQuery),
      }),
      this.prisma.organisationGeneralSettings.findFirst({
        select: { employeeVisaTypes: true },
      }),
    ]);

    const visaTypes = parseEmployeeVisaTypes(settings?.employeeVisaTypes);
    const holidaySnapshots = await loadEmployeeListHolidaySnapshots(
      this.prisma,
      rows.map((row) => row.id),
    );

    return {
      data: rows.map((row) =>
        mapEmployeeListRow(row, visaTypes, holidaySnapshots.get(row.id)),
      ),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async listFilterFacets(query: EmployeeQueryDto, actor?: RequestUser) {
    const scopedQuery = this.applyActorLocationScope(query, actor);
    if (scopedQuery === null) {
      return {
        data: {
          branches: [],
          roles: [],
          jobTitles: [],
          grades: [],
          contractTypes: [],
          visaTypes: [],
          statuses: [],
          cohortTotal: 0,
          branchCohortTotal: 0,
        },
      };
    }
    const locationCatalogIds = await loadEmployeeListFacetLocationIds(this.prisma);
    const data = await buildEmployeeListFacets(this.prisma, scopedQuery, locationCatalogIds);
    return { data };
  }

  async getById(id: string, audit?: EmployeeAuditMeta, actor?: RequestUser) {
    if (actor) {
      await this.orgScope.assertEmployeeInScope(this.orgScope.fromRequestUser(actor), id);
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null },
      include: {
        personalDetail: { include: { title: true, gender: true, nationality: true, ethnicity: true, status: true } },
        employment: {
          include: {
            workArea: true,
            role: true,
            jobTitle: true,
            rbacLevel: true,
            grade: true,
            contractType: true,
            travelPaymentType: true,
            baseLocation: true,
            location: true,
            leavingReason: true,
            floorLocations: {
              include: { location: true },
            },
            serviceUserAreas: {
              include: {
                serviceUserArea: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    scheduleAreaId: true,
                  },
                },
              },
            },
            defaultPayCard: {
              select: { id: true, name: true, code: true, status: true },
            },
          },
        },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    if (audit?.actorUserId) {
      await this.audit.logDataAccess({
        userId: audit.actorUserId,
        module: AuditModule.EMPLOYEE,
        recordType: 'Employee',
        recordId: id,
        accessType: DataAccessType.VIEW,
        ipAddress: audit.ipAddress ?? undefined,
        userAgent: audit.userAgent ?? undefined,
        metadata: { route: 'employees.detail' },
      });
    }

    const data = employee.employment
      ? {
          ...employee,
          employment: {
            ...employee.employment,
            baseLocationIds: employee.employment.floorLocations
              .map((row) => row.locationId)
              .filter((id) => id && id !== employee.employment!.locationId),
            serviceUserAreaIds: employee.employment.serviceUserAreas.map(
              (row) => row.serviceUserAreaId,
            ),
          },
        }
      : employee;

    return { data };
  }

  async previewScheduleImpact(employeeId: string, query: ScheduleImpactPreviewQueryDto) {
    await this.ensureExists(employeeId);
    const endDate = query.endDate ?? query.startDate;
    const scheduleImpact = await this.scheduleImpact.previewUnallocateEmployeeJobsInRange({
      employeeId,
      fromDate: query.startDate,
      toDate: endDate,
    });
    return { data: scheduleImpact };
  }

  async create(userId: string, dto: CreateEmployeeDto, meta?: RequestAuditMeta) {
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          createdById: userId,
          personalDetail: {
            create: {
              firstName: dto.firstName,
              lastName: dto.lastName,
              titleId: dto.titleId,
              genderId: dto.genderId,
              email: dto.email,
              username: dto.username,
              nationalityId: dto.nationalityId,
              ethnicityId: dto.ethnicityId,
              statusId: dto.statusId,
              createdById: userId,
            },
          },
        },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_CREATED,
        recordType: 'Employee',
        recordId: employee.id,
        newValues: auditSnapshot({
          id: employee.id,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          statusId: dto.statusId,
        }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Employee created', data: { id: employee.id } };
    });
  }

  async update(userId: string, id: string, dto: UpdateEmployeeDto, meta?: RequestAuditMeta) {
    await this.ensureExists(id);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.employee.findFirst({ where: { id, deletedAt: null } });
      const updated = await tx.employee.update({
        where: { id },
        data: {
          ...dto,
          updatedById: userId,
        },
      });
      const oldS = auditSnapshot(before);
      const newS = auditSnapshot(updated);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_UPDATED,
        recordType: 'Employee',
        recordId: id,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      let scheduleImpact: ScheduleImpactResult | undefined;
      if (before?.isActive && dto.isActive === false) {
        scheduleImpact = await this.scheduleImpact.unallocateEmployeeFutureJobs(
          userId,
          id,
          'Employee deactivated',
          'employee_inactive',
          meta,
          tx,
        );
      }

      return {
        message: 'Employee updated',
        data: updated,
        ...(scheduleImpact ? { scheduleImpact } : {}),
      };
    });
  }

  async softDelete(userId: string, id: string, meta?: RequestAuditMeta) {
    await this.ensureExists(id);
    return this.prisma.$transaction(async (tx) => {
      const scheduleImpact = await this.scheduleImpact.unallocateEmployeeFutureJobs(
        userId,
        id,
        'Employee deleted',
        'employee_inactive',
        meta,
        tx,
      );
      const before = await tx.employee.findFirst({
        where: { id, deletedAt: null },
        include: { personalDetail: true, employment: true },
      });
      const now = new Date();
      await tx.employee.update({
        where: { id },
        data: { deletedAt: now, deletedById: userId, isActive: false },
      });
      // Drop payroll readiness so deleted staff are not auto-enrolled on UK runs.
      await tx.employeePayrollProfile.updateMany({
        where: { employeeId: id, deletedAt: null },
        data: { deletedAt: now, status: 'SUSPENDED', updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_DELETED,
        recordType: 'Employee',
        recordId: id,
        oldValues: auditSnapshot(before),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return {
        message: 'Employee deleted',
        data: {},
        ...(scheduleImpact.jobsUnallocated ? { scheduleImpact } : {}),
      };
    });
  }

  async updateStatus(userId: string, id: string, dto: UpdateEmployeeStatusDto, meta?: RequestAuditMeta) {
    await this.ensureExists(id);
    const inactiveStatus = await this.prisma.employeeStatus.findFirst({
      where: { deletedAt: null, name: { equals: 'Inactive', mode: 'insensitive' } },
      select: { id: true },
    });

    return this.prisma.$transaction(async (tx) => {
      let scheduleImpact: ScheduleImpactResult | undefined;
      if (inactiveStatus && dto.statusId === inactiveStatus.id) {
        scheduleImpact = await this.scheduleImpact.unallocateEmployeeFutureJobs(
          userId,
          id,
          'Employee status set to inactive',
          'employee_inactive',
          meta,
          tx,
        );
      }

      const beforePd = await tx.employeePersonalDetail.findUnique({
        where: { employeeId: id },
      });
      await tx.employeePersonalDetail.upsert({
        where: { employeeId: id },
        update: { statusId: dto.statusId, updatedById: userId },
        create: {
          employeeId: id,
          firstName: 'Unknown',
          lastName: 'Unknown',
          username: `employee-${id}`,
          statusId: dto.statusId,
          createdById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_STATUS_CHANGED,
        recordType: 'Employee',
        recordId: id,
        oldValues: auditSnapshot({ statusId: beforePd?.statusId ?? null }),
        newValues: auditSnapshot({ statusId: dto.statusId }),
        metadata: {
          changedFields: this.audit.getChangedFields(
            auditSnapshot({ statusId: beforePd?.statusId ?? null }),
            auditSnapshot({ statusId: dto.statusId }),
          ),
        },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return {
        message: 'Employee status updated',
        data: {},
        ...(scheduleImpact?.jobsUnallocated ? { scheduleImpact } : {}),
      };
    });
  }

  /** All employees with active skill type names (for skills overview table). */
  async skillsOverview() {
    const rows = await this.prisma.employee.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        personalDetail: {
          select: { firstName: true, lastName: true },
        },
        skills: {
          where: { deletedAt: null },
          select: {
            skillType: { select: { name: true } },
          },
          orderBy: { skillType: { name: 'asc' } },
        },
      },
    });

    const data = rows.map((e) => {
      const fn = e.personalDetail?.firstName?.trim() ?? '';
      const ln = e.personalDetail?.lastName?.trim() ?? '';
      const displayName = [fn, ln].filter(Boolean).join(' ') || '—';
      const skillNames = e.skills
        .map((s) => s.skillType?.name?.trim())
        .filter((n): n is string => Boolean(n));
      return { employeeId: e.id, displayName, skillNames };
    });

    return { data };
  }

  /** Recent non-core activity rows across all employees (read-only list + edit entry point). */
  async nonCoreActivitiesRegistry() {
    const rows = await this.prisma.employeeNonCoreActivity.findMany({
      where: { deletedAt: null },
      orderBy: { dateFrom: 'desc' },
      take: 1000,
      include: {
        reason: { select: { id: true, name: true } },
        employee: {
          select: {
            id: true,
            personalDetail: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    const data = rows.map((r) => {
      const pd = r.employee?.personalDetail;
      const fn = pd?.firstName?.trim() ?? '';
      const ln = pd?.lastName?.trim() ?? '';
      const employeeDisplayName = [fn, ln].filter(Boolean).join(' ') || '—';
      return {
        id: r.id,
        employeeId: r.employeeId,
        employeeDisplayName,
        reasonId: r.reasonId,
        reasonName: r.reason?.name ?? null,
        dateFrom: r.dateFrom.toISOString(),
        dateTo: r.dateTo.toISOString(),
        includeInPayroll: r.includeInPayroll,
        onCallForPeriod: r.onCallForPeriod,
        notes: r.notes,
      };
    });

    return { data };
  }

  /** Aggregates for employee management dashboard charts (staff list page). */
  async chartSummary(query: EmployeeQueryDto = {}, actor?: RequestUser) {
    const scopedQuery = this.applyActorLocationScope(query, actor);
    if (scopedQuery === null) {
      return {
        data: {
          staff: { total: 0, active: 0, inactive: 0 },
          compliance: { compliant: 0, attention: 0, blocked: 0 },
          skills: [],
          reviews: { upToDate: 0, dueSoon: 0, overdue: 0 },
          meta: { cohortTotal: 0, scope: 'filtered' as const },
        },
      };
    }
    const cohortFiltered = hasEmployeeListCohortFilters(scopedQuery);
    const { listWhere, wherePersonal, isEmpty } = await buildEmployeeListWhere(
      this.prisma,
      scopedQuery,
    );

    const emptySummary = {
      staff: { total: 0, active: 0, inactive: 0 },
      compliance: { compliant: 0, attention: 0, blocked: 0 },
      skills: [] as { name: string; value: number; color: string }[],
      reviews: { upToDate: 0, dueSoon: 0, overdue: 0 },
      meta: {
        cohortTotal: 0,
        scope: cohortFiltered ? 'filtered' as const : 'organisation' as const,
      },
    };

    if (isEmpty) {
      return { data: emptySummary };
    }

    const [activeStatus, inactiveStatus] = await Promise.all([
      this.prisma.employeeStatus.findFirst({
        where: { deletedAt: null, name: { equals: 'Active', mode: 'insensitive' } },
      }),
      this.prisma.employeeStatus.findFirst({
        where: { deletedAt: null, name: { equals: 'Inactive', mode: 'insensitive' } },
      }),
    ]);

    const [total, activeCount, inactiveCount] = await Promise.all([
      this.prisma.employee.count({ where: listWhere }),
      activeStatus
        ? this.prisma.employee.count({
            where: {
              ...listWhere,
              personalDetail: { is: { ...wherePersonal, statusId: activeStatus.id } },
            },
          })
        : Promise.resolve(0),
      inactiveStatus
        ? this.prisma.employee.count({
            where: {
              ...listWhere,
              personalDetail: { is: { ...wherePersonal, statusId: inactiveStatus.id } },
            },
          })
        : Promise.resolve(0),
    ]);

    // Compliance per person, with the compliance board's own rule (Compliant / Attention / Blocked),
    // so this chart and the board always agree.
    const cohortIds = (await this.prisma.employee.findMany({ where: listWhere, select: { id: true } })).map((e) => e.id);
    const compliance = this.complianceReports
      ? await this.complianceReports.statusCounts(cohortIds)
      : { compliant: 0, attention: 0, blocked: 0 };

    type SkillAggRow = { skillTypeId: string | null; cnt: number };
    const skillGroups = await this.prisma.employeeSkill.groupBy({
      by: ['skillTypeId'],
      where: { deletedAt: null, employee: listWhere },
      _count: { _all: true },
    });
    const skillAggRows: SkillAggRow[] = skillGroups.map((row) => ({
      skillTypeId: row.skillTypeId,
      cnt: row._count._all,
    }));

    const skillTypeIds = skillAggRows
      .map((r) => r.skillTypeId)
      .filter((id): id is string => id !== null);
    const skillTypes =
      skillTypeIds.length > 0
        ? await this.prisma.skillType.findMany({
            where: { id: { in: skillTypeIds }, deletedAt: null },
            select: { id: true, name: true },
          })
        : [];
    const skillNameById = Object.fromEntries(skillTypes.map((t) => [t.id, t.name]));
    const skillsPie = [...skillAggRows]
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, 12)
      .map((g, i) => ({
        name: g.skillTypeId ? skillNameById[g.skillTypeId] ?? 'Unknown' : 'Unspecified',
        value: g.cnt,
        color: `hsl(${(i * 29) % 360}, 58%, 48%)`,
      }));

    // Staff reviews from each review type's schedule: due ones by status, plus records with nothing
    // more due (one-offs, finished probation) as up to date. Current staff only.
    const now = new Date();
    const dueSoonDays = (await this.orgSettings?.getSupervisionSettings())?.dueSoonDays ?? REVIEW_DUE_SOON_DAYS;
    const { dues, latest } = await collectReviewDues(this.prisma, { AND: [listWhere, currentStaffWhere(now)] });
    const reviews = { upToDate: 0, dueSoon: 0, overdue: 0 };
    const dueKeys = new Set(dues.map((d) => reviewKey(d.employeeId, d.reviewTypeId)));
    for (const due of dues) {
      const status = deriveReviewStatus({ nextDue: due.nextDue }, now, dueSoonDays);
      if (status === 'OVERDUE') reviews.overdue += 1;
      else if (status === 'DUE_SOON') reviews.dueSoon += 1;
      else reviews.upToDate += 1;
    }
    for (const [key, t] of latest) if (!dueKeys.has(key) && t.lastDone) reviews.upToDate += 1;

    return {
      data: {
        staff: {
          total,
          active: activeCount,
          inactive: inactiveCount,
        },
        compliance,
        skills: skillsPie,
        reviews,
        meta: {
          cohortTotal: total,
          scope: cohortFiltered ? 'filtered' : 'organisation',
        },
      },
    };
  }

  /** All employee documents (non-deleted employees only) for the General Employee Documents screen. */
  async listDocumentsRegistry(query: EmployeeDocumentsRegistryQueryDto = {}) {
    const { whereEmployment, hasEmploymentFilters } = buildEmployeeListEmploymentWhere({
      locationIds: query.locationIds,
    });

    const rows = await this.prisma.employeeDocument.findMany({
      where: {
        deletedAt: null,
        employee: {
          deletedAt: null,
          ...(hasEmploymentFilters ? { employment: whereEmployment } : {}),
        },
      },
      orderBy: { uploadedDate: 'desc' },
      take: 2000,
      include: {
        employee: {
          select: {
            id: true,
            personalDetail: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    });

    const data = rows.map((r) => {
      const p = r.employee.personalDetail;
      const employeeName = p
        ? [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || 'Unknown'
        : 'Unknown';
      return {
        id: r.id,
        employeeId: r.employeeId,
        employeeName,
        name: r.name,
        description: r.description,
        fileUrl: r.fileUrl,
        fileName: r.fileName,
        fileSize: r.fileSize,
        mimeType: r.mimeType,
        uploadedDate: r.uploadedDate.toISOString(),
        tags: r.tags,
      };
    });

    return { data };
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }

  /**
   * Intersect client locationIds with actor org scope.
   * Returns null when intersection is empty (caller returns empty result).
   */
  private applyActorLocationScope(
    query: EmployeeQueryDto,
    actor?: RequestUser,
  ): EmployeeQueryDto | null {
    if (!actor) return query;
    const scope = this.orgScope.fromRequestUser(actor);
    const locationIds = this.orgScope.resolveListLocationIds(
      scope,
      undefined,
      query.locationIds,
    );
    if (locationIds && locationIds.length === 0) return null;
    if (!locationIds) return query;
    return { ...query, locationIds };
  }
}
