import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { InitialAssessmentTemplatesService } from '../initial-assessment-templates/initial-assessment-templates.service';
import { InitialAssessmentsService } from '../initial-assessments/initial-assessments.service';
import { InitialAssessmentStatus } from '../initial-assessments/enums/initial-assessment-status.enum';
import {
  buildAutofillAnswers,
  buildHolisticWorksheetMetadata,
  mergeMetadataPatch,
  type IaAutofillLevel,
  type TemplateQuestion,
} from './ia-autofill-build.util';
import { IA_HOLISTIC_TAB_COUNT } from './dto/run-ia-section.dto';

/**
 * Holistic document tab (1..18) → its primary DB section (`sectionNumber`). Mirrors
 * `enterpriseSection` in the frontend `holistic-assessment-tabs.ts`. Used to scope the
 * section demo's `sectionComments`/`sectionFooters` metadata.
 */
const TAB_ENTERPRISE_SECTION: Record<number, number> = {
  1: 1, 2: 12, 3: 2, 4: 11, 5: 11, 6: 12, 7: 6, 8: 12, 9: 12,
  10: 5, 11: 5, 12: 3, 13: 13, 14: 13, 15: 14, 16: 14, 17: 10, 18: 11,
};

/**
 * Holistic tab → the `submission.metadata` worksheet key(s) that tab owns. Several tabs map to
 * one DB section but distinct metadata keys, so scoping by tab (not section) keeps each tab's
 * "Fill Demo Data" from touching a sibling tab's tool data. Keys come from
 * `buildHolisticWorksheetMetadata`. Tabs not listed are answer-only (no worksheet metadata).
 */
const TAB_METADATA_KEYS: Record<number, string[]> = {
  1: ['adl'],
  2: ['practicalCare', 'financeSupport'],
  4: ['skinIntegrityCheck'],
  5: ['waterlow'],
  6: ['equipmentSelection', 'equipmentChecklist', 'dailyLivingAids'],
  7: ['mustAssessment'],
  8: ['fallsScreening'],
  9: ['movingHandlingOperations', 'transfers'],
  10: ['painAssessment'],
  11: ['therapyAideMemoire'],
  12: ['environmentAssessment'],
  13: ['advanceCarePlanning'],
  14: ['endOfLifeAssessment'],
  15: ['clinicalOutcomeSummary'],
  16: ['carePlanObjectives'],
  17: ['mentalCapacityChecklist'],
  18: ['photographyConsent'],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** A question is profile/system/secure-sourced and must never be overwritten by demo data. */
function isProfileOrSecureQuestion(q: TemplateQuestion): boolean {
  const m = q.metadata;
  if (!isRecord(m)) return false;
  return Boolean(m.prefillKey) || m.secureField === true;
}

/**
 * Build the metadata patch owned by a single tab: only that tab's worksheet key(s) plus the
 * `sectionComments`/`sectionFooters` entry for its DB section. Leaves every other tab's tool
 * data untouched.
 */
function pickTabMetadata(full: Record<string, unknown>, tabId: number): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of TAB_METADATA_KEYS[tabId] ?? []) {
    if (key in full) patch[key] = full[key];
  }
  const sectionNumber = String(TAB_ENTERPRISE_SECTION[tabId] ?? tabId);
  const comments = full.sectionComments;
  if (isRecord(comments) && comments[sectionNumber] !== undefined) {
    patch.sectionComments = { [sectionNumber]: comments[sectionNumber] };
  }
  const footers = full.sectionFooters;
  if (isRecord(footers) && footers[sectionNumber] !== undefined) {
    patch.sectionFooters = { [sectionNumber]: footers[sectionNumber] };
  }
  return patch;
}

@Injectable()
export class IaApiAutofillService {
  private readonly logger = new Logger(IaApiAutofillService.name);

  constructor(
    private readonly assessments: InitialAssessmentsService,
    private readonly templates: InitialAssessmentTemplatesService,
  ) {}

