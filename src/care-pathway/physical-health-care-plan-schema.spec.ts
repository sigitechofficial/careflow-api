import { applyPhysicalHealthCarePlanSchema } from '../../prisma/seeds/physical-health-care-plan-schema.util';
import {
  PHYSICAL_HEALTH_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  PHYSICAL_HEALTH_CARE_PLAN_SEED,
} from '../../prisma/seeds/physical-health-care-plan.seed-data';
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

const VERSION_ID = 'physical-health-version-1';

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

/** The Physical Health plan exactly as it exists before the Care 2020 merge (keyless). */
function legacyState(): { sections: Section[]; fields: Field[] } {
  const conditions: Section = {
    id: 'section-health-conditions',
    formVersionId: VERSION_ID,
    title: 'Health conditions',
    description: null,
    sortOrder: 0,
    deletedAt: null,
  };
  const monitoring: Section = {
    id: 'section-monitoring',
    formVersionId: VERSION_ID,
    title: 'Monitoring',
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
  ): Field => ({
    id,
    sectionId,
    fieldKey: null,
    label,
    fieldType,
    placeholder: null,
    helpText: null,
    required,
    optionsJson: null,
    sortOrder,
    isActive: true,
    deletedAt: null,
  });

  return {
    sections: [conditions, monitoring],
    fields: [
      field('field-diagnoses', conditions.id, 'Primary diagnoses', 'TEXTAREA', 0, true),
      field('field-admissions', conditions.id, 'Recent hospital admissions', 'TEXTAREA', 1),
      field('field-gp', conditions.id, 'GP surgery and named GP', 'TEXT', 2),
      field('field-news2', monitoring.id, 'Vital signs or NEWS2 required', 'YES_NO', 0),
      field('field-glucose', monitoring.id, 'Blood glucose monitoring', 'YES_NO', 1),
      field('field-urgent', monitoring.id, 'When to seek urgent medical advice', 'TEXTAREA', 2, true),
    ],
  };
}

function seedFieldKeys(): string[] {
  return PHYSICAL_HEALTH_CARE_PLAN_SEED.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string));
}

