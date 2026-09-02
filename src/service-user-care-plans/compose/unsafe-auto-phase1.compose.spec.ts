import { runCarePlanCompose } from './compose-context.loader';
import { EATING_AND_DRINKING_CARE_PLAN_SEED } from '../../../prisma/seeds/eating-and-drinking-care-plan.seed-data';
import { CONTINENCE_CARE_PLAN_SEED } from '../../../prisma/seeds/continence-care-plan.seed-data';
import { COMMUNICATION_CARE_PLAN_SEED } from '../../../prisma/seeds/communication-care-plan.seed-data';
import { SKIN_INTEGRITY_CARE_PLAN_SEED } from '../../../prisma/seeds/skin-integrity-care-plan.seed-data';
import { DEMENTIA_CARE_PLAN_SEED } from '../../../prisma/seeds/dementia-care-plan.seed-data';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';

function fieldRefsFromSeed(seed: {
  sections: Array<{
    title: string;
    fields: Array<{ fieldKey?: string; label: string; fieldType: string; required?: boolean }>;
  }>;
}): CarePlanFormFieldRef[] {
  const refs: CarePlanFormFieldRef[] = [];
  seed.sections.forEach((section, si) => {
    section.fields.forEach((field, fi) => {
      refs.push({
        key: `sec-${si}:f-${si}-${fi}`,
        sectionId: `sec-${si}`,
        fieldId: `f-${si}-${fi}`,
        fieldKey: field.fieldKey,
        label: field.label,
        fieldType: field.fieldType,
        required: field.required ?? false,
        sectionTitle: section.title,
      } as CarePlanFormFieldRef);
    });
  });
  return refs;
}

function keyOf(
  seed: Parameters<typeof fieldRefsFromSeed>[0],
  fieldKey: string,
): string {
  return fieldRefsFromSeed(seed).find((f) => f.fieldKey === fieldKey)!.key;
}

function iaAnswer(
  partial: Partial<SubmissionAnswerForRules> & { questionText: string },
): SubmissionAnswerForRules {
  return {
    questionId: partial.questionId ?? `q-${partial.questionText}`,
    questionText: partial.questionText,
    checked: partial.checked ?? null,
    booleanValue: partial.booleanValue ?? null,
    textValue: partial.textValue ?? null,
    selectedOptions: partial.selectedOptions ?? null,
    numberValue: partial.numberValue ?? null,
    specRef: partial.specRef,
    fieldKey: partial.fieldKey,
    sectionNumber: partial.sectionNumber ?? 1,
    sectionTitle: partial.sectionTitle ?? 'Section',
    carePlanArea: partial.carePlanArea ?? null,
  };
}

function ctx(answers: SubmissionAnswerForRules[]): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    serviceUserName: 'Test User',
    personalisation: {},
    aboutMe: null,
    emergencyContacts: [],
    allergies: [],
    ia: {
      submissionId: 'sub-1',
      status: 'REVIEWED',
      submittedAt: '2026-08-01T00:00:00.000Z',
      answers,
    },
    previousAssessments: [],
    emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
    pack: null,
    gpPharmacyLine: null,
  } as unknown as CarePlanComposeContext;
}

