import { FINAL_DAYS_CARE_PLAN_SEED } from '../../../prisma/seeds/final-days-care-plan.seed-data';
import { areaRiskFollowUpManualEntriesWithSource } from '../../../prisma/seeds/area-risk-follow-up.seed';

/** How a Final Days field participates in compose. Mirrors the Advance/Culture contract. */
export type FinalDaysFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type FinalDaysFieldSourceKind = 'INITIAL_ASSESSMENT' | 'LEGAL_DOCUMENT' | 'MANUAL';

export type FinalDaysFieldSourceRef = {
  kind: FinalDaysFieldSourceKind;
  iaFieldKeys?: readonly string[];
  iaSpecRefs?: readonly string[];
  notes?: string;
};

export type FinalDaysFieldRegistryEntry = {
  businessKey: string;
  mode: FinalDaysFieldMappingMode;
  source: FinalDaysFieldSourceKind;
  sources: readonly FinalDaysFieldSourceRef[];
  resolverImplemented?: boolean;
};

/**
 * Approved mapping for every Final Days field.
 *
 * Four suggestions were approved in the audit; everything else stays MANUAL with the
 * reason recorded. Final Days is an end-of-life plan, so nothing auto-prefills — every
 * suggestion is surfaced for a clinician to review. The DNACPR/ADRT field draws on both
 * IA §13.6 and the maintained structured ServiceUserLegalDocument record.
 */
export const FINAL_DAYS_FIELD_REGISTRY: readonly FinalDaysFieldRegistryEntry[] = [
  // ---------- Comfort and symptoms ----------
  {
    businessKey: 'final_days_current_focus_of_care',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Clinical care-phase decision (Active treatment / Symptom control / End of life). No IA question captures the focus of care.',
      },
    ],
  },
  {
    businessKey: 'final_days_pain_management_plan',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['painManagementPlan'],
        iaSpecRefs: ['5.3'],
        notes:
          'IA §5.3 "What pain management plan in place" (painManagementPlan) is the same concept; §5.3 "Current pain relief" supplements it. Suggestion only — an end-of-life pain plan may differ, so staff review.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'final_days_mouth_care_frequency',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA §7.1 "Continence / oral care notes" is general oral hygiene, not an end-of-life mouth-care frequency. Wording-only overlap.',
      },
    ],
  },

  // ---------- People and wishes ----------
  {
    businessKey: 'final_days_family_contact_updates',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['1.2'],
        notes:
          'IA §1.2 "Family, representative, next of kin, advocate, key contacts" genuinely records the family/key contacts. The "updates" nuance (how/when to update during dying) is end-of-life specific and staff-authored, so this is a partial suggestion for staff to extend.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'final_days_spiritual_cultural_needs',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['1.7'],
        notes:
          'IA §1.7 "Religious or spiritual needs" + "Religion, culture, language, reasonable adjustments" cover this field’s spiritual and cultural scope. Suggestion only.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'final_days_preferred_place_of_death',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'No IA source. §13.9 "Preferred hospital" is an emergency destination, not the preferred place of death. Sensitive end-of-life field — left manual.',
      },
    ],
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'final_days_service_user_needs',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic needs field. The IA holds no end-of-life-specific "needs" question; general IA needs are the wrong scope.',
      },
    ],
  },
  {
    businessKey: 'final_days_needs_person_centred',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Free-text person-centred narrative for the needs question.' }],
  },
  {
    businessKey: 'final_days_desired_goals_outcomes',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes: 'The IA holds no end-of-life-specific goals; general support goals must not be mapped.',
      },
    ],
  },
  {
    businessKey: 'final_days_support_required',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes: 'IA general day-to-day support is the wrong scope for end-of-life-specific support.',
      },
    ],
  },
  {
    businessKey: 'final_days_area_risk',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic "is there a risk associated with this area of care?" gate. Must not be driven from a generic IA risk flag; the assessor owns this decision.',
      },
    ],
  },
  ...areaRiskFollowUpManualEntriesWithSource('final_days'),
  {
    businessKey: 'final_days_adrt_details',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['13.6'],
        notes:
          'IA §13.6 "ReSPECT / DNACPR location and summary" — where the document is held and what it says (same mapping as Advance acp_adrt_details).',
      },
      {
        kind: 'LEGAL_DOCUMENT',
        notes:
          'ServiceUserLegalDocument — the maintained structured DNACPR record (in place, physical location, start date). Combined with §13.6 into one suggestion for staff to review.',
      },
    ],
    resolverImplemented: true,
  },
];

export type FinalDaysFieldBusinessKey = (typeof FINAL_DAYS_FIELD_REGISTRY)[number]['businessKey'];

export const FINAL_DAYS_AUTO_PREFILL_KEYS = FINAL_DAYS_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const FINAL_DAYS_SUGGESTION_KEYS = FINAL_DAYS_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const FINAL_DAYS_MANUAL_KEYS = FINAL_DAYS_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function finalDaysFieldRegistryEntry(
  businessKey: string,
): FinalDaysFieldRegistryEntry | undefined {
  return FINAL_DAYS_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

export function finalDaysTierManifestFromRegistry(): {
  autoPrefill: string[];
  suggestion: string[];
  manual: string[];
} {
  return {
    autoPrefill: [...FINAL_DAYS_AUTO_PREFILL_KEYS],
    suggestion: [...FINAL_DAYS_SUGGESTION_KEYS],
    manual: [...FINAL_DAYS_MANUAL_KEYS],
  };
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertFinalDaysRegistryMatchesTemplate(): void {
  const templateKeys = FINAL_DAYS_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = FINAL_DAYS_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Final Days registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Final Days registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
