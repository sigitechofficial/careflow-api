import type { Prisma } from '@prisma/client';
import {
  buildIaAssessmentCompletions,
  computeMustScore,
  getMustMetadata,
  mustStepScoresEntered,
} from '../service-user-assessments/assessment-tool-registry';
import { FALLS_CASE_FINDING_FIELD_KEYS } from './initial-assessment-falls.util';
import { movingHandlingUsesHoist } from './initial-assessment-moving-handling.util';
import {
  applySpecialistOverride,
  SPECIALIST_TAB_IDS,
  SPECIALIST_WORKSHEET_TITLES,
  specialistRelevanceFromInputs,
  specialistRequiredMessage,
  type SpecialistInputs,
  type SpecialistOverride,
  type SpecialistRelevance,
} from './initial-assessment-specialist-relevance.rules';
import { waterlowScoreFromMetadata } from './initial-assessment-waterlow.util';

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

function metaRecord(
  value: Prisma.JsonValue | null | undefined,
): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Core IA screening answers for the relevance rules. Mirrors careflow-admin
 * `specialistInputsFromAssessment` (fieldKey first, stable question text as the fallback).
 */
export function specialistInputsFromSubmission(params: {
  questions: QuestionRow[];
  answers: AnswerRow[];
  metadata: Prisma.JsonValue | null | undefined;
}): SpecialistInputs {
  const { questions, answers, metadata } = params;
  const map = new Map(answers.map((a) => [a.questionId, a]));
  const find = (fieldKey: string, text?: string) =>
    questions.find((q) => metaRecord(q.metadata).fieldKey === fieldKey) ??
    (text
      ? questions.find((q) => q.questionText.toLowerCase().includes(text))
      : undefined);
  const yesNo = (fieldKey: string, text?: string): boolean | null => {
    const q = find(fieldKey, text);
    const a = q ? map.get(q.id) : undefined;
    if (a?.checked === true || a?.booleanValue === true) return true;
    if (a?.checked === false || a?.booleanValue === false) return false;
    return null;
  };
  const selected = (fieldKey: string): string[] | null => {
    const q = find(fieldKey);
    const raw = q ? map.get(q.id)?.selectedOptions : undefined;
    if (Array.isArray(raw)) return raw.length ? raw.map(String) : null;
    if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
    return null;
  };
  const single = (fieldKey: string): string | null =>
    selected(fieldKey)?.[0] ?? null;

  const meta = metaRecord(metadata);
  const hoistFromTasks = movingHandlingUsesHoist(metadata);
  const adlRows = (metaRecord(meta.adl as Prisma.JsonValue).rows ??
    null) as Array<{ id?: string; score?: unknown }> | null;
  const must = getMustMetadata(metadata);
  const waterlow = waterlowScoreFromMetadata(metadata);
  const k = FALLS_CASE_FINDING_FIELD_KEYS;

  return {
    painConcerns: selected('painConcerns'),
    nutritionStatus: single('nutritionStatus'),
    appetiteStatus: selected('appetiteStatus'),
    unableToWeigh: yesNo('unableToWeigh'),
    swallowingConcerns: selected('swallowingConcerns'),
    capacityDoubt: yesNo('capacityDoubt'),
    understands: single('understandsAssessmentInfo'),
    covertMedication: yesNo('covertMedicationRequired'),
    mcaRequired: yesNo('mcaRequired', 'mca required'),
    dolRestrictions: selected('dolRestrictions'),
    dolConcern: single('dolConcern'),
    skinCondition: yesNo('skinCondition'),
    hasWounds: yesNo('hasWounds'),
    restrictedToBed: yesNo('restrictedToBed', 'restricted to bed'),
    usesHoist:
      hoistFromTasks !== undefined ? hoistFromTasks : yesNo('usesHoistOrSling'),
    independentAllTransfers: yesNo(
      'independentAllTransfers',
      'independent with all transfers',
    ),
    bladder: selected('bladderContinenceOptions'),
    bowel: selected('bowelContinenceOptions'),
    diabetic: yesNo('serviceUserIsDiabetic'),
    mustScore: mustStepScoresEntered(must) ? computeMustScore(must) : null,
    waterlowScore: waterlow > 0 ? waterlow : null,
    adlScores:
      Array.isArray(adlRows) && adlRows.length
        ? Object.fromEntries(
            adlRows.map((r) => [String(r.id), Number(r.score) || 0]),
          )
        : null,
    falls: {
      fallsLast12Months: yesNo(k.fallsLast12Months),
      unsteadiness: yesNo(k.unsteadiness),
      fearOfFalling: yesNo(k.fearOfFalling),
      clinicalConcern: yesNo(k.clinicalConcern),
    },
    furtherEquipment: yesNo('furtherEquipmentRequired'),
    fireRisks: yesNo('fireSafetyRisksIdentified'),
    smokeAlarmWorking: yesNo('smokeAlarmFittedWorking'),
    smoking: single('smokingStatus'),
    oxygen: yesNo('oxygenDependent'),
    hoarding: yesNo('hoardingRisk', 'hoarding or clutter risk'),
    infectionPrecautions: yesNo('infectionPrecautionsRequired'),
    bedRails: yesNo('bedRailsInUseOrConsidered'),
    canSelfEvacuate: yesNo('canSelfEvacuate'),
    acpOffered: single('acpDiscussionOffered'),
    eolRelevant: single('eolRelevant'),
  };
}

