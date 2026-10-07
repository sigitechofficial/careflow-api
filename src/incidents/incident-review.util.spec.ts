import { describeReviewChanges, immediateRiskError, type ReviewAnswers } from './incident-review.util';

const empty: ReviewAnswers = {
  safeguardingConcern: null,
  possibleAbuseOrNeglect: null,
  furtherMedicalAttention: null,
  externalNotificationRequired: null,
  escalationRequired: null,
  immediateRisk: null,
  protectiveAction: null,
  managementNotes: null,
};

describe('describeReviewChanges', () => {
  it('finds nothing when nothing changed (null and undefined are the same)', () => {
    expect(describeReviewChanges(empty, { ...empty, managementNotes: undefined })).toEqual([]);
  });

  it('describes yes/no changes with the current labels, then text changes', () => {
    expect(
      describeReviewChanges(empty, {
        ...empty,
        immediateRisk: true,
        protectiveAction: 'Second carer on all visits',
        escalationRequired: false,
        managementNotes: 'x',
      }),
    ).toEqual([
      'Immediate senior management escalation Not answered → No',
      'Immediate or ongoing risk Not answered → Yes',
      'protective action changed',
      'notes changed',
    ]);
  });
});

describe('immediateRiskError', () => {
  it('needs a protective action only when there is a risk', () => {
    expect(immediateRiskError(true, '  ')).toMatch(/protective action/);
    expect(immediateRiskError(true, 'Removed the carer from the visit')).toBeNull();
    expect(immediateRiskError(false, null)).toBeNull();
    expect(immediateRiskError(null, null)).toBeNull();
  });
});
