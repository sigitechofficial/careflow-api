import {
  INFECTION_FIELD_REGISTRY,
  INFECTION_MANUAL_KEYS,
  INFECTION_SUGGESTION_KEYS,
  infectionFieldRegistryEntry,
  assertInfectionRegistryMatchesTemplate,
} from './infection-care-plan-field-registry';
import { INFECTION_CARE_PLAN_SEED } from '../../../prisma/seeds/infection-care-plan.seed-data';
import { runCarePlanCompose } from './compose-context.loader';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

function seedFieldKeys(): string[] {
  return INFECTION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

describe('Infection registry (documentation-only, all manual)', () => {
  it('marks every one of the eleven fields MANUAL, with a recorded reason', () => {
    expect(INFECTION_FIELD_REGISTRY).toHaveLength(11);
    expect(INFECTION_SUGGESTION_KEYS).toHaveLength(0);
    expect(INFECTION_MANUAL_KEYS).toHaveLength(11);
    for (const entry of INFECTION_FIELD_REGISTRY) {
      expect(entry.mode).toBe('MANUAL');
      expect(entry.notes.trim().length).toBeGreaterThan(0);
    }
  });

  it('records why the tempting-but-wrong IA candidates were rejected', () => {
    expect(infectionFieldRegistryEntry('infection_hand_hygiene_cleaning')?.notes).toMatch(/personal hygiene/i);
    expect(infectionFieldRegistryEntry('infection_isolation_precautions')?.notes).toMatch(/isolated/i);
    expect(infectionFieldRegistryEntry('infection_active_infection')?.notes).toMatch(/wound|INFECTION_CONTROL/i);
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertInfectionRegistryMatchesTemplate()).not.toThrow();
    expect(INFECTION_MANUAL_KEYS.slice().sort()).toEqual(seedFieldKeys().slice().sort());
  });
});

describe('Infection has no compose/suggestion engine', () => {
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

  it('falls through to the default empty compose — no values, no suggestions, no infection mapping', () => {
    const result = runCarePlanCompose('Infection', ctx, fields);
    expect(result.values).toEqual({});
    expect(result.suggestions ?? []).toHaveLength(0);
    expect((result.composedFrom as Record<string, unknown> | undefined)?.mapping).not.toBe(
      'infection-care-plan-suggestions',
    );
  });
});
