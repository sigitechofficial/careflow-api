import { COMMUNICATION_CARE_PLAN_SEED } from '../../../prisma/seeds/communication-care-plan.seed-data';

/**
 * Documentation-and-guard registry for the Communication Care Plan.
 *
 * Communication already has a mature AUTO-PREFILL compose engine in
 * `remaining-area-care-plans.compose.ts` (`COMMUNICATION_CARE_PLAN_FIELD_MAPPINGS` +
 * `composeCommunicationCarePlan`), matching the seven existing fields by label and drawing on
 * the Initial Assessment plus the IA communication snapshot. That engine remains the single
 * source of truth and is intentionally retained unchanged — this registry does NOT re-resolve
 * anything and must never become a second competing Communication compose/mapping system.
 *
 * Its job is to (a) record, per field, whether the engine auto-prefills it and from where, or
 * whether it is manual, and (b) guard that the registry and the seed template stay in
 * lockstep. The Care 2020 needs / goals / support / risk block is MANUAL: the IA holds no
 * communication-specific needs / goals / support narrative, and the generic risk gate is the
 * assessor's decision.
 */
export type CommunicationFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type CommunicationFieldSourceKind =
  | 'INITIAL_ASSESSMENT'
  | 'COMMUNICATION_SNAPSHOT'
  | 'MANUAL';

export type CommunicationFieldSourceRef = {
  kind: CommunicationFieldSourceKind;
  iaFieldKeys?: readonly string[];
  notes?: string;
};

export type CommunicationFieldRegistryEntry = {
  businessKey: string;
  mode: CommunicationFieldMappingMode;
  /** True when the existing Communication engine auto-prefills this field. */
  resolvedByEngine: boolean;
  sources: readonly CommunicationFieldSourceRef[];
};

export const COMMUNICATION_FIELD_REGISTRY: readonly CommunicationFieldRegistryEntry[] = [
  // ---------- Communication needs (existing — auto-prefilled by the engine, by label) ----------
  {
    businessKey: 'communication_preferred_language',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        notes: 'IA "preferred language" / "first language" text / snapshot.preferredLanguage.',
      },
    ],
  },
  {
    businessKey: 'communication_hearing_impairment',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['hearingLevel'],
        notes: 'IA hearing level mapped to an impairment yes/no / snapshot.hearingImpairment.',
      },
    ],
  },
  {
    businessKey: 'communication_vision_impairment',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['sightLevel'],
        notes: 'IA sight level mapped to an impairment yes/no / snapshot.visionImpairment.',
      },
    ],
  },
  {
    businessKey: 'communication_primary_method',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      { kind: 'COMMUNICATION_SNAPSHOT', notes: 'snapshot.communicationMethod (SELECT option).' },
    ],
  },

  // ---------- Guidance for staff (existing) ----------
  {
    businessKey: 'communication_approach',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        iaFieldKeys: ['communicationNeeds'],
        notes:
          'IA communicationNeeds / "communication support notes" text / snapshot.staffGuidance.',
      },
    ],
  },
  {
    businessKey: 'communication_glasses_hearing_aids',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        notes: 'IA "hearing aid" / "glasses" text / snapshot.aids.',
      },
    ],
  },
  {
    businessKey: 'communication_consent_share',
    mode: 'AUTO_PREFILL',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'INITIAL_ASSESSMENT',
        notes: 'IA "consent to share" / "share information" (boolean) / snapshot.consentSharing.',
      },
    ],
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'communication_service_user_needs',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic Care 2020 needs field; the IA holds no communication-specific needs question.',
      },
    ],
  },
  {
    businessKey: 'communication_needs_person_centred',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      { kind: 'MANUAL', notes: 'Required free-text person-centred narrative for the needs question.' },
    ],
  },
  {
    businessKey: 'communication_desired_goals_outcomes',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      { kind: 'MANUAL', notes: 'The IA holds no communication-specific goals; must not be mapped.' },
    ],
  },
  {
    businessKey: 'communication_support_required',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'Generic Care 2020 support narrative; no communication-specific IA source.',
      },
    ],
  },
  {
    businessKey: 'communication_area_risk',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic "is there a risk associated with this area of care?" gate; the assessor owns this decision.',
      },
    ],
  },
];

export type CommunicationFieldBusinessKey =
  (typeof COMMUNICATION_FIELD_REGISTRY)[number]['businessKey'];

export const COMMUNICATION_AUTO_PREFILL_KEYS = COMMUNICATION_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const COMMUNICATION_SUGGESTION_KEYS = COMMUNICATION_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const COMMUNICATION_MANUAL_KEYS = COMMUNICATION_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function communicationFieldRegistryEntry(
  businessKey: string,
): CommunicationFieldRegistryEntry | undefined {
  return COMMUNICATION_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertCommunicationRegistryMatchesTemplate(): void {
  const templateKeys = COMMUNICATION_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = COMMUNICATION_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Communication registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Communication registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
