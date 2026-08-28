import { applyDementiaCarePlanSchema } from '../../prisma/seeds/dementia-care-plan-schema.util';
import {
  DEMENTIA_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  DEMENTIA_CARE_PLAN_SEED,
} from '../../prisma/seeds/dementia-care-plan.seed-data';
import { DEMENTIA_CARE_PLAN_FIELD_MAPPINGS } from '../service-user-care-plans/compose/dementia-care-plan.compose';
import { CONTINENCE_CARE_PLAN_SEED } from '../../prisma/seeds/continence-care-plan.seed-data';
import { SKIN_INTEGRITY_CARE_PLAN_SEED } from '../../prisma/seeds/skin-integrity-care-plan.seed-data';
import { PERSONAL_SAFETY_CARE_PLAN_SEED } from '../../prisma/seeds/personal-safety-care-plan.seed-data';
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

const VERSION_ID = 'dementia-version-1';

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

/** The Dementia plan exactly as it exists before the Care 2020 merge (keyless, 2 sections). */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const understanding: Section = {
    id: 'section-understanding',
    formVersionId: VERSION_ID,
    title: 'Understanding the person',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const daily: Section = {
    id: 'section-daily-support',
    formVersionId: VERSION_ID,
    title: 'Daily support',
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
    sections: [understanding, daily],
    fields: [
      field('field-life', understanding.id, 'Life history and interests', 'TEXTAREA', 0, true),
      field('field-stage', understanding.id, 'Stage of dementia (if known)', 'TEXT', 1),
      field('field-besttime', understanding.id, 'Best time of day for activities', 'TEXT', 2),
      field('field-orientation', daily.id, 'Orientation cues used (signs, photos, clocks)', 'TEXTAREA', 0),
      field('field-sundowning', daily.id, 'Sundowning or agitation – what helps', 'TEXTAREA', 1),
      field('field-supervision', daily.id, 'Safe walking / supervision level', 'SELECT', 2, false, {
        options: ['Independent', 'Intermittent supervision', 'Constant supervision'],
      }),
    ],
  };
}

