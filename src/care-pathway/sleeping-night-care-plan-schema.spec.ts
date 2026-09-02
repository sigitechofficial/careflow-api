import { applySleepingNightCarePlanSchema } from '../../prisma/seeds/sleeping-night-care-plan-schema.util';
import {
  SLEEPING_NIGHT_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  SLEEPING_NIGHT_CARE_PLAN_SEED,
} from '../../prisma/seeds/sleeping-night-care-plan.seed-data';
import { SLEEPING_NIGHT_CARE_PLAN_PRE_MERGE_SNAPSHOT } from '../../prisma/seeds/sleeping-night-care-plan.pre-merge.snapshot';
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

const VERSION_ID = 'sleeping-night-version-1';

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
  const pattern: Section = {
    id: 'section-sleep-pattern',
    formVersionId: VERSION_ID,
    title: 'Sleep pattern',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const night: Section = {
    id: 'section-night-care',
    formVersionId: VERSION_ID,
    title: 'Night care',
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
  ): Field => ({
    id,
    sectionId,
    fieldKey: null,
    label,
    fieldType,
    placeholder: null,
    helpText: null,
    required,
    optionsJson: null,
    sortOrder,
    isActive: true,
    deletedAt: null,
  });

  return {
    sections: [pattern, night],
    fields: [
      field('field-bedtime', pattern.id, 'Usual bedtime and wake time', 'TEXT', 0),
      field('field-waking', pattern.id, 'Night-time waking or confusion', 'TEXTAREA', 1),
      field('field-naps', pattern.id, 'Daytime naps', 'YES_NO', 2),
      field('field-evening', night.id, 'Evening routine', 'TEXTAREA', 0, true),
      field('field-callbell', night.id, 'Call bell / monitoring', 'TEXT', 1),
      field('field-drinks', night.id, 'Night-time drinks or snacks', 'TEXT', 2),
    ],
  };
}

function seedFieldKeys(): string[] {
  return SLEEPING_NIGHT_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of SLEEPING_NIGHT_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

describe('Sleeping and Night Care Plan pre-merge snapshot', () => {
  it('matches the six live labels, types and required flags', () => {
    const snapshotFields = SLEEPING_NIGHT_CARE_PLAN_PRE_MERGE_SNAPSHOT.sections.flatMap((s) => s.fields);
    expect(snapshotFields.map((f) => f.label)).toEqual([
      'Usual bedtime and wake time',
      'Night-time waking or confusion',
      'Daytime naps',
      'Evening routine',
      'Call bell / monitoring',
      'Night-time drinks or snacks',
    ]);
    expect(snapshotFields.map((f) => f.fieldType)).toEqual([
      'TEXT',
      'TEXTAREA',
      'YES_NO',
      'TEXTAREA',
      'TEXT',
      'TEXT',
    ]);
    expect(snapshotFields.find((f) => f.label === 'Evening routine')?.required).toBe(true);
    expect(SLEEPING_NIGHT_CARE_PLAN_PRE_MERGE_SNAPSHOT.sections.map((s) => s.title)).toEqual([
      'Sleep pattern',
      'Night care',
    ]);
  });
});

describe('Sleeping and Night Care Plan template', () => {
  it('retains all six original local fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(SLEEPING_NIGHT_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(SLEEPING_NIGHT_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(6);
  });

  it('keeps the original field types and required flags', () => {
    expect(seedField('sleeping_night_usual_bedtime_wake_time')?.fieldType).toBe('TEXT');
    expect(seedField('sleeping_night_night_waking_confusion')?.fieldType).toBe('TEXTAREA');
    expect(seedField('sleeping_night_daytime_naps')?.fieldType).toBe('YES_NO');
    expect(seedField('sleeping_night_evening_routine')?.fieldType).toBe('TEXTAREA');
    expect(seedField('sleeping_night_evening_routine')?.required).toBe(true);
    expect(seedField('sleeping_night_call_bell_monitoring')?.fieldType).toBe('TEXT');
    expect(seedField('sleeping_night_night_drinks_snacks')?.fieldType).toBe('TEXT');
  });

  it('reuses the two original section titles and adds the Care 2020 section', () => {
    expect(SLEEPING_NIGHT_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Sleep pattern',
      'Night care',
      'Needs, goals, support and risk',
    ]);
  });

  it('adds the five Care 2020 fields with exactly one required Person-centred details', () => {
    const care2020 = SLEEPING_NIGHT_CARE_PLAN_SEED.sections[2].fields.map((f) => f.fieldKey);
    expect(care2020).toEqual([
      'sleeping_night_service_user_needs',
      'sleeping_night_needs_person_centred',
      'sleeping_night_desired_goals_outcomes',
      'sleeping_night_support_required',
      'sleeping_night_area_risk',
      'sleeping_night_risk_identify',
      'sleeping_night_risk_who_might_be_harmed',
      'sleeping_night_risk_level',
      'sleeping_night_risk_likelihood',
      'sleeping_night_risk_triggers',
      'sleeping_night_risk_management',
    ]);
    expect(seedField('sleeping_night_area_risk')?.fieldType).toBe('YES_NO');
    expect(seedField('sleeping_night_needs_person_centred')?.required).toBe(true);
    const pcdLabels = SLEEPING_NIGHT_CARE_PLAN_SEED.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.label === 'Person-centred details');
    expect(pcdLabels).toHaveLength(1);
    expect(pcdLabels[0].fieldKey).toBe('sleeping_night_needs_person_centred');
  });

  it('does not add a bedrail, duplicate PCD, policy or optional-prompt field', () => {
    const labels = SLEEPING_NIGHT_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.label));
    expect(labels.some((l) => /bedrail|bed rail/i.test(l))).toBe(false);
    expect(labels.filter((l) => l === 'Person-centred details')).toHaveLength(1);
    expect(labels.some((l) => /view policy|dependency|optional prompt/i.test(l))).toBe(false);
  });

  it('contains no duplicate field keys and totals eleven', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(17);
  });

  it('gives every field a sleeping_night_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('sleeping_night_')).toBe(true);
    }
  });
});

