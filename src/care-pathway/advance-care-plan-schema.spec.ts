import { applyAdvanceCarePlanSchema } from '../../prisma/seeds/advance-care-plan-schema.util';
import {
  ADVANCE_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  ADVANCE_CARE_PLAN_SEED,
  ACP_TREATMENT_ESCALATION_OPTIONS,
} from '../../prisma/seeds/advance-care-plan.seed-data';
import { HOME_CARE_PLAN_SEED } from '../../prisma/seeds/home-care-plan.seed-data';
import { HOME_SUPPORT_PLAN_SEED } from '../../prisma/seeds/home-support-plan.seed-data';
import { runCarePlanCompose } from '../service-user-care-plans/compose/compose-context.loader';
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

const VERSION_ID = 'acp-version-1';

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

/** The Advance Care Plan exactly as it exists before the Care 2020 merge. */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const planning: Section = {
    id: 'section-planning-discussion',
    formVersionId: VERSION_ID,
    title: 'Planning discussion',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const prefs: Section = {
    id: 'section-preferences',
    formVersionId: VERSION_ID,
    title: 'Preferences and decisions',
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
    sections: [planning, prefs],
    fields: [
      field('field-discussion-date', planning.id, 'Date of discussion', 'DATE'),
      field('field-people-present', planning.id, 'People present', 'TEXTAREA'),
      field('field-capacity', planning.id, 'Capacity to participate', 'YES_NO'),
      field('field-escalation', prefs.id, 'Treatment escalation preferences', 'SELECT'),
      field('field-dnacpr', prefs.id, 'DNACPR in place', 'YES_NO'),
      field('field-place-of-care', prefs.id, 'Preferred place of care if deteriorating', 'TEXT'),
      field('field-wishes', prefs.id, 'Summary of expressed wishes', 'TEXTAREA'),
    ],
  };
}

