import { HOME_SUPPORT_PLAN_SEED } from '../../../prisma/seeds/home-support-plan.seed-data';

/** How a Home Support Plan field participates in hybrid compose. */
export type HspFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

/** Primary data source for mapping (may combine refs in `sources`). */
export type HspFieldSourceKind =
  | 'INITIAL_ASSESSMENT'
  | 'ADL_METADATA'
  | 'ABOUT_ME'
  | 'SERVICE_USER_PROFILE'
  | 'SYSTEM'
  | 'COMPOSITE'
  | 'MANUAL';

export type HspFieldSourceRef = {
  kind: HspFieldSourceKind;
  iaFieldKeys?: readonly string[];
  aboutMeKeys?: readonly string[];
  adlActivityIds?: readonly string[];
  profileFields?: readonly string[];
  notes?: string;
};

export type HspFieldRegistryEntry = {
  businessKey: string;
  mode: HspFieldMappingMode;
  /** Primary source kind (first meaningful contributor). */
  source: HspFieldSourceKind;
  /** Detailed source references — may list multiple when `source` is COMPOSITE. */
  sources: readonly HspFieldSourceRef[];
  /** Phase 2B pilot — compose resolver implemented for this field. */
  resolverImplemented?: boolean;
};

/** IA field keys that must never be read or surfaced in compose output. */
export const HSP_SECURE_IA_FIELD_KEYS = [
  'keySafeCode',
  'doorCode',
  'keySafeCodeHolistic',
] as const;

