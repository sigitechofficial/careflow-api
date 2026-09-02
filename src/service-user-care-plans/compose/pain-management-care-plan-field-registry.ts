import { PAIN_MANAGEMENT_CARE_PLAN_SEED } from '../../../prisma/seeds/pain-management-care-plan.seed-data';
import { areaRiskFollowUpManualEntriesWithSource } from '../../../prisma/seeds/area-risk-follow-up.seed';

/** How a Pain Management field participates in compose. Mirrors the Culture/Final Days contract. */
export type PainFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type PainFieldSourceKind = 'INITIAL_ASSESSMENT' | 'MANUAL';

export type PainFieldSourceRef = {
  kind: PainFieldSourceKind;
  iaFieldKeys?: readonly string[];
  iaSpecRefs?: readonly string[];
  notes?: string;
};

export type PainFieldRegistryEntry = {
  businessKey: string;
  mode: PainFieldMappingMode;
  source: PainFieldSourceKind;
  sources: readonly PainFieldSourceRef[];
  resolverImplemented?: boolean;
};

/**
 * Approved mapping for every Pain Management field.
 *
 * The IA audit approved four suggestions from IA §5.3 (usual score, site, worsens,
 * regular analgesia). A fifth suggestion surfaces the Abbey Pain Scale summary from
 * the existing IA Pain Assessment Tool onto person-centred details — suggestion only,
 * never auto-written, never mapped onto usual pain score (0–10), never driving area-risk.
 *
 * NOTE (identified future improvement, deliberately out of scope): a structured
 * ObservationType "Pain score" (PAIN, NUMERIC, 0-10) exists but currently has zero live
 * records and is not loaded into the compose context, so it is NOT used here; the usable
 * source is IA §5.3 "Pain score (0-10)".
 */
export const PAIN_FIELD_REGISTRY: readonly PainFieldRegistryEntry[] = [
  // ---------- Pain profile ----------
  {
    businessKey: 'pain_management_usual_pain_score',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['5.3'],
        notes:
          'IA §5.3 "Pain score (0-10)" (NUMBER) is an exact type + scope match. Surfaced as a numeric suggestion for staff to confirm.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'pain_management_site_and_character',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['5.3'],
        notes:
          'IA §5.3 "Pain location" covers the SITE; the character of pain is not recorded in the IA, so this is a partial suggestion for staff to complete.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'pain_management_worsens_relieves',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['5.3'],
        notes:
          'IA §5.3 "Pain trigger / aggravating factors" covers what WORSENS pain. "Current pain relief" is allocated to Regular analgesia (used once), so the relieves half is staff-completed.',
      },
    ],
    resolverImplemented: true,
  },

  // ---------- Management ----------
  {
    businessKey: 'pain_management_regular_analgesia',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['5.3'],
        notes:
          'IA §5.3 "Current pain relief" records the current analgesia / pain relief. Surfaced as a suggestion; staff refine into a regular-analgesia plan.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'pain_management_non_pharmacological',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes: 'The IA records no non-pharmacological / non-drug pain-management methods.',
      },
    ],
  },
  {
    businessKey: 'pain_management_when_to_call_gp',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'No pain-specific escalation question exists. §5.1 "GP or specialist nurse review requested?" is breathing-scope, not pain.',
      },
    ],
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'pain_management_nrs_needed',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Workflow toggle (whether to perform a Numeric Rating Scale assessment); not clinical data. The pain score itself is suggested separately, but this "do you need to" gate has no IA source.',
      },
    ],
  },
  {
    businessKey: 'pain_management_service_user_needs',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes: 'Generic needs field; the IA holds no pain-specific needs question.',
      },
    ],
  },
  {
    businessKey: 'pain_management_needs_person_centred',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        notes:
          'Abbey Pain Scale summary from the IA Pain Assessment Tool (holistic tab 10). Suggestion only — never auto-written, never mapped onto usual pain score (0–10), never drives area-risk.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'pain_management_desired_goals_outcomes',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes: 'The IA holds no pain-specific goals; general support goals must not be mapped.',
      },
    ],
  },
  {
    businessKey: 'pain_management_support_required',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      { kind: 'MANUAL', notes: 'Generic Care 2020 support narrative; no pain-specific IA source.' },
    ],
  },
  {
    businessKey: 'pain_management_area_risk',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic "is there a risk associated with this area of care?" gate; must not be driven from a generic IA risk flag.',
      },
    ],
  },
  ...areaRiskFollowUpManualEntriesWithSource('pain_management'),
];

export type PainFieldBusinessKey = (typeof PAIN_FIELD_REGISTRY)[number]['businessKey'];

export const PAIN_AUTO_PREFILL_KEYS = PAIN_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const PAIN_SUGGESTION_KEYS = PAIN_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const PAIN_MANUAL_KEYS = PAIN_FIELD_REGISTRY.filter((entry) => entry.mode === 'MANUAL').map(
  (entry) => entry.businessKey,
);

export function painFieldRegistryEntry(businessKey: string): PainFieldRegistryEntry | undefined {
  return PAIN_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

export function painTierManifestFromRegistry(): {
  autoPrefill: string[];
  suggestion: string[];
  manual: string[];
} {
  return {
    autoPrefill: [...PAIN_AUTO_PREFILL_KEYS],
    suggestion: [...PAIN_SUGGESTION_KEYS],
    manual: [...PAIN_MANUAL_KEYS],
  };
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertPainRegistryMatchesTemplate(): void {
  const templateKeys = PAIN_MANAGEMENT_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = PAIN_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Pain registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Pain registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
