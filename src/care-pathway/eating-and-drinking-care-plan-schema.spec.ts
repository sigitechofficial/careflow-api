import { applyEatingAndDrinkingCarePlanSchema } from '../../prisma/seeds/eating-and-drinking-care-plan-schema.util';
import {
  EATING_AND_DRINKING_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  EATING_AND_DRINKING_CARE_PLAN_SEED,
} from '../../prisma/seeds/eating-and-drinking-care-plan.seed-data';
import { HOME_CARE_PLAN_SEED } from '../../prisma/seeds/home-care-plan.seed-data';
import { HOME_SUPPORT_PLAN_SEED } from '../../prisma/seeds/home-support-plan.seed-data';
import { ADVANCE_CARE_PLAN_SEED } from '../../prisma/seeds/advance-care-plan.seed-data';
import { COGNITION_BEHAVIOUR_CARE_PLAN_SEED } from '../../prisma/seeds/cognition-behaviour-care-plan.seed-data';
import { CULTURE_RELIGION_CARE_PLAN_SEED } from '../../prisma/seeds/culture-religion-care-plan.seed-data';
import { FALLS_CARE_PLAN_SEED } from '../../prisma/seeds/falls-care-plan.seed-data';
import { FINAL_DAYS_CARE_PLAN_SEED } from '../../prisma/seeds/final-days-care-plan.seed-data';
import { INFECTION_CARE_PLAN_SEED } from '../../prisma/seeds/infection-care-plan.seed-data';
import { MEDICATION_CARE_PLAN_SEED } from '../../prisma/seeds/medication-care-plan.seed-data';
import { MOBILITY_CARE_PLAN_SEED } from '../../prisma/seeds/mobility-care-plan.seed-data';
import { PAIN_MANAGEMENT_CARE_PLAN_SEED } from '../../prisma/seeds/pain-management-care-plan.seed-data';
import { SKIN_INTEGRITY_CARE_PLAN_SEED } from '../../prisma/seeds/skin-integrity-care-plan.seed-data';
import { PSYCHOLOGICAL_CARE_PLAN_SEED } from '../../prisma/seeds/psychological-care-plan.seed-data';
import { COMMUNICATION_CARE_PLAN_SEED } from '../../prisma/seeds/communication-care-plan.seed-data';
import { CONTINENCE_CARE_PLAN_SEED } from '../../prisma/seeds/continence-care-plan.seed-data';
import type { PrismaClient } from '@prisma/client';

type Section = {
  id: string;
  formVersionId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  deletedAt: Date | null;
};

type Field = {
  id: string;
  sectionId: string;
  fieldKey: string | null;
  label: string;
  fieldType: string;
  placeholder: string | null;
  helpText: string | null;
  required: boolean;
  optionsJson: unknown;
  sortOrder: number;
  isActive: boolean;
  deletedAt: Date | null;
};

const VERSION_ID = 'eating-drinking-version-1';

