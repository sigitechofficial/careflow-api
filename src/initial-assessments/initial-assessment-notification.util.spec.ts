import {
  buildInitialAssessmentReviewedNotification,
  buildInitialAssessmentSubmittedNotification,
} from './initial-assessment-notification.util';

const names = { serviceUserShortName: 'Harry', serviceUserFullName: 'Harry Max' };

describe('buildInitialAssessmentReviewedNotification', () => {
  const base = { ...names, reviewerName: 'Sarah Khan', reviewedOnLabel: '28/09/2026' };

  it('reports approval with conditions and notes', () => {
    expect(
      buildInitialAssessmentReviewedNotification({
        ...base,
        status: 'REVIEWED',
        approvedForCareStart: true,
        careStartConditions: 'Two carers for transfers',
        reviewNotes: 'Please update the moving and handling plan',
      }),
    ).toEqual({
      title: 'Initial assessment approved — Harry',
      message:
        'Sarah Khan reviewed the initial assessment for Harry Max on 28/09/2026 and approved care start. Conditions: Two carers for transfers. Notes: Please update the moving and handling plan.',
    });
  });

  it('says care start is not approved yet', () => {
    expect(
      buildInitialAssessmentReviewedNotification({
        ...base,
        status: 'REVIEWED',
        approvedForCareStart: false,
      }),
    ).toEqual({
      title: 'Initial assessment reviewed — Harry',
      message:
        'Sarah Khan reviewed the initial assessment for Harry Max on 28/09/2026. Care start not approved yet.',
    });
  });

  it('turns rich-text conditions and notes into plain text', () => {
    expect(
      buildInitialAssessmentReviewedNotification({
        ...base,
        status: 'REVIEWED',
        approvedForCareStart: true,
        careStartConditions: '<p>Done</p>',
        reviewNotes: '<p>Check&nbsp;hoist</p><p>Two carers &amp; sling</p>',
      }).message,
    ).toBe(
      'Sarah Khan reviewed the initial assessment for Harry Max on 28/09/2026 and approved care start. Conditions: Done. Notes: Check hoist Two carers & sling.',
    );
  });

  it('reports an archive and ignores care-start conditions', () => {
    expect(
      buildInitialAssessmentReviewedNotification({
        ...base,
        status: 'ARCHIVED',
        careStartConditions: 'ignored',
      }),
    ).toEqual({
      title: 'Initial assessment archived — Harry',
      message: 'Sarah Khan archived the initial assessment for Harry Max on 28/09/2026.',
    });
  });
});

describe('buildInitialAssessmentSubmittedNotification', () => {
  it('names the service user in title and message', () => {
    expect(
      buildInitialAssessmentSubmittedNotification({ ...names, managerReviewRequired: true }),
    ).toEqual({
      title: 'Initial assessment needs manager review — Harry',
      message: 'Initial assessment for Harry Max was submitted and requires manager review.',
    });
  });

  it('never falls back to an id when the name is missing', () => {
    expect(
      buildInitialAssessmentSubmittedNotification({ managerReviewRequired: false }),
    ).toEqual({
      title: 'Initial assessment submitted',
      message: 'Initial assessment for a service user was submitted successfully.',
    });
  });
});
