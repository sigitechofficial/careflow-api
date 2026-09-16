export const MANUAL_REJECT_REASONS = [
  {
    code: 'MOVE_INTO_AREA',
    label: 'Carer can reach the visit area',
    requiresNotes: false,
  },
  {
    code: 'USE_GPS',
    label: 'Use GPS check-in',
    requiresNotes: false,
  },
  {
    code: 'INSUFFICIENT_INFO',
    label: 'Not enough information',
    requiresNotes: false,
  },
  {
    code: 'SAFETY_OR_POLICY',
    label: 'Safety or policy concern',
    requiresNotes: false,
  },
  {
    code: 'OTHER',
    label: 'Other reason',
    requiresNotes: true,
  },
] as const;

export type ManualRejectReasonCode = (typeof MANUAL_REJECT_REASONS)[number]['code'];

export const MANUAL_REJECT_REASON_CODES = MANUAL_REJECT_REASONS.map(row => row.code);

export function findManualRejectReason(code: string | null | undefined) {
  const normalized = code?.trim().toUpperCase();
  if (!normalized) return null;
  return MANUAL_REJECT_REASONS.find(row => row.code === normalized) ?? null;
}