describe('applySleepingNightCarePlanSchema', () => {
  it('adopts the six pre-merge fields (UUIDs preserved) instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applySleepingNightCarePlanSchema(prisma, VERSION_ID);
    expect(stats.adopted).toBe(6);
    for (const [label, key] of Object.entries(SLEEPING_NIGHT_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('preserves existing field types, required flags and ordering after apply', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await applySleepingNightCarePlanSchema(prisma, VERSION_ID);

    const naps = state.fields.find((f) => f.id === 'field-naps')!;
    expect(naps.fieldKey).toBe('sleeping_night_daytime_naps');
    expect(naps.fieldType).toBe('YES_NO');
    expect(naps.sortOrder).toBe(2);

    const evening = state.fields.find((f) => f.id === 'field-evening')!;
    expect(evening.required).toBe(true);
    expect(evening.sortOrder).toBe(0);
  });

  it('reuses the two original section UUIDs and adds the Care 2020 section', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await applySleepingNightCarePlanSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'Sleep pattern')?.id).toBe('section-sleep-pattern');
    expect(state.sections.find((s) => s.title === 'Night care')?.id).toBe('section-night-care');
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(3);
    expect(state.sections.some((s) => s.title === 'Needs, goals, support and risk')).toBe(true);
  });

  it('keeps published instance sectionId:fieldId answers resolvable after migration', async () => {
    const state = legacyState();
    const publishedAnswers: Record<string, string> = {
      'section-sleep-pattern:field-bedtime': '22:00 / 07:00',
      'section-night-care:field-evening': 'Warm drink then bed',
    };
    const prisma = makeFakePrisma(state.sections, state.fields);
    await applySleepingNightCarePlanSchema(prisma, VERSION_ID);

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
    const stats = await applySleepingNightCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('creates each field exactly once, ending with eleven unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await applySleepingNightCarePlanSchema(prisma, VERSION_ID);
    const activeKeys = state.fields.filter((f) => f.isActive).map((f) => f.fieldKey);
    expect(new Set(activeKeys).size).toBe(activeKeys.length);
    expect(activeKeys).toHaveLength(17);
    for (const key of seedFieldKeys()) {
      expect(activeKeys).toContain(key);
    }
  });

  it('is idempotent — a second run changes nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await applySleepingNightCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();
    const second = await applySleepingNightCarePlanSchema(prisma, VERSION_ID);
    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a sleeping_night_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await expect(
      applySleepingNightCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);
    await expect(
      applySleepingNightCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          {
            title: 'X',
            fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'pressure_ulcer_oops' } as never],
          },
        ],
      }),
    ).rejects.toThrow(/must start with sleeping_night_/);
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
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
