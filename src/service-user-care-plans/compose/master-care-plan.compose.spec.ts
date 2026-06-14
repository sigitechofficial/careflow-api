import { composeMasterCarePlan } from './master-care-plan.compose';
import { buildCarePlanPersonalisationContext } from '../../care-plan-text/care-plan-text.util';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

describe('composeMasterCarePlan', () => {
  const fields: CarePlanFormFieldRef[] = [
    {
      key: 's1:f1',
      sectionId: 's1',
      fieldId: 'f1',
      label: 'What matters most to @',
      fieldType: 'TEXTAREA',
      required: true,
    },
    {
      key: 's1:f2',
      sectionId: 's1',
      fieldId: 'f2',
      label: 'Emergency contacts',
      fieldType: 'TEXTAREA',
      required: true,
    },
    {
      key: 's2:f1',
      sectionId: 's2',
      fieldId: 'f1',
      label: 'Assessment date',
      fieldType: 'DATE',
      required: true,
    },
  ];

  it('merges About Me and IA into master care plan fields', () => {
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
            questionText: 'What matters most to the Service User?',
            checked: null,
            booleanValue: null,
            textValue: 'Independence at home',
            selectedOptions: null,
            fieldKey: 'whatMattersMost',
            specRef: '1.3',
            sectionNumber: 1,
            sectionTitle: 'Introduction',
            carePlanArea: 'Introduction',
          },
        ],
      },
      aboutMe: {
        whatMattersMost: 'Staying in my own home',
        peopleImportant: 'Sarah Hughes (daughter)',
        howToSupport: 'Female carers preferred',
        communication: 'Speak clearly',
        personalCare: 'Morning shower',
        foodPreferences: 'Tea with one sugar',
        routineSummary: 'monday breakfast: 9am porridge',
        triggersCalm: 'Classic FM calms me',
      },
      emergencyContacts: ['Sarah Hughes · Daughter · 07700900123'],
      allergies: [],
      emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
      pack: null,
      gpPharmacyLine: null,
    };

    const result = composeMasterCarePlan(ctx, fields, 'su-1');

    expect(result.values['s1:f1']).toContain('Staying in my own home');
    expect(result.values['s1:f2']).toContain('Sarah Hughes');
    expect(result.values['s2:f1']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.evidence.some((e) => e.source === 'about_me')).toBe(true);
  });
});
