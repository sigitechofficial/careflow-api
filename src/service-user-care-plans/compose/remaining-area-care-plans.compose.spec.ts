import { buildCarePlanPersonalisationContext } from '../../care-plan-text/care-plan-text.util';
import type {
  CarePlanComposeContext,
  CarePlanFormFieldRef,
} from './compose-context.types';
import {
  composeSkinIntegrityCarePlan,
  SKIN_INTEGRITY_CARE_PLAN_FIELD_MAPPINGS,
} from './area-care-plans.compose';
import {
  composeCommunicationCarePlan,
  composeContinenceCarePlan,
  composeEatingDrinkingCarePlan,
  composePersonalSafetyCarePlan,
  CONTINENCE_CARE_PLAN_FIELD_MAPPINGS,
  COMMUNICATION_CARE_PLAN_FIELD_MAPPINGS,
  EATING_DRINKING_CARE_PLAN_FIELD_MAPPINGS,
  PERSONAL_SAFETY_CARE_PLAN_FIELD_MAPPINGS,
  mapDietTypeToCarePlan,
  mapEatingAssistanceToCarePlan,
} from './remaining-area-care-plans.compose';

function field(
  key: string,
  label: string,
  fieldType = 'TEXTAREA',
  required = false,
): CarePlanFormFieldRef {
  return {
    key,
    sectionId: 'sec',
    fieldId: key.split(':')[1] ?? key,
    label,
    fieldType,
    required,
  };
}

function emptyCtx(
  overrides: Partial<CarePlanComposeContext> & {
    ia: NonNullable<CarePlanComposeContext['ia']>;
  },
): CarePlanComposeContext {
  return {
    serviceUserId: 'su-demo',
    serviceUserName: 'Demo User',
    personalisation: buildCarePlanPersonalisationContext({
      firstName: 'Demo',
      lastName: 'User',
    }),
    aboutMe: null,
    emergencyContacts: [],
    allergies: [],
    emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
    pack: null,
    gpPharmacyLine: null,
    ...overrides,
  };
}

describe('mapEatingAssistanceToCarePlan / mapDietTypeToCarePlan', () => {
  it('maps only exact SELECT-equivalent codes and never infers diabetes or prompting', () => {
    expect(mapEatingAssistanceToCarePlan('independent')).toBe('Independent');
    expect(mapEatingAssistanceToCarePlan('full_support')).toBe('Full assistance');
    expect(mapEatingAssistanceToCarePlan('prompting')).toBeNull();
    expect(mapEatingAssistanceToCarePlan('assistance')).toBeNull();
    expect(mapDietTypeToCarePlan('normal')).toBe('Normal');
    expect(mapDietTypeToCarePlan('soft')).toBe('Soft');
    expect(mapDietTypeToCarePlan('diabet')).toBeNull();
    expect(mapDietTypeToCarePlan('Type B')).toBeNull();
    expect(mapDietTypeToCarePlan('abnormal')).toBeNull();
  });
});

