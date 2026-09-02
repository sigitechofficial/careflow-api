import { applyWashingDressingCarePlanSchema } from '../../prisma/seeds/washing-dressing-care-plan-schema.util';
import {
  WASHING_DRESSING_ASSISTANCE_OPTIONS,
  WASHING_DRESSING_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  WASHING_DRESSING_CARE_PLAN_SEED,
  WASHING_DRESSING_TIME_OF_DAY_OPTIONS,
  WASHING_DRESSING_WASH_TYPE_OPTIONS,
} from '../../prisma/seeds/washing-dressing-care-plan.seed-data';
import { areaRiskFollowUpFieldKeys } from '../../prisma/seeds/area-risk-follow-up.seed';
import { WASHING_DRESSING_CARE_PLAN_PRE_MERGE_SNAPSHOT } from '../../prisma/seeds/washing-dressing-care-plan.pre-merge.snapshot';
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
import { COMMUNICATION_CARE_PLAN_SEED } from '../../prisma/seeds/communication-care-plan.seed-data';
import { CONTINENCE_CARE_PLAN_SEED } from '../../prisma/seeds/continence-care-plan.seed-data';
import { PSYCHOLOGICAL_CARE_PLAN_SEED } from '../../prisma/seeds/psychological-care-plan.seed-data';
import { PRESSURE_ULCER_CARE_PLAN_SEED } from '../../prisma/seeds/pressure-ulcer-care-plan.seed-data';
import { SLEEPING_NIGHT_CARE_PLAN_SEED } from '../../prisma/seeds/sleeping-night-care-plan.seed-data';
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
  conditionalLogicJson?: unknown;
  sortOrder: number;
  isActive: boolean;
  deletedAt: Date | null;
};

const VERSION_ID = 'c7431261-5b31-41e6-86c4-d4dbbf754028';

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

function legacyState(): { sections: Section[]; fields: Field[] } {
  const preferences: Section = {
    id: '5cd1aa8f-c45d-4ed9-bc6a-b1dd056090b8',
    formVersionId: VERSION_ID,
    title: 'Preferences',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const dressing: Section = {
    id: '6422655b-288c-4612-b872-51d02841fb0f',
    formVersionId: VERSION_ID,
    title: 'Dressing and grooming',
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
    conditionalLogicJson: null,
  });

  return {
    sections: [preferences, dressing],
    fields: [
      field(
        '69b3887c-8e84-432e-b516-70cda508292a',
        preferences.id,
        'Preferred wash type',
        'SELECT',
        0,
        false,
        { options: [...WASHING_DRESSING_WASH_TYPE_OPTIONS] },
      ),
      field(
        '406d7a82-688d-4181-a292-9c55995ffa9d',
        preferences.id,
        'Preferred time of day',
        'SELECT',
        1,
        false,
        { options: [...WASHING_DRESSING_TIME_OF_DAY_OPTIONS] },
      ),
      field(
        '2e8cbd94-2e61-40ce-ab41-efeaf5a13996',
        preferences.id,
        'Gender of carer preferred',
        'TEXT',
        2,
      ),
      field(
        'cd17337a-5d16-4c1b-a0fd-2964ea8fd3d8',
        dressing.id,
        'Level of assistance required',
        'SELECT',
        0,
        false,
        { options: [...WASHING_DRESSING_ASSISTANCE_OPTIONS] },
      ),
      field(
        '2ee1c811-07b4-47b2-8edc-1fd15f6592bb',
        dressing.id,
        'Clothing preferences',
        'TEXTAREA',
        1,
      ),
      field(
        '23114523-2782-47eb-b6ba-a7da5e0c87c2',
        dressing.id,
        'Dental / denture care',
        'TEXTAREA',
        2,
        true,
      ),
    ],
  };
}

