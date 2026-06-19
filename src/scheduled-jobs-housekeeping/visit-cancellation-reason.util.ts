import { ScheduledJobStatus, VisitChargeDecision } from '@prisma/client';

export type VisitCancellationReasonCode =
  | 'CLIENT_HOSPITAL_ADMISSION'
  | 'CLIENT_REQUEST'
  | 'CLIENT_UNAVAILABLE'
  | 'VISIT_PLAN_SUSPENDED'
  | 'SERVICE_NOT_REQUIRED'
  | 'PROVIDER_UNABLE_TO_STAFF'
  | 'PROVIDER_ROTA_ERROR'
  | 'WEATHER_OR_EMERGENCY'
  | 'DUPLICATE_ENTRY'
  | 'OTHER';

export type VisitCancellationReasonMeta = {
  code: VisitCancellationReasonCode;
  label: string;
  description: string;
  defaultOutcome: 'CANCELLED' | 'CALLED_OFF';
  suggestedCharge: VisitChargeDecision;
  requiresNotes?: boolean;
};

export const VISIT_CANCELLATION_REASONS: VisitCancellationReasonMeta[] = [
  {
    code: 'CLIENT_HOSPITAL_ADMISSION',
    label: 'Client hospital admission',
    description: 'Planned stop — client admitted or in inpatient/respite care.',
    defaultOutcome: 'CANCELLED',
    suggestedCharge: 'NO_CHARGE',
  },
  {
    code: 'CLIENT_REQUEST',
    label: 'Client / family request',
    description: 'Client or representative asked to cancel this visit.',
    defaultOutcome: 'CANCELLED',
    suggestedCharge: 'PENDING_REVIEW',
  },
  {
    code: 'CLIENT_UNAVAILABLE',
    label: 'Client unavailable (not at home)',
    description: 'Visit due but client could not be reached or was not available.',
    defaultOutcome: 'CALLED_OFF',
    suggestedCharge: 'PENDING_REVIEW',
  },
  {
    code: 'VISIT_PLAN_SUSPENDED',
    label: 'Visit plan suspended / ended',
    description: 'Care package change — visit no longer authorised.',
    defaultOutcome: 'CANCELLED',
    suggestedCharge: 'NO_CHARGE',
  },
  {
    code: 'SERVICE_NOT_REQUIRED',
    label: 'Service not required today',
    description: 'Agreed with client/commissioner that this call is not needed.',
    defaultOutcome: 'CANCELLED',
    suggestedCharge: 'NO_CHARGE',
  },
  {
    code: 'PROVIDER_UNABLE_TO_STAFF',
    label: 'Provider unable to staff',
    description: 'Agency could not deploy a carer — visit did not take place.',
    defaultOutcome: 'CALLED_OFF',
    suggestedCharge: 'NO_CHARGE',
  },
  {
    code: 'PROVIDER_ROTA_ERROR',
    label: 'Rota / scheduling error',
    description: 'Duplicate entry, wrong client, or administrative correction.',
    defaultOutcome: 'CANCELLED',
    suggestedCharge: 'NO_CHARGE',
  },
  {
    code: 'WEATHER_OR_EMERGENCY',
    label: 'Weather / emergency',
    description: 'External event prevented safe delivery of care.',
    defaultOutcome: 'CALLED_OFF',
    suggestedCharge: 'PENDING_REVIEW',
  },
  {
    code: 'DUPLICATE_ENTRY',
    label: 'Duplicate rota entry',
    description: 'Remove duplicate job without a missed-visit incident.',
    defaultOutcome: 'CANCELLED',
    suggestedCharge: 'NO_CHARGE',
  },
  {
    code: 'OTHER',
    label: 'Other (specify)',
    description: 'Another reason — free-text notes required.',
    defaultOutcome: 'CALLED_OFF',
    suggestedCharge: 'PENDING_REVIEW',
    requiresNotes: true,
  },
];

export const VISIT_CHARGE_DECISION_OPTIONS: Array<{
  value: VisitChargeDecision;
  label: string;
  description: string;
}> = [
  {
    value: 'CHARGE',
    label: 'Charge',
    description: 'Billable — e.g. late client cancellation or access failure.',
  },
  {
    value: 'NO_CHARGE',
    label: 'Do not charge',
    description: 'Not billable — provider or commissioner agreed no fee.',
  },
  {
    value: 'WAIVE',
    label: 'Waive charge',
    description: 'Would normally charge but fee waived (goodwill/commercial).',
  },
  {
    value: 'PENDING_REVIEW',
    label: 'Pending finance review',
    description: 'Commissioner/finance team must confirm billing outcome.',
  },
];

export function visitCancellationReasonMeta(
  code: VisitCancellationReasonCode,
): VisitCancellationReasonMeta {
  return (
    VISIT_CANCELLATION_REASONS.find((row) => row.code === code) ??
    VISIT_CANCELLATION_REASONS[VISIT_CANCELLATION_REASONS.length - 1]!
  );
}

export function visitCancellationOutcomeStatus(
  outcome: 'CANCELLED' | 'CALLED_OFF',
): ScheduledJobStatus {
  return outcome === 'CALLED_OFF' ? ScheduledJobStatus.CALLED_OFF : ScheduledJobStatus.CANCELLED;
}