function seedFieldKeys(): string[] {
  return ADVANCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of ADVANCE_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Template contents
// --------------------------------------------------------------------------

describe('Advance Care Plan template', () => {
  it('retains all seven original local fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(ADVANCE_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(ADVANCE_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(7);
  });

  it('keeps the original field types and options of the retained fields', () => {
    expect(seedField('acp_discussion_date')?.fieldType).toBe('DATE');
    expect(seedField('acp_people_present')?.fieldType).toBe('TEXTAREA');
    expect(seedField('acp_capacity_to_participate')?.fieldType).toBe('YES_NO');
    expect(seedField('acp_treatment_escalation')?.fieldType).toBe('SELECT');
    expect(seedField('acp_treatment_escalation')?.options).toEqual(ACP_TREATMENT_ESCALATION_OPTIONS);
    expect(seedField('acp_dnacpr_in_place')?.fieldType).toBe('YES_NO');
    expect(seedField('acp_preferred_place_of_care')?.fieldType).toBe('TEXT');
    expect(seedField('acp_summary_of_wishes')?.fieldType).toBe('TEXTAREA');
  });

  it('reuses the two original section titles so their UUIDs are preserved', () => {
    const titles = ADVANCE_CARE_PLAN_SEED.sections.map((s) => s.title);
    expect(titles).toContain('Planning discussion');
    expect(titles).toContain('Preferences and decisions');
  });

  it('adds the unambiguous Care 2020 questions', () => {
    const keys = seedFieldKeys();
    expect(keys).toContain('acp_service_user_needs');
    expect(keys).toContain('acp_desired_goals_outcomes');
    expect(keys).toContain('acp_support_required');
    expect(keys).toContain('acp_adrt_details');
  });

  it('uses the Care 2020 wording for the added questions', () => {
    expect(seedField('acp_service_user_needs')?.label).toBe('What are the service user needs?');
    expect(seedField('acp_desired_goals_outcomes')?.label).toBe(
      'What are the service user desired goals/outcomes?',
    );
    expect(seedField('acp_support_required')?.label).toBe(
      'Support required to achieve the desired goals/outcomes?',
    );
    expect(seedField('acp_adrt_details')?.label).toBe(
      'Details of Advance Decision To Refuse Treatment (including DNACPR)',
    );
  });

  it('keeps the DNACPR flag and the ADRT narrative as two distinct fields', () => {
    expect(seedField('acp_dnacpr_in_place')?.fieldType).toBe('YES_NO');
    expect(seedField('acp_adrt_details')?.fieldType).toBe('TEXTAREA');
    expect(seedField('acp_dnacpr_in_place')?.fieldKey).not.toBe(seedField('acp_adrt_details')?.fieldKey);
  });

  it('contains no duplicate field keys', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(11);
  });

  it('gives every field an acp_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('acp_')).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// ID preservation and idempotency
// --------------------------------------------------------------------------

describe('applyAdvanceCarePlanSchema', () => {
  it('adopts the seven pre-merge fields instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyAdvanceCarePlanSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(7);
    for (const [label, key] of Object.entries(ADVANCE_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('reuses the two original section UUIDs', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyAdvanceCarePlanSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'Planning discussion')?.id).toBe(
      'section-planning-discussion',
    );
    expect(state.sections.find((s) => s.title === 'Preferences and decisions')?.id).toBe(
      'section-preferences',
    );
    expect(state.sections.every((s) => s.deletedAt === null)).toBe(true);
  });

  it('does not orphan an existing sectionId:fieldId draft key', async () => {
    const state = legacyState();
    const savedKey = 'section-preferences:field-wishes';
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyAdvanceCarePlanSchema(prisma, VERSION_ID);

    const [sectionId, fieldId] = savedKey.split(':');
    const section = state.sections.find((s) => s.id === sectionId);
    const field = state.fields.find((f) => f.id === fieldId);

    expect(section?.deletedAt).toBeNull();
    expect(field?.isActive).toBe(true);
    expect(field?.sectionId).toBe(sectionId);
    expect(field?.fieldKey).toBe('acp_summary_of_wishes');
  });

  it('deactivates nothing on a clean legacy form', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applyAdvanceCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('creates each new Care 2020 field exactly once', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyAdvanceCarePlanSchema(prisma, VERSION_ID);

    const activeKeys = state.fields.filter((f) => f.isActive).map((f) => f.fieldKey);
    expect(new Set(activeKeys).size).toBe(activeKeys.length);
    for (const key of seedFieldKeys()) {
      expect(activeKeys).toContain(key);
    }
  });

  it('is idempotent — a second run changes nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyAdvanceCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applyAdvanceCarePlanSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without an acp_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyAdvanceCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applyAdvanceCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          {
            title: 'X',
            fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'hcp_oops' } as never],
          },
        ],
      }),
    ).rejects.toThrow(/must start with acp_/);
  });
});

// --------------------------------------------------------------------------
// Other care plans must be unaffected
// --------------------------------------------------------------------------

describe('other care plans are unaffected', () => {
  it('Home Care Plan still has its 36 hcp_ fields', () => {
    const keys = HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    expect(keys).toHaveLength(36);
    expect(keys.every((k) => k.startsWith('hcp_'))).toBe(true);
  });

  it('Home Support Plan still has its 45 hsp_ fields', () => {
    const keys = HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    expect(keys).toHaveLength(45);
    expect(keys.every((k) => k.startsWith('hsp_'))).toBe(true);
  });

  it('shares no field keys with Home Care Plan or Home Support Plan', () => {
    const others = new Set([
      ...HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});

// --------------------------------------------------------------------------
// No IA wiring was added
// --------------------------------------------------------------------------

describe('Advance Care Plan IA behaviour', () => {
  it('writes no values and suggests nothing when there is no assessment', () => {
    const result = runCarePlanCompose('Advance', { serviceUserId: 'su-1', ia: null } as never, []);
    expect(result.values).toEqual({});
    expect(result.suggestions ?? []).toHaveLength(0);
  });

  it('routes to its own composer rather than another plan mapping', () => {
    const result = runCarePlanCompose('Advance', { serviceUserId: 'su-1', ia: null } as never, []);
    expect(result.composedFrom?.mapping).toBe('advance-care-plan-suggestions');
  });
});
