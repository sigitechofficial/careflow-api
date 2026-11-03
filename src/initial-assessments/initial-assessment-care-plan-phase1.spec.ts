/**
 * Phase 1 tests for behaviour that needs new APIs: hidden conditional answers, ADL personal-care
 * conditions, IA status transitions, rule validation/diagnostics, publish auto-accept with merged
 * ids, and seed protection of admin-edited rules.
 */
import { BadRequestException } from '@nestjs/common';
import { InitialAssessmentStatus } from '@prisma/client';
import { computeCarePlanRecommendations } from './initial-assessment-care-plan-recommendations.util';
import {
  visibleQuestionIdsForSubmission,
  isNonAnswerText,
} from './initial-assessment-care-plan-triggers.util';
import { assertInitialAssessmentStatusTransition } from './initial-assessment-status-transition.util';
import {
  diagnoseCarePlanRules,
  validateRuleConditionsAgainstTemplate,
} from './initial-assessment-care-plan-rules.validation';
import type { CarePlanRecommendationRuleRow } from './initial-assessment-care-plan-rules.types';
import { recommendationsMatchingPublishedForm } from '../service-user-care-plans/accept-ia-recommendation-on-publish.util';
import {
  IA_CARE_PLAN_STARTER_RULES,
  seedInitialAssessmentCarePlanRules,
} from '../../prisma/seeds/initial-assessment-care-plan-rules.seed';
import {
  ALL_QUESTIONS,
  answersFor,
  CATALOGUE,
  DELETED_TESTING_FORM_ID,
  FORM,
  LIVE_RULES,
  LIVE_VALID_RULES,
  NO,
  Q,
  select,
  YES,
} from './initial-assessment-care-plan.test-fixtures';

const visibilityQuestions = ALL_QUESTIONS.map((q) => ({
  id: q.id,
  questionText: q.questionText,
  metadata: q.metadata,
  section: { sectionNumber: q.section.sectionNumber },
}));

describe('hidden conditional answers (audit B13)', () => {
  it('a stale medication support level hidden behind "Taking prescribed medication? = No" recommends nothing', () => {
    const answers = answersFor([
      [Q.takingMeds, NO],
      [Q.medLevel, select('level_2b')],
      [Q.emar, YES],
    ]);
    const recs = computeCarePlanRecommendations({
      rules: LIVE_VALID_RULES,
      answers,
      catalogue: CATALOGUE,
      medicalConditions: [],
      visibleQuestionIds: visibleQuestionIdsForSubmission(
        visibilityQuestions,
        answers,
      ),
    });
    expect(
      recs.filter((r) => r.carePathwayFormId === FORM.medication.id),
    ).toEqual([]);
  });

  it('the same answers recommend Medication while the gate is Yes', () => {
    const answers = answersFor([
      [Q.takingMeds, YES],
      [Q.emar, YES],
    ]);
    const recs = computeCarePlanRecommendations({
      rules: LIVE_VALID_RULES,
      answers,
      catalogue: CATALOGUE,
      medicalConditions: [],
      visibleQuestionIds: visibleQuestionIdsForSubmission(
        visibilityQuestions,
        answers,
      ),
    });
    expect(
      recs.filter((r) => r.carePathwayFormId === FORM.medication.id),
    ).toHaveLength(1);
  });

  it('questions without a gate stay visible', () => {
    const answers = answersFor([[Q.falls, YES]]);
    expect(
      visibleQuestionIdsForSubmission(visibilityQuestions, answers).has(
        'q-falls',
      ),
    ).toBe(true);
  });
});

describe('medication support level (Phase 1 Medication rule)', () => {
  const medicationRule = LIVE_VALID_RULES.find(
    (r) => r.id === 'r3-medication',
  )!;
  const withLevels: CarePlanRecommendationRuleRow = {
    ...medicationRule,
    conditions: [
      ...medicationRule.conditions,
      ...['level_1a', 'level_1b', 'level_2a', 'level_2b'].map((value) => ({
        fieldKey: 'medicationSupportLevel',
        when: 'select_equals' as const,
        value,
      })),
    ],
  };
  const run = (level: string) =>
    computeCarePlanRecommendations({
      rules: [withLevels],
      answers: answersFor([
        [Q.takingMeds, YES],
        [Q.medLevel, select(level)],
      ]),
      catalogue: CATALOGUE,
      medicalConditions: [],
    });

  it.each(['level_1a', 'level_1b', 'level_2a', 'level_2b'])(
    '%s recommends Medication without eMAR',
    (level) => {
      expect(run(level).map((r) => r.id)).toEqual(['rule-r3-medication']);
    },
  );

  it.each(['level_0', 'provided_by_others'])(
    '%s (carers do not handle medicines) recommends nothing',
    (level) => {
      expect(run(level)).toEqual([]);
    },
  );
});

