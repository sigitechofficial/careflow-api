import { EmployeeComplianceStatus, LearningComplianceStatus } from '@prisma/client';
import {
  classifyEmployeeComplianceForAllocation,
  classifyLearningComplianceForAllocation,
  evaluateEmployeeAllocationCompliance,
  formatComplianceAllocationMessages,
  parseComplianceAllocationPolicy,
  type ComplianceAllocationPolicy,
  type RequirementForAllocation,
} from './allocation-compliance.util';

const warnPolicy: ComplianceAllocationPolicy = {
  mode: 'WARN',
  blockStatuses: [
    EmployeeComplianceStatus.MISSING,
    EmployeeComplianceStatus.EXPIRED,
    EmployeeComplianceStatus.REJECTED,
  ],
  includeLearning: false,
};

const blockPolicy: ComplianceAllocationPolicy = {
  ...warnPolicy,
  mode: 'BLOCK',
};

function requirement(overrides: Partial<RequirementForAllocation> = {}): RequirementForAllocation {
  return {
    id: 'req-1',
    complianceTypeId: 'type-dbs',
    isMandatory: true,
    blocksAllocation: true,
    renewalBeforeDays: 30,
    roleId: null,
    workAreaId: null,
    jobTitleId: null,
    contractTypeId: null,
    locationId: null,
    zoneId: null,
    complianceTypeName: 'DBS',
    ...overrides,
  };
}

const emptyRecordBase = {
  employeeId: 'emp-1',
  complianceTypeId: 'type-dbs',
  requirementId: 'req-1',
  rejectedAt: null,
  submittedAt: null,
  verifiedAt: null,
  expiryDate: null,
  issueDate: null,
  isNoLongerRequired: false,
  documentUrl: null,
  hasNonDeletedDocument: false,
  type: {
    hasExpiry: true,
    requiresDocument: true,
    requiresVerification: true,
    name: 'DBS',
  },
  requirementRenewalBeforeDays: 30,
};

