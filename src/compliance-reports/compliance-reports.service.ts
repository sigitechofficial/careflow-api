import { Injectable } from '@nestjs/common';
import { DataAccessType, EmployeeComplianceStatus, Prisma, type ComplianceRequirement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  calculateComplianceStatus,
  startOfUtcDay,
} from '../employee-compliance/compliance-status.calculator';
import {
  employmentDimsFromEmployment,
  pickBestRequirementsPerType,
} from '../employee-compliance/compliance-requirement.matcher';
import {
  applyImmigrationRtwRequirementFlags,
  isImmigrationRtwDocCode,
  matchesNeedsImmigrationRtwFilter,
  requiresImmigrationRtwDocuments,
} from '../employee-compliance/immigration-rtw-requirement.util';
import { AllocationComplianceService } from '../employee-compliance/allocation-compliance.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { collectReviewDues, reviewKey } from '../employee-reviews/review-dues';
import { deriveReviewStatus } from '../employee-reviews/employee-review-schedule.util';
import { EmployeeComplianceReportQueryDto } from './dto/employee-compliance-report-query.dto';
import {
  buildBoardEmployeeSummaries,
  cellMatchesDocumentState,
  computeCompliancePercent,
  computeNextAction,
  computeOverallDisplayStatus,
  countBoardIssues,
  countOffBoardAllocationIssues,
  nearestExpiry,
  urgencySortKey,
  type BoardCellLike,
} from './compliance-board-enrichment.util';

type RequirementWithType = Prisma.ComplianceRequirementGetPayload<{
  include: { complianceType: true };
}>;

const complianceInclude = {
  complianceType: true,
  requirement: true,
  documents: { where: { deletedAt: null } },
} satisfies Prisma.EmployeeComplianceInclude;

type CompRow = Prisma.EmployeeComplianceGetPayload<{ include: typeof complianceInclude }>;

/**
 * Stable board columns for care workforce (short labels for the matrix header). DOCUMENT columns
 * come from compliance documents; REVIEW columns from the staff review schedule (supervision,
 * appraisal, probation are reviews, not documents), keyed by ReviewType.code.
 */
const BOARD_COLUMN_DEFS: Array<{
  code: string;
  shortLabel: string;
  group: string;
  source?: 'DOCUMENT' | 'REVIEW';
}> = [
  { code: 'DBS', shortLabel: 'DBS', group: 'IDENTITY & RIGHT TO WORK' },
  { code: 'DBS_CODE', shortLabel: 'DBS CODE', group: 'IDENTITY & RIGHT TO WORK' },
  { code: 'BIOMETRIC_CARD', shortLabel: 'RTW', group: 'IDENTITY & RIGHT TO WORK' },
  { code: 'ANNUAL_APPRAISAL', shortLabel: 'APPRSL', group: 'PERFORMANCE', source: 'REVIEW' },
  { code: 'SUPERVISION', shortLabel: 'SUPVSN', group: 'PERFORMANCE', source: 'REVIEW' },
  { code: 'REFERENCE_1', shortLabel: 'REF 1', group: 'REFERENCES' },
  { code: 'REFERENCE_2', shortLabel: 'REF 2', group: 'REFERENCES' },
  { code: 'MEDICAL_QUESTIONNAIRE', shortLabel: 'MED', group: 'EMPLOYMENT' },
  { code: 'ID_PASSPORT', shortLabel: 'ID', group: 'EMPLOYMENT' },
  { code: 'INDUCTION_CHECKLIST', shortLabel: 'INDUCT', group: 'EMPLOYMENT' },
  { code: 'EMPLOYMENT_CONTRACT', shortLabel: 'CONTRACT', group: 'EMPLOYMENT' },
  { code: 'PROBATION_REVIEW', shortLabel: 'PROB', group: 'EMPLOYMENT', source: 'REVIEW' },
];

/** Review due status → the board's document vocabulary (overdue reads as expired, and so on). */
const REVIEW_TO_BOARD_STATUS = {
  OVERDUE: EmployeeComplianceStatus.EXPIRED,
  DUE_SOON: EmployeeComplianceStatus.EXPIRING_SOON,
  SCHEDULED: EmployeeComplianceStatus.VALID,
  COMPLETED: EmployeeComplianceStatus.VALID,
} as const;

