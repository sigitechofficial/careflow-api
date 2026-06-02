import {
  InitialAssessmentActionPriority,
  InitialAssessmentActionType,
  Prisma,
} from '@prisma/client';
import { waterlowScoreFromMetadata } from './initial-assessment-waterlow.util';

export type ActionDraft = {
  title: string;
  actionType: InitialAssessmentActionType;
  priority: InitialAssessmentActionPriority;
  sourceSectionNumber?: number;
  sourceQuestionId?: string;
  sourceQuestionText?: string;
  dueDate: Date;
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
};

function specRefOf(q: QuestionRow): string | undefined {
  if (!q.metadata || typeof q.metadata !== 'object' || Array.isArray(q.metadata)) return undefined;
  const ref = (q.metadata as Record<string, unknown>).specRef;
  return typeof ref === 'string' ? ref : undefined;
}

function isYes(answer?: AnswerRow): boolean {
  return answer?.checked === true || answer?.booleanValue === true;
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

function inferActionType(q: QuestionRow): InitialAssessmentActionType {
  const text = q.questionText.toLowerCase();
  const ref = specRefOf(q) ?? '';
  const meta =
    q.metadata && typeof q.metadata === 'object' && !Array.isArray(q.metadata)
      ? (q.metadata as Record<string, unknown>)
      : null;

  if (meta?.emarModule === true || (ref === '9.6' && text.includes('emar'))) {
    return InitialAssessmentActionType.EMAR_SETUP;
  }
  if (ref.startsWith('13.1') || text.includes('safeguarding')) return InitialAssessmentActionType.SAFEGUARDING_REFERRAL;
  if (text.includes('mca') || ref === '2.5') return InitialAssessmentActionType.MCA_ASSESSMENT;
  if (text.includes('salt') || text.includes('swallowing')) return InitialAssessmentActionType.SALT_REFERRAL;
  if (text.includes('dietitian') || text.includes('nutrition') || text.includes('malnourish')) {
    return InitialAssessmentActionType.DIETITIAN_REFERRAL;
  }
  if (text.includes('continence')) return InitialAssessmentActionType.CONTINENCE_REFERRAL;
  if (text.includes('fall')) return InitialAssessmentActionType.FALLS_ASSESSMENT;
  if (text.includes('fire')) return InitialAssessmentActionType.FIRE_SAFETY_FOLLOW_UP;
  if (text.includes('equipment') || text.includes('hoist') || text.includes('mattress')) {
    return InitialAssessmentActionType.EQUIPMENT_ORDER;
  }
  if (text.includes('wound') || text.includes('ulcer') || text.includes('pressure')) {
    return InitialAssessmentActionType.WOUND_ASSESSMENT;
  }
  if (text.includes('medication') || text.includes('emar')) return InitialAssessmentActionType.MEDICATION_VERIFICATION;
  if (text.includes('gp')) return InitialAssessmentActionType.GP_REVIEW;
  return InitialAssessmentActionType.OTHER;
}

function priorityFor(q: QuestionRow, actionType: InitialAssessmentActionType): InitialAssessmentActionPriority {
  if (actionType === InitialAssessmentActionType.SAFEGUARDING_REFERRAL) {
    return InitialAssessmentActionPriority.URGENT;
  }
  if (q.riskFlag || actionType === InitialAssessmentActionType.FALLS_ASSESSMENT) {
    return InitialAssessmentActionPriority.HIGH;
  }
  if (q.carePlanTrigger) return InitialAssessmentActionPriority.MEDIUM;
  return InitialAssessmentActionPriority.LOW;
}

function dueDaysFor(priority: InitialAssessmentActionPriority): number {
  switch (priority) {
    case InitialAssessmentActionPriority.URGENT:
      return 1;
    case InitialAssessmentActionPriority.HIGH:
      return 7;
    case InitialAssessmentActionPriority.MEDIUM:
      return 14;
    default:
      return 28;
  }
}

function actionTitle(q: QuestionRow, actionType: InitialAssessmentActionType): string {
  const labels: Partial<Record<InitialAssessmentActionType, string>> = {
    [InitialAssessmentActionType.SAFEGUARDING_REFERRAL]: 'Safeguarding referral',
    [InitialAssessmentActionType.MCA_ASSESSMENT]: 'MCA assessment',
    [InitialAssessmentActionType.SALT_REFERRAL]: 'SALT referral',
    [InitialAssessmentActionType.DIETITIAN_REFERRAL]: 'Dietitian referral',
    [InitialAssessmentActionType.CONTINENCE_REFERRAL]: 'Continence service referral',
    [InitialAssessmentActionType.FALLS_ASSESSMENT]: 'Falls assessment follow-up',
    [InitialAssessmentActionType.FIRE_SAFETY_FOLLOW_UP]: 'Fire safety follow-up',
    [InitialAssessmentActionType.EQUIPMENT_ORDER]: 'Equipment order / review',
    [InitialAssessmentActionType.WOUND_ASSESSMENT]: 'Wound / pressure care review',
    [InitialAssessmentActionType.MEDICATION_VERIFICATION]: 'Medication verification',
    [InitialAssessmentActionType.EMAR_SETUP]: 'Configure eMAR / MAR chart',
    [InitialAssessmentActionType.GP_REVIEW]: 'GP review',
    [InitialAssessmentActionType.MANAGER_REVIEW]: 'Manager review',
  };
  return labels[actionType] ?? `Follow-up: ${q.questionText}`;
}

export function buildAutoActionsFromSubmission(params: {
  questions: QuestionRow[];
  answers: AnswerRow[];
  metadata?: Prisma.JsonValue | null;
  now?: Date;
}): ActionDraft[] {
  const { questions, answers, metadata, now = new Date() } = params;
  const map = new Map(answers.map((a) => [a.questionId, a]));
  const drafts: ActionDraft[] = [];
  const seen = new Set<string>();

  for (const q of questions) {
    const answer = map.get(q.id);
    if (!isYes(answer)) continue;

    const ref = specRefOf(q);
    const meta =
      q.metadata && typeof q.metadata === 'object' && !Array.isArray(q.metadata)
        ? (q.metadata as Record<string, unknown>)
        : null;
    const isEmarGate = meta?.emarModule === true || ref === '9.6';

    if (!q.riskFlag && !q.carePlanTrigger) {
      if (ref !== '2.5' && ref !== '13.1' && !isEmarGate) continue;
    }

    const actionType = inferActionType(q);
    const priority = priorityFor(q, actionType);
    const key = `${q.id}:${actionType}`;
    if (seen.has(key)) continue;
    seen.add(key);

    drafts.push({
      title: actionTitle(q, actionType),
      actionType,
      priority,
      sourceSectionNumber: q.section.sectionNumber,
      sourceQuestionId: q.id,
      sourceQuestionText: q.questionText,
      dueDate: addDays(now, dueDaysFor(priority)),
    });
  }

  const score = waterlowScoreFromMetadata(metadata);

  if (score >= 10) {
    drafts.push({
      title: 'Waterlow 10+ — pressure ulcer prevention plan',
      actionType: InitialAssessmentActionType.WOUND_ASSESSMENT,
      priority: InitialAssessmentActionPriority.HIGH,
      sourceSectionNumber: 11,
      dueDate: addDays(now, 7),
    });
  }

  if (score >= 20) {
    drafts.push({
      title: 'Manager review — very high Waterlow score',
      actionType: InitialAssessmentActionType.MANAGER_REVIEW,
      priority: InitialAssessmentActionPriority.URGENT,
      sourceSectionNumber: 11,
      dueDate: addDays(now, 1),
    });
  }

  return drafts;
}
