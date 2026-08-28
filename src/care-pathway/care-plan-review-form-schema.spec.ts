import { applyCarePlanReviewFormSchema } from '../../prisma/seeds/care-plan-review-form-schema.util';
import {
  CARE_PLAN_REVIEW_FORM_LEGACY_LABEL_TO_KEY,
  CARE_PLAN_REVIEW_FORM_SEED,
} from '../../prisma/seeds/care-plan-review-form.seed-data';
import { CARE_PLAN_REVIEW_FIELD_MAPPINGS } from '../service-user-care-plans/compose/care-plan-review.compose';
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

const VERSION_ID = 'care-plan-review-version-1';

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

/** The Review form exactly as it exists before the Care 2020 merge (keyless, 2 sections). */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const details: Section = {
    id: 'section-review-details',
    formVersionId: VERSION_ID,
    title: 'Review details',
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
    sections: [details, outcomes],
    fields: [
      field('field-date', details.id, 'Review date', 'DATE', 0, true),
      field('field-type', details.id, 'Review type', 'SELECT', 1, false, {
        options: ['Scheduled', 'Unscheduled', 'Post-incident', 'Hospital discharge'],
      }),
      field('field-reviewer', details.id, 'Reviewer name and role', 'TEXT', 2, true),
      field('field-needs', outcomes.id, 'Care plan still meeting needs', 'YES_NO', 0, true),
      field('field-changes', outcomes.id, 'Changes required', 'TEXTAREA', 1),
      field('field-actions', outcomes.id, 'Actions and responsible person', 'TEXTAREA', 2),
      field('field-next', outcomes.id, 'Next review date', 'DATE', 3),
    ],
  };
}

