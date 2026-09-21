import {
  InitialAssessmentRiskLevel,
  InitialAssessmentRiskType,
  Prisma,
} from '@prisma/client';
import type { RiskRecordDraft } from './initial-assessment-risk-generation.util';
import {
  addDays,
  isLoneWorkerFactorQuestion,
  isPositiveAnswer,
  reviewDaysFor,
} from './initial-assessment-risk-generation.util';

/**
 * Lone Worker / Staff Safety risk — aggregated auto-detection.
 *
 * Lone-worker risk is not a single question: it is scored from many factors that
 * live in two places —
 *   1. DB template questions tagged `metadata.loneWorkerFactor: true` with a
 *      `metadata.loneWorkerWeight` of 'high' | 'medium' | 'minor'
 *      (e.g. behaviour / medical-history factors in Personal Details), and
 *   2. Environment Assessment tool-snapshot booleans
 *      (`submission.metadata.environmentAssessment`).
 *
 * This util reads both, scores an overall Low/Med/High, and returns ONE
 * aggregated `LONE_WORKER` risk draft (or null). The per-question engine in
 * initial-assessment-risk-generation.util.ts skips the tagged questions so they
 * are never double-counted.
 */

export type LoneWorkerWeight = 'high' | 'medium' | 'minor';

type QuestionRow = {
  id: string;
  questionText: string;
  metadata: Prisma.JsonValue;
  section: { sectionNumber: number };
};

type AnswerRow = {
  questionId: string;
  checked: boolean | null;
  booleanValue: boolean | null;
  riskFlag: boolean;
  selectedOptions?: Prisma.JsonValue;
};

/**
 * Environment Assessment snapshot factor keys → weight. These keys are written by
 * the admin Environment Assessment panel
 * (careflow-admin/.../utils/environment-assessment.ts). Keep in sync.
 */
const ENV_FACTOR_WEIGHTS: Record<string, LoneWorkerWeight> = {
  isolatedProperty: 'minor',
  poorLightingAccess: 'minor',
  unsafeArea: 'medium',
  noMobileSignal: 'medium',
  othersPresentRisk: 'medium',
  carerWorksAlone: 'medium',
  nightVisits: 'medium',
  longDurationVisits: 'minor',
  newServiceUser: 'minor',
  pastSafeguardingIncident: 'high',
  previousCarerComplaints: 'medium',
  previousSosEvent: 'high',
  unsafeMovingHandlingAlone: 'medium',
  twoCarerRecommended: 'medium',
};

/** Human labels for the env snapshot factors (used in the risk description). */
const ENV_FACTOR_LABELS: Record<string, string> = {
  isolatedProperty: 'isolated / remote property',
  poorLightingAccess: 'poor lighting or difficult access',
  unsafeArea: 'unsafe area / neighbourhood',
  noMobileSignal: 'no reliable mobile signal',
  othersPresentRisk: 'another person present who may pose a risk',
  carerWorksAlone: 'carer works alone',
  nightVisits: 'night / early / late visits',
  longDurationVisits: 'long-duration visits',
  newServiceUser: 'new service user / first visits',
  pastSafeguardingIncident: 'past safeguarding incident involving staff',
  previousCarerComplaints: 'previous carer complaints / concerns',
  previousSosEvent: 'previous SOS / emergency event',
  unsafeMovingHandlingAlone: 'moving & handling unsafe alone',
  twoCarerRecommended: 'two-carer (double-up) recommended',
};

/** Control fields stored in the Environment Assessment snapshot (Staff Only). */
const CONTROL_IDENTIFIED_KEY = 'loneWorkerRiskIdentified';
const CONTROL_LEVEL_KEY = 'loneWorkerRiskLevel';

type Contribution = { weight: LoneWorkerWeight; label: string };

function asObject(value: Prisma.JsonValue | undefined | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function factorWeight(metadata: Prisma.JsonValue): LoneWorkerWeight | null {
  const m = asObject(metadata);
  const w = m?.loneWorkerWeight;
  return w === 'high' || w === 'medium' || w === 'minor' ? w : null;
}

/** Map a manual 'Low' | 'Med' | 'High' control value to the enum, if valid. */
function parseManualLevel(value: unknown): InitialAssessmentRiskLevel | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'high') return InitialAssessmentRiskLevel.HIGH;
  if (v === 'med' || v === 'medium') return InitialAssessmentRiskLevel.MEDIUM;
  if (v === 'low') return InitialAssessmentRiskLevel.LOW;
  return null;
}

