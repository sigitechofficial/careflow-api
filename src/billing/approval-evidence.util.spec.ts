import {
  approvalAfterEvidenceChange,
  describeEvidenceChange,
  evidenceFingerprint,
  inferApprovalSource,
} from './approval-evidence.util';

const at = (hm: string) => new Date(`2026-11-03T${hm}:00Z`);
const evidence = (start: string, end: string, needsReview = false) =>
  evidenceFingerprint({
    actualStart: at(start),
    actualEnd: at(end),
    needsReview,
  });

describe('approval evidence (R-18)', () => {
  it('the fingerprint is the recorded times to the minute and the review flag', () => {
    expect(evidence('09:00', '10:00')).toBe(
      '2026-11-03T09:00|2026-11-03T10:00|OK',
    );
    expect(evidence('09:00', '10:00', true)).toBe(
      '2026-11-03T09:00|2026-11-03T10:00|REVIEW',
    );
    expect(
      evidenceFingerprint({
        actualStart: null,
        actualEnd: null,
        needsReview: false,
      }),
    ).toBe('-|-|OK');
    // Seconds do not make evidence "different".
    expect(
      evidenceFingerprint({
        actualStart: new Date('2026-11-03T09:00:41Z'),
        actualEnd: at('10:00'),
        needsReview: false,
      }),
    ).toBe(evidence('09:00', '10:00'));
  });

  it('an approval recorded before sources existed is automatic unless a person is named', () => {
    expect(inferApprovalSource({ approvedById: null })).toBe('AUTO_VERIFIED');
    expect(inferApprovalSource({ approvedById: 'user-1' })).toBe(
      'MANAGER_APPROVED',
    );
    expect(
      inferApprovalSource({
        approvalSource: 'MANAGER_OVERRIDE',
        approvedById: 'user-1',
      }),
    ).toBe('MANAGER_OVERRIDE');
    expect(
      inferApprovalSource({
        approvalSource: 'AUTO_VERIFIED',
        approvedById: null,
      }),
    ).toBe('AUTO_VERIFIED');
  });

  const base = {
    approved: true,
    paySettled: false,
    approvalSource: 'AUTO_VERIFIED',
    approvedById: null,
    approvedEvidence: evidence('09:00', '10:00'),
    currentEvidence: evidence('09:00', '10:00'),
  };

  it('same evidence, delivered again: nothing changes', () => {
    expect(approvalAfterEvidenceChange(base)).toBe('KEEP');
  });

  it('an unapproved visit has no approval to withdraw', () => {
    expect(
      approvalAfterEvidenceChange({
        ...base,
        approved: false,
        currentEvidence: evidence('09:00', '09:30'),
      }),
    ).toBe('KEEP');
  });

  it('an approval without recorded evidence adopts the current evidence', () => {
    expect(
      approvalAfterEvidenceChange({ ...base, approvedEvidence: null }),
    ).toBe('ADOPT');
  });

  it('an automatic approval on other evidence is withdrawn', () => {
    expect(
      approvalAfterEvidenceChange({
        ...base,
        currentEvidence: evidence('09:00', '09:30'),
      }),
    ).toBe('WITHDRAW_AUTO');
    expect(
      approvalAfterEvidenceChange({
        ...base,
        currentEvidence: evidence('09:00', '10:00', true),
      }),
    ).toBe('WITHDRAW_AUTO');
  });

  it("a person's approval on other evidence needs a new review", () => {
    for (const approvalSource of ['MANAGER_APPROVED', 'MANAGER_OVERRIDE']) {
      expect(
        approvalAfterEvidenceChange({
          ...base,
          approvalSource,
          approvedById: 'user-1',
          currentEvidence: evidence('09:00', '09:30'),
        }),
      ).toBe('REQUIRE_REVIEW');
    }
    // Recorded before sources existed, with an approver: treated as a person's approval.
    expect(
      approvalAfterEvidenceChange({
        ...base,
        approvalSource: null,
        approvedById: 'user-1',
        currentEvidence: evidence('09:00', '09:30'),
      }),
    ).toBe('REQUIRE_REVIEW');
  });

  it('settled pay is flagged, never withdrawn, whoever approved it', () => {
    for (const approvalSource of ['AUTO_VERIFIED', 'MANAGER_APPROVED']) {
      expect(
        approvalAfterEvidenceChange({
          ...base,
          approvalSource,
          paySettled: true,
          currentEvidence: evidence('09:00', '09:30'),
        }),
      ).toBe('FLAG_SETTLED');
    }
    expect(approvalAfterEvidenceChange({ ...base, paySettled: true })).toBe(
      'KEEP',
    );
  });

  it('says what changed', () => {
    expect(
      describeEvidenceChange(
        evidence('09:00', '10:00'),
        evidence('09:00', '09:30'),
      ),
    ).toBe('finish was 2026-11-03 10:00 UTC, now 2026-11-03 09:30 UTC');
    expect(
      describeEvidenceChange(
        evidence('09:00', '10:00'),
        evidence('09:00', '10:00', true),
      ),
    ).toBe("the carer's times now await verification");
    expect(
      describeEvidenceChange('-|-|OK', evidence('09:00', '10:00')),
    ).toMatch(/start was not recorded/);
  });
});
