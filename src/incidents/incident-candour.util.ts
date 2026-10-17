/**
 * Duty of Candour — Regulation 20 of the Health and Social Care Act 2008 (Regulated Activities)
 * Regulations 2014 (SI 2014/2936). One record per affected service user.
 *
 * - 20(2): tell the person as soon as reasonably practicable and offer reasonable support;
 * - 20(3): in person — the facts known, the further enquiries, an apology, kept in writing;
 * - 20(4): followed in writing — the same account, the enquiries, their results, an apology;
 * - 20(5): if the person can't be contacted or declines, record the attempts instead;
 * - 20(6): keep a copy of every letter;
 * - 20(9): notifiable when, in a health care professional's reasonable opinion, the incident
 *   caused (or needs treatment to prevent) one of CANDOUR_HARM_TYPES.
 */

export const CANDOUR_DECISIONS = ['YES', 'NO', 'NOT_KNOWN', 'NOT_APPLICABLE'] as const;
export type CandourDecision = (typeof CANDOUR_DECISIONS)[number];

export const CANDOUR_DECISION_LABELS: Record<CandourDecision, string> = {
  YES: 'Yes',
  NO: 'No',
  NOT_KNOWN: 'Not known yet',
  NOT_APPLICABLE: 'Not applicable',
};

/** Regulation 20(9) — the harms that make an incident notifiable for a care provider. */
export const CANDOUR_HARM_TYPES = [
  'DEATH',
  'IMPAIRMENT_28_DAYS',
  'BODY_STRUCTURE_CHANGE',
  'PROLONGED_PAIN',
  'PROLONGED_PSYCH_HARM',
  'SHORTENED_LIFE',
  'TREATMENT_TO_PREVENT',
] as const;

export const CANDOUR_HARM_LABELS: Record<(typeof CANDOUR_HARM_TYPES)[number], string> = {
  DEATH: 'Death caused by the incident (not the natural course of an illness)',
  IMPAIRMENT_28_DAYS: 'Impairment of sensory, motor or intellectual function for 28 days or more',
  BODY_STRUCTURE_CHANGE: 'Change to the structure of the body',
  PROLONGED_PAIN: 'Pain for a continuous 28 days or more',
  PROLONGED_PSYCH_HARM: 'Psychological harm for a continuous 28 days or more',
  SHORTENED_LIFE: 'Shortened life expectancy',
  TREATMENT_TO_PREVENT: 'Treatment needed to prevent one of these',
};

export const CANDOUR_TOLD_PERSON_KINDS = ['SERVICE_USER', 'REPRESENTATIVE'] as const;
export const CANDOUR_LETTER_METHODS = ['POST', 'EMAIL', 'HANDED'] as const;
export const CANDOUR_UNABLE_REASONS = ['DECLINED', 'NOT_CONTACTABLE', 'NO_REPRESENTATIVE'] as const;
export const CANDOUR_ATTEMPT_METHODS = ['PHONE', 'VISIT', 'LETTER', 'EMAIL', 'OTHER'] as const;

export const CANDOUR_UNABLE_REASON_LABELS: Record<(typeof CANDOUR_UNABLE_REASONS)[number], string> = {
  DECLINED: 'Declined to speak',
  NOT_CONTACTABLE: 'Could not be contacted',
  NO_REPRESENTATIVE: 'No one can act for them',
};

export type CandourStatus = 'NOT_DECIDED' | 'NOT_KNOWN' | 'NOT_REQUIRED' | 'IN_PROGRESS' | 'COMPLETE';

/** The fields the rules look at (dates as YYYY-MM-DD). */
export type CandourState = {
  decision: string | null;
  toldOn: string | null;
  toldByEmployeeId: string | null;
  toldPersonKind: string | null;
  factsExplained: boolean;
  enquiriesExplained: boolean;
  apologyGiven: boolean;
  supportOffered: string | null;
  writtenSentOn: string | null;
  writtenMethod: string | null;
  writtenAttachmentId: string | null;
  resultsSharedOn: string | null;
  resultsAttachmentId: string | null;
  noFurtherEnquiriesReason: string | null;
  unableToNotify: boolean;
  unableReason: string | null;
  attemptCount: number;
};

const filled = (v: string | null | undefined) => !!v && v.trim().length > 0;

export function candourSteps(s: CandourState) {
  const told =
    filled(s.toldOn) &&
    filled(s.toldByEmployeeId) &&
    filled(s.toldPersonKind) &&
    s.factsExplained &&
    s.enquiriesExplained &&
    s.apologyGiven &&
    filled(s.supportOffered);
  const written = filled(s.writtenSentOn) && filled(s.writtenMethod) && filled(s.writtenAttachmentId);
  const results =
    (filled(s.resultsSharedOn) && filled(s.resultsAttachmentId)) || filled(s.noFurtherEnquiriesReason);
  const unable = s.unableToNotify && filled(s.unableReason) && s.attemptCount > 0;
  return { told, written, results, unable };
}

export function candourStatus(s: CandourState): CandourStatus {
  if (!s.decision) return 'NOT_DECIDED';
  if (s.decision === 'NOT_KNOWN') return 'NOT_KNOWN';
  if (s.decision !== 'YES') return 'NOT_REQUIRED';
  const steps = candourSteps(s);
  if (steps.unable) return 'COMPLETE';
  return steps.told && steps.written && steps.results ? 'COMPLETE' : 'IN_PROGRESS';
}

