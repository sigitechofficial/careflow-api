import { Prisma } from '@prisma/client';
import { InitialAssessmentStatus as PrismaStatus } from '@prisma/client';
import {
  getInitialAssessmentAgencySettings,
  type InitialAssessmentAgencySettings,
} from './initial-assessment-agency-settings.util';
import { buildFallsAssessmentSnapshot } from './initial-assessment-clinical.util';
import { FALLS_ASSESSMENT_REQUIRED_MESSAGE } from './initial-assessment-falls.util';
import {
  specialistInputsFromSubmission,
  specialistRequiredIssues,
} from './initial-assessment-specialist-relevance.util';
import {
  capacityDecisionIssues,
  completedDecisionFor,
  normalizeCapacityDecisions,
  refusalContextFromDecision,
  usesLegacyCapacityScreening,
  type CapacityDecisionType,
} from './initial-assessment-capacity-decisions.util';
import {
  consentRefusalRoute,
  LEGAL_AUTHORITY_WITH_DECISION_MAKER,
} from './initial-assessment-consent-refusal.util';
import {
  isCapacityInDoubt,
  shouldShowQuestionForValidation,
} from './initial-assessment-conditional-visibility.util';
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
  if (message.startsWith('Specialist assessment required:')) return true;
  if (message.startsWith('Assessor sign-off required:')) return true;
  if (message.includes('Next review date is required')) return true;
  if (message.includes('ADL dependency scores incomplete')) return true;
  if (message.includes('Complete the Waterlow assessment')) return true;
  if (message.includes('Falls trigger assessment') || message.includes('Falls assessment')) return true;
  if (message.includes('Mobility aids')) return true;
  if (message.includes('Emergency contact 1 not recorded')) return true;
  if (message.startsWith('Agreed goals:')) return true;
  if (message.startsWith('Capacity assessment incomplete')) return true;
  return false;
}

