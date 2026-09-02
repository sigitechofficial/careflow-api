import { PSYCHOLOGICAL_CARE_PLAN_SEED } from '../../../prisma/seeds/psychological-care-plan.seed-data';
import { areaRiskFollowUpManualEntriesWithSource } from '../../../prisma/seeds/area-risk-follow-up.seed';

/** How a Psychological field participates in compose. Mirrors the Pain/Culture contract. */
export type PsychFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type PsychFieldSourceKind = 'INITIAL_ASSESSMENT' | 'MANUAL';

export type PsychFieldSourceRef = {
  kind: PsychFieldSourceKind;
  iaFieldKeys?: readonly string[];
  iaSpecRefs?: readonly string[];
  notes?: string;
};

export type PsychFieldRegistryEntry = {
  businessKey: string;
  mode: PsychFieldMappingMode;
  source: PsychFieldSourceKind;
  sources: readonly PsychFieldSourceRef[];
  resolverImplemented?: boolean;
};

/**
 * Approved mapping for every Psychological field.
 *
 * The IA audit approved exactly ONE genuine, live, defensible suggestion:
 * "Involvement of CMHT or counsellor" ← IA §10.1 "CPN name and contact" (Community
 * Psychiatric Nurse = the community mental-health clinician). Everything else is MANUAL.
 * Nothing auto-prefills — the single mapping is a SUGGESTION for staff to review.
 *
 * Rejected candidates (wording-adjacent but NOT genuine, documented so the decision is
 * reviewable):
 *   - Current mood (typical) SELECT ← §10.2 emotionalWellbeing SELECT: option sets are
 *     incompatible (mood = Stable/Low/Anxious/Variable/Elevated; emotionalWellbeing =
 *     "Feels content/sad … of the time"). No safe value to suggest into the SELECT.
 *   - Mental health diagnosis ← §10.1 "Current mental health details" / "Emotional health
 *     comments": these are narrative status, not a formal diagnosis. Wrong scope.
 *   - Triggers for distress / Coping strategies / When to contact crisis team: no IA source
 *     (§10.5 "GP referral for mental health" is a referral flag, not crisis-contact guidance).
 */
export const PSYCH_FIELD_REGISTRY: readonly PsychFieldRegistryEntry[] = [
  // ---------- Wellbeing (existing) ----------
  {
    businessKey: 'psychological_current_mood',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA §10.2 emotionalWellbeing is a SELECT with incompatible options ("Feels content/sad … of the time") — no safe mapping to the Stable/Low/Anxious/Variable/Elevated SELECT.',
      },
    ],
  },
  {
    businessKey: 'psychological_mh_diagnosis',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA §10.1 "Current mental health details" / "Emotional health comments" are narrative status, not a formal diagnosis. Wrong scope — not mapped.',
      },
    ],
  },
  {
    businessKey: 'psychological_distress_triggers',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      { kind: 'MANUAL', notes: 'No IA question records triggers for distress in the mental-health section.' },
    ],
  },

  // ---------- Support (existing) ----------
  {
    businessKey: 'psychological_coping_strategies',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'No IA source; carer-authored coping strategies.' }],
  },
  {
    // The one approved IA suggestion on this form.
    businessKey: 'psychological_cmht_counsellor',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['10.1'],
        notes:
          'IA §10.1 "CPN name and contact" records the community mental-health professional involved (Community Psychiatric Nurse). Gated on §10.1 "Community Psychiatric Nurse involved?"; surfaced as a suggestion only when a name/contact is recorded.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'psychological_crisis_contact',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'No pain/crisis-contact source. §10.5 "GP referral for mental health" is a referral flag, not crisis-contact guidance.',
      },
    ],
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'psychological_service_user_needs',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      { kind: 'MANUAL', notes: 'Generic needs field; the IA holds no psychological-specific needs question.' },
    ],
  },
  {
    businessKey: 'psychological_needs_person_centred',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [{ kind: 'MANUAL', notes: 'Free-text person-centred narrative for the needs question.' }],
  },
  {
    businessKey: 'psychological_desired_goals_outcomes',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      { kind: 'MANUAL', notes: 'The IA holds no psychological-specific goals; general goals must not be mapped.' },
    ],
  },
  {
    businessKey: 'psychological_support_required',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      { kind: 'MANUAL', notes: 'Generic Care 2020 support narrative; no psychological-specific IA source.' },
    ],
  },
  {
    businessKey: 'psychological_area_risk',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic "is there a risk associated with this area of care?" gate; must not be driven from a generic IA risk / low-mood-concern flag.',
      },
    ],
  },
  ...areaRiskFollowUpManualEntriesWithSource('psychological'),
];

export type PsychFieldBusinessKey = (typeof PSYCH_FIELD_REGISTRY)[number]['businessKey'];

export const PSYCH_AUTO_PREFILL_KEYS = PSYCH_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const PSYCH_SUGGESTION_KEYS = PSYCH_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const PSYCH_MANUAL_KEYS = PSYCH_FIELD_REGISTRY.filter((entry) => entry.mode === 'MANUAL').map(
  (entry) => entry.businessKey,
);

export function psychFieldRegistryEntry(businessKey: string): PsychFieldRegistryEntry | undefined {
  return PSYCH_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

export function psychTierManifestFromRegistry(): {
  autoPrefill: string[];
  suggestion: string[];
  manual: string[];
} {
  return {
    autoPrefill: [...PSYCH_AUTO_PREFILL_KEYS],
    suggestion: [...PSYCH_SUGGESTION_KEYS],
    manual: [...PSYCH_MANUAL_KEYS],
  };
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertPsychRegistryMatchesTemplate(): void {
  const templateKeys = PSYCHOLOGICAL_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = PSYCH_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Psychological registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Psychological registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
