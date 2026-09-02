import { CONTINENCE_CARE_PLAN_SEED } from '../../../prisma/seeds/continence-care-plan.seed-data';
import { areaRiskFollowUpManualEntriesResolvedByEngine } from '../../../prisma/seeds/area-risk-follow-up.seed';

/**
 * Documentation-and-guard registry for the Continence Care Plan.
 *
 * Continence already has a mature AUTO-PREFILL compose engine in
 * `remaining-area-care-plans.compose.ts` (`CONTINENCE_CARE_PLAN_FIELD_MAPPINGS` +
 * `composeContinenceCarePlan`), matching the six existing fields by label and drawing on the
 * Initial Assessment answers, ADL metadata and the IA continence snapshot. That engine remains
 * the single source of truth and is intentionally retained unchanged — this registry does NOT
 * re-resolve anything and must never become a second competing Continence compose/mapping
 * system.
 *
 * Its job is to (a) record, per field, whether the engine auto-prefills it and from where, or
 * whether it is manual, and (b) guard that the registry and the seed template stay in
 * lockstep. The Care 2020 needs / goals / support / risk block is MANUAL: the IA holds no
 * continence-specific needs / goals / support narrative, and the generic risk gate is the
 * assessor's decision.
 */
export type ContinenceFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type ContinenceFieldSourceKind =
  | 'INITIAL_ASSESSMENT'
  | 'CONTINENCE_SNAPSHOT'
  | 'ADL_METADATA'
  | 'MANUAL';

export type ContinenceFieldSourceRef = {
  kind: ContinenceFieldSourceKind;
  iaFieldKeys?: readonly string[];
  notes?: string;
};

export type ContinenceFieldRegistryEntry = {
  businessKey: string;
  mode: ContinenceFieldMappingMode;
  /** True when the existing Continence engine auto-prefills this field. */
  resolvedByEngine: boolean;
  sources: readonly ContinenceFieldSourceRef[];
};

export const CONTINENCE_FIELD_REGISTRY: readonly ContinenceFieldRegistryEntry[] = [
  // ---------- Continence status (Phase 1: AUTO disabled — SUGGESTION later) ----------
  {
    businessKey: 'continence_bladder',
    mode: 'SUGGESTION',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['bladderContinenceOptions'],
        notes:
          'IA codes (no_concern / incontinence / products) are not Care Plan SELECT labels. Do not AUTO. Do not treat incontinence as Continent.',
      },
    ],
  },
  {
    businessKey: 'continence_bowel',
    mode: 'SUGGESTION',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['bowelContinenceOptions'],
        notes: 'IA codes are not Care Plan SELECT labels. Do not AUTO.',
      },
    ],
  },
  {
    businessKey: 'continence_products_used',
    mode: 'SUGGESTION',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        notes: 'Do not keyword-match "pads". Product details may be suggested later, not silently written.',
      },
    ],
  },

  // ---------- Care instructions ----------
  {
    businessKey: 'continence_toileting_routine',
    mode: 'SUGGESTION',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        notes: 'Do not keyword-match "toileting". ADL notes are related, not a Care Plan routine.',
      },
    ],
  },
  {
    businessKey: 'continence_fluid_intake',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'fluidThickness / adequatelyHydrated are not fluid-intake guidance for continence.',
      },
    ],
  },
  {
    businessKey: 'continence_skin_care',
    mode: 'SUGGESTION',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        notes: 'Do not keyword-match "skin care" / "barrier cream".',
      },
    ],
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'continence_service_user_needs',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic Care 2020 needs field; the IA holds no continence-specific needs question.',
      },
    ],
  },
  {
    businessKey: 'continence_needs_person_centred',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      { kind: 'MANUAL', notes: 'Required free-text person-centred narrative for the needs question.' },
    ],
  },
  {
    businessKey: 'continence_desired_goals_outcomes',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      { kind: 'MANUAL', notes: 'The IA holds no continence-specific goals; must not be mapped.' },
    ],
  },
  {
    businessKey: 'continence_support_required',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'Generic Care 2020 support narrative; no continence-specific IA source.',
      },
    ],
  },
  {
    businessKey: 'continence_area_risk',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic "is there a risk associated with this area of care?" gate; the assessor owns this decision.',
      },
    ],
  },
  ...areaRiskFollowUpManualEntriesResolvedByEngine('continence'),
];

export type ContinenceFieldBusinessKey =
  (typeof CONTINENCE_FIELD_REGISTRY)[number]['businessKey'];

export const CONTINENCE_AUTO_PREFILL_KEYS = CONTINENCE_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const CONTINENCE_SUGGESTION_KEYS = CONTINENCE_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const CONTINENCE_MANUAL_KEYS = CONTINENCE_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function continenceFieldRegistryEntry(
  businessKey: string,
): ContinenceFieldRegistryEntry | undefined {
  return CONTINENCE_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertContinenceRegistryMatchesTemplate(): void {
  const templateKeys = CONTINENCE_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = CONTINENCE_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Continence registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Continence registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
