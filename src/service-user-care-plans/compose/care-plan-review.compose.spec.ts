import {
  composeCarePlanReviewForm,
  CARE_PLAN_REVIEW_FIELD_MAPPINGS,
} from './care-plan-review.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import { buildCarePlanPersonalisationContext } from '../../care-plan-text/care-plan-text.util';

describe('composeCarePlanReviewForm', () => {
  const fields: CarePlanFormFieldRef[] = [
    {
      key: 's1:f1',
      sectionId: 's1',
      fieldId: 'f1',
      label: 'Review date',
      fieldType: 'DATE',
      required: true,
    },
    {
      key: 's2:f1',
      sectionId: 's2',
      fieldId: 'f1',
      label: 'Medication support level',
      fieldType: 'TEXT',
      required: false,
    },
    {
      key: 's2:f2',
      sectionId: 's2',
      fieldId: 'f2',
      label: 'Active medications summary',
      fieldType: 'TEXTAREA',
      required: false,
    },
    {
      key: 's3:f1',
      sectionId: 's3',
      fieldId: 'f1',
      label: 'Next review date',
      fieldType: 'DATE',
      required: false,
    },
  ];

  it('prefills review snapshot fields from IA and eMAR', () => {
    const ctx: CarePlanComposeContext = {
      serviceUserId: 'su-1',
      serviceUserName: 'Margaret Hughes',
      personalisation: buildCarePlanPersonalisationContext({
        firstName: 'Margaret',
        lastName: 'Hughes',
      }),
      ia: {
        submissionId: 'ia-1',
        submittedAt: '2026-06-01T10:00:00.000Z',
        answers: [
          {
            questionId: 'q1',
            questionText: 'Recommended medication support level',
            checked: null,
            booleanValue: null,
            textValue: null,
            selectedOptions: ['prompting'],
            fieldKey: 'medicationSupportLevel',
            specRef: '9.2',
            sectionNumber: 9,
            sectionTitle: 'Medication',
            carePlanArea: 'Medication',
          },
        ],
      },
      aboutMe: null,
      emergencyContacts: [],
      allergies: [],
      emar: {
        activeCount: 1,
        scheduledCount: 1,
        prnCount: 0,
        medListText: 'Metformin 500mg',
        prnText: '',
      },
      pack: null,
      gpPharmacyLine: null,
    };

    const result = composeCarePlanReviewForm(ctx, fields, 'su-1');

    expect(result.values['s1:f1']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.values['s2:f1']).toBe('Prompted');
    expect(result.values['s2:f2']).toContain('Metformin');
    expect(result.values['s3:f1']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.evidence.some((e) => e.source === 'ia')).toBe(true);
    expect(CARE_PLAN_REVIEW_FIELD_MAPPINGS.length).toBeGreaterThan(8);
  });
});
