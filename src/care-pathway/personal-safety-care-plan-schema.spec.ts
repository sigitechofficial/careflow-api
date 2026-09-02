import { applyPersonalSafetyCarePlanSchema } from '../../prisma/seeds/personal-safety-care-plan-schema.util';
import {
  PERSONAL_SAFETY_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  PERSONAL_SAFETY_CARE_PLAN_SEED,
} from '../../prisma/seeds/personal-safety-care-plan.seed-data';
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
import { SKIN_INTEGRITY_CARE_PLAN_SEED } from '../../prisma/seeds/skin-integrity-care-plan.seed-data';
import { PSYCHOLOGICAL_CARE_PLAN_SEED } from '../../prisma/seeds/psychological-care-plan.seed-data';
import { COMMUNICATION_CARE_PLAN_SEED } from '../../prisma/seeds/communication-care-plan.seed-data';
import { CONTINENCE_CARE_PLAN_SEED } from '../../prisma/seeds/continence-care-plan.seed-data';
import { EATING_AND_DRINKING_CARE_PLAN_SEED } from '../../prisma/seeds/eating-and-drinking-care-plan.seed-data';
import { PHYSICAL_HEALTH_CARE_PLAN_SEED } from '../../prisma/seeds/physical-health-care-plan.seed-data';
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

const VERSION_ID = 'personal-safety-version-1';

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

/** The Personal Safety plan exactly as it exists before the Care 2020 merge (keyless). */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const risk: Section = {
    id: 'section-risk-environment',
    formVersionId: VERSION_ID,
    title: 'Risk and environment',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const safeguarding: Section = {
    id: 'section-safeguarding',
    formVersionId: VERSION_ID,
    title: 'Safeguarding',
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
    sections: [risk, safeguarding],
    fields: [
      field('field-hazards', risk.id, 'Home hazards identified', 'TEXTAREA', 0),
      field('field-smoking', risk.id, 'Smoking / fire safety', 'TEXT', 1),
      field('field-lone', risk.id, 'Lone worker risk level', 'SELECT', 2, false, {
        options: ['Low', 'Medium', 'High'],
      }),
      field('field-concern', safeguarding.id, 'Safeguarding concern on file', 'YES_NO', 0),
      field('field-actions', safeguarding.id, 'Actions in place', 'TEXTAREA', 1),
      field('field-contacts', safeguarding.id, 'Emergency contacts', 'TEXTAREA', 2, true),
    ],
  };
}

