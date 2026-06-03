import { Prisma } from '@prisma/client';
import { InitialAssessmentStatus as PrismaStatus } from '@prisma/client';
import {
  getInitialAssessmentAgencySettings,
  type InitialAssessmentAgencySettings,
} from './initial-assessment-agency-settings.util';
import { buildFallsAssessmentSnapshot } from './initial-assessment-clinical.util';
import { shouldShowQuestionForValidation } from './initial-assessment-conditional-visibility.util';
import { adlWorksheetRowsComplete } from './initial-assessment-adl.util';
import { waterlowScoreFromMetadata } from './initial-assessment-waterlow.util';

export { waterlowScoreFromMetadata } from './initial-assessment-waterlow.util';

export type ValidationIssue = {
  message: string;
  sectionNumber: number;
  blocking: boolean;
};

/** Missing answers / worksheets — allowed when user confirms incomplete submit. */
export function isSkippableIncompleteValidationMessage(message: string): boolean {
  if (message.startsWith('Required: ')) return true;
  if (message.startsWith('Assessor sign-off required:')) return true;
  if (message.includes('Next review date is required')) return true;
  if (message.includes('ADL dependency scores incomplete')) return true;
  if (message.includes('Complete the Waterlow assessment')) return true;
  if (message.includes('Falls trigger assessment') || message.includes('Falls assessment')) return true;
  if (message.includes('Mobility aids')) return true;
  if (message.includes('Emergency contact 1 not recorded')) return true;
  return false;
}

export function partitionSubmitValidationBlocks(blocks: ValidationIssue[]) {
  const hardBlocks = blocks.filter((b) => !isSkippableIncompleteValidationMessage(b.message));
  const skippableBlocks = blocks.filter((b) => isSkippableIncompleteValidationMessage(b.message));
  return { hardBlocks, skippableBlocks };
}

