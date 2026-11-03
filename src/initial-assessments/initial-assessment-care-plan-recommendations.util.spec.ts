/**
 * Phase 1 characterisation + regression tests for the IA → care plan recommendation pipeline.
 * Fixtures mirror the live Enterprise template and the 7 live rules (see test-fixtures).
 */
import { computeCarePlanRecommendations } from './initial-assessment-care-plan-recommendations.util';
import {
  applyCarePlanDecisions,
  type StoredCarePlanDecision,
} from './initial-assessment-care-plan-decisions.util';
import type { CarePlanRecommendation } from './initial-assessment-care-plan.util';
import type { CarePlanRecommendationRuleRow } from './initial-assessment-care-plan-rules.types';
import type { SubmissionAnswerForRules } from './initial-assessment-care-plan-rules.util';
import type { ActiveConditionForCarePlan } from './medical-condition-care-plan-map.util';
import {
  answersFor,
  CATALOGUE,
  DELETED_TESTING_FORM_ID,
  FORM,
  LIVE_RULES,
  LIVE_VALID_RULES,
  NO,
  Q,
  select,
  text,
  YES,
} from './initial-assessment-care-plan.test-fixtures';

function run(
  answers: SubmissionAnswerForRules[],
  opts: {
    rules?: CarePlanRecommendationRuleRow[];
    conditions?: ActiveConditionForCarePlan[] | null;
  } = {},
): CarePlanRecommendation[] {
  return computeCarePlanRecommendations({
    rules: opts.rules ?? LIVE_VALID_RULES,
    answers,
    catalogue: CATALOGUE,
    medicalConditions: opts.conditions === undefined ? [] : opts.conditions,
  });
}

const forForm = (recs: CarePlanRecommendation[], formId: string) =>
  recs.filter((r) => r.carePathwayFormId === formId);
const triggerIds = (rec: CarePlanRecommendation | undefined) =>
  (rec?.triggers ?? []).map((t) => t.questionId).sort();

const decision = (
  d: 'accepted' | 'declined',
  at: string,
  extra: Partial<StoredCarePlanDecision> = {},
): StoredCarePlanDecision => ({
  decision: d,
  reason: d === 'declined' ? 'Not needed' : null,
  decidedAt: at,
  decidedById: 'user-1',
  ...extra,
});

// ---------------------------------------------------------------------------------------------
// Characterisation: existing valid behaviour that must not change
// ---------------------------------------------------------------------------------------------
describe('characterisation — existing valid recommendations', () => {
  it('eMAR = Yes recommends Medication from the rule', () => {
    const recs = run(
      answersFor([
        [Q.takingMeds, YES],
        [Q.emar, YES],
      ]),
    );
    const med = forForm(recs, FORM.medication.id);
    expect(med).toHaveLength(1);
    expect(med[0].id).toBe('rule-r3-medication');
    expect(med[0].source).toBe('rule');
  });

  it('falls in last 12 months = Yes recommends Falls from the rule', () => {
    const recs = run(answersFor([[Q.falls, YES]]));
    const falls = forForm(recs, FORM.falls.id);
    expect(falls).toHaveLength(1);
    expect(falls[0].id).toBe('rule-r7-falls');
    expect(triggerIds(falls[0])).toEqual(['q-falls']);
  });

  it('falls = No recommends nothing', () => {
    expect(run(answersFor([[Q.falls, NO]]))).toEqual([]);
  });

  it('nutrition concerns recommend Eating and Drinking through the legacy area', () => {
    const recs = run(
      answersFor([
        [Q.appetite, YES],
        [Q.malnourished, YES],
      ]),
    );
    const ed = forForm(recs, FORM.eatingDrinking.id);
    expect(ed).toHaveLength(1);
    expect(ed[0].id).toBe('cp-6-nutrition');
    expect(triggerIds(ed[0])).toEqual(['q-appetite', 'q-malnourished']);
  });

  it('wounds recommend Skin Integrity through the legacy area', () => {
    const recs = run(answersFor([[Q.wounds, YES]]));
    expect(forForm(recs, FORM.skinIntegrity.id).map((r) => r.id)).toEqual([
      'cp-11-skin-integrity',
    ]);
  });

  it('bladder concern recommends Continence from the rule', () => {
    const recs = run(answersFor([[Q.bladder, YES]]));
    expect(forForm(recs, FORM.continence.id).map((r) => r.id)).toEqual([
      'rule-r4-continence',
    ]);
  });

  it('a "No concern" hearing level does not recommend Communication', () => {
    expect(run(answersFor([[Q.hearingLevel, select('no_concern')]]))).toEqual(
      [],
    );
  });

  it('several needs at once give one recommendation per form, without duplicates', () => {
    const recs = run(
      answersFor([
        [Q.takingMeds, YES],
        [Q.emar, YES],
        [Q.falls, YES],
        [Q.bladder, YES],
      ]),
    );
    const formIds = recs.map((r) => r.carePathwayFormId);
    expect(formIds.sort()).toEqual(
      [FORM.continence.id, FORM.falls.id, FORM.medication.id].sort(),
    );
  });

  it('active Diabetes condition recommends Medication (approved condition map)', () => {
    const recs = run([], {
      conditions: [{ code: 'DIABETES', name: 'Diabetes' }],
    });
    expect(recs.map((r) => [r.id, r.source])).toEqual([
      [`condition-${FORM.medication.id}`, 'medical_condition'],
    ]);
  });

  it('existing accepted and declined decisions apply to the recommendation they were made on', () => {
    const recs = run(
      answersFor([
        [Q.wounds, YES],
        [Q.falls, YES],
      ]),
    );
    const withDecisions = applyCarePlanDecisions(recs, {
      'cp-11-skin-integrity': decision('accepted', '2026-06-01T10:00:00.000Z'),
      'rule-r7-falls': decision('declined', '2026-06-01T10:05:00.000Z'),
    });
    expect(
      withDecisions.find((r) => r.id === 'cp-11-skin-integrity')?.status,
    ).toBe('accepted');
    const falls = withDecisions.find((r) => r.id === 'rule-r7-falls');
    expect(falls?.status).toBe('declined');
    expect(falls?.declineReason).toBe('Not needed');
  });
});