function seedFieldKeys(): string[] {
  return CARE_PLAN_REVIEW_FORM_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of CARE_PLAN_REVIEW_FORM_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Template contents
// --------------------------------------------------------------------------

describe('Care Plan review form template', () => {
  it('retains all seven original project fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(CARE_PLAN_REVIEW_FORM_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(CARE_PLAN_REVIEW_FORM_LEGACY_LABEL_TO_KEY)).toHaveLength(7);
  });

  it('preserves the existing Review details field types, required flags and SELECT options', () => {
    expect(seedField('care_plan_review_review_date')?.fieldType).toBe('DATE');
    expect(seedField('care_plan_review_review_date')?.required).toBe(true);
    expect(seedField('care_plan_review_review_type')?.fieldType).toBe('SELECT');
    expect(seedField('care_plan_review_review_type')?.options).toEqual([
      'Scheduled',
      'Unscheduled',
      'Post-incident',
      'Hospital discharge',
    ]);
    expect(seedField('care_plan_review_reviewer')?.fieldType).toBe('TEXT');
    expect(seedField('care_plan_review_reviewer')?.required).toBe(true);
  });

  it('preserves the existing Outcomes fields (types + required)', () => {
    expect(seedField('care_plan_review_meeting_needs')?.fieldType).toBe('YES_NO');
    expect(seedField('care_plan_review_meeting_needs')?.required).toBe(true);
    expect(seedField('care_plan_review_changes_required')?.fieldType).toBe('TEXTAREA');
    expect(seedField('care_plan_review_actions')?.fieldType).toBe('TEXTAREA');
    expect(seedField('care_plan_review_next_review_date')?.fieldType).toBe('DATE');
  });

  it('adds the Review assessment section in the middle with the ten engine-mapped fields', () => {
    expect(CARE_PLAN_REVIEW_FORM_SEED.sections.map((s) => s.title)).toEqual([
      'Review details',
      'Review assessment',
      'Outcomes',
    ]);
    const assessment = CARE_PLAN_REVIEW_FORM_SEED.sections[1].fields;
    expect(assessment.map((f) => f.fieldKey)).toEqual([
      'care_plan_review_physical_wellbeing',
      'care_plan_review_diagnoses_conditions',
      'care_plan_review_equipment',
      'care_plan_review_environment_access',
      'care_plan_review_eating_drinking',
      'care_plan_review_nutrition',
      'care_plan_review_medication_support',
      'care_plan_review_active_medications',
      'care_plan_review_capacity_consent',
      'care_plan_review_cognitive_emotional',
    ]);
    for (const f of assessment) {
      expect(f.fieldType).toBe('TEXTAREA');
    }
  });

  it('uses labels that the existing compose engine already maps (no dead fields, no new engine)', () => {
    const engineLabels = new Set(CARE_PLAN_REVIEW_FIELD_MAPPINGS.map((m) => m.fieldLabel));
    for (const f of CARE_PLAN_REVIEW_FORM_SEED.sections[1].fields) {
      expect(engineLabels.has(f.label)).toBe(true);
    }
  });

  it('contains no duplicate field keys and totals seventeen', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(17);
  });

  it('gives every field a care_plan_review_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('care_plan_review_')).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// ID preservation, order, saved-value safety and idempotency
// --------------------------------------------------------------------------

describe('applyCarePlanReviewFormSchema', () => {
  it('adopts the seven pre-merge fields (UUIDs preserved) instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyCarePlanReviewFormSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(7);
    for (const [label, key] of Object.entries(CARE_PLAN_REVIEW_FORM_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('preserves existing field UUIDs, types, required flags, options and ordering', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyCarePlanReviewFormSchema(prisma, VERSION_ID);

    const type = state.fields.find((f) => f.id === 'field-type')!;
    expect(type.fieldKey).toBe('care_plan_review_review_type');
    expect(type.fieldType).toBe('SELECT');
    expect(type.optionsJson).toEqual({ options: ['Scheduled', 'Unscheduled', 'Post-incident', 'Hospital discharge'] });

    const date = state.fields.find((f) => f.id === 'field-date')!;
    expect(date.required).toBe(true);
    const needs = state.fields.find((f) => f.id === 'field-needs')!;
    expect(needs.required).toBe(true);
    expect(needs.fieldType).toBe('YES_NO');
  });

  it('reuses the two original section UUIDs and inserts the Review assessment section between them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyCarePlanReviewFormSchema(prisma, VERSION_ID);

    const details = state.sections.find((s) => s.title === 'Review details')!;
    const outcomes = state.sections.find((s) => s.title === 'Outcomes')!;
    const assessment = state.sections.find((s) => s.title === 'Review assessment')!;
    expect(details.id).toBe('section-review-details');
    expect(outcomes.id).toBe('section-outcomes');
    expect(details.sortOrder).toBe(0);
    expect(assessment.sortOrder).toBe(1);
    expect(outcomes.sortOrder).toBe(2);
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(3);
  });

  it('creates each field exactly once, ending with seventeen unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyCarePlanReviewFormSchema(prisma, VERSION_ID);

    const activeKeys = state.fields.filter((f) => f.isActive).map((f) => f.fieldKey);
    expect(new Set(activeKeys).size).toBe(activeKeys.length);
    expect(activeKeys).toHaveLength(17);
    for (const key of seedFieldKeys()) {
      expect(activeKeys).toContain(key);
    }
  });

  it('deactivates nothing on a clean legacy form', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applyCarePlanReviewFormSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('deactivates a stray legacy field not in the final seed (idempotently, never deleted)', async () => {
    const state = legacyState();
    state.fields.push({
      id: 'field-stray',
      sectionId: 'section-outcomes',
      fieldKey: 'care_plan_review_legacy_extra',
      label: 'Legacy extra',
      fieldType: 'TEXT',
      placeholder: null,
      helpText: null,
      required: false,
      optionsJson: null,
      sortOrder: 9,
      isActive: true,
      deletedAt: null,
    });

    const prisma = makeFakePrisma(state.sections, state.fields);
    const first = await applyCarePlanReviewFormSchema(prisma, VERSION_ID);
    const stray = state.fields.find((f) => f.id === 'field-stray')!;
    expect(first.deactivated).toBe(1);
    expect(stray.isActive).toBe(false);
    expect(stray.deletedAt).toBeNull(); // deactivated, never deleted

    const second = await applyCarePlanReviewFormSchema(prisma, VERSION_ID);
    expect(second.deactivated).toBe(0);
  });

  it('is idempotent — a second run changes nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyCarePlanReviewFormSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applyCarePlanReviewFormSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a care_plan_review_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyCarePlanReviewFormSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applyCarePlanReviewFormSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          { title: 'X', fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'pain_management_oops' } as never] },
        ],
      }),
    ).rejects.toThrow(/must start with care_plan_review_/);
  });
});
