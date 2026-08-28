import { HOME_SUPPORT_PLAN_FORM_NAME } from './home-support-plan.compose';
import {
  sanitizeCarePlanDraftValuesForSave,
  sanitizeDraftValueNode,
  sanitizeHomeSupportPlanDraftValues,
} from './care-plan-draft-sanitize.util';

describe('sanitizeCarePlanDraftValuesForSave', () => {
  it('stores plain text when Home Support Plan draft saves HTML strings', () => {
    const input = {
      'sec:gp': '<p>Registered with local GP practice.</p>',
      'sec:notes': '<p>Text</p>',
    };

    expect(sanitizeCarePlanDraftValuesForSave(HOME_SUPPORT_PLAN_FORM_NAME, input)).toEqual({
      'sec:gp': 'Registered with local GP practice.',
      'sec:notes': 'Text',
    });
  });

  it('leaves plain text unchanged for Home Support Plan', () => {
    const input = {
      'sec:gp': 'Registered with local GP practice.',
      'sec:notes': 'No HTML here',
    };

    expect(sanitizeCarePlanDraftValuesForSave(HOME_SUPPORT_PLAN_FORM_NAME, input)).toEqual(input);
  });

  it('stores empty string for empty HTML placeholders on Home Support Plan', () => {
    expect(
      sanitizeCarePlanDraftValuesForSave(HOME_SUPPORT_PLAN_FORM_NAME, {
        'sec:empty': '<p><br></p>',
        'sec:blank': '<p></p>',
      }),
    ).toEqual({
      'sec:empty': '',
      'sec:blank': '',
    });
  });

  it('preserves booleans and leaves non-HSP care plans unchanged', () => {
    const medicationDraft = {
      'sec:dose': '<p>Prompted</p>',
      'sec:yes': true,
    };

    expect(sanitizeCarePlanDraftValuesForSave('Medication', medicationDraft)).toEqual(medicationDraft);
    expect(sanitizeCarePlanDraftValuesForSave('Falls', medicationDraft)).toEqual(medicationDraft);
    expect(sanitizeCarePlanDraftValuesForSave('Dementia Care plan', medicationDraft)).toEqual(
      medicationDraft,
    );

    expect(
      sanitizeCarePlanDraftValuesForSave(HOME_SUPPORT_PLAN_FORM_NAME, {
        'sec:yes': true,
        'sec:html': '<p>Yes</p>',
      }),
    ).toEqual({
      'sec:yes': true,
      'sec:html': 'Yes',
    });
  });

  it('recursively sanitizes nested string values in draft JSON', () => {
    const nested = {
      meta: {
        summary: '<p>Nested summary</p>',
        tags: ['<p>One</p>', 'plain'],
      },
      'sec:top': '<p>Top level</p>',
    } as unknown as Record<string, string | boolean>;

    expect(sanitizeHomeSupportPlanDraftValues(nested)).toEqual({
      meta: {
        summary: 'Nested summary',
        tags: ['One', 'plain'],
      },
      'sec:top': 'Top level',
    });
  });

  it('sanitizeDraftValueNode leaves booleans intact', () => {
    expect(sanitizeDraftValueNode(false)).toBe(false);
    expect(sanitizeDraftValueNode(true)).toBe(true);
  });
});
