/** Suggested contributing factors for an investigation (multi-select codes). */
export const INCIDENT_CONTRIBUTING_FACTORS = [
  'CARE_PLAN',
  'RISK_ASSESSMENT',
  'STAFFING',
  'TRAINING',
  'COMMUNICATION',
  'ENVIRONMENT',
  'EQUIPMENT',
  'MEDICATION',
  'HUMAN_ERROR',
  'PROCEDURE_NOT_FOLLOWED',
  'BEHAVIOURAL_TRIGGER',
  'HEALTH_DETERIORATION',
  'UNKNOWN',
  'OTHER',
] as const;

export type IncidentContributingFactor =
  (typeof INCIDENT_CONTRIBUTING_FACTORS)[number];

/** Codes for "changes made" captured at closure. */
export const INCIDENT_OUTCOME_CHANGE_CODES = [
  'CARE_PLAN',
  'RISK_ASSESSMENT',
  'POLICY',
  'PROCEDURE',
  'STAFF_TRAINING',
  'EQUIPMENT',
  'STAFFING',
  'ENVIRONMENT',
  'OTHER',
] as const;

export type IncidentOutcomeChange =
  (typeof INCIDENT_OUTCOME_CHANGE_CODES)[number];

export const INCIDENT_OUTCOME_CHANGE_LABELS: Record<
  IncidentOutcomeChange,
  string
> = {
  CARE_PLAN: 'Care plan',
  RISK_ASSESSMENT: 'Risk assessment',
  POLICY: 'Policy',
  PROCEDURE: 'Procedure',
  STAFF_TRAINING: 'Staff training',
  EQUIPMENT: 'Equipment',
  STAFFING: 'Staffing',
  ENVIRONMENT: 'Environment',
  OTHER: 'Other',
};

export const INCIDENT_CONTRIBUTING_FACTOR_LABELS: Record<
  IncidentContributingFactor,
  string
> = {
  CARE_PLAN: 'Care plan',
  RISK_ASSESSMENT: 'Risk assessment',
  STAFFING: 'Staffing',
  TRAINING: 'Training',
  COMMUNICATION: 'Communication',
  ENVIRONMENT: 'Environment',
  EQUIPMENT: 'Equipment',
  MEDICATION: 'Medication',
  HUMAN_ERROR: 'Human error',
  PROCEDURE_NOT_FOLLOWED: 'Procedure not followed',
  BEHAVIOURAL_TRIGGER: 'Behavioural trigger',
  HEALTH_DETERIORATION: 'Health deterioration',
  UNKNOWN: 'Unknown',
  OTHER: 'Other',
};
