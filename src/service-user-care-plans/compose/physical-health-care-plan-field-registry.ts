import { PHYSICAL_HEALTH_CARE_PLAN_SEED } from '../../../prisma/seeds/physical-health-care-plan.seed-data';

/**
 * Documentation-only registry for the Physical Health Care Plan.
 *
 * The audit found NO existing Physical Health compose engine (no dispatch, no mappings) and NO
 * genuinely equivalent source for any field, so every field is MANUAL and there is
 * deliberately no Physical Health compose/dispatch — a compose would only ever return an empty
 * result. Like Infection and Mobility, this registry exists purely to record, for consistency
 * with the other care plans, that every field is manual and WHY the tempting-but-wrong
 * structured sources were rejected, and to guard that the registry and seed stay in lockstep.
 *
 * It resolves nothing and must never become a mapping engine. Structured physical-health data
 * (diagnoses, hospital admissions, GP details, NEWS2 / vital-signs / blood-glucose
 * observations) is clinical monitoring detail entered by staff on this form; none of it is
 * wired into the compose context, and none of it is semantically equivalent to the generic
 * Care 2020 needs / goals / support / risk concepts.
 */
export type PhysicalHealthFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type PhysicalHealthFieldRegistryEntry = {
  businessKey: string;
  mode: PhysicalHealthFieldMappingMode;
  /** Notes: for manual fields, why there is no genuine auto-prefill/suggestion source. */
  notes: string;
};

export const PHYSICAL_HEALTH_FIELD_REGISTRY: readonly PhysicalHealthFieldRegistryEntry[] = [
  // ---------- Health conditions (existing) ----------
  {
    businessKey: 'physical_health_primary_diagnoses',
    mode: 'MANUAL',
    notes:
      'Staff-entered clinical summary. No Physical Health compose engine exists; structured diagnosis data is not wired into the compose context and a diagnosis is not the generic Care 2020 "needs".',
  },
  {
    businessKey: 'physical_health_hospital_admissions',
    mode: 'MANUAL',
    notes: 'Staff-entered. No IA/structured source records recent hospital admissions for this form.',
  },
  {
    businessKey: 'physical_health_gp_surgery',
    mode: 'MANUAL',
    notes:
      'Staff-entered GP details. GP/pharmacy context is not wired into this form’s compose context; no engine populates it.',
  },

  // ---------- Monitoring (existing) ----------
  {
    businessKey: 'physical_health_vital_signs_news2',
    mode: 'MANUAL',
    notes:
      'Clinical decision gate. NEWS2 / vital-signs observations are not equivalent to a "monitoring required" YES/NO decision and are not wired into compose.',
  },
  {
    businessKey: 'physical_health_blood_glucose',
    mode: 'MANUAL',
    notes:
      'Clinical decision gate. Blood-glucose observation records are not equivalent to a "monitoring required" YES/NO decision and are not wired into compose.',
  },
  {
    businessKey: 'physical_health_urgent_advice',
    mode: 'MANUAL',
    notes: 'Staff-entered escalation guidance. No genuine IA/structured source exists.',
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'physical_health_service_user_needs',
    mode: 'MANUAL',
    notes:
      'Generic Care 2020 needs field; diagnoses/observations are clinical detail, not the generic needs concept.',
  },
  {
    businessKey: 'physical_health_needs_person_centred',
    mode: 'MANUAL',
    notes: 'Required free-text person-centred narrative for the needs question.',
  },
  {
    businessKey: 'physical_health_desired_goals_outcomes',
    mode: 'MANUAL',
    notes: 'The IA/structured data holds no physical-health-specific goals; must not be mapped.',
  },
  {
    businessKey: 'physical_health_support_required',
    mode: 'MANUAL',
    notes: 'Generic Care 2020 support narrative; no physical-health-specific source.',
  },
  {
    businessKey: 'physical_health_area_risk',
    mode: 'MANUAL',
    notes:
      'Generic "is there a risk associated with this area of care?" gate; must not be driven from NEWS2 / vital signs / blood-glucose observations. The assessor owns this decision.',
  },
];

export type PhysicalHealthFieldBusinessKey =
  (typeof PHYSICAL_HEALTH_FIELD_REGISTRY)[number]['businessKey'];

export const PHYSICAL_HEALTH_SUGGESTION_KEYS = PHYSICAL_HEALTH_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const PHYSICAL_HEALTH_AUTO_PREFILL_KEYS = PHYSICAL_HEALTH_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const PHYSICAL_HEALTH_MANUAL_KEYS = PHYSICAL_HEALTH_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function physicalHealthFieldRegistryEntry(
  businessKey: string,
): PhysicalHealthFieldRegistryEntry | undefined {
  return PHYSICAL_HEALTH_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertPhysicalHealthRegistryMatchesTemplate(): void {
  const templateKeys = PHYSICAL_HEALTH_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = PHYSICAL_HEALTH_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Physical Health registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Physical Health registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
