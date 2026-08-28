import {
  PHYSICAL_HEALTH_FIELD_REGISTRY,
  PHYSICAL_HEALTH_MANUAL_KEYS,
  PHYSICAL_HEALTH_SUGGESTION_KEYS,
  PHYSICAL_HEALTH_AUTO_PREFILL_KEYS,
  physicalHealthFieldRegistryEntry,
  assertPhysicalHealthRegistryMatchesTemplate,
} from './physical-health-care-plan-field-registry';
import { PHYSICAL_HEALTH_CARE_PLAN_SEED } from '../../../prisma/seeds/physical-health-care-plan.seed-data';
import { runCarePlanCompose } from './compose-context.loader';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

function seedFieldKeys(): string[] {
  return PHYSICAL_HEALTH_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

describe('Physical Health registry (documentation-only, all manual)', () => {
  it('marks every one of the eleven fields MANUAL, with a recorded reason', () => {
    expect(PHYSICAL_HEALTH_FIELD_REGISTRY).toHaveLength(11);
    expect(PHYSICAL_HEALTH_SUGGESTION_KEYS).toHaveLength(0);
    expect(PHYSICAL_HEALTH_AUTO_PREFILL_KEYS).toHaveLength(0);
    expect(PHYSICAL_HEALTH_MANUAL_KEYS).toHaveLength(11);
    for (const entry of PHYSICAL_HEALTH_FIELD_REGISTRY) {
      expect(entry.mode).toBe('MANUAL');
      expect(entry.notes.trim().length).toBeGreaterThan(0);
    }
  });

  it('records why the tempting-but-wrong structured sources were rejected', () => {
    expect(physicalHealthFieldRegistryEntry('physical_health_area_risk')?.notes).toMatch(/NEWS2|vital signs|blood-glucose|assessor/i);
    expect(physicalHealthFieldRegistryEntry('physical_health_service_user_needs')?.notes).toMatch(/diagnos/i);
    expect(physicalHealthFieldRegistryEntry('physical_health_vital_signs_news2')?.notes).toMatch(/NEWS2|observation/i);
  });

  it('has exactly one required PCD and no goals/support PCD', () => {
    const pcd = PHYSICAL_HEALTH_CARE_PLAN_SEED.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.label === 'Person-centred details');
    expect(pcd).toHaveLength(1);
    expect(pcd[0].fieldKey).toBe('physical_health_needs_person_centred');
    expect(pcd[0].required).toBe(true);
    const keys = seedFieldKeys();
    expect(keys).not.toContain('physical_health_goals_person_centred');
    expect(keys).not.toContain('physical_health_support_person_centred');
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertPhysicalHealthRegistryMatchesTemplate()).not.toThrow();
    expect(PHYSICAL_HEALTH_MANUAL_KEYS.slice().sort()).toEqual(seedFieldKeys().slice().sort());
  });
});

describe('Physical Health has no compose/suggestion engine', () => {
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

  it('falls through to the default empty compose — no values, no suggestions, no physical-health mapping', () => {
    const result = runCarePlanCompose('Physical Health', ctx, fields);
    expect(result.values).toEqual({});
    expect(result.suggestions ?? []).toHaveLength(0);
    expect((result.composedFrom as Record<string, unknown> | undefined)?.mapping).not.toBe(
      'physical-health-care-plan-suggestions',
    );
  });
});
