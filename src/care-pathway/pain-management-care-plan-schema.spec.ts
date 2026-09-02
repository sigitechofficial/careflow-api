import { applyPainManagementCarePlanSchema } from '../../prisma/seeds/pain-management-care-plan-schema.util';
import {
  PAIN_MANAGEMENT_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  PAIN_MANAGEMENT_CARE_PLAN_SEED,
} from '../../prisma/seeds/pain-management-care-plan.seed-data';
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

const VERSION_ID = 'pain-version-1';

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

/** The Pain Management plan exactly as it exists before the Care 2020 merge (keyless). */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const profile: Section = {
    id: 'section-pain-profile',
    formVersionId: VERSION_ID,
    title: 'Pain profile',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const management: Section = {
    id: 'section-management',
    formVersionId: VERSION_ID,
    title: 'Management',
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
    sections: [profile, management],
    fields: [
      field('field-score', profile.id, 'Usual pain score (0–10)', 'NUMBER', 0),
      field('field-site', profile.id, 'Site and character of pain', 'TEXTAREA', 1),
      field('field-worsens', profile.id, 'What worsens or relieves pain', 'TEXTAREA', 2),
      field('field-analgesia', management.id, 'Regular analgesia', 'TEXTAREA', 0),
      field('field-nonpharm', management.id, 'Non-pharmacological methods', 'TEXTAREA', 1, true),
      field('field-gp', management.id, 'When to call GP or out of hours', 'TEXTAREA', 2),
    ],
  };
}

function seedFieldKeys(): string[] {
  return PAIN_MANAGEMENT_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of PAIN_MANAGEMENT_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Template contents
// --------------------------------------------------------------------------

describe('Pain Management Care Plan template', () => {
  it('retains all six original local fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(PAIN_MANAGEMENT_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(PAIN_MANAGEMENT_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(6);
  });

  it('keeps the original field types and required flags', () => {
    expect(seedField('pain_management_usual_pain_score')?.fieldType).toBe('NUMBER');
    expect(seedField('pain_management_site_and_character')?.fieldType).toBe('TEXTAREA');
    expect(seedField('pain_management_worsens_relieves')?.fieldType).toBe('TEXTAREA');
    expect(seedField('pain_management_regular_analgesia')?.fieldType).toBe('TEXTAREA');
    expect(seedField('pain_management_non_pharmacological')?.required).toBe(true);
    expect(seedField('pain_management_when_to_call_gp')?.fieldType).toBe('TEXTAREA');
  });

  it('reuses the two original section titles and adds the Care 2020 section', () => {
    expect(PAIN_MANAGEMENT_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Pain profile',
      'Management',
      'Needs, goals, support and risk',
    ]);
  });

  it('adds the six Care 2020 fields with NRS toggle first and area risk last', () => {
    const care2020 = PAIN_MANAGEMENT_CARE_PLAN_SEED.sections[2].fields.map((f) => f.fieldKey);
    expect(care2020[0]).toBe('pain_management_nrs_needed');
    expect(care2020).toContain('pain_management_area_risk');
    expect(care2020[care2020.length - 1]).toBe('pain_management_risk_management');
    expect(care2020).toHaveLength(12);
    expect(seedField('pain_management_nrs_needed')?.fieldType).toBe('YES_NO');
    expect(seedField('pain_management_area_risk')?.fieldType).toBe('YES_NO');
  });

  it('contains no duplicate field keys and totals twelve', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(18);
  });

  it('gives every field a pain_management_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('pain_management_')).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// ID preservation, order, and idempotency
// --------------------------------------------------------------------------

describe('applyPainManagementCarePlanSchema', () => {
  it('adopts the six pre-merge fields (UUIDs preserved) instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyPainManagementCarePlanSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(6);
    for (const [label, key] of Object.entries(PAIN_MANAGEMENT_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('preserves existing field types, required flags and ordering after apply', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPainManagementCarePlanSchema(prisma, VERSION_ID);

    const score = state.fields.find((f) => f.id === 'field-score')!;
    expect(score.fieldKey).toBe('pain_management_usual_pain_score');
    expect(score.fieldType).toBe('NUMBER');
    expect(score.sortOrder).toBe(0);

    const nonpharm = state.fields.find((f) => f.id === 'field-nonpharm')!;
    expect(nonpharm.required).toBe(true);
    expect(nonpharm.sortOrder).toBe(1);
  });

  it('reuses the two original section UUIDs and adds the Care 2020 section', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPainManagementCarePlanSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'Pain profile')?.id).toBe('section-pain-profile');
    expect(state.sections.find((s) => s.title === 'Management')?.id).toBe('section-management');
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(3);
    expect(state.sections.some((s) => s.title === 'Needs, goals, support and risk')).toBe(true);
  });

  it('does not orphan an existing sectionId:fieldId saved key', async () => {
    const state = legacyState();
    const savedKey = 'section-management:field-nonpharm';
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPainManagementCarePlanSchema(prisma, VERSION_ID);

    const [sectionId, fieldId] = savedKey.split(':');
    const section = state.sections.find((s) => s.id === sectionId);
    const field = state.fields.find((f) => f.id === fieldId);

    expect(section?.deletedAt).toBeNull();
    expect(field?.isActive).toBe(true);
    expect(field?.sectionId).toBe(sectionId);
    expect(field?.fieldKey).toBe('pain_management_non_pharmacological');
  });

  it('deactivates nothing on a clean legacy form', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applyPainManagementCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('creates each field exactly once, ending with twelve unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPainManagementCarePlanSchema(prisma, VERSION_ID);

    const activeKeys = state.fields.filter((f) => f.isActive).map((f) => f.fieldKey);
    expect(new Set(activeKeys).size).toBe(activeKeys.length);
    expect(activeKeys).toHaveLength(18);
    for (const key of seedFieldKeys()) {
      expect(activeKeys).toContain(key);
    }
  });

  it('is idempotent — a second run changes nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPainManagementCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applyPainManagementCarePlanSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a pain_management_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyPainManagementCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applyPainManagementCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          { title: 'X', fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'mobility_oops' } as never] },
        ],
      }),
    ).rejects.toThrow(/must start with pain_management_/);
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
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
