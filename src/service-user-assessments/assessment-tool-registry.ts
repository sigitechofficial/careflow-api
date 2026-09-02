import { Prisma } from '@prisma/client';
import {
  formatPainAssessmentHistorySummary,
  painAssessmentFromMetadata,
} from '../initial-assessments/initial-assessment-abbey.util';
import {
  extractTherapyAideMemoire,
  isAdvanceCarePlanningComplete,
  isEndOfLifeAssessmentComplete,
  isEnvironmentAssessmentComplete,
  isMentalCapacityChecklistComplete,
  isMovingHandlingComplete,
  isPainAssessmentComplete,
  isPhotographyConsentComplete,
  isTherapyAideMemoireComplete,
} from './assessment-promotion-p3.util';

export type AssessmentToolCompletion = {
  assessmentKey: string;
  title: string;
  holisticTabId?: number;
  summary: string;
  snapshot: Record<string, unknown>;
};

type QuestionRow = {
  id: string;
  questionText: string;
  questionType: string;
  metadata: Prisma.JsonValue;
  section: { sectionNumber: number };
};

type AnswerRow = {
  questionId: string;
  checked: boolean | null;
  booleanValue: boolean | null;
  textValue: string | null;
  numberValue: Prisma.Decimal | null;
  dateValue: Date | null;
  timeValue: string | null;
  selectedOptions: Prisma.JsonValue;
};

export type AssessmentToolContext = {
  metadata: Prisma.JsonValue | null | undefined;
  questions: QuestionRow[];
  answers: AnswerRow[];
};

type AssessmentToolDefinition = {
  assessmentKey: string;
  title: string;
  holisticTabId?: number;
  buildCompletion: (context: AssessmentToolContext) => AssessmentToolCompletion | null;
};

type MustMetadata = {
  bmiOptionId?: string;
  weightLossOptionId?: string;
  acuteDiseaseOptionId?: string;
  enteredScores?: Record<string, number>;
  bmiScore?: number;
  weightLossScore?: number;
  acuteDiseaseScore?: number;
  score?: number;
  riskLevel?: 'low' | 'medium' | 'high';
};

type WaterlowMetadata = {
  gender?: number;
  age?: number;
  build?: number;
  appetite?: number;
  mobility?: number;
  continence?: number;
  neurological?: number;
  surgery?: number;
  medication?: number;
  weightLoss?: number;
  singleOptionIds?: Partial<Record<string, string>>;
  weightLossOptionId?: string;
  enteredScores?: Record<string, number>;
  skinTypes?: string[];
  tissueMalnutrition?: string[];
  score?: number;
};

type FallsScreeningMetadata = {
  fallOrConcern?: boolean | null;
  firstScreenSinceLastFall?: 'yes' | 'no' | 'na' | null;
  consentToSixQuestions?: boolean | null;
  q1FallsNeedInvestigating?: boolean | null;
  q2DizzyOrBlackouts?: boolean | null;
  q3WalkingBalanceUnassessed?: boolean | null;
  q4FourPlusMedsNoReview?: boolean | null;
  q5TrippingMore?: boolean | null;
  q6FearOfFalling?: boolean | null;
  additionalComments?: string;
};

type SkinIntegrityCheckMetadata = {
  rows: Array<{ id: string; label: string; right: string; left: string }>;
};

const MUST_STEP_1_BMI_CRITERIA = [
  { id: 'gt20', score: 0 },
  { id: '18_5to20', score: 1 },
  { id: 'lt18_5', score: 2 },
] as const;

const MUST_STEP_2_WEIGHT_LOSS_CRITERIA = [
  { id: 'lt5', score: 0 },
  { id: '5to10', score: 1 },
  { id: 'gt10', score: 2 },
] as const;

const MUST_STEP_3_ACUTE_DISEASE_OPTIONS = [
  { id: 'no', score: 0 },
  { id: 'yes', score: 2 },
] as const;

const WATERLOW_SINGLE_SECTIONS = [
  'gender',
  'age',
  'build',
  'appetite',
  'mobility',
  'continence',
  'neurological',
  'surgery',
  'medication',
] as const;

