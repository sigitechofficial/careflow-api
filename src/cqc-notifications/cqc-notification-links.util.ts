import {
  CqcNotificationStatus,
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
  subtypeKey?: string | null;
  /** Incident.categoryDetails (pressureUlcerGrade for skin and wound incidents). */
  categoryDetails?: unknown;
  severity?: string | null;
  admittedToHospital: boolean | null;
  takenToAe?: boolean | null;
  whoInformedKeys: string[];
  externalBodyTypes: string[];
  carerSafeguardingConcern: boolean | null;
};

export type IncidentSuggestion = { type: CqcNotificationType; reason: string };

/** Pressure ulcer grades CQC treats as a serious injury (category 3 or worse). */
export const NOTIFIABLE_PRESSURE_ULCER_GRADES = [
  'CATEGORY_3',
  'CATEGORY_4',
  'UNSTAGEABLE',
] as const;

/** Health and safety events that can stop the service running safely. */
export const SERVICE_DISRUPTION_SUBTYPES = ['FIRE', 'UTILITY_FAILURE'] as const;

/** Unexplained injuries are treated as a possible abuse allegation. */
export const POSSIBLE_ABUSE_SUBTYPES = ['UNEXPLAINED_BRUISING'] as const;

function pressureUlcerGrade(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const g = (details as Record<string, unknown>).pressureUlcerGrade;
  return typeof g === 'string' ? g : null;
}

/**
 * Every CQC notification an incident may need, most serious first, at most one per type (an abuse
 * allegation the police are involved in needs both). Empty = nothing found. A suggestion only.
 */
export function suggestionsForIncident(i: IncidentFacts): IncidentSuggestion[] {
  const out: IncidentSuggestion[] = [];
  const add = (type: CqcNotificationType, reason: string) => {
    if (!out.some((s) => s.type === type)) out.push({ type, reason });
  };
  const subtype = i.subtypeKey ?? null;
  if (i.categoryKey === 'DEATH') add(CqcNotificationType.DEATH, 'Death recorded');
  if (i.categoryKey === 'SAFEGUARDING' || i.carerSafeguardingConcern)
    add(CqcNotificationType.ABUSE_ALLEGATION, 'Safeguarding concern');
  if (subtype && (POSSIBLE_ABUSE_SUBTYPES as readonly string[]).includes(subtype))
    add(CqcNotificationType.ABUSE_ALLEGATION, 'Unexplained bruising or injury');
  if (
    i.externalBodyTypes.includes('POLICE') ||
    i.whoInformedKeys.includes('police')
  )
    add(CqcNotificationType.POLICE_INCIDENT, 'Police informed');
  if (i.admittedToHospital)
    add(CqcNotificationType.SERIOUS_INJURY, 'Admitted to hospital');
  const grade = pressureUlcerGrade(i.categoryDetails);
  if (
    grade &&
    (NOTIFIABLE_PRESSURE_ULCER_GRADES as readonly string[]).includes(grade)
  )
    add(
      CqcNotificationType.SERIOUS_INJURY,
      'Pressure ulcer category 3 or worse',
    );
  if (i.takenToAe) add(CqcNotificationType.SERIOUS_INJURY, 'Taken to A&E');
  if (i.severity === 'CRITICAL' && i.categoryKey !== 'DATA_BREACH')
    add(CqcNotificationType.SERIOUS_INJURY, 'Critical severity');
  if (
    i.categoryKey === 'HEALTH_SAFETY' &&
    subtype &&
    (SERVICE_DISRUPTION_SUBTYPES as readonly string[]).includes(subtype)
  )
    add(
      CqcNotificationType.SERVICE_DISRUPTION,
      subtype === 'FIRE' ? 'Fire or evacuation' : 'Utility failure',
    );
  return out;
}

export type LinkedNotification = {
  incidentId: string | null;
  safeguardingCaseId: string | null;
  serviceUserId?: string | null;
  type: CqcNotificationType;
  status: CqcNotificationStatus;
};

export const incidentTypeKey = (incidentId: string, type: CqcNotificationType) =>
  `${incidentId}:${type}`;

/**
 * Which incidents, safeguarding cases and deaths already have a CQC notification that settles
 * the suggestion. A cancelled notification settles nothing. An incident is settled only for the type
 * of the notification linked to it (key `incidentId:type`), so a notification of another type
 * does not hide the one the incident needs.
 */
export function settledByNotifications(rows: LinkedNotification[]): {
  incidentTypes: Set<string>;
  caseIds: Set<string>;
  /** Service users with a death notification (however it was started). */
  deathServiceUserIds: Set<string>;
} {
  const incidentTypes = new Set<string>();
  const caseIds = new Set<string>();
  const deathServiceUserIds = new Set<string>();
  for (const r of rows) {
    if (r.status === CqcNotificationStatus.CANCELLED) continue;
    if (r.incidentId) incidentTypes.add(incidentTypeKey(r.incidentId, r.type));
    if (r.safeguardingCaseId) caseIds.add(r.safeguardingCaseId);
    if (r.serviceUserId && r.type === CqcNotificationType.DEATH)
      deathServiceUserIds.add(r.serviceUserId);
  }
  return { incidentTypes, caseIds, deathServiceUserIds };
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