function seedFieldKeys(): string[] {
  return WASHING_DRESSING_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of WASHING_DRESSING_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

describe('Washing and dressing Care Plan pre-merge snapshot', () => {
  it('matches the six live labels, types, required flags and options', () => {
    const snapshotFields = WASHING_DRESSING_CARE_PLAN_PRE_MERGE_SNAPSHOT.sections.flatMap((s) => s.fields);
    expect(snapshotFields.map((f) => f.label)).toEqual([
      'Preferred wash type',
      'Preferred time of day',
      'Gender of carer preferred',
      'Level of assistance required',
      'Clothing preferences',
      'Dental / denture care',
    ]);
    expect(snapshotFields.map((f) => f.fieldType)).toEqual([
      'SELECT',
      'SELECT',
      'TEXT',
      'SELECT',
      'TEXTAREA',
      'TEXTAREA',
    ]);
    expect(snapshotFields.find((f) => f.label === 'Dental / denture care')?.required).toBe(true);
    expect(snapshotFields.find((f) => f.label === 'Preferred wash type')?.options).toEqual([
      ...WASHING_DRESSING_WASH_TYPE_OPTIONS,
    ]);
    expect(WASHING_DRESSING_CARE_PLAN_PRE_MERGE_SNAPSHOT.sections.map((s) => s.title)).toEqual([
      'Preferences',
      'Dressing and grooming',
    ]);
  });
});

describe('Washing and dressing Care Plan template', () => {
  it('retains all six original local fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(WASHING_DRESSING_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(WASHING_DRESSING_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(6);
  });

  it('keeps the original field types, required flags and SELECT options', () => {
    expect(seedField('washing_dressing_preferred_wash_type')?.fieldType).toBe('SELECT');
    expect(seedField('washing_dressing_preferred_wash_type')?.options).toEqual([
      ...WASHING_DRESSING_WASH_TYPE_OPTIONS,
    ]);
    expect(seedField('washing_dressing_preferred_time_of_day')?.fieldType).toBe('SELECT');
    expect(seedField('washing_dressing_preferred_time_of_day')?.options).toEqual([
      ...WASHING_DRESSING_TIME_OF_DAY_OPTIONS,
    ]);
    expect(seedField('washing_dressing_gender_of_carer')?.fieldType).toBe('TEXT');
    expect(seedField('washing_dressing_assistance_level')?.fieldType).toBe('SELECT');
    expect(seedField('washing_dressing_assistance_level')?.options).toEqual([
      ...WASHING_DRESSING_ASSISTANCE_OPTIONS,
    ]);
    expect(seedField('washing_dressing_clothing_preferences')?.fieldType).toBe('TEXTAREA');
    expect(seedField('washing_dressing_dental_denture_care')?.fieldType).toBe('TEXTAREA');
    expect(seedField('washing_dressing_dental_denture_care')?.required).toBe(true);
  });

  it('reuses the two original section titles and adds the Care 2020 section', () => {
    expect(WASHING_DRESSING_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Preferences',
      'Dressing and grooming',
      'Needs, goals, support and risk',
    ]);
  });

  it('adds the five Care 2020 fields with exactly one required Person-centred details', () => {
    const care2020 = WASHING_DRESSING_CARE_PLAN_SEED.sections[2].fields.map((f) => f.fieldKey);
    expect(care2020).toEqual([
      'washing_dressing_service_user_needs',
      'washing_dressing_needs_person_centred',
      'washing_dressing_desired_goals_outcomes',
      'washing_dressing_support_required',
      'washing_dressing_area_risk',
      'washing_dressing_risk_identify',
      'washing_dressing_risk_who_might_be_harmed',
      'washing_dressing_risk_level',
      'washing_dressing_risk_likelihood',
      'washing_dressing_risk_triggers',
      'washing_dressing_risk_management',
    ]);
    expect(seedField('washing_dressing_area_risk')?.fieldType).toBe('YES_NO');
    expect(seedField('washing_dressing_needs_person_centred')?.required).toBe(true);
    const pcdLabels = WASHING_DRESSING_CARE_PLAN_SEED.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.label === 'Person-centred details');
    expect(pcdLabels).toHaveLength(1);
    expect(pcdLabels[0].fieldKey).toBe('washing_dressing_needs_person_centred');
  });

  it('does not add privacy, capability, HCP checklist, policy or optional-prompt fields', () => {
    const labels = WASHING_DRESSING_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.label));
    expect(labels.filter((l) => l === 'Person-centred details')).toHaveLength(1);
    expect(labels.some((l) => /privacy|double-?up|capability|view policy|dependency|optional prompt|bedrail/i.test(l))).toBe(
      false,
    );
  });

  it('contains no duplicate field keys and totals eleven', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(17);
  });

  it('gives every field a washing_dressing_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('washing_dressing_')).toBe(true);
    }
  });
});

