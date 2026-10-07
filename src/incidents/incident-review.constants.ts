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

/** Corrective measure types (what the measure changes). */
export const INCIDENT_MEASURE_TYPES = [
  'CARE_PLAN_UPDATE',
  'RISK_ASSESSMENT_UPDATE',
  'VISIT_PLAN_CHANGE',
  'COURSE',
  'COMPETENCY_CHECK',
  'SUPERVISION',
  'POLICY_UPDATE',
  'OTHER',
] as const;

export type IncidentMeasureType = (typeof INCIDENT_MEASURE_TYPES)[number];

export const INCIDENT_MEASURE_TYPE_LABELS: Record<IncidentMeasureType, string> = {
  CARE_PLAN_UPDATE: 'Care plan update',
  RISK_ASSESSMENT_UPDATE: 'Risk assessment update',
  VISIT_PLAN_CHANGE: 'Visit plan change',
  COURSE: 'Course for carer',
  COMPETENCY_CHECK: 'Competency check',
  SUPERVISION: 'Supervision',
  POLICY_UPDATE: 'Policy update',
  OTHER: 'Other',
};

/** What a measure can address: the root cause or one of the contributing factors. */
export const INCIDENT_MEASURE_ADDRESSES = ['ROOT_CAUSE', ...INCIDENT_CONTRIBUTING_FACTORS] as const;

/** Investigation evidence: kinds of records the investigator reviewed. */
export const INVESTIGATION_RECORDS_REVIEWED = [
  'CARE_PLAN',
  'RISK_ASSESSMENT',
  'MAR',
  'VISIT_LOGS',
  'ROTA',
  'TRAINING_RECORDS',
  'SUPERVISION_RECORDS',
  'POLICIES',
  'OTHER',
] as const;

export type InvestigationRecordReviewed = (typeof INVESTIGATION_RECORDS_REVIEWED)[number];

export const INVESTIGATION_RECORDS_REVIEWED_LABELS: Record<InvestigationRecordReviewed, string> = {
  CARE_PLAN: 'Care plan',
  RISK_ASSESSMENT: 'Risk assessment',
  MAR: 'MAR',
  VISIT_LOGS: 'Visit logs',
  ROTA: 'Rota',
  TRAINING_RECORDS: 'Training records',
  SUPERVISION_RECORDS: 'Supervision records',
  POLICIES: 'Policies / procedures',
  OTHER: 'Other',
};

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
