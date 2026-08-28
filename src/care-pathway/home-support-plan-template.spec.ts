import { HOME_SUPPORT_PLAN_SEED } from '../../prisma/seeds/home-support-plan.seed-data';
import { buildCarePlanSchemaJson } from '../../prisma/seeds/home-support-plan-schema.util';

describe('Home Support Plan seed data', () => {
  it('defines 9 sections and 45 fields with unique hsp_* keys', () => {
    expect(HOME_SUPPORT_PLAN_SEED.sections).toHaveLength(9);

    const fields = HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) => s.fields);
    expect(fields).toHaveLength(45);

    const keys = fields.map((f) => f.fieldKey);
    expect(new Set(keys).size).toBe(45);
    for (const key of keys) {
      expect(key).toMatch(/^hsp_[a-z0-9_]+$/);
    }
  });

  it('includes required fields from the approved structure', () => {
    const requiredKeys = new Set(
      HOME_SUPPORT_PLAN_SEED.sections
        .flatMap((s) => s.fields)
        .filter((f) => f.required)
        .map((f) => f.fieldKey),
    );
    expect(requiredKeys).toEqual(
      new Set([
        'hsp_plan_start_date',
        'hsp_support_needs_summary',
        'hsp_review_frequency',
        'hsp_personal_care_tasks',
        'hsp_home_access_instructions',
        'hsp_goal_1',
        'hsp_goal_1_carer_support',
        'hsp_escalation_instructions',
      ]),
    );
  });

  it('buildCarePlanSchemaJson includes fieldKey on each field', () => {
    const json = buildCarePlanSchemaJson(HOME_SUPPORT_PLAN_SEED) as {
      sections: Array<{ fields: Array<{ fieldKey: string | null }> }>;
    };
    const fieldKeys = json.sections.flatMap((s) => s.fields.map((f) => f.fieldKey));
    expect(fieldKeys).toHaveLength(45);
    expect(fieldKeys.every((k) => typeof k === 'string' && k.startsWith('hsp_'))).toBe(true);
  });
});
