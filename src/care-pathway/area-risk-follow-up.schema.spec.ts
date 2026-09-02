import type { PrismaClient } from '@prisma/client';
import { CARE_PLAN_FORM_SEEDS } from '../../prisma/seeds/care-plan-forms.seed-data';
import {
  AREA_RISK_FOLLOW_UP_SUFFIXES,
  CARE_2020_AREA_RISK_LEVEL_OPTIONS,
  CARE_2020_AREA_RISK_LIKELIHOOD_OPTIONS,
  areaRiskFollowUpFieldKeys,
  areaRiskGateFieldKey,
  stampAreaRiskFollowUpConditionals,
} from '../../prisma/seeds/area-risk-follow-up.seed';
import { PERSON_CENTRED_CARE_PLAN_SEED } from '../../prisma/seeds/person-centred-care-plan.seed-data';
import { ADVANCE_CARE_PLAN_SEED } from '../../prisma/seeds/advance-care-plan.seed-data';
import { HOME_CARE_PLAN_SEED } from '../../prisma/seeds/home-care-plan.seed-data';
import { HOME_SUPPORT_PLAN_SEED } from '../../prisma/seeds/home-support-plan.seed-data';

const FOLLOW_UP_LABELS = [
  'Identify the risk?',
  'Who might be harmed?',
  'What is the risk level?',
  'How likely is it to occur?',
  'What are the triggers?',
  'How can the risk be reduced and managed?',
] as const;

function seedFields(seed: { sections: Array<{ fields: Array<{ fieldKey?: string; label: string; fieldType: string; required?: boolean; options?: string[]; showWhen?: { fieldKey: string; operator: string } }> }> }) {
  return seed.sections.flatMap((section) => section.fields);
}

function plansWithAreaRisk(): Array<{ name: string; prefix: string }> {
  const found: Array<{ name: string; prefix: string }> = [];
  for (const [name, seed] of Object.entries(CARE_PLAN_FORM_SEEDS)) {
    const gate = seedFields(seed).find((field) => field.fieldKey?.endsWith('_area_risk'));
    if (!gate?.fieldKey) continue;
    found.push({ name, prefix: gate.fieldKey.slice(0, -'_area_risk'.length) });
  }
  return found;
}

