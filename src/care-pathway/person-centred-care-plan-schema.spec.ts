import { applyPersonCentredCarePlanSchema } from '../../prisma/seeds/person-centred-care-plan-schema.util';
import {
  PERSON_CENTRED_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  PERSON_CENTRED_CARE_PLAN_SEED,
} from '../../prisma/seeds/person-centred-care-plan.seed-data';
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

const VERSION_ID = 'person-centred-version-1';

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

/** The form exactly as it exists before key adoption (keyless, 2 sections, 6 fields). */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const about: Section = {
    id: 'section-about-me',
    formVersionId: VERSION_ID,
    title: 'About me',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const daily: Section = {
    id: 'section-daily-life',
    formVersionId: VERSION_ID,
    title: 'Daily life',
    description: null,
    sortOrder: 1,
    deletedAt: null,
  };

  const field = (id: string, sectionId: string, label: string, sortOrder: number, required = false): Field => ({
    id,
    sectionId,
    fieldKey: null,
    label,
    fieldType: 'TEXTAREA',
    placeholder: null,
    helpText: null,
    required,
    optionsJson: null,
    sortOrder,
    isActive: true,
    deletedAt: null,
  });

  return {
    sections: [about, daily],
    fields: [
      field('field-important', about.id, 'What is important to me', 0, true),
      field('field-supported', about.id, 'How I like to be supported', 1, true),
      field('field-people', about.id, 'People who matter to me', 2),
      field('field-morning', daily.id, 'Morning routine preferences', 0),
      field('field-evening', daily.id, 'Evening / bedtime routine', 1),
      field('field-upset', daily.id, 'Things that upset or calm me', 2),
    ],
  };
}