describe('personal care from the ADL worksheet (Phase 1 Washing and dressing rule)', () => {
  const personalCareRule: CarePlanRecommendationRuleRow = {
    id: 'washing-dressing',
    carePathwayFormId: FORM.washingDressing.id,
    label: null,
    matchMode: 'ANY',
    conditions: [
      { adlActivity: 'bathing', when: 'adl_score_gte', value: '1' },
      { adlActivity: 'dressing_undressing', when: 'adl_score_gte', value: '1' },
      { adlActivity: 'grooming', when: 'adl_score_gte', value: '1' },
    ],
    suppressLegacyArea: null,
    sortOrder: 5,
    isActive: true,
    formName: FORM.washingDressing.name,
  };
  const run = (rows: Array<{ id: string; activity: string; score: number }>) =>
    computeCarePlanRecommendations({
      rules: [personalCareRule],
      answers: [],
      catalogue: CATALOGUE,
      medicalConditions: [],
      adlRows: rows,
    });

  it('bathing needs help (score 2) recommends Washing and dressing with ADL evidence', () => {
    const recs = run([{ id: 'bathing', activity: 'Bathing', score: 2 }]);
    expect(recs).toHaveLength(1);
    expect(recs[0].carePathwayFormId).toBe(FORM.washingDressing.id);
    expect(recs[0].triggers[0].questionId).toBe('adl-metadata:bathing');
    expect(recs[0].triggers[0].questionText).toContain('Bathing');
  });

  it('independent in all personal care (score 0) recommends nothing', () => {
    expect(
      run([
        { id: 'bathing', activity: 'Bathing', score: 0 },
        {
          id: 'dressing_undressing',
          activity: 'Dressing / undressing',
          score: 0,
        },
        { id: 'grooming', activity: 'Grooming', score: 0 },
      ]),
    ).toEqual([]);
  });

  it('no ADL worksheet recommends nothing', () => {
    expect(run([])).toEqual([]);
  });
});

describe('safeguarding indicator (Phase 1 Personal Safety rule)', () => {
  const safeguardingRule: CarePlanRecommendationRuleRow = {
    id: 'personal-safety',
    carePathwayFormId: FORM.personalSafety.id,
    label: null,
    matchMode: 'ANY',
    conditions: [{ fieldKey: 'safeguardingConcern', when: 'yes' }],
    suppressLegacyArea: null,
    sortOrder: 60,
    isActive: true,
    formName: FORM.personalSafety.name,
  };

  it('a safeguarding concern recommends Personal Safety and merges with environment evidence', () => {
    const recs = computeCarePlanRecommendations({
      rules: [safeguardingRule],
      answers: answersFor([
        [Q.safeguarding, YES],
        [Q.smoke, YES],
      ]),
      catalogue: CATALOGUE,
      medicalConditions: [],
    });
    const ps = recs.filter(
      (r) => r.carePathwayFormId === FORM.personalSafety.id,
    );
    expect(ps).toHaveLength(1);
    expect(ps[0].id).toBe('rule-personal-safety');
    expect(ps[0].aliasIds).toContain('cp-18-environment');
    expect(ps[0].triggers.map((t) => t.questionId).sort()).toEqual([
      'q-safeguarding',
      'q-smoke',
    ]);
  });
});

describe('free-text helpers', () => {
  it.each([
    'None',
    'none.',
    'N/A',
    'n/a',
    'Not applicable',
    'No concerns',
    'nil',
    'No',
    '-',
  ])('"%s" is a non-answer', (v) => expect(isNonAnswerText(v)).toBe(true));
  it.each([
    'None of the time unless anxious',
    'Nervous of dogs',
    'No shoes indoors please',
  ])('"%s" is substantive', (v) => expect(isNonAnswerText(v)).toBe(false));
});

