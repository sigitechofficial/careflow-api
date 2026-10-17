/**
 * Approvals are tied to the attendance evidence that justified them (R-18).
 *
 * An approval remembers a fingerprint of the evidence it was given for: the recorded start and
 * finish, and whether the carer's times were still awaiting review. When the evidence later
 * differs from that fingerprint:
 *
 *   - an automatic approval is withdrawn and the visit is judged again on the new evidence;
 *   - a person's approval is kept on record with its notes, but the visit goes back for review;
 *   - a visit whose pay is settled is not touched: it is flagged, and any change to its pay goes
 *     through a pay correction.
 *
 * The same evidence delivered twice has the same fingerprint, so it changes nothing.
 */

/** Who or what approved. A pay correction's approval lives on the correction item itself. */
export type ApprovalSource =
  | 'AUTO_VERIFIED'
  | 'MANAGER_APPROVED'
  | 'MANAGER_OVERRIDE';

export type ApprovalEvidence = {
  actualStart: Date | null;
  actualEnd: Date | null;
  /** The carer's times still await office review. */
  needsReview: boolean;
};

const minute = (d: Date | null) => (d ? d.toISOString().slice(0, 16) : '-');

/** Stable text form of the evidence, to the minute. */
export function evidenceFingerprint(evidence: ApprovalEvidence): string {
  return `${minute(evidence.actualStart)}|${minute(evidence.actualEnd)}|${
    evidence.needsReview ? 'REVIEW' : 'OK'
  }`;
}

/** The source of an approval recorded before sources were stored. */
export function inferApprovalSource(row: {
  approvalSource?: string | null;
  approvedById?: string | null;
}): ApprovalSource {
  if (
    row.approvalSource === 'AUTO_VERIFIED' ||
    row.approvalSource === 'MANAGER_APPROVED' ||
    row.approvalSource === 'MANAGER_OVERRIDE'
  ) {
    return row.approvalSource;
  }
  return row.approvedById ? 'MANAGER_APPROVED' : 'AUTO_VERIFIED';
}

export type EvidenceChangeOutcome =
  /** Nothing approved, or the evidence is what was approved. */
  | 'KEEP'
  /** Approved before evidence was recorded: note the current evidence, change nothing else. */
  | 'ADOPT'
  /** Automatic approval on other evidence: withdraw it and judge the visit again. */
  | 'WITHDRAW_AUTO'
  /** A person approved other evidence: keep their approval on record, require a new review. */
  | 'REQUIRE_REVIEW'
  /** Pay is settled: leave it, flag the change for a possible pay correction. */
  | 'FLAG_SETTLED';

export function approvalAfterEvidenceChange(input: {
  approved: boolean;
  paySettled: boolean;
  approvalSource?: string | null;
  approvedById?: string | null;
  approvedEvidence?: string | null;
  currentEvidence: string;
}): EvidenceChangeOutcome {
  if (!input.approved && !input.paySettled) return 'KEEP';
  if (!input.approvedEvidence) return 'ADOPT';
  if (input.approvedEvidence === input.currentEvidence) return 'KEEP';
  if (input.paySettled) return 'FLAG_SETTLED';
  return inferApprovalSource(input) === 'AUTO_VERIFIED'
    ? 'WITHDRAW_AUTO'
    : 'REQUIRE_REVIEW';
}

const clock = (part: string) =>
  part === '-' ? 'not recorded' : `${part.slice(0, 10)} ${part.slice(11)} UTC`;

/** What changed, for the person who has to review it. */
export function describeEvidenceChange(
  approvedEvidence: string,
  currentEvidence: string,
): string {
  const [oldStart, oldEnd, oldFlag] = approvedEvidence.split('|');
  const [newStart, newEnd, newFlag] = currentEvidence.split('|');
  const parts: string[] = [];
  if (oldStart !== newStart) {
    parts.push(`start was ${clock(oldStart)}, now ${clock(newStart)}`);
  }
  if (oldEnd !== newEnd) {
    parts.push(`finish was ${clock(oldEnd)}, now ${clock(newEnd)}`);
  }
  if (oldFlag !== newFlag) {
    parts.push(
      newFlag === 'REVIEW'
        ? "the carer's times now await verification"
        : "the carer's times have been verified",
    );
  }
  return parts.join('; ');
}
