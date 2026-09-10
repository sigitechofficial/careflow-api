import { EmployeeComplianceStatus, LearningComplianceStatus } from '@prisma/client';
import {
  calculateComplianceStatus,
  type ComplianceTypeCalc,
  type EmployeeComplianceCalc,
} from './compliance-status.calculator';
import {
  pickBestRequirementsPerType,
  type EmploymentDims,
} from './compliance-requirement.matcher';

export const COMPLIANCE_ALLOCATION_MODES = ['WARN', 'BLOCK'] as const;
export type ComplianceAllocationMode = (typeof COMPLIANCE_ALLOCATION_MODES)[number];

export const DEFAULT_COMPLIANCE_BLOCK_STATUSES: EmployeeComplianceStatus[] = [
  EmployeeComplianceStatus.MISSING,
  EmployeeComplianceStatus.EXPIRED,
  EmployeeComplianceStatus.REJECTED,
];

export const ALLOWED_COMPLIANCE_BLOCK_STATUSES: EmployeeComplianceStatus[] = [
  EmployeeComplianceStatus.MISSING,
  EmployeeComplianceStatus.EXPIRED,
  EmployeeComplianceStatus.REJECTED,
  EmployeeComplianceStatus.EXPIRING_SOON,
  EmployeeComplianceStatus.PENDING_REVIEW,
  EmployeeComplianceStatus.REQUIRED,
];

export const LEARNING_ALLOCATION_BLOCK_STATUSES: LearningComplianceStatus[] = [
  LearningComplianceStatus.EXPIRED,
  LearningComplianceStatus.OVERDUE,
];

export type ComplianceAllocationPolicy = {
  mode: ComplianceAllocationMode;
  blockStatuses: EmployeeComplianceStatus[];
  includeLearning: boolean;
};

export type RequirementForAllocation = {
  id: string;
  complianceTypeId: string;
  isMandatory: boolean;
  blocksAllocation: boolean;
  renewalBeforeDays: number;
  roleId: string | null;
  workAreaId: string | null;
  jobTitleId: string | null;
  contractTypeId: string | null;
  locationId: string | null;
  zoneId: string | null;
  complianceTypeName?: string | null;
  complianceTypeCode?: string | null;
};

export type ComplianceRecordForAllocation = EmployeeComplianceCalc & {
  employeeId: string;
  complianceTypeId: string | null;
  requirementId: string | null;
  hasNonDeletedDocument: boolean;
  type: (ComplianceTypeCalc & { name?: string | null }) | null;
  requirementRenewalBeforeDays: number | null;
};

export type LearningRowForAllocation = {
  employeeId: string;
  courseName?: string | null;
  complianceStatus: LearningComplianceStatus;
};

export type ComplianceAllocationIssue = {
  source: 'EMPLOYEE_COMPLIANCE' | 'LEARNING';
  status: string;
  label: string;
};

export type ComplianceAllocationResult = {
  blockingIssues: ComplianceAllocationIssue[];
  warningIssues: ComplianceAllocationIssue[];
  attentionCount: number;
  blocksAllocation: boolean;
};

export const EMPTY_COMPLIANCE_ALLOCATION_RESULT: ComplianceAllocationResult = {
  blockingIssues: [],
  warningIssues: [],
  attentionCount: 0,
  blocksAllocation: false,
};

const EMPTY_DIMS: EmploymentDims = {
  roleId: null,
  workAreaId: null,
  jobTitleId: null,
  contractTypeId: null,
  locationId: null,
};

export function parseComplianceAllocationMode(value: unknown): ComplianceAllocationMode {
  return value === 'BLOCK' ? 'BLOCK' : 'WARN';
}

export function parseComplianceBlockStatuses(value: unknown): EmployeeComplianceStatus[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [...DEFAULT_COMPLIANCE_BLOCK_STATUSES];
  }
  const allowed = new Set<string>(ALLOWED_COMPLIANCE_BLOCK_STATUSES);
  const parsed = value.filter(
    (item): item is EmployeeComplianceStatus =>
      typeof item === 'string' && allowed.has(item),
  );
  return parsed.length > 0 ? parsed : [...DEFAULT_COMPLIANCE_BLOCK_STATUSES];
}

export function parseComplianceAllocationPolicy(input: {
  complianceAllocationMode?: unknown;
  complianceBlockStatuses?: unknown;
  includeLearningInAllocationBlock?: unknown;
}): ComplianceAllocationPolicy {
  return {
    mode: parseComplianceAllocationMode(input.complianceAllocationMode),
    blockStatuses: parseComplianceBlockStatuses(input.complianceBlockStatuses),
    includeLearning: Boolean(input.includeLearningInAllocationBlock),
  };
}

