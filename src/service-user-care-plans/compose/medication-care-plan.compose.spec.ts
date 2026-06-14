import { buildEmarComposeSummary } from './emar-compose-summary.util';
import { MedicationKind, MedicationRecordStatus } from '@prisma/client';
import {
  mapMedicationSupportLevelToCarePlan,
  resolveIaDisplayValue,
  findIaAnswer,
} from './ia-answer-resolver.util';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import {
  composeMedicationCarePlan,
  MEDICATION_CARE_PLAN_FIELD_MAPPINGS,
} from './medication-care-plan.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import { buildCarePlanPersonalisationContext } from '../../care-plan-text/care-plan-text.util';

describe('buildEmarComposeSummary', () => {
  it('summarises scheduled and PRN meds separately', () => {
    const summary = buildEmarComposeSummary([
      {
        medicationName: 'Paracetamol',
        medicationKind: MedicationKind.REGULAR,
        status: MedicationRecordStatus.ACTIVE,
        dose: '500mg',
        strength: null,
      },
      {
        medicationName: 'Salbutamol',
        medicationKind: MedicationKind.PRN,
        status: MedicationRecordStatus.ACTIVE,
        dose: '2 puffs',
        strength: null,
      },
    ]);

    expect(summary.activeCount).toBe(2);
    expect(summary.scheduledCount).toBe(1);
    expect(summary.prnCount).toBe(1);
    expect(summary.medListText).toContain('Paracetamol');
    expect(summary.prnText).toContain('Salbutamol');
  });
});

describe('mapMedicationSupportLevelToCarePlan', () => {
  it('maps IA codes to care plan select labels', () => {
    expect(mapMedicationSupportLevelToCarePlan('independent')).toBe('Self-administers');
    expect(mapMedicationSupportLevelToCarePlan('prompting')).toBe('Prompted');
    expect(mapMedicationSupportLevelToCarePlan('full_admin')).toBe('Administered by carer');
    expect(mapMedicationSupportLevelToCarePlan('district_nurse')).toBe('Nurse only');
  });
});

describe('composeMedicationCarePlan', () => {
  const fields: CarePlanFormFieldRef[] = [
    {
      key: 'sec:1',
      sectionId: 'sec',
      fieldId: '1',
      label: 'Medication support level',
      fieldType: 'SELECT',
      required: true,
    },
    {
      key: 'sec:2',
      sectionId: 'sec',
      fieldId: '2',
      label: 'Known allergies',
      fieldType: 'TEXTAREA',
      required: true,
    },
    {
      key: 'sec:3',
      sectionId: 'sec',
      fieldId: '3',
      label: 'Pharmacy and GP contact',
      fieldType: 'TEXT',
      required: false,
    },
  ];

  const iaAnswers: SubmissionAnswerForRules[] = [
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
    {
      questionId: 'q2',
      questionText: 'GP name',
      checked: null,
      booleanValue: null,
      textValue: 'Dr Smith',
      selectedOptions: null,
      specRef: '13.9',
      sectionNumber: 13,
      sectionTitle: 'Safeguarding',
      carePlanArea: 'Safeguarding',
    },
  ];

  it('prefills mapped fields and reports evidence', () => {
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
        answers: iaAnswers,
      },
      aboutMe: null,
      emergencyContacts: [],
      allergies: ['Penicillin'],
      emar: {
        activeCount: 2,
        scheduledCount: 2,
        prnCount: 0,
        medListText: 'Aspirin\nMetformin',
        prnText: '',
      },
      pack: null,
      gpPharmacyLine: 'GP: Dr Smith',
    };

    const result = composeMedicationCarePlan(
      ctx,
      fields,
      MEDICATION_CARE_PLAN_FIELD_MAPPINGS,
      'su-1',
    );

    expect(result.values['sec:1']).toBe('Prompted');
    expect(result.values['sec:2']).toContain('Penicillin');
    expect(result.values['sec:3']).toContain('Dr Smith');
    expect(result.evidence.some((e) => e.source === 'emar')).toBe(true);
    expect(result.gaps).toHaveLength(0);
  });
});