function makeFakePrisma(sections: Section[], fields: Field[]) {
  let seq = 0;
  const nextId = (prefix: string) => {
    seq += 1;
    return `${prefix}-new-${seq}`;
  };

  const liveSections = () => sections.filter((s) => s.deletedAt === null);
  const sectionIdsForVersion = () =>
    new Set(liveSections().filter((s) => s.formVersionId === VERSION_ID).map((s) => s.id));

  const matchesKeyFilter = (field: Field, or?: Array<Record<string, unknown>>) => {
    if (!or) return true;
    return or.some((clause) => {
      if ('fieldKey' in clause && clause.fieldKey === null) return field.fieldKey === null;
      const notIn = (clause.fieldKey as { notIn?: string[] } | undefined)?.notIn;
      if (notIn) return field.fieldKey !== null && !notIn.includes(field.fieldKey);
      return false;
    });
  };

  return {
    carePathwayFormSection: {
      findMany: async () => liveSections().sort((a, b) => a.sortOrder - b.sortOrder),
      create: async ({ data }: { data: Partial<Section> }) => {
        const row: Section = {
          id: nextId('section'),
          formVersionId: data.formVersionId as string,
          title: data.title as string,
          description: data.description ?? null,
          sortOrder: data.sortOrder as number,
          deletedAt: null,
        };
        sections.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Section> }) => {
        const row = sections.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    carePathwayFormField: {
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
        const ids = sectionIdsForVersion();
        return fields.filter((f) => {
          if (!ids.has(f.sectionId) || f.deletedAt !== null) return false;
          if (where?.fieldKey === null && f.fieldKey !== null) return false;
          if (where?.isActive === true && !f.isActive) return false;
          if (!matchesKeyFilter(f, where?.OR as Array<Record<string, unknown>> | undefined)) {
            return false;
          }
          return true;
        });
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const ids = sectionIdsForVersion();
        return (
          fields.find(
            (f) => ids.has(f.sectionId) && f.deletedAt === null && f.fieldKey === where.fieldKey,
          ) ?? null
        );
      },
      create: async ({ data }: { data: Partial<Field> }) => {
        const row = { id: nextId('field'), deletedAt: null, ...data } as Field;
        fields.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Field> }) => {
        const row = fields.find((f) => f.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    carePathwayFormVersion: { update: async () => ({}) },
  } as unknown as PrismaClient;
}

/** The Eating and Drinking plan exactly as it exists before the Care 2020 merge (keyless). */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const diet: Section = {
    id: 'section-diet-fluids',
    formVersionId: VERSION_ID,
    title: 'Diet and fluids',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const support: Section = {
    id: 'section-mealtimes',
    formVersionId: VERSION_ID,
    title: 'Support at mealtimes',
    description: null,
    sortOrder: 1,
    deletedAt: null,
  };

  const field = (
    id: string,
    sectionId: string,
    label: string,
    fieldType: string,
    sortOrder: number,
    required = false,
    optionsJson: unknown = null,
  ): Field => ({
    id,
    sectionId,
    fieldKey: null,
    label,
    fieldType,
    placeholder: null,
    helpText: null,
    required,
    optionsJson,
    sortOrder,
    isActive: true,
    deletedAt: null,
  });

  return {
    sections: [diet, support],
    fields: [
      field('field-diet', diet.id, 'Diet type', 'SELECT', 0, false, {
        options: ['Normal', 'Soft', 'Pureed', 'Diabetic', 'Fortified', 'Other'],
      }),
      field('field-fluid', diet.id, 'Fluid target per day (ml)', 'NUMBER', 1),
      field('field-allergies', diet.id, 'Food allergies or intolerances', 'TEXTAREA', 2),
      field('field-assist', support.id, 'Level of assistance', 'SELECT', 0, false, {
        options: ['Independent', 'Setup only', 'Supervision', 'Full assistance'],
      }),
      field('field-choking', support.id, 'Choking risk / SALT recommendations', 'TEXTAREA', 1),
      field('field-preferred', support.id, 'Preferred foods and dislikes', 'TEXTAREA', 2, true),
    ],
  };
}

function seedFieldKeys(): string[] {
  return EATING_AND_DRINKING_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of EATING_AND_DRINKING_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Template contents
// --------------------------------------------------------------------------

describe('Eating and Drinking Care Plan template', () => {
  it('retains all six original local fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(EATING_AND_DRINKING_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(EATING_AND_DRINKING_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(6);
  });

  it('keeps the original field types, required flags and SELECT options/order', () => {
    expect(seedField('eating_and_drinking_diet_type')?.fieldType).toBe('SELECT');
    expect(seedField('eating_and_drinking_diet_type')?.options).toEqual([
      'Normal',
      'Soft',
      'Pureed',
      'Diabetic',
      'Fortified',
      'Other',
    ]);
    expect(seedField('eating_and_drinking_fluid_target')?.fieldType).toBe('NUMBER');
    expect(seedField('eating_and_drinking_food_allergies')?.fieldType).toBe('TEXTAREA');
    expect(seedField('eating_and_drinking_level_of_assistance')?.fieldType).toBe('SELECT');
    expect(seedField('eating_and_drinking_level_of_assistance')?.options).toEqual([
      'Independent',
      'Setup only',
      'Supervision',
      'Full assistance',
    ]);
    expect(seedField('eating_and_drinking_choking_salt')?.fieldType).toBe('TEXTAREA');
    expect(seedField('eating_and_drinking_preferred_foods')?.fieldType).toBe('TEXTAREA');
    expect(seedField('eating_and_drinking_preferred_foods')?.required).toBe(true);
  });

  it('reuses the two original section titles and adds the Care 2020 section', () => {
    expect(EATING_AND_DRINKING_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Diet and fluids',
      'Support at mealtimes',
      'Needs, goals, support and risk',
    ]);
  });

  it('adds the five Care 2020 fields in order with exactly one required Person-centred details', () => {
    const care2020 = EATING_AND_DRINKING_CARE_PLAN_SEED.sections[2].fields;
    expect(care2020.map((f) => f.fieldKey)).toEqual([
      'eating_and_drinking_service_user_needs',
      'eating_and_drinking_needs_person_centred',
      'eating_and_drinking_desired_goals_outcomes',
      'eating_and_drinking_support_required',
      'eating_and_drinking_area_risk',
      'eating_and_drinking_risk_identify',
      'eating_and_drinking_risk_who_might_be_harmed',
      'eating_and_drinking_risk_level',
      'eating_and_drinking_risk_likelihood',
      'eating_and_drinking_risk_triggers',
      'eating_and_drinking_risk_management',
    ]);
    // Risk is YES_NO, the other four are TEXTAREA.
    expect(seedField('eating_and_drinking_area_risk')?.fieldType).toBe('YES_NO');
    for (const key of [
      'eating_and_drinking_service_user_needs',
      'eating_and_drinking_needs_person_centred',
      'eating_and_drinking_desired_goals_outcomes',
      'eating_and_drinking_support_required',
    ]) {
      expect(seedField(key)?.fieldType).toBe('TEXTAREA');
    }
    // Exactly one "Person-centred details" field across the whole template, and it is required.
    const pcd = EATING_AND_DRINKING_CARE_PLAN_SEED.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.label === 'Person-centred details');
    expect(pcd).toHaveLength(1);
    expect(pcd[0].fieldKey).toBe('eating_and_drinking_needs_person_centred');
    expect(pcd[0].required).toBe(true);
  });

  it('does NOT create goals/support person-centred duplicates or an emergency field', () => {
    const keys = seedFieldKeys();
    expect(keys).not.toContain('eating_and_drinking_goals_person_centred');
    expect(keys).not.toContain('eating_and_drinking_support_person_centred');
    expect(keys.some((k) => k.includes('emergency'))).toBe(false);
  });

  it('contains no duplicate field keys and totals eleven', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(17);
  });

  it('gives every field an eating_and_drinking_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('eating_and_drinking_')).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// ID preservation, order, saved-value safety and idempotency
// --------------------------------------------------------------------------

describe('applyEatingAndDrinkingCarePlanSchema', () => {
  it('adopts the six pre-merge fields (UUIDs preserved) instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyEatingAndDrinkingCarePlanSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(6);
    for (const [label, key] of Object.entries(EATING_AND_DRINKING_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('preserves existing field types, required flags and ordering after apply', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyEatingAndDrinkingCarePlanSchema(prisma, VERSION_ID);

    const fluid = state.fields.find((f) => f.id === 'field-fluid')!;
    expect(fluid.fieldKey).toBe('eating_and_drinking_fluid_target');
    expect(fluid.fieldType).toBe('NUMBER');
    expect(fluid.sortOrder).toBe(1);

    const preferred = state.fields.find((f) => f.id === 'field-preferred')!;
    expect(preferred.required).toBe(true);
    expect(preferred.sortOrder).toBe(2);
  });

  it('makes the Care 2020 Person-centred details field required', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyEatingAndDrinkingCarePlanSchema(prisma, VERSION_ID);

    const pcd = state.fields.find((f) => f.fieldKey === 'eating_and_drinking_needs_person_centred')!;
    expect(pcd.required).toBe(true);
    expect(pcd.isActive).toBe(true);
  });

  it('reuses the two original section UUIDs and adds the Care 2020 section', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyEatingAndDrinkingCarePlanSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'Diet and fluids')?.id).toBe('section-diet-fluids');
    expect(state.sections.find((s) => s.title === 'Support at mealtimes')?.id).toBe('section-mealtimes');
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(3);
    expect(state.sections.some((s) => s.title === 'Needs, goals, support and risk')).toBe(true);
  });

  it('keeps VALID saved sectionId:fieldId references valid (fields survive, sections survive)', async () => {
    const state = legacyState();
    const validKeys = ['section-diet-fluids:field-diet', 'section-mealtimes:field-preferred'];
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyEatingAndDrinkingCarePlanSchema(prisma, VERSION_ID);

    for (const key of validKeys) {
      const [sectionId, fieldId] = key.split(':');
      const section = state.sections.find((s) => s.id === sectionId);
      const field = state.fields.find((f) => f.id === fieldId);
      expect(section?.deletedAt).toBeNull();
      expect(field?.isActive).toBe(true);
      expect(field?.sectionId).toBe(sectionId);
      expect(field?.fieldKey).not.toBeNull();
    }
  });

  it('deactivates nothing on a clean legacy form', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applyEatingAndDrinkingCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('creates each field exactly once, ending with eleven unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyEatingAndDrinkingCarePlanSchema(prisma, VERSION_ID);

    const activeKeys = state.fields.filter((f) => f.isActive).map((f) => f.fieldKey);
    expect(new Set(activeKeys).size).toBe(activeKeys.length);
    expect(activeKeys).toHaveLength(17);
    for (const key of seedFieldKeys()) {
      expect(activeKeys).toContain(key);
    }
  });

  it('deactivates a stray legacy duplicate PCD not in the final seed (idempotently, never deleted)', async () => {
    const state = legacyState();
    state.fields.push({
      id: 'field-dup-pcd',
      sectionId: 'section-mealtimes',
      fieldKey: 'eating_and_drinking_goals_person_centred',
      label: 'Person-centred details',
      fieldType: 'TEXTAREA',
      placeholder: null,
      helpText: null,
      required: false,
      optionsJson: null,
      sortOrder: 9,
      isActive: true,
      deletedAt: null,
    });

    const prisma = makeFakePrisma(state.sections, state.fields);
    const first = await applyEatingAndDrinkingCarePlanSchema(prisma, VERSION_ID);
    const dup = state.fields.find((f) => f.id === 'field-dup-pcd')!;
    expect(first.deactivated).toBe(1);
    expect(dup.isActive).toBe(false);
    expect(dup.deletedAt).toBeNull(); // deactivated, never deleted — UUID + any saved value preserved

    const second = await applyEatingAndDrinkingCarePlanSchema(prisma, VERSION_ID);
    expect(second.deactivated).toBe(0);
    expect(state.fields.filter((f) => f.isActive && f.label === 'Person-centred details')).toHaveLength(1);
  });

  it('is idempotent — a second run changes nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyEatingAndDrinkingCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applyEatingAndDrinkingCarePlanSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without an eating_and_drinking_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyEatingAndDrinkingCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applyEatingAndDrinkingCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          { title: 'X', fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'pain_management_oops' } as never] },
        ],
      }),
    ).rejects.toThrow(/must start with eating_and_drinking_/);
  });
});

// --------------------------------------------------------------------------
// Other care plans must be unaffected
// --------------------------------------------------------------------------

describe('other care plans are unaffected', () => {
  it('keeps their field counts', () => {
    expect(HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(36);
    expect(HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(45);
    expect(ADVANCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(11);
    expect(COGNITION_BEHAVIOUR_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(18);
    expect(CULTURE_RELIGION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
    expect(FALLS_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(18);
    expect(FINAL_DAYS_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(18);
    expect(INFECTION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
    expect(MEDICATION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
    expect(MOBILITY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(19);
    expect(PAIN_MANAGEMENT_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(18);
    expect(SKIN_INTEGRITY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(16);
    expect(PSYCHOLOGICAL_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
    expect(COMMUNICATION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(18);
    expect(CONTINENCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
  });

  it('shares no field keys with any other plan', () => {
    const others = new Set([
      ...HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...ADVANCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...COGNITION_BEHAVIOUR_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...CULTURE_RELIGION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...FALLS_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...FINAL_DAYS_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...INFECTION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...MEDICATION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...MOBILITY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...PAIN_MANAGEMENT_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...SKIN_INTEGRITY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...PSYCHOLOGICAL_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...COMMUNICATION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...CONTINENCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
