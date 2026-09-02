import { composeDementiaCarePlan } from './dementia-care-plan.compose';
import { buildCarePlanPersonalisationContext } from '../../care-plan-text/care-plan-text.util';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

describe('composeDementiaCarePlan', () => {
  const fields: CarePlanFormFieldRef[] = [
    {
      key: 's1:f1',
      sectionId: 's1',
      fieldId: 'f1',
      label: 'Life history and interests',
      fieldType: 'TEXTAREA',
      required: true,
    },
    {
      key: 's2:f1',
      sectionId: 's2',
      fieldId: 'f1',
      label: 'Cognitive impairment level',
      fieldType: 'TEXT',
      required: true,
    },
    {
      key: 's2:f2',
      sectionId: 's2',
      fieldId: 'f2',
      label: 'Diagnosed dementia',
      fieldType: 'YES_NO',
      required: false,
    },
    {
      key: 's3:f1',
      sectionId: 's3',
      fieldId: 'f1',
      label: 'Safe walking / supervision level',
      fieldType: 'SELECT',
      required: true,
    },
    {
      key: 's4:f1',
      sectionId: 's4',
      fieldId: 'f1',
      label: 'Next dementia care plan review',
      fieldType: 'DATE',
      required: false,
    },
  ];

  it('maps About Me and IA §10 into dementia care plan fields', () => {
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
            questionText: 'Cognitive impairment level',
            checked: null,
            booleanValue: null,
            textValue: null,
            selectedOptions: ['moderate'],
            fieldKey: 'cognitiveImpairment',
            specRef: '10.6',
            sectionNumber: 10,
            sectionTitle: 'Psychological',
            carePlanArea: 'Mental Health',
          },
          {
            questionId: 'q2',
            questionText: 'Diagnosed dementia?',
            checked: true,
            booleanValue: true,
            textValue: null,
            selectedOptions: null,
            fieldKey: null,
            specRef: '10.6a',
            sectionNumber: 10,
            sectionTitle: 'Psychological',
            carePlanArea: 'Mental Health',
          },
        ],
      },
      aboutMe: {
        whatMattersMost: 'Gardening',
        peopleImportant: 'Sarah Hughes (daughter)',
        howToSupport: 'Quiet reassurance',
        communication: 'Short sentences',
        personalCare: null,
        foodPreferences: null,
        routineSummary: 'monday breakfast: 9am porridge',
        triggersCalm: 'Classic FM calms me',
        lifeHistoryInterests: 'Retired teacher\nBorn in Leeds',
        meaningfulActivities: 'Gardening and crosswords',
        goodDay: 'Time in the garden',
        nightSupport: 'Night light on',
      },
      emergencyContacts: ['Sarah Hughes · Daughter · 07700900123'],
      allergies: [],
      emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
      pack: null,
      gpPharmacyLine: null,
      reviewFrequencyMonths: 6,
    };

    const result = composeDementiaCarePlan(ctx, fields, 'su-1');

    expect(result.values['s1:f1']).toContain('Retired teacher');
    expect(result.values['s2:f1']).toBe('Moderate cognitive impairment');
    expect(result.values['s2:f2']).toBe(true);
    expect(result.values['s3:f1']).toBe('Intermittent supervision');
    expect(result.values['s4:f1']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.evidence.some((e) => e.source === 'about_me')).toBe(true);
    expect(result.composedFrom.mapping).toBe('dementia-care-plan');
  });
});