export function classifyEmployeeComplianceForAllocation(
  status: EmployeeComplianceStatus,
  policy: ComplianceAllocationPolicy,
): 'block' | 'warn' | 'ignore' {
  if (
    status === EmployeeComplianceStatus.NO_LONGER_REQUIRED ||
    status === EmployeeComplianceStatus.NOT_REQUIRED ||
    status === EmployeeComplianceStatus.VALID
  ) {
    return 'ignore';
  }

  const inBlockList = policy.blockStatuses.includes(status);
  if (inBlockList) {
    return policy.mode === 'BLOCK' ? 'block' : 'warn';
  }
  if (status === EmployeeComplianceStatus.EXPIRING_SOON) {
    return 'warn';
  }
  return 'ignore';
}

export function classifyLearningComplianceForAllocation(
  status: LearningComplianceStatus,
  policy: ComplianceAllocationPolicy,
): 'block' | 'warn' | 'ignore' {
  if (!policy.includeLearning) return 'ignore';
  if (LEARNING_ALLOCATION_BLOCK_STATUSES.includes(status)) {
    return policy.mode === 'BLOCK' ? 'block' : 'warn';
  }
  if (status === LearningComplianceStatus.EXPIRING_SOON) {
    return 'warn';
  }
  return 'ignore';
}

function pushIssue(
  result: ComplianceAllocationResult,
  kind: 'block' | 'warn' | 'ignore',
  issue: ComplianceAllocationIssue,
) {
  if (kind === 'block') result.blockingIssues.push(issue);
  else if (kind === 'warn') result.warningIssues.push(issue);
}

function issueLabel(name: string | null | undefined, status: string): string {
  const trimmed = name?.trim();
  return trimmed ? `${trimmed} (${status})` : status;
}

export function evaluateEmployeeAllocationCompliance(input: {
  policy: ComplianceAllocationPolicy;
  dims: EmploymentDims | null;
  requirements: RequirementForAllocation[];
  records: ComplianceRecordForAllocation[];
  learning?: LearningRowForAllocation[];
  today?: Date;
}): ComplianceAllocationResult {
  const result: ComplianceAllocationResult = {
    blockingIssues: [],
    warningIssues: [],
    attentionCount: 0,
    blocksAllocation: false,
  };

  const dims = input.dims ?? EMPTY_DIMS;
  const best = pickBestRequirementsPerType(input.requirements, dims);

  for (const [typeId, req] of best) {
    if (!req.blocksAllocation) continue;

    const record =
      input.records.find((row) => row.complianceTypeId === typeId) ??
      input.records.find((row) => row.requirementId === req.id);

    if (record?.isNoLongerRequired) continue;

    const status = record
      ? calculateComplianceStatus(
          record,
          record.type,
          record.requirementRenewalBeforeDays ?? req.renewalBeforeDays,
          record.hasNonDeletedDocument,
          input.today,
        )
      : EmployeeComplianceStatus.MISSING;

    const kind = classifyEmployeeComplianceForAllocation(status, input.policy);
    pushIssue(result, kind, {
      source: 'EMPLOYEE_COMPLIANCE',
      status,
      label: issueLabel(record?.type?.name ?? req.complianceTypeName, status),
    });
  }

  if (input.policy.includeLearning) {
    for (const row of input.learning ?? []) {
      const kind = classifyLearningComplianceForAllocation(row.complianceStatus, input.policy);
      pushIssue(result, kind, {
        source: 'LEARNING',
        status: row.complianceStatus,
        label: issueLabel(row.courseName, row.complianceStatus),
      });
    }
  }

  result.attentionCount = result.blockingIssues.length + result.warningIssues.length;
  result.blocksAllocation = input.policy.mode === 'BLOCK' && result.blockingIssues.length > 0;
  return result;
}

function formatIssueList(issues: ComplianceAllocationIssue[]): string {
  const labels = issues.slice(0, 3).map((issue) => issue.label);
  const extra = issues.length - labels.length;
  if (extra > 0) return `${labels.join(', ')} and ${extra} more`;
  return labels.join(', ');
}

export function formatComplianceAllocationMessages(result: ComplianceAllocationResult): {
  block: string | null;
  warn: string | null;
} {
  return {
    block:
      result.blockingIssues.length > 0
        ? `Cannot allocate: ${formatIssueList(result.blockingIssues)}`
        : null,
    warn:
      result.warningIssues.length > 0
        ? `Employee has ${result.warningIssues.length} compliance item(s) requiring attention${
            result.warningIssues.length <= 3 ? ` (${formatIssueList(result.warningIssues)})` : ''
          }`
        : null,
  };
}