type QuestionRow = {
  id: string;
  questionText: string;
  questionType: string;
  isRequired: boolean;
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

const EDITABLE: PrismaStatus[] = [PrismaStatus.DRAFT, PrismaStatus.IN_PROGRESS];

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

function findByFieldKey(questions: QuestionRow[], fieldKey: string): QuestionRow | undefined {
  return questions.find((q) => fieldKeyOf(q) === fieldKey);
}

function findByQuestionTextIncludes(questions: QuestionRow[], fragment: string): QuestionRow | undefined {
  const needle = fragment.toLowerCase();
  return questions.find((q) => q.questionText.toLowerCase().includes(needle));
}

function findBySpecRefAndText(questions: QuestionRow[], specRef: string, fragment: string): QuestionRow | undefined {
  const needle = fragment.toLowerCase();
  return questions.find((q) => specRefOf(q) === specRef && q.questionText.toLowerCase().includes(needle));
}

function findBySpecRef(questions: QuestionRow[], ref: string): QuestionRow | undefined {
  return questions.find((q) => specRefOf(q) === ref);
}

function answerFor(map: Map<string, AnswerRow>, questionId: string): AnswerRow | undefined {
  return map.get(questionId);
}

function isYes(map: Map<string, AnswerRow>, q?: QuestionRow): boolean {
  if (!q) return false;
  const a = answerFor(map, q.id);
  return a?.checked === true || a?.booleanValue === true;
}

function isExplicitNo(map: Map<string, AnswerRow>, q?: QuestionRow): boolean {
  if (!q) return false;
  const a = answerFor(map, q.id);
  return a?.checked === false || a?.booleanValue === false;
}

function isAnswered(
  q: { questionType: string },
  answer?: AnswerRow,
): boolean {
  if (!answer) return false;
  if (q.questionType === 'CHECKBOX' || q.questionType === 'YES_NO') {
    return typeof answer.checked === 'boolean' || typeof answer.booleanValue === 'boolean';
  }
  if (answer.textValue?.trim()) return true;
  if (answer.numberValue != null) return true;
  if (answer.dateValue) return true;
  if (answer.timeValue?.trim()) return true;
  if (answer.selectedOptions != null) {
    if (Array.isArray(answer.selectedOptions) && answer.selectedOptions.length > 0) return true;
    if (typeof answer.selectedOptions === 'string' && answer.selectedOptions.length > 0) return true;
    if (typeof answer.selectedOptions === 'object' && !Array.isArray(answer.selectedOptions)) {
      const rows = answer.selectedOptions as Record<string, { selected?: boolean }>;
      if (Object.values(rows).some((row) => row?.selected === true)) return true;
    }
  }
  return false;
}

function sectionPercent(questions: QuestionRow[], map: Map<string, AnswerRow>, sectionNumber: number): number {
  const secQs = questions.filter((q) => q.section.sectionNumber === sectionNumber);
  if (secQs.length === 0) return 0;
  const answered = secQs.filter((q) => isAnswered(q, answerFor(map, q.id))).length;
  return Math.round((answered / secQs.length) * 100);
}

function hasTextAnswer(answer?: AnswerRow): boolean {
  return Boolean(answer?.textValue?.trim());
}

function adlRowsComplete(metadata: Prisma.JsonValue | null | undefined): boolean {
  return adlWorksheetRowsComplete(metadata);
}

function dedupe(items: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = `${i.sectionNumber}:${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function validateInitialAssessmentSubmission(params: {
  status: PrismaStatus;
  questions: QuestionRow[];
  answers: AnswerRow[];
  metadata?: Prisma.JsonValue | null;
  agencySettings?: InitialAssessmentAgencySettings;
}): {
  blocks: ValidationIssue[];
  warnings: ValidationIssue[];
  canSubmit: boolean;
  canSubmitIncomplete: boolean;
  overallPercent: number;
} {
  const { status, questions, answers, metadata } = params;
  const agencySettings = params.agencySettings ?? getInitialAssessmentAgencySettings();
  const blocks: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!EDITABLE.includes(status)) {
    return { blocks, warnings, canSubmit: false, canSubmitIncomplete: false, overallPercent: 0 };
  }

  const map = new Map(answers.map((a) => [a.questionId, a]));

  const consentQ = findBySpecRef(questions, '2.1');
  if (consentQ && isExplicitNo(map, consentQ)) {
    blocks.push({
      message: 'Consent to assessment is No — cannot submit (section 2.1)',
      sectionNumber: 2,
      blocking: true,
    });
  }

  const careConsentQ = findBySpecRef(questions, '2.2');
  if (careConsentQ && isExplicitNo(map, careConsentQ)) {
    blocks.push({
      message: 'Consent to receive care is No — cannot submit (section 2.2)',
      sectionNumber: 2,
      blocking: true,
    });
  }

  const capacityQ = findBySpecRef(questions, '2.4');
  const mcaDone = findByQuestionTextIncludes(questions, 'mca completed');
  if (capacityQ && isExplicitNo(map, capacityQ) && (!mcaDone || !isYes(map, mcaDone))) {
    blocks.push({
      message: 'Capacity not intact — MCA must be completed before submit (section 2.4–2.5)',
      sectionNumber: 2,
      blocking: true,
    });
  }

  const mcaReq = questions.find(
    (q) => specRefOf(q) === '2.5' && q.questionText.toLowerCase().includes('mca required'),
  );
  if (mcaReq && isYes(map, mcaReq) && mcaDone && !isYes(map, mcaDone)) {
    blocks.push({
      message: 'MCA required but not completed (section 2.5)',
      sectionNumber: 2,
      blocking: true,
    });
  }

  const emergencyQ = findBySpecRef(questions, '13.3');
  if (emergencyQ && !isYes(map, emergencyQ)) {
    const issue: ValidationIssue = {
      message: 'Emergency contact 1 not recorded (section 13)',
      sectionNumber: 13,
      blocking: agencySettings.blockWithoutEmergencyContact,
    };
    if (agencySettings.blockWithoutEmergencyContact) {
      blocks.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  const noResponseQ = findByQuestionTextIncludes(questions, 'no response procedure');
  if (noResponseQ && isExplicitNo(map, noResponseQ)) {
    const issue: ValidationIssue = {
      message: 'No response procedure not agreed — cannot activate care (section 13.5)',
      sectionNumber: 13,
      blocking: agencySettings.blockWithoutNoResponseProcedure,
    };
    if (agencySettings.blockWithoutNoResponseProcedure) {
      blocks.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  const fallsReportedQ = findBySpecRefAndText(questions, '12.7', 'falls in');
  const fallsAssessedQ = findBySpecRefAndText(questions, '12.7', 'assessment completed');
  const fallsAssessedDateQ = findBySpecRefAndText(questions, '12.7', 'assessment date');
  if (fallsReportedQ && isYes(map, fallsReportedQ) && fallsAssessedQ && !isYes(map, fallsAssessedQ)) {
    blocks.push({
      message: 'Falls reported but falls assessment not completed (section 12.7)',
      sectionNumber: 12,
      blocking: true,
    });
  }
  if (
    fallsAssessedQ &&
    isYes(map, fallsAssessedQ) &&
    fallsAssessedDateQ &&
    !isAnswered(fallsAssessedDateQ, answerFor(map, fallsAssessedDateQ.id))
  ) {
    blocks.push({
      message: 'Falls assessment completed but date is missing (section 12.7)',
      sectionNumber: 12,
      blocking: true,
    });
  }

  const safeguardingQ = findByFieldKey(questions, 'safeguardingConcern') ?? findBySpecRef(questions, '13.1');
  const safeguardingDetailsQ = findByQuestionTextIncludes(questions, 'safeguarding concern details');
  if (safeguardingQ && isYes(map, safeguardingQ)) {
    if (safeguardingDetailsQ && !hasTextAnswer(answerFor(map, safeguardingDetailsQ.id))) {
      blocks.push({
        message: 'Safeguarding concern flagged but details are missing (section 13.1)',
        sectionNumber: 13,
        blocking: true,
      });
    }
    warnings.push({
      message: 'Safeguarding concern flagged — manager review required',
      sectionNumber: 13,
      blocking: false,
    });
  }

  const woundsQ = findByFieldKey(questions, 'hasWounds') ?? findByQuestionTextIncludes(questions, 'currently has ulcers or wounds');
  const woundAssessmentQ = findByQuestionTextIncludes(questions, 'wound assessment been completed');
  if (woundsQ && isYes(map, woundsQ) && woundAssessmentQ && !isYes(map, woundAssessmentQ)) {
    blocks.push({
      message: 'Active wounds recorded but wound assessment not completed (section 11.2)',
      sectionNumber: 11,
      blocking: true,
    });
  }

  const saltReferralReqQ = findByQuestionTextIncludes(questions, 'salt referral required');
  const saltReferralMadeQ = findByQuestionTextIncludes(questions, 'salt referral made');
  if (saltReferralReqQ && isYes(map, saltReferralReqQ) && saltReferralMadeQ && !isYes(map, saltReferralMadeQ)) {
    warnings.push({
      message: 'SALT referral required but not yet made (section 5.4)',
      sectionNumber: 5,
      blocking: false,
    });
  }

  const sgReferralReqQ = findByQuestionTextIncludes(questions, 'local authority safeguarding referral required');
  const sgReferralMadeQ = findByQuestionTextIncludes(questions, 'safeguarding referral made');
  if (sgReferralReqQ && isYes(map, sgReferralReqQ) && sgReferralMadeQ && !isYes(map, sgReferralMadeQ)) {
    warnings.push({
      message: 'Safeguarding referral required but not yet made (section 13.7)',
      sectionNumber: 13,
      blocking: false,
    });
  }

  if (!adlRowsComplete(metadata)) {
    blocks.push({
      message: 'ADL dependency scores incomplete — complete all six activities in section 12 (§12.1–12.6)',
      sectionNumber: 12,
      blocking: true,
    });
  }

  const fallsSnapshot = buildFallsAssessmentSnapshot({ questions, answers, metadata });
  if (fallsSnapshot.riskLevel === 'HIGH') {
    warnings.push({
      message: 'High falls risk score — manager review recommended (section 12.7)',
      sectionNumber: 12,
      blocking: false,
    });
  }
  if (fallsSnapshot.injuryCaused === true) {
    warnings.push({
      message: 'Fall-related injury reported — manager review recommended (section 12.7)',
      sectionNumber: 12,
      blocking: false,
    });
  }

  if (agencySettings.requireAssessorSignOff) {
    for (const fieldKey of ['assessorName', 'assessorRole', 'assessorSignDate'] as const) {
      const q = findByFieldKey(questions, fieldKey);
      if (q && !isAnswered(q, answerFor(map, q.id))) {
        blocks.push({
          message: `Assessor sign-off required: ${q.questionText}`,
          sectionNumber: q.section.sectionNumber,
          blocking: true,
        });
      }
    }
  }

  const nextReviewQ = findByFieldKey(questions, 'nextReviewDate');
  if (agencySettings.requireNextReviewDate && nextReviewQ && !isAnswered(nextReviewQ, answerFor(map, nextReviewQ.id))) {
    blocks.push({
      message: 'Next review date is required (section 14)',
      sectionNumber: 14,
      blocking: true,
    });
  }

  for (const q of questions) {
    if (!q.isRequired) continue;
    if (!shouldShowQuestionForValidation(q, questions, map)) continue;
    if (isAnswered(q, answerFor(map, q.id))) continue;
    blocks.push({
      message: `Required: ${q.questionText}`,
      sectionNumber: q.section.sectionNumber,
      blocking: true,
    });
  }

  const competentQ = questions.find(
    (q) => specRefOf(q) === '4.1' && q.questionText.toLowerCase().includes('competent'),
  );
  const vitalFieldKeys = ['temperature', 'pulse', 'respirations', 'bpSystolic', 'bpDiastolic', 'spo2', 'bloodGlucose'];
  const hasVitals = vitalFieldKeys.some((key) => {
    const q = findByFieldKey(questions, key);
    if (!q) return false;
    const a = answerFor(map, q.id);
    return a?.numberValue != null;
  });
  if (hasVitals) {
    if (competentQ && isExplicitNo(map, competentQ)) {
      blocks.push({
        message:
          'Clinical vital signs were entered but assessor is not marked competent — clear vitals or confirm competency.',
        sectionNumber: 4,
        blocking: true,
      });
    } else if (competentQ && !isYes(map, competentQ)) {
      blocks.push({
        message: 'Confirm assessor competency before recording vital signs.',
        sectionNumber: 4,
        blocking: true,
      });
    }
  }

  const wl = waterlowScoreFromMetadata(metadata);
  const waterlowThreshold = agencySettings.managerReviewWaterlowThreshold;

  if (wl >= waterlowThreshold) {
    warnings.push({
      message: 'High Waterlow score — manager review will be required',
      sectionNumber: 11,
      blocking: false,
    });
  }

  if (wl >= 20) {
    warnings.push({
      message: 'Very high Waterlow score — escalate to clinical lead',
      sectionNumber: 11,
      blocking: false,
    });
  }

  const loneWorkerQ = findByQuestionTextIncludes(questions, 'lone worker risk');
  if (loneWorkerQ && isYes(map, loneWorkerQ)) {
    warnings.push({
      message: 'Lone worker risk identified — double-up visits may be required',
      sectionNumber: 3,
      blocking: false,
    });
  }

  const sectionNumbers = [...new Set(questions.map((q) => q.section.sectionNumber))].sort((a, b) => a - b);
  const percents = sectionNumbers.map((n) => sectionPercent(questions, map, n));
  const overallPercent =
    percents.length === 0 ? 0 : Math.round(percents.reduce((a, b) => a + b, 0) / percents.length);

  if (overallPercent < 40) {
    warnings.push({
      message: 'Assessment less than 40% complete — consider finishing more sections before submit',
      sectionNumber: 1,
      blocking: false,
    });
  }

  const finalBlocks = dedupe(blocks);
  const finalWarnings = dedupe(warnings);
  const { hardBlocks, skippableBlocks } = partitionSubmitValidationBlocks(finalBlocks);

  return {
    blocks: finalBlocks,
    warnings: finalWarnings,
    canSubmit: finalBlocks.length === 0,
    canSubmitIncomplete: hardBlocks.length === 0 && skippableBlocks.length > 0,
    overallPercent,
  };
}
