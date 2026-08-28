import {
  HOME_CARE_NEEDS_GOALS_SUPPORT_FIELD_REGISTRY,
  HOME_CARE_MANUAL_KEYS,
  HOME_CARE_SUGGESTION_KEYS,
  HOME_CARE_AUTO_PREFILL_KEYS,
  homeCareFieldRegistryEntry,
  assertHomeCareRegistryMatchesTemplate,
} from './home-care-needs-goals-support-field-registry';
import { HOME_CARE_NEEDS_GOALS_SUPPORT_SEED } from '../../../prisma/seeds/home-care-needs-goals-support.seed-data';
import { runCarePlanCompose } from './compose-context.loader';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

function seedFieldKeys(): string[] {
  return HOME_CARE_NEEDS_GOALS_SUPPORT_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

describe('Home Care needs/goals/support registry (documentation-only, all manual)', () => {
  it('marks every one of the nine fields MANUAL, with a recorded reason', () => {
    expect(HOME_CARE_NEEDS_GOALS_SUPPORT_FIELD_REGISTRY).toHaveLength(9);
    expect(HOME_CARE_SUGGESTION_KEYS).toHaveLength(0);
    expect(HOME_CARE_AUTO_PREFILL_KEYS).toHaveLength(0);
    expect(HOME_CARE_MANUAL_KEYS).toHaveLength(9);
    for (const entry of HOME_CARE_NEEDS_GOALS_SUPPORT_FIELD_REGISTRY) {
      expect(entry.mode).toBe('MANUAL');
      expect(entry.notes.trim().length).toBeGreaterThan(0);
    }
  });

  it('has exactly one required PCD and no goals/support PCD', () => {
    const pcd = HOME_CARE_NEEDS_GOALS_SUPPORT_SEED.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.label === 'Person-centred details');
    expect(pcd).toHaveLength(1);
    expect(pcd[0].fieldKey).toBe('home_care_needs_person_centred');
    expect(pcd[0].required).toBe(true);
    const keys = seedFieldKeys();
    expect(keys).not.toContain('home_care_goals_person_centred');
    expect(keys).not.toContain('home_care_support_person_centred');
  });

  it('documents the risk gate and PCD', () => {
    expect(homeCareFieldRegistryEntry('home_care_area_risk')?.mode).toBe('MANUAL');
    expect(homeCareFieldRegistryEntry('home_care_needs_person_centred')?.notes).toMatch(/person-centred/i);
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertHomeCareRegistryMatchesTemplate()).not.toThrow();
    expect(HOME_CARE_MANUAL_KEYS.slice().sort()).toEqual(seedFieldKeys().slice().sort());
  });
});

describe('Home Care needs/goals/support has no compose engine (distinct from the large Home Care Plan)', () => {
  const ctx = {
    serviceUserId: 'su-1',
    ia: { submissionId: 'sub-1', status: 'REVIEWED', submittedAt: '2026-08-01T00:00:00.000Z', answers: [] },
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

  it('falls through to the default empty compose — no values, no suggestions', () => {
    const result = runCarePlanCompose('Home Care Plan - needs/goals/support', ctx, fields);
    expect(result.values).toEqual({});
    expect(result.suggestions ?? []).toHaveLength(0);
    // Must NOT be routed to the large Home Care Plan hybrid engine.
    expect((result.composedFrom as Record<string, unknown> | undefined)?.mapping).not.toBe('home-care-plan');
  });
});
