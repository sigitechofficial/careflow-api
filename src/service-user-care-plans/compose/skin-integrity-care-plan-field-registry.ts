import { SKIN_INTEGRITY_CARE_PLAN_SEED } from '../../../prisma/seeds/skin-integrity-care-plan.seed-data';

/**
 * Documentation-and-guard registry for the Skin Integrity Care Plan.
 *
 * Skin Integrity already has a mature AUTO-PREFILL compose engine in
 * `area-care-plans.compose.ts` (`SKIN_INTEGRITY_CARE_PLAN_FIELD_MAPPINGS` +
 * `composeSkinIntegrityCarePlan`), matching fields by label and drawing on IA §11.1 and the
 * skin-integrity snapshot. That engine remains the single source of truth and is
 * intentionally retained unchanged — this registry does NOT re-resolve anything and must
 * never become a second competing Skin Integrity compose/mapping system.
 *
 * Its job is to (a) record, per field, whether the engine auto-prefills it and from where,
 * or whether it is manual, and (b) guard that the registry and the seed template stay in
 * lockstep. The Care 2020 needs / goals / support / risk block is MANUAL: the IA §11 section
 * holds no skin-specific needs / goals / support question (verified: zero such questions),
 * and a generic risk gate must not be driven from a pressure-ulcer-risk-assessment-completed
 * flag. BodyMapWoundAssessment exists (1 live record) but is not loaded into the compose
 * context and is the wrong scope for the generic Care 2020 block.
 */
export type SkinFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type SkinFieldSourceKind = 'INITIAL_ASSESSMENT' | 'SKIN_INTEGRITY_SNAPSHOT' | 'MANUAL';

export type SkinFieldSourceRef = {
  kind: SkinFieldSourceKind;
  iaFieldKeys?: readonly string[];
  iaSpecRefs?: readonly string[];
  notes?: string;
};

export type SkinFieldRegistryEntry = {
  businessKey: string;
  mode: SkinFieldMappingMode;
  /** True when the existing Skin Integrity engine auto-prefills this field. */
  resolvedByEngine: boolean;
  sources: readonly SkinFieldSourceRef[];
};

export const SKIN_INTEGRITY_FIELD_REGISTRY: readonly SkinFieldRegistryEntry[] = [
  // ---------- Skin profile (existing — auto-prefilled by the engine, by label) ----------
  {
    businessKey: 'skin_integrity_skin_type_issues',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['11.1'],
        notes:
          'IA §11.1 "Skin condition comment" / "Pressure ulcer risk assessment comment" / snapshot.skinTypeIssues.',
      },
      { kind: 'SKIN_INTEGRITY_SNAPSHOT', notes: 'skinIntegritySnapshot.skinTypeIssues fallback.' },
    ],
  },
  {
    businessKey: 'skin_integrity_emollients_creams',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['11.1'],
        notes: 'IA §11.1 "emollien…" text / snapshot.emollientsCreams.',
      },
    ],
  },
  {
    businessKey: 'skin_integrity_previous_pressure_damage',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['hasWounds'],
        iaSpecRefs: ['11.1'],
        notes:
          'IA §11.1 "Currently has ulcers or wounds?" / "pressure damage" (boolean) / snapshot.previousPressureDamage.',
      },
    ],
  },

  // ---------- Daily care (existing) ----------
  {
    businessKey: 'skin_integrity_cream_application',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['11.1'],
        notes: 'IA §11.1 "pressure equipment details" / "equipment" text / snapshot.creamApplication.',
      },
    ],
  },
  {
    businessKey: 'skin_integrity_signs_to_report',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['skinIntegrityComments'],
        iaSpecRefs: ['11.1'],
        notes: 'IA §11.1 "Skin / wound notes" / "wound" text / snapshot.signsToReport.',
      },
    ],
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'skin_integrity_service_user_needs',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic needs field; IA §11 holds no skin-specific needs question (verified: 0 needs/goals/support questions in §11).',
      },
    ],
  },
  {
    businessKey: 'skin_integrity_needs_person_centred',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [{ kind: 'MANUAL', notes: 'Free-text person-centred narrative for the needs question.' }],
  },
  {
    businessKey: 'skin_integrity_desired_goals_outcomes',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'The IA holds no skin-specific goals; general support goals must not be mapped.',
      },
    ],
  },
  {
    businessKey: 'skin_integrity_support_required',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      { kind: 'MANUAL', notes: 'Generic Care 2020 support narrative; no skin-specific IA source.' },
    ],
  },
  {
    businessKey: 'skin_integrity_area_risk',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic "is there a risk associated with this area of care?" gate. It must not be driven from §11.1 "Pressure ulcer risk assessment completed?" / §11.4 Waterlow (assessment-completion flags, not this gate); the assessor owns this decision.',
      },
    ],
  },
];

export type SkinFieldBusinessKey = (typeof SKIN_INTEGRITY_FIELD_REGISTRY)[number]['businessKey'];

export const SKIN_AUTO_PREFILL_KEYS = SKIN_INTEGRITY_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const SKIN_SUGGESTION_KEYS = SKIN_INTEGRITY_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const SKIN_MANUAL_KEYS = SKIN_INTEGRITY_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function skinFieldRegistryEntry(businessKey: string): SkinFieldRegistryEntry | undefined {
  return SKIN_INTEGRITY_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertSkinRegistryMatchesTemplate(): void {
  const templateKeys = SKIN_INTEGRITY_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = SKIN_INTEGRITY_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Skin Integrity registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Skin Integrity registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
