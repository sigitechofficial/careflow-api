import {
  normalizeConditionProposals,
  planConditionPromotion,
  type RegisterConditionRow,
} from './initial-assessment-condition-proposals.util';

const row = (patch: Partial<RegisterConditionRow>): RegisterConditionRow => ({
  id: 'row-1',
  conditionId: 'c-diabetes',
  status: 'ACTIVE',
  impactOnCare: '',
  carerGuidance: '',
  confirmationSource: '',
  ...patch,
});

describe('planConditionPromotion', () => {
  it('adds a condition that is not on the register', () => {
    const plan = planConditionPromotion(
      [
        {
          id: 'p1',
          conditionId: 'c-copd',
          impactOnCare: 'Breathless on stairs',
        },
      ],
      [row({})],
    );
    expect(plan.create.map((p) => p.conditionId)).toEqual(['c-copd']);
    expect(plan.fill).toEqual([]);
  });

  it('only fills empty care details on an active row', () => {
    const plan = planConditionPromotion(
      [
        {
          id: 'p1',
          conditionId: 'c-diabetes',
          impactOnCare: 'Needs meals on time',
          carerGuidance: 'Check for hypo signs',
        },
      ],
      [row({ carerGuidance: 'Check for hypo signs' })],
    );
    expect(plan.fill).toEqual([
      { rowId: 'row-1', data: { impactOnCare: 'Needs meals on time' } },
    ]);
    expect(plan.review).toEqual([]);
  });

  it('never overwrites different wording — the office reviews it', () => {
    const plan = planConditionPromotion(
      [
        {
          id: 'p1',
          conditionId: 'c-diabetes',
          carerGuidance: 'Call 999 if unresponsive',
        },
      ],
      [row({ carerGuidance: 'Give glucose gel' })],
    );
    expect(plan.fill).toEqual([]);
    expect(plan.review).toEqual([
      {
        proposal: expect.objectContaining({ id: 'p1' }),
        reason: 'details_differ',
      },
    ]);
  });

  it('does not reactivate a discontinued condition', () => {
    const plan = planConditionPromotion(
      [{ id: 'p1', conditionId: 'c-diabetes' }],
      [row({ status: 'DISCONTINUED' })],
    );
    expect(plan.create).toEqual([]);
    expect(plan.review[0]?.reason).toBe('inactive_on_register');
  });
});

describe('normalizeConditionProposals', () => {
  it('drops malformed rows and duplicates of the same condition', () => {
    expect(
      normalizeConditionProposals([
        { id: 'a', conditionId: 'c1' },
        { id: 'b', conditionId: 'c1' },
        { id: 'c' },
        null,
      ]).map((p) => p.id),
    ).toEqual(['a']);
  });
});
