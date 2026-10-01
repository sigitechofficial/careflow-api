import { ADVANCE_CARE_PLAN_SEED } from '../../../prisma/seeds/advance-care-plan.seed-data';

/** How an Advance Care Plan field participates in compose. Mirrors the Home Care Plan contract. */
export type AcpFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type AcpFieldSourceKind = 'INITIAL_ASSESSMENT' | 'MANUAL';

export type AcpFieldSourceRef = {
  kind: AcpFieldSourceKind;
  /** IA questions addressed by stable key. */
  iaFieldKeys?: readonly string[];
  /** IA questions addressed by spec reference when they carry no fieldKey. */
  iaSpecRefs?: readonly string[];
  notes?: string;
};

export type AcpFieldRegistryEntry = {
  businessKey: string;
  mode: AcpFieldMappingMode;
  source: AcpFieldSourceKind;
  sources: readonly AcpFieldSourceRef[];
  resolverImplemented?: boolean;
};

/**
 * Approved mapping for every Advance Care Plan field.
 *
 * The IA audit found exactly one field with a genuinely equivalent, defensible source.
 * Everything else stays MANUAL with the reason recorded, so the decision is reviewable
 * rather than implicit. Advance care planning is a distinct clinical conversation that
 * the Initial Assessment does not otherwise cover — it holds no end-of-life questions.
 */
export const ACP_FIELD_REGISTRY: readonly AcpFieldRegistryEntry[] = [
  // ---------- Planning discussion ----------
  {
    businessKey: 'acp_discussion_date',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA assessmentDate records a different event. An advance care planning discussion may happen weeks later, or not at all; prefilling would assert a discussion that may not have occurred.',
      },
    ],
  },
  {
    businessKey: 'acp_people_present',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA §2.7 and §14.6 record who was involved in the assessment and its sign-off, not who attended the advance care planning discussion.',
      },
    ],
  },
  {
    businessKey: 'acp_capacity_to_participate',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Capacity is decision-specific under the Mental Capacity Act 2005. Capacity to consent to an assessment does not establish capacity to make advance care planning decisions, so IA §2.4 and the MCA screening outcome must not be carried across.',
      },
    ],
  },

  // ---------- Needs, goals and support ----------
  {
    businessKey: 'acp_service_user_needs',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Scoped to advance care planning. IA needs questions (supportOther, staffCommunicationInstructions) describe general care needs — wrong scope.',
      },
    ],
  },
  {
    businessKey: 'acp_desired_goals_outcomes',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA supportGoals describes general support goals, not advance-care-specific goals. Mapping on wording similarity alone was explicitly ruled out.',
      },
    ],
  },
  {
    businessKey: 'acp_support_required',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes: 'IA howAndWhenToSupportMe is general day-to-day support — wrong scope.',
      },
    ],
  },

  // ---------- Preferences and decisions ----------
  {
    businessKey: 'acp_treatment_escalation',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'No IA source: the assessment holds no questions on treatment escalation or ceiling of treatment.',
      },
    ],
  },
  {
    businessKey: 'acp_dnacpr_in_place',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA §13.6 conflates DNACPR and ReSPECT — different documents with different legal standing — and is a point-in-time snapshot. Left manual pending a decision on sourcing from the service user legal documents record.',
      },
    ],
  },
  {
    // The one approved IA mapping on this form.
    businessKey: 'acp_adrt_details',
    mode: 'SUGGESTION',
    source: 'INITIAL_ASSESSMENT',
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaSpecRefs: ['13.6'],
        notes:
          'IA §13.6 "ReSPECT / DNACPR location and summary" records the same information — where the document is held and what it says. The IA question carries no fieldKey, so it is addressed by specRef plus question text. Note the IA question covers DNACPR/ReSPECT only, while this field also covers an advance decision to refuse treatment under MCA ss.24-26, so a suggestion populates part of the field, not all of it.',
      },
    ],
    resolverImplemented: true,
  },
  {
    businessKey: 'acp_preferred_place_of_care',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'No IA source. IA §13.9 "Preferred hospital" is where to send someone in an emergency, not the preferred place of care when deteriorating.',
      },
    ],
  },
  {
    businessKey: 'acp_summary_of_wishes',
    mode: 'MANUAL',
    source: 'MANUAL',
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA whatMattersMost captures general life preferences. This field is read by clinicians as end-of-life wishes; carrying day-to-day preferences into it would be misleading in a document consulted during deterioration.',
      },
    ],
  },
];

export type AcpFieldBusinessKey = (typeof ACP_FIELD_REGISTRY)[number]['businessKey'];

export const ACP_AUTO_PREFILL_KEYS = ACP_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const ACP_SUGGESTION_KEYS = ACP_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const ACP_MANUAL_KEYS = ACP_FIELD_REGISTRY.filter((entry) => entry.mode === 'MANUAL').map(
  (entry) => entry.businessKey,
);

export function acpFieldRegistryEntry(businessKey: string): AcpFieldRegistryEntry | undefined {
  return ACP_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

export function acpTierManifestFromRegistry(): {
  autoPrefill: string[];
  suggestion: string[];
  manual: string[];
} {
  return {
    autoPrefill: [...ACP_AUTO_PREFILL_KEYS],
    suggestion: [...ACP_SUGGESTION_KEYS],
    manual: [...ACP_MANUAL_KEYS],
  };
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertAcpRegistryMatchesTemplate(): void {
  const templateKeys = ADVANCE_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = ACP_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `ACP registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `ACP registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
