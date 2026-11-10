import { EmployeeComplianceStatus } from '@prisma/client';
import {
  buildBoardEmployeeSummaries,
  cellMatchesDocumentState,
  computeCompliancePercent,
  computeNextAction,
  computeOverallDisplayStatus,
  countBoardIssues,
  countOffBoardAllocationIssues,
} from './compliance-board-enrichment.util';

function cell(
  partial: Partial<{
    code: string;
    typeName: string;
    applicable: boolean;
    effectiveStatus: EmployeeComplianceStatus | 'NOT_APPLICABLE';
    expiryDate: string | null;
    daysRemaining: number | null;
    critical: boolean;
    blocksRostering: boolean;
    isMandatory: boolean;
  }>,
) {
  return {
    code: 'DBS',
    typeName: 'DBS',
    applicable: true,
    effectiveStatus: EmployeeComplianceStatus.VALID as EmployeeComplianceStatus | 'NOT_APPLICABLE',
    expiryDate: null as string | null,
    daysRemaining: null as number | null,
    critical: false,
    blocksRostering: false,
    isMandatory: true,
    ...partial,
  };
}

describe('compliance-board-enrichment.util', () => {
  describe('computeCompliancePercent', () => {
    it('counts VALID mandatory as satisfied', () => {
      expect(
        computeCompliancePercent([
          cell({ effectiveStatus: EmployeeComplianceStatus.VALID }),
        ]),
      ).toBe(100);
    });

    it('counts EXPIRING_SOON mandatory as satisfied', () => {
      expect(
        computeCompliancePercent([
          cell({
            effectiveStatus: EmployeeComplianceStatus.EXPIRING_SOON,
            daysRemaining: 5,
          }),
        ]),
      ).toBe(100);
    });

    it('does not count SUBMITTED as satisfied (verification still outstanding)', () => {
      expect(
        computeCompliancePercent([
          cell({ effectiveStatus: EmployeeComplianceStatus.SUBMITTED }),
          cell({ code: 'MED', effectiveStatus: EmployeeComplianceStatus.VALID }),
        ]),
      ).toBe(50);
    });

    it('does not count PENDING_REVIEW as satisfied', () => {
      expect(
        computeCompliancePercent([
          cell({ effectiveStatus: EmployeeComplianceStatus.PENDING_REVIEW }),
          cell({ code: 'MED', effectiveStatus: EmployeeComplianceStatus.VALID }),
        ]),
      ).toBe(50);
    });

    it('excludes NO_LONGER_REQUIRED from denominator', () => {
      expect(
        computeCompliancePercent([
          cell({ effectiveStatus: EmployeeComplianceStatus.VALID }),
          cell({
            code: 'OLD',
            effectiveStatus: EmployeeComplianceStatus.NO_LONGER_REQUIRED,
          }),
        ]),
      ).toBe(100);
    });

    it('excludes N/A and optional from denominator', () => {
      expect(
        computeCompliancePercent([
          cell({ applicable: false, effectiveStatus: 'NOT_APPLICABLE' }),
          cell({
            code: 'OPT',
            isMandatory: false,
            effectiveStatus: EmployeeComplianceStatus.MISSING,
          }),
          cell({ code: 'DBS', effectiveStatus: EmployeeComplianceStatus.VALID }),
        ]),
      ).toBe(100);
    });

    it('returns null when zero applicable mandatory requirements', () => {
      expect(
        computeCompliancePercent([
          cell({ applicable: false, effectiveStatus: 'NOT_APPLICABLE' }),
          cell({ isMandatory: false, effectiveStatus: EmployeeComplianceStatus.MISSING }),
          cell({
            code: 'OLD',
            effectiveStatus: EmployeeComplianceStatus.NO_LONGER_REQUIRED,
          }),
        ]),
      ).toBeNull();
    });

    it('does not count EXPIRED / MISSING / REJECTED as satisfied', () => {
      expect(
        computeCompliancePercent([
          cell({ code: 'A', effectiveStatus: EmployeeComplianceStatus.EXPIRED, daysRemaining: -2 }),
          cell({ code: 'B', effectiveStatus: EmployeeComplianceStatus.MISSING }),
          cell({ code: 'C', effectiveStatus: EmployeeComplianceStatus.REJECTED }),
          cell({ code: 'D', effectiveStatus: EmployeeComplianceStatus.VALID }),
        ]),
      ).toBe(25);
    });
  });

  describe('computeOverallDisplayStatus', () => {
    it('maps blocked vs attention vs compliant', () => {
      expect(
        computeOverallDisplayStatus({
          blocksAllocation: true,
          cells: [],
          warningIssueCount: 0,
        }),
      ).toBe('BLOCKED');
      expect(
        computeOverallDisplayStatus({
          blocksAllocation: false,
          cells: [
            cell({
              effectiveStatus: EmployeeComplianceStatus.EXPIRING_SOON,
              daysRemaining: 5,
            }),
          ],
          warningIssueCount: 0,
        }),
      ).toBe('ATTENTION');
      expect(
        computeOverallDisplayStatus({
          blocksAllocation: false,
          cells: [cell({ effectiveStatus: EmployeeComplianceStatus.VALID })],
          warningIssueCount: 0,
        }),
      ).toBe('COMPLIANT');
    });
  });

  describe('computeNextAction', () => {
    it('A: RTW expired wins over DBS expiring in 3 days', () => {
      const action = computeNextAction({
        blocksAllocation: true,
        blockingLabels: ['RTW expired'],
        cells: [
          cell({
            code: 'BIOMETRIC_CARD',
            typeName: 'RTW',
            effectiveStatus: EmployeeComplianceStatus.EXPIRED,
            daysRemaining: -8,
            expiryDate: '2026-09-02',
            blocksRostering: true,
          }),
          cell({
            code: 'DBS',
            typeName: 'DBS',
            effectiveStatus: EmployeeComplianceStatus.EXPIRING_SOON,
            daysRemaining: 3,
            expiryDate: '2026-09-13',
            blocksRostering: true,
          }),
        ],
      });
      expect(action.kind).toBe('EXPIRED');
      expect(action.typeCode).toBe('BIOMETRIC_CARD');
      expect(action.primary).toContain('expired');
      expect(action.secondary).toContain('8 days overdue');
    });

    it('B: missing blocking beats expired non-blocking', () => {
      const action = computeNextAction({
        blocksAllocation: true,
        blockingLabels: [],
        cells: [
          cell({
            code: 'DBS',
            effectiveStatus: EmployeeComplianceStatus.MISSING,
            blocksRostering: true,
          }),
          cell({
            code: 'APPRSL',
            typeName: 'Appraisal',
            effectiveStatus: EmployeeComplianceStatus.EXPIRED,
            daysRemaining: -10,
            blocksRostering: false,
          }),
        ],
      });
      expect(action.kind).toBe('MISSING');
      expect(action.typeCode).toBe('DBS');
    });

    it('C: two docs expire in 5 days — deterministic by code', () => {
      const cells = [
        cell({
          code: 'ZZZ',
          typeName: 'Zed',
          effectiveStatus: EmployeeComplianceStatus.EXPIRING_SOON,
          daysRemaining: 5,
          expiryDate: '2026-09-15',
        }),
        cell({
          code: 'AAA',
          typeName: 'Aaa',
          effectiveStatus: EmployeeComplianceStatus.EXPIRING_SOON,
          daysRemaining: 5,
          expiryDate: '2026-09-15',
        }),
      ];
      const a = computeNextAction({ blocksAllocation: false, blockingLabels: [], cells });
      const b = computeNextAction({
        blocksAllocation: false,
        blockingLabels: [],
        cells: [...cells].reverse(),
      });
      expect(a.typeCode).toBe('AAA');
      expect(b.typeCode).toBe('AAA');
      expect(a.kind).toBe('EXPIRING_7');
    });

    it('D: no problems — next expiry beyond 30 days', () => {
      const action = computeNextAction({
        blocksAllocation: false,
        blockingLabels: [],
        cells: [
          cell({
            code: 'DBS',
            typeName: 'DBS',
            effectiveStatus: EmployeeComplianceStatus.VALID,
            daysRemaining: 90,
            expiryDate: '2026-12-09',
          }),
        ],
      });
      expect(action.kind).toBe('NONE');
      expect(action.primary).toBe('No current issues');
      expect(action.secondary).toBe('Next expiry: DBS · 09/12/2026');
    });

    it('E: no expiry-bearing requirements — no fabricated next expiry', () => {
      const action = computeNextAction({
        blocksAllocation: false,
        blockingLabels: [],
        cells: [cell({ effectiveStatus: EmployeeComplianceStatus.VALID, daysRemaining: null })],
      });
      expect(action.kind).toBe('NONE');
      expect(action.primary).toBe('No current issues');
      expect(action.secondary).toBeNull();
    });

    it('surfaces off-board allocation block when board cells are clean', () => {
      const action = computeNextAction({
        blocksAllocation: true,
        blockingLabels: ['Mandatory training incomplete'],
        cells: [cell({ effectiveStatus: EmployeeComplianceStatus.VALID })],
      });
      expect(action.kind).toBe('BLOCKING');
      expect(action.primary).toContain('training');
      expect(action.secondary).toContain('outside board');
    });

    it('expires today uses dedicated copy', () => {
      const action = computeNextAction({
        blocksAllocation: false,
        blockingLabels: [],
        cells: [
          cell({
            typeName: 'DBS',
            effectiveStatus: EmployeeComplianceStatus.EXPIRING_SOON,
            daysRemaining: 0,
            expiryDate: '2026-09-10',
          }),
        ],
      });
      expect(action.kind).toBe('EXPIRING_7');
      expect(action.primary).toBe('DBS expires today');
    });
  });

  describe('document state + summary buckets', () => {
    it('matches ≤7 and 8–30 exclusively for filters', () => {
      const seven = [
        cell({ daysRemaining: 5, effectiveStatus: EmployeeComplianceStatus.EXPIRING_SOON }),
      ];
      const mid = [
        cell({ daysRemaining: 12, effectiveStatus: EmployeeComplianceStatus.EXPIRING_SOON }),
      ];
      expect(cellMatchesDocumentState(seven, 'expiring_7')).toBe(true);
      expect(cellMatchesDocumentState(seven, 'expiring_8_30')).toBe(false);
      expect(cellMatchesDocumentState(mid, 'expiring_8_30')).toBe(true);
      expect(cellMatchesDocumentState(mid, 'expiring_7')).toBe(false);
    });

    it('summary ≤7 and 8–30 are mutually exclusive; Fully Compliant excludes warnings', () => {
      const rows = [
        {
          overallDisplayStatus: 'COMPLIANT' as const,
          cells: [cell({ effectiveStatus: EmployeeComplianceStatus.VALID })],
        },
        {
          overallDisplayStatus: 'ATTENTION' as const,
          cells: [
            cell({
              effectiveStatus: EmployeeComplianceStatus.EXPIRING_SOON,
              daysRemaining: 5,
            }),
            cell({
              code: 'MED',
              effectiveStatus: EmployeeComplianceStatus.EXPIRING_SOON,
              daysRemaining: 12,
            }),
          ],
        },
        {
          overallDisplayStatus: 'ATTENTION' as const,
          cells: [
            cell({
              effectiveStatus: EmployeeComplianceStatus.EXPIRED,
              daysRemaining: -2,
            }),
          ],
        },
        {
          overallDisplayStatus: 'ATTENTION' as const,
          cells: [
            cell({
              effectiveStatus: EmployeeComplianceStatus.EXPIRING_SOON,
              daysRemaining: 15,
            }),
          ],
        },
      ];
      const s = buildBoardEmployeeSummaries(rows);
      expect(s.fullyCompliantCount).toBe(1);
      expect(s.needsActionCount).toBe(3);
      expect(s.expiredCount).toBe(1);
      expect(s.expiring7Count).toBe(1);
      expect(s.expiring8To30Count).toBe(1);
    });
  });

  describe('issue counts', () => {
    it('counts board-visible blocking vs warning', () => {
      expect(
        countBoardIssues([
          cell({
            effectiveStatus: EmployeeComplianceStatus.MISSING,
            blocksRostering: true,
          }),
          cell({
            code: 'APPRSL',
            effectiveStatus: EmployeeComplianceStatus.EXPIRING_SOON,
            daysRemaining: 10,
            blocksRostering: false,
          }),
        ]),
      ).toEqual({ blockingIssueCount: 1, warningIssueCount: 1, totalIssueCount: 2 });
    });

    it('counts off-board allocation issues separately', () => {
      expect(
        countOffBoardAllocationIssues({
          cells: [cell({ code: 'DBS', typeName: 'DBS Check' })],
          blockingLabels: ['DBS missing', 'Mandatory training incomplete'],
          warningLabels: [],
        }),
      ).toBe(1);
    });
  });
});