describe('applyWashingDressingCarePlanSchema', () => {
  it('adopts the six pre-merge fields (UUIDs preserved) instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applyWashingDressingCarePlanSchema(prisma, VERSION_ID);
    expect(stats.adopted).toBe(6);
    for (const [label, key] of Object.entries(WASHING_DRESSING_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('preserves existing field types, required flags, options and ordering after apply', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await applyWashingDressingCarePlanSchema(prisma, VERSION_ID);

    const washType = state.fields.find((f) => f.id === '69b3887c-8e84-432e-b516-70cda508292a')!;
    expect(washType.fieldKey).toBe('washing_dressing_preferred_wash_type');
    expect(washType.fieldType).toBe('SELECT');
    expect(washType.optionsJson).toEqual({ options: [...WASHING_DRESSING_WASH_TYPE_OPTIONS] });
    expect(washType.sortOrder).toBe(0);

    const dental = state.fields.find((f) => f.id === '23114523-2782-47eb-b6ba-a7da5e0c87c2')!;
    expect(dental.required).toBe(true);
    expect(dental.sortOrder).toBe(2);
  });

  it('reuses the two original section UUIDs and adds the Care 2020 section', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await applyWashingDressingCarePlanSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'Preferences')?.id).toBe(
      '5cd1aa8f-c45d-4ed9-bc6a-b1dd056090b8',
    );
    expect(state.sections.find((s) => s.title === 'Dressing and grooming')?.id).toBe(
      '6422655b-288c-4612-b872-51d02841fb0f',
    );
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(3);
    expect(state.sections.some((s) => s.title === 'Needs, goals, support and risk')).toBe(true);
  });

  it('keeps published instance sectionId:fieldId answers resolvable after migration', async () => {
    const state = legacyState();
    const publishedAnswers: Record<string, string> = {
      '5cd1aa8f-c45d-4ed9-bc6a-b1dd056090b8:69b3887c-8e84-432e-b516-70cda508292a': 'Shower',
      '6422655b-288c-4612-b872-51d02841fb0f:23114523-2782-47eb-b6ba-a7da5e0c87c2': 'Upper denture overnight',
    };
    const prisma = makeFakePrisma(state.sections, state.fields);
    await applyWashingDressingCarePlanSchema(prisma, VERSION_ID);

    for (const key of Object.keys(publishedAnswers)) {
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
    const stats = await applyWashingDressingCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('creates each field exactly once, ending with eleven unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await applyWashingDressingCarePlanSchema(prisma, VERSION_ID);
    const activeKeys = state.fields.filter((f) => f.isActive).map((f) => f.fieldKey);
    expect(new Set(activeKeys).size).toBe(activeKeys.length);
    expect(activeKeys).toHaveLength(17);
    for (const key of seedFieldKeys()) {
      expect(activeKeys).toContain(key);
    }
  });

  it('stamps is_true showWhen on the six follow-ups without changing existing field UUIDs', async () => {
    const state = legacyState();
    const originalIds = state.fields.map((f) => f.id).sort();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await applyWashingDressingCarePlanSchema(prisma, VERSION_ID);

    for (const id of originalIds) {
      expect(state.fields.some((f) => f.id === id && f.isActive)).toBe(true);
    }

    const gate = state.fields.find((f) => f.fieldKey === 'washing_dressing_area_risk')!;
    expect(gate.id).toBeDefined();
    for (const key of areaRiskFollowUpFieldKeys('washing_dressing')) {
      const followUp = state.fields.find((f) => f.fieldKey === key)!;
      expect(followUp.id.startsWith('field-new-')).toBe(true);
      expect(originalIds).not.toContain(followUp.id);
      expect(followUp.conditionalLogicJson).toEqual({
        showWhen: [{ sectionId: gate.sectionId, fieldId: gate.id, operator: 'is_true' }],
      });
    }
  });

  it('is idempotent — a second run changes nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await applyWashingDressingCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();
    const second = await applyWashingDressingCarePlanSchema(prisma, VERSION_ID);
    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a washing_dressing_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await expect(
      applyWashingDressingCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);
    await expect(
      applyWashingDressingCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          {
            title: 'X',
            fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'pressure_ulcer_oops' } as never],
          },
        ],
      }),
    ).rejects.toThrow(/must start with washing_dressing_/);
  });
});

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
    expect(COMMUNICATION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(18);
    expect(CONTINENCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
    expect(PSYCHOLOGICAL_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
    expect(PRESSURE_ULCER_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
    expect(SLEEPING_NIGHT_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
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
      ...COMMUNICATION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...CONTINENCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...PSYCHOLOGICAL_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...PRESSURE_ULCER_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...SLEEPING_NIGHT_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
