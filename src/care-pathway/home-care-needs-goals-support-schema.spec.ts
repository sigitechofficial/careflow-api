import { applyHomeCareNeedsGoalsSupportSchema } from '../../prisma/seeds/home-care-needs-goals-support-schema.util';
import {
  HOME_CARE_NEEDS_GOALS_SUPPORT_LEGACY_LABEL_TO_KEY,
  HOME_CARE_NEEDS_GOALS_SUPPORT_SEED,
} from '../../prisma/seeds/home-care-needs-goals-support.seed-data';
import { HOME_CARE_PLAN_SEED } from '../../prisma/seeds/home-care-plan.seed-data';
import { DEMENTIA_CARE_PLAN_SEED } from '../../prisma/seeds/dementia-care-plan.seed-data';
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

const VERSION_ID = 'home-care-ngs-version-1';

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

/** The form exactly as it exists before the Care 2020 merge (keyless, 2 sections, 7 fields). */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const needs: Section = {
    id: 'section-identified-needs',
    formVersionId: VERSION_ID,
    title: 'Identified needs',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const goals: Section = {
    id: 'section-goals-support',
    formVersionId: VERSION_ID,
    title: 'Goals and support',
    description: null,
    sortOrder: 1,
    deletedAt: null,
  };

  const field = (
    id: string,
    sectionId: string,
    label: string,
    sortOrder: number,
    required = false,
  ): Field => ({
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
    sections: [needs, goals],
    fields: [
      field('field-personal', needs.id, 'Personal care needs', 0),
      field('field-domestic', needs.id, 'Domestic and living skills', 1),
      field('field-social', needs.id, 'Social and emotional needs', 2),
      field('field-goal1', goals.id, 'Goal 1 – what we will achieve', 0, true),
      field('field-support', goals.id, 'How carers will support this', 1, true),
      field('field-goal2', goals.id, 'Goal 2 (optional)', 2),
      field('field-progress', goals.id, 'Progress notes', 3),
    ],
  };
}

function seedFieldKeys(): string[] {
  return HOME_CARE_NEEDS_GOALS_SUPPORT_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of HOME_CARE_NEEDS_GOALS_SUPPORT_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Template contents
// --------------------------------------------------------------------------

describe('Home Care needs/goals/support template', () => {
  it('retains all seven original project fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(HOME_CARE_NEEDS_GOALS_SUPPORT_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(HOME_CARE_NEEDS_GOALS_SUPPORT_LEGACY_LABEL_TO_KEY)).toHaveLength(7);
  });

  it('preserves existing types and the two existing required goal fields', () => {
    for (const key of [
      'home_care_personal_care_needs',
      'home_care_domestic_living_skills',
      'home_care_social_emotional_needs',
      'home_care_goal_1',
      'home_care_carer_support',
      'home_care_goal_2',
      'home_care_progress_notes',
    ]) {
      expect(seedField(key)?.fieldType).toBe('TEXTAREA');
    }
    expect(seedField('home_care_goal_1')?.required).toBe(true);
    expect(seedField('home_care_carer_support')?.required).toBe(true);
    // The existing needs fields are NOT made required by this migration.
    expect(seedField('home_care_personal_care_needs')?.required ?? false).toBe(false);
  });

  it('keeps the two existing sections (no new section added)', () => {
    expect(HOME_CARE_NEEDS_GOALS_SUPPORT_SEED.sections.map((s) => s.title)).toEqual([
      'Identified needs',
      'Goals and support',
    ]);
  });

  it('adds exactly one required Person-centred details in Identified needs, and the risk gate in Goals and support', () => {
    const needs = HOME_CARE_NEEDS_GOALS_SUPPORT_SEED.sections[0].fields;
    const goals = HOME_CARE_NEEDS_GOALS_SUPPORT_SEED.sections[1].fields;
    expect(needs.map((f) => f.fieldKey)).toEqual([
      'home_care_personal_care_needs',
      'home_care_domestic_living_skills',
      'home_care_social_emotional_needs',
      'home_care_needs_person_centred',
    ]);
    expect(goals.map((f) => f.fieldKey)).toEqual([
      'home_care_goal_1',
      'home_care_carer_support',
      'home_care_goal_2',
      'home_care_progress_notes',
      'home_care_area_risk',
    ]);
    expect(seedField('home_care_area_risk')?.fieldType).toBe('YES_NO');
    const pcd = HOME_CARE_NEEDS_GOALS_SUPPORT_SEED.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.label === 'Person-centred details');
    expect(pcd).toHaveLength(1);
    expect(pcd[0].fieldKey).toBe('home_care_needs_person_centred');
    expect(pcd[0].required).toBe(true);
  });

  it('does NOT create goals/support person-centred duplicates', () => {
    const keys = seedFieldKeys();
    expect(keys).not.toContain('home_care_goals_person_centred');
    expect(keys).not.toContain('home_care_support_person_centred');
  });

  it('contains no duplicate field keys and totals nine', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(9);
  });

  it('gives every field a home_care_ prefixed key and shares none with the large Home Care Plan (hcp_)', () => {
    const hcpKeys = new Set(
      HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
    );
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('home_care_')).toBe(true);
      expect(hcpKeys.has(key)).toBe(false);
    }
  });

  it('shares no field keys with other migrated care plans', () => {
    const others = new Set([
      ...DEMENTIA_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...CONTINENCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});

// --------------------------------------------------------------------------
// ID preservation, order, saved-value safety and idempotency
// --------------------------------------------------------------------------

describe('applyHomeCareNeedsGoalsSupportSchema', () => {
  it('adopts the seven pre-merge fields (UUIDs preserved) instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyHomeCareNeedsGoalsSupportSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(7);
    for (const [label, key] of Object.entries(HOME_CARE_NEEDS_GOALS_SUPPORT_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('preserves existing field UUIDs, required flags and ordering', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyHomeCareNeedsGoalsSupportSchema(prisma, VERSION_ID);

    const goal1 = state.fields.find((f) => f.id === 'field-goal1')!;
    expect(goal1.fieldKey).toBe('home_care_goal_1');
    expect(goal1.required).toBe(true);
    expect(goal1.sortOrder).toBe(0);
    const personal = state.fields.find((f) => f.id === 'field-personal')!;
    expect(personal.fieldKey).toBe('home_care_personal_care_needs');
    expect(personal.required).toBe(false);
  });

  it('makes the Person-centred details field required and active', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyHomeCareNeedsGoalsSupportSchema(prisma, VERSION_ID);

    const pcd = state.fields.find((f) => f.fieldKey === 'home_care_needs_person_centred')!;
    expect(pcd.required).toBe(true);
    expect(pcd.isActive).toBe(true);
    expect(pcd.sectionId).toBe('section-identified-needs');
  });

  it('reuses both original section UUIDs (no new section)', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyHomeCareNeedsGoalsSupportSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'Identified needs')?.id).toBe('section-identified-needs');
    expect(state.sections.find((s) => s.title === 'Goals and support')?.id).toBe('section-goals-support');
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(2);
  });

  it('creates each field exactly once, ending with nine unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyHomeCareNeedsGoalsSupportSchema(prisma, VERSION_ID);

    const activeKeys = state.fields.filter((f) => f.isActive).map((f) => f.fieldKey);
    expect(new Set(activeKeys).size).toBe(activeKeys.length);
    expect(activeKeys).toHaveLength(9);
    for (const key of seedFieldKeys()) {
      expect(activeKeys).toContain(key);
    }
  });

  it('deactivates nothing on a clean legacy form', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applyHomeCareNeedsGoalsSupportSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('deactivates a stray legacy duplicate PCD not in the final seed (idempotently, never deleted)', async () => {
    const state = legacyState();
    state.fields.push({
      id: 'field-dup-pcd',
      sectionId: 'section-goals-support',
      fieldKey: 'home_care_goals_person_centred',
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
    const first = await applyHomeCareNeedsGoalsSupportSchema(prisma, VERSION_ID);
    const dup = state.fields.find((f) => f.id === 'field-dup-pcd')!;
    expect(first.deactivated).toBe(1);
    expect(dup.isActive).toBe(false);
    expect(dup.deletedAt).toBeNull();

    const second = await applyHomeCareNeedsGoalsSupportSchema(prisma, VERSION_ID);
    expect(second.deactivated).toBe(0);
    expect(state.fields.filter((f) => f.isActive && f.label === 'Person-centred details')).toHaveLength(1);
  });

  it('is idempotent — a second run changes nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyHomeCareNeedsGoalsSupportSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applyHomeCareNeedsGoalsSupportSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a home_care_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyHomeCareNeedsGoalsSupportSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applyHomeCareNeedsGoalsSupportSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          { title: 'X', fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'pain_management_oops' } as never] },
        ],
      }),
    ).rejects.toThrow(/must start with home_care_/);
  });
});
