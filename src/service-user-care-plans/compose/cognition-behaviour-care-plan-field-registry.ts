import { COGNITION_BEHAVIOUR_CARE_PLAN_SEED } from '../../../prisma/seeds/cognition-behaviour-care-plan.seed-data';

/** How a Cognition & Behaviour field participates in compose. Mirrors the Advance contract. */
export type CogFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type CogFieldSourceKind = 'INITIAL_ASSESSMENT' | 'MANUAL';

export type CogFieldSourceRef = {
  kind: CogFieldSourceKind;
  /** IA questions addressed by stable key. */
  iaFieldKeys?: readonly string[];
  /** IA questions addressed by spec reference when they carry no fieldKey. */
  iaSpecRefs?: readonly string[];
  notes?: string;
};

export type CogFieldRegistryEntry = {
  businessKey: string;
  mode: CogFieldMappingMode;
  source: CogFieldSourceKind;
  sources: readonly CogFieldSourceRef[];
  resolverImplemented?: boolean;
};

/**
 * Approved mapping for every Cognition and Behaviour field.
 *
 * The IA audit approved exactly two suggestions, both drawn from IA §10.6 / §10.6a
 * (the cognition & behaviour section of the assessment):
 *   - "Diagnosis or cognitive concern" ← cognitive impairment level + diagnosed
 *     dementia / learning disability / brain injury.
 *   - "Known triggers" ← agitation / challenging behaviour with change (change is the
 *     recorded trigger).
 *
 * Everything else stays MANUAL with the reason recorded, so the decision is reviewable.
 * Nothing on this form auto-prefills; clinical suggestions are surfaced for a clinician
 * to accept, never written into the draft.
 */
export const COG_FIELD_REGISTRY: readonly CogFieldRegistryEntry[] = [
  // ---------- Cognition ----------
  {
    // Approved IA suggestion #1.
    businessKey: 'cog_diagnosis_or_concern',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['cognitiveImpairment'],
        iaSpecRefs: ['10.6', '10.6a'],
        notes:
          'IA §10.6 "Cognitive impairment level" and §10.6a "Diagnosed dementia?", "Learning disability?", "Ever had a brain injury?" describe the same cognitive diagnosis / concern. Surfaced as a suggestion of the positive findings only; the assessor confirms and edits before it is saved.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'cog_orientation',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA §10.6a records orientation only as booleans ("Fully orientated?" / "De-orientated?"). This field is a four-point frequency SELECT (Always/Usually/Sometimes/Rarely); the IA options have no compatible mapping, so a suggestion cannot be represented safely.',
      },
    ],
  },
  {
    businessKey: 'cog_memory_prompts',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA §10.6a memory questions record recall ability ("Good long-/short-term memory recall?"), not which memory prompts or aids the person uses day to day. Different information.',
      },
    ],
  },

  // ---------- Behaviour support ----------
  {
    // Approved IA suggestion #2.
    businessKey: 'cog_known_triggers',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['10.6a'],
        notes:
          'IA §10.6a "Gets agitated with change?" and "Challenging behaviour or agitation with change?" identify change as a recorded behavioural trigger — the same information this field captures. Surfaced only when answered Yes.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'cog_calming_strategies',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'No IA source: the assessment records no calming strategies. This is carer-authored guidance.',
      },
    ],
  },
  {
    businessKey: 'cog_wandering_risk',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'The IA has no wandering / exit-seeking question. "De-orientated?" is a proxy, not the same fact; and a generic yes/no risk indicator must not auto-populate a specific behaviour-risk field.',
      },
    ],
  },
  {
    businessKey: 'cog_additional_guidance',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes: 'Free-text carer guidance with no equivalent IA source.',
      },
    ],
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'cog_service_user_needs',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Scoped to cognition & behaviour. The IA holds no cognition/behaviour-specific "needs" question; general IA needs are the wrong scope and must not be mapped on wording alone.',
      },
    ],
  },
  {
    businessKey: 'cog_needs_person_centred',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Free-text person-centred narrative for the needs question. No exact/strongly equivalent cognition/behaviour-specific IA source.',
      },
    ],
  },
  {
    businessKey: 'cog_desired_goals_outcomes',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'General IA support goals are not cognition/behaviour-specific goals; mapping on wording similarity alone was explicitly ruled out.',
      },
    ],
  },
  {
    businessKey: 'cog_support_required',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA general day-to-day support content is the wrong scope for cognition/behaviour-specific support.',
      },
    ],
  },
  {
    businessKey: 'cog_area_risk',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic "is there a risk associated with this area of care?" gate. It must not be driven from a generic IA risk flag; the risk-record system and the assessor own this decision.',
      },
    ],
  },
];

export type CogFieldBusinessKey = (typeof COG_FIELD_REGISTRY)[number]['businessKey'];

export const COG_AUTO_PREFILL_KEYS = COG_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const COG_SUGGESTION_KEYS = COG_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const COG_MANUAL_KEYS = COG_FIELD_REGISTRY.filter((entry) => entry.mode === 'MANUAL').map(
  (entry) => entry.businessKey,
);

export function cogFieldRegistryEntry(businessKey: string): CogFieldRegistryEntry | undefined {
  return COG_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

export function cogTierManifestFromRegistry(): {
  autoPrefill: string[];
  suggestion: string[];
  manual: string[];
} {
  return {
    autoPrefill: [...COG_AUTO_PREFILL_KEYS],
    suggestion: [...COG_SUGGESTION_KEYS],
    manual: [...COG_MANUAL_KEYS],
  };
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertCogRegistryMatchesTemplate(): void {
  const templateKeys = COGNITION_BEHAVIOUR_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = COG_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Cognition registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Cognition registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