// ---------------------------------------------------------------------------------------------
// Regression: known bugs from the audit
// ---------------------------------------------------------------------------------------------
describe('regression — invalid rule targets (audit B9)', () => {
  it('a rule whose form is not available (deleted "Testing Form") produces no actionable recommendation', () => {
    const recs = run(
      answersFor([[Q.whatMatters, text('Staying at home with my cat')]]),
      { rules: LIVE_RULES },
    );
    expect(
      recs.some((r) => r.carePathwayFormId === DELETED_TESTING_FORM_ID),
    ).toBe(false);
    expect(recs.some((r) => r.ruleId === 'r1-testing-form')).toBe(false);
  });
});

describe('regression — legacy suppression must not hide unrelated evidence (audit B4)', () => {
  it('hoist and transfer support (no recent fall) still produce a recommendation with that evidence', () => {
    const recs = run(
      answersFor([
        [Q.hoist, YES],
        [Q.transfer, YES],
        [Q.falls, NO],
      ]),
    );
    const withHoist = recs.filter((r) =>
      r.triggers.some((t) => t.questionId === 'q-hoist'),
    );
    expect(withHoist).toHaveLength(1);
    expect(triggerIds(withHoist[0])).toEqual(['q-hoist', 'q-transfer']);
  });

  it('amputation alone is not lost', () => {
    const recs = run(answersFor([[Q.amputation, YES]]));
    expect(
      recs.some((r) => r.triggers.some((t) => t.questionId === 'q-amputation')),
    ).toBe(true);
  });

  it('stoma alone (Continence rule unmatched) recommends Continence', () => {
    const recs = run(answersFor([[Q.stoma, YES]]));
    const cont = forForm(recs, FORM.continence.id);
    expect(cont).toHaveLength(1);
    expect(triggerIds(cont[0])).toEqual(['q-stoma']);
  });

  it('sleep concern alone (Psychological rule unmatched) is not lost', () => {
    const recs = run(answersFor([[Q.sleep, YES]]));
    expect(
      recs.some((r) => r.triggers.some((t) => t.questionId === 'q-sleep')),
    ).toBe(true);
  });

  it('oral health concern alone is not lost', () => {
    const recs = run(answersFor([[Q.oral, YES]]));
    expect(
      recs.some((r) => r.triggers.some((t) => t.questionId === 'q-oral')),
    ).toBe(true);
  });

  it('SALT communication referral (not in the live Communication rule) recommends Communication', () => {
    const recs = run(answersFor([[Q.saltComm, YES]]));
    const comm = forForm(recs, FORM.communication.id);
    expect(comm).toHaveLength(1);
    expect(triggerIds(comm[0])).toEqual(['q-salt-comm']);
  });

  it('rule match + other answers from the same section give ONE recommendation holding all the evidence', () => {
    const recs = run(
      answersFor([
        [Q.bladder, YES],
        [Q.stoma, YES],
        [Q.continenceReferral, YES],
      ]),
    );
    const cont = forForm(recs, FORM.continence.id);
    expect(cont).toHaveLength(1);
    expect(cont[0].id).toBe('rule-r4-continence');
    expect(triggerIds(cont[0])).toEqual([
      'q-bladder',
      'q-continence-referral',
      'q-stoma',
    ]);
  });

  it('a question the rule covers is not double-counted by the legacy area', () => {
    const recs = run(answersFor([[Q.bladder, YES]]));
    const cont = forForm(recs, FORM.continence.id);
    expect(cont).toHaveLength(1);
    expect(cont[0].triggers).toHaveLength(1);
  });
});