  /**
   * Section-scoped QA demo population for ONE holistic tab.
   *
   * Reuses the severity builder but writes ONLY the questions this tab renders (`questionIds`),
   * excluding profile (`prefillKey`) and secure (`secureField`) fields, and applies ONLY this
   * tab's own worksheet metadata key(s). Answers upsert per question (other sections untouched).
   * The whole assessment is NEVER submitted from here.
   */
  async runSection(
    userId: string,
    serviceUserId: string,
    level: IaAutofillLevel,
    tabId: number,
    questionIds: string[],
    meta?: RequestAuditMeta,
  ): Promise<{ message: string; tabId: number; answersWritten: number }> {
    if (!Number.isInteger(tabId) || tabId < 1 || tabId > IA_HOLISTIC_TAB_COUNT) {
      throw new BadRequestException(`tabId must be an integer between 1 and ${IA_HOLISTIC_TAB_COUNT}`);
    }

    const context = await this.prepareAutofillContext(userId, serviceUserId, meta);
    const { submission, allQuestions, existingMeta, correctionReason } = context;

    // Questions this tab may write: requested ids, intersected with the template, minus
    // profile/secure fields (never overwrite real DOB/address/NHS/key-safe/door codes).
    const requested = new Set(questionIds);
    const writable = new Set(
      allQuestions
        .filter((q) => requested.has(q.id) && !isProfileOrSecureQuestion(q))
        .map((q) => q.id),
    );

    const answers = buildAutofillAnswers(allQuestions, level).filter((a) => writable.has(a.questionId));
    await this.saveAnswersInChunks(userId, serviceUserId, submission.id, answers, correctionReason, meta);

    const fullMeta = buildHolisticWorksheetMetadata(level);
    const tabMetaPatch = pickTabMetadata(fullMeta, tabId);
    if (Object.keys(tabMetaPatch).length > 0) {
      await this.assessments.updateSubmission(
        userId,
        serviceUserId,
        submission.id,
        { metadata: mergeMetadataPatch(existingMeta, tabMetaPatch) },
        meta,
      );
    }

    // Intentionally never submits — section demo only populates this tab, never the whole assessment.
    this.logger.log(
      `IA section demo (${level}, tab ${tabId}) wrote ${answers.length} answers for ${serviceUserId} submission ${submission.id}`,
    );
    return {
      message: `Demo data populated for this section (${level}).`,
      tabId,
      answersWritten: answers.length,
    };
  }

  private async prepareAutofillContext(
    userId: string,
    serviceUserId: string,
    meta?: RequestAuditMeta,
  ): Promise<{
    submission: { id: string; status: string };
    allQuestions: TemplateQuestion[];
    existingMeta: Record<string, unknown>;
    correctionReason: string | undefined;
  }> {
    const templateRes = await this.templates.getDefaultTemplate();
    const template = templateRes.data;

    const listRes = await this.assessments.getSubmissions(
      userId,
      serviceUserId,
      { limit: 20, sortOrder: 'desc' },
      meta,
    );
    let submission =
      listRes.data.find((s) => s.status === 'IN_PROGRESS' || s.status === 'DRAFT') ?? listRes.data[0];

    if (!submission) {
      try {
        const created = await this.assessments.createSubmission(userId, serviceUserId, {}, meta);
        submission = created.data;
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
        const retry = await this.assessments.getSubmissions(
          userId,
          serviceUserId,
          { limit: 20, sortOrder: 'desc' },
          meta,
        );
        submission =
          retry.data.find((s) => s.status === 'IN_PROGRESS' || s.status === 'DRAFT') ?? retry.data[0];
        if (!submission) throw err;
      }
    } else if (submission.status !== 'IN_PROGRESS' && submission.status !== 'DRAFT') {
      const reopened = await this.assessments.updateStatus(
        userId,
        serviceUserId,
        submission.id,
        {
          status: InitialAssessmentStatus.IN_PROGRESS,
          reason: 'API autofill reopen for testing',
        },
        meta,
      );
      submission = reopened.data;
    }

    const freshRes = await this.assessments.getSubmissionById(userId, serviceUserId, submission.id, meta);
    const fresh = freshRes.data;
    const existingMeta =
      fresh.metadata && typeof fresh.metadata === 'object' && !Array.isArray(fresh.metadata)
        ? (fresh.metadata as Record<string, unknown>)
        : {};

    const answerCountRes = await this.assessments.getAnswers(userId, serviceUserId, submission.id, meta);
    const existingAnswerCount = answerCountRes.data?.length ?? 0;
    const needsCorrectionReason =
      existingMeta.correctionRequired === true ||
      typeof existingMeta.reopenedAt === 'string' ||
      (existingAnswerCount > 0 && (fresh.status === 'IN_PROGRESS' || fresh.status === 'DRAFT'));
    const correctionReason = needsCorrectionReason
      ? 'API autofill after manager reopen for testing.'
      : undefined;

    const allQuestions: TemplateQuestion[] = (template.sections ?? []).flatMap((section) =>
      (section.questions ?? []).map((q) => ({
        id: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        isRequired: q.isRequired,
        sortOrder: q.sortOrder,
        metadata:
          q.metadata && typeof q.metadata === 'object' && !Array.isArray(q.metadata)
            ? (q.metadata as Record<string, unknown>)
            : null,
        options: q.options ?? undefined,
        sectionNumber: section.sectionNumber,
      })),
    );

    return { submission, allQuestions, existingMeta, correctionReason };
  }

  private async saveAnswersInChunks(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    answers: { questionId: string }[],
    correctionReason: string | undefined,
    meta?: RequestAuditMeta,
  ): Promise<void> {
    const chunkSize = 40;
    for (let i = 0; i < answers.length; i += chunkSize) {
      await this.assessments.saveAnswers(
        userId,
        serviceUserId,
        submissionId,
        {
          answers: answers.slice(i, i + chunkSize),
          ...(correctionReason ? { correctionReason } : {}),
        },
        meta,
      );
    }
  }
}
