import { Injectable, NotFoundException } from '@nestjs/common';
import { DataAccessType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeQueryDto } from './dto/employee-query.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateEmployeeStatusDto } from './dto/update-employee-status.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { ScheduleLifecycleImpactService } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.service';
import type { ScheduleImpactResult } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.util';
import type { ScheduleImpactPreviewQueryDto } from '../schedule-lifecycle-impact/dto/schedule-impact-preview-query.dto';

export type EmployeeAuditMeta = RequestAuditMeta & { actorUserId: string };

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly scheduleImpact: ScheduleLifecycleImpactService,
  ) {}

  async list(query: EmployeeQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const wherePersonal: Record<string, unknown> = { deletedAt: null };
    if (query.statusId) wherePersonal.statusId = query.statusId;

    if (query.search) {
      const s = query.search.trim();
      wherePersonal.OR = [
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { username: { contains: s, mode: 'insensitive' } },
      ];
    }

    const whereEmployment: Record<string, unknown> = { deletedAt: null };
    if (query.jobTitleId) whereEmployment.jobTitleId = query.jobTitleId;
    if (query.roleId) whereEmployment.roleId = query.roleId;
    if (query.gradeId) whereEmployment.gradeId = query.gradeId;
    if (query.contractTypeId) whereEmployment.contractTypeId = query.contractTypeId;

    const whereEmployee: Record<string, unknown> = { deletedAt: null };

    /** Without employment filters, include rows that have not completed employment yet. */
    const hasEmploymentFilters = Boolean(
      query.jobTitleId || query.roleId || query.gradeId || query.contractTypeId,
    );
    const employmentWhere = hasEmploymentFilters
      ? { employment: { is: whereEmployment } }
      : {
          OR: [{ employment: null }, { employment: { is: whereEmployment } }],
        };

    const listWhere = {
      ...whereEmployee,
      personalDetail: { is: wherePersonal },
      ...employmentWhere,
    };

    const [total, rows] = await this.prisma.$transaction([
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
            },
          },
        },
        skip,
        take: limit,
        orderBy:
          query.sortBy === 'createdAt'
            ? { createdAt: query.sortOrder ?? 'desc' }
            : { updatedAt: query.sortOrder ?? 'desc' },
      }),
    ]);

    return {
      data: rows,
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getById(id: string, audit?: EmployeeAuditMeta) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null },
      include: {
        personalDetail: { include: { title: true, gender: true, nationality: true, status: true } },
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

    return { data: employee };
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
      await tx.employee.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
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
  async chartSummary() {
    const [activeStatus, inactiveStatus] = await Promise.all([
      this.prisma.employeeStatus.findFirst({
        where: { deletedAt: null, name: { equals: 'Active', mode: 'insensitive' } },
      }),
      this.prisma.employeeStatus.findFirst({
        where: { deletedAt: null, name: { equals: 'Inactive', mode: 'insensitive' } },
      }),
    ]);

    const employeeBase = { deletedAt: null, personalDetail: { deletedAt: null } };

    const [total, activeCount, inactiveCount] = await Promise.all([
      this.prisma.employee.count({ where: employeeBase }),
      activeStatus
        ? this.prisma.employee.count({
            where: {
              deletedAt: null,
              personalDetail: { deletedAt: null, statusId: activeStatus.id },
            },
          })
        : Promise.resolve(0),
      inactiveStatus
        ? this.prisma.employee.count({
            where: {
              deletedAt: null,
              personalDetail: { deletedAt: null, statusId: inactiveStatus.id },
            },
          })
        : Promise.resolve(0),
    ]);

    const horizon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Use SQL for aggregates so PostgreSQL compares timestamps in-DB. Loading `expiryDate` into
    // JS Dates can throw Prisma P2023 for values outside the JS Date range (e.g. distant years).
    const [complianceAgg] = await this.prisma.$queryRaw<
      { up_to_date: bigint; needs_attention: bigint }[]
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE c."expiryDate" IS NULL OR c."expiryDate" > ${horizon}
        ) AS up_to_date,
        COUNT(*) FILTER (
          WHERE c."expiryDate" IS NOT NULL AND c."expiryDate" <= ${horizon}
        ) AS needs_attention
      FROM "employees"."EmployeeCompliance" c
      WHERE c."deletedAt" IS NULL
        AND COALESCE(c."isNoLongerRequired", false) = false
    `);
    const complianceUpToDate = Number(complianceAgg?.up_to_date ?? 0);
    const complianceNeedsAttention = Number(complianceAgg?.needs_attention ?? 0);

    type SkillAggRow = { skillTypeId: string | null; cnt: bigint };
    const skillAggRows = await this.prisma.$queryRaw<SkillAggRow[]>(Prisma.sql`
      SELECT s."skillTypeId", COUNT(*)::bigint AS cnt
      FROM "employees"."EmployeeSkill" s
      WHERE s."deletedAt" IS NULL
      GROUP BY s."skillTypeId"
    `);
    const skillTypeIds = skillAggRows.map(r => r.skillTypeId).filter((id): id is string => id !== null);
    const skillTypes =
      skillTypeIds.length > 0
        ? await this.prisma.skillType.findMany({
            where: { id: { in: skillTypeIds }, deletedAt: null },
            select: { id: true, name: true },
          })
        : [];
    const skillNameById = Object.fromEntries(skillTypes.map(t => [t.id, t.name]));
    const skillsPie = [...skillAggRows]
      .sort((a, b) => Number(b.cnt) - Number(a.cnt))
      .slice(0, 12)
      .map((g, i) => ({
        name: g.skillTypeId ? skillNameById[g.skillTypeId] ?? 'Unknown' : 'Unspecified',
        value: Number(g.cnt),
        color: `hsl(${(i * 29) % 360}, 58%, 48%)`,
      }));

    type ReviewStatusRow = { status: string | null };
    const reviewStatusRows = await this.prisma.$queryRaw<ReviewStatusRow[]>(Prisma.sql`
      SELECT r."status" AS status
      FROM "employees"."EmployeeReview" r
      WHERE r."deletedAt" IS NULL
    `);
    let reviewsReviewed = 0;
    let reviewsOutstanding = 0;
    const doneTokens = ['published', 'complete', 'completed', 'reviewed', 'signed'];
    for (const r of reviewStatusRows) {
      const s = (r.status ?? '').toLowerCase();
      if (doneTokens.some(t => s.includes(t))) {
        reviewsReviewed += 1;
      } else {
        reviewsOutstanding += 1;
      }
    }

    return {
      data: {
        staff: {
          total,
          active: activeCount,
          inactive: inactiveCount,
        },
        compliance: {
          upToDate: complianceUpToDate,
          needsAttention: complianceNeedsAttention,
        },
        skills: skillsPie,
        reviews: {
          reviewed: reviewsReviewed,
          outstanding: reviewsOutstanding,
        },
      },
    };
  }

  /** All employee documents (non-deleted employees only) for the General Employee Documents screen. */
  async listDocumentsRegistry() {
    const rows = await this.prisma.employeeDocument.findMany({
      where: {
        deletedAt: null,
        employee: { deletedAt: null },
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
}
