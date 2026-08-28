import { applyHomeCarePlanSchema } from '../../prisma/seeds/home-care-plan-schema.util';
import {
  HOME_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  HOME_CARE_PLAN_SEED,
} from '../../prisma/seeds/home-care-plan.seed-data';
import type { PrismaClient } from '@prisma/client';

/**
 * In-memory stand-in for the two tables the applier touches.
 * Exercises the guarantee that matters most: existing section and field UUIDs are
 * reused, so draft/published values keyed `sectionId:fieldId` are never orphaned.
 */
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

const VERSION_ID = 'version-1';

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
        const row = {
          id: nextId('field'),
          deletedAt: null,
          ...data,
        } as Field;
        fields.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Field> }) => {
        const row = fields.find((f) => f.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    carePathwayFormVersion: {
      update: async () => ({}),
    },
  } as unknown as PrismaClient;
}

/** The Home Care Plan exactly as it exists before the Care 2020 expansion. */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const overview: Section = {
    id: 'section-package-overview',
    formVersionId: VERSION_ID,
    title: 'Package overview',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const outcomes: Section = {
    id: 'section-outcomes',
    formVersionId: VERSION_ID,
    title: 'Outcomes',
    description: null,
    sortOrder: 1,
    deletedAt: null,
  };

  const field = (id: string, sectionId: string, label: string, fieldType: string): Field => ({
    id,
    sectionId,
    fieldKey: null,
    label,
    fieldType,
    placeholder: null,
    helpText: null,
    required: false,
    optionsJson: null,
    sortOrder: 0,
    isActive: true,
    deletedAt: null,
  });

  return {
    sections: [overview, outcomes],
    fields: [
      field('field-date-started', overview.id, 'Date plan started', 'DATE'),
      field('field-needs-summary', overview.id, 'Summary of needs prompting care', 'TEXTAREA'),
      field('field-hours-visits', overview.id, 'Hours and visits per week', 'TEXT'),
      field('field-success', outcomes.id, 'What success looks like for @', 'TEXTAREA'),
      field('field-risks', outcomes.id, 'Risks if care not provided', 'TEXTAREA'),
      field('field-review-frequency', outcomes.id, 'Review frequency', 'SELECT'),
    ],
  };
}

describe('applyHomeCarePlanSchema', () => {
  it('adopts the six pre-expansion fields instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyHomeCarePlanSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(6);

    // Every original UUID survives, now carrying its business key.
    for (const [label, key] of Object.entries(HOME_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('reuses the two original section UUIDs', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyHomeCarePlanSchema(prisma, VERSION_ID);

    const overview = state.sections.find((s) => s.title === 'Package overview')!;
    const outcomes = state.sections.find((s) => s.title === 'Outcomes')!;
    expect(overview.id).toBe('section-package-overview');
    expect(outcomes.id).toBe('section-outcomes');
    expect(overview.deletedAt).toBeNull();
    expect(outcomes.deletedAt).toBeNull();
  });

  it('does not orphan an existing sectionId:fieldId draft key', async () => {
    const state = legacyState();
    // A draft saved before the expansion.
    const savedKey = 'section-outcomes:field-success';
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyHomeCarePlanSchema(prisma, VERSION_ID);

    const [sectionId, fieldId] = savedKey.split(':');
    const section = state.sections.find((s) => s.id === sectionId);
    const field = state.fields.find((f) => f.id === fieldId);

    expect(section?.deletedAt).toBeNull();
    expect(field).toBeDefined();
    expect(field?.isActive).toBe(true);
    expect(field?.sectionId).toBe(sectionId);
    expect(field?.fieldKey).toBe('hcp_detailed_goals_outcomes');
  });

  it('relabels the merged goals field without changing its id', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyHomeCarePlanSchema(prisma, VERSION_ID);

    const merged = state.fields.find((f) => f.id === 'field-success')!;
    expect(merged.label).toBe('Detailed Goals and Outcomes');
    expect(merged.fieldKey).toBe('hcp_detailed_goals_outcomes');
  });

  it('creates every remaining Care 2020 field exactly once', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyHomeCarePlanSchema(prisma, VERSION_ID);

    const expectedKeys = HOME_CARE_PLAN_SEED.sections.flatMap((s) =>
      s.fields.map((f) => f.fieldKey as string),
    );
    const activeKeys = state.fields.filter((f) => f.isActive).map((f) => f.fieldKey);

    expect(stats.fields).toBe(expectedKeys.length);
    expect(new Set(activeKeys).size).toBe(activeKeys.length); // no duplicates
    for (const key of expectedKeys) {
      expect(activeKeys).toContain(key);
    }
  });

  it('is idempotent — a second run changes nothing and adopts nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyHomeCarePlanSchema(prisma, VERSION_ID);
    const idsAfterFirst = state.fields.map((f) => f.id).sort();
    const sectionIdsAfterFirst = state.sections.map((s) => s.id).sort();

    const second = await applyHomeCarePlanSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(idsAfterFirst);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIdsAfterFirst);
  });

  it('rejects a template field without an hcp_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyHomeCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          { title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] },
        ],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applyHomeCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          {
            title: 'X',
            fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'hsp_oops' } as never],
          },
        ],
      }),
    ).rejects.toThrow(/must start with hcp_/);
  });
});
