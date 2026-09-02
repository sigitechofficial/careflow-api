import { applyPressureUlcerCarePlanSchema } from '../../prisma/seeds/pressure-ulcer-care-plan-schema.util';
import {
  PRESSURE_ULCER_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  PRESSURE_ULCER_CARE_PLAN_SEED,
  PRESSURE_ULCER_WATERLOW_OPTIONS,
} from '../../prisma/seeds/pressure-ulcer-care-plan.seed-data';
import { PRESSURE_ULCER_CARE_PLAN_PRE_MERGE_SNAPSHOT } from '../../prisma/seeds/pressure-ulcer-care-plan.pre-merge.snapshot';
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

const VERSION_ID = 'pressure-ulcer-version-1';

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

/** The Pressure Ulcer plan exactly as it exists before the Care 2020 merge (keyless). */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const risk: Section = {
    id: 'section-risk-and-skin',
    formVersionId: VERSION_ID,
    title: 'Risk and skin',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const prevention: Section = {
    id: 'section-prevention-plan',
    formVersionId: VERSION_ID,
    title: 'Prevention plan',
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
    sections: [risk, prevention],
    fields: [
      field('field-waterlow', risk.id, 'Waterlow or risk score', 'SELECT', 0, false, {
        options: ['Low', 'At risk', 'High', 'Very high'],
      }),
      field('field-wounds', risk.id, 'Existing pressure areas or wounds', 'TEXTAREA', 1),
      field('field-inspection', risk.id, 'Skin inspection frequency', 'TEXT', 2),
      field('field-repositioning', prevention.id, 'Repositioning schedule', 'TEXTAREA', 0, true),
      field('field-equipment', prevention.id, 'Pressure relieving equipment', 'TEXTAREA', 1),
      field('field-nutrition', prevention.id, 'Nutrition linked to skin healing', 'TEXT', 2),
    ],
  };
}

function seedFieldKeys(): string[] {
  return PRESSURE_ULCER_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of PRESSURE_ULCER_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

describe('Pressure Ulcer Care Plan pre-merge snapshot', () => {
  it('matches the six live labels, types, required flags and Waterlow options', () => {
    const snapshotFields = PRESSURE_ULCER_CARE_PLAN_PRE_MERGE_SNAPSHOT.sections.flatMap((s) => s.fields);
    expect(snapshotFields.map((f) => f.label)).toEqual([
      'Waterlow or risk score',
      'Existing pressure areas or wounds',
      'Skin inspection frequency',
      'Repositioning schedule',
      'Pressure relieving equipment',
      'Nutrition linked to skin healing',
    ]);
    expect(snapshotFields.map((f) => f.fieldType)).toEqual([
      'SELECT',
      'TEXTAREA',
      'TEXT',
      'TEXTAREA',
      'TEXTAREA',
      'TEXT',
    ]);
    expect(snapshotFields.find((f) => f.label === 'Repositioning schedule')?.required).toBe(true);
    expect(snapshotFields.find((f) => f.label === 'Waterlow or risk score')?.options).toEqual([
      ...PRESSURE_ULCER_WATERLOW_OPTIONS,
    ]);
    expect(PRESSURE_ULCER_CARE_PLAN_PRE_MERGE_SNAPSHOT.sections.map((s) => s.title)).toEqual([
      'Risk and skin',
      'Prevention plan',
    ]);
  });
});

describe('Pressure Ulcer Care Plan template', () => {
  it('retains all six original local fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(PRESSURE_ULCER_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(PRESSURE_ULCER_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(6);
  });

  it('keeps the original field types, required flags and Waterlow options', () => {
    expect(seedField('pressure_ulcer_waterlow_risk_score')?.fieldType).toBe('SELECT');
    expect(seedField('pressure_ulcer_waterlow_risk_score')?.options).toEqual([
      'Low',
      'At risk',
      'High',
      'Very high',
    ]);
    expect(seedField('pressure_ulcer_existing_areas_wounds')?.fieldType).toBe('TEXTAREA');
    expect(seedField('pressure_ulcer_skin_inspection_frequency')?.fieldType).toBe('TEXT');
    expect(seedField('pressure_ulcer_repositioning_schedule')?.fieldType).toBe('TEXTAREA');
    expect(seedField('pressure_ulcer_repositioning_schedule')?.required).toBe(true);
    expect(seedField('pressure_ulcer_relieving_equipment')?.fieldType).toBe('TEXTAREA');
    expect(seedField('pressure_ulcer_nutrition_skin_healing')?.fieldType).toBe('TEXT');
  });

  it('reuses the two original section titles and adds the Care 2020 section', () => {
    expect(PRESSURE_ULCER_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Risk and skin',
      'Prevention plan',
      'Needs, goals, support and risk',
    ]);
  });

  it('adds the five Care 2020 fields in order with exactly one Person-centred details', () => {
    const care2020 = PRESSURE_ULCER_CARE_PLAN_SEED.sections[2].fields.map((f) => f.fieldKey);
    expect(care2020).toEqual([
      'pressure_ulcer_service_user_needs',
      'pressure_ulcer_needs_person_centred',
      'pressure_ulcer_desired_goals_outcomes',
      'pressure_ulcer_support_required',
      'pressure_ulcer_area_risk',
      'pressure_ulcer_risk_identify',
      'pressure_ulcer_risk_who_might_be_harmed',
      'pressure_ulcer_risk_level',
      'pressure_ulcer_risk_likelihood',
      'pressure_ulcer_risk_triggers',
      'pressure_ulcer_risk_management',
    ]);
    expect(seedField('pressure_ulcer_area_risk')?.fieldType).toBe('YES_NO');
    expect(seedField('pressure_ulcer_needs_person_centred')?.required).toBe(true);
    const pcdLabels = PRESSURE_ULCER_CARE_PLAN_SEED.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.label === 'Person-centred details');
    expect(pcdLabels).toHaveLength(1);
    expect(pcdLabels[0].fieldKey).toBe('pressure_ulcer_needs_person_centred');
  });

  it('contains no duplicate field keys and totals eleven', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(17);
  });

  it('gives every field a pressure_ulcer_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('pressure_ulcer_')).toBe(true);
    }
  });

  it('does not add wound-assessment, dependency-guide, policy or optional-prompt fields', () => {
    const labels = PRESSURE_ULCER_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.label));
    expect(labels.some((l) => /wound assessment/i.test(l))).toBe(false);
    expect(labels.some((l) => /dependency/i.test(l))).toBe(false);
    expect(labels.some((l) => /view policy/i.test(l))).toBe(false);
    expect(labels.some((l) => /optional prompt/i.test(l))).toBe(false);
  });
});

