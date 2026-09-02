import { INFECTION_CARE_PLAN_SEED } from '../../../prisma/seeds/infection-care-plan.seed-data';
import { areaRiskFollowUpManualEntriesNotesOnly } from '../../../prisma/seeds/area-risk-follow-up.seed';

/**
 * Documentation-only registry for the Infection Care Plan.
 *
 * The IA audit found NO genuinely equivalent Infection-specific source for any field, so
 * every field is MANUAL and there is deliberately no Infection compose/dispatch — a compose
 * would only ever return an empty result. This registry exists purely to record, for
 * consistency with the other care plans, that every field is manual and WHY the tempting-
 * but-wrong sources were rejected, and to guard that the registry and seed stay in lockstep.
 *
 * It resolves nothing and must never become an IA mapping engine.
 */
export type InfectionFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type InfectionFieldRegistryEntry = {
  businessKey: string;
  mode: InfectionFieldMappingMode;
  /** Notes: for manual fields, why there is no genuine IA source (incl. rejected candidates). */
  notes: string;
};

export const INFECTION_FIELD_REGISTRY: readonly InfectionFieldRegistryEntry[] = [
  // ---------- Current status (existing) ----------
  {
    businessKey: 'infection_active_infection',
    mode: 'MANUAL',
    notes:
      'No IA question records active infection / colonisation status. BodyMapWoundAssessment.infectionSigns is wound-specific, not an equivalent; InitialAssessmentRiskType.INFECTION_CONTROL has zero live records.',
  },
  {
    businessKey: 'infection_type_and_date',
    mode: 'MANUAL',
    notes: 'No IA source records the infection type and date identified.',
  },
  {
    businessKey: 'infection_isolation_precautions',
    mode: 'MANUAL',
    notes:
      'No IA source. The legacy "Isolated?" checkbox is unreliable (no specRef/fieldKey), semantically ambiguous (social isolation), and its boolean does not map to the None/Standard/Contact/Droplet/Airborne SELECT.',
  },

  // ---------- Prevention (existing) ----------
  {
    businessKey: 'infection_ppe_required',
    mode: 'MANUAL',
    notes: 'No IA question covers PPE required for visits.',
  },
  {
    businessKey: 'infection_hand_hygiene_cleaning',
    mode: 'MANUAL',
    notes:
      'IA §1.3e "Personal hygiene" is the service user’s own hygiene, not infection-control hand hygiene / cleaning for staff. Rejected as wrong scope (wording-only overlap).',
  },
  {
    businessKey: 'infection_when_to_escalate',
    mode: 'MANUAL',
    notes: 'No infection-specific escalation question exists in the IA.',
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'infection_service_user_needs',
    mode: 'MANUAL',
    notes: 'Generic needs field; the IA holds no infection-specific needs question.',
  },
  {
    businessKey: 'infection_needs_person_centred',
    mode: 'MANUAL',
    notes: 'Free-text person-centred narrative for the needs question.',
  },
  {
    businessKey: 'infection_desired_goals_outcomes',
    mode: 'MANUAL',
    notes: 'The IA holds no infection-specific goals; general support goals must not be mapped.',
  },
  {
    businessKey: 'infection_support_required',
    mode: 'MANUAL',
    notes: 'IA general day-to-day support is the wrong scope for infection-specific support.',
  },
  {
    businessKey: 'infection_area_risk',
    mode: 'MANUAL',
    notes:
      'Generic "is there a risk associated with this area of care?" gate; must not be driven from a generic IA risk flag or the (empty) INFECTION_CONTROL risk records.',
  },
  ...areaRiskFollowUpManualEntriesNotesOnly('infection'),
];

export type InfectionFieldBusinessKey = (typeof INFECTION_FIELD_REGISTRY)[number]['businessKey'];

export const INFECTION_SUGGESTION_KEYS = INFECTION_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const INFECTION_MANUAL_KEYS = INFECTION_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function infectionFieldRegistryEntry(
  businessKey: string,
): InfectionFieldRegistryEntry | undefined {
  return INFECTION_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertInfectionRegistryMatchesTemplate(): void {
  const templateKeys = INFECTION_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = INFECTION_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Infection registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Infection registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
