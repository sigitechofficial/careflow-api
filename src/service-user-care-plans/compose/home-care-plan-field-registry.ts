import { HOME_CARE_PLAN_SEED } from '../../../prisma/seeds/home-care-plan.seed-data';

/** How a Home Care Plan field participates in compose. Mirrors the Home Support Plan contract. */
export type HcpFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type HcpFieldSourceKind =
  | 'INITIAL_ASSESSMENT'
  | 'COMPOSITE'
  | 'SYSTEM'
  | 'MANUAL';

export type HcpFieldSourceRef = {
  kind: HcpFieldSourceKind;
  iaFieldKeys?: readonly string[];
  notes?: string;
};

export type HcpFieldRegistryEntry = {
  businessKey: string;
  mode: HcpFieldMappingMode;
  source: HcpFieldSourceKind;
  sources: readonly HcpFieldSourceRef[];
  resolverImplemented?: boolean;
};

/** IA field keys that must never be read or surfaced by Home Care Plan compose. */
export const HCP_SECURE_IA_FIELD_KEYS = [
  'keySafeCode',
  'doorCode',
  'keySafeCodeHolistic',
] as const;

/**
 * Approved mapping for every Home Care Plan field.
 *
 * Only defensible IA links are declared. Where Initial Assessment does not hold an
 * equivalent — or holds something that measures a different thing — the field is MANUAL
 * and the reason is recorded in `notes` so the decision is reviewable.
 */