describe('Care 2020 area-risk follow-up seeds', () => {
  it('adds the six required follow-up fields immediately after every existing *_area_risk gate', () => {
    const plans = plansWithAreaRisk();
    expect(plans.map((p) => p.name).sort()).toEqual(
      [
        'Cognition and Behaviour',
        'Communication',
        'Continence',
        'Culture/Religion/Spirituality',
        'Dementia Care plan',
        'Eating and Drinking',
        'Falls',
        'Final Days',
        'Home Care Plan - needs/goals/support',
        'Infection',
        'Medication',
        'Mobility',
        'Pain Management',
        'Personal Safety',
        'Physical Health',
        'Pressure Ulcer',
        'Psychological',
        'Skin Integrity',
        'Sleeping and Night',
        'Washing and dressing',
      ].sort(),
    );

    for (const { name, prefix } of plans) {
      const fields = seedFields(CARE_PLAN_FORM_SEEDS[name]);
      const gateIndex = fields.findIndex((field) => field.fieldKey === areaRiskGateFieldKey(prefix));
      expect(gateIndex).toBeGreaterThanOrEqual(0);
      const followUps = fields.slice(gateIndex + 1, gateIndex + 1 + 6);
      expect(followUps.map((f) => f.fieldKey)).toEqual(areaRiskFollowUpFieldKeys(prefix));
      expect(followUps.map((f) => f.label)).toEqual([...FOLLOW_UP_LABELS]);
      expect(followUps.map((f) => f.fieldType)).toEqual([
        'RICH_TEXT',
        'TEXTAREA',
        'SELECT',
        'SELECT',
        'RICH_TEXT',
        'RICH_TEXT',
      ]);
      for (const field of followUps) {
        expect(field.required).toBe(true);
        expect(field.showWhen).toEqual({ fieldKey: areaRiskGateFieldKey(prefix), operator: 'is_true' });
      }
      expect(followUps[2].options).toEqual([...CARE_2020_AREA_RISK_LEVEL_OPTIONS]);
      expect(followUps[3].options).toEqual([...CARE_2020_AREA_RISK_LIKELIHOOD_OPTIONS]);
    }
  });

  it('does not add the follow-up block to Care Plans without *_area_risk', () => {
    const exempt = [
      PERSON_CENTRED_CARE_PLAN_SEED,
      ADVANCE_CARE_PLAN_SEED,
      HOME_CARE_PLAN_SEED,
      HOME_SUPPORT_PLAN_SEED,
      CARE_PLAN_FORM_SEEDS.Advance,
      CARE_PLAN_FORM_SEEDS['Person Centred care plan'],
      CARE_PLAN_FORM_SEEDS['Home Care Plan'],
      CARE_PLAN_FORM_SEEDS['Home Support Plan'],
      CARE_PLAN_FORM_SEEDS['Risk Assessment'],
      CARE_PLAN_FORM_SEEDS['Risk Assessment and Care Plan'],
      CARE_PLAN_FORM_SEEDS['Social Activities'],
      CARE_PLAN_FORM_SEEDS.Test,
      CARE_PLAN_FORM_SEEDS['Care Plan review form'],
    ];
    for (const seed of exempt) {
      const keys = seedFields(seed).map((f) => f.fieldKey).filter(Boolean) as string[];
      expect(keys.some((k) => k.endsWith('_area_risk'))).toBe(false);
      for (const suffix of AREA_RISK_FOLLOW_UP_SUFFIXES) {
        expect(keys.some((k) => k.endsWith(`_${suffix}`))).toBe(false);
      }
    }
  });

  it('keeps follow-up fieldKeys plan-specific rather than shared', () => {
    const keys = plansWithAreaRisk().flatMap(({ prefix }) => areaRiskFollowUpFieldKeys(prefix));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

type FieldRow = {
  id: string;
  sectionId: string;
  fieldKey: string | null;
  conditionalLogicJson?: unknown;
  deletedAt: Date | null;
};

function makeStampPrisma(fields: FieldRow[]) {
  return {
    carePathwayFormField: {
      findMany: async () => fields.filter((f) => f.deletedAt === null),
      update: async ({ where, data }: { where: { id: string }; data: Partial<FieldRow> }) => {
        const row = fields.find((f) => f.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
  } as unknown as PrismaClient;
}

describe('stampAreaRiskFollowUpConditionals', () => {
  it('writes showWhen + is_true against the plan’s own area-risk UUID', async () => {
    const fields: FieldRow[] = [
      { id: 'gate-uuid', sectionId: 'sec-uuid', fieldKey: 'washing_dressing_area_risk', deletedAt: null },
      { id: 'identify-uuid', sectionId: 'sec-uuid', fieldKey: 'washing_dressing_risk_identify', deletedAt: null },
      { id: 'harm-uuid', sectionId: 'sec-uuid', fieldKey: 'washing_dressing_risk_who_might_be_harmed', deletedAt: null },
      { id: 'level-uuid', sectionId: 'sec-uuid', fieldKey: 'washing_dressing_risk_level', deletedAt: null },
      { id: 'likely-uuid', sectionId: 'sec-uuid', fieldKey: 'washing_dressing_risk_likelihood', deletedAt: null },
      { id: 'trig-uuid', sectionId: 'sec-uuid', fieldKey: 'washing_dressing_risk_triggers', deletedAt: null },
      { id: 'mgmt-uuid', sectionId: 'sec-uuid', fieldKey: 'washing_dressing_risk_management', deletedAt: null },
    ];
    const stamped = await stampAreaRiskFollowUpConditionals(makeStampPrisma(fields), 'version');
    expect(stamped).toBe(6);
    const expected = {
      showWhen: [{ sectionId: 'sec-uuid', fieldId: 'gate-uuid', operator: 'is_true' }],
    };
    for (const suffix of AREA_RISK_FOLLOW_UP_SUFFIXES) {
      const row = fields.find((f) => f.fieldKey === `washing_dressing_${suffix}`)!;
      expect(row.conditionalLogicJson).toEqual(expected);
    }
  });

  it('is a no-op when the form has no area-risk follow-up keys', async () => {
    const fields: FieldRow[] = [
      { id: 'preferred-name', sectionId: 'sec', fieldKey: 'person_centred_preferred_name', deletedAt: null },
    ];
    const stamped = await stampAreaRiskFollowUpConditionals(makeStampPrisma(fields), 'version');
    expect(stamped).toBe(0);
  });

  it('is idempotent — a second stamp does not rewrite unchanged JSON', async () => {
    const fields: FieldRow[] = [
      { id: 'gate-uuid', sectionId: 'sec-uuid', fieldKey: 'washing_dressing_area_risk', deletedAt: null },
      { id: 'identify-uuid', sectionId: 'sec-uuid', fieldKey: 'washing_dressing_risk_identify', deletedAt: null },
    ];
    const prisma = makeStampPrisma(fields);
    expect(await stampAreaRiskFollowUpConditionals(prisma, 'version')).toBe(1);
    expect(await stampAreaRiskFollowUpConditionals(prisma, 'version')).toBe(0);
  });
});