function seedFieldKeys(): string[] {
  return PERSONAL_SAFETY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of PERSONAL_SAFETY_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Template contents
// --------------------------------------------------------------------------

describe('Personal Safety Care Plan template', () => {
  it('retains all six original local fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(PERSONAL_SAFETY_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(PERSONAL_SAFETY_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(6);
  });

  it('keeps the original field types, required flags and SELECT options/order', () => {
    expect(seedField('personal_safety_home_hazards')?.fieldType).toBe('TEXTAREA');
    expect(seedField('personal_safety_smoking_fire_safety')?.fieldType).toBe('TEXT');
    expect(seedField('personal_safety_lone_worker_risk')?.fieldType).toBe('SELECT');
    expect(seedField('personal_safety_lone_worker_risk')?.options).toEqual(['Low', 'Medium', 'High']);
    expect(seedField('personal_safety_safeguarding_concern')?.fieldType).toBe('YES_NO');
    expect(seedField('personal_safety_actions_in_place')?.fieldType).toBe('TEXTAREA');
    expect(seedField('personal_safety_emergency_contacts')?.fieldType).toBe('TEXTAREA');
    expect(seedField('personal_safety_emergency_contacts')?.required).toBe(true);
  });

  it('reuses the two original section titles and adds the Care 2020 section', () => {
    expect(PERSONAL_SAFETY_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Risk and environment',
      'Safeguarding',
      'Needs, goals, support and risk',
    ]);
  });

  it('adds the five Care 2020 fields in order with exactly one required Person-centred details', () => {
    const care2020 = PERSONAL_SAFETY_CARE_PLAN_SEED.sections[2].fields;
    expect(care2020.map((f) => f.fieldKey)).toEqual([
      'personal_safety_service_user_needs',
      'personal_safety_needs_person_centred',
      'personal_safety_desired_goals_outcomes',
      'personal_safety_support_required',
      'personal_safety_area_risk',
      'personal_safety_risk_identify',
      'personal_safety_risk_who_might_be_harmed',
      'personal_safety_risk_level',
      'personal_safety_risk_likelihood',
      'personal_safety_risk_triggers',
      'personal_safety_risk_management',
    ]);
    expect(care2020.map((f) => f.label)).toEqual([
      'What are the service user needs?',
      'Person-centred details',
      'What are the service user desired goals/outcomes?',
      'Support required to achieve the desired goals/outcomes?',
      'Is there a risk associated with this area of care?',
      'Identify the risk?',
      'Who might be harmed?',
      'What is the risk level?',
      'How likely is it to occur?',
      'What are the triggers?',
      'How can the risk be reduced and managed?',
    ]);
    expect(seedField('personal_safety_area_risk')?.fieldType).toBe('YES_NO');
    for (const key of [
      'personal_safety_service_user_needs',
      'personal_safety_needs_person_centred',
      'personal_safety_desired_goals_outcomes',
      'personal_safety_support_required',
    ]) {
      expect(seedField(key)?.fieldType).toBe('TEXTAREA');
    }
    const pcd = PERSONAL_SAFETY_CARE_PLAN_SEED.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.label === 'Person-centred details');
    expect(pcd).toHaveLength(1);
    expect(pcd[0].fieldKey).toBe('personal_safety_needs_person_centred');
    expect(pcd[0].required).toBe(true);
  });

  it('does NOT create goals/support person-centred duplicates or an emergency-procedure field', () => {
    const keys = seedFieldKeys();
    expect(keys).not.toContain('personal_safety_goals_person_centred');
    expect(keys).not.toContain('personal_safety_support_person_centred');
    expect(keys.some((k) => k.includes('emergency_procedure'))).toBe(false);
  });

  it('contains no duplicate field keys and totals eleven', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(17);
  });

  it('gives every field a personal_safety_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('personal_safety_')).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// ID preservation, order, saved-value safety and idempotency
// --------------------------------------------------------------------------

describe('applyPersonalSafetyCarePlanSchema', () => {
  it('adopts the six pre-merge fields (UUIDs preserved) instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyPersonalSafetyCarePlanSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(6);
    for (const [label, key] of Object.entries(PERSONAL_SAFETY_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('preserves existing field types, required flags, options and ordering after apply', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPersonalSafetyCarePlanSchema(prisma, VERSION_ID);

    const lone = state.fields.find((f) => f.id === 'field-lone')!;
    expect(lone.fieldKey).toBe('personal_safety_lone_worker_risk');
    expect(lone.fieldType).toBe('SELECT');
    expect(lone.optionsJson).toEqual({ options: ['Low', 'Medium', 'High'] });
    expect(lone.sortOrder).toBe(2);

    const contacts = state.fields.find((f) => f.id === 'field-contacts')!;
    expect(contacts.required).toBe(true);
    expect(contacts.sortOrder).toBe(2);
  });

  it('makes the Care 2020 Person-centred details field required', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPersonalSafetyCarePlanSchema(prisma, VERSION_ID);

    const pcd = state.fields.find((f) => f.fieldKey === 'personal_safety_needs_person_centred')!;
    expect(pcd.required).toBe(true);
    expect(pcd.isActive).toBe(true);
  });

  it('reuses the two original section UUIDs and adds the Care 2020 section', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPersonalSafetyCarePlanSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'Risk and environment')?.id).toBe('section-risk-environment');
    expect(state.sections.find((s) => s.title === 'Safeguarding')?.id).toBe('section-safeguarding');
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(3);
    expect(state.sections.some((s) => s.title === 'Needs, goals, support and risk')).toBe(true);
  });

  it('keeps VALID saved sectionId:fieldId references valid (fields survive, sections survive)', async () => {
    const state = legacyState();
    const validKeys = ['section-risk-environment:field-hazards', 'section-safeguarding:field-contacts'];
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPersonalSafetyCarePlanSchema(prisma, VERSION_ID);

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

  it('deactivates nothing on a clean legacy form', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);
    const stats = await applyPersonalSafetyCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('creates each field exactly once, ending with eleven unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPersonalSafetyCarePlanSchema(prisma, VERSION_ID);

    const activeKeys = state.fields.filter((f) => f.isActive).map((f) => f.fieldKey);
    expect(new Set(activeKeys).size).toBe(activeKeys.length);
    expect(activeKeys).toHaveLength(17);
    for (const key of seedFieldKeys()) {
      expect(activeKeys).toContain(key);
    }
  });

  it('deactivates a stray legacy duplicate PCD not in the final seed (idempotently, never deleted)', async () => {
    const state = legacyState();
    state.fields.push({
      id: 'field-dup-pcd',
      sectionId: 'section-safeguarding',
      fieldKey: 'personal_safety_goals_person_centred',
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
    const first = await applyPersonalSafetyCarePlanSchema(prisma, VERSION_ID);
    const dup = state.fields.find((f) => f.id === 'field-dup-pcd')!;
    expect(first.deactivated).toBe(1);
    expect(dup.isActive).toBe(false);
    expect(dup.deletedAt).toBeNull(); // deactivated, never deleted — UUID + any saved value preserved

    const second = await applyPersonalSafetyCarePlanSchema(prisma, VERSION_ID);
    expect(second.deactivated).toBe(0);
    expect(state.fields.filter((f) => f.isActive && f.label === 'Person-centred details')).toHaveLength(1);
  });

  it('is idempotent — a second run changes nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPersonalSafetyCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applyPersonalSafetyCarePlanSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a personal_safety_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyPersonalSafetyCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applyPersonalSafetyCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          { title: 'X', fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'pain_management_oops' } as never] },
        ],
      }),
    ).rejects.toThrow(/must start with personal_safety_/);
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
    expect(MEDICATION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
    expect(MOBILITY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(19);
    expect(PAIN_MANAGEMENT_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(18);
    expect(SKIN_INTEGRITY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(16);
    expect(PSYCHOLOGICAL_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
    expect(COMMUNICATION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(18);
    expect(CONTINENCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
    expect(EATING_AND_DRINKING_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
    expect(PHYSICAL_HEALTH_CARE_PLAN_SEED.sections.flatMap((s) => s.fields)).toHaveLength(17);
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
      ...SKIN_INTEGRITY_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...PSYCHOLOGICAL_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...COMMUNICATION_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...CONTINENCE_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...EATING_AND_DRINKING_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
      ...PHYSICAL_HEALTH_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