export const HCP_FIELD_REGISTRY: readonly HcpFieldRegistryEntry[] = [
  // ---------- Package overview ----------
  {
    businessKey: 'hcp_plan_start_date',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['assessmentDate'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hcp_needs_summary',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        iaFieldKeys: ['whatMattersMost', 'supportGoals'],
        notes: 'Narrative summary for clinician review',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hcp_hours_visits',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Visit plan / rota — clinician-authored' }],
  },

  // ---------- About me ----------
  {
    businessKey: 'hcp_about_me',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['whatMattersMost'],
        notes: 'Person-centred narrative; clinician confirms before it enters the record',
      },
    ],
    resolverImplemented: true,
  },

  // ---------- Outcomes ----------
  {
    businessKey: 'hcp_desired_goals_outcomes',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Care 2020 fixed option list has no IA equivalent; free-text IA goals cannot be safely reduced to these options',
      },
    ],
  },
  {
    businessKey: 'hcp_detailed_goals_outcomes',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['supportGoals', 'whatMattersMost'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hcp_risks_if_care_not_provided',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Clinician-authored risk narrative' }],
  },
  {
    businessKey: 'hcp_review_frequency',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['reviewFrequency'] }],
    resolverImplemented: true,
  },

  // ---------- Cognition ----------
  {
    businessKey: 'hcp_cognitive_impairment',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA cognitiveImpairment records severity (none/mild/moderate/severe); Care 2020 asks for cause (Dementia, Stroke/TIA, Brain injury). Different axes — mapping would fabricate a diagnosis.',
      },
    ],
  },

  // ---------- Personal care ----------
  {
    businessKey: 'hcp_personal_care_needs',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      { kind: 'COMPOSITE', iaFieldKeys: ['personalHygiene', 'personalCareLocations'] },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hcp_personal_needs_summary',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA personal hygiene answers are free text and cannot be reduced to the ten Care 2020 task options without guessing',
      },
    ],
  },
  {
    businessKey: 'hcp_personal_care_consent',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA holds one general consent to care. Deriving a domain-specific consent from it would record a consent the person was never asked for.',
      },
    ],
  },

  // ---------- Continence ----------
  {
    businessKey: 'hcp_continence_care_needs',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        iaFieldKeys: ['bladderContinenceOptions', 'bowelContinenceOptions'],
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hcp_continence_needs_summary',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['bladderContinenceOptions', 'bowelContinenceOptions'],
        notes: 'Only catheter and pad tasks are derived; the rest stay for the assessor',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hcp_continence_consent',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Domain-specific consent — see hcp_personal_care_consent' }],
  },

  // ---------- Mobility ----------
  {
    businessKey: 'hcp_mobility_care_needs',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        iaFieldKeys: ['transferSupportRequired', 'usesHoistOrSling', 'clinicalEquipmentInUse'],
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hcp_mobility_summary',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Care 2020 levels (fully independent … bed bound) have no single IA equivalent; deriving one from transfer/hoist answers would overstate what IA records',
      },
    ],
  },
  {
    businessKey: 'hcp_mobility_aids_summary',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['usesHoistOrSling', 'transferSupportRequired'],
        notes: 'Hoisting and Transfer are directly evidenced; walking/standing are not',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hcp_mobility_consent',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Domain-specific consent — see hcp_personal_care_consent' }],
  },

  // ---------- Meals and nutrition ----------
  {
    businessKey: 'hcp_meal_requirements',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      { kind: 'COMPOSITE', iaFieldKeys: ['eatingAssistanceLevel', 'appetiteStatus', 'nutritionStatus'] },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hcp_meal_requirements_summary',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['nutritionalSupplementsPrescribed'],
        notes: 'Only "Nutritional supplements" is directly evidenced by IA',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hcp_dietary_needs_summary',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['foodTexture', 'fluidThickness'],
        notes: 'Texture and thickened fluids map to fixed options; diet type does not',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hcp_meal_consent',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Domain-specific consent — see hcp_personal_care_consent' }],
  },

  // ---------- Medication ----------
  {
    businessKey: 'hcp_medication_support_needs',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'MedicationSupportProfile is the authoritative record of medication responsibility; composing this field from IA risks contradicting it',
      },
    ],
  },
  {
    businessKey: 'hcp_medication_summary',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Duplicates the MedicationSupportProfile taxonomy; must not be auto-populated until a single source of truth is agreed',
      },
    ],
  },
  {
    businessKey: 'hcp_medication_consent',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Domain-specific consent — see hcp_personal_care_consent' }],
  },

  // ---------- Wider support ----------
  {
    businessKey: 'hcp_support_requirements',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['supportGoals'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hcp_household_support_summary',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA/ADL records how much help housework needs, not which of the fifteen Care 2020 tasks apply',
      },
    ],
  },
  {
    businessKey: 'hcp_other_support_summary',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA financeSupportRequired is broader than "collecting pension"; mapping it would overstate the answer',
      },
    ],
  },
  {
    businessKey: 'hcp_other_support_requirements',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Free-form catch-all' }],
  },
  {
    businessKey: 'hcp_support_consent',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Domain-specific consent — see hcp_personal_care_consent' }],
  },

  // ---------- Advance and end of life ----------
  {
    businessKey: 'hcp_advance_support_requirements',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Advance care planning is captured in its own care plan form' }],
  },
  {
    businessKey: 'hcp_advance_support_consent',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Domain-specific consent — see hcp_personal_care_consent' }],
  },
  {
    businessKey: 'hcp_final_days_requirements',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'End-of-life wishes are captured in the Final Days care plan' }],
  },
  {
    businessKey: 'hcp_final_days_consent',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Domain-specific consent — see hcp_personal_care_consent' }],
  },

  // ---------- Risk assessment ----------
  {
    businessKey: 'hcp_risk_assessment',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generated risk records remain on the risk profile; a single IA answer such as fallsLast12Months is not a risk assessment',
      },
    ],
  },
];

export type HcpFieldBusinessKey = (typeof HCP_FIELD_REGISTRY)[number]['businessKey'];

export const HCP_AUTO_PREFILL_KEYS = HCP_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const HCP_SUGGESTION_KEYS = HCP_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const HCP_MANUAL_KEYS = HCP_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function hcpFieldRegistryEntry(businessKey: string): HcpFieldRegistryEntry | undefined {
  return HCP_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

export function hcpTierManifestFromRegistry(): {
  autoPrefill: string[];
  suggestion: string[];
  manual: string[];
} {
  return {
    autoPrefill: [...HCP_AUTO_PREFILL_KEYS],
    suggestion: [...HCP_SUGGESTION_KEYS],
    manual: [...HCP_MANUAL_KEYS],
  };
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertHcpRegistryMatchesTemplate(): void {
  const templateKeys = HOME_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = HCP_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `HCP registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `HCP registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
