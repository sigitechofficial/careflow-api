import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeLifecycleStatus, HrDeploymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AllocationComplianceService } from '../employee-compliance/allocation-compliance.service';
import { EMPTY_COMPLIANCE_ALLOCATION_RESULT } from '../employee-compliance/allocation-compliance.util';
import { complianceReadiness, worstDeployment, type ComplianceReadiness } from './utils/hr-compliance-readiness.util';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CreateHrProfileDto } from './dto/create-hr-profile.dto';
import { HrEmployeeListQueryDto } from './dto/hr-employee-list-query.dto';
import { UpdateHrProfileDto } from './dto/update-hr-profile.dto';
import {
  mapHrEmployeeListRow,
  mapHrProfileResponse,
} from './mappers/hr-profile.mapper';

const HR_EMPLOYEE_INCLUDE = {
  personalDetail: { include: { status: true } },
  employment: {
    include: {
      jobTitle: true,
      contractType: true,
      location: true,
    },
  },
  hrProfile: {
    include: {
      reportingManager: {
        include: {
          personalDetail: { select: { firstName: true, lastName: true } },
        },
      },
    },
  },
  emergencyContacts: {
    where: { deletedAt: null, isActive: true },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.EmployeeInclude;

type Readiness = Map<string, { compliance: ComplianceReadiness; deploymentStatus: HrDeploymentStatus }>;

@Injectable()
export class HrProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly allocationCompliance: AllocationComplianceService,
  ) {}

  /**
   * Readiness = the worse of what HR set and what mandatory compliance says (the same check the
   * rota uses), so an expired DBS shows as Red even when HR left the person Green.
   */
  private async readiness(
    employees: { id: string; hr: HrDeploymentStatus }[],
  ): Promise<Readiness> {
    const results = await this.allocationCompliance.evaluateForEmployees(employees.map((e) => e.id));
    return new Map(
      employees.map((e) => {
        const compliance = complianceReadiness(results.get(e.id) ?? EMPTY_COMPLIANCE_ALLOCATION_RESULT);
        return [e.id, { compliance, deploymentStatus: worstDeployment(e.hr, compliance.level) }];
      }),
    );
  }

  private employeeInclude = HR_EMPLOYEE_INCLUDE;

  async list(query: HrEmployeeListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    // An employee without an HR profile is shown as Active / Green, so the filters treat them the same way.
    const statusFilters: Prisma.EmployeeWhereInput[] = [];
    if (query.employeeLifecycleStatus) {
      const match = { hrProfile: { is: { employeeLifecycleStatus: query.employeeLifecycleStatus } } };
      statusFilters.push(
        query.employeeLifecycleStatus === EmployeeLifecycleStatus.ACTIVE
          ? { OR: [{ hrProfile: { is: null } }, match] }
          : match,
      );
    }
    // The deployment filter is on readiness (HR status and compliance), applied below.

    const where: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      ...(statusFilters.length ? { AND: statusFilters } : {}),
      ...(search
        ? {
            OR: [
              {
                personalDetail: {
                  OR: [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
              {
                employment: {
                  OR: [
                    { employeeNumber: { contains: search, mode: 'insensitive' } },
                    {
                      jobTitle: {
                        name: { contains: search, mode: 'insensitive' },
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.EmployeeOrderByWithRelationInput[] = [
      { personalDetail: { lastName: 'asc' } },
      { personalDetail: { firstName: 'asc' } },
    ];
    let total: number;
    let rows: Prisma.EmployeeGetPayload<{ include: typeof HR_EMPLOYEE_INCLUDE }>[];
    let readiness: Readiness;
    if (query.deploymentStatus) {
      // Readiness depends on compliance, so work it out for everyone matching, then page.
      const all = await this.prisma.employee.findMany({
        where,
        select: { id: true, hrProfile: { select: { deploymentStatus: true } } },
        orderBy,
      });
      readiness = await this.readiness(
        all.map((e) => ({ id: e.id, hr: e.hrProfile?.deploymentStatus ?? HrDeploymentStatus.GREEN })),
      );
      const ids = all.filter((e) => readiness.get(e.id)?.deploymentStatus === query.deploymentStatus).map((e) => e.id);
      total = ids.length;
      const pageIds = ids.slice(skip, skip + limit);
      const found = await this.prisma.employee.findMany({ where: { id: { in: pageIds } }, include: this.employeeInclude });
      const byId = new Map(found.map((r) => [r.id, r]));
      rows = pageIds.flatMap((id) => byId.get(id) ?? []);
    } else {
      [total, rows] = await this.prisma.$transaction([
        this.prisma.employee.count({ where }),
        this.prisma.employee.findMany({ where, include: this.employeeInclude, skip, take: limit, orderBy }),
      ]);
      readiness = await this.readiness(
        rows.map((r) => ({ id: r.id, hr: r.hrProfile?.deploymentStatus ?? HrDeploymentStatus.GREEN })),
      );
    }

    return {
      data: rows.map((row) => ({
        ...mapHrEmployeeListRow({
          employee: row,
          personalDetail: row.personalDetail,
          employment: row.employment,
          hrProfile: row.hrProfile,
          emergencyContacts: row.emergencyContacts,
        }),
        readinessStatus: readiness.get(row.id)?.deploymentStatus ?? HrDeploymentStatus.GREEN,
        compliance: readiness.get(row.id)?.compliance ?? { level: HrDeploymentStatus.GREEN, issues: [] },
      })),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  /**
   * Head counts for the HR dashboard: by lifecycle, and by readiness (the worse of the HR status and
   * compliance). No HR profile = Active / Green. `complianceFlagged`: people compliance makes worse
   * than HR has them.
   */
  async summary() {
    const [employees, byLifecycle] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where: { deletedAt: null },
        select: { id: true, hrProfile: { select: { deploymentStatus: true } } },
      }),
      this.prisma.employeeHRProfile.groupBy({
        by: ['employeeLifecycleStatus'],
        where: { employee: { deletedAt: null } },
        orderBy: { employeeLifecycleStatus: 'asc' },
        _count: { _all: true },
      }),
    ]);
    const total = employees.length;

    const countOf = (g: { _count?: unknown }) =>
      typeof g._count === 'object' && g._count !== null ? ((g._count as { _all?: number })._all ?? 0) : 0;
    const withProfile = byLifecycle.reduce((sum, g) => sum + countOf(g), 0);
    const withoutProfile = Math.max(0, total - withProfile);

    const lifecycle = Object.fromEntries(
      Object.values(EmployeeLifecycleStatus).map((s) => [s, 0]),
    ) as Record<EmployeeLifecycleStatus, number>;
    for (const g of byLifecycle) lifecycle[g.employeeLifecycleStatus] = countOf(g);
    lifecycle.ACTIVE += withoutProfile;

    const hrOf = (e: (typeof employees)[number]) => e.hrProfile?.deploymentStatus ?? HrDeploymentStatus.GREEN;
    const readiness = await this.readiness(employees.map((e) => ({ id: e.id, hr: hrOf(e) })));
    const deployment = Object.fromEntries(
      Object.values(HrDeploymentStatus).map((s) => [s, 0]),
    ) as Record<HrDeploymentStatus, number>;
    let complianceFlagged = 0;
    for (const e of employees) {
      const r = readiness.get(e.id);
      const status = r?.deploymentStatus ?? hrOf(e);
      deployment[status] += 1;
      if (status !== hrOf(e)) complianceFlagged += 1;
    }

    return { data: { total, lifecycle, deployment, complianceFlagged } };
  }

  private async loadAggregate(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: this.employeeInclude,
    });
    if (!employee) throw new NotFoundException('Employee not found');

    return mapHrProfileResponse({
      employee,
      personalDetail: employee.personalDetail,
      employment: employee.employment,
      hrProfile: employee.hrProfile,
      emergencyContacts: employee.emergencyContacts,
    });
  }

  async getProfile(employeeId: string) {
    return { data: await this.loadAggregate(employeeId) };
  }

  async createProfile(
    userId: string,
    employeeId: string,
    dto: CreateHrProfileDto,
    meta?: RequestAuditMeta,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: { hrProfile: true, employment: true, personalDetail: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.hrProfile && employee.hrProfile.deletedAt == null) {
      throw new ConflictException('HR profile already exists for this employee');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.applySharedUpdates(tx, userId, employeeId, dto);
      await tx.employeeHRProfile.upsert({
        where: { employeeId },
        update: {
          ...this.buildHrProfileFields(dto),
          deletedAt: null,
          isActive: true,
          updatedById: userId,
        },
        create: {
          employeeId,
          ...this.buildHrProfileCreateFields(dto),
          createdById: userId,
        },
      });
      await this.logChanges(tx, userId, employee, dto, AuditAction.HR_PROFILE_CREATED, meta);
    });

    return {
      message: 'HR profile created',
      data: await this.loadAggregate(employeeId),
    };
  }

  async updateProfile(
    userId: string,
    employeeId: string,
    dto: UpdateHrProfileDto,
    meta?: RequestAuditMeta,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: { hrProfile: true, employment: true, personalDetail: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    await this.prisma.$transaction(async (tx) => {
      await this.applySharedUpdates(tx, userId, employeeId, dto);

      const hrFields = this.buildHrProfileFields(dto);
      if (Object.keys(hrFields).length > 0 || !employee.hrProfile) {
        await tx.employeeHRProfile.upsert({
          where: { employeeId },
          update: {
            ...hrFields,
            deletedAt: null,
            isActive: true,
            updatedById: userId,
          },
          create: {
            employeeId,
            ...this.buildHrProfileCreateFields(dto),
            createdById: userId,
          },
        });
      }
      await this.logChanges(tx, userId, employee, dto, AuditAction.HR_PROFILE_UPDATED, meta);
    });

    return {
      message: 'HR profile updated',
      data: await this.loadAggregate(employeeId),
    };
  }

  /**
   * Audit what actually changed, with old and new values (status, manager, job, ...), so the
   * record shows who changed what and when. An update that changes nothing is not logged.
   */
  private async logChanges(
    tx: Prisma.TransactionClient,
    userId: string,
    before: { id: string; hrProfile: object | null; employment: object | null; personalDetail: object | null },
    dto: CreateHrProfileDto | UpdateHrProfileDto,
    action: AuditAction.HR_PROFILE_CREATED | AuditAction.HR_PROFILE_UPDATED,
    meta?: RequestAuditMeta,
  ) {
    const changes: Record<string, unknown> = {
      ...this.buildHrProfileFields(dto),
      ...this.buildEmploymentFields(dto),
      ...this.buildPersonalFields(dto),
    };
    const sources = [before.hrProfile, before.employment, before.personalDetail] as (Record<string, unknown> | null)[];
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      const old = sources.find((s) => s && key in s)?.[key] ?? null;
      if (JSON.stringify(old) === JSON.stringify(value ?? null)) continue;
      oldValues[key] = old;
      newValues[key] = value ?? null;
    }
    if (action === AuditAction.HR_PROFILE_UPDATED && Object.keys(newValues).length === 0) return;

    await this.audit.logAudit({
      tx,
      userId,
      module: AuditModule.HR,
      action,
      recordType: 'Employee',
      recordId: before.id,
      oldValues: auditSnapshot(oldValues),
      newValues: auditSnapshot(newValues),
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
  }

  private buildHrProfileCreateFields(
    dto: CreateHrProfileDto | UpdateHrProfileDto,
  ): Omit<Prisma.EmployeeHRProfileUncheckedCreateInput, 'employeeId' | 'createdById'> {
    return this.buildHrProfileFields(dto) as Omit<
      Prisma.EmployeeHRProfileUncheckedCreateInput,
      'employeeId' | 'createdById'
    >;
  }

  private buildHrProfileFields(
    dto: CreateHrProfileDto | UpdateHrProfileDto,
  ): Prisma.EmployeeHRProfileUncheckedUpdateInput {
    const data: Prisma.EmployeeHRProfileUncheckedUpdateInput = {};
    if (dto.legalName !== undefined) data.legalName = dto.legalName;
    if (dto.preferredName !== undefined) data.preferredName = dto.preferredName;
    if (dto.careWorkforceCategory !== undefined) {
      data.careWorkforceCategory = dto.careWorkforceCategory;
    }
    if (dto.employeeLifecycleStatus !== undefined) {
      data.employeeLifecycleStatus = dto.employeeLifecycleStatus;
    }
    if (dto.deploymentStatus !== undefined) data.deploymentStatus = dto.deploymentStatus;
    if (dto.reportingManagerId !== undefined) {
      data.reportingManagerId = dto.reportingManagerId;
    }
    if (dto.branchTeam !== undefined) data.branchTeam = dto.branchTeam;
    return data;
  }

  private buildEmploymentCreateFields(
    dto: CreateHrProfileDto | UpdateHrProfileDto,
  ): Omit<Prisma.EmployeeEmploymentUncheckedCreateInput, 'employeeId' | 'createdById'> {
    return this.buildEmploymentFields(dto) as Omit<
      Prisma.EmployeeEmploymentUncheckedCreateInput,
      'employeeId' | 'createdById'
    >;
  }

  private async applySharedUpdates(
    tx: Prisma.TransactionClient,
    userId: string,
    employeeId: string,
    dto: CreateHrProfileDto | UpdateHrProfileDto,
  ) {
    const personalFields = this.buildPersonalFields(dto);
    if (Object.keys(personalFields).length > 0) {
      const existing = await tx.employeePersonalDetail.findUnique({
        where: { employeeId },
      });
      if (existing) {
        await tx.employeePersonalDetail.update({
          where: { employeeId },
          data: { ...personalFields, updatedById: userId },
        });
      }
    }

    const employmentFields = this.buildEmploymentFields(dto);
    if (Object.keys(employmentFields).length > 0) {
      await tx.employeeEmployment.upsert({
        where: { employeeId },
        update: { ...employmentFields, updatedById: userId },
        create: {
          employeeId,
          ...this.buildEmploymentCreateFields(dto),
          createdById: userId,
        },
      });
    }

    if (dto.reportingManagerId) {
      const manager = await tx.employee.findFirst({
        where: { id: dto.reportingManagerId, deletedAt: null },
      });
      if (!manager) throw new NotFoundException('Reporting manager not found');
      if (dto.reportingManagerId === employeeId) {
        throw new ConflictException('Employee cannot be their own reporting manager');
      }
    }
  }

  private buildPersonalFields(
    dto: CreateHrProfileDto | UpdateHrProfileDto,
  ): Prisma.EmployeePersonalDetailUncheckedUpdateInput {
    const data: Prisma.EmployeePersonalDetailUncheckedUpdateInput = {};
    if (dto.dateOfBirth !== undefined) data.dateOfBirth = dto.dateOfBirth;
    if (dto.profilePhoto !== undefined) data.photoUrl = dto.profilePhoto;
    return data;
  }

  private buildEmploymentFields(
    dto: CreateHrProfileDto | UpdateHrProfileDto,
  ): Prisma.EmployeeEmploymentUncheckedUpdateInput {
    const data: Prisma.EmployeeEmploymentUncheckedUpdateInput = {};
    if (dto.jobTitleId !== undefined) data.jobTitleId = dto.jobTitleId;
    if (dto.contractTypeId !== undefined) data.contractTypeId = dto.contractTypeId;
    if (dto.branchLocationId !== undefined) data.locationId = dto.branchLocationId;
    if (dto.employmentStartDate !== undefined) data.startDate = dto.employmentStartDate;
    return data;
  }
}