function seedFieldKeys(): string[] {
  return PERSON_CENTRED_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

// --------------------------------------------------------------------------
// Template contents — dedicated person-centred plan, exempt from generic PCD
// --------------------------------------------------------------------------

describe('Person Centred Care Plan template', () => {
  it('retains the six existing project fields (still adopted by the legacy map)', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(PERSON_CENTRED_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(PERSON_CENTRED_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(6);
  });

  it('covers the Care 2020 assessment: 37 unique fields across 7 sections', () => {
    const keys = seedFieldKeys();
    expect(keys).toHaveLength(37);
    expect(new Set(keys).size).toBe(37);
    expect(PERSON_CENTRED_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'About me',
      'Daily life',
      'Personal details',
      'Family and important people',
      'My community, learning and safety',
      'My care and health',
      'Consent and completion',
    ]);
    // Existing sections keep their field counts (About me 8, Daily life 3).
    expect(PERSON_CENTRED_CARE_PLAN_SEED.sections[0].fields).toHaveLength(8);
    expect(PERSON_CENTRED_CARE_PLAN_SEED.sections[1].fields).toHaveLength(3);
  });

  it('adds the approved Care 2020 fields with correct types', () => {
    const byKey = Object.fromEntries(
      PERSON_CENTRED_CARE_PLAN_SEED.sections.flatMap((s) => s.fields).map((f) => [f.fieldKey, f]),
    );
    // A sample of new fields with their approved types.
    expect(byKey['person_centred_date_of_birth'].fieldType).toBe('DATE');
    expect(byKey['person_centred_date_completed'].fieldType).toBe('DATE');
    expect(byKey['person_centred_home_access_consent'].fieldType).toBe('YES_NO');
    expect(byKey['person_centred_preferred_name'].fieldType).toBe('TEXT');
    expect(byKey['person_centred_phone'].fieldType).toBe('TEXT');
    expect(byKey['person_centred_address'].fieldType).toBe('TEXTAREA');
    expect(byKey['person_centred_health'].fieldType).toBe('TEXTAREA');
  });

  it('keeps the two existing sections and never adds a generic PCD / needs-goals-support block', () => {
    // The two original sections still exist with their titles.
    expect(PERSON_CENTRED_CARE_PLAN_SEED.sections[0].title).toBe('About me');
    expect(PERSON_CENTRED_CARE_PLAN_SEED.sections[1].title).toBe('Daily life');
    const keys = seedFieldKeys();
    expect(keys).not.toContain('person_centred_needs_person_centred');
    expect(keys.some((k) => k.endsWith('_area_risk'))).toBe(false);
  });

  it('every new field is optional (only the two original required fields stay required)', () => {
    const requiredKeys = PERSON_CENTRED_CARE_PLAN_SEED.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.required)
      .map((f) => f.fieldKey);
    expect(requiredKeys.sort()).toEqual(
      ['person_centred_how_supported', 'person_centred_what_important'].sort(),
    );
  });

  it('preserves the two existing required fields and does not make others required', () => {
    const byKey = Object.fromEntries(
      PERSON_CENTRED_CARE_PLAN_SEED.sections.flatMap((s) => s.fields).map((f) => [f.fieldKey, f]),
    );
    expect(byKey['person_centred_what_important'].required).toBe(true);
    expect(byKey['person_centred_how_supported'].required).toBe(true);
    expect(byKey['person_centred_people_matter'].required ?? false).toBe(false);
    expect(byKey['person_centred_morning_routine'].required ?? false).toBe(false);
  });

  it('is EXEMPT from the generic PCD rule — no "Person-centred details" field is added', () => {
    const pcd = PERSON_CENTRED_CARE_PLAN_SEED.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.label === 'Person-centred details');
    expect(pcd).toHaveLength(0);
    const keys = seedFieldKeys();
    expect(keys).not.toContain('person_centred_needs_person_centred');
    expect(keys).not.toContain('person_centred_goals_person_centred');
    expect(keys).not.toContain('person_centred_support_person_centred');
    // No generic needs/goals/support/risk block was introduced.
    expect(keys.some((k) => k.endsWith('_area_risk'))).toBe(false);
    expect(keys.some((k) => k.endsWith('_service_user_needs'))).toBe(false);
  });

  it('gives every field a person_centred_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('person_centred_')).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// ID-safe key adoption — no structural change, saved-value safety, idempotency
// --------------------------------------------------------------------------

describe('applyPersonCentredCarePlanSchema (key adoption only)', () => {
  it('adopts the six pre-existing fields by label (UUIDs preserved) and creates the new ones', async () => {
    const state = legacyState();
    const originalFieldIds = state.fields.map((f) => f.id);
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyPersonCentredCarePlanSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(6);
    // The six original field rows survive with their exact ids (adopted, not recreated).
    for (const id of originalFieldIds) {
      expect(state.fields.some((f) => f.id === id && f.isActive)).toBe(true);
    }
    for (const [label, key] of Object.entries(PERSON_CENTRED_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
    // 37 active total: 6 original adopted + 31 newly created.
    const active = state.fields.filter((f) => f.isActive);
    expect(active).toHaveLength(37);
    expect(active.length - originalFieldIds.length).toBe(31);
  });

  it('preserves the two original section UUIDs and adds the five new sections', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPersonCentredCarePlanSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'About me')?.id).toBe('section-about-me');
    expect(state.sections.find((s) => s.title === 'Daily life')?.id).toBe('section-daily-life');
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(7);
  });

  it('preserves existing required flags after apply', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPersonCentredCarePlanSchema(prisma, VERSION_ID);

    expect(state.fields.find((f) => f.id === 'field-important')!.required).toBe(true);
    expect(state.fields.find((f) => f.id === 'field-supported')!.required).toBe(true);
    expect(state.fields.find((f) => f.id === 'field-people')!.required).toBe(false);
  });

  it('deactivates nothing on a clean legacy form (never deletes)', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applyPersonCentredCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('ends with thirty-seven unique active keys and no duplicates', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPersonCentredCarePlanSchema(prisma, VERSION_ID);

    const activeKeys = state.fields.filter((f) => f.isActive).map((f) => f.fieldKey);
    expect(new Set(activeKeys).size).toBe(activeKeys.length);
    expect(activeKeys).toHaveLength(37);
    for (const key of seedFieldKeys()) {
      expect(activeKeys).toContain(key);
    }
  });

  it('is idempotent — a second run changes nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPersonCentredCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applyPersonCentredCarePlanSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a person_centred_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyPersonCentredCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          { title: 'X', fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'pain_management_oops' } as never] },
        ],
      }),
    ).rejects.toThrow(/must start with person_centred_/);
  });
});