const CRITICAL_BOARD_STATUSES = new Set<EmployeeComplianceStatus>([
  EmployeeComplianceStatus.MISSING,
  EmployeeComplianceStatus.REQUIRED,
  EmployeeComplianceStatus.EXPIRED,
  EmployeeComplianceStatus.REJECTED,
]);

function daysRemaining(expiryDate: Date | null | undefined, today: Date): number | null {
  if (!expiryDate) return null;
  const t0 = startOfUtcDay(today).getTime();
  const exp = startOfUtcDay(expiryDate).getTime();
  return Math.round((exp - t0) / 86_400_000);
}

@Injectable()
export class ComplianceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly allocation: AllocationComplianceService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
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
      query.roleId ||
        query.workAreaId ||
        query.jobTitleId ||
        query.contractTypeId ||
        query.locationId ||
        query.visaTypeIds?.length,
    );
    if (hasEmploymentScope) {
      const empFilters: Prisma.EmployeeEmploymentWhereInput = { deletedAt: null };
      if (query.roleId) empFilters.roleId = query.roleId;
      if (query.workAreaId) empFilters.workAreaId = query.workAreaId;
      if (query.jobTitleId) empFilters.jobTitleId = query.jobTitleId;
      if (query.contractTypeId) empFilters.contractTypeId = query.contractTypeId;
      if (query.visaTypeIds?.length) empFilters.visaTypeId = { in: query.visaTypeIds };
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
    const employees = await this.prisma.employee.findMany({
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
    return employees.filter((emp) =>
      matchesNeedsImmigrationRtwFilter(emp.employment?.visaTypeId, query.needsImmigrationRtw),
    );
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
        const { isMandatory, blocksAllocation } = applyImmigrationRtwRequirementFlags(
          type?.code,
          emp.employment.visaTypeId,
          {
            isMandatory: Boolean(req.isMandatory),
            blocksAllocation: Boolean(
              (req as RequirementWithType & { blocksAllocation?: boolean }).blocksAllocation,
            ),
          },
        );
        // Skip immigration RTW gaps for British/Irish (etc.) when no mandatory requirement.
        if (!isMandatory && !blocksAllocation && isImmigrationRtwDocCode(type?.code)) continue;

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

  /**
   * Staff compliance board: employee × preferred compliance types, days remaining,
   * and allocation Blocked/Clear (reuses existing status + allocation engines).
   */
  /**
   * Per-person compliance status for charts: the board's own Compliant / Attention / Blocked, so a
   * chart and the board always agree. Not logged as a report view.
   */
  async statusCounts(employeeIds: string[]) {
    const ids = new Set(employeeIds);
    const { data } = await this.board({} as EmployeeComplianceReportQueryDto, undefined, { quiet: true });
    const counts = { compliant: 0, attention: 0, blocked: 0 };
    for (const row of data.rows) {
      if (!ids.has(row.employeeId)) continue;
      if (row.overallDisplayStatus === 'BLOCKED') counts.blocked += 1;
      else if (row.overallDisplayStatus === 'ATTENTION') counts.attention += 1;
      else counts.compliant += 1;
    }
    return counts;
  }

  async board(
    query: EmployeeComplianceReportQueryDto,
    audit?: RequestAuditMeta & { actorUserId?: string },
    opts?: { quiet?: boolean },
  ) {
    const today = new Date();
    const employees = await this.loadEmployeesForReports(query);
    const [allReqs, types, reviewTypes, collected, supervisionSettings] = await Promise.all([
      this.prisma.complianceRequirement.findMany({
        where: { deletedAt: null, isActive: true, complianceType: { deletedAt: null, isActive: true } },
        include: { complianceType: true },
      }) as Promise<RequirementWithType[]>,
      this.prisma.complianceType.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.reviewType.findMany({
        where: { deletedAt: null, isActive: true, code: { not: null } },
        select: { id: true, code: true, name: true, scheduleKind: true, audience: true },
      }),
      collectReviewDues(this.prisma, { id: { in: employees.map((e) => e.id) } }),
      this.orgSettings.getSupervisionSettings(),
    ]);
    const reviewTypeByCode = new Map(reviewTypes.map((t) => [t.code!.toUpperCase(), t]));
    const dueByKey = new Map(collected.dues.map((d) => [reviewKey(d.employeeId, d.reviewTypeId), d]));
    const staffById = new Map(collected.staff.map((p) => [p.id, p]));

    const typeByCode = new Map(
      types
        .filter((t) => Boolean(t.code?.trim()))
        .map((t) => [t.code!.toUpperCase(), t]),
    );
    type BoardColumn = {
      code: string;
      shortLabel: string;
      name: string;
      /** The review type id for REVIEW columns. */
      complianceTypeId: string;
      group: string;
      source: 'DOCUMENT' | 'REVIEW';
    };
    const columns = BOARD_COLUMN_DEFS.flatMap((def): BoardColumn[] => {
      if (def.source === 'REVIEW') {
        const rt = reviewTypeByCode.get(def.code);
        return rt ? [{ code: def.code, shortLabel: def.shortLabel, name: rt.name, complianceTypeId: rt.id, group: def.group, source: 'REVIEW' }] : [];
      }
      const t = typeByCode.get(def.code);
      return t ? [{ code: def.code, shortLabel: def.shortLabel, name: t.name, complianceTypeId: t.id, group: def.group, source: 'DOCUMENT' }] : [];
    });
    const columnCodes = new Set(columns.filter((c) => c.source === 'DOCUMENT').map((c) => c.code));
    const reviewColumns = columns.filter((c) => c.source === 'REVIEW');

    const allocationMap = await this.allocation.evaluateForEmployees(employees.map((e) => e.id), today);
    const allocationPolicy = await this.allocation.loadPolicy();

    type BoardCell = {
      code: string;
      typeName: string | null;
      complianceTypeId: string;
      applicable: boolean;
      effectiveStatus: EmployeeComplianceStatus | 'NOT_APPLICABLE';
      employeeComplianceId: string | null;
      expiryDate: string | null;
      daysRemaining: number | null;
      critical: boolean;
      /** Requirement flags rostering when org policy mode is BLOCK. */
      blocksRostering: boolean;
      isMandatory: boolean;
      /** REVIEW: from the staff review schedule (open Staff reviews, not a compliance document). */
      source: 'DOCUMENT' | 'REVIEW';
    };

    type BoardAlert = {
      employeeId: string;
      employeeName: string;
      message: string;
      severity: 'critical' | 'warning';
      complianceTypeCode?: string | null;
    };

    const alerts: BoardAlert[] = [];
    const rows: Array<{
      employeeId: string;
      employeeName: string;
      jobTitle: string | null;
      roleName: string | null;
      locationId: string | null;
      visaTypeId: string | null;
      needsImmigrationRtw: boolean;
      blocksAllocation: boolean;
      attentionCount: number;
      compliancePercent: number | null;
      overallDisplayStatus: 'BLOCKED' | 'ATTENTION' | 'COMPLIANT';
      blockingIssueCount: number;
      warningIssueCount: number;
      totalIssueCount: number;
      additionalOffBoardIssueCount: number;
      nextAction: ReturnType<typeof computeNextAction>;
      nearestExpiryDate: string | null;
      nearestExpiryDays: number | null;
      cells: BoardCell[];
    }> = [];

    for (const emp of employees) {
      const name = this.empName(emp);
      const alloc = allocationMap.get(emp.id);
      const blocksAllocation = Boolean(alloc?.blocksAllocation);
      const attentionCount = alloc?.attentionCount ?? 0;

      const cellsByCode = new Map<string, BoardCell>();
      for (const col of columns) {
        cellsByCode.set(col.code, {
          code: col.code,
          typeName: col.name,
          complianceTypeId: col.complianceTypeId,
          applicable: false,
          effectiveStatus: 'NOT_APPLICABLE',
          employeeComplianceId: null,
          expiryDate: null,
          daysRemaining: null,
          critical: false,
          blocksRostering: false,
          isMandatory: false,
          source: col.source,
        });
      }

      // Supervision, appraisal and probation: from the review schedule. They never block rostering.
      for (const col of reviewColumns) {
        const rt = reviewTypeByCode.get(col.code)!;
        const person = staffById.get(emp.id);
        const due = dueByKey.get(reviewKey(emp.id, rt.id));
        const done = collected.latest.get(reviewKey(emp.id, rt.id))?.lastDone ?? null;
        const applies = rt.audience === 'ALL_STAFF' || Boolean(person?.nmcPinNumber?.trim());
        let status: EmployeeComplianceStatus | 'NOT_APPLICABLE' = 'NOT_APPLICABLE';
        if (due) {
          status = REVIEW_TO_BOARD_STATUS[deriveReviewStatus({ nextDue: due.nextDue }, today, supervisionSettings.dueSoonDays) ?? 'SCHEDULED'];
        } else if (done) {
          status = EmployeeComplianceStatus.VALID;
        } else if (applies && rt.scheduleKind === 'REPEATING') {
          // Never recorded and no start date to work a due date from.
          status = EmployeeComplianceStatus.MISSING;
        }
        const critical = status === EmployeeComplianceStatus.EXPIRED || status === EmployeeComplianceStatus.MISSING;
        cellsByCode.set(col.code, {
          code: col.code,
          typeName: rt.name,
          complianceTypeId: rt.id,
          applicable: status !== 'NOT_APPLICABLE',
          effectiveStatus: status,
          employeeComplianceId: null,
          expiryDate: due ? due.nextDue.toISOString().slice(0, 10) : null,
          daysRemaining: due ? daysRemaining(due.nextDue, today) : null,
          critical,
          blocksRostering: false,
          isMandatory: status !== 'NOT_APPLICABLE',
          source: 'REVIEW',
        });
        if (critical) {
          alerts.push({
            employeeId: emp.id,
            employeeName: name,
            message: `${name} — ${rt.name} ${status === EmployeeComplianceStatus.MISSING ? 'never recorded' : 'overdue'}`,
            severity: 'warning',
            complianceTypeCode: col.code,
          });
        }
      }

      if (emp.employment) {
        const best = pickBestRequirementsPerType(
          allReqs as unknown as ComplianceRequirement[],
          employmentDimsFromEmployment(emp.employment),
        );
        for (const [typeId, req] of best) {
          const type = (req as RequirementWithType).complianceType;
          const code = type?.code?.toUpperCase();
          if (!code || !columnCodes.has(code)) continue;
          if (query.complianceTypeId && typeId !== query.complianceTypeId) continue;
          if (query.category && type?.category !== query.category) continue;

          const visaTypeId = emp.employment.visaTypeId;
          const baseBlocks = Boolean(
            (req as RequirementWithType & { blocksAllocation?: boolean }).blocksAllocation,
          );
          const baseMandatory = Boolean(
            (req as RequirementWithType & { isMandatory?: boolean }).isMandatory,
          );
          const { isMandatory, blocksAllocation: blocksRostering } =
            applyImmigrationRtwRequirementFlags(code, visaTypeId, {
              isMandatory: baseMandatory,
              blocksAllocation: baseBlocks,
            });

          // British/Irish (etc.): immigration RTW column is N/A unless a record already exists.
          if (
            isImmigrationRtwDocCode(code) &&
            !requiresImmigrationRtwDocuments(visaTypeId) &&
            !emp.complianceRecords.some((c) => c.complianceTypeId === typeId)
          ) {
            cellsByCode.set(code, {
              code,
              typeName: type?.name ?? code,
              complianceTypeId: typeId,
              applicable: false,
              effectiveStatus: 'NOT_APPLICABLE',
              employeeComplianceId: null,
              expiryDate: null,
              daysRemaining: null,
              critical: false,
              blocksRostering: false,
              isMandatory: false,
              source: 'DOCUMENT',
            });
            continue;
          }

          const alertSeverity =
            blocksRostering && allocationPolicy.mode === 'BLOCK' ? 'critical' : 'warning';

          const row = emp.complianceRecords.find((c) => c.complianceTypeId === typeId) as CompRow | undefined;
          if (!row) {
            const cell: BoardCell = {
              code,
              typeName: type?.name ?? code,
              complianceTypeId: typeId,
              applicable: true,
              effectiveStatus: EmployeeComplianceStatus.MISSING,
              employeeComplianceId: null,
              expiryDate: null,
              daysRemaining: null,
              critical: isMandatory || blocksRostering,
              blocksRostering,
              isMandatory,
              source: 'DOCUMENT',
            };
            cellsByCode.set(code, cell);
            if (isMandatory || blocksRostering) {
              alerts.push({
                employeeId: emp.id,
                employeeName: name,
                message: `${name} — ${type?.name ?? code} missing`,
                severity: alertSeverity,
                complianceTypeCode: code,
              });
            }
            continue;
          }

          if (query.hideNoLongerRequired && row.isNoLongerRequired) {
            cellsByCode.set(code, {
              code,
              typeName: type?.name ?? code,
              complianceTypeId: typeId,
              applicable: true,
              effectiveStatus: EmployeeComplianceStatus.NO_LONGER_REQUIRED,
              employeeComplianceId: row.id,
              expiryDate: null,
              daysRemaining: null,
              critical: false,
              blocksRostering,
              isMandatory,
              source: 'DOCUMENT',
            });
            continue;
          }

          const st = this.statusOf(row);
          const days = daysRemaining(row.expiryDate, today);
          const critical =
            (isMandatory || blocksRostering) && CRITICAL_BOARD_STATUSES.has(st);
          cellsByCode.set(code, {
            code,
            typeName: type?.name ?? code,
            complianceTypeId: typeId,
            applicable: true,
            effectiveStatus: st,
            employeeComplianceId: row.id,
            expiryDate: row.expiryDate ? row.expiryDate.toISOString().slice(0, 10) : null,
            daysRemaining: days,
            critical,
            blocksRostering,
            isMandatory,
            source: 'DOCUMENT',
          });

          if (critical) {
            const label =
              st === EmployeeComplianceStatus.EXPIRED
                ? `${type?.name ?? code} expired`
                : st === EmployeeComplianceStatus.REJECTED
                  ? `${type?.name ?? code} rejected`
                  : `${type?.name ?? code} missing`;
            alerts.push({
              employeeId: emp.id,
              employeeName: name,
              message: `${name} — ${label}`,
              severity: alertSeverity,
              complianceTypeCode: code,
            });
          } else if (st === EmployeeComplianceStatus.EXPIRING_SOON && (isMandatory || blocksRostering)) {
            alerts.push({
              employeeId: emp.id,
              employeeName: name,
              message: `${name} — ${type?.name ?? code} expiring soon`,
              severity: 'warning',
              complianceTypeCode: code,
            });
          }
        }
      }

      if (blocksAllocation) {
        const firstIssue = alloc?.blockingIssues[0]?.label;
        alerts.unshift({
          employeeId: emp.id,
          employeeName: name,
          message: firstIssue ? `${name} — blocked (${firstIssue})` : `${name} — blocked from rostering`,
          severity: 'critical',
          complianceTypeCode: null,
        });
      }

      const cells = columns.map((c) => cellsByCode.get(c.code)!);
      const cellLikes: BoardCellLike[] = cells.map((c) => ({
        code: c.code,
        typeName: c.typeName,
        applicable: c.applicable,
        effectiveStatus: c.effectiveStatus,
        expiryDate: c.expiryDate,
        daysRemaining: c.daysRemaining,
        critical: c.critical,
        blocksRostering: c.blocksRostering,
        isMandatory: c.isMandatory,
      }));
      const issueCounts = countBoardIssues(cellLikes);
      const blockingIssueCount = issueCounts.blockingIssueCount;
      const warningIssueCount = issueCounts.warningIssueCount;
      const totalIssueCount = issueCounts.totalIssueCount;
      const additionalOffBoardIssueCount = countOffBoardAllocationIssues({
        cells: cellLikes,
        blockingLabels: (alloc?.blockingIssues ?? []).map((i) => i.label),
        warningLabels: (alloc?.warningIssues ?? []).map((i) => i.label),
      });
      const overallDisplayStatus = computeOverallDisplayStatus({
        blocksAllocation,
        cells: cellLikes,
        warningIssueCount: warningIssueCount + additionalOffBoardIssueCount,
      });
      const compliancePercent = computeCompliancePercent(cellLikes);
      const nextAction = computeNextAction({
        cells: cellLikes,
        blocksAllocation,
        blockingLabels: (alloc?.blockingIssues ?? []).map((i) => i.label),
      });
      const nearest = nearestExpiry(cellLikes);

      rows.push({
        employeeId: emp.id,
        employeeName: name,
        jobTitle: emp.employment?.jobTitle?.name ?? null,
        roleName: emp.employment?.role?.name ?? null,
        locationId: emp.employment?.locationId ?? emp.employment?.baseLocationId ?? null,
        visaTypeId: emp.employment?.visaTypeId ?? null,
        needsImmigrationRtw: requiresImmigrationRtwDocuments(emp.employment?.visaTypeId),
        blocksAllocation,
        attentionCount: totalIssueCount || attentionCount,
        compliancePercent,
        overallDisplayStatus,
        blockingIssueCount,
        warningIssueCount,
        totalIssueCount,
        additionalOffBoardIssueCount,
        nextAction,
        nearestExpiryDate: nearest.nearestExpiryDate,
        nearestExpiryDays: nearest.nearestExpiryDays,
        cells,
      });
    }

    let filtered = rows;

    const search = query.search?.trim().toLowerCase();
    if (search) {
      filtered = filtered.filter(
        (r) =>
          r.employeeName.toLowerCase().includes(search) ||
          (r.jobTitle?.toLowerCase().includes(search) ?? false) ||
          (r.roleName?.toLowerCase().includes(search) ?? false),
      );
    }
    if (query.displayStatus) {
      filtered = filtered.filter((r) => r.overallDisplayStatus === query.displayStatus);
    }
    if (query.issuesOnly) {
      filtered = filtered.filter((r) => r.overallDisplayStatus !== 'COMPLIANT');
    }
    if (query.documentState) {
      filtered = filtered.filter((r) =>
        cellMatchesDocumentState(
          r.cells.map((c) => ({
            code: c.code,
            typeName: c.typeName,
            applicable: c.applicable,
            effectiveStatus: c.effectiveStatus,
            expiryDate: c.expiryDate,
            daysRemaining: c.daysRemaining,
            critical: c.critical,
            blocksRostering: c.blocksRostering,
            isMandatory: c.isMandatory,
          })),
          query.documentState!,
        ),
      );
    }

    const boardSort = query.boardSort ?? 'urgent';
    filtered.sort((a, b) => {
      if (boardSort === 'name') return a.employeeName.localeCompare(b.employeeName);
      if (boardSort === 'nearest_expiry') {
        const da = a.nearestExpiryDays ?? Number.POSITIVE_INFINITY;
        const db = b.nearestExpiryDays ?? Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
        return a.employeeName.localeCompare(b.employeeName);
      }
      const ka = urgencySortKey(a);
      const kb = urgencySortKey(b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      return ka[2].localeCompare(kb[2]);
    });

    // Prefer roster-blocking alerts first, then other critical, then warnings
    alerts.sort((a, b) => {
      const rank = (s: 'critical' | 'warning') => (s === 'critical' ? 0 : 1);
      return rank(a.severity) - rank(b.severity);
    });

    const filteredIds = new Set(filtered.map((r) => r.employeeId));
    const seenAlert = new Set<string>();
    const uniqueAlerts = alerts
      .filter((a) => filteredIds.has(a.employeeId))
      .filter((a) => {
        const key = `${a.employeeId}:${a.message}`;
        if (seenAlert.has(key)) return false;
        seenAlert.add(key);
        return true;
      })
      .slice(0, 60);

    const blockedCount = filtered.filter((r) => r.blocksAllocation).length;
    const gapCellCount = filtered.reduce(
      (n, r) => n + r.cells.filter((c) => c.applicable && c.critical).length,
      0,
    );
    const employeeSummaries = buildBoardEmployeeSummaries(filtered);

    if (!opts?.quiet) await this.logReportView(audit?.actorUserId, 'board', audit, filtered.length);
    return {
      data: {
        columns,
        rows: filtered,
        alerts: uniqueAlerts,
        allocationPolicy: {
          mode: allocationPolicy.mode,
          blockStatuses: allocationPolicy.blockStatuses,
          includeLearning: allocationPolicy.includeLearning,
        },
        summary: {
          employeeCount: filtered.length,
          blockedCount,
          clearCount: filtered.length - blockedCount,
          criticalAlertCount: uniqueAlerts.filter((a) => a.severity === 'critical').length,
          warningAlertCount: uniqueAlerts.filter((a) => a.severity === 'warning').length,
          gapCellCount,
          alertTotal: uniqueAlerts.length,
          needsActionCount: employeeSummaries.needsActionCount,
          expiredCount: employeeSummaries.expiredCount,
          expiring7Count: employeeSummaries.expiring7Count,
          expiring8To30Count: employeeSummaries.expiring8To30Count,
          fullyCompliantCount: employeeSummaries.fullyCompliantCount,
        },
        asOf: today.toISOString(),
      },
    };
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
