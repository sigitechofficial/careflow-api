import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import { runCarePlanCompose } from './compose-context.loader';
import {
  composeHomeSupportPlanHybrid,
  composeOutputContainsSecureIaValues,
  HOME_SUPPORT_PLAN_FORM_NAME,
} from './home-support-plan.compose';
import {
  HSP_PILOT_AUTO_PREFILL_KEYS,
  HSP_PILOT_SUGGESTION_KEYS,
  HSP_SECURE_IA_FIELD_KEYS,
  hspTierManifestFromRegistry,
} from './home-support-plan-field-mappings';
import { buildCarePlanPersonalisationContext } from '../../care-plan-text/care-plan-text.util';

function answer(
  partial: Partial<SubmissionAnswerForRules> & Pick<SubmissionAnswerForRules, 'questionId' | 'questionText'>,
): SubmissionAnswerForRules {
  return {
    checked: null,
    booleanValue: null,
    textValue: null,
    selectedOptions: null,
    numberValue: null,
    dateValue: null,
    sectionNumber: 1,
    sectionTitle: 'Holistic assessment',
    carePlanArea: 'About me',
    ...partial,
  };
}

function hspField(
  businessKey: string,
  label: string,
  fieldType: string,
  sectionId = 'sec',
): CarePlanFormFieldRef {
  const fieldId = businessKey.replace(/^hsp_/, '');
  return {
    key: `${sectionId}:${fieldId}`,
    sectionId,
    fieldId,
    fieldKey: businessKey,
    label,
    fieldType,
    required: false,
  };
}

const HSP_PILOT_FIELDS: CarePlanFormFieldRef[] = [
  ...HSP_PILOT_AUTO_PREFILL_KEYS.map((key) => {
    const textareaKeys = new Set(['hsp_mobility_aids_in_use', 'hsp_other_care_agencies', 'hsp_gp_pharmacy_professionals']);
    const yesNoKeys = new Set([
      'hsp_lives_alone',
      'hsp_key_safe_in_use',
      'hsp_hoist_sling_in_use',
      'hsp_informal_carer_involved',
    ]);
    const fieldType = textareaKeys.has(key) ? 'TEXTAREA' : yesNoKeys.has(key) ? 'YES_NO' : 'TEXTAREA';
    return hspField(key, key, fieldType);
  }),
  ...HSP_PILOT_SUGGESTION_KEYS.map((key) => hspField(key, key, 'TEXTAREA', 'suggest')),
];

const SECURE_KEY_SAFE_CODE = 'SECRET-KS-4829';
const SECURE_DOOR_CODE = 'SECRET-DR-9912';

const IA_ANSWERS: SubmissionAnswerForRules[] = [
  answer({
    questionId: 'q-lives-alone',
    questionText: 'Does the client live alone?',
    specRef: '1.2',
    fieldKey: 'livesAlone',
    booleanValue: true,
    checked: true,
  }),
  answer({
    questionId: 'q-key-safe',
    questionText: 'Key safe present?',
    specRef: '3.5',
    fieldKey: 'keySafePresent',
    booleanValue: true,
    checked: true,
  }),
  answer({
    questionId: 'q-key-safe-code',
    questionText: 'Key safe code',
    specRef: '3.5',
    fieldKey: 'keySafeCode',
    textValue: SECURE_KEY_SAFE_CODE,
  }),
  answer({
    questionId: 'q-door-code',
    questionText: 'Door entry code',
    specRef: '3.5',
    fieldKey: 'doorCode',
    textValue: SECURE_DOOR_CODE,
  }),
  answer({
    questionId: 'q-hoist',
    questionText: 'Uses hoist or sling?',
    specRef: '12.5a',
    fieldKey: 'usesHoistOrSling',
    booleanValue: false,
    checked: false,
  }),
  answer({
    questionId: 'q-informal-carer',
    questionText: 'Does the client receive support from an informal carer?',
    specRef: '1.2',
    fieldKey: 'informalCarerSupport',
    booleanValue: true,
    checked: true,
  }),
  answer({
    questionId: 'q-other-agencies',
    questionText: 'Details of other care agencies involved with client',
    specRef: '1.2',
    fieldKey: 'otherCareAgencies',
    textValue: 'District nurse visits twice weekly.',
  }),
  answer({
    questionId: 'q-gp-contact',
    questionText: 'GP contact details',
    specRef: '1.1',
    fieldKey: 'gpContactDetails',
    textValue: 'Dr Smith, Riverside Surgery, 01234 567890',
  }),
  answer({
    questionId: 'q-gp-name',
    questionText: 'GP name',
    specRef: '13.9',
    textValue: 'Dr Smith',
  }),
  answer({
    questionId: 'q-gp-practice',
    questionText: 'GP practice and phone',
    specRef: '13.9',
    textValue: 'Riverside Surgery — 01234 567890',
  }),
  answer({
    questionId: 'q-pharmacy',
    questionText: 'Pharmacy name and phone',
    specRef: '13.9',
    textValue: 'High Street Pharmacy — 01234 999888',
  }),
  answer({
    questionId: 'q-fire-details',
    questionText: 'Fire safety risks — details',
    specRef: '3.1',
    fieldKey: 'fireSafetyRisksDetails',
    textValue: 'Smoking in lounge; ensure ashtray emptied.',
  }),
  answer({
    questionId: 'q-home-env',
    questionText: 'Home environment safety measures',
    specRef: '3.1',
    fieldKey: 'homeEnvironmentSafetyMeasures',
    textValue: 'Night lights fitted in hallway.',
  }),
  answer({
    questionId: 'q-env-notes',
    questionText: 'Environment / access hazard notes',
    specRef: '3.10',
    textValue: 'Two steps at front door.',
  }),
];