describe('IA status transitions (audit B7)', () => {
  const ok = (from: InitialAssessmentStatus, to: InitialAssessmentStatus) =>
    expect(() =>
      assertInitialAssessmentStatusTransition(from, to),
    ).not.toThrow();
  const blocked = (
    from: InitialAssessmentStatus,
    to: InitialAssessmentStatus,
  ) =>
    expect(() => assertInitialAssessmentStatusTransition(from, to)).toThrow(
      BadRequestException,
    );

  it('blocks DRAFT/IN_PROGRESS → REVIEWED', () => {
    blocked(InitialAssessmentStatus.DRAFT, InitialAssessmentStatus.REVIEWED);
    blocked(
      InitialAssessmentStatus.IN_PROGRESS,
      InitialAssessmentStatus.REVIEWED,
    );
  });

  it('blocks SUBMITTED → REVIEWED (manager review endpoint only)', () => {
    blocked(
      InitialAssessmentStatus.SUBMITTED,
      InitialAssessmentStatus.REVIEWED,
    );
  });

  it('blocks any → SUBMITTED (submit endpoint only)', () => {
    blocked(InitialAssessmentStatus.DRAFT, InitialAssessmentStatus.SUBMITTED);
    blocked(
      InitialAssessmentStatus.IN_PROGRESS,
      InitialAssessmentStatus.SUBMITTED,
    );
  });

  it('keeps the reopen workflow (SUBMITTED/REVIEWED → IN_PROGRESS)', () => {
    ok(InitialAssessmentStatus.SUBMITTED, InitialAssessmentStatus.IN_PROGRESS);
    ok(InitialAssessmentStatus.REVIEWED, InitialAssessmentStatus.IN_PROGRESS);
  });

  it('keeps cancelling an unsubmitted assessment and archiving a reviewed one', () => {
    ok(InitialAssessmentStatus.DRAFT, InitialAssessmentStatus.CANCELLED);
    ok(InitialAssessmentStatus.IN_PROGRESS, InitialAssessmentStatus.CANCELLED);
    ok(InitialAssessmentStatus.REVIEWED, InitialAssessmentStatus.ARCHIVED);
  });

  it('rejects a no-op change and leaving a terminal status', () => {
    blocked(
      InitialAssessmentStatus.IN_PROGRESS,
      InitialAssessmentStatus.IN_PROGRESS,
    );
    blocked(
      InitialAssessmentStatus.ARCHIVED,
      InitialAssessmentStatus.IN_PROGRESS,
    );
    blocked(
      InitialAssessmentStatus.CANCELLED,
      InitialAssessmentStatus.IN_PROGRESS,
    );
  });
});