function seedFieldKeys(): string[] {
  return DEMENTIA_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of DEMENTIA_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Template contents
// --------------------------------------------------------------------------

describe('Dementia Care Plan template', () => {
  it('retains all six original project fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(DEMENTIA_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(DEMENTIA_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(6);
  });

  it('preserves the existing field types, required flags and SELECT options', () => {
    expect(seedField('dementia_life_history')?.fieldType).toBe('TEXTAREA');
    expect(seedField('dementia_life_history')?.required).toBe(true);
    expect(seedField('dementia_stage')?.fieldType).toBe('TEXT');
    expect(seedField('dementia_best_time')?.fieldType).toBe('TEXT');
    expect(seedField('dementia_orientation_cues')?.fieldType).toBe('TEXTAREA');
    expect(seedField('dementia_sundowning')?.fieldType).toBe('TEXTAREA');
    expect(seedField('dementia_supervision_level')?.fieldType).toBe('SELECT');
    expect(seedField('dementia_supervision_level')?.options).toEqual([
      'Independent',
      'Intermittent supervision',
      'Constant supervision',
    ]);
  });

  it('has four sections in order (existing two + Dementia assessment + Care 2020 block)', () => {
    expect(DEMENTIA_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Understanding the person',
      'Daily support',
      'Dementia assessment',
      'Needs, goals, support and risk',
    ]);
  });

  it('adds the fourteen engine-mapped Dementia assessment fields with labels the engine maps', () => {
    const assessment = DEMENTIA_CARE_PLAN_SEED.sections[2].fields;
    expect(assessment).toHaveLength(14);
    const engineLabels = new Set(DEMENTIA_CARE_PLAN_FIELD_MAPPINGS.map((m) => m.fieldLabel));
    for (const f of assessment) {
      expect(engineLabels.has(f.label)).toBe(true);
    }
    expect(seedField('dementia_diagnosed')?.fieldType).toBe('YES_NO');
    expect(seedField('dementia_next_review')?.fieldType).toBe('DATE');
    expect(seedField('dementia_good_day')?.label).toBe('What makes a good day for the person?');
  });

  it('never displays the "@" placeholder in any user-facing label or section description', () => {
    for (const section of DEMENTIA_CARE_PLAN_SEED.sections) {
      expect(section.title).not.toContain('@');
      expect(section.description ?? '').not.toContain('@');
      for (const f of section.fields) {
        expect(f.label).not.toContain('@');
      }
    }
    // The engine mapping labels must also be placeholder-free (they must match the field labels).
    for (const m of DEMENTIA_CARE_PLAN_FIELD_MAPPINGS) {
      expect(m.fieldLabel).not.toContain('@');
    }
  });

  it('uses the corrected good-day and communication labels (and the engine still maps them)', () => {
    expect(seedField('dementia_good_day')?.label).toBe('What makes a good day for the person?');
    expect(seedField('dementia_communication')?.label).toBe('How does the person communicate best?');
    const engineLabels = new Set(DEMENTIA_CARE_PLAN_FIELD_MAPPINGS.map((m) => m.fieldLabel));
    expect(engineLabels.has('What makes a good day for the person?')).toBe(true);
    expect(engineLabels.has('How does the person communicate best?')).toBe(true);
  });

  it('has the corrected Dementia assessment section description', () => {
    const assessmentSection = DEMENTIA_CARE_PLAN_SEED.sections.find(
      (s) => s.title === 'Dementia assessment',
    );
    expect(assessmentSection?.description).toBe(
      'Assessment of the person’s dementia diagnosis, cognition, communication, triggers, routines, activities and family involvement to support person-centred care planning. Information is drawn from About Me and the Initial Assessment.',
    );
  });

  it('adds the Care 2020 block with exactly one required Person-centred details and no goals/support PCD', () => {
    const block = DEMENTIA_CARE_PLAN_SEED.sections[3].fields;
    expect(block.map((f) => f.fieldKey)).toEqual([
      'dementia_service_user_needs',
      'dementia_needs_person_centred',
      'dementia_desired_goals_outcomes',
      'dementia_support_required',
      'dementia_area_risk',
    ]);
    expect(seedField('dementia_area_risk')?.fieldType).toBe('YES_NO');
    const pcd = DEMENTIA_CARE_PLAN_SEED.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.label === 'Person-centred details');
    expect(pcd).toHaveLength(1);
    expect(pcd[0].fieldKey).toBe('dementia_needs_person_centred');
    expect(pcd[0].required).toBe(true);
    const keys = seedFieldKeys();
    expect(keys).not.toContain('dementia_goals_person_centred');
    expect(keys).not.toContain('dementia_support_person_centred');
  });

  it('contains no duplicate field keys and totals twenty-five', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(25);
  });

  it('gives every field a dementia_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('dementia_')).toBe(true);
    }
  });

  it('shares no field keys with other migrated care plans', () => {
    const others = new Set([
      ...CONTINENCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...SKIN_INTEGRITY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...PERSONAL_SAFETY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});

// --------------------------------------------------------------------------
// ID preservation, order, saved-value safety and idempotency
// --------------------------------------------------------------------------

describe('applyDementiaCarePlanSchema', () => {
  it('adopts the six pre-merge fields (UUIDs preserved) instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyDementiaCarePlanSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(6);
    for (const [label, key] of Object.entries(DEMENTIA_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('preserves existing field UUIDs, types, required flags, options and ordering', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyDementiaCarePlanSchema(prisma, VERSION_ID);

    const life = state.fields.find((f) => f.id === 'field-life')!;
    expect(life.fieldKey).toBe('dementia_life_history');
    expect(life.required).toBe(true);
    const supervision = state.fields.find((f) => f.id === 'field-supervision')!;
    expect(supervision.fieldKey).toBe('dementia_supervision_level');
    expect(supervision.fieldType).toBe('SELECT');
    expect(supervision.optionsJson).toEqual({ options: ['Independent', 'Intermittent supervision', 'Constant supervision'] });
  });

  it('makes the Care 2020 Person-centred details field required', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyDementiaCarePlanSchema(prisma, VERSION_ID);

    const pcd = state.fields.find((f) => f.fieldKey === 'dementia_needs_person_centred')!;
    expect(pcd.required).toBe(true);
    expect(pcd.isActive).toBe(true);
  });

  it('reuses the two original section UUIDs and adds two new sections after them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyDementiaCarePlanSchema(prisma, VERSION_ID);

    const understanding = state.sections.find((s) => s.title === 'Understanding the person')!;
    const daily = state.sections.find((s) => s.title === 'Daily support')!;
    expect(understanding.id).toBe('section-understanding');
    expect(daily.id).toBe('section-daily-support');
    expect(understanding.sortOrder).toBe(0);
    expect(daily.sortOrder).toBe(1);
    expect(state.sections.find((s) => s.title === 'Dementia assessment')?.sortOrder).toBe(2);
    expect(state.sections.find((s) => s.title === 'Needs, goals, support and risk')?.sortOrder).toBe(3);
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(4);
  });

  it('creates each field exactly once, ending with twenty-five unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyDementiaCarePlanSchema(prisma, VERSION_ID);

    const activeKeys = state.fields.filter((f) => f.isActive).map((f) => f.fieldKey);
    expect(new Set(activeKeys).size).toBe(activeKeys.length);
    expect(activeKeys).toHaveLength(25);
    for (const key of seedFieldKeys()) {
      expect(activeKeys).toContain(key);
    }
  });

  it('deactivates nothing on a clean legacy form', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applyDementiaCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('deactivates a stray legacy duplicate PCD not in the final seed (idempotently, never deleted)', async () => {
    const state = legacyState();
    state.fields.push({
      id: 'field-dup-pcd',
      sectionId: 'section-daily-support',
      fieldKey: 'dementia_goals_person_centred',
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
    const first = await applyDementiaCarePlanSchema(prisma, VERSION_ID);
    const dup = state.fields.find((f) => f.id === 'field-dup-pcd')!;
    expect(first.deactivated).toBe(1);
    expect(dup.isActive).toBe(false);
    expect(dup.deletedAt).toBeNull();

    const second = await applyDementiaCarePlanSchema(prisma, VERSION_ID);
    expect(second.deactivated).toBe(0);
    expect(state.fields.filter((f) => f.isActive && f.label === 'Person-centred details')).toHaveLength(1);
  });

  it('is idempotent — a second run changes nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyDementiaCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applyDementiaCarePlanSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a dementia_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyDementiaCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applyDementiaCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          { title: 'X', fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'pain_management_oops' } as never] },
        ],
      }),
    ).rejects.toThrow(/must start with dementia_/);
  });
});
