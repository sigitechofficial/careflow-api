import {
  CandidateCheckStatus,
  CandidateCheckType,
  CandidateOfferStatus,
  CandidateStage,
} from '@prisma/client';

/**
 * The recruitment steps, in order. Each candidate moves one step at a time:
 * Application → Screening → Interview → Conditional offer → Pre-employment checks → Cleared to start.
 * "Hired" is the cleared candidate once converted to an employee.
 */
export const FLOW_STAGES: CandidateStage[] = [
  CandidateStage.APPLIED,
  CandidateStage.SCREENING,
  CandidateStage.INTERVIEW,
  CandidateStage.OFFER,
  CandidateStage.VETTING,
  CandidateStage.ACCEPTED,
];

export const CLOSED_STAGES: CandidateStage[] = [CandidateStage.REJECTED, CandidateStage.WITHDRAWN];

export const STAGE_LABELS: Record<CandidateStage, string> = {
  APPLIED: 'Application',
  SCREENING: 'Screening',
  INTERVIEW: 'Interview',
  OFFER: 'Conditional offer',
  VETTING: 'Pre-employment checks',
  ACCEPTED: 'Cleared to start',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

export const CHECK_LABELS: Record<CandidateCheckType, string> = {
  PROOF_OF_ID: 'Proof of identity (with photo)',
  RIGHT_TO_WORK: 'Right to work',
  DBS: 'Enhanced DBS with adults barred list',
  REFERENCE_1: 'Reference 1 (most recent employer)',
  REFERENCE_2: 'Reference 2',
  QUALIFICATIONS: 'Qualifications',
  HEALTH_DECLARATION: 'Health declaration',
  OVERSEAS_POLICE_CHECK: 'Overseas police check',
  DRIVING: 'Driving licence and business insurance',
};

/** Compliance type codes a verified check is copied to when the candidate becomes an employee (first match wins). */
export const CHECK_COMPLIANCE_CODES: Record<CandidateCheckType, string[]> = {
  PROOF_OF_ID: ['ID_PASSPORT'],
  RIGHT_TO_WORK: ['RIGHT_TO_WORK', 'EMPLOYEE_SHARE_CODE'],
  DBS: ['DBS'],
  REFERENCE_1: ['REFERENCE_1'],
  REFERENCE_2: ['REFERENCE_2'],
  QUALIFICATIONS: ['QUALIFICATION'],
  HEALTH_DECLARATION: ['MEDICAL_QUESTIONNAIRE'],
  OVERSEAS_POLICE_CHECK: [],
  DRIVING: ['DRIVING_LICENCE'],
};

/** The checks a candidate needs (CQC Schedule 3). Qualifications are recorded where practicable, so optional. */
export function checksForCandidate(input: {
  drivesForWork: boolean | null;
  livedOverseas: boolean | null;
}): { type: CandidateCheckType; required: boolean }[] {
  const list: { type: CandidateCheckType; required: boolean }[] = [
    { type: CandidateCheckType.PROOF_OF_ID, required: true },
    { type: CandidateCheckType.RIGHT_TO_WORK, required: true },
    { type: CandidateCheckType.DBS, required: true },
    { type: CandidateCheckType.REFERENCE_1, required: true },
    { type: CandidateCheckType.REFERENCE_2, required: true },
    { type: CandidateCheckType.HEALTH_DECLARATION, required: true },
    { type: CandidateCheckType.QUALIFICATIONS, required: false },
  ];
  if (input.livedOverseas) list.push({ type: CandidateCheckType.OVERSEAS_POLICE_CHECK, required: true });
  if (input.drivesForWork) list.push({ type: CandidateCheckType.DRIVING, required: true });
  return list;
}

/* ─── Employment history (Schedule 3 #7: full history, with gaps explained) ─── */

export type EmploymentHistoryEntry = {
  kind: 'JOB' | 'GAP';
  /** YYYY-MM */
  from: string;
  /** YYYY-MM, or null while it is still going on. */
  to: string | null;
  employer?: string | null;
  jobTitle?: string | null;
  reasonForLeaving?: string | null;
  careRole?: boolean | null;
  /** For a GAP: what the candidate was doing. */
  explanation?: string | null;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthIndex(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
}

function monthString(index: number): string {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2023-07" → "Jul 2023" */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return MONTH_NAMES[m - 1] ? `${MONTH_NAMES[m - 1]} ${y}` : ym;
}

export function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Problems with the entries themselves (shown to the user before saving). */
export function employmentHistoryErrors(entries: EmploymentHistoryEntry[]): string[] {
  const errors: string[] = [];
  entries.forEach((e, i) => {
    const row = `Row ${i + 1}`;
    if (e.kind !== 'JOB' && e.kind !== 'GAP') errors.push(`${row}: choose a job or a gap.`);
    if (!MONTH.test(e.from ?? '')) errors.push(`${row}: the start month is missing.`);
    if (e.to !== null && e.to !== undefined && !MONTH.test(e.to)) errors.push(`${row}: the end month is not valid.`);
    if (MONTH.test(e.from ?? '') && e.to && MONTH.test(e.to) && monthIndex(e.to) < monthIndex(e.from)) {
      errors.push(`${row}: the end month is before the start month.`);
    }
    if (e.kind === 'JOB' && !e.employer?.trim()) errors.push(`${row}: the employer is missing.`);
    if (e.kind === 'GAP' && !e.explanation?.trim()) errors.push(`${row}: say what the candidate was doing.`);
  });
  return errors;
}

/**
 * Months not covered by any job or explained gap, from the first entry up to last month.
 * A whole calendar month with nothing in it counts as a gap.
 */
export function findUnexplainedGaps(
  entries: EmploymentHistoryEntry[],
  now = new Date(),
): { from: string; to: string }[] {
  const valid = entries.filter((e) => MONTH.test(e.from ?? '') && (!e.to || MONTH.test(e.to)));
  if (valid.length === 0) return [];
  const thisMonth = monthIndex(currentMonth(now));
  const spans = valid
    .map((e) => ({ start: monthIndex(e.from), end: e.to ? monthIndex(e.to) : thisMonth }))
    .sort((a, b) => a.start - b.start);

  const gaps: { from: string; to: string }[] = [];
  let coveredUntil = spans[0].end;
  for (const span of spans.slice(1)) {
    if (span.start > coveredUntil + 1) {
      gaps.push({ from: monthString(coveredUntil + 1), to: monthString(span.start - 1) });
    }
    coveredUntil = Math.max(coveredUntil, span.end);
  }
  // Out of work since the last entry ended (the current month itself is not counted yet).
  if (coveredUntil + 1 < thisMonth) {
    gaps.push({ from: monthString(coveredUntil + 1), to: monthString(thisMonth - 1) });
  }
  return gaps;
}

export function parseEmploymentHistory(value: unknown): EmploymentHistoryEntry[] {
  return Array.isArray(value) ? (value as EmploymentHistoryEntry[]) : [];
}

/* ─── Moving between steps ─── */

export type StageMoveContext = {
  hasRightToWork: boolean | null;
  hasPositiveInterview: boolean;
  offerStatus: CandidateOfferStatus | null;
  /** The stage before the candidate was rejected / withdrew (to reopen to). */
  stageBeforeClosing: CandidateStage | null;
};

/**
 * Why the candidate cannot move from `from` to `to` with a plain stage change, or null when they can.
 * Steps go one at a time; making an offer, accepting it and clearing have their own actions.
 */
export function stageMoveError(from: CandidateStage, to: CandidateStage, ctx: StageMoveContext): string | null {
  if (from === to) return null;
  if (CLOSED_STAGES.includes(to)) return null; // rejecting / withdrawing is allowed from any open step
  if (CLOSED_STAGES.includes(from)) {
    return to === ctx.stageBeforeClosing
      ? null
      : `A closed application can only be reopened at ${ctx.stageBeforeClosing ? STAGE_LABELS[ctx.stageBeforeClosing] : 'the step it was closed at'}.`;
  }

  const fromIdx = FLOW_STAGES.indexOf(from);
  const toIdx = FLOW_STAGES.indexOf(to);
  if (toIdx === fromIdx - 1) return null; // one step back
  if (toIdx !== fromIdx + 1) return 'Move one step at a time.';

  switch (to) {
    case CandidateStage.SCREENING:
      return null;
    case CandidateStage.INTERVIEW:
      if (ctx.hasRightToWork === null) return 'Answer the screening questions first.';
      if (ctx.hasRightToWork === false) return 'The candidate does not have the right to work in the UK.';
      return null;
    case CandidateStage.OFFER:
      return ctx.hasPositiveInterview
        ? null
        : 'Complete an interview with a "Hire" or "Maybe" recommendation before making an offer.';
    case CandidateStage.VETTING:
      return ctx.offerStatus === CandidateOfferStatus.ACCEPTED
        ? null
        : 'Record that the candidate accepted the conditional offer.';
    case CandidateStage.ACCEPTED:
      return 'Use "Clear to start" once every check is verified.';
    default:
      return 'This move is not allowed.';
  }
}

/* ─── Clearance gate ─── */

/** What still stops "Clear to start", and where on the candidate page it is fixed. */
export type ClearanceBlocker = {
  message: string;
  target: 'STAGE' | 'CONSENT' | 'EMPLOYMENT_HISTORY' | 'CHECKS' | 'CHECK';
  checkType?: CandidateCheckType;
};

type ClearanceInput = {
  stage: CandidateStage;
  dataProcessingConsent: boolean;
  employmentHistory: EmploymentHistoryEntry[];
  checks: { type: CandidateCheckType; required: boolean; status: CandidateCheckStatus }[];
  now?: Date;
};

export function clearanceBlockerItems(input: ClearanceInput): ClearanceBlocker[] {
  const blockers: ClearanceBlocker[] = [];
  const add = (message: string, target: ClearanceBlocker['target'], checkType?: CandidateCheckType) =>
    blockers.push(checkType ? { message, target, checkType } : { message, target });
  if (input.stage !== CandidateStage.VETTING) {
    add('The candidate must be at the pre-employment checks step.', 'STAGE');
  }
  if (!input.dataProcessingConsent) add("Record the candidate's data processing consent.", 'CONSENT');
  if (input.employmentHistory.length === 0) {
    add('Add the full employment history.', 'EMPLOYMENT_HISTORY');
  } else {
    if (employmentHistoryErrors(input.employmentHistory).length > 0) {
      add('Fix the employment history rows that are incomplete.', 'EMPLOYMENT_HISTORY');
    }
    for (const gap of findUnexplainedGaps(input.employmentHistory, input.now)) {
      add(`Explain the employment gap ${monthLabel(gap.from)} – ${monthLabel(gap.to)}.`, 'EMPLOYMENT_HISTORY');
    }
  }
  if (input.checks.length === 0) add('The pre-employment checks have not been set up.', 'CHECKS');
  for (const check of input.checks) {
    if (check.status === CandidateCheckStatus.FAILED) {
      add(`${CHECK_LABELS[check.type]} failed.`, 'CHECK', check.type);
    } else if (
      check.required &&
      check.status !== CandidateCheckStatus.VERIFIED &&
      check.status !== CandidateCheckStatus.NOT_REQUIRED
    ) {
      add(`${CHECK_LABELS[check.type]} is not verified yet.`, 'CHECK', check.type);
    }
  }
  return blockers;
}

export function clearanceBlockers(input: ClearanceInput): string[] {
  return clearanceBlockerItems(input).map((b) => b.message);
}