function buildContext(overrides?: Partial<CarePlanComposeContext>): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    serviceUserName: 'Jane Doe',
    personalisation: buildCarePlanPersonalisationContext({
      firstName: 'Jane',
      lastName: 'Doe',
      preferredName: null,
      serviceUserNumber: 'SU001',
    }),
    ia: {
      submissionId: 'ia-hsp-1',
      submittedAt: '2026-08-19T07:36:44.000Z',
      status: 'SUBMITTED',
      answers: IA_ANSWERS,
      adlMetadata: {
        rows: [
          { id: 'bathing', activity: 'Bathing', score: 2, notes: 'AM only' },
          { id: 'grooming', activity: 'Grooming', score: 1 },
          { id: 'dressing_undressing', activity: 'Dressing / undressing', score: 2 },
          { id: 'toileting', activity: 'Toileting', score: 0 },
          { id: 'preparing_food', activity: 'Preparing food', score: 2 },
        ],
        mobilityAidsRequired: true,
        mobilityAidsList: 'Walking frame, stick',
      },
    },
    previousAssessments: [],
    aboutMe: {
      whatMattersMost: null,
      peopleImportant: null,
      howToSupport: null,
      communication: null,
      personalCare: 'Shower preferred in morning.',
      domesticSupport: 'Meals prepared by carers.',
      foodPreferences: null,
      routineSummary: null,
      triggersCalm: null,
      lifeHistoryInterests: null,
      meaningfulActivities: null,
      goodDay: null,
      nightSupport: null,
    },
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
    gpPharmacyLine: 'GP: Dr Smith\nRiverside Surgery — 01234 567890\nPharmacy: High Street Pharmacy — 01234 999888',
    ...overrides,
  };
}

