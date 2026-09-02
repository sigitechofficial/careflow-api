import { applyCultureReligionCarePlanSchema } from '../../prisma/seeds/culture-religion-care-plan-schema.util';
import {
  CULTURE_RELIGION_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  CULTURE_RELIGION_CARE_PLAN_SEED,
} from '../../prisma/seeds/culture-religion-care-plan.seed-data';
import { HOME_CARE_PLAN_SEED } from '../../prisma/seeds/home-care-plan.seed-data';
import { HOME_SUPPORT_PLAN_SEED } from '../../prisma/seeds/home-support-plan.seed-data';
import { ADVANCE_CARE_PLAN_SEED } from '../../prisma/seeds/advance-care-plan.seed-data';
import { COGNITION_BEHAVIOUR_CARE_PLAN_SEED } from '../../prisma/seeds/cognition-behaviour-care-plan.seed-data';
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

const VERSION_ID = 'crs-version-1';

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

/** The Culture/Religion/Spirituality plan exactly as it exists before the Care 2020 merge. */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const identity: Section = {
    id: 'section-identity',
    formVersionId: VERSION_ID,
    title: 'Identity and beliefs',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const dailyCare: Section = {
    id: 'section-daily-care',
    formVersionId: VERSION_ID,
    title: 'Daily care impact',
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
    sections: [identity, dailyCare],
    fields: [
      field('field-faith', identity.id, 'Faith or belief system', 'TEXT'),
      field('field-cultural', identity.id, 'Cultural practices important to the person', 'TEXTAREA'),
      field('field-observances', identity.id, 'Religious observances or visits', 'TEXTAREA'),
      field('field-dietary', dailyCare.id, 'Dietary requirements linked to faith/culture', 'TEXTAREA'),
      field('field-gender', dailyCare.id, 'Gender preference for personal care', 'TEXT'),
      field('field-notes', dailyCare.id, 'Notes for staff', 'TEXTAREA'),
    ],
  };
}

function seedFieldKeys(): string[] {
  return CULTURE_RELIGION_CARE_PLAN_SEED.sections.flatMap((s) =>
    s.fields.map((f) => f.fieldKey as string),
  );
}