const WATERLOW_WEIGHT_LOSS_OPTIONS = [
  { id: 'none', score: 0 },
  { id: '0.5-5', score: 1 },
  { id: '5-10', score: 2 },
  { id: '10-15', score: 3 },
  { id: '15+', score: 4 },
  { id: 'unsure', score: 2 },
] as const;

const WATERLOW_SKIN_OPTIONS = [
  { id: 'healthy', score: 0 },
  { id: 'thin', score: 1 },
  { id: 'dry', score: 1 },
  { id: 'oedematous', score: 1 },
  { id: 'clammy', score: 1 },
  { id: 'previous_ulcer', score: 2 },
  { id: 'discoloured', score: 2 },
  { id: 'broken', score: 3 },
] as const;

const WATERLOW_TISSUE_OPTIONS = [
  { id: 'smoking', score: 1 },
  { id: 'anaemia', score: 2 },
  { id: 'pvd', score: 5 },
  { id: 'single_organ', score: 5 },
  { id: 'multi_organ', score: 8 },
  { id: 'cachexia', score: 8 },
] as const;

const FALLS_SCREENING_TABLE_QUESTIONS = [
  'q1FallsNeedInvestigating',
  'q2DizzyOrBlackouts',
  'q3WalkingBalanceUnassessed',
  'q4FourPlusMedsNoReview',
  'q5TrippingMore',
  'q6FearOfFalling',
] as const;

function metadataObject(metadata: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return metadata as Record<string, unknown>;
}

function specRefOf(q: { metadata: Prisma.JsonValue }): string | undefined {
  if (!q.metadata || typeof q.metadata !== 'object' || Array.isArray(q.metadata)) return undefined;
  const ref = (q.metadata as Record<string, unknown>).specRef;
  return typeof ref === 'string' ? ref : undefined;
}

function fieldKeyOf(q: { metadata: Prisma.JsonValue }): string | undefined {
  if (!q.metadata || typeof q.metadata !== 'object' || Array.isArray(q.metadata)) return undefined;
  const key = (q.metadata as Record<string, unknown>).fieldKey;
  return typeof key === 'string' ? key : undefined;
}

function isYesNoAnswered(answer?: AnswerRow): boolean {
  return (
    answer?.checked === true ||
    answer?.checked === false ||
    answer?.booleanValue === true ||
    answer?.booleanValue === false
  );
}

function isPeepFieldAnswered(q: QuestionRow, answer?: AnswerRow): boolean {
  if (q.questionType === 'YES_NO' || q.questionType === 'CHECKBOX') return isYesNoAnswered(answer);
  return isAnswered(q, answer);
}

function isPeepComplete(questions: QuestionRow[], answers: AnswerRow[]): boolean {
  const peepQuestions = questions.filter((q) => q.section.sectionNumber === 16);
  if (!peepQuestions.length) return false;
  const map = new Map(answers.map((a) => [a.questionId, a]));
  const parent = peepQuestions.find((q) => fieldKeyOf(q) === 'canSelfEvacuate');
  if (!parent || !isYesNoAnswered(map.get(parent.id))) return false;
  const canSelfEvacuate =
    map.get(parent.id)?.checked === true || map.get(parent.id)?.booleanValue === true;
  if (canSelfEvacuate) return true;
  return peepQuestions
    .filter((q) => fieldKeyOf(q) !== 'canSelfEvacuate')
    .every((q) => isPeepFieldAnswered(q, map.get(q.id)));
}

function buildPeepSnapshot(questions: QuestionRow[], answers: AnswerRow[]): Record<string, unknown> {
  const map = new Map(answers.map((a) => [a.questionId, a]));
  const snapshot: Record<string, unknown> = {};
  for (const q of questions.filter((row) => row.section.sectionNumber === 16)) {
    const key = fieldKeyOf(q);
    if (!key) continue;
    const answer = map.get(q.id);
    if (!answer) continue;
    if (isYesNoAnswered(answer)) {
      snapshot[key] = answer.booleanValue ?? answer.checked;
    } else if (answer.textValue?.trim()) {
      snapshot[key] = answer.textValue;
    } else if (answer.dateValue) {
      snapshot[key] = answer.dateValue.toISOString().slice(0, 10);
    }
  }
  return snapshot;
}

