import { MOBILITY_CARE_PLAN_SEED } from '../../../prisma/seeds/mobility-care-plan.seed-data';

/**
 * Documentation-only registry for the Mobility Care Plan.
 *
 * The audit found no genuinely equivalent, defensible Mobility-specific IA or structured
 * source for any field, so every field is MANUAL and there is deliberately no Mobility
 * compose/dispatch — a compose would only ever return an empty result. This registry
 * exists purely to record, for consistency with the other care plans, that every field is
 * manual and WHY the tempting-but-wrong sources were rejected, and to guard that the
 * registry and the seed stay in lockstep.
 *
 * It resolves nothing and must never become an IA mapping engine.
 *
 * Notable rejected candidates (all in IA §12 — the only place mobility content lives):
 *   - §12.5c "Transfer comments" / transferSupportRequired — genuinely transfer content,
 *     but there is no Mobility engine and it overlaps the Falls engine's transfer mapping;
 *     per approval this stays MANUAL rather than reusing Falls-adjacent sources.
 *   - §12.10 "Further equipment details" — equipment to *order*, not "equipment issued".
 *   - §12.8 / §12.5a hoist/sling/clinical-equipment booleans — specific, not the SELECT or
 *     the free-text "equipment issued" field.
 *   - §12.7 falls questions — Falls, not Mobility (deliberately excluded).
 * No structured mobility / moving-&-handling / equipment / transfer / physio-OT model exists.
 */
export type MobilityFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type MobilityFieldRegistryEntry = {
  businessKey: string;
  mode: MobilityFieldMappingMode;
  /** For manual fields, why there is no genuine IA/structured source (incl. rejected candidates). */
  notes: string;
};

export const MOBILITY_FIELD_REGISTRY: readonly MobilityFieldRegistryEntry[] = [
  // ---------- Mobility status (existing) ----------
  {
    businessKey: 'mobility_indoor_mobility',
    mode: 'MANUAL',
    notes:
      'No IA indoor-mobility-level question. §12.5a "Restricted to bed?" is a single boolean, not the 5-option SELECT (Independent/Stick/Frame/Wheelchair/Bed bound).',
  },
  {
    businessKey: 'mobility_outdoor_mobility',
    mode: 'MANUAL',
    notes: 'No IA outdoor-mobility question exists.',
  },
  {
    businessKey: 'mobility_equipment_issued',
    mode: 'MANUAL',
    notes:
      'No equivalent source. §12.10 "Further equipment details" is equipment to order (not issued); §12.8/§12.5a are specific hoist/clinical-equipment booleans; both also overlap the Falls engine. Kept MANUAL per approval.',
  },

  // ---------- Transfers (existing) ----------
  {
    businessKey: 'mobility_transfer_method',
    mode: 'MANUAL',
    notes:
      'IA §12.5c "Transfer comments" / transferSupportRequired is genuinely transfer content, but there is no Mobility engine and it overlaps the Falls transfer mapping; kept MANUAL per approval (schema-only, no compose).',
  },
  {
    businessKey: 'mobility_number_of_carers',
    mode: 'MANUAL',
    notes:
      'No IA carer-count source. §12.5c transfer-support is a boolean, not a 1/2 count.',
  },
  {
    businessKey: 'mobility_physio_ot_recommendations',
    mode: 'MANUAL',
    notes: 'No physiotherapy / OT question exists anywhere in the IA catalogue.',
  },

  // ---------- Needs, goals, support and risk (Care 2020) ----------
  {
    businessKey: 'mobility_manual_handling_assessment',
    mode: 'MANUAL',
    notes: 'Workflow toggle (whether to perform an assessment); not clinical data, no IA source.',
  },
  {
    businessKey: 'mobility_service_user_needs',
    mode: 'MANUAL',
    notes: 'Generic needs field; the IA holds no mobility-specific needs question.',
  },
  {
    businessKey: 'mobility_needs_person_centred',
    mode: 'MANUAL',
    notes: 'Free-text person-centred narrative for the needs question.',
  },
  {
    businessKey: 'mobility_desired_goals_outcomes',
    mode: 'MANUAL',
    notes: 'The IA holds no mobility-specific goals; general support goals must not be mapped.',
  },
  {
    businessKey: 'mobility_support_required',
    mode: 'MANUAL',
    notes: 'Generic support narrative; no mobility-specific IA source.',
  },
  {
    businessKey: 'mobility_emergency_procedure',
    mode: 'MANUAL',
    notes:
      'No mobility-specific emergency-procedure source. §13.5 no-response/emergency is a safeguarding-scope question, not this field.',
  },
  {
    businessKey: 'mobility_area_risk',
    mode: 'MANUAL',
    notes:
      'Generic "is there a risk associated with this area of care?" gate; must not be driven from a generic IA risk flag.',
  },
];

export type MobilityFieldBusinessKey = (typeof MOBILITY_FIELD_REGISTRY)[number]['businessKey'];

export const MOBILITY_SUGGESTION_KEYS = MOBILITY_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const MOBILITY_MANUAL_KEYS = MOBILITY_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function mobilityFieldRegistryEntry(
  businessKey: string,
): MobilityFieldRegistryEntry | undefined {
  return MOBILITY_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

/** Guard: the registry and the seed template must describe exactly the same fields. */
export function assertMobilityRegistryMatchesTemplate(): void {
  const templateKeys = MOBILITY_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = MOBILITY_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Mobility registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Mobility registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