describe('applyPressureUlcerCarePlanSchema', () => {
  it('adopts the six pre-merge fields (UUIDs preserved) instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyPressureUlcerCarePlanSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(6);
    for (const [label, key] of Object.entries(PRESSURE_ULCER_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('preserves existing field types, required flags, options and ordering after apply', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPressureUlcerCarePlanSchema(prisma, VERSION_ID);

    const waterlow = state.fields.find((f) => f.id === 'field-waterlow')!;
    expect(waterlow.fieldKey).toBe('pressure_ulcer_waterlow_risk_score');
    expect(waterlow.fieldType).toBe('SELECT');
    expect(waterlow.optionsJson).toEqual({ options: ['Low', 'At risk', 'High', 'Very high'] });
    expect(waterlow.sortOrder).toBe(0);

    const repositioning = state.fields.find((f) => f.id === 'field-repositioning')!;
    expect(repositioning.required).toBe(true);
    expect(repositioning.sortOrder).toBe(0);
  });

  it('reuses the two original section UUIDs and adds the Care 2020 section', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPressureUlcerCarePlanSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'Risk and skin')?.id).toBe('section-risk-and-skin');
    expect(state.sections.find((s) => s.title === 'Prevention plan')?.id).toBe('section-prevention-plan');
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(3);
    expect(state.sections.some((s) => s.title === 'Needs, goals, support and risk')).toBe(true);
  });

  it('keeps published instance sectionId:fieldId answers resolvable after migration', async () => {
    const state = legacyState();
    const publishedAnswers: Record<string, string> = {
      'section-risk-and-skin:field-waterlow': 'High',
      'section-risk-and-skin:field-wounds': 'Sacral grade 2',
      'section-prevention-plan:field-repositioning': '2-hourly',
    };
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPressureUlcerCarePlanSchema(prisma, VERSION_ID);

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

  it('never touches saved-value stores (only section/field/version accessors are used)', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await expect(applyPressureUlcerCarePlanSchema(prisma, VERSION_ID)).resolves.toBeDefined();
  });

  it('deactivates nothing on a clean legacy form', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applyPressureUlcerCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('creates each field exactly once, ending with eleven unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPressureUlcerCarePlanSchema(prisma, VERSION_ID);

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

    await applyPressureUlcerCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applyPressureUlcerCarePlanSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a pressure_ulcer_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyPressureUlcerCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applyPressureUlcerCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          {
            title: 'X',
            fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'skin_integrity_oops' } as never],
          },
        ],
      }),
    ).rejects.toThrow(/must start with pressure_ulcer_/);
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
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
