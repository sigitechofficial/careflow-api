import { applySkinIntegrityCarePlanSchema } from '../../prisma/seeds/skin-integrity-care-plan-schema.util';
import {
  SKIN_INTEGRITY_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  SKIN_INTEGRITY_CARE_PLAN_SEED,
} from '../../prisma/seeds/skin-integrity-care-plan.seed-data';
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

const VERSION_ID = 'skin-version-1';

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

/** The Skin Integrity plan exactly as it exists before the Care 2020 merge (keyless). */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const profile: Section = {
    id: 'section-skin-profile',
    formVersionId: VERSION_ID,
    title: 'Skin profile',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const daily: Section = {
    id: 'section-daily-care',
    formVersionId: VERSION_ID,
    title: 'Daily care',
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
    sections: [profile, daily],
    fields: [
      field('field-skintype', profile.id, 'Skin type / common issues', 'TEXTAREA', 0),
      field('field-emollients', profile.id, 'Emollients or creams prescribed', 'TEXTAREA', 1),
      field('field-pressure', profile.id, 'Previous pressure damage', 'YES_NO', 2),
      field('field-application', daily.id, 'Application of creams – when and where', 'TEXTAREA', 0, true),
      field('field-signs', daily.id, 'Signs to report immediately', 'TEXTAREA', 1, true),
    ],
  };
}

function seedFieldKeys(): string[] {
  return SKIN_INTEGRITY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of SKIN_INTEGRITY_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Template contents
// --------------------------------------------------------------------------

describe('Skin Integrity Care Plan template', () => {
  it('retains all five original local fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(SKIN_INTEGRITY_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(SKIN_INTEGRITY_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(5);
  });

  it('keeps the original field types and required flags', () => {
    expect(seedField('skin_integrity_skin_type_issues')?.fieldType).toBe('TEXTAREA');
    expect(seedField('skin_integrity_emollients_creams')?.fieldType).toBe('TEXTAREA');
    expect(seedField('skin_integrity_previous_pressure_damage')?.fieldType).toBe('YES_NO');
    expect(seedField('skin_integrity_cream_application')?.required).toBe(true);
    expect(seedField('skin_integrity_signs_to_report')?.required).toBe(true);
  });

  it('reuses the two original section titles and adds the Care 2020 section', () => {
    expect(SKIN_INTEGRITY_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Skin profile',
      'Daily care',
      'Needs, goals, support and risk',
    ]);
  });

  it('adds the five Care 2020 fields in order with exactly one Person-centred details', () => {
    const care2020 = SKIN_INTEGRITY_CARE_PLAN_SEED.sections[2].fields.map((f) => f.fieldKey);
    expect(care2020).toEqual([
      'skin_integrity_service_user_needs',
      'skin_integrity_needs_person_centred',
      'skin_integrity_desired_goals_outcomes',
      'skin_integrity_support_required',
      'skin_integrity_area_risk',
    ]);
    expect(seedField('skin_integrity_area_risk')?.fieldType).toBe('YES_NO');
    // Exactly one "Person-centred details" field across the whole template.
    const pcdLabels = SKIN_INTEGRITY_CARE_PLAN_SEED.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.label === 'Person-centred details');
    expect(pcdLabels).toHaveLength(1);
    expect(pcdLabels[0].fieldKey).toBe('skin_integrity_needs_person_centred');
  });

  it('contains no duplicate field keys and totals ten', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(10);
  });

  it('gives every field a skin_integrity_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('skin_integrity_')).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// ID preservation, order, saved-value safety and idempotency
// --------------------------------------------------------------------------

describe('applySkinIntegrityCarePlanSchema', () => {
  it('adopts the five pre-merge fields (UUIDs preserved) instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applySkinIntegrityCarePlanSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(5);
    for (const [label, key] of Object.entries(SKIN_INTEGRITY_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('preserves existing field types, required flags and ordering after apply', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applySkinIntegrityCarePlanSchema(prisma, VERSION_ID);

    const pressure = state.fields.find((f) => f.id === 'field-pressure')!;
    expect(pressure.fieldKey).toBe('skin_integrity_previous_pressure_damage');
    expect(pressure.fieldType).toBe('YES_NO');
    expect(pressure.sortOrder).toBe(2);

    const application = state.fields.find((f) => f.id === 'field-application')!;
    expect(application.required).toBe(true);
    expect(application.sortOrder).toBe(0);
  });

  it('reuses the two original section UUIDs and adds the Care 2020 section', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applySkinIntegrityCarePlanSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'Skin profile')?.id).toBe('section-skin-profile');
    expect(state.sections.find((s) => s.title === 'Daily care')?.id).toBe('section-daily-care');
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(3);
    expect(state.sections.some((s) => s.title === 'Needs, goals, support and risk')).toBe(true);
  });

  it('keeps VALID saved sectionId:fieldId references valid (fields survive, sections survive)', async () => {
    const state = legacyState();
    const validKeys = ['section-skin-profile:field-skintype', 'section-daily-care:field-signs'];
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applySkinIntegrityCarePlanSchema(prisma, VERSION_ID);

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

  it('never touches saved-value stores (only section/field/version accessors are used)', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await expect(applySkinIntegrityCarePlanSchema(prisma, VERSION_ID)).resolves.toBeDefined();
  });

  it('deactivates nothing on a clean legacy form', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applySkinIntegrityCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('creates each field exactly once, ending with ten unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applySkinIntegrityCarePlanSchema(prisma, VERSION_ID);

    const activeKeys = state.fields.filter((f) => f.isActive).map((f) => f.fieldKey);
    expect(new Set(activeKeys).size).toBe(activeKeys.length);
    expect(activeKeys).toHaveLength(10);
    for (const key of seedFieldKeys()) {
      expect(activeKeys).toContain(key);
    }
  });

  it('deactivates a legacy duplicate Person-centred field not in the final seed (idempotently)', async () => {
    const state = legacyState();
    // Simulate the live state: a stray duplicate PCD field with a now-removed key.
    const dupSectionId = 'section-daily-care';
    state.fields.push({
      id: 'field-dup-pcd',
      sectionId: dupSectionId,
      fieldKey: 'skin_integrity_goals_person_centred',
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
    const first = await applySkinIntegrityCarePlanSchema(prisma, VERSION_ID);
    const dup = state.fields.find((f) => f.id === 'field-dup-pcd')!;
    expect(first.deactivated).toBe(1);
    expect(dup.isActive).toBe(false);
    expect(dup.deletedAt).toBeNull(); // deactivated, never deleted — UUID + any saved value preserved

    // Second run must not re-touch it and must not recreate the duplicate.
    const second = await applySkinIntegrityCarePlanSchema(prisma, VERSION_ID);
    expect(second.deactivated).toBe(0);
    expect(state.fields.filter((f) => f.isActive && f.label === 'Person-centred details')).toHaveLength(1);
  });

  it('is idempotent — a second run changes nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applySkinIntegrityCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applySkinIntegrityCarePlanSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a skin_integrity_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applySkinIntegrityCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applySkinIntegrityCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          { title: 'X', fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'pain_management_oops' } as never] },
        ],
      }),
    ).rejects.toThrow(/must start with skin_integrity_/);
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
    expect(COGNITION_BEHAVIOUR_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(12);
    expect(CULTURE_RELIGION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(11);
    expect(FALLS_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(12);
    expect(FINAL_DAYS_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(12);
    expect(INFECTION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(11);
    expect(MEDICATION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(11);
    expect(MOBILITY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(13);
    expect(PAIN_MANAGEMENT_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(12);
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
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