describe('demo area Care Plan snapshots', () => {
  // Self-contained area-snapshot fixture (previously borrowed from the removed demo builder).
  // Realistic values matching each area compose engine's snapshot-fallback assertions below.
  const metadata: {
    continence: Record<string, unknown>;
    eatingDrinking: Record<string, unknown>;
    skinIntegrity: Record<string, unknown>;
    personalSafety: Record<string, unknown>;
    communication: Record<string, unknown>;
  } = {
    continence: {
      bladderStatus: 'Continent',
      bowelStatus: 'Continent',
      productsUsed: 'Continence pads and a toilet frame',
      toiletingRoutine: 'Prompted toileting every 2 hours',
      fluidGuidance: 'Encourage 1500ml of fluids per day',
      skinCareAfterEpisodes: 'Apply barrier cream and check skin after episodes',
    },
    eatingDrinking: {
      dietType: 'Normal',
      fluidTargetMl: '1500',
      foodAllergiesIntolerances: 'No known allergies',
      mealAssistanceLevel: 'Setup only',
      chokingSaltGuidance: 'Low choking risk; SALT reviewed, no thickener required',
      preferredFoodsDislikes: 'Likes porridge and soup. Dislikes spicy food',
    },
    skinIntegrity: {
      skinTypeIssues: 'Skin intact but slightly dry',
      emollientsCreams: 'Emollient cream applied twice daily',
      previousPressureDamage: false,
      creamApplication: 'Pressure cushion in chair; cream to heels morning and night',
      signsToReport: 'Report redness, broken skin or any new wound immediately',
    },
    personalSafety: {
      homeHazards: 'Clear pathways; good lighting; no loose rugs',
      fireSafety: 'Smoke alarm fitted and tested monthly',
      loneWorkerRisk: 'Low',
      safeguardingOnFile: false,
      actionsInPlace: 'No safeguarding concerns; no-response procedure agreed',
      emergencyContacts: 'Emergency contact: Sarah Smith (Daughter) - 07700 900123',
    },
    communication: {
      preferredLanguage: 'English',
      hearingImpairment: true,
      visionImpairment: false,
      communicationMethod: 'Verbal',
      staffGuidance: 'Speak clearly and face the person; allow extra time',
      aids: 'Hearing aid (left ear); wears glasses for reading',
      consentSharing: true,
    },
  };

  it('stores Continence / Eating / Skin / Safety / Communication metadata snapshots', () => {
    expect(metadata.continence?.bladderStatus).toBe('Continent');
    expect(metadata.continence?.toiletingRoutine).toMatch(/toileting/i);
    expect(metadata.eatingDrinking?.dietType).toBe('Normal');
    expect(metadata.eatingDrinking?.fluidTargetMl).toBe('1500');
    expect(metadata.skinIntegrity?.emollientsCreams).toMatch(/Emollient/i);
    expect(metadata.skinIntegrity?.signsToReport).toMatch(/Report redness/i);
    expect(metadata.personalSafety?.loneWorkerRisk).toBe('Low');
    expect(metadata.personalSafety?.safeguardingOnFile).toBe(false);
    expect(metadata.communication?.preferredLanguage).toBe('English');
    expect(metadata.communication?.hearingImpairment).toBe(true);
    expect(metadata.communication?.visionImpairment).toBe(false);
  });

  it('populates Continence Care Plan from snapshot when answer rows are absent', () => {
    const fields = [
      field('sec:bladder', 'Bladder continence', 'SELECT'),
      field('sec:bowel', 'Bowel continence', 'SELECT'),
      field('sec:products', 'Products used (pads, commode, etc.)'),
      field('sec:toileting', 'Toileting/prompting routine', 'TEXTAREA', true),
      field('sec:fluid', 'Fluid intake guidance', 'TEXT'),
      field('sec:skin', 'Skin care after episodes'),
    ];

    const result = composeContinenceCarePlan(
      emptyCtx({
        ia: {
          submissionId: 'demo-ia',
          submittedAt: '2026-08-19T07:36:44.000Z',
          status: 'SUBMITTED',
          answers: [],
          continenceSnapshot: {
            bladderStatus: String(metadata.continence?.bladderStatus ?? ''),
            bowelStatus: String(metadata.continence?.bowelStatus ?? ''),
            productsUsed: String(metadata.continence?.productsUsed ?? ''),
            toiletingRoutine: String(metadata.continence?.toiletingRoutine ?? ''),
            fluidGuidance: String(metadata.continence?.fluidGuidance ?? ''),
            skinCareAfterEpisodes: String(metadata.continence?.skinCareAfterEpisodes ?? ''),
          },
        },
      }),
      fields,
      'su-demo',
    );

    expect(result.values['sec:bladder']).toBeUndefined();
    expect(result.values['sec:bowel']).toBeUndefined();
    expect(result.values['sec:products']).toBeUndefined();
    expect(result.values['sec:toileting']).toBeUndefined();
    expect(result.values['sec:fluid']).toBeUndefined();
    expect(result.values['sec:skin']).toBeUndefined();
    expect(result.gaps.some((g) => g.fieldKey === 'sec:toileting')).toBe(true);
    expect(CONTINENCE_CARE_PLAN_FIELD_MAPPINGS.length).toBe(6);
  });

  it('populates Eating and Drinking Care Plan from snapshot when answer rows are absent', () => {
    const fields = [
      field('sec:diet', 'Diet type', 'SELECT'),
      field('sec:fluid', 'Fluid target per day (ml)', 'NUMBER'),
      field('sec:allergy', 'Food allergies or intolerances'),
      field('sec:assist', 'Level of assistance', 'SELECT'),
      field('sec:choke', 'Choking risk / SALT recommendations'),
      field('sec:pref', 'Preferred foods and dislikes', 'TEXTAREA', true),
    ];

    const result = composeEatingDrinkingCarePlan(
      emptyCtx({
        ia: {
          submissionId: 'demo-ia',
          submittedAt: '2026-08-19T07:36:44.000Z',
          status: 'SUBMITTED',
          answers: [],
          eatingDrinkingSnapshot: {
            dietType: String(metadata.eatingDrinking?.dietType ?? ''),
            fluidTargetMl: String(metadata.eatingDrinking?.fluidTargetMl ?? ''),
            foodAllergiesIntolerances: String(
              metadata.eatingDrinking?.foodAllergiesIntolerances ?? '',
            ),
            mealAssistanceLevel: String(metadata.eatingDrinking?.mealAssistanceLevel ?? ''),
            chokingSaltGuidance: String(metadata.eatingDrinking?.chokingSaltGuidance ?? ''),
            preferredFoodsDislikes: String(metadata.eatingDrinking?.preferredFoodsDislikes ?? ''),
          },
        },
      }),
      fields,
      'su-demo',
    );

    expect(result.values['sec:diet']).toBeUndefined();
    expect(result.values['sec:fluid']).toBe('1500');
    expect(String(result.values['sec:allergy'])).toMatch(/No known allergies/i);
    expect(result.values['sec:assist']).toBeUndefined();
    expect(result.values['sec:choke']).toBeUndefined();
    expect(String(result.values['sec:pref'])).toMatch(/porridge|Dislikes/i);
    expect(result.gaps).toHaveLength(0);
    expect(EATING_DRINKING_CARE_PLAN_FIELD_MAPPINGS.length).toBe(6);
  });

  it('populates Skin Integrity from snapshot and strips raw HTML placeholders', () => {
    const fields = [
      field('sec:type', 'Skin type / common issues'),
      field('sec:emollient', 'Emollients or creams prescribed'),
      field('sec:pressure', 'Previous pressure damage', 'YES_NO'),
      field('sec:apply', 'Application of creams – when and where', 'TEXTAREA', true),
      field('sec:report', 'Signs to report immediately', 'TEXTAREA', true),
    ];

    const result = composeSkinIntegrityCarePlan(
      emptyCtx({
        ia: {
          submissionId: 'demo-ia',
          submittedAt: '2026-08-19T07:36:44.000Z',
          status: 'SUBMITTED',
          answers: [
            {
              questionId: 'q-html',
              questionText: 'Emollient details',
              checked: null,
              booleanValue: null,
              textValue: '<p><br></p>',
              selectedOptions: null,
              sectionNumber: 11,
              sectionTitle: 'Skin',
              carePlanArea: null,
            },
          ],
          skinIntegritySnapshot: {
            skinTypeIssues: String(metadata.skinIntegrity?.skinTypeIssues ?? ''),
            emollientsCreams: String(metadata.skinIntegrity?.emollientsCreams ?? ''),
            previousPressureDamage: Boolean(metadata.skinIntegrity?.previousPressureDamage),
            creamApplication: String(metadata.skinIntegrity?.creamApplication ?? ''),
            signsToReport: String(metadata.skinIntegrity?.signsToReport ?? ''),
          },
        },
      }),
      fields,
      'su-demo',
    );

    expect(result.values['sec:type']).toBeUndefined();
    expect(result.values['sec:emollient']).toBeUndefined();
    expect(result.values['sec:pressure']).toBeUndefined();
    expect(result.values['sec:apply']).toBeUndefined();
    expect(result.values['sec:report']).toBeUndefined();
    expect(result.gaps.some((g) => g.fieldKey === 'sec:apply')).toBe(true);
    expect(result.gaps.some((g) => g.fieldKey === 'sec:report')).toBe(true);
    expect(SKIN_INTEGRITY_CARE_PLAN_FIELD_MAPPINGS.length).toBe(5);
  });

  it('populates Personal Safety Care Plan from snapshot when answer rows are absent', () => {
    const fields = [
      field('sec:hazards', 'Home hazards identified'),
      field('sec:fire', 'Smoking / fire safety', 'TEXT'),
      field('sec:lone', 'Lone worker risk level', 'SELECT'),
      field('sec:sg', 'Safeguarding concern on file', 'YES_NO'),
      field('sec:actions', 'Actions in place'),
      field('sec:ec', 'Emergency contacts', 'TEXTAREA', true),
    ];

    const result = composePersonalSafetyCarePlan(
      emptyCtx({
        ia: {
          submissionId: 'demo-ia',
          submittedAt: '2026-08-19T07:36:44.000Z',
          status: 'SUBMITTED',
          answers: [],
          personalSafetySnapshot: {
            homeHazards: String(metadata.personalSafety?.homeHazards ?? ''),
            fireSafety: String(metadata.personalSafety?.fireSafety ?? ''),
            loneWorkerRisk: String(metadata.personalSafety?.loneWorkerRisk ?? ''),
            safeguardingOnFile: Boolean(metadata.personalSafety?.safeguardingOnFile),
            actionsInPlace: String(metadata.personalSafety?.actionsInPlace ?? ''),
            emergencyContacts: String(metadata.personalSafety?.emergencyContacts ?? ''),
          },
        },
      }),
      fields,
      'su-demo',
    );

    expect(String(result.values['sec:hazards'])).toMatch(/pathways|lighting|rugs/i);
    expect(String(result.values['sec:fire'])).toMatch(/smoke alarm/i);
    expect(result.values['sec:lone']).toBe('Low');
    expect(result.values['sec:sg']).toBe(false);
    expect(String(result.values['sec:actions'])).toMatch(/safeguarding|no-response/i);
    expect(String(result.values['sec:ec'])).toBe(
      'Emergency contact: Sarah Smith (Daughter) - 07700 900123',
    );
    expect(result.gaps).toHaveLength(0);
    expect(PERSONAL_SAFETY_CARE_PLAN_FIELD_MAPPINGS.length).toBe(6);
  });

  it('uses personalSafety.emergencyContacts snapshot when IA YES_NO answer would resolve to Yes', () => {
    const expected =
      'Emergency contact: Sarah Smith (Daughter) - 07700 900123';

    const result = composePersonalSafetyCarePlan(
      emptyCtx({
        ia: {
          submissionId: 'demo-ia',
          submittedAt: '2026-08-19T07:36:44.000Z',
          status: 'SUBMITTED',
          answers: [
            {
              questionId: 'q-ec-yesno',
              questionText: 'Emergency contact details known?',
              checked: true,
              booleanValue: true,
              textValue: null,
              selectedOptions: null,
              sectionNumber: 13,
              sectionTitle: 'Safety',
              carePlanArea: null,
            },
          ],
          personalSafetySnapshot: {
            homeHazards: null,
            fireSafety: null,
            loneWorkerRisk: null,
            safeguardingOnFile: null,
            actionsInPlace: null,
            emergencyContacts: expected,
          },
        },
      }),
      [field('sec:ec', 'Emergency contacts', 'TEXTAREA', true)],
      'su-demo',
    );

    expect(result.values['sec:ec']).toBe(expected);
    expect(result.values['sec:ec']).not.toBe('Yes');
  });

  it('populates Communication Care Plan from snapshot when answer rows are absent', () => {
    const fields = [
      field('sec:lang', 'Preferred language', 'TEXT'),
      field('sec:hear', 'Hearing impairment', 'YES_NO'),
      field('sec:vision', 'Vision impairment', 'YES_NO'),
      field('sec:method', 'Primary communication method', 'SELECT'),
      field('sec:approach', 'How to approach conversations', 'TEXTAREA', true),
      field('sec:aids', 'Uses glasses/hearing aids', 'TEXT'),
      field('sec:consent', 'Consent to share information with family', 'YES_NO'),
    ];

    const result = composeCommunicationCarePlan(
      emptyCtx({
        ia: {
          submissionId: 'demo-ia',
          submittedAt: '2026-08-19T07:36:44.000Z',
          status: 'SUBMITTED',
          answers: [],
          communicationSnapshot: {
            preferredLanguage: String(metadata.communication?.preferredLanguage ?? ''),
            hearingImpairment: Boolean(metadata.communication?.hearingImpairment),
            visionImpairment: Boolean(metadata.communication?.visionImpairment),
            communicationMethod: String(metadata.communication?.communicationMethod ?? ''),
            staffGuidance: String(metadata.communication?.staffGuidance ?? ''),
            aids: String(metadata.communication?.aids ?? ''),
            consentSharing: Boolean(metadata.communication?.consentSharing),
          },
        },
      }),
      fields,
      'su-demo',
    );

    expect(result.values['sec:lang']).toBe('English');
    expect(result.values['sec:hear']).toBeUndefined();
    expect(result.values['sec:vision']).toBeUndefined();
    expect(result.values['sec:method']).toBe('Verbal');
    expect(String(result.values['sec:approach'])).toMatch(/Speak clearly/i);
    expect(result.values['sec:aids']).toBeUndefined();
    expect(result.values['sec:consent']).toBeUndefined();
    expect(result.gaps).toHaveLength(0);
    expect(COMMUNICATION_CARE_PLAN_FIELD_MAPPINGS.length).toBe(7);
  });
});