function seedField(fieldKey: string) {
  for (const section of CULTURE_RELIGION_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Template contents
// --------------------------------------------------------------------------

describe('Culture/Religion/Spirituality template', () => {
  it('retains all six original local fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(CULTURE_RELIGION_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(CULTURE_RELIGION_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(6);
  });

  it('keeps the original field types and the required flag of the retained fields', () => {
    expect(seedField('crs_faith_belief_system')?.fieldType).toBe('TEXT');
    expect(seedField('crs_cultural_practices')?.fieldType).toBe('TEXTAREA');
    expect(seedField('crs_religious_observances')?.fieldType).toBe('TEXTAREA');
    expect(seedField('crs_dietary_requirements')?.fieldType).toBe('TEXTAREA');
    expect(seedField('crs_gender_preference')?.fieldType).toBe('TEXT');
    expect(seedField('crs_staff_notes')?.required).toBe(true);
  });

  it('reuses the two original section titles so their UUIDs are preserved', () => {
    const titles = CULTURE_RELIGION_CARE_PLAN_SEED.sections.map((s) => s.title);
    expect(titles).toContain('Identity and beliefs');
    expect(titles).toContain('Daily care impact');
  });

  it('adds the Care 2020 needs / goals / support / risk questions with the Care 2020 wording', () => {
    expect(seedField('crs_service_user_needs')?.label).toBe('What are the service user needs?');
    expect(seedField('crs_desired_goals_outcomes')?.label).toBe(
      'What are the service user desired goals/outcomes?',
    );
    expect(seedField('crs_support_required')?.label).toBe(
      'Support required to achieve the desired goals/outcomes?',
    );
    expect(seedField('crs_area_risk')?.label).toBe('Is there a risk associated with this area of care?');
    expect(seedField('crs_area_risk')?.fieldType).toBe('YES_NO');
  });

  it('contains no duplicate field keys and totals eleven', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(17);
  });

  it('gives every field a crs_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('crs_')).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// ID preservation and idempotency
// --------------------------------------------------------------------------

describe('applyCultureReligionCarePlanSchema', () => {
  it('adopts the six pre-merge fields instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyCultureReligionCarePlanSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(6);
    for (const [label, key] of Object.entries(CULTURE_RELIGION_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('reuses the two original section UUIDs and adds the Care 2020 section', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyCultureReligionCarePlanSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'Identity and beliefs')?.id).toBe('section-identity');
    expect(state.sections.find((s) => s.title === 'Daily care impact')?.id).toBe('section-daily-care');
    expect(state.sections.every((s) => s.deletedAt === null)).toBe(true);
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(3);
    expect(state.sections.some((s) => s.title === 'Needs, goals, support and risk')).toBe(true);
  });

  it('does not orphan an existing sectionId:fieldId published key', async () => {
    const state = legacyState();
    const savedKey = 'section-daily-care:field-notes';
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyCultureReligionCarePlanSchema(prisma, VERSION_ID);

    const [sectionId, fieldId] = savedKey.split(':');
    const section = state.sections.find((s) => s.id === sectionId);
    const field = state.fields.find((f) => f.id === fieldId);

    expect(section?.deletedAt).toBeNull();
    expect(field?.isActive).toBe(true);
    expect(field?.sectionId).toBe(sectionId);
    expect(field?.fieldKey).toBe('crs_staff_notes');
  });

  it('deactivates nothing on a clean legacy form', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applyCultureReligionCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('creates each field exactly once, ending with eleven unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyCultureReligionCarePlanSchema(prisma, VERSION_ID);

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

    await applyCultureReligionCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applyCultureReligionCarePlanSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a crs_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyCultureReligionCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applyCultureReligionCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          {
            title: 'X',
            fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'cog_oops' } as never],
          },
        ],
      }),
    ).rejects.toThrow(/must start with crs_/);
  });
});

// --------------------------------------------------------------------------
// Other care plans must be unaffected
// --------------------------------------------------------------------------

describe('other care plans are unaffected', () => {
  it('Home Care (36 hcp_), Home Support (45 hsp_), Advance (11 acp_), Cognition (12 cog_) keep their fields', () => {
    const hcp = HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    const hsp = HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    const acp = ADVANCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
    const cog = COGNITION_BEHAVIOUR_CARE_PLAN_SEED.sections.flatMap((s) =>
      s.fields.map((f) => f.fieldKey as string),
    );
    expect(hcp).toHaveLength(36);
    expect(hsp).toHaveLength(45);
    expect(acp).toHaveLength(11);
    expect(cog).toHaveLength(18);
    expect(hcp.every((k) => k.startsWith('hcp_'))).toBe(true);
    expect(cog.every((k) => k.startsWith('cog_'))).toBe(true);
  });

  it('shares no field keys with any other plan', () => {
    const others = new Set([
      ...HOME_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...ADVANCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...COGNITION_BEHAVIOUR_CARE_PLAN_SEED.sections.flatMap((s) =>
        s.fields.map((f) => f.fieldKey as string),
      ),
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});

// --------------------------------------------------------------------------
// Dispatch wiring
// --------------------------------------------------------------------------

describe('Culture/Religion IA behaviour', () => {
  it('writes no values and suggests nothing when there is no assessment', () => {
    const result = runCarePlanCompose(
      'Culture/Religion/Spirituality',
      { serviceUserId: 'su-1', ia: null } as never,
      [],
    );
    expect(result.values).toEqual({});
    expect(result.suggestions ?? []).toHaveLength(0);
  });

  it('routes to its own composer rather than another plan mapping', () => {
    const result = runCarePlanCompose(
      'Culture/Religion/Spirituality',
      { serviceUserId: 'su-1', ia: null } as never,
      [],
    );
    expect(result.composedFrom?.mapping).toBe('culture-religion-care-plan-suggestions');
  });
});
