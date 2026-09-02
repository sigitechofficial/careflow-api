import { MEDICATION_CARE_PLAN_SEED } from '../../../prisma/seeds/medication-care-plan.seed-data';
import { areaRiskFollowUpManualEntriesResolvedByEngine } from '../../../prisma/seeds/area-risk-follow-up.seed';

/**
 * Documentation-and-guard registry for the Medication Care Plan.
 *
 * Medication already has a mature AUTO-PREFILL compose engine in
 * `medication-care-plan.compose.ts` (`MEDICATION_CARE_PLAN_FIELD_MAPPINGS`), matching fields
 * by label and drawing on structured sources (ServiceUserAllergy, eMAR, MedicationPack) and
 * IA §9/§13.9 with a medication-snapshot fallback. That engine remains the single source of
 * truth and is intentionally retained unchanged — this registry does NOT re-resolve anything
 * and must never become a second competing Medication compose/mapping system.
 *
 * Its job is to (a) record, per field, whether the engine auto-prefills it and from where,
 * or whether it is manual, and (b) guard that the registry and the seed template stay in
 * lockstep. The Care 2020 needs / goals / support / risk block is MANUAL: the IA holds no
 * medication-specific needs / goals / support question.
 *
 * NOTE (identified future improvement, deliberately out of scope): a structured
 * `MedicationSupportProfile` table exists and could be a better source for the medication
 * support level than the (largely pruned) IA §9 questions, but wiring it into the compose
 * context is NOT part of this merge and has not been done.
 */
export type MedicationFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type MedicationFieldSourceKind =
  | 'INITIAL_ASSESSMENT'
  | 'MEDICATION_SNAPSHOT'
  | 'STRUCTURED_ALLERGY'
  | 'EMAR'
  | 'MEDICATION_PACK'
  | 'MANUAL';

export type MedicationFieldSourceRef = {
  kind: MedicationFieldSourceKind;
  iaFieldKeys?: readonly string[];
  iaSpecRefs?: readonly string[];
  notes?: string;
};

export type MedicationFieldRegistryEntry = {
  businessKey: string;
  mode: MedicationFieldMappingMode;
  /** True when the existing Medication engine auto-prefills this field. */
  resolvedByEngine: boolean;
  sources: readonly MedicationFieldSourceRef[];
};

export const MEDICATION_FIELD_REGISTRY: readonly MedicationFieldRegistryEntry[] = [
  // ---------- Medication overview (existing — auto-prefilled by the engine) ----------
  {
    businessKey: 'medication_support_level',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['medicationSupportLevel'],
        iaSpecRefs: ['9.2'],
        notes:
          'IA medicationSupportLevel (§9.2; largely pruned live) mapped via mapMedicationSupportLevelToCarePlan to the SELECT options.',
      },
      { kind: 'MEDICATION_SNAPSHOT', notes: 'medicationSnapshot.supportLevel fallback.' },
    ],
  },
  {
    businessKey: 'medication_known_allergies',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'STRUCTURED_ALLERGY',
        notes:
          'Structured ServiceUserAllergy records (ctx.allergies) — primary source. Blocking gap when empty. Safety-critical: intentionally auto-prefilled.',
      },
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['allergiesSummary'],
        iaSpecRefs: ['9.5'],
        notes: 'IA §9.5 allergy details / allergiesSummary / medicationSnapshot.allergyDetails fallback.',
      },
    ],
  },
  {
    businessKey: 'medication_prn_medicines',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      { kind: 'EMAR', notes: 'eMAR PRN list.' },
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['9.5'],
        notes: 'IA §9.5 PRN present / PRN protocol / medicationSnapshot.prnProtocol.',
      },
    ],
  },

  // ---------- Instructions (existing) ----------
  {
    businessKey: 'medication_storage_blister_packs',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      { kind: 'MEDICATION_PACK', notes: 'MedicationPack storage line (ctx.pack.storageLine).' },
      {
        kind: 'MEDICATION_SNAPSHOT',
        notes: 'medicationSnapshot.storageNotes / packaging-help fallback (IA §9.2).',
      },
    ],
  },
  {
    businessKey: 'medication_refusal_missed_dose',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['9.5'],
        notes: 'IA §9.5 medication safety notes / medicationSnapshot.safetyNotes.',
      },
    ],
  },
  {
    businessKey: 'medication_pharmacy_gp_contact',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['13.9'],
        notes: 'IA §13.9 GP/pharmacy line (ctx.gpPharmacyLine) + MedicationPack pharmacy/GP lines.',
      },
    ],
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'medication_service_user_needs',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'Generic needs field; the IA holds no medication-specific needs question.',
      },
    ],
  },
  {
    businessKey: 'medication_needs_person_centred',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [{ kind: 'MANUAL', notes: 'Free-text person-centred narrative for the needs question.' }],
  },
  {
    businessKey: 'medication_desired_goals_outcomes',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'The IA holds no medication-specific goals; general support goals must not be mapped.',
      },
    ],
  },
  {
    businessKey: 'medication_support_required',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic Care 2020 support narrative — distinct from medication_support_level. No medication-specific IA source.',
      },
    ],
  },
  {
    businessKey: 'medication_area_risk',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic "is there a risk associated with this area of care?" gate; must not be driven from a generic IA risk flag.',
      },
    ],
  },
  ...areaRiskFollowUpManualEntriesResolvedByEngine('medication'),
];

export type MedicationFieldBusinessKey = (typeof MEDICATION_FIELD_REGISTRY)[number]['businessKey'];

export const MEDICATION_AUTO_PREFILL_KEYS = MEDICATION_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const MEDICATION_SUGGESTION_KEYS = MEDICATION_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const MEDICATION_MANUAL_KEYS = MEDICATION_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function medicationFieldRegistryEntry(
  businessKey: string,
): MedicationFieldRegistryEntry | undefined {
  return MEDICATION_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertMedicationRegistryMatchesTemplate(): void {
  const templateKeys = MEDICATION_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = MEDICATION_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Medication registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Medication registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
