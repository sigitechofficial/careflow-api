import {
  InitialAssessmentRiskLevel,
  InitialAssessmentRiskType,
  Prisma,
} from '@prisma/client';
import type { RiskRecordDraft } from './initial-assessment-risk-generation.util';
import {
  addDays,
  calculateRiskLevel,
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

export type AxisWeight = 'high' | 'medium' | 'low';

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
 * Lone-worker risk is placed on the same Likelihood × Severity matrix (§13.7) as
 * all other IA risks: each present factor contributes to a LIKELIHOOD axis (how
 * likely an incident is) and/or a SEVERITY axis (how bad / how hard to get help).
 * Each axis is rated by its worst contributing factor, then
 * calculateRiskLevel(likelihood, severity) decides Low/Med/High
 * (product >= 6 High, 3-5 Medium, < 3 Low).
 *
 * Keys MUST match the factor ids + LONE_WORKER_FACTOR_WEIGHT mirror in
 * careflow-admin/.../utils/environment-assessment.ts. Keep in sync.
 */
const LIKELIHOOD_WEIGHT: Record<string, AxisWeight> = {
  aggression: 'high',
  physicalViolence: 'high',
  refusedCare: 'high',
  previousSosEvent: 'high',
  pastSafeguardingIncident: 'high',
  verbalAbuse: 'medium',
  unpredictable: 'medium',
  mentalHealthRisk: 'medium',
  substanceMisuse: 'medium',
  othersPresentRisk: 'medium',
  previousCarerComplaints: 'medium',
  unsafeArea: 'medium',
  dementiaBehaviour: 'low',
  newServiceUser: 'low',
};

const SEVERITY_WEIGHT: Record<string, AxisWeight> = {
  physicalViolence: 'high',
  pastSafeguardingIncident: 'high',
  previousSosEvent: 'high',
  noMobileSignal: 'high',
  aggression: 'medium',
  refusedCare: 'medium',
  mentalHealthRisk: 'medium',
  substanceMisuse: 'medium',
  othersPresentRisk: 'medium',
  isolatedProperty: 'medium',
  unsafeArea: 'medium',
  carerWorksAlone: 'medium',
  nightVisits: 'medium',
  unsafeMovingHandlingAlone: 'medium',
  twoCarerRecommended: 'medium',
  poorLightingAccess: 'low',
  longDurationVisits: 'low',
  newServiceUser: 'low',
  verbalAbuse: 'low',
  unpredictable: 'low',
  dementiaBehaviour: 'low',
};

/** Human labels for the env snapshot factors (used in the risk description). */
const ENV_FACTOR_LABELS: Record<string, string> = {
  aggression: 'aggression towards carers',
  verbalAbuse: 'verbal abuse / threats towards staff',
  physicalViolence: 'history of physical violence',
  unpredictable: 'unpredictable / challenging behaviour towards staff',
  dementiaBehaviour: 'confusion leading to behaviour that could put staff at risk',
  mentalHealthRisk: 'current or recent risk to staff linked to mental state',
  substanceMisuse: 'alcohol / drug use in the home affecting staff safety',
  refusedCare: 'carers prevented from leaving / exit blocked',
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
  unsafeMovingHandlingAlone: 'moving & handling needs two carers',
  twoCarerRecommended: 'two-carer (double-up) visit recommended to the manager',
};

/** Control fields stored in the Environment Assessment snapshot (Staff Only). */
const CONTROL_IDENTIFIED_KEY = 'loneWorkerRiskIdentified';
const CONTROL_LEVEL_KEY = 'loneWorkerRiskLevel';

function asObject(value: Prisma.JsonValue | undefined | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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

/** Rate one axis by the worst intensity among the present factors (else LOW). */
function axisLevel(
  presentKeys: Set<string>,
  weights: Record<string, AxisWeight>,
): InitialAssessmentRiskLevel {
  let hasMedium = false;
  for (const key of presentKeys) {
    const w = weights[key];
    if (w === 'high') return InitialAssessmentRiskLevel.HIGH;
    if (w === 'medium') hasMedium = true;
  }
  return hasMedium ? InitialAssessmentRiskLevel.MEDIUM : InitialAssessmentRiskLevel.LOW;
}

/** Likelihood/severity pair that reproduces a chosen level on the matrix. */
function axesForLevel(level: InitialAssessmentRiskLevel): {
  likelihood: InitialAssessmentRiskLevel;
  severity: InitialAssessmentRiskLevel;
} {
  if (level === InitialAssessmentRiskLevel.HIGH)
    return { likelihood: InitialAssessmentRiskLevel.HIGH, severity: InitialAssessmentRiskLevel.HIGH };
  if (level === InitialAssessmentRiskLevel.MEDIUM)
    return { likelihood: InitialAssessmentRiskLevel.MEDIUM, severity: InitialAssessmentRiskLevel.MEDIUM };
  return { likelihood: InitialAssessmentRiskLevel.LOW, severity: InitialAssessmentRiskLevel.MEDIUM };
}

/**
 * Build the aggregated lone-worker risk draft, or null when there is no evidence
 * and the risk has not been explicitly flagged by staff.
 *
 * Placed on the Likelihood × Severity matrix (§13.7): likelihood and severity are
 * each rated by their worst present factor, then calculateRiskLevel decides the
 * level. A manual control level overrides; the explicit "risk identified" flag
 * forces a risk to exist.
 */
export function buildLoneWorkerRiskDraft(params: {
  questions: QuestionRow[];
  answers: AnswerRow[];
  metadata: Prisma.JsonValue;
  now?: Date;
  riskReviewDays?: Parameters<typeof reviewDaysFor>[1];
}): RiskRecordDraft | null {
  const now = params.now ?? new Date();
  const answerMap = new Map(params.answers.map((a) => [a.questionId, a]));

  const presentKeys = new Set<string>();
  const labels: string[] = [];

  // (1) DB tagged factor questions (legacy path; none exist after consolidation).
  for (const q of params.questions) {
    if (!isLoneWorkerFactorQuestion(q)) continue;
    if (!isPositiveAnswer(answerMap.get(q.id))) continue;
    labels.push(q.questionText);
  }

  // (2) Environment Assessment snapshot factor booleans (the 22 factors).
  const meta = asObject(params.metadata);
  const env = asObject(meta?.environmentAssessment as Prisma.JsonValue | undefined);
  for (const key of Object.keys(ENV_FACTOR_LABELS)) {
    if (env?.[key] === true) {
      presentKeys.add(key);
      labels.push(ENV_FACTOR_LABELS[key] ?? key);
    }
  }

  // (3) Staff-Only control fields.
  const identified = env?.[CONTROL_IDENTIFIED_KEY] === true;
  const manualLevel = parseManualLevel(env?.[CONTROL_LEVEL_KEY]);

  const hasFactors = presentKeys.size > 0 || labels.length > 0;

  // No evidence and not flagged → no risk.
  if (!hasFactors && !identified) return null;

  let likelihood: InitialAssessmentRiskLevel;
  let severity: InitialAssessmentRiskLevel;
  let level: InitialAssessmentRiskLevel;

  if (manualLevel) {
    // Assessor override — reflect it on the matrix cell too.
    ({ likelihood, severity } = axesForLevel(manualLevel));
    level = manualLevel;
  } else if (hasFactors) {
    likelihood = axisLevel(presentKeys, LIKELIHOOD_WEIGHT);
    severity = axisLevel(presentKeys, SEVERITY_WEIGHT);
    // Working alone + out-of-hours makes help harder to reach → escalate severity.
    if (env?.carerWorksAlone === true && env?.nightVisits === true) {
      severity = InitialAssessmentRiskLevel.HIGH;
    }
    level = calculateRiskLevel(likelihood, severity);
  } else {
    // Flagged with no factors — default to a Medium matrix cell.
    ({ likelihood, severity } = axesForLevel(InitialAssessmentRiskLevel.MEDIUM));
    level = InitialAssessmentRiskLevel.MEDIUM;
  }

  const description =
    labels.length > 0
      ? `Lone worker / staff safety risk — contributing factors: ${labels.join('; ')}.`
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
    reviewDate: addDays(now, reviewDaysFor(level, params.riskReviewDays)),
  };
}

export type LoneWorkerBriefingFactor = { label: string; detail: string | null };

/**
 * Presentation bits for the carer-app visit briefing: the Yes factors (with any
 * "Risk Details / Notes") and the "Control Measures / Safety Actions", read from
 * the Environment Assessment snapshot. Level itself comes from the risk record.
 */
export function extractLoneWorkerBriefing(metadata: Prisma.JsonValue): {
  factors: LoneWorkerBriefingFactor[];
  controlMeasures: string | null;
} {
  const meta = asObject(metadata);
  const env = asObject(meta?.environmentAssessment as Prisma.JsonValue | undefined);
  const factors: LoneWorkerBriefingFactor[] = [];
  if (env) {
    for (const key of Object.keys(ENV_FACTOR_LABELS)) {
      if (env[key] !== true) continue;
      const raw = env[`${key}Details`];
      const detail = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      factors.push({ label: ENV_FACTOR_LABELS[key] ?? key, detail });
    }
  }
  const ctrlRaw = env?.staffSafetyInstructions;
  const controlMeasures =
    typeof ctrlRaw === 'string' && ctrlRaw.trim() ? ctrlRaw.trim() : null;
  return { factors, controlMeasures };
}
