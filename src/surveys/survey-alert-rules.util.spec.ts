import { SurveyQuestionType } from '@prisma/client';
import {
  alertCalendarDueDate,
  alertDueDate,
  ruleDueDate,
  answerLabelsByKey,
  conditionProblems,
  isContactRuleShape,
  libraryRuleRows,
  matchConditions,
  roleForOwner,
  type AlertQuestion,
} from './survey-alert-rules.util';

const q = (key: string, text: string, type: SurveyQuestionType, options: string[] | null = null): AlertQuestion => ({
  id: `id-${key}`,
  key,
  questionText: text,
  questionType: type,
  options,
  config: null,
  otherOption: null,
});

const questions: AlertQuestion[] = [
  q('q-safe', 'Do you feel safe with your care workers?', SurveyQuestionType.LIKERT, ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never']),
  q('q2', 'What could we do better?', SurveyQuestionType.TEXT),
  q('q3', 'Would you like someone to contact you about your answers?', SurveyQuestionType.YES_NO),
];

const meta = {
  managerGuidance: {
    alerts: [
      {
        when: 'Feels unsafe',
        action: 'Pass to the safeguarding lead',
        rule: { task: 'Feels unsafe', if: [{ question: 'q-safe', answers: ['Rarely', 'Never'] }], owner: 'SAFEGUARDING_LEAD', dueWorkingDays: 0, urgent: true, record: 'SAFEGUARDING' },
      },
      { when: 'A comment suggesting abuse', action: 'Read it and act' },
      {
        when: 'Contact me',
        action: 'Call them',
        rule: { task: 'Asked to be contacted', if: [{ question: 'Would you like someone to contact you about your answers?', answers: ['Yes'] }], owner: 'CARE_COORDINATOR', dueWorkingDays: 5, contactRequest: true },
      },
      {
        when: 'A removed question',
        action: 'x',
        rule: { task: 'Gone', if: [{ question: 'q-gone', answers: ['Yes'] }], owner: 'CARE_COORDINATOR', dueWorkingDays: 1 },
      },
    ],
  },
};

describe('survey alert rules', () => {
  describe('alertDueDate (working days, bank holidays)', () => {
    it('is today on a working day for "the same working day"', () => {
      expect(alertDueDate('2026-11-06', 0)).toBe('2026-11-06'); // Friday
    });
    it('moves "the same working day" on from a weekend to Monday', () => {
      expect(alertDueDate('2026-11-07', 0)).toBe('2026-11-09');
    });
    it('counts working days over a weekend', () => {
      expect(alertDueDate('2026-11-06', 5)).toBe('2026-11-13');
    });
    it('"within 7 days" is due 7 calendar days on, or the last working day before when that is not one', () => {
      expect(alertCalendarDueDate('2026-11-06', 7)).toBe('2026-11-13'); // Friday → Friday
      expect(alertCalendarDueDate('2026-11-05', 3)).toBe('2026-11-06'); // would be Sunday → Friday
      expect(alertCalendarDueDate('2026-12-21', 7, new Set(['2026-12-25', '2026-12-28']))).toBe('2026-12-24'); // bank holidays → the Thursday before
      expect(alertCalendarDueDate('2026-11-07', 1)).toBe('2026-11-09'); // never before the first working day
    });
    it('a rule uses calendar days when it has them', () => {
      expect(ruleDueDate('2026-11-06', { dueWorkingDays: 0, dueCalendarDays: 7 })).toBe('2026-11-13');
      expect(ruleDueDate('2026-11-06', { dueWorkingDays: 5, dueCalendarDays: null })).toBe('2026-11-13');
      expect(ruleDueDate('2026-11-06', { dueWorkingDays: 1 })).toBe('2026-11-09');
    });
    it('skips bank holidays', () => {
      expect(alertDueDate('2026-12-24', 1, new Set(['2026-12-25', '2026-12-28']))).toBe('2026-12-29');
    });
  });

  describe('libraryRuleRows', () => {
    it('turns structured library alerts into rules, by question id or exact text', () => {
      const rows = libraryRuleRows(meta, questions, { anonymous: false });
      expect(rows.map((r) => r.key)).toEqual(['library-0', 'library-2']);
      expect(rows[0]).toMatchObject({
        title: 'Feels unsafe',
        ownerKey: 'SAFEGUARDING_LEAD',
        dueWorkingDays: 0,
        urgent: true,
        recordKind: 'SAFEGUARDING',
        conditions: [{ questionKey: 'q-safe', answers: ['Rarely', 'Never'] }],
        libraryAlert: 0,
      });
      expect(rows[1]).toMatchObject({ contactRequest: true, conditions: [{ questionKey: 'q3', answers: ['Yes'] }] });
    });
    it('leaves out alerts with no rule and rules whose question is no longer in the survey', () => {
      const rows = libraryRuleRows(meta, questions, { anonymous: false });
      expect(rows.find((r) => r.libraryAlert === 1)).toBeUndefined();
      expect(rows.find((r) => r.libraryAlert === 3)).toBeUndefined();
    });
    it('never brings a contact-me rule onto an anonymous survey', () => {
      const rows = libraryRuleRows(meta, questions, { anonymous: true });
      expect(rows.some((r) => r.contactRequest)).toBe(false);
    });
  });

  describe('conditions', () => {
    it('refuses written questions, unknown answers and missing questions', () => {
      expect(conditionProblems([{ questionKey: 'q2', answers: ['x'] }], questions)[0]).toMatch(/written answer/);
      expect(conditionProblems([{ questionKey: 'q-safe', answers: ['Maybe'] }], questions)[0]).toMatch(/not an answer/);
      expect(conditionProblems([{ questionKey: 'nope', answers: ['Yes'] }], questions)[0]).toMatch(/no longer in the survey/);
      expect(conditionProblems([], questions)[0]).toMatch(/at least one/);
      expect(conditionProblems([{ questionKey: 'q-safe', answers: ['Never'] }], questions)).toEqual([]);
    });
    it('knows a contact-me rule only checks the contact-me question answered Yes', () => {
      expect(isContactRuleShape([{ questionKey: 'q3', answers: ['Yes'] }], questions)).toBe(true);
      expect(isContactRuleShape([{ questionKey: 'q3', answers: ['No'] }], questions)).toBe(false);
      expect(isContactRuleShape([{ questionKey: 'q-safe', answers: ['Never'] }], questions)).toBe(false);
    });
    it('matches the answers given, any condition firing the rule', () => {
      const labels = answerLabelsByKey(questions, [
        { questionId: 'id-q-safe', booleanValue: null, numberValue: null, selectedOptions: ['Never'] },
        { questionId: 'id-q3', booleanValue: true, numberValue: null, selectedOptions: null },
      ]);
      expect(matchConditions([{ questionKey: 'q-safe', answers: ['Rarely', 'Never'] }], labels)).toEqual([{ questionKey: 'q-safe', answers: ['Never'] }]);
      expect(matchConditions([{ questionKey: 'q-safe', answers: ['Always'] }], labels)).toEqual([]);
      expect(matchConditions([{ questionKey: 'q3', answers: ['Yes'] }], labels)).toHaveLength(1);
    });
  });

  it('finds the usual organisation role for a library role', () => {
    const roles = [
      { id: 'r1', name: 'Registered Manager' },
      { id: 'r2', name: 'care coordinator' },
    ];
    expect(roleForOwner('CARE_COORDINATOR', roles)?.id).toBe('r2');
    expect(roleForOwner('SAFEGUARDING_LEAD', roles)?.id).toBe('r1');
    expect(roleForOwner('HR_MANAGER', roles)).toBeNull();
    expect(roleForOwner(null, roles)).toBeNull();
  });
});