/** What a step still needs, in plain words (the API rejects with these; the UI shows them). */
export function candourMissing(s: CandourState): string[] {
  if (candourStatus(s) !== 'IN_PROGRESS') return [];
  const steps = candourSteps(s);
  if (s.unableToNotify) {
    return [
      !filled(s.unableReason) && 'why they could not be told',
      s.attemptCount === 0 && 'at least one contact attempt',
    ].filter((m): m is string => !!m);
  }
  return [
    !steps.told && 'telling them in person',
    !steps.written && 'the written follow-up (with a copy)',
    !steps.results && 'sharing the results (or why there are no further enquiries)',
  ].filter((m): m is string => !!m);
}

/**
 * "Likely Duty of Candour" — a suggestion only; the manager decides with a health professional.
 * An expected death (natural course of illness) is not suggested.
 */
export function candourHintReasons(input: {
  severity: string | null;
  categoryKey: string | null;
  subtypeKey: string | null;
  admittedToHospital: boolean | null;
  takenToAe: boolean | null;
  seriousServiceUserInjury: boolean;
}): string[] {
  const reasons: string[] = [];
  const expectedDeath = input.categoryKey === 'DEATH' && input.subtypeKey === 'EXPECTED_DEATH';
  if (expectedDeath) return [];
  if (input.categoryKey === 'DEATH' && !expectedDeath) reasons.push('a death that was not expected');
  if (input.severity === 'HIGH' || input.severity === 'CRITICAL') {
    reasons.push(`${input.severity === 'HIGH' ? 'High' : 'Critical'} severity`);
  }
  if (input.seriousServiceUserInjury) reasons.push('a serious injury');
  if (input.admittedToHospital) reasons.push('admitted to hospital');
  else if (input.takenToAe) reasons.push('taken to A&E');
  return reasons;
}

export type CandourDecisionInput = {
  decision: string;
  decisionReason?: string | null;
  harmTypes?: string[] | null;
  healthProfessionalName?: string | null;
  healthProfessionalRole?: string | null;
};

export function candourDecisionProblems(input: CandourDecisionInput): string[] {
  const problems: string[] = [];
  const harms = input.harmTypes ?? [];
  if (input.decision === 'YES' && harms.length === 0) problems.push('which harm applies');
  if ((input.decision === 'NO' || input.decision === 'NOT_APPLICABLE') && !filled(input.decisionReason)) {
    problems.push('the reason');
  }
  if (input.decision === 'YES' || input.decision === 'NO') {
    if (!filled(input.healthProfessionalName) || !filled(input.healthProfessionalRole)) {
      problems.push('the health professional consulted (name and role)');
    }
  }
  return problems;
}

/** Date rules (all YYYY-MM-DD in the organisation's time zone). */
export function candourDateProblem(input: {
  label: string;
  date: string;
  today: string;
  incidentDay: string;
  notBefore?: { date: string | null; label: string };
}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return `${input.label}: enter a valid date`;
  if (input.date > input.today) return `${input.label} can't be in the future`;
  if (input.date < input.incidentDay) return `${input.label} can't be before the incident happened`;
  if (input.notBefore?.date && input.date < input.notBefore.date) {
    return `${input.label} can't be before ${input.notBefore.label}`;
  }
  return null;
}

/** Days between two YYYY-MM-DD dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Overdue: the duty applies (Yes, or Not known yet), nobody has been told in person, the person
 * hasn't been recorded as unreachable, and more than `overdueDays` have passed since the duty
 * started. `overdueDays` null = the organisation hasn't set a limit.
 */
export function candourOverdue(input: {
  decision: string | null;
  toldOn: string | null;
  unableToNotify: boolean;
  dutyStartedDay: string | null;
  today: string;
  overdueDays: number | null;
}): boolean {
  if (input.overdueDays == null || !input.dutyStartedDay) return false;
  if (input.decision !== 'YES' && input.decision !== 'NOT_KNOWN') return false;
  if (input.toldOn || input.unableToNotify) return false;
  return daysBetween(input.dutyStartedDay, input.today) > input.overdueDays;
}

/** Service users Duty of Candour is about: only when a service user was affected. */
export function candourSubjectIds(incident: {
  affectedPersonKinds: string[];
  primaryServiceUserId: string | null;
  involvedServiceUserIds: string[];
}): string[] {
  if (!incident.affectedPersonKinds.includes('SERVICE_USER')) return [];
  return [
    ...new Set(
      [incident.primaryServiceUserId, ...incident.involvedServiceUserIds].filter(
        (v): v is string => !!v,
      ),
    ),
  ];
}

/** Close check: undecided / not-known always block; Yes-but-incomplete needs a manager's reason. */
export function candourCloseCheck(records: { name: string; status: CandourStatus }[]): {
  blocking: string[];
  incomplete: string[];
} {
  return {
    blocking: records
      .filter((r) => r.status === 'NOT_DECIDED' || r.status === 'NOT_KNOWN')
      .map((r) => r.name),
    incomplete: records.filter((r) => r.status === 'IN_PROGRESS').map((r) => r.name),
  };
}
