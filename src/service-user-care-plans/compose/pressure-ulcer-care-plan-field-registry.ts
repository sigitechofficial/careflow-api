import { PRESSURE_ULCER_CARE_PLAN_SEED } from '../../../prisma/seeds/pressure-ulcer-care-plan.seed-data';
import { areaRiskFollowUpManualEntriesResolvedByEngine } from '../../../prisma/seeds/area-risk-follow-up.seed';

/**
 * Documentation-and-guard registry for the Pressure Ulcer Care Plan.
 *
 * The dedicated compose engine in `pressure-ulcer-care-plan.compose.ts` is the single
 * source of truth for AUTO-PREFILL. This registry records, per field, whether that engine
 * auto-prefills it and from where, or whether it is manual. It must never become a second
 * competing compose/mapping system.
 *
 * Forbidden mappings (enforced by omitting them from the engine):
 * - Waterlow score → area risk
 * - MUST score → nutrition narrative
 * - "Pressure ulcer risk assessment completed?" → area risk
 * - Skin Integrity fieldKeys / snapshot → Pressure Ulcer fields
 */
export type PressureUlcerFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type PressureUlcerFieldSourceKind = 'INITIAL_ASSESSMENT' | 'WATERLOW_METADATA' | 'MANUAL';

export type PressureUlcerFieldSourceRef = {
  kind: PressureUlcerFieldSourceKind;
  iaFieldKeys?: readonly string[];
  iaSpecRefs?: readonly string[];
  notes?: string;
};

export type PressureUlcerFieldRegistryEntry = {
  businessKey: string;
  mode: PressureUlcerFieldMappingMode;
  /** True when the Pressure Ulcer engine auto-prefills this field. */
  resolvedByEngine: boolean;
  sources: readonly PressureUlcerFieldSourceRef[];
};

export const PRESSURE_ULCER_FIELD_REGISTRY: readonly PressureUlcerFieldRegistryEntry[] = [
  {
    businessKey: 'pressure_ulcer_waterlow_risk_score',
    mode: 'SUGGESTION',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'WATERLOW_METADATA',
        iaSpecRefs: ['11.4'],
        notes:
          'Waterlow is screening, not a PU diagnosis. Do not AUTO-write Low/At risk/High/Very high onto the plan.',
      },
    ],
  },
  {
    businessKey: 'pressure_ulcer_existing_areas_wounds',
    mode: 'SUGGESTION',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['hasWounds'],
        iaSpecRefs: ['11.1'],
        notes:
          'Wound comment may be suggested later. Do not AUTO a YES/NO gate into a clinical narrative.',
      },
    ],
  },
  {
    businessKey: 'pressure_ulcer_skin_inspection_frequency',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [{ kind: 'MANUAL', notes: 'No IA question records skin inspection frequency.' }],
  },
  {
    businessKey: 'pressure_ulcer_repositioning_schedule',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'No IA question records a repositioning schedule; equipment-guide copy is not a schedule.',
      },
    ],
  },
  {
    businessKey: 'pressure_ulcer_relieving_equipment',
    mode: 'SUGGESTION',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['11.1'],
        notes:
          'Equipment comment may be suggested later. Do not AUTO a YES/NO further-equipment gate into narrative.',
      },
    ],
  },
  {
    businessKey: 'pressure_ulcer_nutrition_skin_healing',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'MUST / appetite scores are a different SoT and must not populate this narrative.',
      },
    ],
  },
  {
    businessKey: 'pressure_ulcer_service_user_needs',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'Generic Care 2020 needs field; IA §11 holds no pressure-ulcer-specific needs question.',
      },
    ],
  },
  {
    businessKey: 'pressure_ulcer_needs_person_centred',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [{ kind: 'MANUAL', notes: 'Free-text person-centred narrative for the needs question.' }],
  },
  {
    businessKey: 'pressure_ulcer_desired_goals_outcomes',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'The IA holds no pressure-ulcer-specific goals; general support goals must not be mapped.',
      },
    ],
  },
  {
    businessKey: 'pressure_ulcer_support_required',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      { kind: 'MANUAL', notes: 'Generic Care 2020 support narrative; no pressure-ulcer-specific IA source.' },
    ],
  },
  {
    businessKey: 'pressure_ulcer_area_risk',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic "is there a risk associated with this area of care?" gate. It must not be driven from Waterlow score or from §11.1 "Pressure ulcer risk assessment completed?"; the assessor owns this decision.',
      },
    ],
  },
  ...areaRiskFollowUpManualEntriesResolvedByEngine('pressure_ulcer'),
];

export type PressureUlcerFieldBusinessKey =
  (typeof PRESSURE_ULCER_FIELD_REGISTRY)[number]['businessKey'];

export const PRESSURE_ULCER_AUTO_PREFILL_KEYS = PRESSURE_ULCER_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const PRESSURE_ULCER_SUGGESTION_KEYS = PRESSURE_ULCER_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const PRESSURE_ULCER_MANUAL_KEYS = PRESSURE_ULCER_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function pressureUlcerFieldRegistryEntry(
  businessKey: string,
): PressureUlcerFieldRegistryEntry | undefined {
  return PRESSURE_ULCER_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertPressureUlcerRegistryMatchesTemplate(): void {
  const templateKeys = PRESSURE_ULCER_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = PRESSURE_ULCER_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Pressure Ulcer registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Pressure Ulcer registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