describe('Phase 1 unsafe AUTO corrections', () => {
  it('does not fill Eating SALT from the word salt in dietary text', () => {
    const result = runCarePlanCompose(
      'Eating and Drinking',
      ctx([
        iaAnswer({
          questionText: 'Religious or cultural dietary requirements',
          textValue: 'Low salt diet. I do not eat shellfish.',
        }),
        iaAnswer({
          questionText: 'Swallowing or choking concerns?',
          booleanValue: false,
        }),
      ]),
      fieldRefsFromSeed(EATING_AND_DRINKING_CARE_PLAN_SEED),
    );
    expect(
      result.values[keyOf(EATING_AND_DRINKING_CARE_PLAN_SEED, 'eating_and_drinking_choking_salt')],
    ).toBeUndefined();
  });

  it('does not map T2DM / diabetic onto Diabetic diet', () => {
    const result = runCarePlanCompose(
      'Eating and Drinking',
      ctx([
        iaAnswer({
          fieldKey: 'foodTexture',
          questionText: 'Food texture requirement',
          selectedOptions: ['normal'],
        }),
        iaAnswer({
          fieldKey: 'serviceUserIsDiabetic',
          questionText: 'Service User is diabetic?',
          booleanValue: true,
        }),
      ]),
      fieldRefsFromSeed(EATING_AND_DRINKING_CARE_PLAN_SEED),
    );
    expect(
      result.values[keyOf(EATING_AND_DRINKING_CARE_PLAN_SEED, 'eating_and_drinking_diet_type')],
    ).toBeUndefined();
  });

  it('does not fill Continence products from an unrelated pads mention', () => {
    const result = runCarePlanCompose(
      'Continence',
      ctx([
        iaAnswer({
          questionText: 'Oral health notes',
          textValue: 'Needs help with dentures each morning; pads overnight',
        }),
      ]),
      fieldRefsFromSeed(CONTINENCE_CARE_PLAN_SEED),
    );
    expect(
      result.values[keyOf(CONTINENCE_CARE_PLAN_SEED, 'continence_products_used')],
    ).toBeUndefined();
  });

  it('does not map mild hearing onto Hearing impairment Yes', () => {
    const result = runCarePlanCompose(
      'Communication',
      ctx([
        iaAnswer({
          fieldKey: 'hearingLevel',
          questionText: 'Hearing impairment level',
          selectedOptions: ['mild'],
        }),
      ]),
      fieldRefsFromSeed(COMMUNICATION_CARE_PLAN_SEED),
    );
    expect(
      result.values[keyOf(COMMUNICATION_CARE_PLAN_SEED, 'communication_hearing_impairment')],
    ).toBeUndefined();
  });

  it('does not map consent to share with GP onto family consent-share', () => {
    const result = runCarePlanCompose(
      'Communication',
      ctx([
        iaAnswer({
          questionText: 'Consent to share information with GP?',
          booleanValue: true,
        }),
      ]),
      fieldRefsFromSeed(COMMUNICATION_CARE_PLAN_SEED),
    );
    expect(
      result.values[keyOf(COMMUNICATION_CARE_PLAN_SEED, 'communication_consent_share')],
    ).toBeUndefined();
  });

  it('does not map current wounds onto previous pressure damage', () => {
    const result = runCarePlanCompose(
      'Skin Integrity',
      ctx([
        iaAnswer({
          fieldKey: 'hasWounds',
          specRef: '11.1',
          questionText: 'Currently has ulcers or wounds?',
          booleanValue: true,
        }),
        iaAnswer({
          specRef: '11.1',
          questionText: 'Pressure equipment details',
          textValue: 'High-spec foam mattress',
        }),
      ]),
      fieldRefsFromSeed(SKIN_INTEGRITY_CARE_PLAN_SEED),
    );
    expect(
      result.values[keyOf(SKIN_INTEGRITY_CARE_PLAN_SEED, 'skin_integrity_previous_pressure_damage')],
    ).toBeUndefined();
    expect(
      result.values[keyOf(SKIN_INTEGRITY_CARE_PLAN_SEED, 'skin_integrity_cream_application')],
    ).toBeUndefined();
  });

  it('does not infer wandering from de-orientated + falls', () => {
    const result = runCarePlanCompose(
      'Dementia Care plan',
      ctx([
        iaAnswer({
          specRef: '10.6a',
          questionText: 'De-orientated?',
          booleanValue: true,
        }),
        iaAnswer({
          specRef: '12.1',
          fieldKey: 'fallsLast12Months',
          questionText: 'Falls in last 12 months?',
          booleanValue: true,
        }),
      ]),
      fieldRefsFromSeed(DEMENTIA_CARE_PLAN_SEED),
    );
    expect(
      result.values[keyOf(DEMENTIA_CARE_PLAN_SEED, 'dementia_wandering_risk')],
    ).toBeUndefined();
  });
});
