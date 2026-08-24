import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import {
  resolveIaBooleanValue,
  resolveIaDateIso,
  resolveIaDisplayValue,
  resolveIaNumberValue,
} from './ia-answer-resolver.util';

const base: SubmissionAnswerForRules = {
  questionId: 'q1',
  questionText: 'Sample',
  checked: null,
  booleanValue: null,
  textValue: null,
  selectedOptions: null,
  numberValue: null,
  dateValue: null,
  sectionNumber: 1,
  sectionTitle: 'Section',
};

describe('typed IA answer resolvers', () => {
  it('reads numberValue for compose/suggestion logic', () => {
    expect(resolveIaNumberValue({ ...base, numberValue: 2 })).toBe(2);
    expect(resolveIaDisplayValue({ ...base, numberValue: 2, booleanValue: true })).toBe('Yes');
  });

  it('reads dateValue as ISO', () => {
    expect(resolveIaDateIso({ ...base, dateValue: '2026-03-12T00:00:00.000Z' })).toBe(
      '2026-03-12T00:00:00.000Z',
    );
  });

  it('reads explicit yes/no as boolean without stringifying first', () => {
    expect(resolveIaBooleanValue({ ...base, booleanValue: true, checked: true })).toBe(true);
    expect(resolveIaBooleanValue({ ...base, booleanValue: false, checked: false })).toBe(false);
    expect(resolveIaBooleanValue(base)).toBeNull();
  });
});
