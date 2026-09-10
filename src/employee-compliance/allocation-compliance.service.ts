import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { employmentDimsFromEmployment } from './compliance-requirement.matcher';
import { applyImmigrationRtwRequirementFlags } from './immigration-rtw-requirement.util';
import {
  EMPTY_COMPLIANCE_ALLOCATION_RESULT,
  evaluateEmployeeAllocationCompliance,
  parseComplianceAllocationPolicy,
  type ComplianceAllocationPolicy,
  type ComplianceAllocationResult,
  type ComplianceRecordForAllocation,
  type LearningRowForAllocation,
  type RequirementForAllocation,
} from './allocation-compliance.util';

const ORG_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';

@Injectable()
export class AllocationComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  async loadPolicy(): Promise<ComplianceAllocationPolicy> {
    const row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: ORG_SETTINGS_ID },
      select: {
        complianceAllocationMode: true,
        complianceBlockStatuses: true,
        includeLearningInAllocationBlock: true,
      },
    });
    return parseComplianceAllocationPolicy(row ?? {});
  }

  async evaluateForEmployees(
    employeeIds: string[],
    today: Date = new Date(),
  ): Promise<Map<string, ComplianceAllocationResult>> {
    const uniqueIds = [...new Set(employeeIds.filter((id) => id.trim()))];
    const results = new Map<string, ComplianceAllocationResult>();
    if (uniqueIds.length === 0) return results;

    const policy = await this.loadPolicy();

    const [requirements, employees, records, learning] = await Promise.all([
      this.prisma.complianceRequirement.findMany({
        where: { deletedAt: null, isActive: true, complianceType: { deletedAt: null, isActive: true } },
        include: { complianceType: { select: { name: true, code: true } } },
      }),
      this.prisma.employee.findMany({
        where: { id: { in: uniqueIds }, deletedAt: null },
        select: {
          id: true,
          employment: {
            select: {
              roleId: true,
              workAreaId: true,
              jobTitleId: true,
              contractTypeId: true,
              locationId: true,
              baseLocationId: true,
              visaTypeId: true,
              deletedAt: true,
            },
          },
        },
      }),
      this.prisma.employeeCompliance.findMany({
        where: { employeeId: { in: uniqueIds }, deletedAt: null },
        include: {
          complianceType: {
            select: {
              name: true,
              hasExpiry: true,
              requiresDocument: true,
              requiresVerification: true,
            },
          },
          requirement: { select: { renewalBeforeDays: true } },
          documents: { where: { deletedAt: null }, select: { id: true } },
        },
      }),
      policy.includeLearning
        ? this.prisma.learningComplianceSnapshot.findMany({
            where: { employeeId: { in: uniqueIds } },
            include: { course: { select: { title: true } } },
          })
        : Promise.resolve([]),
    ]);

    const requirementRows: RequirementForAllocation[] = requirements.map((row) => ({
      id: row.id,
      complianceTypeId: row.complianceTypeId,
      isMandatory: row.isMandatory,
      blocksAllocation: row.blocksAllocation,
      renewalBeforeDays: row.renewalBeforeDays,
      roleId: row.roleId,
      workAreaId: row.workAreaId,
      jobTitleId: row.jobTitleId,
      contractTypeId: row.contractTypeId,
      locationId: row.locationId,
      zoneId: row.zoneId,
      complianceTypeName: row.complianceType?.name ?? null,
      complianceTypeCode: row.complianceType?.code ?? null,
    }));

    const recordsByEmployee = new Map<string, ComplianceRecordForAllocation[]>();
    for (const row of records) {
      const mapped: ComplianceRecordForAllocation = {
        employeeId: row.employeeId,
        complianceTypeId: row.complianceTypeId,
        requirementId: row.requirementId,
        rejectedAt: row.rejectedAt,
        submittedAt: row.submittedAt,
        verifiedAt: row.verifiedAt,
        expiryDate: row.expiryDate,
        issueDate: row.issueDate,
        isNoLongerRequired: row.isNoLongerRequired,
        documentUrl: row.documentUrl,
        hasNonDeletedDocument: (row.documents?.length ?? 0) > 0,
        type: row.complianceType
          ? {
              hasExpiry: row.complianceType.hasExpiry,
              requiresDocument: row.complianceType.requiresDocument,
              requiresVerification: row.complianceType.requiresVerification,
              name: row.complianceType.name,
            }
          : null,
        requirementRenewalBeforeDays: row.requirement?.renewalBeforeDays ?? null,
      };
      const list = recordsByEmployee.get(row.employeeId) ?? [];
      list.push(mapped);
      recordsByEmployee.set(row.employeeId, list);
    }

    const learningByEmployee = new Map<string, LearningRowForAllocation[]>();
    for (const row of learning) {
      const mapped: LearningRowForAllocation = {
        employeeId: row.employeeId,
        courseName: row.course?.title ?? null,
        complianceStatus: row.complianceStatus,
      };
      const list = learningByEmployee.get(row.employeeId) ?? [];
      list.push(mapped);
      learningByEmployee.set(row.employeeId, list);
    }

    const employeeById = new Map(employees.map((row) => [row.id, row]));
    for (const employeeId of uniqueIds) {
      const employee = employeeById.get(employeeId);
      const employment = employee?.employment && !employee.employment.deletedAt ? employee.employment : null;
      const visaTypeId = employment?.visaTypeId ?? null;
      const requirementsForEmployee = requirementRows.map((row) => {
        const flags = applyImmigrationRtwRequirementFlags(row.complianceTypeCode, visaTypeId, {
          isMandatory: row.isMandatory,
          blocksAllocation: row.blocksAllocation,
        });
        return { ...row, ...flags };
      });
      results.set(
        employeeId,
        evaluateEmployeeAllocationCompliance({
          policy,
          dims: employment ? employmentDimsFromEmployment(employment) : null,
          requirements: requirementsForEmployee,
          records: recordsByEmployee.get(employeeId) ?? [],
          learning: learningByEmployee.get(employeeId) ?? [],
          today,
        }),
      );
    }

    return results;
  }

  async evaluateForEmployee(
    employeeId: string,
    today: Date = new Date(),
  ): Promise<ComplianceAllocationResult> {
    const map = await this.evaluateForEmployees([employeeId], today);
    return map.get(employeeId) ?? EMPTY_COMPLIANCE_ALLOCATION_RESULT;
  }
}
