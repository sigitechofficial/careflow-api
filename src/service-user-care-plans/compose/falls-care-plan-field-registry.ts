import { FALLS_CARE_PLAN_SEED } from '../../../prisma/seeds/falls-care-plan.seed-data';

/**
 * Documentation-and-guard registry for the Falls Care Plan.
 *
 * Unlike Cognition & Behaviour and Culture/Religion, Falls already has a mature IA
 * suggestion engine in `falls-care-plan.suggestions.ts` (matching fields by section title
 * + label + type, and drawing on a structured FallsSnapshot record). That engine remains
 * the single source of truth for resolving Falls suggestions — this registry does NOT
 * re-resolve anything and must never become a second competing IA mapping system.
 *
 * Its job is to (a) record, per field, whether the engine is expected to offer a
 * suggestion or the field is manual, with the exact IA source, and (b) guard that the
 * registry and the seed template stay in lockstep. The Care 2020 needs / goals / support /
 * risk block is MANUAL: the IA holds no Falls-specific needs / goals / support question,
 * and a generic risk flag must not drive the "risk associated with this area of care" gate.
 */
export type FallsFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type FallsFieldSourceKind = 'INITIAL_ASSESSMENT' | 'FALLS_SNAPSHOT' | 'MANUAL';

export type FallsFieldSourceRef = {
  kind: FallsFieldSourceKind;
  iaFieldKeys?: readonly string[];
  iaSpecRefs?: readonly string[];
  notes?: string;
};

export type FallsFieldRegistryEntry = {
  businessKey: string;
  mode: FallsFieldMappingMode;
  /** True when the existing Falls engine resolves a suggestion for this field. */
  resolvedByEngine: boolean;
  sources: readonly FallsFieldSourceRef[];
};

export const FALLS_FIELD_REGISTRY: readonly FallsFieldRegistryEntry[] = [
  // ---------- Falls history (existing — resolved by the Falls engine) ----------
  {
    businessKey: 'falls_falls_last_12_months',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['fallsLast12Months'],
        iaSpecRefs: ['12.7'],
        notes: 'IA §12.7 "Falls in last 12 months" / "Number of falls (last 12 months)".',
      },
      { kind: 'FALLS_SNAPSHOT', notes: 'FallsSnapshot.numberOfFalls / fallsLast12Months.' },
    ],
  },
  {
    businessKey: 'falls_last_fall_details',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['12.7'],
        notes: 'IA §12.7 "Most recent fall date" + "Injury caused by fall".',
      },
      { kind: 'FALLS_SNAPSHOT', notes: 'FallsSnapshot.mostRecentFallDate.' },
    ],
  },
  {
    businessKey: 'falls_injury_from_previous',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['12.7'],
        notes: 'IA §12.7 "Injury caused by fall".',
      },
      { kind: 'FALLS_SNAPSHOT', notes: 'FallsSnapshot.injuryCaused.' },
    ],
  },

  // ---------- Prevention plan (existing) ----------
  {
    businessKey: 'falls_mobility_aids',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['usesHoistOrSling', 'clinicalEquipmentInUse'],
        iaSpecRefs: ['12.5a', '12.8', '12.10'],
        notes:
          'IA §12.5a "Uses hoist or sling", §12.8 "Hoist / profiling bed / air mattress in use", §12.10 "Further equipment details", §12.8 "mobilising aids in good working order".',
      },
    ],
  },
  {
    businessKey: 'falls_environmental_hazards',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['3.7', '3.10'],
        notes: 'IA §3.7 "Trip hazards identified", §3.10 "Environment / access hazard notes".',
      },
    ],
  },
  {
    businessKey: 'falls_transfers_instructions',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['transferSupportRequired'],
        iaSpecRefs: ['12.5c'],
        notes:
          'IA §12.5c "Transfer comments", "Transfer support required", "Independent with all transfers".',
      },
    ],
  },
  {
    businessKey: 'falls_referral_physiotherapy',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      { kind: 'MANUAL', notes: 'No IA source records a physiotherapy referral decision.' },
    ],
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'falls_service_user_needs',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic needs field. The IA holds no Falls-specific "needs" question; general IA needs are the wrong scope.',
      },
    ],
  },
  {
    businessKey: 'falls_needs_person_centred',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [{ kind: 'MANUAL', notes: 'Free-text person-centred narrative for the needs question.' }],
  },
  {
    businessKey: 'falls_desired_goals_outcomes',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'The IA holds no Falls-specific goals; general support goals must not be mapped.',
      },
    ],
  },
  {
    businessKey: 'falls_support_required',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      { kind: 'MANUAL', notes: 'IA general day-to-day support is the wrong scope for Falls-specific support.' },
    ],
  },
  {
    businessKey: 'falls_area_risk',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic "is there a risk associated with this area of care?" gate. It must not be driven from a generic IA risk flag or the FallsSnapshot risk level; the assessor owns this decision.',
      },
    ],
  },
];

export type FallsFieldBusinessKey = (typeof FALLS_FIELD_REGISTRY)[number]['businessKey'];

export const FALLS_SUGGESTION_KEYS = FALLS_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const FALLS_MANUAL_KEYS = FALLS_FIELD_REGISTRY.filter((entry) => entry.mode === 'MANUAL').map(
  (entry) => entry.businessKey,
);

export function fallsFieldRegistryEntry(businessKey: string): FallsFieldRegistryEntry | undefined {
  return FALLS_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertFallsRegistryMatchesTemplate(): void {
  const templateKeys = FALLS_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = FALLS_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Falls registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Falls registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
