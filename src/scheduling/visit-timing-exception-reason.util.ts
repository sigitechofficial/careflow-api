/**
 * Structured reason codes for timing / delivery exceptions (CQC / commissioner evidence).
 * Cancel/call-off continues to use VisitCancellationReasonCode separately.
 */

export const VISIT_TIMING_EXCEPTION_REASON_CODES = [
  'PREVIOUS_VISIT_OVERRAN',
  'TRAFFIC_OR_ROAD_CLOSURE',
  'INSUFFICIENT_PLANNED_TRAVEL',
  'INCORRECT_CHECK_IN_OR_OUT',
  'PROVIDER_STAFFING_SHORTAGE',
  'COMMISSIONER_DIRECTED_CHANGE',
  'CLIENT_REQUEST_OR_NEED',
  'CLINICAL_COMPLEXITY',
  'ACCESS_OR_ENTRY_DELAY',
  'SYSTEM_OR_DEVICE_ISSUE',
  'OTHER',
] as const;

export type VisitTimingExceptionReasonCode =
  (typeof VISIT_TIMING_EXCEPTION_REASON_CODES)[number];

export type VisitTimingExceptionReasonMeta = {
  code: VisitTimingExceptionReasonCode;
  label: string;
  description: string;
  requiresNotes?: boolean;
};

export const VISIT_TIMING_EXCEPTION_REASONS: VisitTimingExceptionReasonMeta[] = [
  {
    code: 'PREVIOUS_VISIT_OVERRAN',
    label: 'Previous visit overran',
    description: 'Earlier call ran long and delayed this visit.',
  },
  {
    code: 'TRAFFIC_OR_ROAD_CLOSURE',
    label: 'Traffic or road closure',
    description: 'Travel delay due to traffic, diversion, or road closure.',
  },
  {
    code: 'INSUFFICIENT_PLANNED_TRAVEL',
    label: 'Insufficient planned travel time',
    description: 'Rota gap between calls was too short for safe travel.',
  },
  {
    code: 'INCORRECT_CHECK_IN_OR_OUT',
    label: 'Incorrect check-in / check-out',
    description: 'Timestamps were wrong or adjusted after the fact.',
  },
  {
    code: 'PROVIDER_STAFFING_SHORTAGE',
    label: 'Provider staffing shortage',
    description: 'Cover or late allocation affected punctuality or duration.',
  },
  {
    code: 'COMMISSIONER_DIRECTED_CHANGE',
    label: 'Commissioner-directed change',
    description: 'Authority or funder directed a timing or duration change.',
  },
  {
    code: 'CLIENT_REQUEST_OR_NEED',
    label: 'Client request or need',
    description: 'Person or family asked for earlier/later arrival or shorter/longer stay.',
  },
  {
    code: 'CLINICAL_COMPLEXITY',
    label: 'Clinical complexity',
    description: 'Care needs on the day required more or less time than planned.',
  },
  {
    code: 'ACCESS_OR_ENTRY_DELAY',
    label: 'Access or entry delay',
    description: 'Keysafe, door entry, or gaining access delayed the call.',
  },
  {
    code: 'SYSTEM_OR_DEVICE_ISSUE',
    label: 'System or device issue',
    description: 'App, device, or connectivity affected recorded times.',
  },
  {
    code: 'OTHER',
    label: 'Other',
    description: 'Reason not listed — notes required.',
    requiresNotes: true,
  },
];

const CODE_SET = new Set<string>(VISIT_TIMING_EXCEPTION_REASON_CODES);

export function isVisitTimingExceptionReasonCode(
  value: string | null | undefined,
): value is VisitTimingExceptionReasonCode {
  return Boolean(value && CODE_SET.has(value));
}

export function visitTimingExceptionReasonLabel(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  return VISIT_TIMING_EXCEPTION_REASONS.find((r) => r.code === code)?.label ?? code;
}
