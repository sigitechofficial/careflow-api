/**
 * Structured reason codes when office marks a visit as MISSED (did not attend).
 */

export const VISIT_MISSED_REASON_CODES = [
  'CARER_NO_SHOW',
  'NO_COVER_AVAILABLE',
  'SERVICE_USER_NOT_HOME',
  'SERVICE_USER_REFUSED',
  'ACCESS_DENIED',
  'HOSPITAL_OR_ABSENT',
  'FAMILY_CANCELLED_LATE',
  'ROSTERING_ERROR',
  'OTHER',
] as const;

export type VisitMissedReasonCode = (typeof VISIT_MISSED_REASON_CODES)[number];

export type VisitMissedReasonMeta = {
  code: VisitMissedReasonCode;
  label: string;
  description: string;
  requiresNotes?: boolean;
};

export const VISIT_MISSED_REASONS: VisitMissedReasonMeta[] = [
  {
    code: 'CARER_NO_SHOW',
    label: 'Carer did not attend',
    description: 'Allocated carer did not arrive for the visit.',
  },
  {
    code: 'NO_COVER_AVAILABLE',
    label: 'No cover available',
    description: 'No replacement carer could be allocated in time.',
  },
  {
    code: 'SERVICE_USER_NOT_HOME',
    label: 'Service user not home',
    description: 'Nobody answered / service user was not at the address.',
  },
  {
    code: 'SERVICE_USER_REFUSED',
    label: 'Service user refused visit',
    description: 'Care was declined when the carer arrived or contacted.',
  },
  {
    code: 'ACCESS_DENIED',
    label: 'Could not gain access',
    description: 'Keysafe, door entry, or access prevented the visit.',
  },
  {
    code: 'HOSPITAL_OR_ABSENT',
    label: 'Hospital or temporary absence',
    description: 'Service user was in hospital or known to be away.',
  },
  {
    code: 'FAMILY_CANCELLED_LATE',
    label: 'Family cancelled too late',
    description: 'Cancellation came after the visit window had started.',
  },
  {
    code: 'ROSTERING_ERROR',
    label: 'Rostering / scheduling error',
    description: 'Visit should not have been on the rota for this slot.',
  },
  {
    code: 'OTHER',
    label: 'Other',
    description: 'Reason not listed — notes required.',
    requiresNotes: true,
  },
];

const CODE_SET = new Set<string>(VISIT_MISSED_REASON_CODES);

export function isVisitMissedReasonCode(
  value: string | null | undefined,
): value is VisitMissedReasonCode {
  return Boolean(value && CODE_SET.has(value));
}

export function visitMissedReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return VISIT_MISSED_REASONS.find((r) => r.code === code)?.label ?? code;
}