describe('rule condition validation and diagnostics (Phase 1I)', () => {
  const templateQuestions = ALL_QUESTIONS.map((q) => ({
    id: q.id,
    questionText: q.questionText,
    questionType: q.questionType,
    options:
      q.id === 'q-med-level'
        ? {
            options: [
              'level_0',
              'level_1a',
              'level_1b',
              'level_2a',
              'level_2b',
            ].map((value) => ({ value, label: value })),
          }
        : null,
    metadata: q.metadata,
    carePlanTrigger: q.carePlanTrigger,
    section: q.section,
  }));

  it('rejects an unknown fieldKey, an unknown option value, a bad operator and a missing value', () => {
    const { errors } = validateRuleConditionsAgainstTemplate(
      [
        { fieldKey: 'fallsUnsteadiness', when: 'yes' },
        {
          fieldKey: 'medicationSupportLevel',
          when: 'select_equals',
          value: 'level_9',
        },
        { fieldKey: 'emarRequired', when: 'maybe' as never },
        { fieldKey: 'medicationSupportLevel', when: 'select_equals' },
        { adlActivity: 'juggling', when: 'adl_score_gte', value: '1' },
      ],
      templateQuestions,
    );
    expect(errors).toHaveLength(5);
    expect(errors.join(' ')).toContain('fallsUnsteadiness');
    expect(errors.join(' ')).toContain('level_9');
  });

  it('accepts the Phase 1 starter rules against the template', () => {
    for (const starter of IA_CARE_PLAN_STARTER_RULES) {
      const { errors } = validateRuleConditionsAgainstTemplate(
        starter.conditions,
        templateQuestions,
      );
      expect({ form: starter.formName, errors }).toEqual({
        form: starter.formName,
        errors: [],
      });
    }
  });

  it('diagnoses a rule targeting a deleted form, ambiguous text matches and free-text triggers', () => {
    const report = diagnoseCarePlanRules({
      rules: LIVE_RULES.map((r) => ({ ...r, conditions: r.conditions })),
      forms: [
        ...CATALOGUE.map((f) => ({
          ...f,
          isActive: true,
          status: 'PUBLISHED',
          formType: 'CARE_PLAN',
          deletedAt: null,
        })),
        {
          id: DELETED_TESTING_FORM_ID,
          name: 'Testing Form',
          isActive: false,
          status: 'PUBLISHED',
          formType: 'CARE_PLAN',
          deletedAt: new Date('2026-06-05T10:13:03.181Z'),
        },
      ],
      questions: templateQuestions,
      starterRules: IA_CARE_PLAN_STARTER_RULES,
    });
    const r1 = report.rules.find((r) => r.ruleId === 'r1-testing-form')!;
    expect(r1.targetStatus).toBe('DELETED');
    expect(r1.actionable).toBe(false);
    const r6 = report.rules.find((r) => r.ruleId === 'r6-psychological')!;
    expect(r6.warnings.join(' ')).toMatch(/matches 2 questions/);
    const r2 = report.rules.find((r) => r.ruleId === 'r2-advance')!;
    expect(r2.warnings.join(' ')).toMatch(/free-text/i);
  });
});

describe('publish auto-accept respects merged ids (Phase 1E)', () => {
  const rec = {
    id: 'cp-4-physical-health',
    aliasIds: ['cp-5-respiratory'],
    carePlanArea: 'Physical Health',
    sectionNumber: 4,
    sectionTitle: 'Physical',
    title: 'Physical Health care plan update recommended',
    triggerCount: 2,
    triggers: [],
    status: 'pending' as const,
    carePathwayFormId: FORM.physicalHealth.id,
    carePathwayFormName: FORM.physicalHealth.name,
    source: 'legacy' as const,
  };

  it('does not auto-accept a recommendation whose merged alias was declined', () => {
    const matches = recommendationsMatchingPublishedForm(
      [rec],
      FORM.physicalHealth.id,
      FORM.physicalHealth.name,
      CATALOGUE,
      {
        'cp-5-respiratory': {
          decision: 'declined',
          reason: 'Not needed',
          decidedAt: '2026-06-01T00:00:00.000Z',
          decidedById: 'u',
        },
      },
    );
    expect(matches).toEqual([]);
  });

  it('auto-accepts an undecided recommendation for the published form', () => {
    expect(
      recommendationsMatchingPublishedForm(
        [rec],
        FORM.physicalHealth.id,
        FORM.physicalHealth.name,
        CATALOGUE,
        {},
      ),
    ).toHaveLength(1);
  });
});

describe('seed does not overwrite admin-configured rules (audit B26)', () => {
  it('creates missing rules only and never updates an existing one', async () => {
    const update = jest.fn();
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      carePathwayForm: {
        findFirst: jest.fn(({ where }: { where: { name: string } }) =>
          Promise.resolve({ id: `form-${where.name}`, name: where.name }),
        ),
      },
      initialAssessmentCarePlanRecommendationRule: {
        findFirst: jest.fn(
          ({ where }: { where: { carePathwayFormId: string } }) =>
            Promise.resolve(
              where.carePathwayFormId === 'form-Medication'
                ? {
                    id: 'admin-edited',
                    carePathwayFormId: 'form-Medication',
                    conditions: [{ fieldKey: 'emarRequired', when: 'yes' }],
                  }
                : null,
            ),
        ),
        update,
        create,
      },
    };
    await seedInitialAssessmentCarePlanRules(prisma as never);
    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(IA_CARE_PLAN_STARTER_RULES.length - 1);
  });
});