/** Approved mapping for all 45 Home Support Plan fields (phase 2C). */
export const HSP_FIELD_REGISTRY: readonly HspFieldRegistryEntry[] = [
  // Plan overview
  {
    businessKey: 'hsp_plan_start_date',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      { kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['assessmentDate'] },
      { kind: 'SYSTEM', notes: 'Default to today when IA date absent' },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_support_needs_summary',
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
    businessKey: 'hsp_planned_hours_visits',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Visit plan / rota — clinician-authored' }],
  },
  {
    businessKey: 'hsp_review_frequency',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['reviewFrequency'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_next_review_due_date',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['nextReviewDate'] }],
    resolverImplemented: true,
  },
  // Personal support
  {
    businessKey: 'hsp_personal_care_tasks',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        adlActivityIds: ['bathing', 'grooming', 'dressing_undressing', 'toileting'],
        aboutMeKeys: ['personalCare'],
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_personal_care_assistance_level',
    mode: 'SUGGESTION',
    source: 'ADL_METADATA',
    sources: [
      {
        kind: 'ADL_METADATA',
        adlActivityIds: ['bathing', 'grooming', 'dressing_undressing', 'toileting'],
        notes: 'Derived assistance level from ADL scores',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_toileting_continence_support',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        adlActivityIds: ['toileting'],
        iaFieldKeys: ['bladderContinenceOptions', 'bowelContinenceOptions'],
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_preferred_personal_care_times',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        iaFieldKeys: ['preferredVisitTimes'],
        aboutMeKeys: ['routineSummary'],
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_dignity_privacy_preferences',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        aboutMeKeys: ['howToSupport'],
        iaFieldKeys: ['lifestyleRoleChoices'],
      },
    ],
    resolverImplemented: true,
  },
  // Nutrition & meals
  {
    businessKey: 'hsp_meal_preparation_support',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        adlActivityIds: ['preparing_food'],
        aboutMeKeys: ['domesticSupport'],
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_eating_drinking_assistance_level',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['eatingAssistanceLevel'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_dietary_preferences_restrictions',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        aboutMeKeys: ['foodPreferences'],
        iaFieldKeys: ['foodTexture', 'nutritionStatus', 'nutritionalSupplementsPrescribed'],
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_fluid_intake_guidance',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        iaFieldKeys: ['fluidThickness', 'adequatelyHydrated'],
      },
    ],
    resolverImplemented: true,
  },
  // Domestic & household
  {
    businessKey: 'hsp_cleaning_tasks',
    mode: 'SUGGESTION',
    source: 'ABOUT_ME',
    sources: [{ kind: 'ABOUT_ME', aboutMeKeys: ['domesticSupport'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_laundry_tasks',
    mode: 'SUGGESTION',
    source: 'ABOUT_ME',
    sources: [{ kind: 'ABOUT_ME', aboutMeKeys: ['domesticSupport'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_other_household_tasks',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        aboutMeKeys: ['domesticSupport', 'supportOther'],
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_domestic_assistance_level',
    mode: 'SUGGESTION',
    source: 'ADL_METADATA',
    sources: [
      {
        kind: 'ADL_METADATA',
        adlActivityIds: ['preparing_food', 'housework'],
        notes: 'Derived assistance level from domestic ADL rows',
      },
    ],
    resolverImplemented: true,
  },
  // Shopping & community
  {
    businessKey: 'hsp_shopping_errands',
    mode: 'AUTO_PREFILL',
    source: 'ABOUT_ME',
    sources: [{ kind: 'ABOUT_ME', aboutMeKeys: ['shoppingArrangements'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_finance_support_required',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['financeSupportRequired'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_finance_support_details',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Sensitive finance detail — clinician-authored only' }],
  },
  {
    businessKey: 'hsp_social_community_activities',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        aboutMeKeys: ['meaningfulActivities', 'lifeHistoryInterests'],
        iaFieldKeys: ['lifestyleRoleChoices'],
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_support_to_attend_activities',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        adlActivityIds: ['using_transport'],
        aboutMeKeys: ['meaningfulActivities'],
        notes: 'Derived escort / prompting need from ADL and preferences',
      },
    ],
    resolverImplemented: true,
  },
  // Home access & safety
  {
    businessKey: 'hsp_home_access_instructions',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['homeAccessInstructions', 'accessInstructions'],
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_key_safe_in_use',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['keySafePresent', 'keySafePresentHolistic'],
        notes: 'Never surface keySafeCode / doorCode',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_key_safe_entry_notes',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['keySafeLocation'],
        notes: 'Location only — secure codes excluded',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_telecare_pendant_in_use',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['pendantTelecare'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_can_answer_front_door',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['canAnswerFrontDoor'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_lives_alone',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['livesAlone'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_environmental_hazards_notes',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        iaFieldKeys: [
          'fireSafetyRisksDetails',
          'homeEnvironmentSafetyMeasures',
          'staffVisitRisks',
        ],
        notes: 'Includes §3.10 environment / access hazard notes when present',
      },
    ],
    resolverImplemented: true,
  },
  // Equipment & mobility aids
  {
    businessKey: 'hsp_equipment_aids_in_home',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        adlActivityIds: ['mobility_indoors', 'mobility_outdoors', 'transfers'],
        notes: 'Equipment narrative from ADL context',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_mobility_aids_in_use',
    mode: 'AUTO_PREFILL',
    source: 'ADL_METADATA',
    sources: [
      {
        kind: 'ADL_METADATA',
        profileFields: ['mobilityAidsRequired', 'mobilityAidsList'],
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_hoist_sling_in_use',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['usesHoistOrSling'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_equipment_maintenance_contact',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Equipment supplier contact — clinician-authored' }],
  },
  // Coordination & informal support
  {
    businessKey: 'hsp_informal_carer_involved',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['informalCarerSupport'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_informal_carer_contact',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['informalCarerContact', 'informalCarerName'],
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_other_care_agencies',
    mode: 'AUTO_PREFILL',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['otherCareAgencies'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_gp_pharmacy_professionals',
    mode: 'AUTO_PREFILL',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        iaFieldKeys: ['gpContactDetails'],
        profileFields: ['gpPharmacyLine'],
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_no_response_procedure',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['noResponseProcedureAgreed'],
        notes: 'Expand to procedure narrative on accept',
      },
    ],
    resolverImplemented: true,
  },
  // Goals & escalation
  {
    businessKey: 'hsp_goal_1',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['supportGoals', 'whatMattersMost'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_goal_1_carer_support',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['supportGoals'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_goal_2',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [{ kind: 'INITIAL_ASSESSMENT', iaFieldKeys: ['supportGoals'] }],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_risks_if_support_not_provided',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Clinical risk judgement — clinician-authored' }],
  },
  {
    businessKey: 'hsp_escalation_instructions',
    mode: 'SUGGESTION',
    source: 'COMPOSITE',
    sources: [
      {
        kind: 'COMPOSITE',
        iaFieldKeys: ['staffVisitRisks', 'breathingActionPlan', 'painManagementPlan'],
        notes: 'Escalation narrative composed from IA risk / action plans',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'hsp_progress_notes',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Ongoing progress — clinician-authored only' }],
  },
] as const;

export type HspFieldBusinessKey = (typeof HSP_FIELD_REGISTRY)[number]['businessKey'];

function registryKeysByMode(mode: HspFieldMappingMode): string[] {
  return HSP_FIELD_REGISTRY.filter((entry) => entry.mode === mode).map((entry) => entry.businessKey);
}

export const HSP_AUTO_PREFILL_KEYS = registryKeysByMode('AUTO_PREFILL') as HspFieldBusinessKey[];
export type HspAutoPrefillKey = (typeof HSP_AUTO_PREFILL_KEYS)[number];
export const HSP_SUGGESTION_KEYS = registryKeysByMode('SUGGESTION') as HspFieldBusinessKey[];
export type HspSuggestionKey = (typeof HSP_SUGGESTION_KEYS)[number];
export const HSP_MANUAL_KEYS = registryKeysByMode('MANUAL') as HspFieldBusinessKey[];

/** Implemented AUTO_PREFILL resolvers (phase 2B pilot + phase 2D-1). */
export const HSP_PILOT_AUTO_PREFILL_KEYS = [
  'hsp_plan_start_date',
  'hsp_review_frequency',
  'hsp_next_review_due_date',
  'hsp_eating_drinking_assistance_level',
  'hsp_shopping_errands',
  'hsp_finance_support_required',
  'hsp_home_access_instructions',
  'hsp_key_safe_in_use',
  'hsp_telecare_pendant_in_use',
  'hsp_can_answer_front_door',
  'hsp_lives_alone',
  'hsp_mobility_aids_in_use',
  'hsp_hoist_sling_in_use',
  'hsp_informal_carer_involved',
  'hsp_informal_carer_contact',
  'hsp_other_care_agencies',
  'hsp_gp_pharmacy_professionals',
] as const satisfies readonly HspFieldBusinessKey[];

export const HSP_PILOT_SUGGESTION_KEYS = [
  'hsp_support_needs_summary',
  'hsp_personal_care_tasks',
  'hsp_personal_care_assistance_level',
  'hsp_toileting_continence_support',
  'hsp_preferred_personal_care_times',
  'hsp_dignity_privacy_preferences',
  'hsp_meal_preparation_support',
  'hsp_dietary_preferences_restrictions',
  'hsp_fluid_intake_guidance',
  'hsp_cleaning_tasks',
  'hsp_laundry_tasks',
  'hsp_other_household_tasks',
  'hsp_domestic_assistance_level',
  'hsp_social_community_activities',
  'hsp_support_to_attend_activities',
  'hsp_key_safe_entry_notes',
  'hsp_environmental_hazards_notes',
  'hsp_equipment_aids_in_home',
  'hsp_no_response_procedure',
  'hsp_goal_1',
  'hsp_goal_1_carer_support',
  'hsp_goal_2',
  'hsp_escalation_instructions',
] as const satisfies readonly HspFieldBusinessKey[];

export type HspPilotAutoPrefillKey = (typeof HSP_PILOT_AUTO_PREFILL_KEYS)[number];
export type HspPilotSuggestionKey = (typeof HSP_PILOT_SUGGESTION_KEYS)[number];

function assertPilotKeysMatchRegistry(): void {
  const implementedAuto = HSP_FIELD_REGISTRY.filter(
    (entry) => entry.mode === 'AUTO_PREFILL' && entry.resolverImplemented,
  ).map((entry) => entry.businessKey);

  if (implementedAuto.length !== HSP_AUTO_PREFILL_KEYS.length) {
    throw new Error(
      `HSP AUTO_PREFILL resolver count ${implementedAuto.length} !== registry tier ${HSP_AUTO_PREFILL_KEYS.length}`,
    );
  }
  for (const key of HSP_AUTO_PREFILL_KEYS) {
    if (!implementedAuto.includes(key)) {
      throw new Error(`HSP AUTO_PREFILL field missing resolverImplemented flag: ${key}`);
    }
  }

  if (new Set(implementedAuto).size !== HSP_PILOT_AUTO_PREFILL_KEYS.length) {
    throw new Error('HSP pilot auto-prefill keys out of sync with registry resolverImplemented flags');
  }
  for (const key of HSP_PILOT_AUTO_PREFILL_KEYS) {
    if (!implementedAuto.includes(key)) {
      throw new Error(`HSP pilot auto-prefill key missing resolver flag: ${key}`);
    }
  }

  const implementedSuggestion = HSP_FIELD_REGISTRY.filter(
    (entry) => entry.mode === 'SUGGESTION' && entry.resolverImplemented,
  ).map((entry) => entry.businessKey);

  if (implementedSuggestion.length !== HSP_SUGGESTION_KEYS.length) {
    throw new Error(
      `HSP SUGGESTION resolver count ${implementedSuggestion.length} !== registry tier ${HSP_SUGGESTION_KEYS.length}`,
    );
  }
  for (const key of HSP_SUGGESTION_KEYS) {
    if (!implementedSuggestion.includes(key)) {
      throw new Error(`HSP SUGGESTION field missing resolverImplemented flag: ${key}`);
    }
  }

  if (new Set(implementedSuggestion).size !== HSP_PILOT_SUGGESTION_KEYS.length) {
    throw new Error('HSP pilot suggestion keys out of sync with registry resolverImplemented flags');
  }
  for (const key of HSP_PILOT_SUGGESTION_KEYS) {
    if (!implementedSuggestion.includes(key)) {
      throw new Error(`HSP pilot suggestion key missing resolver flag: ${key}`);
    }
  }
}

assertPilotKeysMatchRegistry();

export function hspFieldRegistryEntry(businessKey: string): HspFieldRegistryEntry | undefined {
  return HSP_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

export function hspTierManifestFromRegistry(): {
  autoPrefill: string[];
  suggestion: string[];
  manual: string[];
} {
  return {
    autoPrefill: [...HSP_AUTO_PREFILL_KEYS],
    suggestion: [...HSP_SUGGESTION_KEYS],
    manual: [...HSP_MANUAL_KEYS],
  };
}

/** Ensures registry covers every hsp_* field in the approved template seed. */
export function assertHspRegistryMatchesTemplate(): void {
  const templateKeys = HOME_SUPPORT_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = HSP_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `HSP registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `HSP registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