function seedField(fieldKey: string) {
  for (const section of PHYSICAL_HEALTH_CARE_PLAN_SEED.sections) {
    const field = section.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Template contents
// --------------------------------------------------------------------------

describe('Physical Health Care Plan template', () => {
  it('retains all six original local fields', () => {
    const keys = seedFieldKeys();
    for (const legacyKey of Object.values(PHYSICAL_HEALTH_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      expect(keys).toContain(legacyKey);
    }
    expect(Object.keys(PHYSICAL_HEALTH_CARE_PLAN_LEGACY_LABEL_TO_KEY)).toHaveLength(6);
  });

  it('keeps the original field types and required flags', () => {
    expect(seedField('physical_health_primary_diagnoses')?.fieldType).toBe('TEXTAREA');
    expect(seedField('physical_health_primary_diagnoses')?.required).toBe(true);
    expect(seedField('physical_health_hospital_admissions')?.fieldType).toBe('TEXTAREA');
    expect(seedField('physical_health_gp_surgery')?.fieldType).toBe('TEXT');
    expect(seedField('physical_health_vital_signs_news2')?.fieldType).toBe('YES_NO');
    expect(seedField('physical_health_blood_glucose')?.fieldType).toBe('YES_NO');
    expect(seedField('physical_health_urgent_advice')?.fieldType).toBe('TEXTAREA');
    expect(seedField('physical_health_urgent_advice')?.required).toBe(true);
  });

  it('reuses the two original section titles and adds the Care 2020 section', () => {
    expect(PHYSICAL_HEALTH_CARE_PLAN_SEED.sections.map((s) => s.title)).toEqual([
      'Health conditions',
      'Monitoring',
      'Needs, goals, support and risk',
    ]);
  });

  it('adds the five Care 2020 fields in order with exactly one required Person-centred details', () => {
    const care2020 = PHYSICAL_HEALTH_CARE_PLAN_SEED.sections[2].fields;
    expect(care2020.map((f) => f.fieldKey)).toEqual([
      'physical_health_service_user_needs',
      'physical_health_needs_person_centred',
      'physical_health_desired_goals_outcomes',
      'physical_health_support_required',
      'physical_health_area_risk',
      'physical_health_risk_identify',
      'physical_health_risk_who_might_be_harmed',
      'physical_health_risk_level',
      'physical_health_risk_likelihood',
      'physical_health_risk_triggers',
      'physical_health_risk_management',
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
    // Risk is YES_NO, the other four are TEXTAREA.
    expect(seedField('physical_health_area_risk')?.fieldType).toBe('YES_NO');
    for (const key of [
      'physical_health_service_user_needs',
      'physical_health_needs_person_centred',
      'physical_health_desired_goals_outcomes',
      'physical_health_support_required',
    ]) {
      expect(seedField(key)?.fieldType).toBe('TEXTAREA');
    }
    // Exactly one "Person-centred details" field across the whole template, and it is required.
    const pcd = PHYSICAL_HEALTH_CARE_PLAN_SEED.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.label === 'Person-centred details');
    expect(pcd).toHaveLength(1);
    expect(pcd[0].fieldKey).toBe('physical_health_needs_person_centred');
    expect(pcd[0].required).toBe(true);
  });

  it('does NOT create goals/support person-centred duplicates or an emergency field', () => {
    const keys = seedFieldKeys();
    expect(keys).not.toContain('physical_health_goals_person_centred');
    expect(keys).not.toContain('physical_health_support_person_centred');
    expect(keys.some((k) => k.includes('emergency'))).toBe(false);
  });

  it('contains no duplicate field keys and totals eleven', () => {
    const keys = seedFieldKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(17);
  });

  it('gives every field a physical_health_ prefixed key', () => {
    for (const key of seedFieldKeys()) {
      expect(key.startsWith('physical_health_')).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// ID preservation, order, saved-value safety and idempotency
// --------------------------------------------------------------------------

describe('applyPhysicalHealthCarePlanSchema', () => {
  it('adopts the six pre-merge fields (UUIDs preserved) instead of recreating them', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    const stats = await applyPhysicalHealthCarePlanSchema(prisma, VERSION_ID);

    expect(stats.adopted).toBe(6);
    for (const [label, key] of Object.entries(PHYSICAL_HEALTH_CARE_PLAN_LEGACY_LABEL_TO_KEY)) {
      const original = legacyState().fields.find((f) => f.label.toLowerCase() === label)!;
      const after = state.fields.find((f) => f.id === original.id)!;
      expect(after.fieldKey).toBe(key);
      expect(after.isActive).toBe(true);
    }
  });

  it('preserves existing field types, required flags and ordering after apply', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPhysicalHealthCarePlanSchema(prisma, VERSION_ID);

    const diagnoses = state.fields.find((f) => f.id === 'field-diagnoses')!;
    expect(diagnoses.fieldKey).toBe('physical_health_primary_diagnoses');
    expect(diagnoses.fieldType).toBe('TEXTAREA');
    expect(diagnoses.required).toBe(true);
    expect(diagnoses.sortOrder).toBe(0);

    const urgent = state.fields.find((f) => f.id === 'field-urgent')!;
    expect(urgent.required).toBe(true);
    expect(urgent.sortOrder).toBe(2);
  });

  it('makes the Care 2020 Person-centred details field required', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPhysicalHealthCarePlanSchema(prisma, VERSION_ID);

    const pcd = state.fields.find((f) => f.fieldKey === 'physical_health_needs_person_centred')!;
    expect(pcd.required).toBe(true);
    expect(pcd.isActive).toBe(true);
  });

  it('reuses the two original section UUIDs and adds the Care 2020 section', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPhysicalHealthCarePlanSchema(prisma, VERSION_ID);

    expect(state.sections.find((s) => s.title === 'Health conditions')?.id).toBe('section-health-conditions');
    expect(state.sections.find((s) => s.title === 'Monitoring')?.id).toBe('section-monitoring');
    expect(state.sections.filter((s) => s.deletedAt === null)).toHaveLength(3);
    expect(state.sections.some((s) => s.title === 'Needs, goals, support and risk')).toBe(true);
  });

  it('keeps VALID saved sectionId:fieldId references valid (fields survive, sections survive)', async () => {
    const state = legacyState();
    const validKeys = ['section-health-conditions:field-diagnoses', 'section-monitoring:field-urgent'];
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPhysicalHealthCarePlanSchema(prisma, VERSION_ID);

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
    const stats = await applyPhysicalHealthCarePlanSchema(prisma, VERSION_ID);
    expect(stats.deactivated).toBe(0);
  });

  it('creates each field exactly once, ending with eleven unique active keys', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPhysicalHealthCarePlanSchema(prisma, VERSION_ID);

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
      sectionId: 'section-monitoring',
      fieldKey: 'physical_health_goals_person_centred',
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
    const first = await applyPhysicalHealthCarePlanSchema(prisma, VERSION_ID);
    const dup = state.fields.find((f) => f.id === 'field-dup-pcd')!;
    expect(first.deactivated).toBe(1);
    expect(dup.isActive).toBe(false);
    expect(dup.deletedAt).toBeNull(); // deactivated, never deleted — UUID + any saved value preserved

    const second = await applyPhysicalHealthCarePlanSchema(prisma, VERSION_ID);
    expect(second.deactivated).toBe(0);
    expect(state.fields.filter((f) => f.isActive && f.label === 'Person-centred details')).toHaveLength(1);
  });

  it('is idempotent — a second run changes nothing', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await applyPhysicalHealthCarePlanSchema(prisma, VERSION_ID);
    const fieldIds = state.fields.map((f) => f.id).sort();
    const sectionIds = state.sections.map((s) => s.id).sort();

    const second = await applyPhysicalHealthCarePlanSchema(prisma, VERSION_ID);

    expect(second.adopted).toBe(0);
    expect(second.deactivated).toBe(0);
    expect(state.fields.map((f) => f.id).sort()).toEqual(fieldIds);
    expect(state.sections.map((s) => s.id).sort()).toEqual(sectionIds);
  });

  it('rejects a template field without a physical_health_ key', async () => {
    const state = legacyState();
    const prisma = makeFakePrisma(state.sections, state.fields);

    await expect(
      applyPhysicalHealthCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [{ title: 'X', fields: [{ label: 'No key', fieldType: 'TEXT' } as never] }],
      }),
    ).rejects.toThrow(/missing fieldKey/);

    await expect(
      applyPhysicalHealthCarePlanSchema(prisma, VERSION_ID, {
        description: 'bad',
        sections: [
          { title: 'X', fields: [{ label: 'Wrong prefix', fieldType: 'TEXT', fieldKey: 'pain_management_oops' } as never] },
        ],
      }),
    ).rejects.toThrow(/must start with physical_health_/);
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
    ]);
    for (const key of seedFieldKeys()) {
      expect(others.has(key)).toBe(false);
    }
  });
});
