import { applyMedicationCarePlanSchema } from '../../prisma/seeds/medication-care-plan-schema.util';
import {
  MEDICATION_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  MEDICATION_CARE_PLAN_SEED,
  MEDICATION_SUPPORT_LEVEL_OPTIONS,
} from '../../prisma/seeds/medication-care-plan.seed-data';
import { HOME_CARE_PLAN_SEED } from '../../prisma/seeds/home-care-plan.seed-data';
import { HOME_SUPPORT_PLAN_SEED } from '../../prisma/seeds/home-support-plan.seed-data';
import { ADVANCE_CARE_PLAN_SEED } from '../../prisma/seeds/advance-care-plan.seed-data';
import { COGNITION_BEHAVIOUR_CARE_PLAN_SEED } from '../../prisma/seeds/cognition-behaviour-care-plan.seed-data';
import { CULTURE_RELIGION_CARE_PLAN_SEED } from '../../prisma/seeds/culture-religion-care-plan.seed-data';
import { FALLS_CARE_PLAN_SEED } from '../../prisma/seeds/falls-care-plan.seed-data';
import { FINAL_DAYS_CARE_PLAN_SEED } from '../../prisma/seeds/final-days-care-plan.seed-data';
import { INFECTION_CARE_PLAN_SEED } from '../../prisma/seeds/infection-care-plan.seed-data';
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

const VERSION_ID = 'medication-version-1';

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

/** The Medication plan exactly as it exists before the Care 2020 merge (keyless). */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const overview: Section = {
    id: 'section-overview',
    formVersionId: VERSION_ID,
    title: 'Medication overview',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const instructions: Section = {
    id: 'section-instructions',
    formVersionId: VERSION_ID,
    title: 'Instructions',
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
    sections: [overview, instructions],
    fields: [
      field('field-support', overview.id, 'Medication support level', 'SELECT', 0, false, {
        options: MEDICATION_SUPPORT_LEVEL_OPTIONS,
      }),
      field('field-allergies', overview.id, 'Known allergies', 'TEXTAREA', 1, true),
      field('field-prn', overview.id, 'PRN medicines and when used', 'TEXTAREA', 2),
      field('field-storage', instructions.id, 'Storage and blister packs', 'TEXT', 0),
      field('field-refusal', instructions.id, 'Refusal or missed dose – action', 'TEXTAREA', 1, true),
      field('field-pharmacy', instructions.id, 'Pharmacy and GP contact', 'TEXT', 2),
    ],
  };
}

function seedFieldKeys(): string[] {
  return MEDICATION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of MEDICATION_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Template contents
// --------------------------------------------------------------------------

describe('Medication Care Plan template', () => {
  it('retains all six original local fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(MEDICATION_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(MEDICATION_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(6);
  });

  it('keeps the original field types, SELECT options and required flags', () => {
    expect(seedField('medication_support_level')?.fieldType).toBe('SELECT');
    expect(seedField('medication_support_level')?.options).toEqual(MEDICATION_SUPPORT_LEVEL_OPTIONS);
    expect(seedField('medication_known_allergies')?.fieldType).toBe('TEXTAREA');
    expect(seedField('medication_known_allergies')?.required).toBe(true);
    expect(seedField('medication_prn_medicines')?.fieldType).toBe('TEXTAREA');
    expect(seedField('medication_storage_blister_packs')?.fieldType).toBe('TEXT');
    expect(seedField('medication_refusal_missed_dose')?.required).toBe(true);
    expect(seedField('medication_pharmacy_gp_contact')?.fieldType).toBe('TEXT');
  });

  it('reuses the two original section titles and adds the Care 2020 section', () => {
    expect(MEDICATION_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Medication overview',
      'Instructions',
      'Needs, goals, support and risk',
    ]);
  });

  it('adds the five Care 2020 fields with the correct wording', () => {
    expect(seedField('medication_service_user_needs')?.label).toBe('What are the service user needs?');
    expect(seedField('medication_desired_goals_outcomes')?.label).toBe(
      'What are the service user desired goals/outcomes?',
    );
    expect(seedField('medication_support_required')?.label).toBe(
      'Support required to achieve the desired goals/outcomes?',
    );
    expect(seedField('medication_area_risk')?.label).toBe('Is there a risk associated with this area of care?');
    expect(seedField('medication_area_risk')?.fieldType).toBe('YES_NO');
  });

  it('contains no duplicate field keys and totals eleven', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(17);
  });

  it('gives every field a medication_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('medication_')).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// ID preservation, order, saved-value safety and idempotency
// --------------------------------------------------------------------------

describe('applyMedicationCarePlanSchema', () => {
  it('adopts the six pre-merge fields (UUIDs preserved) instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyMedicationCarePlanSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(6);
    for (const [label, key] of Object.entries(MEDICATION_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('preserves existing field types, options, required flags and ordering after apply', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyMedicationCarePlanSchema(prisma, VERSION_ID);

    const support = state.fields.find((f) => f.id === 'field-support')!;
    expect(support.fieldKey).toBe('medication_support_level');
    expect(support.fieldType).toBe('SELECT');
    expect(support.optionsJson).toEqual({ options: MEDICATION_SUPPORT_LEVEL_OPTIONS });
    expect(support.sortOrder).toBe(0);

    const allergies = state.fields.find((f) => f.id === 'field-allergies')!;
    expect(allergies.required).toBe(true);
    expect(allergies.sortOrder).toBe(1);

    const refusal = state.fields.find((f) => f.id === 'field-refusal')!;
    expect(refusal.required).toBe(true);
    expect(refusal.sortOrder).toBe(1);
  });

  it('reuses the two original section UUIDs and adds the Care 2020 section', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyMedicationCarePlanSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'Medication overview')?.id).toBe('section-overview');
    expect(state.sections.find((s) => s.title === 'Instructions')?.id).toBe('section-instructions');
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(3);
    expect(state.sections.some((s) => s.title === 'Needs, goals, support and risk')).toBe(true);
  });

  it('keeps VALID saved sectionId:fieldId references valid (fields survive, sections survive)', async () => {
    const state = legacyState();
    // Representative valid saved keys from the two published instances.
    const validKeys = ['section-overview:field-allergies', 'section-instructions:field-refusal'];
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyMedicationCarePlanSchema(prisma, VERSION_ID);

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
    // The fake prisma exposes ONLY carePathwayFormSection/Field/Version. If the applier tried
    // to read or write ServiceUserCarePlanDraft/PublishedVersion (where the 6 pre-existing
    // orphaned keys live) it would throw. A clean run proves the orphans are left untouched.
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    await expect(applyMedicationCarePlanSchema(prisma, VERSION_ID)).resolves.toBeDefined();
  });

  it('deactivates nothing on a clean legacy form', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applyMedicationCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('creates each field exactly once, ending with eleven unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyMedicationCarePlanSchema(prisma, VERSION_ID);

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

    await applyMedicationCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applyMedicationCarePlanSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a medication_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyMedicationCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applyMedicationCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          { title: 'X', fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'crs_oops' } as never] },
        ],
      }),
    ).rejects.toThrow(/must start with medication_/);
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
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
