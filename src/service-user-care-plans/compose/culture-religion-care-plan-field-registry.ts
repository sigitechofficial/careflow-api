import { CULTURE_RELIGION_CARE_PLAN_SEED } from '../../../prisma/seeds/culture-religion-care-plan.seed-data';

/** How a Culture/Religion/Spirituality field participates in compose. Mirrors the Advance contract. */
export type CrsFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type CrsFieldSourceKind = 'INITIAL_ASSESSMENT' | 'MANUAL';

export type CrsFieldSourceRef = {
  kind: CrsFieldSourceKind;
  /** IA questions addressed by stable key. */
  iaFieldKeys?: readonly string[];
  /** IA questions addressed by spec reference when they carry no fieldKey. */
  iaSpecRefs?: readonly string[];
  notes?: string;
};

export type CrsFieldRegistryEntry = {
  businessKey: string;
  mode: CrsFieldMappingMode;
  source: CrsFieldSourceKind;
  sources: readonly CrsFieldSourceRef[];
  resolverImplemented?: boolean;
};

/**
 * Approved mapping for every Culture/Religion/Spirituality field.
 *
 * The IA audit approved five suggestions, all drawn from the IA §1.1 / §1.3b / §1.6 /
 * §1.7 "About me / equality" questions, which genuinely record the same faith, cultural,
 * observance, dietary and staff-gender-preference information. Religion and belief are
 * special-category personal data, so every mapping is a SUGGESTION for staff to review —
 * nothing is auto-filled.
 *
 * The generic Care 2020 needs / goals / support / risk block stays MANUAL: the IA holds
 * no culture/religion-specific "needs", "goals", "support" or "area risk" question, and
 * general IA content must not be mapped on wording similarity.
 */
export const CRS_FIELD_REGISTRY: readonly CrsFieldRegistryEntry[] = [
  // ---------- Identity and beliefs ----------
  {
    businessKey: 'crs_faith_belief_system',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['religiousSpiritualPreferences', 'beliefs'],
        iaSpecRefs: ['1.3b', '1.1'],
        notes:
          'IA §1.3b "Religious and/or spiritual preferences" and §1.1 "Beliefs" name the person’s faith / belief system directly. Special-category data — surfaced as a suggestion for staff to review, never auto-filled.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'crs_cultural_practices',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['1.7'],
        notes:
          'IA §1.7 "Religion, culture, language, reasonable adjustments" records the cultural practices and adjustments important to the person. Suggestion only.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'crs_religious_observances',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['1.7'],
        notes:
          'IA §1.7 "Prayer routine or worship needs" and "Religious or spiritual needs" describe how the person observes their religion (prayer/worship routine, spiritual needs). Suggestion only.',
      },
    ],
    resolverImplemented: true,
  },

  // ---------- Daily care impact ----------
  {
    businessKey: 'crs_dietary_requirements',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['1.7'],
        notes:
          'IA §1.7 "Religious or cultural dietary requirements" is an exact-scope match. Suggestion only.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'crs_gender_preference',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['1.6'],
        notes:
          'IA §1.6 "Staff gender preference for personal care" (Male / Female / No preference / Case by case) is the same fact. The SELECT value is mapped to its label and surfaced as a suggestion for this free-text field.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'crs_staff_notes',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Catch-all synthesis of staff guidance. No single equivalent IA question; §1.7 "Any equality related risk or need" is a different (equality-risk) scope.',
      },
    ],
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'crs_service_user_needs',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic needs field. The nearest area-specific IA item (§1.7 "Religious or spiritual needs") is already surfaced under Religious observances; a second home would double-map it. General IA needs are the wrong scope.',
      },
    ],
  },
  {
    businessKey: 'crs_needs_person_centred',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Free-text person-centred narrative for the needs question. No exact/strongly equivalent culture-specific IA source.',
      },
    ],
  },
  {
    businessKey: 'crs_desired_goals_outcomes',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'The IA holds no culture/religion-specific goals; general support goals must not be mapped on wording similarity.',
      },
    ],
  },
  {
    businessKey: 'crs_support_required',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA general day-to-day support content is the wrong scope for culture/religion-specific support.',
      },
    ],
  },
  {
    businessKey: 'crs_area_risk',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic "is there a risk associated with this area of care?" gate. It must not be driven from a generic IA risk flag or from §1.7 "Any equality related risk or need"; the assessor owns this decision.',
      },
    ],
  },
];

export type CrsFieldBusinessKey = (typeof CRS_FIELD_REGISTRY)[number]['businessKey'];

export const CRS_AUTO_PREFILL_KEYS = CRS_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const CRS_SUGGESTION_KEYS = CRS_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const CRS_MANUAL_KEYS = CRS_FIELD_REGISTRY.filter((entry) => entry.mode === 'MANUAL').map(
  (entry) => entry.businessKey,
);

export function crsFieldRegistryEntry(businessKey: string): CrsFieldRegistryEntry | undefined {
  return CRS_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

export function crsTierManifestFromRegistry(): {
  autoPrefill: string[];
  suggestion: string[];
  manual: string[];
} {
  return {
    autoPrefill: [...CRS_AUTO_PREFILL_KEYS],
    suggestion: [...CRS_SUGGESTION_KEYS],
    manual: [...CRS_MANUAL_KEYS],
  };
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertCrsRegistryMatchesTemplate(): void {
  const templateKeys = CULTURE_RELIGION_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = CRS_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Culture/Religion registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Culture/Religion registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
