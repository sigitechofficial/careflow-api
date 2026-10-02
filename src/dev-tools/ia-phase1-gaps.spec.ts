import { ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS } from '../../prisma/seeds/initial-assessment-enterprise.seed';
import { DIABETES_TYPE_OPTIONS } from '../../prisma/seeds/initial-assessment-enterprise-options';
import { remapDiabetesSelectedOptions } from '../../prisma/seeds/initial-assessment-enterprise-section-4.seed';
import { SECTION_9_QUESTIONS } from '../../prisma/seeds/initial-assessment-enterprise-sections-5-10.seed';
import { IA_REGISTERED_HOLISTIC_TAB_IDS } from './dto/generate-ia-section.dto';
import {
  buildAutofillAnswers,
  collectWritableDemoQuestionIds,
  extraQuestionsForHolisticTab,
  type AnswerInput,
  type IaAutofillLevel,
  type TemplateQuestion,
} from './ia-autofill-build.util';

function flattenCatalog(): TemplateQuestion[] {
  const out: TemplateQuestion[] = [];
  for (const section of ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS) {
    for (const [i, q] of section.questions.entries()) {
      out.push({
        id: `s${section.sectionNumber}-q${i}`,
        questionText: q.questionText,
        questionType: String(q.questionType ?? 'YES_NO'),
        isRequired: q.isRequired ?? false,
        sortOrder: q.sortOrder,
        metadata: (q.metadata as Record<string, unknown> | null) ?? null,
        options: q.options,
        sectionNumber: section.sectionNumber,
      });
    }
  }
  return out;
}

function fieldKeyOf(q: TemplateQuestion): string | undefined {
  const key = q.metadata?.fieldKey;
  return typeof key === 'string' ? key : undefined;
}

function byKey(catalog: TemplateQuestion[], key: string): TemplateQuestion {
  const found = catalog.find((q) => fieldKeyOf(q) === key);
  if (!found) throw new Error(`Missing fieldKey ${key}`);
  return found;
}

function fillAllTabs(questions: TemplateQuestion[], level: IaAutofillLevel): Map<string, AnswerInput> {
  const requested = questions.map((q) => q.id);
  const merged = new Map<string, AnswerInput>();
  for (const tabId of IA_REGISTERED_HOLISTIC_TAB_IDS) {
    const writable = collectWritableDemoQuestionIds(tabId, questions, requested, level);
    for (const a of buildAutofillAnswers(questions, level, writable)) {
      merged.set(a.questionId, a);
    }
  }
  return merged;
}

function writableIds(questions: TemplateQuestion[], level: IaAutofillLevel): Set<string> {
  const requested = questions.map((q) => q.id);
  const writable = new Set<string>();
  for (const tabId of IA_REGISTERED_HOLISTIC_TAB_IDS) {
    for (const id of collectWritableDemoQuestionIds(tabId, questions, requested, level)) {
      writable.add(id);
    }
  }
  return writable;
}

function selectedCode(answer: AnswerInput | undefined): string | undefined {
  const raw = answer?.selectedOptions;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return undefined;
}

const FIRE_SAFETY_REHOME_FIELD_KEYS = [
  'fireSafetyRisksIdentified',
  'fireSafetyRisksDetails',
  'londonFireBrigadeInformed',
  'londonFireBrigadeDetails',
  'smokeAlarmFittedWorking',
  'smokeCoFireAlarmReferral',
  'smokingInProperty',
] as const;

const PHASE1_MEDICATION_KEYS = [
  'takingPrescribedMedication',
  'medicationSupportLevel',
  'medicationAdministeredBy',
  'insulinAdministrationRequired',
  'insulinPromptingRequired',
  'insulinSupervisionRequired',
  'covertMedicationRequired',
  'covertMedicationLegalBasis',
  'controlledDrugsInUse',
  'medicationListAvailable',
  'medicationListVerified',
  'medicationListVerifiedDate',
  'medicationDispensingMethod',
  'emarRequired',
  'medicationSafetyNotes',
] as const;

