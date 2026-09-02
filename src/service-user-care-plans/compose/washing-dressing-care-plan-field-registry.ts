import { WASHING_DRESSING_CARE_PLAN_SEED } from '../../../prisma/seeds/washing-dressing-care-plan.seed-data';
import { areaRiskFollowUpManualEntriesResolvedByEngine } from '../../../prisma/seeds/area-risk-follow-up.seed';

/**
 * Documentation-and-guard registry for the Washing and dressing Care Plan.
 *
 * The dedicated compose engine in `washing-dressing-care-plan.compose.ts` is the single
 * source of truth for AUTO-PREFILL. This registry records, per field, whether that engine
 * auto-prefills it and from where, or whether it is manual. It must never become a second
 * competing compose/mapping system.
 *
 * Forbidden mappings (enforced by omitting them from the engine):
 * - opposite-sex YES_NO → gender of carer
 * - §1.4 combined bathing/dressing textarea → wash-type SELECT or clothing
 * - preferredVisitTimes / HSP times → time-of-day SELECT
 * - ADL / HSP assistance / eating assistance → assistance SELECT
 * - HCP / HSP / Person Centred personal-care fields
 * - Waterlow, MUST, Skin Integrity, Pressure Ulcer, Dementia
 * - oral-health-concern / dental-referral → area risk
 * - Culture/Religion gender field (plan-to-plan); IA §1.6 is the source, not CRS
 */
export type WashingDressingFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type WashingDressingFieldSourceKind = 'INITIAL_ASSESSMENT' | 'MANUAL';

export type WashingDressingFieldSourceRef = {
  kind: WashingDressingFieldSourceKind;
  iaFieldKeys?: readonly string[];
  iaSpecRefs?: readonly string[];
  notes?: string;
};

export type WashingDressingFieldRegistryEntry = {
  businessKey: string;
  mode: WashingDressingFieldMappingMode;
  resolvedByEngine: boolean;
  sources: readonly WashingDressingFieldSourceRef[];
};

export const WASHING_DRESSING_FIELD_REGISTRY: readonly WashingDressingFieldRegistryEntry[] = [
  {
    businessKey: 'washing_dressing_preferred_wash_type',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        iaSpecRefs: ['1.4'],
        notes:
          'IA §1.4 is a combined bathing/dressing narrative, not a wash-type SELECT. Must not be mapped.',
      },
    ],
  },
  {
    businessKey: 'washing_dressing_preferred_time_of_day',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        iaFieldKeys: ['preferredVisitTimes'],
        notes:
          'preferredVisitTimes and HSP visit times are visit scheduling, not Morning/Afternoon/Evening wash preference.',
      },
    ],
  },
  {
    businessKey: 'washing_dressing_gender_of_carer',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['1.6'],
        notes:
          'IA §1.6 "Staff gender preference for personal care" (Male / Female / No preference / Case by case). The SELECT value is mapped to its label and written into this TEXT field. Culture/Religion suggests the same IA fact separately; do not copy that plan\'s field.',
      },
    ],
  },
  {
    businessKey: 'washing_dressing_assistance_level',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'ADL / HSP personal-care assistance and eating assistance are not equivalent to Independent / Supervision / Full assistance for washing and dressing.',
      },
    ],
  },
  {
    businessKey: 'washing_dressing_clothing_preferences',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        iaSpecRefs: ['1.4'],
        notes: 'IA §1.4 combined bathing/dressing narrative must not be dumped into clothing preferences.',
      },
    ],
  },
  {
    businessKey: 'washing_dressing_dental_denture_care',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'No single IA dental/denture narrative. Mixed continence / oral-care notes must not be dumped here.',
      },
    ],
  },
  {
    businessKey: 'washing_dressing_service_user_needs',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'Generic Care 2020 needs field; HCP/HSP/Person Centred personal-care fields are separate products.',
      },
    ],
  },
  {
    businessKey: 'washing_dressing_needs_person_centred',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [{ kind: 'MANUAL', notes: 'Free-text person-centred narrative for the needs question.' }],
  },
  {
    businessKey: 'washing_dressing_desired_goals_outcomes',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'The IA holds no washing/dressing-specific goals; general support goals must not be mapped.',
      },
    ],
  },
  {
    businessKey: 'washing_dressing_support_required',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      { kind: 'MANUAL', notes: 'Generic Care 2020 support narrative; no washing/dressing-specific IA source.' },
    ],
  },
  {
    businessKey: 'washing_dressing_area_risk',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic area-risk gate. Must not be driven from oral-health-concern, dental-referral, Waterlow, MUST, or Skin Integrity.',
      },
    ],
  },
  ...areaRiskFollowUpManualEntriesResolvedByEngine('washing_dressing'),
];

export type WashingDressingFieldBusinessKey =
  (typeof WASHING_DRESSING_FIELD_REGISTRY)[number]['businessKey'];

export const WASHING_DRESSING_AUTO_PREFILL_KEYS = WASHING_DRESSING_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const WASHING_DRESSING_SUGGESTION_KEYS = WASHING_DRESSING_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const WASHING_DRESSING_MANUAL_KEYS = WASHING_DRESSING_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function washingDressingFieldRegistryEntry(
  businessKey: string,
): WashingDressingFieldRegistryEntry | undefined {
  return WASHING_DRESSING_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

export function assertWashingDressingRegistryMatchesTemplate(): void {
  const templateKeys = WASHING_DRESSING_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = WASHING_DRESSING_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Washing and dressing registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Washing and dressing registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