describe('regression — merge must not drop evidence (audit B5)', () => {
  const physical = answersFor([
    [Q.gpPhysical, YES],
    [Q.pain, YES],
  ]);

  it('two sections targeting Physical Health give one recommendation with both triggers', () => {
    const ph = forForm(run(physical), FORM.physicalHealth.id);
    expect(ph).toHaveLength(1);
    expect(triggerIds(ph[0])).toEqual(['q-gp-physical', 'q-pain']);
  });

  it('… and a matching medical condition adds evidence instead of dropping a section', () => {
    const ph = forForm(
      run(physical, { conditions: [{ code: 'COPD', name: 'COPD' }] }),
      FORM.physicalHealth.id,
    );
    expect(ph).toHaveLength(1);
    expect(triggerIds(ph[0])).toEqual([
      'medical-condition:COPD',
      'q-gp-physical',
      'q-pain',
    ]);
  });

  it('an IA rule and a medical condition for the same form merge into the rule recommendation', () => {
    const recs = run(
      answersFor([
        [Q.takingMeds, YES],
        [Q.emar, YES],
      ]),
      {
        conditions: [{ code: 'DIABETES', name: 'Diabetes' }],
      },
    );
    const med = forForm(recs, FORM.medication.id);
    expect(med).toHaveLength(1);
    expect(med[0].id).toBe('rule-r3-medication');
    expect(triggerIds(med[0])).toEqual([
      'medical-condition:DIABETES',
      'q-emar',
    ]);
  });
});

describe('regression — decision compatibility after merging (audit B5/B6)', () => {
  const physical = answersFor([
    [Q.gpPhysical, YES],
    [Q.pain, YES],
  ]);

  it('a decision stored on a merged-away id still applies (live case 9d4593e6)', () => {
    const recs = run(physical, {
      conditions: [{ code: 'COPD', name: 'COPD' }],
    });
    const [ph] = applyCarePlanDecisions(forForm(recs, FORM.physicalHealth.id), {
      'cp-4-physical-health': decision('accepted', '2026-06-17T05:45:06.648Z'),
    });
    expect(ph.status).toBe('accepted');
  });

  it('a declined decision on a merged-away id is not reopened as pending', () => {
    const [ph] = applyCarePlanDecisions(
      forForm(run(physical), FORM.physicalHealth.id),
      {
        'cp-5-respiratory': decision('declined', '2026-06-17T05:45:00.000Z'),
      },
    );
    expect(ph.status).toBe('declined');
    expect(ph.declineReason).toBe('Not needed');
  });

  it('when aliases disagree the most recent decision wins', () => {
    const [ph] = applyCarePlanDecisions(
      forForm(run(physical), FORM.physicalHealth.id),
      {
        'cp-5-respiratory': decision('declined', '2026-06-17T05:45:00.000Z'),
        'cp-4-physical-health': decision(
          'accepted',
          '2026-06-18T09:00:00.000Z',
        ),
      },
    );
    expect(ph.status).toBe('accepted');
  });
});