function isAnswered(q: { questionType: string }, answer?: AnswerRow): boolean {
  if (!answer) return false;
  if (q.questionType === 'CHECKBOX' || q.questionType === 'YES_NO') {
    return answer.checked === true || answer.booleanValue === true;
  }
  if (answer.textValue?.trim()) return true;
  if (answer.numberValue != null) return true;
  if (answer.dateValue) return true;
  if (answer.timeValue?.trim()) return true;
  if (answer.selectedOptions != null) {
    if (Array.isArray(answer.selectedOptions) && answer.selectedOptions.length > 0) return true;
    if (typeof answer.selectedOptions === 'object' && Object.keys(answer.selectedOptions as object).length > 0) {
      return true;
    }
  }
  return false;
}

function scoreFromOptionId(options: readonly { id: string; score: number }[], optionId?: string): number | undefined {
  if (!optionId) return undefined;
  return options.find((option) => option.id === optionId)?.score;
}

function resolveMustBmiScore(meta: MustMetadata): number | undefined {
  return scoreFromOptionId(MUST_STEP_1_BMI_CRITERIA, meta.bmiOptionId) ?? meta.bmiScore;
}

function resolveMustWeightLossScore(meta: MustMetadata): number | undefined {
  return scoreFromOptionId(MUST_STEP_2_WEIGHT_LOSS_CRITERIA, meta.weightLossOptionId) ?? meta.weightLossScore;
}

function resolveMustAcuteDiseaseScore(meta: MustMetadata): number | undefined {
  return scoreFromOptionId(MUST_STEP_3_ACUTE_DISEASE_OPTIONS, meta.acuteDiseaseOptionId) ?? meta.acuteDiseaseScore;
}

function computeMustScore(meta: MustMetadata | null | undefined): number {
  if (!meta) return 0;
  return (resolveMustBmiScore(meta) ?? 0) +
    (resolveMustWeightLossScore(meta) ?? 0) +
    (resolveMustAcuteDiseaseScore(meta) ?? 0);
}

function mustStepScoresEntered(meta: MustMetadata | null | undefined): boolean {
  if (!meta) return false;
  return (
    resolveMustBmiScore(meta) != null &&
    resolveMustWeightLossScore(meta) != null &&
    resolveMustAcuteDiseaseScore(meta) != null
  );
}

function mustRiskLabel(level: 'low' | 'medium' | 'high'): string {
  if (level === 'low') return 'Low risk';
  if (level === 'medium') return 'Medium risk';
  return 'High risk';
}

function isMustScoringComplete(meta: MustMetadata | undefined): boolean {
  return mustStepScoresEntered(meta);
}

function sumMultiSelect(ids: string[] | undefined, options: readonly { id: string; score: number }[]): number {
  if (!ids?.length) return 0;
  const byId = new Map(options.map((o) => [o.id, o.score]));
  return ids.reduce((sum, id) => sum + (byId.get(id) ?? 0), 0);
}

function hasWaterlowEnteredScores(meta: WaterlowMetadata | null | undefined): boolean {
  return Object.keys(meta?.enteredScores ?? {}).length > 0;
}