/** At least one goal agreed with the person on the final tab (`metadata.agreedGoals.goals`). */
export function hasAgreedGoal(metadata: Prisma.JsonValue | null | undefined): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const block = (metadata as Record<string, unknown>).agreedGoals;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return false;
  const goals = (block as Record<string, unknown>).goals;
  return (
    Array.isArray(goals) &&
    goals.some((g) => !!g && typeof g === 'object' && typeof (g as { goal?: unknown }).goal === 'string' && (g as { goal: string }).goal.trim() !== '')
  );
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

  const capacityInDoubt = isCapacityInDoubt(questions, map);
  // A refusal is never ignored (CQC Regulation 11, MCA 2005) — see consentRefusalRoute. Mirrors admin
  // submit-validation.
  const selectedOf = (fieldKey: string): string | undefined => {
    const q = findByFieldKey(questions, fieldKey);
    const raw = q ? answerFor(map, q.id)?.selectedOptions : undefined;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value : undefined;
  };
  const biRequiredQ =
    findByFieldKey(questions, 'bestInterestDecisionRequired') ??
    findByQuestionTextIncludes(questions, 'best interest decision required');
  const biDetailsQ =
    findByFieldKey(questions, 'bestInterestDecisionDetails') ??
    findByQuestionTextIncludes(questions, 'best interest decision details');
  const biDetailsText = biDetailsQ ? answerFor(map, biDetailsQ.id)?.textValue ?? '' : '';
  const refusalContext = {
    capacityInDoubt,
    lacksCapacity: selectedOf('mcaScreeningOutcome') === 'lacks_capacity',
    bestInterestRecorded:
      Boolean(biRequiredQ && isYes(map, biRequiredQ)) &&
      biDetailsText.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim().length > 0,
    coveringAuthority: (LEGAL_AUTHORITY_WITH_DECISION_MAKER as readonly string[]).includes(
      selectedOf('legalAuthority') ?? '',
    ),
  };
  // Decision-specific capacity records (metadata.capacityDecisions) replace the one global screening;
  // IAs that only have the old §2.mca screening keep the old rules.
  const capacityRecords = normalizeCapacityDecisions(
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).capacityDecisions
      : undefined,
  );
  const legacyScreeningAnswered = questions.some(
    (q) => specRefOf(q) === '2.mca' && isAnswered(q, answerFor(map, q.id)),
  );
  const legacyCapacity = usesLegacyCapacityScreening(capacityRecords, legacyScreeningAnswered);
  const consentQ = findByFieldKey(questions, 'consentToAssessment') ?? findBySpecRef(questions, '2.1');
  const careConsentQ = findByFieldKey(questions, 'consentToCare') ?? findBySpecRef(questions, '2.2');
  for (const [q, label, ref, decision] of [
    [consentQ, 'Consent to assessment', '2.1', 'consent_to_assessment'],
    [careConsentQ, 'Consent to receive care', '2.2', 'consent_to_care'],
  ] as const) {
    const fromDecision = legacyCapacity
      ? null
      : refusalContextFromDecision(completedDecisionFor(capacityRecords, decision as CapacityDecisionType));
    const route = consentRefusalRoute({
      ...refusalContext,
      ...(fromDecision
        ? {
            hasCapacityForDecision: fromDecision.hasCapacity,
            lacksCapacity: fromDecision.lacksCapacity,
            bestInterestRecorded: fromDecision.bestInterestRecorded,
            coveringAuthority: fromDecision.coveringAuthority,
          }
        : {}),
      refused: Boolean(q && isExplicitNo(map, q)),
    });
    if (route === 'refusal_stands') {
      blocks.push({ message: `${label} is No — cannot submit (section ${ref})`, sectionNumber: 2, blocking: true });
    } else if (route === 'needs_capacity_and_best_interests') {
      blocks.push({
        message: `${label} is No and capacity is in doubt — record the capacity assessment for this decision and a best-interests decision (including the person's wishes and objection) or a covering legal authority (section ${ref})`,
        sectionNumber: 2,
        blocking: true,
      });
    } else if (route === 'proceed_with_manager_review') {
      warnings.push({
        message: `${label} refused by a person assessed as lacking capacity — manager review required; their wishes and objection must be considered (section ${ref})`,
        sectionNumber: 2,
        blocking: false,
      });
    }
  }

  const understandsQ = findByFieldKey(questions, 'understandsAssessmentInfo');
  const understands = understandsQ ? answerFor(map, understandsQ.id)?.selectedOptions : undefined;
  const understandsValue = Array.isArray(understands) ? understands[0] : understands;
  if ((understandsValue === 'no' || understandsValue === 'unsure') && !capacityInDoubt) {
    warnings.push({
      message: 'Service user may not understand the assessment — consider a Mental Capacity Assessment (section 2.3)',
      sectionNumber: 2,
      blocking: false,
    });
  }

  const mcaDone = findByQuestionTextIncludes(questions, 'mca completed');
  if (capacityInDoubt && (!mcaDone || !isYes(map, mcaDone))) {
    blocks.push({
      message: 'Capacity in doubt — MCA must be completed before submit (section 2.4–2.5)',
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

  // Falls: case-finding (§12.7, always asked) decides whether the Falls tab is needed. Mirrors
  // admin submit-validation — change both together.
  const fallsSnapshot = buildFallsAssessmentSnapshot({ questions, answers, metadata });
  if (fallsSnapshot.caseFinding?.status === 'required' && fallsSnapshot.assessmentCompleted !== true) {
    blocks.push({ message: FALLS_ASSESSMENT_REQUIRED_MESSAGE, sectionNumber: 12, blocking: true });
  } else if (fallsSnapshot.caseFinding?.status === 'suggested' && fallsSnapshot.assessmentCompleted !== true) {
    warnings.push({
      message: `Falls assessment suggested — ${fallsSnapshot.caseFinding.reasons.join(', ').toLowerCase()} recorded (section 12.7)`,
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
      message: 'ADL dependency scores incomplete — score all activities in the worksheet (section 12, §12.2–12.6)',
      sectionNumber: 12,
      blocking: true,
    });
  }

  // §12.8 mobility aids (ADL worksheet footer). Mirrors admin submit-validation.
  const adlMeta =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? ((metadata as Record<string, unknown>).adl as Record<string, unknown> | undefined)
      : undefined;
  const mobilityAidsRequired = adlMeta?.mobilityAidsRequired;
  if (mobilityAidsRequired !== true && mobilityAidsRequired !== false) {
    blocks.push({
      message: 'Mobility aids in use or required not answered (section 12.8)',
      sectionNumber: 12,
      blocking: true,
    });
  } else if (
    mobilityAidsRequired === true &&
    !(typeof adlMeta?.mobilityAidsList === 'string' && adlMeta.mobilityAidsList.trim())
  ) {
    blocks.push({
      message: 'Mobility aids list required when aids are in use (section 12.8)',
      sectionNumber: 12,
      blocking: true,
    });
  }

  // Waterlow (Tab 10) is the master: a "pressure ulcer risk assessment completed" answer needs a score.
  const pressureRiskQ = findByQuestionTextIncludes(questions, 'pressure ulcer risk assessment completed');
  const waterlowScored = waterlowScoreFromMetadata(metadata) > 0;
  if (pressureRiskQ && isYes(map, pressureRiskQ) && !waterlowScored) {
    blocks.push({
      message: 'Complete the Waterlow assessment (gender and age bands required)',
      sectionNumber: 11,
      blocking: true,
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

  if (!hasAgreedGoal(metadata)) {
    blocks.push({
      message: 'Agreed goals: add at least one goal agreed with the person',
      sectionNumber: 14,
      blocking: true,
    });
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
    // The old global screening is only required on IAs that already use it.
    if (!legacyCapacity && specRefOf(q) === '2.mca') continue;
    if (!shouldShowQuestionForValidation(q, questions, map)) continue;
    if (isAnswered(q, answerFor(map, q.id))) continue;
    blocks.push({
      message: `Required: ${q.questionText}`,
      sectionNumber: q.section.sectionNumber,
      blocking: true,
    });
  }

  const capacityInputs = specialistInputsFromSubmission({ questions, answers, metadata });
  const capacity = capacityDecisionIssues(
    capacityRecords,
    {
      capacityDoubt: capacityInputs.capacityDoubt,
      covertMedication: capacityInputs.covertMedication,
      dolRestrictions: capacityInputs.dolRestrictions,
      dolConcern: capacityInputs.dolConcern,
    },
    legacyScreeningAnswered,
  );
  for (const message of capacity.blocks) blocks.push({ message, sectionNumber: 2, blocking: true });
  for (const message of capacity.warnings) warnings.push({ message, sectionNumber: 2, blocking: false });

  // Specialist worksheets the Core IA screening makes Required (see specialist-relevance rules).
  for (const issue of specialistRequiredIssues({ questions, answers, metadata })) {
    blocks.push({ message: issue.message, sectionNumber: 0, blocking: true });
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
  if (wl >= 10) {
    warnings.push({
      message: 'Waterlow score 10+ — pressure ulcer prevention care plan required',
      sectionNumber: 11,
      blocking: false,
    });
  }

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
  const env =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).environmentAssessment
      : null;
  const loneWorkerFromWorksheet =
    env && typeof env === 'object' && !Array.isArray(env)
      ? (env as Record<string, unknown>).loneWorkerRiskIdentified === true
      : false;
  if ((loneWorkerQ && isYes(map, loneWorkerQ)) || loneWorkerFromWorksheet) {
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
