import { CarePathwayFormFieldType } from '@prisma/client';
import { DEFAULT_SUPERVISION_FORMS } from '../../prisma/seed-data/supervision-forms';
import { WORKFORCE_REVIEW_TYPES } from '../../prisma/seed-data/workforce-catalog';

const FIELD_KEY = /^[a-z][a-z0-9_]*$/;
const CHOICE_TYPES = new Set(['SELECT', 'MULTI_SELECT']);

describe('default supervision forms', () => {
  it('gives every workforce review type exactly one form', () => {
    const codes = DEFAULT_SUPERVISION_FORMS.flatMap((f) => f.reviewTypeCodes);
    expect(new Set(codes).size).toBe(codes.length);
    const missing = WORKFORCE_REVIEW_TYPES.map((t) => t.code).filter((code) => !codes.includes(code));
    expect(missing).toEqual([]);
  });

  it('has unique form names', () => {
    const names = DEFAULT_SUPERVISION_FORMS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(DEFAULT_SUPERVISION_FORMS.map((f) => [f.name, f] as const))('%s is a valid Care Pathway form', (_, form) => {
    const fields = form.sections.flatMap((s) => s.fields);
    const keys = fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const field of fields) {
      expect(field.key).toMatch(FIELD_KEY);
      expect(Object.values(CarePathwayFormFieldType)).toContain(field.type);
      if (CHOICE_TYPES.has(field.type)) expect(field.options?.length).toBeGreaterThan(1);
    }
    expect(fields.some((f) => f.required)).toBe(true);
    expect(form.sections.every((s) => s.fields.length > 0)).toBe(true);
  });
});
