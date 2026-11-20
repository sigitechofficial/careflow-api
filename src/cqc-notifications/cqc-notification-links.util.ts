import {
  CqcNotificationType,
  IncidentPrivacyLevel,
  SafeguardingCategory,
} from '@prisma/client';
import { INCIDENT_PRIVACY_RANK } from '../incidents/incident-workflow.util';

/** Incident privacy levels the user may see (same rule as the incidents module). */
export function viewableIncidentPrivacy(user: {
  roles?: string[];
  permissions?: string[];
}): IncidentPrivacyLevel[] {
  const perms = user.permissions ?? [];
  const rank = user.roles?.includes('Super Admin')
    ? 2
    : perms.includes('incidents.view_highly_confidential')
      ? 2
      : perms.includes('incidents.view_confidential')
        ? 1
        : 0;
  return (Object.keys(INCIDENT_PRIVACY_RANK) as IncidentPrivacyLevel[]).filter(
    (level) => INCIDENT_PRIVACY_RANK[level] <= rank,
  );
}

/**
 * Links between CQC notifications and incidents / safeguarding cases: which incidents look notifiable
 * (a suggestion only — a manager decides) and how a safeguarding category maps to the abuse type.
 */

/** How far back the "possible notifications" list looks. */
export const CQC_CANDIDATE_DAYS = 30;

export type IncidentFacts = {
  categoryKey: string;
  admittedToHospital: boolean | null;
  whoInformedKeys: string[];
  externalBodyTypes: string[];
  carerSafeguardingConcern: boolean | null;
};

export type IncidentSuggestion = { type: CqcNotificationType; reason: string };

/** Why an incident may need a CQC notification, most serious first; null = nothing found. */
export function suggestForIncident(
  i: IncidentFacts,
): IncidentSuggestion | null {
  if (i.categoryKey === 'DEATH')
    return { type: CqcNotificationType.DEATH, reason: 'Death recorded' };
  if (i.categoryKey === 'SAFEGUARDING' || i.carerSafeguardingConcern)
    return {
      type: CqcNotificationType.ABUSE_ALLEGATION,
      reason: 'Safeguarding concern',
    };
  if (
    i.externalBodyTypes.includes('POLICE') ||
    i.whoInformedKeys.includes('police')
  )
    return {
      type: CqcNotificationType.POLICE_INCIDENT,
      reason: 'Police informed',
    };
  if (i.admittedToHospital)
    return {
      type: CqcNotificationType.SERIOUS_INJURY,
      reason: 'Admitted to hospital',
    };
  return null;
}

const ABUSE_TYPE: Partial<Record<SafeguardingCategory, string>> = {
  PHYSICAL: 'PHYSICAL',
  EMOTIONAL: 'PSYCHOLOGICAL',
  SEXUAL: 'SEXUAL',
  FINANCIAL: 'FINANCIAL',
  NEGLECT: 'NEGLECT',
  SELF_NEGLECT: 'NEGLECT',
  DISCRIMINATORY: 'DISCRIMINATORY',
  ORGANISATIONAL: 'ORGANISATIONAL',
};

/** The CQC abuse type for a safeguarding category (OTHER when there is no direct match). */
export function abuseTypeForSafeguarding(
  category: SafeguardingCategory,
): string {
  return ABUSE_TYPE[category] ?? 'OTHER';
}