export function readSpecialistOverrides(
  metadata: Prisma.JsonValue | null | undefined,
): Record<string, SpecialistOverride> {
  const raw = metaRecord(metadata).tabRelevanceOverrides;
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, SpecialistOverride>)
    : {};
}

/** Worksheet specialist tabs → the promoted assessment key that proves completion. */
const SPECIALIST_WORKSHEET_KEYS: Readonly<Record<number, string>> = {
  [SPECIALIST_TAB_IDS.pain]: 'pain-tool',
  [SPECIALIST_TAB_IDS.must]: 'must',
  [SPECIALIST_TAB_IDS.skin]: 'skin-integrity',
  [SPECIALIST_TAB_IDS.waterlow]: 'waterlow',
  [SPECIALIST_TAB_IDS.falls]: 'falls-screening',
  [SPECIALIST_TAB_IDS.movingHandling]: 'moving-handling',
  [SPECIALIST_TAB_IDS.equipment]: 'equipment-selection',
  [SPECIALIST_TAB_IDS.acp]: 'advance-care-planning',
  [SPECIALIST_TAB_IDS.eol]: 'end-of-life-assessment',
  [SPECIALIST_TAB_IDS.mcaChecklist]: 'mental-capacity-checklist',
};

/**
 * Skippable submit blocks for Required specialist worksheets that are not complete. Question-based
 * specialist tabs (fire, infection, bed rails, PEEP, MCA screening) already raise "Required:" blocks
 * for their own questions. Mirrors careflow-admin submit-validation.
 */
export function specialistRequiredIssues(params: {
  questions: QuestionRow[];
  answers: AnswerRow[];
  metadata: Prisma.JsonValue | null | undefined;
}): Array<{ tabId: number; message: string; relevance: SpecialistRelevance }> {
  const inputs = specialistInputsFromSubmission(params);
  const overrides = readSpecialistOverrides(params.metadata);
  const completed = new Set(
    buildIaAssessmentCompletions(params).map((c) => c.assessmentKey),
  );
  const out: Array<{
    tabId: number;
    message: string;
    relevance: SpecialistRelevance;
  }> = [];
  for (const [tabIdText, title] of Object.entries(
    SPECIALIST_WORKSHEET_TITLES,
  )) {
    const tabId = Number(tabIdText);
    const computed = specialistRelevanceFromInputs(tabId, inputs);
    if (!computed) continue;
    const relevance = applySpecialistOverride(computed, overrides[tabIdText]);
    if (
      relevance.status !== 'required' ||
      completed.has(SPECIALIST_WORKSHEET_KEYS[tabId])
    )
      continue;
    out.push({
      tabId,
      message: specialistRequiredMessage(title, relevance.reasons),
      relevance,
    });
  }
  return out;
}
