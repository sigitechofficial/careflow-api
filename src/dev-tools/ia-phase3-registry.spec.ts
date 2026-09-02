import { ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS } from '../../prisma/seeds/initial-assessment-enterprise.seed';
import {
  extractTherapyAideMemoire,
  isEndOfLifeAssessmentComplete,
  isTherapyAideMemoireComplete,
} from '../service-user-assessments/assessment-promotion-p3.util';
import {
  buildIaAssessmentCompletions,
  IA_ASSESSMENT_TOOL_CATALOGUE,
} from '../service-user-assessments/assessment-tool-registry';
import { IA_REGISTERED_HOLISTIC_TAB_IDS } from './dto/generate-ia-section.dto';
import {
  buildAutofillAnswers,
  buildHolisticWorksheetMetadata,
  collectWritableDemoQuestionIds,
  isInventedClinicalMeasurement,
  type AnswerInput,
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

const catalog = flattenCatalog();

describe('Phase 3 IA registry, promotion, and QA alignment', () => {
  it('uses registered holistic tab IDs instead of a 1..18 range', () => {
    expect([...IA_REGISTERED_HOLISTIC_TAB_IDS]).toEqual(
      expect.arrayContaining([1, 6, 18, 19, 20, 21, 22]),
    );
    expect(IA_REGISTERED_HOLISTIC_TAB_IDS).toHaveLength(22);
    expect(IA_REGISTERED_HOLISTIC_TAB_IDS).not.toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
  });

  it('registers peep on tab 19 and equipment-selection on tab 6', () => {
    expect(
      IA_ASSESSMENT_TOOL_CATALOGUE.some((t) => t.assessmentKey === 'peep' && t.holisticTabId === 19),
    ).toBe(true);
    expect(
      IA_ASSESSMENT_TOOL_CATALOGUE.some(
        (t) => t.assessmentKey === 'equipment-selection' && t.holisticTabId === 6,
      ),
    ).toBe(true);
  });

  it('does not add assessment keys for Bed Rails IA, Infection, or Fire Safety', () => {
    const keys = IA_ASSESSMENT_TOOL_CATALOGUE.map((t) => t.assessmentKey);
    expect(keys).not.toContain('bed-rail-assessment');
    expect(keys).not.toContain('infection');
    expect(keys).not.toContain('fire-safety');
    expect(IA_ASSESSMENT_TOOL_CATALOGUE.some((t) => t.holisticTabId === 20)).toBe(false);
    expect(IA_ASSESSMENT_TOOL_CATALOGUE.some((t) => t.holisticTabId === 21)).toBe(false);
    expect(IA_ASSESSMENT_TOOL_CATALOGUE.some((t) => t.holisticTabId === 22)).toBe(false);
  });

  it('promotes equipment-selection when risk level and equipment are recorded', () => {
    const complete = buildIaAssessmentCompletions({
      metadata: {
        equipmentSelection: {
          selectedRiskLevel: 'Low risk',
          selectedEquipment: 'Standard foam mattress — no additional pressure equipment',
        },
        equipmentChecklist: { hoistServiced: false, profilingBedServiced: false },
      },
      questions: [],
      answers: [],
    });
    expect(complete.find((row) => row.assessmentKey === 'equipment-selection')?.snapshot).toEqual(
      expect.objectContaining({
        equipmentSelection: expect.objectContaining({
          selectedRiskLevel: 'Low risk',
        }),
      }),
    );

    const incomplete = buildIaAssessmentCompletions({
      metadata: { equipmentSelection: { selectedRiskLevel: 'Low risk' } },
      questions: [],
      answers: [],
    });
    expect(incomplete.find((row) => row.assessmentKey === 'equipment-selection')).toBeUndefined();
  });

  it('does not promote MCA screening when MCA required is No', () => {
    const required = catalog.find((q) => fieldKeyOf(q) === 'mcaRequired');
    const screening = catalog.filter((q) => (q.metadata as { specRef?: string } | null)?.specRef === '2.mca');
    expect(required).toBeDefined();
    expect(screening.length).toBeGreaterThan(0);

    const questions = [required!, ...screening].map((q) => ({
      id: q.id,
      questionText: q.questionText,
      questionType: q.questionType,
      metadata: q.metadata,
      section: { sectionNumber: q.sectionNumber },
    }));

    const noRequired = buildIaAssessmentCompletions({
      metadata: {},
      questions,
      answers: [ynAnswer(required!.id, false)],
    });
    expect(noRequired.find((row) => row.assessmentKey === 'mca-screening')).toBeUndefined();
  });

  it('does not promote incomplete EOL; QA Demo EOL is complete without inventing DNACPR Yes', () => {
    expect(
      isEndOfLifeAssessmentComplete({
        endOfLifeAssessment: {
          endOfLifeCarePlanAnswer: false,
          awareOfDyingAnswer: false,
          dnrInPlaceAnswer: false,
        },
      }),
    ).toBe(false);

    const qa = buildHolisticWorksheetMetadata('low');
    expect(isEndOfLifeAssessmentComplete(qa)).toBe(true);
    expect((qa.endOfLifeAssessment as { dnrInPlaceAnswer?: boolean }).dnrInPlaceAnswer).toBe(false);
    expect(buildIaAssessmentCompletions({ metadata: qa, questions: [], answers: [] }).some((row) => row.assessmentKey === 'end-of-life-assessment')).toBe(true);
  });

  it('reads therapy from nested IA metadata or a top-level promotion snapshot', () => {
    const nested = buildHolisticWorksheetMetadata('low');
    expect(extractTherapyAideMemoire(nested)).toEqual(expect.objectContaining({ furtherReferralRequired: false }));
    expect(isTherapyAideMemoireComplete(nested)).toBe(true);

    const snapshot = { therapyAideMemoire: extractTherapyAideMemoire(nested) };
    expect(extractTherapyAideMemoire(snapshot)).toEqual(extractTherapyAideMemoire(nested));
    expect(isTherapyAideMemoireComplete(snapshot)).toBe(true);
  });

  it('Stable catalogue pain score is 0 to match worksheet NRS; MUST BMI stays uninvented', () => {
    const requested = catalog.map((q) => q.id);
    const writable = collectWritableDemoQuestionIds(10, catalog, requested, 'low');
    const answers = new Map<string, AnswerInput>();
    for (const a of buildAutofillAnswers(catalog, 'low', writable)) answers.set(a.questionId, a);

    const painScore = catalog.find((q) => q.questionText.trim() === 'Pain score (0-10)');
    const meta = buildHolisticWorksheetMetadata('low');
    const nrs = (meta.painAssessment as { nrsScore?: number }).nrsScore;
    expect(nrs).toBe(0);
    if (painScore && answers.has(painScore.id)) {
      expect(answers.get(painScore.id)?.numberValue).toBe(0);
    }

    const bmi = catalog.find((q) => q.questionText.trim().toLowerCase() === 'bmi value');
    const mustScore = catalog.find((q) => q.questionText.trim().toLowerCase() === 'must score');
    expect(bmi && isInventedClinicalMeasurement(bmi)).toBe(true);
    expect(mustScore && isInventedClinicalMeasurement(mustScore)).toBe(true);
  });

  it('Stable equipment selection does not invent hoist or profiling bed', () => {
    const meta = buildHolisticWorksheetMetadata('low');
    const selection = meta.equipmentSelection as { selectedEquipment?: string };
    const checklist = meta.equipmentChecklist as {
      hoistServiced?: boolean;
      profilingBedServiced?: boolean;
    };
    expect(selection.selectedEquipment).toMatch(/standard foam mattress/i);
    expect(selection.selectedEquipment?.toLowerCase()).not.toMatch(/hoist|profiling bed/);
    expect(checklist.hoistServiced).toBe(false);
    expect(checklist.profilingBedServiced).toBe(false);
  });
});
