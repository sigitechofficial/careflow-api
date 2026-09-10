/**
 * Known ServiceUserMonitoringConfig.configKey values.
 * Values are stored per service user — this file does NOT invent clinical defaults.
 * Alert generation from these keys is out of scope for Phase 2.
 */
export const SERVICE_USER_MONITORING_CONFIG_KEYS = {
  /** Numeric kg change threshold between weight readings (links to ObservationType WEIGHT). */
  WEIGHT_CHANGE_THRESHOLD_KG: 'WEIGHT_CHANGE_THRESHOLD_KG',
  /** Boolean: fluid target / fluid chart required (links to ObservationType FLUID_MONITOR). */
  FLUID_TARGET_REQUIRED: 'FLUID_TARGET_REQUIRED',
  /** Manual Medical Alerts YES/NO answers (textValue = YES | NO). Do not write to IA/Care Plan. */
  MEDICAL_ALERT_CAPABILITIES: 'MEDICAL_ALERT_CAPABILITIES',
  MEDICAL_ALERT_GENERAL_ALERT: 'MEDICAL_ALERT_GENERAL_ALERT',
  MEDICAL_ALERT_COMMUNICATION: 'MEDICAL_ALERT_COMMUNICATION',
  MEDICAL_ALERT_DIABETES: 'MEDICAL_ALERT_DIABETES',
  MEDICAL_ALERT_DIETARY: 'MEDICAL_ALERT_DIETARY',
  MEDICAL_ALERT_PALLIATIVE: 'MEDICAL_ALERT_PALLIATIVE',
  MEDICAL_ALERT_BEHAVIOUR: 'MEDICAL_ALERT_BEHAVIOUR',
  MEDICAL_ALERT_FALLS: 'MEDICAL_ALERT_FALLS',
  MEDICAL_ALERT_DOLS: 'MEDICAL_ALERT_DOLS',
  MEDICAL_ALERT_CHOKING: 'MEDICAL_ALERT_CHOKING',
  MEDICAL_ALERT_COPD: 'MEDICAL_ALERT_COPD',
  MEDICAL_ALERT_DNACPR: 'MEDICAL_ALERT_DNACPR',
  MEDICAL_ALERT_RISK_LEVEL: 'MEDICAL_ALERT_RISK_LEVEL',
  MEDICAL_ALERT_ALLERGIES: 'MEDICAL_ALERT_ALLERGIES',
} as const;

export type ServiceUserMonitoringConfigKey =
  (typeof SERVICE_USER_MONITORING_CONFIG_KEYS)[keyof typeof SERVICE_USER_MONITORING_CONFIG_KEYS];

/** Manual Medical Alerts answer keys (subset of monitoring config keys). */
export const MEDICAL_ALERT_ANSWER_KEYS = [
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_CAPABILITIES,
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_GENERAL_ALERT,
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_COMMUNICATION,
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_DIABETES,
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_DIETARY,
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_PALLIATIVE,
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_BEHAVIOUR,
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_FALLS,
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_DOLS,
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_CHOKING,
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_COPD,
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_DNACPR,
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_RISK_LEVEL,
  SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_ALLERGIES,
] as const;

export type MedicalAlertAnswerKey = (typeof MEDICAL_ALERT_ANSWER_KEYS)[number];

export function isMedicalAlertAnswerKey(key: string): key is MedicalAlertAnswerKey {
  return (MEDICAL_ALERT_ANSWER_KEYS as readonly string[]).includes(key);
}

/** Permission keys for Medical Conditions & Alerts clinical SoTs (not alerts.*). */
export const MEDICAL_CLINICAL_PERMISSION_KEYS = [
  'service_users.medical_conditions.read',
  'service_users.medical_conditions.create',
  'service_users.medical_conditions.update',
  'service_users.medical_conditions.delete',
  'service_users.medical_adjustments.read',
  'service_users.medical_adjustments.create',
  'service_users.medical_adjustments.update',
  'service_users.medical_adjustments.delete',
  'service_users.medical_history.read',
  'service_users.medical_history.create',
  'service_users.medical_history.update',
  'service_users.medical_history.delete',
  'service_users.medical_monitoring.read',
  'service_users.medical_monitoring.update',
  'service_users.medical_usual_parameters.read',
  'service_users.medical_usual_parameters.update',
] as const;
