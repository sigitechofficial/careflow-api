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
    expect(mapMedicationSupportLevelToCarePlan('level_0')).toBe('Self-administers');
    expect(mapMedicationSupportLevelToCarePlan('level_1a')).toBe('Prompted');
    expect(mapMedicationSupportLevelToCarePlan('level_1b')).toBe('Assisted by carer');
    expect(mapMedicationSupportLevelToCarePlan('level_2a')).toBe('Assisted by carer');
    // Medication safety: level 2b = carers administer — never 'Nurse only'.
    expect(mapMedicationSupportLevelToCarePlan('level_2b')).toBe('Administered by carer');
    expect(mapMedicationSupportLevelToCarePlan('provided_by_others')).toBe(
      'Provided by others (family / nurse)',
    );
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

    expect(result.values['sec:1']).toBeUndefined();
    expect(result.suggestions?.some((s) => s.targetFieldKey === 'sec:1' && s.suggestedValue === 'Prompted')).toBe(
      true,
    );
    expect(result.values['sec:2']).toContain('Penicillin');
    expect(result.values['sec:3']).toContain('Dr Smith');
    expect(result.evidence.some((e) => e.source === 'emar')).toBe(true);
    expect(result.gaps).toHaveLength(0);
  });

  it('populates Medication fields from demo medicationSnapshot when §9 answer rows are absent', () => {
    const formFields: CarePlanFormFieldRef[] = [
      {
        key: 'sec:support',
        sectionId: 'sec',
        fieldId: 'support',
        label: 'Medication support level',
        fieldType: 'SELECT',
        required: true,
      },
      {
        key: 'sec:allergies',
        sectionId: 'sec',
        fieldId: 'allergies',
        label: 'Known allergies',
        fieldType: 'TEXTAREA',
        required: true,
      },
      {
        key: 'sec:prn',
        sectionId: 'sec',
        fieldId: 'prn',
        label: 'PRN medicines and when used',
        fieldType: 'TEXTAREA',
        required: false,
      },
      {
        key: 'sec:storage',
        sectionId: 'sec',
        fieldId: 'storage',
        label: 'Storage and blister packs',
        fieldType: 'TEXT',
        required: false,
      },
      {
        key: 'sec:refusal',
        sectionId: 'sec',
        fieldId: 'refusal',
        label: 'Refusal or missed dose – action',
        fieldType: 'TEXTAREA',
        required: true,
      },
      {
        key: 'sec:gp',
        sectionId: 'sec',
        fieldId: 'gp',
        label: 'Pharmacy and GP contact',
        fieldType: 'TEXT',
        required: false,
      },
    ];

    const ctx: CarePlanComposeContext = {
      serviceUserId: 'su-demo',
      serviceUserName: 'Demo User',
      personalisation: buildCarePlanPersonalisationContext({
        firstName: 'Demo',
        lastName: 'User',
      }),
      ia: {
        submissionId: 'demo-ia',
        submittedAt: '2026-08-19T07:36:44.000Z',
        status: 'SUBMITTED',
        // Pruned enterprise §9 — no medicationSupportLevel / allergy details answers.
        answers: [
          {
            questionId: 'q-taking',
            questionText: 'Taking prescribed medication?',
            checked: true,
            booleanValue: true,
            textValue: null,
            selectedOptions: null,
            fieldKey: 'takingPrescribedMedication',
            specRef: '9.1',
            sectionNumber: 9,
            sectionTitle: 'Medication',
            carePlanArea: 'Medication',
          },
          {
            questionId: 'q-allergies-summary',
            questionText: 'Allergies (summary)',
            checked: null,
            booleanValue: null,
            textValue: 'No known allergies.',
            selectedOptions: null,
            fieldKey: 'allergiesSummary',
            specRef: '1.0',
            sectionNumber: 1,
            sectionTitle: 'About the Service User',
            carePlanArea: null,
          },
        ],
        medicationSnapshot: {
          supportLevel: 'prompting',
          allergyDetails: 'No known allergies.',
          currentMedicationDetails: 'Regular medicines include prescribed tablets taken as directed.',
          prnProtocol: 'Paracetamol PRN for occasional pain as prescribed.',
          packagingHelpRequired: true,
          storageNotes:
            'Medicines stored securely in original packaging. Blister pack used where required.',
          safetyNotes:
            'If medication is refused or missed, record in MAR and inform GP/pharmacy according to procedure.',
        },
      },
      aboutMe: null,
      emergencyContacts: [],
      allergies: [],
      emar: {
        activeCount: 0,
        scheduledCount: 0,
        prnCount: 0,
        medListText: '',
        prnText: '',
      },
      pack: null,
      gpPharmacyLine: 'Dr Patel, Riverside Medical Centre, Tel 01234 567890',
    };

    const result = composeMedicationCarePlan(
      ctx,
      formFields,
      MEDICATION_CARE_PLAN_FIELD_MAPPINGS,
      'su-demo',
    );

    expect(result.values['sec:support']).toBeUndefined();
    expect(result.suggestions?.some((s) => s.targetFieldKey === 'sec:support' && s.suggestedValue === 'Prompted')).toBe(
      true,
    );
    expect(result.values['sec:allergies']).toContain('No known allergies');
    expect(String(result.values['sec:prn'])).toContain('Paracetamol PRN');
    expect(String(result.values['sec:storage'])).toMatch(/Blister pack|packaging/i);
    expect(String(result.values['sec:refusal'])).toMatch(/refused or missed/i);
    expect(String(result.values['sec:gp'])).toContain('Dr Patel');
    expect(result.gaps).toHaveLength(0);
  });

  it('uses allergiesSummary when allergy-details question is missing', () => {
    const result = composeMedicationCarePlan(
      {
        serviceUserId: 'su-1',
        serviceUserName: 'Test',
        personalisation: buildCarePlanPersonalisationContext({ firstName: 'Test', lastName: 'User' }),
        ia: {
          submissionId: 'ia-1',
          submittedAt: '2026-08-19T07:36:44.000Z',
          answers: [
            {
              questionId: 'q-sum',
              questionText: 'Allergies (summary)',
              checked: null,
              booleanValue: null,
              textValue: 'No known allergies.',
              selectedOptions: null,
              fieldKey: 'allergiesSummary',
              sectionNumber: 1,
              sectionTitle: 'About',
              carePlanArea: null,
            },
          ],
        },
        aboutMe: null,
        emergencyContacts: [],
        allergies: [],
        emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
        pack: null,
        gpPharmacyLine: null,
      },
      [
        {
          key: 'sec:allergies',
          sectionId: 'sec',
          fieldId: 'allergies',
          label: 'Known allergies',
          fieldType: 'TEXTAREA',
          required: true,
        },
      ],
      MEDICATION_CARE_PLAN_FIELD_MAPPINGS,
      'su-1',
    );

    expect(result.values['sec:allergies']).toBe('No known allergies.');
    expect(result.gaps).toHaveLength(0);
  });

  it('emits a medicationSupportLevel SUGGESTION from IA answers without writing composed values', () => {
    const supportField: CarePlanFormFieldRef = {
      key: 'overview:support',
      sectionId: 'overview',
      fieldId: 'support',
      fieldKey: 'medication_support_level',
      label: 'Medication support level',
      fieldType: 'SELECT',
      required: true,
    };
    const ctx: CarePlanComposeContext = {
      serviceUserId: 'su-colin',
      serviceUserName: 'Colin Ashworth',
      personalisation: buildCarePlanPersonalisationContext({
        firstName: 'Colin',
        lastName: 'Ashworth',
      }),
      ia: {
        submissionId: 'ia-in-progress',
        submittedAt: null,
        status: 'IN_PROGRESS',
        answers: [
          {
            questionId: 'q-med-support',
            questionText: 'Recommended medication support level',
            checked: null,
            booleanValue: null,
            textValue: null,
            selectedOptions: 'level_2a',
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
      emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
      pack: null,
      gpPharmacyLine: null,
    };

    const result = composeMedicationCarePlan(
      ctx,
      [supportField],
      MEDICATION_CARE_PLAN_FIELD_MAPPINGS,
      'su-colin',
    );

    expect(result.suggestionMode).toBe('hybrid');
    expect(result.values['overview:support']).toBeUndefined();
    expect(result.values).not.toHaveProperty('medication_support_level');
    const suggestion = result.suggestions?.find((s) => s.targetFieldKey === 'overview:support');
    expect(suggestion).toEqual(
      expect.objectContaining({
        kind: 'value',
        suggestedValue: 'Assisted by carer',
        displayText: 'Assisted by carer',
        sourceType: 'INITIAL_ASSESSMENT',
        questionFieldKey: 'medicationSupportLevel',
      }),
    );
  });
});