describe('allocation-compliance.util', () => {
  it('defaults existing orgs to WARN and standard block statuses', () => {
    const policy = parseComplianceAllocationPolicy({});
    expect(policy.mode).toBe('WARN');
    expect(policy.blockStatuses).toEqual([
      EmployeeComplianceStatus.MISSING,
      EmployeeComplianceStatus.EXPIRED,
      EmployeeComplianceStatus.REJECTED,
    ]);
    expect(policy.includeLearning).toBe(false);
  });

  it('classifies MISSING as warn in WARN mode and block in BLOCK mode', () => {
    expect(classifyEmployeeComplianceForAllocation(EmployeeComplianceStatus.MISSING, warnPolicy)).toBe(
      'warn',
    );
    expect(classifyEmployeeComplianceForAllocation(EmployeeComplianceStatus.MISSING, blockPolicy)).toBe(
      'block',
    );
  });

  it('never blocks EXPIRING_SOON unless the org adds it to block statuses', () => {
    expect(
      classifyEmployeeComplianceForAllocation(EmployeeComplianceStatus.EXPIRING_SOON, blockPolicy),
    ).toBe('warn');
    expect(
      classifyEmployeeComplianceForAllocation(EmployeeComplianceStatus.EXPIRING_SOON, {
        ...blockPolicy,
        blockStatuses: [...blockPolicy.blockStatuses, EmployeeComplianceStatus.EXPIRING_SOON],
      }),
    ).toBe('block');
  });

  it('ignores pending review, NLR, and valid by default', () => {
    expect(
      classifyEmployeeComplianceForAllocation(EmployeeComplianceStatus.PENDING_REVIEW, blockPolicy),
    ).toBe('ignore');
    expect(
      classifyEmployeeComplianceForAllocation(EmployeeComplianceStatus.NO_LONGER_REQUIRED, blockPolicy),
    ).toBe('ignore');
    expect(classifyEmployeeComplianceForAllocation(EmployeeComplianceStatus.VALID, blockPolicy)).toBe(
      'ignore',
    );
  });

  it('treats a required-but-absent record as MISSING', () => {
    const result = evaluateEmployeeAllocationCompliance({
      policy: blockPolicy,
      dims: {
        roleId: null,
        workAreaId: null,
        jobTitleId: null,
        contractTypeId: null,
        locationId: null,
      },
      requirements: [requirement()],
      records: [],
    });
    expect(result.blocksAllocation).toBe(true);
    expect(result.blockingIssues[0]?.status).toBe(EmployeeComplianceStatus.MISSING);
  });

  it('uses computed expiry rather than a stale persisted VALID status', () => {
    const result = evaluateEmployeeAllocationCompliance({
      policy: blockPolicy,
      dims: {
        roleId: null,
        workAreaId: null,
        jobTitleId: null,
        contractTypeId: null,
        locationId: null,
      },
      requirements: [requirement()],
      records: [
        {
          ...emptyRecordBase,
          verifiedAt: new Date('2025-01-01T00:00:00.000Z'),
          expiryDate: new Date('2026-05-01T00:00:00.000Z'),
          hasNonDeletedDocument: true,
        },
      ],
      today: new Date('2026-05-20T12:00:00.000Z'),
    });
    expect(result.blockingIssues[0]?.status).toBe(EmployeeComplianceStatus.EXPIRED);
    expect(result.blocksAllocation).toBe(true);
  });

  it('does not block when no requirements match (including no work area)', () => {
    const result = evaluateEmployeeAllocationCompliance({
      policy: blockPolicy,
      dims: {
        roleId: null,
        workAreaId: null,
        jobTitleId: null,
        contractTypeId: null,
        locationId: null,
      },
      requirements: [requirement({ workAreaId: 'wa-dom' })],
      records: [],
    });
    expect(result.attentionCount).toBe(0);
    expect(result.blocksAllocation).toBe(false);
  });

  it('ignores optional requirements that do not block allocation', () => {
    const result = evaluateEmployeeAllocationCompliance({
      policy: blockPolicy,
      dims: {
        roleId: null,
        workAreaId: null,
        jobTitleId: null,
        contractTypeId: null,
        locationId: null,
      },
      requirements: [requirement({ isMandatory: false, blocksAllocation: false })],
      records: [
        {
          ...emptyRecordBase,
          rejectedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });
    expect(result.attentionCount).toBe(0);
  });

  it('skips no-longer-required records instead of treating them as missing', () => {
    const result = evaluateEmployeeAllocationCompliance({
      policy: blockPolicy,
      dims: {
        roleId: null,
        workAreaId: null,
        jobTitleId: null,
        contractTypeId: null,
        locationId: null,
      },
      requirements: [requirement()],
      records: [
        {
          ...emptyRecordBase,
          isNoLongerRequired: true,
        },
      ],
    });
    expect(result.attentionCount).toBe(0);
  });

  it('keeps WARN mode assignable even when items would block in BLOCK mode', () => {
    const result = evaluateEmployeeAllocationCompliance({
      policy: warnPolicy,
      dims: {
        roleId: null,
        workAreaId: null,
        jobTitleId: null,
        contractTypeId: null,
        locationId: null,
      },
      requirements: [requirement()],
      records: [],
    });
    expect(result.blocksAllocation).toBe(false);
    expect(result.warningIssues[0]?.status).toBe(EmployeeComplianceStatus.MISSING);
    expect(formatComplianceAllocationMessages(result).warn).toContain('MISSING');
  });

  it('ignores learning unless includeLearning is on', () => {
    const off = evaluateEmployeeAllocationCompliance({
      policy: blockPolicy,
      dims: {
        roleId: null,
        workAreaId: null,
        jobTitleId: null,
        contractTypeId: null,
        locationId: null,
      },
      requirements: [],
      records: [],
      learning: [
        {
          employeeId: 'emp-1',
          courseName: 'Moving and handling',
          complianceStatus: LearningComplianceStatus.OVERDUE,
        },
      ],
    });
    expect(off.attentionCount).toBe(0);

    expect(
      classifyLearningComplianceForAllocation(LearningComplianceStatus.OVERDUE, {
        ...blockPolicy,
        includeLearning: true,
      }),
    ).toBe('block');
    expect(
      classifyLearningComplianceForAllocation(LearningComplianceStatus.EXPIRING_SOON, {
        ...blockPolicy,
        includeLearning: true,
      }),
    ).toBe('warn');
  });
});
