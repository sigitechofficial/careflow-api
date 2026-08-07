/**
 * Reasons when carer attended (visit stays COMPLETED) but care was not delivered.
 * All codes require notes for audit / ECM clarity.
 */

export const VISIT_CARE_NOT_DELIVERED_REASON_CODES = [
  'CLIENT_NOT_HOME',
  'CLIENT_IN_HOSPITAL',
  'CLIENT_DECEASED',
  'CLIENT_REFUSED',
  'UNSAFE_SITUATION',
  'OTHER',
] as const;

export type VisitCareNotDeliveredReasonCode =
  (typeof VISIT_CARE_NOT_DELIVERED_REASON_CODES)[number];

export type VisitCareNotDeliveredReasonMeta = {
  code: VisitCareNotDeliveredReasonCode;
  label: string;
  description: string;
  requiresNotes?: boolean;
};

export const VISIT_CARE_NOT_DELIVERED_REASONS: VisitCareNotDeliveredReasonMeta[] = [
  {
    code: 'CLIENT_NOT_HOME',
    label: 'Client not at home',
    description: 'Carer arrived but the client was not at the address.',
    requiresNotes: true,
  },
  {
    code: 'CLIENT_IN_HOSPITAL',
    label: 'Client in hospital',
    description: 'Client was in hospital when the carer attended.',
    requiresNotes: true,
  },
  {
    code: 'CLIENT_DECEASED',
    label: 'Client deceased',
    description: 'Client was found deceased or reported deceased for this visit.',
    requiresNotes: true,
  },
  {
    code: 'CLIENT_REFUSED',
    label: 'Client refused care',
    description: 'Client was present but refused care.',
    requiresNotes: true,
  },
  {
    code: 'UNSAFE_SITUATION',
    label: 'Unsafe situation',
    description: 'Carer could not safely deliver care (environment, risk, or threat).',
    requiresNotes: true,
  },
  {
    code: 'OTHER',
    label: 'Other',
    description: 'Reason not listed — notes required.',
    requiresNotes: true,
  },
];

const CODE_SET = new Set<string>(VISIT_CARE_NOT_DELIVERED_REASON_CODES);

export function isVisitCareNotDeliveredReasonCode(
  value: string | null | undefined,
): value is VisitCareNotDeliveredReasonCode {
  return Boolean(value && CODE_SET.has(value));
}

export function visitCareNotDeliveredReasonLabel(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  return VISIT_CARE_NOT_DELIVERED_REASONS.find((r) => r.code === code)?.label ?? code;
}