function levelFromScore(contributions: Contribution[], aloneAtNight: boolean): InitialAssessmentRiskLevel | null {
  if (contributions.length === 0) return null;
  const high = contributions.filter((c) => c.weight === 'high').length;
  const medium = contributions.filter((c) => c.weight === 'medium').length;
  if (high >= 1 || aloneAtNight) return InitialAssessmentRiskLevel.HIGH;
  if (medium >= 2) return InitialAssessmentRiskLevel.MEDIUM;
  return InitialAssessmentRiskLevel.LOW;
}

function likelihoodSeverityFor(level: InitialAssessmentRiskLevel): {
  likelihood: InitialAssessmentRiskLevel;
  severity: InitialAssessmentRiskLevel;
} {
  switch (level) {
    case InitialAssessmentRiskLevel.HIGH:
      return { likelihood: InitialAssessmentRiskLevel.HIGH, severity: InitialAssessmentRiskLevel.HIGH };
    case InitialAssessmentRiskLevel.MEDIUM:
      return { likelihood: InitialAssessmentRiskLevel.MEDIUM, severity: InitialAssessmentRiskLevel.MEDIUM };
    default:
      return { likelihood: InitialAssessmentRiskLevel.LOW, severity: InitialAssessmentRiskLevel.MEDIUM };
  }
}

/**
 * Build the aggregated lone-worker risk draft, or null when there is no evidence
 * and the risk has not been explicitly flagged by staff.
 */
export function buildLoneWorkerRiskDraft(params: {
  questions: QuestionRow[];
  answers: AnswerRow[];
  metadata: Prisma.JsonValue;
  now?: Date;
}): RiskRecordDraft | null {
  const now = params.now ?? new Date();
  const answerMap = new Map(params.answers.map((a) => [a.questionId, a]));
  const contributions: Contribution[] = [];

  // (1) DB tagged factor questions (positive answer = present).
  for (const q of params.questions) {
    if (!isLoneWorkerFactorQuestion(q)) continue;
    if (!isPositiveAnswer(answerMap.get(q.id))) continue;
    const weight = factorWeight(q.metadata) ?? 'medium';
    contributions.push({ weight, label: q.questionText });
  }

  // (2) Environment Assessment snapshot factor booleans.
  const meta = asObject(params.metadata);
  const env = asObject(meta?.environmentAssessment as Prisma.JsonValue | undefined);
  for (const [key, weight] of Object.entries(ENV_FACTOR_WEIGHTS)) {
    if (env?.[key] === true) {
      contributions.push({ weight, label: ENV_FACTOR_LABELS[key] ?? key });
    }
  }

  // Special combo: working alone + out-of-hours visits → High.
  const aloneAtNight = env?.carerWorksAlone === true && env?.nightVisits === true;

  // (3) Staff-Only control fields.
  const identified = env?.[CONTROL_IDENTIFIED_KEY] === true;
  const manualLevel = parseManualLevel(env?.[CONTROL_LEVEL_KEY]);

  const computed = levelFromScore(contributions, aloneAtNight);

  // No evidence and not flagged → no risk.
  if (computed === null && !identified) return null;

  // Manual level always wins; otherwise the computed level; otherwise (flagged
  // with no evidence) default to MEDIUM.
  const level = manualLevel ?? computed ?? InitialAssessmentRiskLevel.MEDIUM;
  const { likelihood, severity } = likelihoodSeverityFor(level);

  const factorList = contributions.map((c) => c.label);
  const description =
    factorList.length > 0
      ? `Lone worker / staff safety risk — contributing factors: ${factorList.join('; ')}.`
      : 'Lone worker / staff safety risk identified by assessor.';

  return {
    riskType: InitialAssessmentRiskType.LONE_WORKER,
    description,
    likelihood,
    severity,
    riskLevel: level,
    // Aggregated across sections — no single source question.
    sourceSectionNumber: undefined,
    sourceQuestionId: undefined,
    sourceQuestionText: undefined,
    reviewDate: addDays(now, reviewDaysFor(level)),
  };
}
