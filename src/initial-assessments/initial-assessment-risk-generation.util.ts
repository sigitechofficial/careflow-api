import {
  InitialAssessmentRiskLevel,
  InitialAssessmentRiskType,
  Prisma,
} from '@prisma/client';
import { waterlowScoreFromMetadata } from './initial-assessment-waterlow.util';

export type RiskRecordDraft = {
  riskType: InitialAssessmentRiskType;
  description: string;
  likelihood: InitialAssessmentRiskLevel;
  severity: InitialAssessmentRiskLevel;
  riskLevel: InitialAssessmentRiskLevel;
  sourceSectionNumber?: number;
  sourceQuestionId?: string;
  sourceQuestionText?: string;
  reviewDate: Date;
};

type QuestionRow = {
  id: string;
  questionText: string;
  riskFlag: boolean;
  carePlanTrigger: boolean;
  metadata: Prisma.JsonValue;
  section: { sectionNumber: number };
};

type AnswerRow = {
  questionId: string;
  checked: boolean | null;
  booleanValue: boolean | null;
  riskFlag: boolean;
};

const LEVEL_SCORE: Record<InitialAssessmentRiskLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

export function calculateRiskLevel(
  likelihood: InitialAssessmentRiskLevel,
  severity: InitialAssessmentRiskLevel,
): InitialAssessmentRiskLevel {
  const score = LEVEL_SCORE[likelihood] * LEVEL_SCORE[severity];
  if (score >= 6) return InitialAssessmentRiskLevel.HIGH;
  if (score >= 3) return InitialAssessmentRiskLevel.MEDIUM;
  return InitialAssessmentRiskLevel.LOW;
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

function isPositiveAnswer(answer?: AnswerRow): boolean {
  return answer?.checked === true || answer?.booleanValue === true || answer?.riskFlag === true;
}

function inferRiskType(q: QuestionRow): InitialAssessmentRiskType {
  const text = q.questionText.toLowerCase();
  if (text.includes('fall') || text.includes('trip')) return InitialAssessmentRiskType.FALLS;
  if (text.includes('medication') || text.includes('emar')) return InitialAssessmentRiskType.MEDICATION;
  if (text.includes('skin') || text.includes('pressure') || text.includes('wound')) {
    return InitialAssessmentRiskType.SKIN_INTEGRITY;
  }
  if (text.includes('chok') || text.includes('swallow')) return InitialAssessmentRiskType.CHOKING;
  if (text.includes('nutrition') || text.includes('malnourish') || text.includes('weight loss')) {
    return InitialAssessmentRiskType.NUTRITION;
  }
  if (text.includes('hydration') || text.includes('fluid')) return InitialAssessmentRiskType.HYDRATION;
  if (text.includes('fire') || text.includes('smoke alarm')) return InitialAssessmentRiskType.FIRE;
  if (text.includes('safeguard') || text.includes('abuse')) return InitialAssessmentRiskType.SAFEGUARDING;
  if (text.includes('lone worker') || text.includes('staff safety') || text.includes('aggression')) {
    return InitialAssessmentRiskType.LONE_WORKER;
  }
  if (text.includes('infection') || text.includes('mrsa')) return InitialAssessmentRiskType.INFECTION_CONTROL;
  if (text.includes('hoist') || text.includes('transfer') || text.includes('handling')) {
    return InitialAssessmentRiskType.MOVING_HANDLING;
  }
  if (text.includes('finance') || text.includes('money')) return InitialAssessmentRiskType.FINANCE;
  if (text.includes('hoard') || text.includes('environment') || text.includes('hazard')) {
    return InitialAssessmentRiskType.HOME_ENVIRONMENT;
  }
  return InitialAssessmentRiskType.OTHER;
}

function likelihoodFor(q: QuestionRow, riskType: InitialAssessmentRiskType): InitialAssessmentRiskLevel {
  if (riskType === InitialAssessmentRiskType.SAFEGUARDING) return InitialAssessmentRiskLevel.HIGH;
  if (q.riskFlag) return InitialAssessmentRiskLevel.MEDIUM;
  return InitialAssessmentRiskLevel.LOW;
}

function severityFor(q: QuestionRow, riskType: InitialAssessmentRiskType): InitialAssessmentRiskLevel {
  if (riskType === InitialAssessmentRiskType.SAFEGUARDING || riskType === InitialAssessmentRiskType.FIRE) {
    return InitialAssessmentRiskLevel.HIGH;
  }
  if (q.riskFlag) return InitialAssessmentRiskLevel.MEDIUM;
  return InitialAssessmentRiskLevel.LOW;
}

function reviewDaysFor(level: InitialAssessmentRiskLevel): number {
  switch (level) {
    case InitialAssessmentRiskLevel.HIGH:
      return 14;
    case InitialAssessmentRiskLevel.MEDIUM:
      return 30;
    default:
      return 90;
  }
}

export function buildAutoRiskRecordsFromSubmission(params: {
  questions: QuestionRow[];
  answers: AnswerRow[];
  metadata: Prisma.JsonValue;
}): RiskRecordDraft[] {
  const answerMap = new Map(params.answers.map(a => [a.questionId, a]));
  const drafts: RiskRecordDraft[] = [];
  const now = new Date();

  for (const q of params.questions) {
    const answer = answerMap.get(q.id);
    if (!isPositiveAnswer(answer)) continue;
    if (!q.riskFlag && !answer?.riskFlag) continue;

    const riskType = inferRiskType(q);
    const likelihood = likelihoodFor(q, riskType);
    const severity = severityFor(q, riskType);
    const riskLevel = calculateRiskLevel(likelihood, severity);

    drafts.push({
      riskType,
      description: q.questionText,
      likelihood,
      severity,
      riskLevel,
      sourceSectionNumber: q.section.sectionNumber,
      sourceQuestionId: q.id,
      sourceQuestionText: q.questionText,
      reviewDate: addDays(now, reviewDaysFor(riskLevel)),
    });
  }

  const total = waterlowScoreFromMetadata(params.metadata);
  if (total >= 15) {
    const likelihood = total >= 20 ? InitialAssessmentRiskLevel.HIGH : InitialAssessmentRiskLevel.MEDIUM;
    const severity = total >= 20 ? InitialAssessmentRiskLevel.HIGH : InitialAssessmentRiskLevel.MEDIUM;
    drafts.push({
      riskType: InitialAssessmentRiskType.SKIN_INTEGRITY,
      description: `Waterlow score ${total} — pressure injury risk`,
      likelihood,
      severity,
      riskLevel: calculateRiskLevel(likelihood, severity),
      sourceSectionNumber: 11,
      reviewDate: addDays(now, reviewDaysFor(calculateRiskLevel(likelihood, severity))),
    });
  }

  return drafts;
}
