import { IncidentInjurySeverity, IncidentSeverity } from '@prisma/client';
import {
  IMMEDIATE_ACTION_CODES,
  IMMEDIATE_ACTION_LABELS,
  INCIDENT_LOCATION_KEYS,
  INCIDENT_LOCATION_LABELS,
  OFFICE_WHO_INFORMED_KEYS,
} from './incident-workflow.util';
import { WHO_INFORMED_KEY_LABELS } from './incident-correction.util';
import {
  ALLEGED_PERSON_KINDS,
  NO_HOSPITAL_OUTCOME_CATEGORIES,
  PRESSURE_ULCER_GRADES,
  WOUND_STATUSES,
} from './incident-category-details.util';

/**
 * The option lists of the office Raise form, sent to the carer app inside the visit
 * `incidentCatalog.form` so both forms ask the same questions with the same keys.
 * Labels mirror careflow-admin (features/incidents/types.ts, category-details.ts,
 * components/IncidentFormControls.tsx).
 */

/** Office raise form "Injury type" list (admin INCIDENT_INJURY_TYPE_OPTIONS). */
export const INCIDENT_INJURY_TYPES = [
  'Bruise',
  'Graze / abrasion',
  'Cut / laceration',
  'Skin tear',
  'Burn / scald',
  'Suspected fracture',
  'Head injury',
  'Sprain / strain',
  'Swelling',
  'Pain (no visible injury)',
  'Bite',
  'Pressure ulcer',
  'Moisture damage',
  'Wound',
] as const;

/** Injury severities offered at raise. FATAL is not offered: a death is an incident outcome. */
export const RAISE_INJURY_SEVERITIES: IncidentInjurySeverity[] = [
  IncidentInjurySeverity.MINOR,
  IncidentInjurySeverity.MODERATE,
  IncidentInjurySeverity.SERIOUS,
];

/** Severity definitions shown next to "How serious is it?" (admin INCIDENT_SEVERITY_FORM_OPTIONS). */
export const INCIDENT_SEVERITY_HINTS: Record<IncidentSeverity, string> = {
  LOW: 'No or minimal harm, no treatment needed.',
  MEDIUM: 'Minor harm: first aid or a GP visit, short-term effect.',
  HIGH: 'Significant harm: hospital treatment, or a safeguarding concern.',
  CRITICAL: 'Life-threatening or serious harm, death, or police involvement.',
};

const WOUND_STATUS_LABELS: Record<(typeof WOUND_STATUSES)[number], string> = {
  NEW: 'New',
  EXISTING: 'Existing',
  DETERIORATED: 'Got worse',
};

const ALLEGED_PERSON_LABELS: Record<(typeof ALLEGED_PERSON_KINDS)[number], string> = {
  STAFF: 'A staff member',
  OTHER_PERSON: 'Another person (family, visitor…)',
  UNKNOWN: 'Not sure who',
  NOT_APPLICABLE: 'No one (e.g. self-neglect)',
};

const INJURY_SEVERITY_LABELS: Record<string, string> = {
  MINOR: 'Minor',
  MODERATE: 'Moderate',
  SERIOUS: 'Serious',
};

/** Who confirmed a death (admin DEATH_CONFIRMED_BY_ROLES). */
export const DEATH_CONFIRMED_BY_ROLES = ['Paramedic', 'GP', 'Nurse', 'Police', 'Family', 'Carer', 'Other'];

type Option = { key: string; label: string; description?: string };

export function buildIncidentFormCatalog() {
  const opts = (keys: readonly string[], labels: Record<string, string>): Option[] =>
    keys.map((key) => ({ key, label: labels[key] ?? key }));
  return {
    // Short labels, as on the office Raise form ("Bathroom", not "Service user's home – bathroom").
    locations: INCIDENT_LOCATION_KEYS.map((key) => {
      const long = INCIDENT_LOCATION_LABELS[key] ?? key;
      const short = long.replace(/^Service user's home – /, '');
      return { key, label: short.charAt(0).toUpperCase() + short.slice(1) };
    }),
    immediateActions: opts(IMMEDIATE_ACTION_CODES, IMMEDIATE_ACTION_LABELS),
    whoInformed: opts(OFFICE_WHO_INFORMED_KEYS, WHO_INFORMED_KEY_LABELS),
    injuryTypes: INCIDENT_INJURY_TYPES.map((t) => ({ key: t, label: t })),
    injurySeverities: opts(RAISE_INJURY_SEVERITIES, INJURY_SEVERITY_LABELS),
    pressureUlcerGrades: PRESSURE_ULCER_GRADES.map((g) => ({ key: g.key, label: g.label })),
    woundStatuses: opts(WOUND_STATUSES, WOUND_STATUS_LABELS),
    allegedPersonKinds: opts(ALLEGED_PERSON_KINDS, ALLEGED_PERSON_LABELS),
    deathConfirmedByRoles: DEATH_CONFIRMED_BY_ROLES.map((r) => ({ key: r, label: r })),
    noHospitalOutcomeCategories: [...NO_HOSPITAL_OUTCOME_CATEGORIES],
  };
}

/**
 * Carer-app severity keys (catalog low/medium/high/critical; legacy no_harm/moderate/severe/death)
 * → description, so the app can show the same definitions as the office form.
 */
export function severityHintForAppKey(key: string): string | undefined {
  const k = key.toLowerCase();
  if (k === 'critical' || k === 'death') return INCIDENT_SEVERITY_HINTS.CRITICAL;
  if (k === 'high' || k === 'severe') return INCIDENT_SEVERITY_HINTS.HIGH;
  if (k === 'medium' || k === 'moderate') return INCIDENT_SEVERITY_HINTS.MEDIUM;
  if (k === 'low' || k === 'no_harm') return INCIDENT_SEVERITY_HINTS.LOW;
  return undefined;
}
