import { Injectable } from '@nestjs/common';
import { DataAccessType, EmployeeComplianceStatus, Prisma, type ComplianceRequirement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { calculateComplianceStatus } from '../employee-compliance/compliance-status.calculator';
import {
  employmentDimsFromEmployment,
  pickBestRequirementsPerType,
} from '../employee-compliance/compliance-requirement.matcher';
import { EmployeeComplianceReportQueryDto } from './dto/employee-compliance-report-query.dto';

type RequirementWithType = Prisma.ComplianceRequirementGetPayload<{
  include: { complianceType: true };
}>;

const complianceInclude = {
  complianceType: true,
  requirement: true,
  documents: { where: { deletedAt: null } },
} satisfies Prisma.EmployeeComplianceInclude;

type CompRow = Prisma.EmployeeComplianceGetPayload<{ include: typeof complianceInclude }>;

@Injectable()
export class ComplianceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private statusOf(row: CompRow): EmployeeComplianceStatus {
    const t = row.complianceType;
    const renewal = row.requirement?.renewalBeforeDays ?? 30;
    const hasDoc = (row.documents?.length ?? 0) > 0;
    return calculateComplianceStatus(
      {
        rejectedAt: row.rejectedAt,
        submittedAt: row.submittedAt,
        verifiedAt: row.verifiedAt,
        expiryDate: row.expiryDate,
        issueDate: row.issueDate,
        isNoLongerRequired: row.isNoLongerRequired,
        documentUrl: row.documentUrl,
      },
      t
        ? {
            hasExpiry: t.hasExpiry,
            requiresDocument: t.requiresDocument,
            requiresVerification: t.requiresVerification,
          }
        : null,
      renewal,
      hasDoc,
    );
  }

  private employeeWhere(query: EmployeeComplianceReportQueryDto): Prisma.EmployeeWhereInput {
    const w: Prisma.EmployeeWhereInput = { deletedAt: null };
    if (!query.includeInactiveEmployees) w.isActive = true;
    if (query.employeeId) w.id = query.employeeId;

    const hasEmploymentScope = Boolean(
      query.roleId || query.workAreaId || query.jobTitleId || query.contractTypeId || query.locationId,
    );
    if (hasEmploymentScope) {
      const empFilters: Prisma.EmployeeEmploymentWhereInput = { deletedAt: null };
      if (query.roleId) empFilters.roleId = query.roleId;
      if (query.workAreaId) empFilters.workAreaId = query.workAreaId;
      if (query.jobTitleId) empFilters.jobTitleId = query.jobTitleId;
      if (query.contractTypeId) empFilters.contractTypeId = query.contractTypeId;
      if (query.locationId) {
        empFilters.OR = [{ locationId: query.locationId }, { baseLocationId: query.locationId }];
      }
      w.employment = { is: empFilters };
    }
    return w;
  }

  private async logReportView(userId: string | undefined, kind: string, meta?: RequestAuditMeta, count?: number) {
    if (!userId) return;
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.COMPLIANCE_REPORT,
      recordType: 'EmployeeComplianceReport',
      recordId: kind,
      accessType: DataAccessType.VIEW,
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
      metadata: { count },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.COMPLIANCE_REPORT,
      action: AuditAction.EMPLOYEE_COMPLIANCE_REPORT_VIEWED,
      recordType: 'EmployeeComplianceReport',
      recordId: kind,
      metadata: { count },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
  }

  async summary(query: EmployeeComplianceReportQueryDto, audit?: RequestAuditMeta & { actorUserId?: string }) {
    const employees = await this.loadEmployeesForReports(query);
    const allReqs = (await this.prisma.complianceRequirement.findMany({
      where: { deletedAt: null, isActive: true, complianceType: { deletedAt: null, isActive: true } },
      include: { complianceType: true },
    })) as RequirementWithType[];

    let totalRequired = 0;
    const counts: Record<string, number> = {
      valid: 0,
      missing: 0,
      expired: 0,
      expiringSoon: 0,
      pendingReview: 0,
      rejected: 0,
      noLongerRequired: 0,
      submitted: 0,
      required: 0,
      notRequired: 0,
    };

    for (const emp of employees) {
      if (!emp.employment) continue;
      const best = pickBestRequirementsPerType(
        allReqs as unknown as ComplianceRequirement[],
        employmentDimsFromEmployment(emp.employment),
      );
      for (const [, req] of best) {
        const type = (req as RequirementWithType).complianceType;
        if (query.complianceTypeId && type?.id !== query.complianceTypeId) continue;
        if (query.category && type?.category !== query.category) continue;
        totalRequired++;
        const row = emp.complianceRecords.find((c) => c.complianceTypeId === req.complianceTypeId);
        if (!row) {
          counts.missing++;
          continue;
        }
        if (query.hideNoLongerRequired && row.isNoLongerRequired) {
          counts.noLongerRequired++;
          continue;
        }
        const st = this.statusOf(row as CompRow);
        this.incrementCount(counts, st);
      }
    }

    await this.logReportView(audit?.actorUserId, 'summary', audit, totalRequired);
    return {
      data: {
        totalRequired,
        valid: counts.valid,
        missing: counts.missing,
        expired: counts.expired,
        expiringSoon: counts.expiringSoon,
        pendingReview: counts.pendingReview,
        rejected: counts.rejected,
        noLongerRequired: counts.noLongerRequired,
      },
    };
  }

  private incrementCount(counts: Record<string, number>, st: EmployeeComplianceStatus) {
    switch (st) {
      case EmployeeComplianceStatus.VALID:
        counts.valid++;
        break;
      case EmployeeComplianceStatus.MISSING:
        counts.missing++;
        break;
      case EmployeeComplianceStatus.EXPIRED:
        counts.expired++;
        break;
      case EmployeeComplianceStatus.EXPIRING_SOON:
        counts.expiringSoon++;
        break;
      case EmployeeComplianceStatus.PENDING_REVIEW:
        counts.pendingReview++;
        break;
      case EmployeeComplianceStatus.REJECTED:
        counts.rejected++;
        break;
      case EmployeeComplianceStatus.NO_LONGER_REQUIRED:
        counts.noLongerRequired++;
        break;
      case EmployeeComplianceStatus.SUBMITTED:
        counts.submitted++;
        break;
      case EmployeeComplianceStatus.REQUIRED:
        counts.required++;
        break;
      case EmployeeComplianceStatus.NOT_REQUIRED:
        counts.notRequired++;
        break;
      default:
        break;
    }
  }

  private async loadEmployeesForReports(query: EmployeeComplianceReportQueryDto) {
    return this.prisma.employee.findMany({
      where: this.employeeWhere(query),
      include: {
        personalDetail: true,
        employment: {
          include: {
            role: true,
            workArea: true,
            jobTitle: true,
            contractType: true,
            location: true,
            baseLocation: true,
          },
        },
        complianceRecords: {
          where: { deletedAt: null },
          include: complianceInclude,
        },
      },
    });
  }

  async missing(query: EmployeeComplianceReportQueryDto, audit?: RequestAuditMeta & { actorUserId?: string }) {
    const employees = await this.loadEmployeesForReports(query);
    const allReqs = (await this.prisma.complianceRequirement.findMany({
      where: { deletedAt: null, isActive: true, complianceType: { deletedAt: null, isActive: true } },
      include: { complianceType: true },
    })) as RequirementWithType[];
    const rows: unknown[] = [];
    for (const emp of employees) {
      if (!emp.employment) continue;
      const best = pickBestRequirementsPerType(
        allReqs as unknown as ComplianceRequirement[],
        employmentDimsFromEmployment(emp.employment),
      );
      for (const [typeId, req] of best) {
        const type = (req as RequirementWithType).complianceType;
        if (query.complianceTypeId && typeId !== query.complianceTypeId) continue;
        if (query.category && type?.category !== query.category) continue;
        const row = emp.complianceRecords.find((c) => c.complianceTypeId === typeId) as CompRow | undefined;
        if (!row) {
          rows.push({
            employeeId: emp.id,
            employeeName: this.empName(emp),
            complianceTypeId: typeId,
            complianceTypeName: type?.name,
            requirementId: req.id,
            gap: 'NO_RECORD',
            effectiveStatus: EmployeeComplianceStatus.MISSING,
          });
          continue;
        }
        if (query.hideNoLongerRequired && row.isNoLongerRequired) continue;
        const st = this.statusOf(row);
        if (st === EmployeeComplianceStatus.MISSING || st === EmployeeComplianceStatus.REQUIRED) {
          rows.push({
            employeeId: emp.id,
            employeeName: this.empName(emp),
            complianceTypeId: typeId,
            complianceTypeName: type?.name,
            employeeComplianceId: row.id,
            requirementId: req.id,
            gap: st,
            effectiveStatus: st,
          });
        }
      }
    }
    await this.logReportView(audit?.actorUserId, 'missing', audit, rows.length);
    return this.paginate(rows, query);
  }

  async expired(query: EmployeeComplianceReportQueryDto, audit?: RequestAuditMeta & { actorUserId?: string }) {
    const rows = await this.filterRecordsByStatus(query, EmployeeComplianceStatus.EXPIRED);
    await this.logReportView(audit?.actorUserId, 'expired', audit, rows.data.length);
    return rows;
  }

  async expiring(query: EmployeeComplianceReportQueryDto, audit?: RequestAuditMeta & { actorUserId?: string }) {
    const rows = await this.filterRecordsByStatus(query, EmployeeComplianceStatus.EXPIRING_SOON);
    await this.logReportView(audit?.actorUserId, 'expiring', audit, rows.data.length);
    return rows;
  }

  async pendingReview(query: EmployeeComplianceReportQueryDto, audit?: RequestAuditMeta & { actorUserId?: string }) {
    const rows = await this.filterRecordsByStatus(query, EmployeeComplianceStatus.PENDING_REVIEW);
    await this.logReportView(audit?.actorUserId, 'pending-review', audit, rows.data.length);
    return rows;
  }

  private async filterRecordsByStatus(
    query: EmployeeComplianceReportQueryDto,
    want: EmployeeComplianceStatus,
  ) {
    const employees = await this.loadEmployeesForReports(query);
    const out: unknown[] = [];
    for (const emp of employees) {
      for (const raw of emp.complianceRecords) {
        const row = raw as CompRow;
        if (query.hideNoLongerRequired && row.isNoLongerRequired) continue;
        if (query.complianceTypeId && row.complianceTypeId !== query.complianceTypeId) continue;
        if (query.category && row.complianceType?.category !== query.category) continue;
        if (this.statusOf(row) !== want) continue;
        if (query.expiryDateFrom && row.expiryDate && row.expiryDate < query.expiryDateFrom) continue;
        if (query.expiryDateTo && row.expiryDate && row.expiryDate > query.expiryDateTo) continue;
        out.push({
          employeeId: emp.id,
          employeeName: this.empName(emp),
          employeeComplianceId: row.id,
          complianceType: row.complianceType,
          expiryDate: row.expiryDate,
          effectiveStatus: want,
        });
      }
    }
    return this.paginate(out, query);
  }

  async report(query: EmployeeComplianceReportQueryDto, audit?: RequestAuditMeta & { actorUserId?: string }) {
    const [miss, exp, expSoon, pend] = await Promise.all([
      this.missing(query, audit),
      this.expired(query, audit),
      this.expiring(query, audit),
      this.pendingReview(query, audit),
    ]);
    await this.logReportView(audit?.actorUserId, 'report', audit, undefined);
    return {
      data: {
        missing: miss,
        expired: exp,
        expiringSoon: expSoon,
        pendingReview: pend,
      },
    };
  }

  async detailReport(query: EmployeeComplianceReportQueryDto, audit?: RequestAuditMeta & { actorUserId?: string }) {
    const employees = await this.loadEmployeesForReports(query);
    const allReqs = (await this.prisma.complianceRequirement.findMany({
      where: { deletedAt: null, isActive: true, complianceType: { deletedAt: null, isActive: true } },
      include: { complianceType: true },
    })) as RequirementWithType[];
    const items: unknown[] = [];
    for (const emp of employees) {
      if (!emp.employment) continue;
      const best = pickBestRequirementsPerType(
        allReqs as unknown as ComplianceRequirement[],
        employmentDimsFromEmployment(emp.employment),
      );
      for (const [typeId, req] of best) {
        const type = (req as RequirementWithType).complianceType;
        if (query.complianceTypeId && typeId !== query.complianceTypeId) continue;
        if (query.category && type?.category !== query.category) continue;
        const row = emp.complianceRecords.find((c) => c.complianceTypeId === typeId) as CompRow | undefined;
        if (!row) {
          if (query.status && query.status !== EmployeeComplianceStatus.MISSING) continue;
          items.push({
            employeeId: emp.id,
            employeeName: this.empName(emp),
            complianceTypeId: typeId,
            complianceTypeName: type?.name,
            requirementId: req.id,
            effectiveStatus: EmployeeComplianceStatus.MISSING,
            employeeComplianceId: null,
          });
          continue;
        }
        if (query.hideNoLongerRequired && row.isNoLongerRequired) continue;
        const st = this.statusOf(row);
        if (query.status && st !== query.status) continue;
        const detailSet = new Set<EmployeeComplianceStatus>([
          EmployeeComplianceStatus.MISSING,
          EmployeeComplianceStatus.REQUIRED,
          EmployeeComplianceStatus.EXPIRED,
          EmployeeComplianceStatus.EXPIRING_SOON,
          EmployeeComplianceStatus.PENDING_REVIEW,
          EmployeeComplianceStatus.REJECTED,
        ]);
        if (!query.status && !detailSet.has(st)) continue;
        items.push({
          employeeId: emp.id,
          employeeName: this.empName(emp),
          complianceTypeId: typeId,
          complianceTypeName: type?.name,
          requirementId: req.id,
          employeeComplianceId: row.id,
          effectiveStatus: st,
          expiryDate: row.expiryDate,
          verifiedAt: row.verifiedAt,
          rejectedAt: row.rejectedAt,
        });
      }
    }
    await this.logReportView(audit?.actorUserId, 'detail-report', audit, items.length);
    return this.paginate(items, query);
  }

  private empName(emp: { personalDetail: { firstName: string; lastName: string } | null }) {
    const p = emp.personalDetail;
    if (!p) return '—';
    return `${p.firstName} ${p.lastName}`.trim();
  }

  private paginate<T>(items: T[], query: EmployeeComplianceReportQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const total = items.length;
    const start = (page - 1) * limit;
    const data = items.slice(start, start + limit);
    return { data, meta: buildPaginationMeta({ page, limit, total }) };
  }
}