describe('composeHomeSupportPlanHybrid', () => {
  it('returns hybrid suggestion mode', () => {
    const result = composeHomeSupportPlanHybrid(buildContext(), HSP_PILOT_FIELDS, 'su-1');
    expect(result.suggestionMode).toBe('hybrid');
    expect(result.composedFrom.mapping).toBe('home-support-plan-hybrid');
    expect(result.composedFrom.tierManifest).toEqual(hspTierManifestFromRegistry());
  });

  it('auto-prefills pilot tier-A fields into compose.values', () => {
    const result = composeHomeSupportPlanHybrid(buildContext(), HSP_PILOT_FIELDS, 'su-1');

    expect(result.values['sec:lives_alone']).toBe(true);
    expect(result.values['sec:key_safe_in_use']).toBe(true);
    expect(result.values['sec:mobility_aids_in_use']).toContain('Walking frame');
    expect(result.values['sec:hoist_sling_in_use']).toBe(false);
    expect(result.values['sec:informal_carer_involved']).toBe(true);
    expect(result.values['sec:other_care_agencies']).toBe('District nurse visits twice weekly.');
    expect(result.values['sec:gp_pharmacy_professionals']).toContain('Dr Smith');
  });

  it('creates provenance with autoPrefilled=true for auto fields', () => {
    const result = composeHomeSupportPlanHybrid(buildContext(), HSP_PILOT_FIELDS, 'su-1');

    expect(result.provenance?.['sec:lives_alone']).toMatchObject({
      sourceType: 'INITIAL_ASSESSMENT',
      submissionId: 'ia-hsp-1',
      autoPrefilled: true,
      userEdited: false,
      originalValue: true,
    });
    expect(result.provenance?.['sec:key_safe_in_use']?.autoPrefilled).toBe(true);
    expect(result.composedFrom.fieldProvenance).toBeDefined();
    expect(result.composedFrom.fieldProvenance).toHaveProperty('sec:lives_alone');
  });

  it('generates tier-B suggestions without writing compose.values', () => {
    const result = composeHomeSupportPlanHybrid(buildContext(), HSP_PILOT_FIELDS, 'su-1');

    expect(result.suggestions?.length).toBeGreaterThan(0);
    expect(result.suggestions?.every((s) => s.id.startsWith('hsp:'))).toBe(true);

    for (const key of HSP_PILOT_SUGGESTION_KEYS) {
      const fieldId = key.replace(/^hsp_/, '');
      expect(result.values[`suggest:${fieldId}`]).toBeUndefined();
      expect(result.provenance?.[`suggest:${fieldId}`]).toBeUndefined();
    }

    const personalCare = result.suggestions?.find((s) => s.targetFieldKey === 'suggest:personal_care_tasks');
    expect(personalCare?.displayText).toContain('Bathing');
    expect(personalCare?.displayText).toContain('Shower preferred in morning');

    const mealPrep = result.suggestions?.find((s) => s.targetFieldKey === 'suggest:meal_preparation_support');
    expect(mealPrep?.displayText).toContain('Preparing food');
    expect(mealPrep?.displayText).toContain('Meals prepared by carers');

    const hazards = result.suggestions?.find((s) => s.targetFieldKey === 'suggest:environmental_hazards_notes');
    expect(hazards?.displayText).toContain('Smoking in lounge');
    expect(hazards?.displayText).toContain('Two steps at front door');
  });

  it('sanitizes HTML from IA rich text before writing compose values and suggestions', () => {
    const htmlContext = buildContext({
      ia: {
        submissionId: 'ia-hsp-html',
        submittedAt: '2026-08-19T07:36:44.000Z',
        status: 'SUBMITTED',
        answers: [
          ...IA_ANSWERS.filter((row) => row.fieldKey !== 'gpContactDetails'),
          answer({
            questionId: 'q-gp-contact-html',
            questionText: 'GP contact details',
            specRef: '1.1',
            fieldKey: 'gpContactDetails',
            textValue: '<p>Registered with local GP practice.</p><p><br></p>',
          }),
          answer({
            questionId: 'q-gp-contact-encoded',
            questionText: 'GP contact details encoded',
            specRef: '1.1',
            fieldKey: 'gpContactDetailsEncoded',
            textValue: '&lt;p&gt;Encoded GP note&lt;/p&gt;',
          }),
          answer({
            questionId: 'q-other-agencies-html',
            questionText: 'Details of other care agencies involved with client',
            specRef: '1.2',
            fieldKey: 'otherCareAgencies',
            textValue: '<p>District nurse visits twice weekly.</p>',
          }),
          answer({
            questionId: 'q-fire-details-html',
            questionText: 'Fire safety risks — details',
            specRef: '3.1',
            fieldKey: 'fireSafetyRisksDetails',
            textValue: '<p>Smoking in lounge; ensure ashtray emptied.</p>',
          }),
        ],
        adlMetadata: buildContext().ia!.adlMetadata,
      },
      aboutMe: {
        ...buildContext().aboutMe!,
        personalCare: '<p>Shower preferred in morning.</p>',
      },
      gpPharmacyLine: '<p>GP: Dr Smith</p>\n<p>High Street Pharmacy</p>',
    });

    const result = composeHomeSupportPlanHybrid(htmlContext, HSP_PILOT_FIELDS, 'su-1');

    expect(result.values['sec:gp_pharmacy_professionals']).toContain('Registered with local GP practice.');
    expect(result.values['sec:gp_pharmacy_professionals']).toContain('GP: Dr Smith');
    expect(result.values['sec:gp_pharmacy_professionals']).toContain('High Street Pharmacy');
    expect(result.values['sec:other_care_agencies']).toBe('District nurse visits twice weekly.');
    expect(JSON.stringify(result)).not.toMatch(/<p>/i);
    expect(JSON.stringify(result)).not.toMatch(/&lt;p&gt;/i);

    const hazards = result.suggestions?.find((s) => s.targetFieldKey === 'suggest:environmental_hazards_notes');
    expect(hazards?.displayText).toContain('Smoking in lounge; ensure ashtray emptied.');

    const personalCare = result.suggestions?.find((s) => s.targetFieldKey === 'suggest:personal_care_tasks');
    expect(personalCare?.displayText).toContain('Shower preferred in morning.');

    expect(result.provenance?.['sec:gp_pharmacy_professionals']?.originalValue).toContain(
      'Registered with local GP practice.',
    );
  });

  it('regression: GP rich text input produces plain text output', () => {
    const result = composeHomeSupportPlanHybrid(
      buildContext({
        ia: {
          submissionId: 'ia-regression',
          submittedAt: '2026-08-19T07:36:44.000Z',
          status: 'SUBMITTED',
          answers: [
            answer({
              questionId: 'q-gp-only',
              questionText: 'GP contact details',
              specRef: '1.1',
              fieldKey: 'gpContactDetails',
              textValue: '<p>Registered with local GP practice.</p>',
            }),
          ],
          adlMetadata: null,
        },
        gpPharmacyLine: null,
        aboutMe: null,
      }),
      HSP_PILOT_FIELDS,
      'su-1',
    );

    expect(result.values['sec:gp_pharmacy_professionals']).toBe('Registered with local GP practice.');
  });

  it('never includes secure keySafeCode or doorCode values in compose output', () => {
    const result = composeHomeSupportPlanHybrid(buildContext(), HSP_PILOT_FIELDS, 'su-1');

    expect(HSP_SECURE_IA_FIELD_KEYS).toEqual(
      expect.arrayContaining(['keySafeCode', 'doorCode', 'keySafeCodeHolistic']),
    );
    expect(composeOutputContainsSecureIaValues(result, [SECURE_KEY_SAFE_CODE, SECURE_DOOR_CODE])).toBe(false);

    for (const suggestion of result.suggestions ?? []) {
      expect(suggestion.displayText).not.toContain(SECURE_KEY_SAFE_CODE);
      expect(suggestion.displayText).not.toContain(SECURE_DOOR_CODE);
      expect(String(suggestion.suggestedValue)).not.toContain(SECURE_KEY_SAFE_CODE);
      expect(String(suggestion.suggestedValue)).not.toContain(SECURE_DOOR_CODE);
    }
  });

  it('resolves targets by CarePathwayFormField.fieldKey (hsp_*)', () => {
    const fields: CarePlanFormFieldRef[] = [
      {
        key: 'runtime:abc',
        sectionId: 'runtime',
        fieldId: 'abc',
        fieldKey: 'hsp_lives_alone',
        label: 'Lives alone',
        fieldType: 'YES_NO',
        required: false,
      },
    ];

    const result = composeHomeSupportPlanHybrid(buildContext(), fields, 'su-1');
    expect(result.values['runtime:abc']).toBe(true);
    expect(result.provenance?.['runtime:abc']?.autoPrefilled).toBe(true);
  });
});

describe('runCarePlanCompose — Home Support Plan registration', () => {
  it('dispatches Home Support Plan to hybrid mapper', () => {
    const result = runCarePlanCompose(HOME_SUPPORT_PLAN_FORM_NAME, buildContext(), HSP_PILOT_FIELDS);
    expect(result.suggestionMode).toBe('hybrid');
    expect(result.composedFrom.formName).toBe(HOME_SUPPORT_PLAN_FORM_NAME);
  });
});
