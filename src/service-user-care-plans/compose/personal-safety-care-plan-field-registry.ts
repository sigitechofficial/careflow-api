import { PERSONAL_SAFETY_CARE_PLAN_SEED } from '../../../prisma/seeds/personal-safety-care-plan.seed-data';

/**
 * Documentation-and-guard registry for the Personal Safety Care Plan.
 *
 * Personal Safety already has a mature AUTO-PREFILL compose engine in
 * `remaining-area-care-plans.compose.ts` (`PERSONAL_SAFETY_CARE_PLAN_FIELD_MAPPINGS` +
 * `composePersonalSafetyCarePlan`), matching the six existing fields by label and drawing on
 * the Initial Assessment answers, the personal-safety snapshot and the emergency contacts
 * context. That engine remains the single source of truth and is intentionally retained
 * unchanged — this registry does NOT re-resolve anything and must never become a second
 * competing Personal Safety compose/mapping system.
 *
 * Its job is to (a) record, per field, whether the engine auto-prefills it and from where, or
 * whether it is manual, and (b) guard that the registry and the seed template stay in
 * lockstep. The Care 2020 needs / goals / support / risk block is MANUAL: the IA holds no
 * generic needs / goals / support narrative for this area, and the generic risk gate must NOT
 * be driven from safeguarding-concern or risk-assessment flags — the assessor owns it.
 */
export type PersonalSafetyFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type PersonalSafetyFieldSourceKind =
  | 'INITIAL_ASSESSMENT'
  | 'PERSONAL_SAFETY_SNAPSHOT'
  | 'EMERGENCY_CONTACTS'
  | 'MANUAL';

export type PersonalSafetyFieldSourceRef = {
  kind: PersonalSafetyFieldSourceKind;
  iaFieldKeys?: readonly string[];
  notes?: string;
};

export type PersonalSafetyFieldRegistryEntry = {
  businessKey: string;
  mode: PersonalSafetyFieldMappingMode;
  /** True when the existing Personal Safety engine auto-prefills this field. */
  resolvedByEngine: boolean;
  sources: readonly PersonalSafetyFieldSourceRef[];
};

export const PERSONAL_SAFETY_FIELD_REGISTRY: readonly PersonalSafetyFieldRegistryEntry[] = [
  // ---------- Risk and environment (existing — auto-prefilled by the engine, by label) ----------
  {
    businessKey: 'personal_safety_home_hazards',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['staffVisitRisks', 'homeEnvironmentSafetyMeasures'],
        notes: 'IA staffVisitRisks / homeEnvironmentSafetyMeasures / "environment / access hazard" / snapshot.homeHazards.',
      },
    ],
  },
  {
    businessKey: 'personal_safety_smoking_fire_safety',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['fireSafetyRisksDetails'],
        notes: 'IA fireSafetyRisksDetails / snapshot.fireSafety.',
      },
    ],
  },
  {
    businessKey: 'personal_safety_lone_worker_risk',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'PERSONAL_SAFETY_SNAPSHOT',
        notes: 'snapshot.loneWorkerRisk mapped to the Low/Medium/High SELECT.',
      },
    ],
  },

  // ---------- Safeguarding (existing) ----------
  {
    businessKey: 'personal_safety_safeguarding_concern',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['safeguardingConcern'],
        notes: 'IA safeguardingConcern (boolean) / snapshot.safeguardingOnFile.',
      },
    ],
  },
  {
    businessKey: 'personal_safety_actions_in_place',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['noResponseProcedureAgreed'],
        notes: 'IA "safeguarding concern details" / "immediate action" / noResponseProcedureAgreed / snapshot.actionsInPlace.',
      },
    ],
  },
  {
    businessKey: 'personal_safety_emergency_contacts',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      { kind: 'EMERGENCY_CONTACTS', notes: 'ctx.emergencyContacts (primary source).' },
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['informalCarerName'],
        notes: 'IA "emergency contact" text / snapshot.emergencyContacts / informalCarerName.',
      },
    ],
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'personal_safety_service_user_needs',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'Generic Care 2020 needs field; the IA holds no generic personal-safety needs question.',
      },
    ],
  },
  {
    businessKey: 'personal_safety_needs_person_centred',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      { kind: 'MANUAL', notes: 'Required free-text person-centred narrative for the needs question.' },
    ],
  },
  {
    businessKey: 'personal_safety_desired_goals_outcomes',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      { kind: 'MANUAL', notes: 'The IA holds no personal-safety-specific goals; must not be mapped.' },
    ],
  },
  {
    businessKey: 'personal_safety_support_required',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      { kind: 'MANUAL', notes: 'Generic Care 2020 support narrative; no personal-safety-specific source.' },
    ],
  },
  {
    businessKey: 'personal_safety_area_risk',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic "is there a risk associated with this area of care?" gate; must NOT be driven from the safeguarding-concern flag or a lone-worker risk level. The assessor owns this decision.',
      },
    ],
  },
];

export type PersonalSafetyFieldBusinessKey =
  (typeof PERSONAL_SAFETY_FIELD_REGISTRY)[number]['businessKey'];

export const PERSONAL_SAFETY_AUTO_PREFILL_KEYS = PERSONAL_SAFETY_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const PERSONAL_SAFETY_SUGGESTION_KEYS = PERSONAL_SAFETY_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const PERSONAL_SAFETY_MANUAL_KEYS = PERSONAL_SAFETY_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function personalSafetyFieldRegistryEntry(
  businessKey: string,
): PersonalSafetyFieldRegistryEntry | undefined {
  return PERSONAL_SAFETY_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertPersonalSafetyRegistryMatchesTemplate(): void {
  const templateKeys = PERSONAL_SAFETY_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = PERSONAL_SAFETY_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Personal Safety registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Personal Safety registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
