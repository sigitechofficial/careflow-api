import { ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS } from '../../prisma/seeds/initial-assessment-enterprise.seed';
import { BED_RAILS_REQUIRED_IN_PLACE_OPTIONS } from '../../prisma/seeds/initial-assessment-enterprise-options';
import { SECTION_16_QUESTIONS, SECTION_17_QUESTIONS } from '../../prisma/seeds/initial-assessment-enterprise-sections-15-18.seed';
import { shouldShowQuestionForValidation } from '../initial-assessments/initial-assessment-conditional-visibility.util';
import {
  extractTherapyAideMemoire,
  isTherapyAideMemoireComplete,
} from '../service-user-assessments/assessment-promotion-p3.util';
import {
  buildIaAssessmentCompletions,
  IA_ASSESSMENT_TOOL_CATALOGUE,
} from '../service-user-assessments/assessment-tool-registry';
import { CARE_PATHWAY_ASSESSMENT_CATALOG } from '../service-user-assessments/care-pathway-assessment-registry';
import { IA_REGISTERED_HOLISTIC_TAB_IDS } from './dto/generate-ia-section.dto';
import {
  buildAutofillAnswers,
  buildHolisticWorksheetMetadata,
  collectWritableDemoQuestionIds,
  extraQuestionsForHolisticTab,
  isInventedClinicalMeasurement,
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

function selectedCode(answer: AnswerInput | undefined): string | undefined {
  const raw = answer?.selectedOptions;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return undefined;
}

function showWhenOf(q: { metadata?: Record<string, unknown> | null }) {
  const raw = q.metadata?.showWhen;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return raw as { gateFieldKey?: string; yes?: boolean; no?: boolean };
}

function visibilityQuestion(q: TemplateQuestion) {
  return {
    id: q.id,
    questionText: q.questionText,
    metadata: q.metadata,
    section: { sectionNumber: q.sectionNumber },
  };
}

function emptyAnswer() {
  return {
    checked: null as boolean | null,
    booleanValue: null as boolean | null,
    textValue: null as string | null,
    numberValue: null,
    dateValue: null as Date | null,
    timeValue: null as string | null,
    selectedOptions: null,
  };
}

function ynAnswer(questionId: string, value: boolean) {
  return { ...emptyAnswer(), questionId, checked: value, booleanValue: value };
}

function textAnswer(questionId: string, text: string) {
  return { ...emptyAnswer(), questionId, textValue: text };
}

function dateAnswer(questionId: string, iso: string) {
  return { ...emptyAnswer(), questionId, dateValue: new Date(`${iso}T00:00:00.000Z`) };
}

const PEEP_CHILD_KEYS = [
  'peepAssistanceRequired',
  'peepEquipmentRequired',
  'peepEvacuationProcedure',
  'peepAlarmWarningConsiderations',
  'peepRefugeLocation',
  'peepDiscussedWithPerson',
  'peepReviewDate',
] as const;

describe('Phase 2 IA — PEEP, Bed Rails, QA hygiene and tab registry', () => {
  const catalog = flattenCatalog();

  it('seeds §16 PEEP fieldKeys and showWhen (children only when cannot self-evacuate)', () => {
    expect(SECTION_16_QUESTIONS.map((q) => (q.metadata as { fieldKey?: string }).fieldKey)).toEqual([
      'canSelfEvacuate',
      ...PEEP_CHILD_KEYS,
    ]);
    expect(byKey(catalog, 'canSelfEvacuate').sectionNumber).toBe(16);
    expect(showWhenOf(byKey(catalog, 'canSelfEvacuate'))).toBeUndefined();
    for (const key of PEEP_CHILD_KEYS) {
      expect(showWhenOf(byKey(catalog, key))).toEqual({ gateFieldKey: 'canSelfEvacuate', no: true });
    }
    expect(catalog.some((q) => /abbey|vocalisation/i.test(q.questionText))).toBe(false);
  });

  it('seeds §17 Bed Rails fieldKeys; notes are optional; Care Pathway slug stays separate', () => {
    expect(SECTION_17_QUESTIONS.map((q) => (q.metadata as { fieldKey?: string }).fieldKey)).toEqual([
      'bedRailsInUseOrConsidered',
      'bedRailsRequiredInPlace',
      'bedRailsReason',
      'bedRailsAlternativesConsidered',
      'bedRailsEntrapmentRisk',
      'bedRailsEntrapmentDetails',
      'bedRailsConsentCapacityNotes',
      'bedRailsReviewDate',
      'bedRailsNotes',
    ]);
    expect(BED_RAILS_REQUIRED_IN_PLACE_OPTIONS.options.map((o) => o.value)).toEqual([
      'not_required',
      'required_in_place',
      'required_not_yet_in_place',
    ]);
    expect((byKey(catalog, 'bedRailsNotes').metadata as { completenessExempt?: boolean }).completenessExempt).toBe(
      true,
    );
    expect(showWhenOf(byKey(catalog, 'bedRailsEntrapmentDetails'))).toEqual({
      gateFieldKey: 'bedRailsEntrapmentRisk',
      yes: true,
    });
    expect(IA_ASSESSMENT_TOOL_CATALOGUE.some((t) => t.assessmentKey === 'bed-rail-assessment')).toBe(false);
    expect(IA_ASSESSMENT_TOOL_CATALOGUE.some((t) => t.assessmentKey === 'peep' && t.holisticTabId === 19)).toBe(true);
    expect(CARE_PATHWAY_ASSESSMENT_CATALOG.some((t) => t.nameSlug === 'bed-rail-assessment')).toBe(true);
  });

  it('Yes self-evacuate hides PEEP children; No shows them', () => {
    const questions = catalog.filter((q) => q.sectionNumber === 16).map(visibilityQuestion);
    const parent = byKey(catalog, 'canSelfEvacuate');
    const child = byKey(catalog, 'peepAssistanceRequired');
    const yesMap = new Map([[parent.id, ynAnswer(parent.id, true)]]);
    const noMap = new Map([[parent.id, ynAnswer(parent.id, false)]]);
    expect(shouldShowQuestionForValidation(visibilityQuestion(parent), questions, yesMap)).toBe(true);
    expect(shouldShowQuestionForValidation(visibilityQuestion(child), questions, yesMap)).toBe(false);
    expect(shouldShowQuestionForValidation(visibilityQuestion(child), questions, noMap)).toBe(true);
  });

  it('QA Stable PEEP leaves children empty; Moderate/Critical fill assistance narratives', () => {
    const stable = fillAllTabs(catalog, 'low');
    const critical = fillAllTabs(catalog, 'critical');
    const parent = byKey(catalog, 'canSelfEvacuate');
    expect(stable.get(parent.id)?.booleanValue).toBe(true);
    for (const key of PEEP_CHILD_KEYS) {
      expect(stable.has(byKey(catalog, key).id)).toBe(false);
    }
    expect(critical.get(parent.id)?.booleanValue).toBe(false);
    expect(critical.get(byKey(catalog, 'peepAssistanceRequired').id)?.textValue).toBeTruthy();
    expect(critical.get(byKey(catalog, 'peepDiscussedWithPerson').id)?.booleanValue).toBe(true);
  });

  it('QA Stable Bed Rails is not in use; Critical records in-place rails without a legal finding', () => {
    const stable = fillAllTabs(catalog, 'low');
    const moderate = fillAllTabs(catalog, 'normal');
    const critical = fillAllTabs(catalog, 'critical');
    const parent = byKey(catalog, 'bedRailsInUseOrConsidered');
    expect(stable.get(parent.id)?.booleanValue).toBe(false);
    expect(stable.has(byKey(catalog, 'bedRailsRequiredInPlace').id)).toBe(false);
    expect(selectedCode(moderate.get(byKey(catalog, 'bedRailsRequiredInPlace').id))).toBe('not_required');
    expect(moderate.get(byKey(catalog, 'bedRailsEntrapmentRisk').id)?.booleanValue).toBe(false);
    expect(selectedCode(critical.get(byKey(catalog, 'bedRailsRequiredInPlace').id))).toBe('required_in_place');
    expect(critical.get(byKey(catalog, 'bedRailsEntrapmentRisk').id)?.booleanValue).toBe(true);
    const notes = critical.get(byKey(catalog, 'bedRailsConsentCapacityNotes').id)?.textValue ?? '';
    expect(notes.toLowerCase()).not.toMatch(/lacks capacity|does not have capacity|adrt|dnacpr/);
  });

  it('promotes PEEP when parent Yes, or parent No with children; does not promote incomplete No', () => {
    const peepQs = catalog.filter((q) => q.sectionNumber === 16).map((q) => ({
      id: q.id,
      questionText: q.questionText,
      questionType: q.questionType,
      metadata: q.metadata,
      section: { sectionNumber: 16 },
    }));
    const parent = byKey(catalog, 'canSelfEvacuate');
    const yesOnly = buildIaAssessmentCompletions({
      metadata: {},
      questions: peepQs,
      answers: [ynAnswer(parent.id, true)],
    });
    expect(yesOnly.find((row) => row.assessmentKey === 'peep')?.snapshot).toEqual({
      peep: { canSelfEvacuate: true },
    });

    const childAnswers = PEEP_CHILD_KEYS.map((key) => {
      const q = byKey(catalog, key);
      if (q.questionType === 'YES_NO') return ynAnswer(q.id, true);
      if (q.questionType === 'DATE') return dateAnswer(q.id, '2026-10-01');
      return textAnswer(q.id, 'Assistance recorded for this PEEP.');
    });
    const completeNo = buildIaAssessmentCompletions({
      metadata: {},
      questions: peepQs,
      answers: [ynAnswer(parent.id, false), ...childAnswers],
    });
    expect(completeNo.find((row) => row.assessmentKey === 'peep')?.snapshot).toEqual(
      expect.objectContaining({
        peep: expect.objectContaining({ canSelfEvacuate: false, peepAssistanceRequired: 'Assistance recorded for this PEEP.' }),
      }),
    );

    const incompleteNo = buildIaAssessmentCompletions({
      metadata: {},
      questions: peepQs,
      answers: [ynAnswer(parent.id, false)],
    });
    expect(incompleteNo.find((row) => row.assessmentKey === 'peep')).toBeUndefined();
  });

  it('Stable Falls omits Q1–Q6; Moderate/Critical answer them', () => {
    const stable = buildHolisticWorksheetMetadata('low').fallsScreening as Record<string, unknown>;
    const moderate = buildHolisticWorksheetMetadata('normal').fallsScreening as Record<string, unknown>;
    expect(stable.consentToSixQuestions).toBe(false);
    expect(stable.q1FallsNeedInvestigating).toBeUndefined();
    expect(stable.q2DizzyOrBlackouts).toBeUndefined();
    expect(stable.q3WalkingBalanceUnassessed).toBeUndefined();
    expect(stable.q4FourPlusMedsNoReview).toBeUndefined();
    expect(stable.q5TrippingMore).toBeUndefined();
    expect(stable.q6FearOfFalling).toBeUndefined();
    expect(moderate.consentToSixQuestions).toBe(true);
    expect(moderate.q1FallsNeedInvestigating === true || moderate.q1FallsNeedInvestigating === false).toBe(true);
  });

  it('Therapy Fill Demo is nested with six checked flags; referral No is complete', () => {
    const meta = buildHolisticWorksheetMetadata('critical');
    const therapy = extractTherapyAideMemoire(meta);
    expect(therapy).toEqual(
      expect.objectContaining({
        furtherReferralRequired: false,
        choking: expect.objectContaining({ checked: false }),
        mobilityChange: expect.objectContaining({ checked: true }),
      }),
    );
    expect((meta as { therapyAideMemoire?: unknown }).therapyAideMemoire).toBeUndefined();
    expect(isTherapyAideMemoireComplete(meta)).toBe(true);
    expect(
      isTherapyAideMemoireComplete({
        painAssessment: {
          therapyAideMemoire: {
            choking: { checked: false },
            chestInfections: { checked: false },
            speechConcern: { checked: false },
            mobilityChange: { checked: false },
            selfCareChange: { checked: false },
            carePackageConcern: { checked: false },
            furtherReferralRequired: false,
          },
        },
      }),
    ).toBe(true);
  });

  it('MUST QA fills bands and skips invented BMI / catalogue score', () => {
    const must = buildHolisticWorksheetMetadata('critical').mustAssessment as {
      bmiOptionId?: string;
      score?: number;
    };
    expect(must.bmiOptionId).toBe('lt18_5');
    expect(must.score).toBeGreaterThan(0);
    const bmi = catalog.find((q) => q.questionText.trim().toLowerCase() === 'bmi value');
    const weight = catalog.find((q) => fieldKeyOf(q) === 'weightKg');
    expect(bmi && isInventedClinicalMeasurement(bmi)).toBe(true);
    expect(weight && isInventedClinicalMeasurement(weight)).toBe(true);
    const answers = fillAllTabs(catalog, 'critical');
    if (bmi) expect(answers.has(bmi.id)).toBe(false);
    if (weight) expect(answers.has(weight.id)).toBe(false);
  });

  it('Stable equipment checklist does not force hoist or profiling bed', () => {
    const checklist = buildHolisticWorksheetMetadata('low').equipmentChecklist as {
      hoistServiced?: boolean;
      profilingBedServiced?: boolean;
    };
    expect(checklist.hoistServiced).toBe(false);
    expect(checklist.profilingBedServiced).toBe(false);
  });

  it('MCA required = No hides 2.mca screening questions', () => {
    const required = catalog.find((q) => fieldKeyOf(q) === 'mcaRequired');
    const screening = catalog.find((q) => (q.metadata as { specRef?: string } | null)?.specRef === '2.mca');
    expect(required).toBeDefined();
    expect(screening).toBeDefined();
    const questions = catalog.filter((q) => q.sectionNumber === 2).map(visibilityQuestion);
    const noMap = new Map([[required!.id, ynAnswer(required!.id, false)]]);
    const yesMap = new Map([[required!.id, ynAnswer(required!.id, true)]]);
    expect(shouldShowQuestionForValidation(visibilityQuestion(screening!), questions, noMap)).toBe(false);
    expect(shouldShowQuestionForValidation(visibilityQuestion(screening!), questions, yesMap)).toBe(true);
  });

  it('wires §16 and §17 into the enterprise default template catalogue', () => {
    const byNumber = new Map(ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS.map((s) => [s.sectionNumber, s]));
    expect([...byNumber.keys()].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    expect(byNumber.get(16)?.questions).toHaveLength(8);
    expect(byNumber.get(17)?.questions).toHaveLength(9);
    expect(byNumber.get(15)?.questions).toHaveLength(5);
    expect(byNumber.get(18)?.questions).toHaveLength(11);
    expect(byNumber.get(16)?.questions.map((q) => (q.metadata as { fieldKey?: string }).fieldKey)).toEqual([
      'canSelfEvacuate',
      ...PEEP_CHILD_KEYS,
    ]);
    expect(byNumber.get(17)?.questions.map((q) => (q.metadata as { fieldKey?: string }).fieldKey)).toEqual([
      'bedRailsInUseOrConsidered',
      'bedRailsRequiredInPlace',
      'bedRailsReason',
      'bedRailsAlternativesConsidered',
      'bedRailsEntrapmentRisk',
      'bedRailsEntrapmentDetails',
      'bedRailsConsentCapacityNotes',
      'bedRailsReviewDate',
      'bedRailsNotes',
    ]);
  });

  it('tab extras map 19→§16 and 20→§17; registry is not 1..18', () => {
    expect([...IA_REGISTERED_HOLISTIC_TAB_IDS]).toEqual(
      expect.arrayContaining([1, 18, 19, 20, 21, 22]),
    );
    expect(IA_REGISTERED_HOLISTIC_TAB_IDS).not.toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    expect(extraQuestionsForHolisticTab(19, catalog).every((q) => q.sectionNumber === 16)).toBe(true);
    expect(extraQuestionsForHolisticTab(20, catalog).every((q) => q.sectionNumber === 17)).toBe(true);
  });
});
