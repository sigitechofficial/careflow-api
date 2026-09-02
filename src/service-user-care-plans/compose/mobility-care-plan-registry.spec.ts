import {
  MOBILITY_FIELD_REGISTRY,
  MOBILITY_MANUAL_KEYS,
  MOBILITY_SUGGESTION_KEYS,
  mobilityFieldRegistryEntry,
  assertMobilityRegistryMatchesTemplate,
} from './mobility-care-plan-field-registry';
import { MOBILITY_CARE_PLAN_SEED } from '../../../prisma/seeds/mobility-care-plan.seed-data';
import { runCarePlanCompose } from './compose-context.loader';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

function seedFieldKeys(): string[] {
  return MOBILITY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

describe('Mobility registry (Care 2020 narratives are suggestions)', () => {
  it('marks transfer/equipment fields MANUAL and Care 2020 narratives SUGGESTION', () => {
    expect(MOBILITY_FIELD_REGISTRY).toHaveLength(19);
    expect(MOBILITY_SUGGESTION_KEYS).toEqual([
      'mobility_service_user_needs',
      'mobility_needs_person_centred',
      'mobility_desired_goals_outcomes',
      'mobility_support_required',
    ]);
    expect(MOBILITY_MANUAL_KEYS).toHaveLength(15);
    for (const entry of MOBILITY_FIELD_REGISTRY) {
      expect(entry.notes.trim().length).toBeGreaterThan(0);
    }
  });

  it('records why the tempting-but-wrong IA candidates were rejected', () => {
    expect(mobilityFieldRegistryEntry('mobility_transfer_method')?.notes).toMatch(/12\.5c|falls/i);
    expect(mobilityFieldRegistryEntry('mobility_equipment_issued')?.notes).toMatch(/order|12\.10/i);
    expect(mobilityFieldRegistryEntry('mobility_physio_ot_recommendations')?.notes).toMatch(/physio|OT/i);
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertMobilityRegistryMatchesTemplate()).not.toThrow();
    expect(MOBILITY_FIELD_REGISTRY.map((e) => e.businessKey).slice().sort()).toEqual(
      seedFieldKeys().slice().sort(),
    );
  });
});

describe('Mobility has no compose/suggestion engine', () => {
  const ctx = {
    serviceUserId: 'su-1',
    ia: {
      submissionId: 'sub-1',
      status: 'REVIEWED',
      submittedAt: '2026-08-01T00:00:00.000Z',
      answers: [],
    },
  } as unknown as CarePlanComposeContext;

  const fields: CarePlanFormFieldRef[] = seedFieldKeys().map((fieldKey, i) => ({
    key: `sec:field-${i}`,
    sectionId: 'sec',
    fieldId: `field-${i}`,
    fieldKey,
    label: fieldKey,
    fieldType: 'TEXTAREA',
    required: false,
  })) as CarePlanFormFieldRef[];

  it('falls through to the default empty compose — no values, no suggestions, no mobility mapping', () => {
    const result = runCarePlanCompose('Mobility', ctx, fields);
    expect(result.values).toEqual({});
    expect(result.suggestions ?? []).toHaveLength(0);
    expect((result.composedFrom as Record<string, unknown> | undefined)?.mapping).not.toBe(
      'mobility-care-plan-suggestions',
    );
  });
});
