import {
  isCapacityInDoubt,
  shouldShowQuestionForValidation,
} from './initial-assessment-conditional-visibility.util';

const q = (id: string, questionText: string, metadata: object) => ({
  id,
  questionText,
  metadata,
  section: { sectionNumber: 2 },
});

const gate = q('g', 'Is anyone legally authorised to make relevant Health & Welfare decisions on their behalf?', {
  specRef: '2.4',
  fieldKey: 'legalAuthority',
});
const nameQ = q('n', 'Name', {
  specRef: '2.4',
  fieldKey: 'legalAuthorityName',
  showWhen: { gateFieldKey: 'legalAuthority', selectedIncludes: ['hw_lpa', 'deputy', 'court_order_other'] },
});
const unsureQ = q('u', 'What needs to be checked?', {
  specRef: '2.4',
  fieldKey: 'legalAuthorityUnsureNote',
  showWhen: { gateFieldKey: 'legalAuthority', selectedIncludes: 'unsure' },
});
const questions = [gate, nameQ, unsureQ];

const selected = (value: string) =>
  new Map([['g', { questionId: 'g', checked: null, booleanValue: null, selectedOptions: [value] }]]);

describe('shouldShowQuestionForValidation — select gates', () => {
  it.each(['hw_lpa', 'deputy', 'court_order_other'])('shows the name when %s is chosen', (value) => {
    expect(shouldShowQuestionForValidation(nameQ, questions, selected(value))).toBe(true);
  });

  it('hides it for No / Unsure / unanswered', () => {
    expect(shouldShowQuestionForValidation(nameQ, questions, selected('no'))).toBe(false);
    expect(shouldShowQuestionForValidation(nameQ, questions, selected('unsure'))).toBe(false);
    expect(shouldShowQuestionForValidation(nameQ, questions, new Map())).toBe(false);
  });

  it('accepts a single value as well as a list', () => {
    expect(shouldShowQuestionForValidation(unsureQ, questions, selected('unsure'))).toBe(true);
    expect(shouldShowQuestionForValidation(unsureQ, questions, selected('hw_lpa'))).toBe(false);
  });
});

describe('isCapacityInDoubt', () => {
  const yn = (id: string, value: boolean) => new Map([[id, { questionId: id, checked: value, booleanValue: value }]]);

  it('reads "reason to doubt capacity?" (Yes = doubt)', () => {
    const doubt = q('d', 'Is there any reason to doubt …?', { specRef: '2.4', fieldKey: 'capacityDoubt' });
    expect(isCapacityInDoubt([doubt, gate], yn('d', true))).toBe(true);
    expect(isCapacityInDoubt([doubt, gate], yn('d', false))).toBe(false);
  });

  it('reads the older "capacity appears intact?" (No = doubt)', () => {
    const legacy = q('l', 'Capacity to consent to assessment appears intact?', { specRef: '2.4' });
    expect(isCapacityInDoubt([legacy], yn('l', false))).toBe(true);
    expect(isCapacityInDoubt([legacy], yn('l', true))).toBe(false);
  });
});