describe('regression — legacy ids are deterministic (audit B6, live case 998d2a8c)', () => {
  it('Environment triggers from §18 and §3 always use the lowest section in the id, in any answer order', () => {
    const a = run(
      answersFor([
        [Q.smoke, YES],
        [Q.parking, text('Park on the drive, not the road')],
      ]),
    );
    const b = run(
      answersFor([
        [Q.parking, text('Park on the drive, not the road')],
        [Q.smoke, YES],
      ]),
    );
    const envA = forForm(a, FORM.personalSafety.id);
    const envB = forForm(b, FORM.personalSafety.id);
    expect(envA.map((r) => r.id)).toEqual(['cp-3-environment']);
    expect(envB.map((r) => r.id)).toEqual(['cp-3-environment']);
  });

  it('a decision stored under the old order-dependent id (cp-18-environment) still applies', () => {
    const recs = run(
      answersFor([
        [Q.smoke, YES],
        [Q.parking, text('Park on the drive')],
      ]),
    );
    const [env] = applyCarePlanDecisions(
      forForm(recs, FORM.personalSafety.id),
      {
        'cp-18-environment': decision('accepted', '2026-06-04T07:29:17.352Z'),
      },
    );
    expect(env.status).toBe('accepted');
  });
});

describe('regression — free text is not a clinical trigger (audit B10)', () => {
  it.each([
    'None',
    'none.',
    'N/A',
    'Not applicable',
    'No concerns',
    'nil',
    'No',
  ])('"%s" in a free-text trigger question recommends nothing', (value) => {
    expect(run(answersFor([[Q.knownTriggers, text(value)]]))).toEqual([]);
  });

  it('a Yes/No trigger answered No is not positive even if text was stored with it', () => {
    expect(
      run(
        answersFor([[Q.pain, { ...NO, textValue: 'mild knee pain, managed' }]]),
      ),
    ).toEqual([]);
  });

  it('a substantive person-centred answer still produces the Person Centred recommendation', () => {
    const recs = run(
      answersFor([[Q.whatMatters, text('Staying at home with my cat')]]),
    );
    expect(forForm(recs, FORM.personCentred.id).map((r) => r.id)).toEqual([
      'cp-1-person-centred',
    ]);
  });
});

describe('regression — precise question matching (audit B11)', () => {
  it('a fieldKey condition matches only that field, not every question sharing the specRef', () => {
    const r1Live: CarePlanRecommendationRuleRow = {
      ...LIVE_RULES[0],
      carePathwayFormId: FORM.careReview.id,
      formName: FORM.careReview.name,
    };
    const recs = run(
      answersFor([[Q.supportGoals, text('Get out to the shops')]]),
      { rules: [r1Live] },
    );
    expect(forForm(recs, FORM.careReview.id)).toEqual([]);
  });

  it('specRef + text is an AND: same text under another specRef does not match', () => {
    const misplaced = answersFor([
      [
        { ...Q.hearingYn, id: 'q-elsewhere', metadata: { specRef: '5.9' } },
        YES,
      ],
    ]);
    const recs = run(misplaced);
    expect(
      forForm(recs, FORM.communication.id).filter((r) => r.source === 'rule'),
    ).toEqual([]);
  });

  it('mild hearing loss with the derived "moderate or worse" gate = No does not recommend Communication', () => {
    const recs = run(
      answersFor([
        [Q.hearingLevel, select('mild')],
        [Q.hearingYn, NO],
      ]),
    );
    expect(forForm(recs, FORM.communication.id)).toEqual([]);
  });

  it('moderate hearing loss (gate = Yes) still recommends Communication', () => {
    const recs = run(
      answersFor([
        [Q.hearingLevel, select('moderate')],
        [Q.hearingYn, YES],
      ]),
    );
    expect(forForm(recs, FORM.communication.id)).toHaveLength(1);
  });
});

describe('regression — ALL rules', () => {
  it('ALL with a not_answered condition matches when the other condition is met', () => {
    const allRule: CarePlanRecommendationRuleRow = {
      ...LIVE_VALID_RULES.find((r) => r.id === 'r7-falls')!,
      id: 'all-rule',
      matchMode: 'ALL',
      conditions: [
        { fieldKey: 'fallsLast12Months', when: 'yes' },
        { fieldKey: 'emarRequired', when: 'not_answered' },
      ],
      suppressLegacyArea: null,
    };
    const recs = run(answersFor([[Q.falls, YES]]), { rules: [allRule] });
    expect(recs.map((r) => r.id)).toContain('rule-all-rule');
  });
});
