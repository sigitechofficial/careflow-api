import { EcmCriticality } from '@prisma/client';

/**
 * Configurable SLA defaults by criticality (BE1.29).
 * Not hardcoded CQC limits — org/contract overrides come later.
 */
export type EcmSlaTargets = {
  /** Minutes to first acknowledge / action. */
  responseTargetMinutes: number;
  /** Minutes until escalation deadline from detection. */
  escalationMinutes: number;
};

export const ECM_SLA_BY_CRITICALITY: Record<EcmCriticality | string, EcmSlaTargets> = {
  STANDARD: { responseTargetMinutes: 10, escalationMinutes: 20 },
  PRIORITY: { responseTargetMinutes: 5, escalationMinutes: 10 },
  TIME_CRITICAL: { responseTargetMinutes: 0, escalationMinutes: 0 },
};

export function slaTargetsForCriticality(criticality: string | null | undefined): EcmSlaTargets {
  return (
    ECM_SLA_BY_CRITICALITY[criticality ?? 'STANDARD'] ?? ECM_SLA_BY_CRITICALITY.STANDARD
  );
}
