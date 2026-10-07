/**
 * Corrections to raised incident details: which fields can be corrected, how two states are
 * compared, and how values read in the history. The reporter's own account is never corrected
 * (see IncidentClarificationNote).
 */

export type CorrectableIncidentState = {
  occurredAt: string;
  categoryId: string;
  subtypeId: string | null;
  affectedPersonKinds: string[];
  primaryServiceUserId: string | null;
  primaryEmployeeId: string | null;
  primaryPersonName: string | null;
  involvedServiceUserIds: string[];
  involvedEmployeeIds: string[];
  locationId: string | null;
  locationKey: string | null;
  locationDetail: string | null;
  scheduledJobId: string | null;
  categoryDetails: Record<string, unknown> | null;
  ambulanceAttended: boolean | null;
  takenToAe: boolean | null;
  admittedToHospital: boolean | null;
  immediateActionCodes: string[];
  whoInformedKeys: string[];
  severity: string;
  privacyLevel: string;
};

export type CorrectableFieldKey = keyof CorrectableIncidentState;

/** Display order and labels for the correction history. */
export const CORRECTION_FIELD_LABELS: Record<CorrectableFieldKey, string> = {
  occurredAt: 'When it happened',
  categoryId: 'Category',
  subtypeId: 'Type',
  affectedPersonKinds: 'Who was affected',
  primaryServiceUserId: 'Service user affected',
  primaryEmployeeId: 'Staff member affected',
  primaryPersonName: 'Other person affected',
  involvedServiceUserIds: 'Service users involved',
  involvedEmployeeIds: 'Staff involved',
  locationId: 'Branch',
  locationKey: 'Where it happened',
  locationDetail: 'Where it happened (details)',
  scheduledJobId: 'Visit',
  categoryDetails: 'Category details',
  ambulanceAttended: 'Ambulance attended',
  takenToAe: 'Taken to A&E',
  admittedToHospital: 'Admitted to hospital',
  immediateActionCodes: 'What was done',
  whoInformedKeys: 'Who was informed',
  severity: 'Severity',
  privacyLevel: 'Privacy',
};

/** Lists where order carries no meaning (compared as sets). */
const UNORDERED_FIELDS = new Set<CorrectableFieldKey>([
  'affectedPersonKinds',
  'immediateActionCodes',
  'whoInformedKeys',
]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value ?? null;
}

function comparable(key: CorrectableFieldKey, value: unknown): string {
  if (UNORDERED_FIELDS.has(key) && Array.isArray(value)) {
    return JSON.stringify([...value].map(String).sort());
  }
  if (key === 'occurredAt' && typeof value === 'string') {
    // Same instant written differently (e.g. with/without milliseconds) is not a change.
    const t = Date.parse(value);
    return Number.isNaN(t) ? value : String(t);
  }
  const c = canonical(value);
  // An empty details object means "no details".
  if (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) {
    return 'null';
  }
  return JSON.stringify(c);
}

/** Fields whose value differs, in display order. */
export function diffCorrectableState(
  before: CorrectableIncidentState,
  after: CorrectableIncidentState,
): { fieldKey: CorrectableFieldKey; from: unknown; to: unknown }[] {
  return (Object.keys(CORRECTION_FIELD_LABELS) as CorrectableFieldKey[])
    .filter((key) => comparable(key, before[key]) !== comparable(key, after[key]))
    .map((key) => ({ fieldKey: key, from: before[key], to: after[key] }));
}

/** "Service user" / "Staff member" … for IncidentPersonKind values. */
export const PERSON_KIND_LABELS: Record<string, string> = {
  SERVICE_USER: 'Service user',
  EMPLOYEE: 'Staff member',
  FAMILY: 'Family member',
  VISITOR: 'Visitor',
  HEALTHCARE_PROFESSIONAL: 'Healthcare professional',
  CONTRACTOR: 'Contractor',
  OTHER: 'Other',
};

/** Labels for the "Who was informed?" keys (same wording as the admin app). */
export const WHO_INFORMED_KEY_LABELS: Record<string, string> = {
  office: 'Office',
  on_call_manager: 'On-call manager',
  family_nok: 'Family / NOK',
  gp: 'GP',
  emergency_999: '999 / ambulance',
  nhs_111: '111',
  police: 'Police',
  safeguarding_lead: 'Safeguarding lead',
  local_authority: 'Local authority',
  no_one_yet: 'No one informed yet',
};

export function yesNoUnknownLabel(value: unknown): string {
  return value === true ? 'Yes' : value === false ? 'No' : 'Not known';
}

/** Short readable form of category details for the history ("Medication name: Paracetamol; …"). */
export function categoryDetailsLabel(details: unknown): string {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return '—';
  const parts = Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      const label = k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      const text =
        typeof v === 'boolean'
          ? v
            ? 'yes'
            : 'no'
          : typeof v === 'object'
            ? Object.values(v as Record<string, unknown>)
                .filter((x) => x !== null && x !== undefined && x !== '')
                .join(' ')
            : String(v);
      return `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${text}`;
    });
  const out = parts.join('; ');
  return out ? (out.length > 500 ? `${out.slice(0, 497)}…` : out) : '—';
}

/** The parts of the reporter's account a clarification note can be added to. */
export const CLARIFICATION_FIELD_LABELS: Record<string, string> = {
  DESCRIPTION: 'What happened',
  CONTEXT_BEFORE: 'Immediately before',
  CONTEXT_AFTER: 'Afterwards',
  IMMEDIATE_ACTIONS: 'Actions taken (reporter’s description)',
  PEOPLE_INVOLVED: 'People involved',
  EMERGENCY_SERVICES: 'Emergency services',
};