describe('Phase 1 IA gaps — catalogue, QA and conditionals', () => {
  const catalog = flattenCatalog();

  it('restores medication support questions under existing §9 with approved support levels', () => {
    const section9 = catalog.filter((q) => q.sectionNumber === 9);
    for (const key of PHASE1_MEDICATION_KEYS) {
      expect(section9.some((q) => fieldKeyOf(q) === key)).toBe(true);
    }
    const support = SECTION_9_QUESTIONS.find((q) => (q.metadata as { fieldKey?: string })?.fieldKey === 'medicationSupportLevel');
    const codes = (support?.options as { options: Array<{ value: string }> } | undefined)?.options.map((o) => o.value);
    expect(codes).toEqual(['level_0', 'level_1a', 'level_1b', 'level_2a', 'level_2b', 'provided_by_others']);
    expect(section9.every((q) => !String(q.questionText).toLowerCase().includes('care pathway'))).toBe(true);
  });

  it('extends choking, DoLS, oral health and wandering without cloning assessments', () => {
    expect(byKey(catalog, 'chokingOccursWith').sectionNumber).toBe(5);
    expect(byKey(catalog, 'chokingFrequency').sectionNumber).toBe(5);
    expect(byKey(catalog, 'chokingPositioningSupervision').sectionNumber).toBe(5);
    expect(byKey(catalog, 'chokingRescuePlanKnownToStaff').sectionNumber).toBe(5);
    expect(catalog.some((q) => q.questionText === 'Swallowing or choking concerns?')).toBe(true);

    expect(byKey(catalog, 'dolRestrictions').sectionNumber).toBe(2);
    expect(byKey(catalog, 'dolConcern').sectionNumber).toBe(2);
    expect(byKey(catalog, 'dolAuthorisationStatus').sectionNumber).toBe(2);
    expect(byKey(catalog, 'dolsAuthorisingBody').sectionNumber).toBe(2);
    expect(byKey(catalog, 'dolsReference').sectionNumber).toBe(2);
    expect(byKey(catalog, 'dolsExpiryDate').sectionNumber).toBe(2);
    expect(byKey(catalog, 'dolsDetails').sectionNumber).toBe(2);

    expect(byKey(catalog, 'oralHealthConcern').sectionNumber).toBe(7);
    expect(byKey(catalog, 'mouthCareSupportRoutine').sectionNumber).toBe(7);
    expect(byKey(catalog, 'lastDentalContactKnown').sectionNumber).toBe(7);
    expect(byKey(catalog, 'lastDentalContactDate').sectionNumber).toBe(7);

    expect(byKey(catalog, 'wanderingOrExitSeeking').sectionNumber).toBe(10);
    expect(byKey(catalog, 'wanderingSupportNotes').sectionNumber).toBe(10);
    expect((byKey(catalog, 'wanderingOrExitSeeking').metadata as { specRef?: string }).specRef).toBe('10.6a');
  });

  it('standardises diabetes options and remaps Type A/B without deleting answers', () => {
    const diabetes = catalog.find((q) => fieldKeyOf(q) === 'diabetesType');
    expect(diabetes).toBeDefined();
    const codes = DIABETES_TYPE_OPTIONS.options.map((o) => o.value);
    expect(codes).toEqual(['type_1', 'type_2', 'other', 'unknown']);
    expect(remapDiabetesSelectedOptions('Type A')).toEqual({ next: 'type_1', changed: true });
    expect(remapDiabetesSelectedOptions('Type B')).toEqual({ next: 'type_2', changed: true });
    expect(remapDiabetesSelectedOptions('type_1')).toEqual({ next: 'type_1', changed: false });
    expect(remapDiabetesSelectedOptions(['Type A', 'unknown'])).toEqual({
      next: ['type_1', 'unknown'],
      changed: true,
    });
  });

  it('creates infection §15 and fire §18; fire fieldKeys leave Environment', () => {
    expect(catalog.some((q) => q.sectionNumber === 15 && fieldKeyOf(q) === 'infectionPrecautionsRequired')).toBe(true);
    expect(catalog.some((q) => q.sectionNumber === 15 && fieldKeyOf(q) === 'ppeRequired')).toBe(true);
    for (const key of FIRE_SAFETY_REHOME_FIELD_KEYS) {
      const q = byKey(catalog, key);
      expect(q.sectionNumber).toBe(18);
    }
    expect(
      catalog.filter((q) => q.sectionNumber === 3 && FIRE_SAFETY_REHOME_FIELD_KEYS.includes(fieldKeyOf(q) as (typeof FIRE_SAFETY_REHOME_FIELD_KEYS)[number])),
    ).toHaveLength(0);
    expect(byKey(catalog, 'manageHomeEnvironmentSafely').sectionNumber).toBe(3);
    expect(byKey(catalog, 'cookingLeftUnattendedRisk').sectionNumber).toBe(18);
    expect(byKey(catalog, 'primaryEscapeRoute').sectionNumber).toBe(18);
    expect(byKey(catalog, 'fireEmergencyArrangements').sectionNumber).toBe(18);
  });

  it('registers holistic tabs 19, 20, 21 and 22', () => {
    expect([...IA_REGISTERED_HOLISTIC_TAB_IDS]).toEqual(
      expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]),
    );
    const peepExtras = extraQuestionsForHolisticTab(19, catalog);
    const bedRailsExtras = extraQuestionsForHolisticTab(20, catalog);
    const infectionExtras = extraQuestionsForHolisticTab(21, catalog);
    const fireExtras = extraQuestionsForHolisticTab(22, catalog);
    expect(peepExtras.every((q) => q.sectionNumber === 16)).toBe(true);
    expect(bedRailsExtras.every((q) => q.sectionNumber === 17)).toBe(true);
    expect(infectionExtras.length).toBeGreaterThan(0);
    expect(infectionExtras.every((q) => q.sectionNumber === 15)).toBe(true);
    expect(fireExtras.some((q) => q.sectionNumber === 18)).toBe(true);
    expect(extraQuestionsForHolisticTab(1, catalog).some((q) => fieldKeyOf(q) === 'fireSafetyRisksIdentified')).toBe(
      false,
    );
  });

  it.each(['critical', 'normal', 'low'] as const)(
    '%s QA fills visible Phase-1 fields and leaves hidden children empty',
    (level) => {
      const answers = fillAllTabs(catalog, level);
      const writable = writableIds(catalog, level);

      const taking = byKey(catalog, 'takingPrescribedMedication');
      expect(answers.get(taking.id)?.booleanValue).toBe(true);
      expect(writable.has(byKey(catalog, 'medicationSupportLevel').id)).toBe(true);
      const support = selectedCode(answers.get(byKey(catalog, 'medicationSupportLevel').id));
      expect(support).toBe(level === 'critical' ? 'level_2a' : level === 'normal' ? 'level_1a' : 'level_0');

      if (level === 'low') {
        expect(support).toBe('level_0');
        expect(selectedCode(answers.get(byKey(catalog, 'medicationAdministeredBy').id))).toBe('self');
      }

      const covert = byKey(catalog, 'covertMedicationRequired');
      expect(answers.get(covert.id)?.booleanValue).toBe(false);
      expect(writable.has(byKey(catalog, 'covertMedicationLegalBasis').id)).toBe(false);
      expect(answers.has(byKey(catalog, 'covertMedicationLegalBasis').id)).toBe(false);

      const insulin = byKey(catalog, 'insulinAdministrationRequired');
      const insulinYes = level === 'critical';
      expect(answers.get(insulin.id)?.booleanValue).toBe(insulinYes);
      expect(writable.has(byKey(catalog, 'insulinPromptingRequired').id)).toBe(insulinYes);

      const chokingParent = catalog.find((q) => q.questionText === 'Swallowing or choking concerns?')!;
      const chokingYes = level === 'critical';
      expect(answers.get(chokingParent.id)?.booleanValue).toBe(chokingYes);
      expect(writable.has(byKey(catalog, 'chokingOccursWith').id)).toBe(chokingYes);
      expect(answers.has(byKey(catalog, 'chokingOccursWith').id)).toBe(chokingYes);

      // DoL is screening-first: restrictions → concern → review / status; details only once authorised.
      const restrictions = byKey(catalog, 'dolRestrictions');
      const restricted = level === 'critical';
      expect(answers.get(restrictions.id)?.selectedOptions).toEqual(
        restricted ? ['not_allowed_out_alone', 'continuous_supervision'] : ['none'],
      );
      expect(writable.has(byKey(catalog, 'dolConcern').id)).toBe(restricted);
      if (restricted) expect(selectedCode(answers.get(byKey(catalog, 'dolConcern').id))).toBe('unsure');
      expect(writable.has(byKey(catalog, 'dolsAuthorisingBody').id)).toBe(false);

      const oral = byKey(catalog, 'oralHealthConcern');
      const oralYes = level === 'critical';
      expect(answers.get(oral.id)?.booleanValue).toBe(oralYes);
      expect(writable.has(byKey(catalog, 'mouthCareSupportRoutine').id)).toBe(oralYes);

      const infection = byKey(catalog, 'infectionPrecautionsRequired');
      const infectionYes = level === 'critical';
      expect(answers.get(infection.id)?.booleanValue).toBe(infectionYes);
      expect(writable.has(byKey(catalog, 'ppeRequired').id)).toBe(infectionYes);
      expect(answers.has(byKey(catalog, 'ppeRequired').id)).toBe(infectionYes);

      const fireRisk = byKey(catalog, 'fireSafetyRisksIdentified');
      expect(answers.get(fireRisk.id)?.booleanValue).toBe(level === 'critical');
      expect(writable.has(byKey(catalog, 'fireSafetyRisksDetails').id)).toBe(level === 'critical');

      const dementia = byKey(catalog, 'diagnosedDementia');
      expect(answers.get(dementia.id)?.booleanValue).toBe(false);
      expect(writable.has(byKey(catalog, 'wanderingOrExitSeeking').id)).toBe(false);
      expect(answers.has(byKey(catalog, 'wanderingOrExitSeeking').id)).toBe(false);

      const diabetes = byKey(catalog, 'diabetesType');
      if (writable.has(diabetes.id)) {
        expect(selectedCode(answers.get(diabetes.id))).toBe('type_2');
      }

      for (const a of answers.values()) {
        const text = a.textValue ?? '';
        expect(text).not.toMatch(/\bN\/A\b|\bDemo\b|\bTest\b|Not applicable/i);
      }
    },
  );

  it('does not infer wandering from falls, confusion or a dementia diagnosis code', () => {
    const wandering = byKey(catalog, 'wanderingOrExitSeeking');
    const showWhen = wandering.metadata?.showWhen as { gateTextIncludes?: string; gateFieldKey?: string } | undefined;
    expect(JSON.stringify(showWhen)).toMatch(/diagnosed dementia|diagnosedDementia/);
    expect(JSON.stringify(showWhen ?? {})).not.toMatch(/falls|confusion|disorientation/i);
  });
});