function computeWaterlowScoreFromEnteredScores(scores: Record<string, number>): number {
  return Object.values(scores).reduce((sum, value) => {
    const n = Number(value);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

function computeWaterlowScoreFromSelections(meta: WaterlowMetadata): number {
  let total = 0;
  for (const field of WATERLOW_SINGLE_SECTIONS) {
    const score = meta[field as keyof WaterlowMetadata] as number | undefined;
    total += score ?? 0;
  }
  const weightLossScore =
    scoreFromOptionId(WATERLOW_WEIGHT_LOSS_OPTIONS, meta.weightLossOptionId) ?? meta.weightLoss ?? 0;
  total += weightLossScore;
  total += sumMultiSelect(meta.skinTypes, WATERLOW_SKIN_OPTIONS);
  total += sumMultiSelect(meta.tissueMalnutrition, WATERLOW_TISSUE_OPTIONS);
  return total;
}

function computeWaterlowScore(meta: WaterlowMetadata | null | undefined): number {
  if (!meta) return 0;
  if (hasWaterlowEnteredScores(meta)) {
    return computeWaterlowScoreFromEnteredScores(meta.enteredScores!);
  }
  return computeWaterlowScoreFromSelections(meta);
}

function isWaterlowScoringComplete(meta: WaterlowMetadata | undefined): boolean {
  if (!meta) return false;
  if (hasWaterlowEnteredScores(meta)) {
    const requiredSections = [
      ...WATERLOW_SINGLE_SECTIONS,
      'weightLoss',
    ];
    return requiredSections.every((sectionId) =>
      Object.keys(meta.enteredScores ?? {}).some((key) => key.startsWith(`${sectionId}:`)),
    );
  }

  const singleOptionIds = meta.singleOptionIds ?? {};
  const singlesComplete = WATERLOW_SINGLE_SECTIONS.every((field) =>
    singleOptionIds[field] != null || meta[field as keyof WaterlowMetadata] != null,
  );
  const weightLossComplete = meta.weightLossOptionId != null || meta.weightLoss != null;
  return singlesComplete && weightLossComplete;
}

function waterlowRiskLabel(score: number): string {
  if (score >= 20) return 'Very high risk';
  if (score >= 15) return 'High risk';
  if (score >= 10) return 'At risk';
  return 'Minimal risk';
}

function boolAnswered(value: boolean | null | undefined): boolean {
  return value === true || value === false;
}

function isFallsScreeningComplete(meta: FallsScreeningMetadata | undefined): boolean {
  if (!meta) return false;
  if (!boolAnswered(meta.fallOrConcern)) return false;
  if (meta.firstScreenSinceLastFall == null) return false;
  if (!boolAnswered(meta.consentToSixQuestions)) return false;
  if (meta.consentToSixQuestions !== true) return true;
  return FALLS_SCREENING_TABLE_QUESTIONS.every((field) => boolAnswered(meta[field]));
}

function skinIntegrityCheckHasEntries(metadata: SkinIntegrityCheckMetadata): boolean {
  return metadata.rows.some((row) => row.right.trim() || row.left.trim());
}

function getMustMetadata(metadata: Prisma.JsonValue | null | undefined): MustMetadata | undefined {
  const base = metadataObject(metadata);
  const mustAssessment = base.mustAssessment;
  if (mustAssessment && typeof mustAssessment === 'object' && !Array.isArray(mustAssessment)) {
    return mustAssessment as MustMetadata;
  }
  const direct = base.must;
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct as MustMetadata;
  const nutrition = base.nutrition;
  if (nutrition && typeof nutrition === 'object' && !Array.isArray(nutrition)) {
    const maybe = (nutrition as Record<string, unknown>).must;
    if (maybe && typeof maybe === 'object' && !Array.isArray(maybe)) return maybe as MustMetadata;
  }
  return undefined;
}

function getWaterlowMetadata(metadata: Prisma.JsonValue | null | undefined): WaterlowMetadata | undefined {
  const base = metadataObject(metadata);
  const row = base.waterlow;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  return row as WaterlowMetadata;
}

type EquipmentSelectionMetadata = {
  selectedRiskLevel?: string;
  selectedEquipment?: string;
};

function getEquipmentSelectionMetadata(
  metadata: Prisma.JsonValue | null | undefined,
): EquipmentSelectionMetadata | undefined {
  const row = metadataObject(metadata).equipmentSelection;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  return row as EquipmentSelectionMetadata;
}

function isEquipmentSelectionComplete(meta: EquipmentSelectionMetadata | undefined): boolean {
  if (!meta) return false;
  return Boolean(meta.selectedRiskLevel?.trim() && meta.selectedEquipment?.trim());
}

function getFallsMetadata(metadata: Prisma.JsonValue | null | undefined): FallsScreeningMetadata | undefined {
  const base = metadataObject(metadata);
  const row = base.fallsScreening;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  return row as FallsScreeningMetadata;
}

function getSkinIntegrityMetadata(
  metadata: Prisma.JsonValue | null | undefined,
): SkinIntegrityCheckMetadata | undefined {
  const base = metadataObject(metadata);
  const row = base.skinIntegrityCheck;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  const meta = row as SkinIntegrityCheckMetadata;
  if (!Array.isArray(meta.rows)) return undefined;
  return meta;
}

function buildMcaSnapshot(questions: QuestionRow[], answers: AnswerRow[]) {
  const map = new Map(answers.map((a) => [a.questionId, a]));
  return questions.map((q) => ({
    questionId: q.id,
    questionText: q.questionText,
    answer: (() => {
      const a = map.get(q.id);
      if (!a) return null;
      return {
        checked: a.checked,
        booleanValue: a.booleanValue,
        textValue: a.textValue,
        numberValue: a.numberValue != null ? Number(a.numberValue) : null,
        dateValue: a.dateValue?.toISOString() ?? null,
        timeValue: a.timeValue,
        selectedOptions: a.selectedOptions,
      };
    })(),
  }));
}

function isMcaScreeningComplete(questions: QuestionRow[], answers: AnswerRow[]): boolean {
  if (!questions.length) return false;
  const map = new Map(answers.map((a) => [a.questionId, a]));
  return questions.every((q) => isAnswered(q, map.get(q.id)));
}

export function buildIaAssessmentCompletions(context: AssessmentToolContext): AssessmentToolCompletion[] {
  const tools: AssessmentToolDefinition[] = [
    {
      assessmentKey: 'must',
      title: 'MUST',
      holisticTabId: 7,
      buildCompletion: ({ metadata }) => {
        const must = getMustMetadata(metadata);
        if (!must || !isMustScoringComplete(must)) return null;
        const score = must.score ?? computeMustScore(must);
        const level = must.riskLevel ?? (score <= 0 ? 'low' : score === 1 ? 'medium' : 'high');
        return {
          assessmentKey: 'must',
          title: 'MUST',
          holisticTabId: 7,
          summary: `MUST completed (score ${score}, ${mustRiskLabel(level)})`,
          snapshot: { must },
        };
      },
    },
    {
      assessmentKey: 'waterlow',
      title: 'Waterlow',
      holisticTabId: 5,
      buildCompletion: ({ metadata }) => {
        const waterlow = getWaterlowMetadata(metadata);
        if (!waterlow || !isWaterlowScoringComplete(waterlow)) return null;
        const score = waterlow.score ?? computeWaterlowScore(waterlow);
        return {
          assessmentKey: 'waterlow',
          title: 'Waterlow',
          holisticTabId: 5,
          summary: `Waterlow completed (score ${score}, ${waterlowRiskLabel(score)})`,
          snapshot: { waterlow },
        };
      },
    },
    {
      assessmentKey: 'equipment-selection',
      title: 'Equipment selection',
      holisticTabId: 6,
      buildCompletion: ({ metadata }) => {
        const equipmentSelection = getEquipmentSelectionMetadata(metadata);
        if (!equipmentSelection || !isEquipmentSelectionComplete(equipmentSelection)) return null;
        const risk = equipmentSelection.selectedRiskLevel?.trim();
        const equipment = equipmentSelection.selectedEquipment?.trim();
        const equipmentChecklist = metadataObject(metadata).equipmentChecklist;
        return {
          assessmentKey: 'equipment-selection',
          title: 'Equipment selection',
          holisticTabId: 6,
          summary: `Equipment selection recorded (${risk}: ${equipment})`,
          snapshot: {
            equipmentSelection,
            ...(equipmentChecklist && typeof equipmentChecklist === 'object'
              ? { equipmentChecklist }
              : {}),
          },
        };
      },
    },
    {
      assessmentKey: 'falls-screening',
      title: 'Falls screening',
      holisticTabId: 8,
      buildCompletion: ({ metadata }) => {
        const falls = getFallsMetadata(metadata);
        if (!falls || !isFallsScreeningComplete(falls)) return null;
        return {
          assessmentKey: 'falls-screening',
          title: 'Falls screening',
          holisticTabId: 8,
          summary: 'Falls screening completed',
          snapshot: { fallsScreening: falls },
        };
      },
    },
    {
      assessmentKey: 'skin-integrity',
      title: 'Skin integrity',
      holisticTabId: 4,
      buildCompletion: ({ metadata }) => {
        const skin = getSkinIntegrityMetadata(metadata);
        if (!skin || !skinIntegrityCheckHasEntries(skin)) return null;
        return {
          assessmentKey: 'skin-integrity',
          title: 'Skin integrity',
          holisticTabId: 4,
          summary: 'Skin integrity check recorded',
          snapshot: { skinIntegrityCheck: skin },
        };
      },
    },
    {
      assessmentKey: 'mca-screening',
      title: 'MCA screening',
      holisticTabId: 3,
      buildCompletion: ({ questions, answers }) => {
        const required = questions.find((q) => {
          const key = (q.metadata as Record<string, unknown> | null)?.fieldKey;
          return key === 'mcaRequired' || q.questionText.trim().toLowerCase() === 'mca required?';
        });
        const requiredAnswer = required ? answers.find((a) => a.questionId === required.id) : undefined;
        const requiredYes =
          requiredAnswer?.checked === true || requiredAnswer?.booleanValue === true;
        if (!requiredYes) return null;

        const mcaQuestions = questions.filter((q) => specRefOf(q) === '2.mca');
        if (!isMcaScreeningComplete(mcaQuestions, answers)) return null;
        return {
          assessmentKey: 'mca-screening',
          title: 'MCA screening',
          holisticTabId: 3,
          summary: 'MCA screening completed',
          snapshot: { mcaScreening: buildMcaSnapshot(mcaQuestions, answers) },
        };
      },
    },
    {
      assessmentKey: 'moving-handling',
      title: 'Moving and handling',
      holisticTabId: 9,
      buildCompletion: ({ metadata }) => {
        if (!isMovingHandlingComplete(metadata)) return null;
        const movingHandlingOperations = metadataObject(metadata).movingHandlingOperations;
        return {
          assessmentKey: 'moving-handling',
          title: 'Moving and handling',
          holisticTabId: 9,
          summary: 'Moving and handling assessment completed',
          snapshot: { movingHandlingOperations },
        };
      },
    },
    {
      assessmentKey: 'pain-tool',
      title: 'Pain assessment',
      holisticTabId: 10,
      buildCompletion: ({ metadata }) => {
        if (!isPainAssessmentComplete(metadata)) return null;
        const painAssessment = metadataObject(metadata).painAssessment;
        return {
          assessmentKey: 'pain-tool',
          title: 'Pain assessment',
          holisticTabId: 10,
          summary:
            formatPainAssessmentHistorySummary(painAssessmentFromMetadata(metadata)) ??
            'Pain assessment completed',
          snapshot: { painAssessment },
        };
      },
    },
    {
      assessmentKey: 'therapy-memoire',
      title: 'Therapy aide memoire',
      holisticTabId: 11,
      buildCompletion: ({ metadata }) => {
        if (!isTherapyAideMemoireComplete(metadata)) return null;
        const therapyAideMemoire = extractTherapyAideMemoire(metadata);
        return {
          assessmentKey: 'therapy-memoire',
          title: 'Therapy aide memoire',
          holisticTabId: 11,
          summary: 'Therapy aide memoire completed',
          snapshot: { therapyAideMemoire },
        };
      },
    },
    {
      assessmentKey: 'environment-assessment',
      title: 'Environment assessment',
      holisticTabId: 12,
      buildCompletion: ({ metadata }) => {
        if (!isEnvironmentAssessmentComplete(metadata)) return null;
        const environmentAssessment = metadataObject(metadata).environmentAssessment;
        return {
          assessmentKey: 'environment-assessment',
          title: 'Environment assessment',
          holisticTabId: 12,
          summary: 'Environment assessment completed',
          snapshot: { environmentAssessment },
        };
      },
    },
    {
      assessmentKey: 'advance-care-planning',
      title: 'Advance care planning',
      holisticTabId: 13,
      buildCompletion: ({ metadata }) => {
        if (!isAdvanceCarePlanningComplete(metadata)) return null;
        const advanceCarePlanning = metadataObject(metadata).advanceCarePlanning;
        return {
          assessmentKey: 'advance-care-planning',
          title: 'Advance care planning',
          holisticTabId: 13,
          summary: 'Advance care planning completed',
          snapshot: { advanceCarePlanning },
        };
      },
    },
    {
      assessmentKey: 'end-of-life-assessment',
      title: 'End of life assessment',
      holisticTabId: 14,
      buildCompletion: ({ metadata }) => {
        if (!isEndOfLifeAssessmentComplete(metadata)) return null;
        const endOfLifeAssessment = metadataObject(metadata).endOfLifeAssessment;
        return {
          assessmentKey: 'end-of-life-assessment',
          title: 'End of life assessment',
          holisticTabId: 14,
          summary: 'End of life assessment completed',
          snapshot: { endOfLifeAssessment },
        };
      },
    },
    {
      assessmentKey: 'mental-capacity-checklist',
      title: 'Mental capacity checklist',
      holisticTabId: 17,
      buildCompletion: ({ metadata }) => {
        if (!isMentalCapacityChecklistComplete(metadata)) return null;
        const mentalCapacityChecklist = metadataObject(metadata).mentalCapacityChecklist;
        return {
          assessmentKey: 'mental-capacity-checklist',
          title: 'Mental capacity checklist',
          holisticTabId: 17,
          summary: 'Mental capacity checklist completed',
          snapshot: { mentalCapacityChecklist },
        };
      },
    },
    {
      assessmentKey: 'photography-consent',
      title: 'Photography consent',
      holisticTabId: 18,
      buildCompletion: ({ metadata }) => {
        if (!isPhotographyConsentComplete(metadata)) return null;
        const photographyConsent = metadataObject(metadata).photographyConsent;
        return {
          assessmentKey: 'photography-consent',
          title: 'Photography consent',
          holisticTabId: 18,
          summary: 'Photography consent completed',
          snapshot: { photographyConsent },
        };
      },
    },
    {
      assessmentKey: 'peep',
      title: 'Personal Emergency Evacuation Plan',
      holisticTabId: 19,
      buildCompletion: ({ questions, answers }) => {
        if (!isPeepComplete(questions, answers)) return null;
        const snapshot = buildPeepSnapshot(questions, answers);
        const independent = snapshot.canSelfEvacuate === true;
        return {
          assessmentKey: 'peep',
          title: 'Personal Emergency Evacuation Plan',
          holisticTabId: 19,
          summary: independent
            ? 'PEEP completed — can self-evacuate'
            : 'PEEP completed — assistance required',
          snapshot: { peep: snapshot },
        };
      },
    },
  ];

  return tools
    .map((tool) => tool.buildCompletion(context))
    .filter((row): row is AssessmentToolCompletion => Boolean(row));
}

export const IA_ASSESSMENT_TOOL_CATALOGUE = [
  // Keep in sync with careflow-admin/src/features/service-users/assessments/assessment-tool-registry.ts
  { assessmentKey: 'mca-screening', title: 'MCA screening', holisticTabId: 3 },
  { assessmentKey: 'skin-integrity', title: 'Skin integrity', holisticTabId: 4 },
  { assessmentKey: 'waterlow', title: 'Waterlow', holisticTabId: 5 },
  { assessmentKey: 'equipment-selection', title: 'Equipment selection', holisticTabId: 6 },
  { assessmentKey: 'must', title: 'MUST', holisticTabId: 7 },
  { assessmentKey: 'falls-screening', title: 'Falls screening', holisticTabId: 8 },
  { assessmentKey: 'moving-handling', title: 'Moving and handling', holisticTabId: 9 },
  { assessmentKey: 'pain-tool', title: 'Pain assessment', holisticTabId: 10 },
  { assessmentKey: 'therapy-memoire', title: 'Therapy aide memoire', holisticTabId: 11 },
  { assessmentKey: 'environment-assessment', title: 'Environment assessment', holisticTabId: 12 },
  { assessmentKey: 'advance-care-planning', title: 'Advance care planning', holisticTabId: 13 },
  { assessmentKey: 'end-of-life-assessment', title: 'End of life assessment', holisticTabId: 14 },
  {
    assessmentKey: 'mental-capacity-checklist',
    title: 'Mental capacity checklist',
    holisticTabId: 17,
  },
  { assessmentKey: 'photography-consent', title: 'Photography consent', holisticTabId: 18 },
  { assessmentKey: 'peep', title: 'Personal Emergency Evacuation Plan', holisticTabId: 19 },
];
