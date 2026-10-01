import {
  InitialAssessmentActionPriority,
  InitialAssessmentActionType,
} from '@prisma/client';
import { buildAutoActionsFromSubmission } from './initial-assessment-action-generation.util';

const dnacprQuestion = {
  id: 'q-dnacpr',
  questionText: 'DNACPR or ReSPECT in place?',
  riskFlag: false,
  carePlanTrigger: false,
  metadata: { specRef: '13.6', fieldKey: 'dnacprRespectInPlace' },
  section: { sectionNumber: 13 },
};

describe('buildAutoActionsFromSubmission — DNACPR verification', () => {
  it('creates an urgent verification task when the IA reports a DNACPR', () => {
    const drafts = buildAutoActionsFromSubmission({
      questions: [dnacprQuestion],
      answers: [{ questionId: 'q-dnacpr', checked: true, booleanValue: true }],
    });
    const task = drafts.find((d) => d.title.startsWith('Verify DNACPR'));
    expect(task?.priority).toBe(InitialAssessmentActionPriority.URGENT);
  });

  it('uses the End of Life answer when §13.6 is blank', () => {
    const drafts = buildAutoActionsFromSubmission({
      questions: [dnacprQuestion],
      answers: [],
      metadata: { endOfLifeAssessment: { dnrInPlaceAnswer: true } },
    });
    expect(drafts.some((d) => d.title.startsWith('Verify DNACPR'))).toBe(true);
  });

  it('skips the task when the office already verified the document or nothing is reported', () => {
    expect(
      buildAutoActionsFromSubmission({
        questions: [dnacprQuestion],
        answers: [{ questionId: 'q-dnacpr', checked: true, booleanValue: true }],
        dnacprVerifiedByOffice: true,
      }).some((d) => d.title.startsWith('Verify DNACPR')),
    ).toBe(false);
    expect(
      buildAutoActionsFromSubmission({
        questions: [dnacprQuestion],
        answers: [{ questionId: 'q-dnacpr', checked: false, booleanValue: false }],
      }).some((d) => d.title.startsWith('Verify DNACPR')),
    ).toBe(false);
  });
});

describe('buildAutoActionsFromSubmission — end of life unsure', () => {
  it('asks the GP / clinical team instead of the assessor deciding', () => {
    const eolQ = {
      id: 'q-eol',
      questionText: 'Is palliative or end-of-life care currently relevant…?',
      riskFlag: false,
      carePlanTrigger: false,
      metadata: { specRef: '1.0', fieldKey: 'eolRelevant' },
      section: { sectionNumber: 1 },
    };
    const drafts = buildAutoActionsFromSubmission({
      questions: [eolQ],
      answers: [{ questionId: 'q-eol', checked: null, booleanValue: null, selectedOptions: ['unsure'] }],
    });
    expect(drafts.some((d) => d.title.startsWith('Clarify with GP'))).toBe(true);
  });
});

describe('buildAutoActionsFromSubmission — unsteadiness / gait / balance', () => {
  it('raises a HIGH falls assessment follow-up when §12.7 is answered Yes', () => {
    const unsteadyQ = {
      id: 'q-unsteady',
      questionText: 'Any unsteadiness, gait or balance concern?',
      riskFlag: false,
      carePlanTrigger: true,
      metadata: { specRef: '12.7', fieldKey: 'fallsUnsteadiness' },
      section: { sectionNumber: 12 },
    };
    const drafts = buildAutoActionsFromSubmission({
      questions: [unsteadyQ],
      answers: [{ questionId: 'q-unsteady', checked: true, booleanValue: true }],
    });
    const task = drafts.find((d) => d.sourceQuestionId === 'q-unsteady');
    expect(task?.actionType).toBe(InitialAssessmentActionType.FALLS_ASSESSMENT);
    expect(task?.priority).toBe(InitialAssessmentActionPriority.HIGH);
    expect(task?.title).toBe('Falls assessment follow-up');
  });
});
