import { applyFallsCarePlanSchema } from '../../prisma/seeds/falls-care-plan-schema.util';
import {
  FALLS_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  FALLS_CARE_PLAN_SEED,
} from '../../prisma/seeds/falls-care-plan.seed-data';
import { HOME_CARE_PLAN_SEED } from '../../prisma/seeds/home-care-plan.seed-data';
import { HOME_SUPPORT_PLAN_SEED } from '../../prisma/seeds/home-support-plan.seed-data';
import { ADVANCE_CARE_PLAN_SEED } from '../../prisma/seeds/advance-care-plan.seed-data';
import { COGNITION_BEHAVIOUR_CARE_PLAN_SEED } from '../../prisma/seeds/cognition-behaviour-care-plan.seed-data';
import { CULTURE_RELIGION_CARE_PLAN_SEED } from '../../prisma/seeds/culture-religion-care-plan.seed-data';
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

const VERSION_ID = 'falls-version-1';

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

/** The Falls plan exactly as it exists before the Care 2020 merge (keyless). */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const history: Section = {
    id: 'section-falls-history',
    formVersionId: VERSION_ID,
    title: 'Falls history',
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
    sections: [history, prevention],
    fields: [
      field('field-count', history.id, 'Falls in last 12 months', 'NUMBER'),
      field('field-lastfall', history.id, 'Last fall date and circumstances', 'TEXTAREA'),
      field('field-injury', history.id, 'Injury from previous falls', 'YES_NO'),
      field('field-aids', prevention.id, 'Mobility aids in use', 'TEXT'),
      field('field-hazards', prevention.id, 'Environmental hazards identified', 'TEXTAREA'),
      field('field-transfers', prevention.id, 'Transfers – instructions', 'TEXTAREA'),
      field('field-physio', prevention.id, 'Referral to physiotherapy', 'YES_NO'),
    ],
  };
}

function seedFieldKeys(): string[] {
  return FALLS_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of FALLS_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Template contents
// --------------------------------------------------------------------------

describe('Falls Care Plan template', () => {
  it('retains all seven original local fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(FALLS_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(FALLS_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(7);
  });

  it('keeps the original field types, placeholder and required flag', () => {
    expect(seedField('falls_falls_last_12_months')?.fieldType).toBe('NUMBER');
    expect(seedField('falls_falls_last_12_months')?.placeholder).toBe('0');
    expect(seedField('falls_last_fall_details')?.fieldType).toBe('TEXTAREA');
    expect(seedField('falls_injury_from_previous')?.fieldType).toBe('YES_NO');
    expect(seedField('falls_mobility_aids')?.fieldType).toBe('TEXT');
    expect(seedField('falls_transfers_instructions')?.required).toBe(true);
    expect(seedField('falls_referral_physiotherapy')?.fieldType).toBe('YES_NO');
  });

  it('reuses the two original section titles so their UUIDs are preserved', () => {
    const titles = FALLS_CARE_PLAN_SEED.sections.map((s) => s.title);
    expect(titles).toContain('Falls history');
    expect(titles).toContain('Prevention plan');
  });

  it('adds the Care 2020 needs / goals / support / risk questions with the Care 2020 wording', () => {
    expect(seedField('falls_service_user_needs')?.label).toBe('What are the service user needs?');
    expect(seedField('falls_desired_goals_outcomes')?.label).toBe(
      'What are the service user desired goals/outcomes?',
    );
    expect(seedField('falls_support_required')?.label).toBe(
      'Support required to achieve the desired goals/outcomes?',
    );
    expect(seedField('falls_area_risk')?.label).toBe('Is there a risk associated with this area of care?');
    expect(seedField('falls_area_risk')?.fieldType).toBe('YES_NO');
  });

  it('contains no duplicate field keys and totals twelve', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(12);
  });

  it('gives every field a falls_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('falls_')).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// ID preservation and idempotency (protects real saved Falls data)
// --------------------------------------------------------------------------

describe('applyFallsCarePlanSchema', () => {
  it('adopts the seven pre-merge fields instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyFallsCarePlanSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(7);
    for (const [label, key] of Object.entries(FALLS_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('reuses the two original section UUIDs and adds the Care 2020 section', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyFallsCarePlanSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'Falls history')?.id).toBe('section-falls-history');
    expect(state.sections.find((s) => s.title === 'Prevention plan')?.id).toBe('section-prevention-plan');
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(3);
    expect(state.sections.some((s) => s.title === 'Needs, goals, support and risk')).toBe(true);
  });

  it('does not orphan an existing sectionId:fieldId saved key (draft or published)', async () => {
    const state = legacyState();
    const savedKey = 'section-falls-history:field-lastfall';
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyFallsCarePlanSchema(prisma, VERSION_ID);

    const [sectionId, fieldId] = savedKey.split(':');
    const section = state.sections.find((s) => s.id === sectionId);
    const field = state.fields.find((f) => f.id === fieldId);

    expect(section?.deletedAt).toBeNull();
    expect(field?.isActive).toBe(true);
    expect(field?.sectionId).toBe(sectionId);
    expect(field?.fieldKey).toBe('falls_last_fall_details');
  });

  it('deactivates nothing on a clean legacy form', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applyFallsCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('creates each field exactly once, ending with twelve unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyFallsCarePlanSchema(prisma, VERSION_ID);

    const activeKeys = state.fields.filter((f) => f.isActive).map((f) => f.fieldKey);
    expect(new Set(activeKeys).size).toBe(activeKeys.length);
    expect(activeKeys).toHaveLength(12);
    for (const key of seedFieldKeys()) {
      expect(activeKeys).toContain(key);
    }
  });

  it('is idempotent — a second run changes nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyFallsCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applyFallsCarePlanSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a falls_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyFallsCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applyFallsCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          {
            title: 'X',
            fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'crs_oops' } as never],
          },
        ],
      }),
    ).rejects.toThrow(/must start with falls_/);
  });
});

// --------------------------------------------------------------------------
// Other care plans must be unaffected
// --------------------------------------------------------------------------

describe('other care plans are unaffected', () => {
  it('keeps their field counts and prefixes', () => {
    const hcp = HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    const hsp = HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    const acp = ADVANCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    const cog = COGNITION_BEHAVIOUR_CARE_PLAN_SEED.sections.flatMap((s) =>
      s.fields.map((f) => f.fieldKey as string),
    );
    const crs = CULTURE_RELIGION_CARE_PLAN_SEED.sections.flatMap((s) =>
      s.fields.map((f) => f.fieldKey as string),
    );
    expect(hcp).toHaveLength(36);
    expect(hsp).toHaveLength(45);
    expect(acp).toHaveLength(11);
    expect(cog).toHaveLength(12);
    expect(crs).toHaveLength(11);
  });

  it('shares no field keys with any other plan', () => {
    const others = new Set([
      ...HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...ADVANCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...COGNITION_BEHAVIOUR_CARE_PLAN_SEED.sections.flatMap((s) =>
        s.fields.map((f) => f.fieldKey as string),
      ),
      ...CULTURE_RELIGION_CARE_PLAN_SEED.sections.flatMap((s) =>
        s.fields.map((f) => f.fieldKey as string),
      ),
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
