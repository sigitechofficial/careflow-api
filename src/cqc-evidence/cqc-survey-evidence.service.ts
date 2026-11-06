import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CqcEvidenceSourceType,
  CqcEvidenceStatus,
  Prisma,
  SurveyStatus,
  type Survey,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { OrgScope } from '../common/org-scope/org-scope.types';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CqcFrameworkService, type ActiveFramework, type FrameworkStatement } from './cqc-framework.service';
import { matchStatements } from './cqc-statement-match.util';
import { RESULTS_RESTRICTED, surveyAccessFor, surveyThreshold } from '../surveys/survey-access';
import { audienceGroupLabel } from '../../prisma/seed-lib/survey-audience-groups';
import {
  CQC_MIN_REPORTING_RESPONSES,
  buildSurveyMetrics,
  positiveLabelsFor,
  surveyMetricsSummary,
  type CqcSurveyMetrics,
  type MetricsQuestion,
} from './cqc-survey-metrics.util';
import { readMetrics } from './cqc-evidence.service';
import {
  ANSWERED_WITHOUT_NAME,
  NOT_ANSWERED_WITHOUT_NAME,
  withoutNameAnswersHeldBack,
} from '../surveys/survey-respondent-anonymity.util';
import {
  CQC_RECAPTURE_MARK,
  flushPendingResponses,
  pendingResponseCount,
} from '../surveys/survey-pending-responses';

const isRecaptureMark = (d: Date) => d.getTime() === CQC_RECAPTURE_MARK.getTime();
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import type { CaptureSurveyEvidenceDto } from './dto/cqc-evidence.dto';

/** Library details on a survey (Survey.libraryMeta; prisma/seed-lib/survey-library.ts), the parts used here. */
type SurveyLibraryMeta = {
  type: 'survey-library';
  group?: { short?: string };
  cqc?: { keyQuestions?: string[]; qualityStatements?: string[] };
  sections?: Array<{ title: string; evidence?: string[] }>;
};

function libraryMetaOf(value: Prisma.JsonValue | null | undefined): SurveyLibraryMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return v.type === 'survey-library' && v.cqc && typeof v.cqc === 'object' ? (v as unknown as SurveyLibraryMeta) : null;
}

/** Evidence category for survey results, by library group, else by who answered. */
export function defaultSurveyCategory(targetKind: string, groupShort: string | null | undefined): string {
  switch (groupShort) {
    case 'PWS':
    case 'FAM':
      return 'PEOPLES_EXPERIENCE';
    case 'STF':
    case 'APP':
      return 'STAFF_FEEDBACK';
    case 'PRO':
      return 'PARTNER_FEEDBACK';
    default:
      return targetKind === 'EMPLOYEE' ? 'STAFF_FEEDBACK' : 'PEOPLES_EXPERIENCE';
  }
}

export const surveySourceKey = (surveyId: string, statementId: string) => `survey:${surveyId}:${statementId}`;

/** How far back the sweep looks for closed surveys it has not handled. */
const SWEEP_LOOKBACK_DAYS = 14;
const SWEEP_BATCH = 20;
/** Closed surveys the sweep reads a page at a time, and the pages it reads a run at most. */
const SWEEP_PAGE = 200;
const SWEEP_SCAN_PAGES = 5;
/** Marked captures the sweep considers a run (and reads a page at a time). */
const MARK_TAKE = 200;
/** Pages of marks read a run at most, so skipped (re-opened) ones cannot stall it. */
const MARK_SCAN_PAGES = 5;
/** A failed capture is tried again after this long. */
const RETRY_FAILED_AFTER_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

type StatementPlan = {
  source: 'choice' | 'library' | 'none';
  statements: FrameworkStatement[];
  /** Statement id → the questions that evidence it (library sections); null = every scale question. */
  questionIdsByStatement: Map<string, Set<string>> | null;
  libraryReference: string | null;
  groupShort: string | null;
  categoryCode: string | null;
  unmatched: string[];
};

export type CaptureOutcome = {
  surveyId: string;
  outcome: 'CAPTURED' | 'NO_STATEMENTS' | 'NOT_CLOSED' | 'FAILED';
  created: number;
  updated: number;
  skipped: number;
  evidenceIds: string[];
  detail: string | null;
};

/**
 * Survey results → CQC evidence. When a survey, or a period of a repeating survey, closes, one
 * evidence item is made (or refreshed) for each quality statement the survey evidences:
 *  - statements a manager chose for the survey (CqcSurveyStatementChoice), else
 *  - the ready-made survey's cqc.qualityStatements (libraryMeta on the survey, its repeating
 *    survey, or the template it was started from).
 * Each item keeps totals only: counts, response rate and "top two" percentages of scale questions
 * (see cqc-survey-metrics.util.ts). No individual answers, no free text, nothing about who
 * answered, and nothing broken down under 5 responses. "You said, we did" actions are added on the
 * evidence. A later period's evidence supersedes the earlier period's for the same statement.
 */
@Injectable()
export class CqcSurveyEvidenceService {
  private readonly logger = new Logger(CqcSurveyEvidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly audit: AuditLogsService,
    private readonly framework: CqcFrameworkService,
    @Optional() private readonly orgSettings?: OrganisationGeneralSettingsService,
  ) {}

  /** The organisation's operational time zone (the day answers written out at capture are dated). */
  private async timeZone(): Promise<string | undefined> {
    try {
      return (await this.orgSettings?.getOperationalTimezone()) || undefined;
    } catch {
      return undefined;
    }
  }

  // ─── Hooks ────────────────────────────────────────────────────────────────

  /** SurveysService.close: capture straight away. Never throws (closing must not fail because of this). */
  async onSurveyClosed(surveyId: string, actorId: string | null): Promise<void> {
    try {
      // A repeating survey's periods are captured one by one as each closes (the sweep).
      if (await this.prisma.survey.count({ where: { clonedFromId: surveyId } })) return;
      await this.captureSurvey(surveyId, { actorId, trigger: 'close' });
    } catch (err) {
      this.logger.warn(`CQC evidence for closed survey ${surveyId} failed: ${(err as Error).message}`);
    }
  }

  /**
   * Survey distribution job (every minute): closed surveys and periods not yet handled — periods
   * closed by the schedule, and anything the close hook missed. Each close is handled once
   * (CqcSurveyCapture keeps the survey's updatedAt); re-opening and closing again captures again.
   * A capture marked out of date because late answers were written after it (CQC_RECAPTURE_MARK,
   * set by the pending-answer flush) is captured again however long ago the survey closed.
   */
  async captureRecentlyClosed(now: Date = new Date()): Promise<{ checked: number; captured: number }> {
    const marked = await this.markedForRecapture(now);
    const recent = { updatedAt: { gte: new Date(now.getTime() - SWEEP_LOOKBACK_DAYS * DAY_MS) } };
    const isDue = (s: { id: string; updatedAt: Date }, c: { outcome: string; capturedAt: Date; surveyUpdatedAt: Date } | undefined) => {
      if (!c) return true;
      const retryFailed = c.outcome === 'FAILED' && now.getTime() - c.capturedAt.getTime() > RETRY_FAILED_AFTER_MS;
      // A marked capture that failed keeps its mark (so it is tried again however long ago the
      // survey closed) and waits like any failed capture, not every minute.
      if (c.outcome === 'FAILED' && isRecaptureMark(c.surveyUpdatedAt)) return retryFailed;
      if (c.surveyUpdatedAt.getTime() < s.updatedAt.getTime()) return true;
      return retryFailed;
    };
    // Oldest first, a page at a time: surveys already handled (most of the look-back, once an
    // organisation closes more than a page of surveys and periods in it) must not fill the only page
    // and hide newer closes until the older ones leave the look-back.
    const due: Array<{ id: string; updatedAt: Date }> = [];
    let after: { id: string; updatedAt: Date } | null = null;
    for (let page = 0; page < SWEEP_SCAN_PAGES && due.length < SWEEP_BATCH; page += 1) {
      const surveys: Array<{ id: string; updatedAt: Date }> = await this.prisma.survey.findMany({
        where: {
          status: SurveyStatus.CLOSED,
          isTemplate: false,
          isCatalogue: false,
          deletedAt: null,
          ...(marked.length ? { OR: [recent, { id: { in: marked } }] } : recent),
          // A repeating survey's own row holds no answers once it repeats: its periods are captured.
          clones: { none: {} },
          ...(after
            ? {
                AND: [
                  {
                    OR: [
                      { updatedAt: { gt: after.updatedAt } },
                      { updatedAt: after.updatedAt, id: { gt: after.id } },
                    ],
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: SWEEP_PAGE,
        select: { id: true, updatedAt: true },
      });
      if (!surveys.length) break;
      after = surveys[surveys.length - 1]!;
      const captures = await this.prisma.cqcSurveyCapture.findMany({
        where: { surveyId: { in: surveys.map((s) => s.id) } },
      });
      const byId = new Map(captures.map((c) => [c.surveyId, c]));
      for (const s of surveys) {
        if (due.length < SWEEP_BATCH && isDue(s, byId.get(s.id))) due.push(s);
      }
      if (surveys.length < SWEEP_PAGE) break;
    }
    if (!due.length) return { checked: 0, captured: 0 };
    let captured = 0;
    for (const s of due) {
      try {
        const r = await this.captureSurvey(s.id, { actorId: null, trigger: 'sweep', now });
        if (r.outcome === 'CAPTURED') captured += 1;
      } catch (err) {
        this.logger.warn(`CQC evidence for survey ${s.id} failed: ${(err as Error).message}`);
      }
    }
    return { checked: due.length, captured };
  }

  /**
   * Surveys whose capture is marked to be taken again and that the sweep can capture (closed, not
   * deleted, not a repeating survey's own row): at most MARK_TAKE, the longest-waiting first (oldest
   * capture, then id, so the order is fixed). Marks the sweep could never take — the survey deleted
   * (or gone), a template, or a repeating survey's own row (its periods are captured) — are cleared
   * as they are found, so they cannot fill the batch and starve real ones. A mark on a survey that
   * has been re-opened is kept (closing it again captures it) and skipped. Reads at most
   * MARK_SCAN_PAGES pages a run.
   */
  private async markedForRecapture(now: Date): Promise<string[]> {
    const eligible: string[] = [];
    let after: { capturedAt: Date; surveyId: string } | null = null;
    for (let page = 0; page < MARK_SCAN_PAGES && eligible.length < MARK_TAKE; page += 1) {
      const marks: Array<{ surveyId: string; capturedAt: Date }> = await this.prisma.cqcSurveyCapture.findMany({
        where: {
          surveyUpdatedAt: CQC_RECAPTURE_MARK,
          ...(after
            ? {
                OR: [
                  { capturedAt: { gt: after.capturedAt } },
                  { capturedAt: after.capturedAt, surveyId: { gt: after.surveyId } },
                ],
              }
            : {}),
        },
        orderBy: [{ capturedAt: 'asc' }, { surveyId: 'asc' }],
        take: MARK_TAKE,
        select: { surveyId: true, capturedAt: true },
      });
      if (!marks.length) break;
      after = marks[marks.length - 1]!;
      const ids = marks.map((m) => m.surveyId);
      const surveys = await this.prisma.survey.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          status: true,
          deletedAt: true,
          isTemplate: true,
          isCatalogue: true,
          clones: { select: { id: true }, take: 1 },
        },
      });
      const byId = new Map(surveys.map((s) => [s.id, s]));
      const dead: string[] = [];
      for (const id of ids) {
        const s = byId.get(id);
        if (!s || s.deletedAt || s.isTemplate || s.isCatalogue || (s.clones?.length ?? 0) > 0) dead.push(id);
        else if (s.status === SurveyStatus.CLOSED && eligible.length < MARK_TAKE) eligible.push(id);
      }
      if (dead.length) {
        // Cleared only while still marked (a capture recording at the same moment wins). `now` is
        // later than the survey's updatedAt, so it is not taken as due; restoring it changes that.
        await this.prisma.cqcSurveyCapture
          .updateMany({
            where: { surveyId: { in: dead }, surveyUpdatedAt: CQC_RECAPTURE_MARK },
            data: { surveyUpdatedAt: now },
          })
          .catch((err: unknown) =>
            this.logger.warn(`CQC recapture marks for removed surveys could not be cleared: ${(err as Error).message}`),
          );
      }
      if (marks.length < MARK_TAKE) break;
    }
    return eligible;
  }

  // ─── Manager actions ──────────────────────────────────────────────────────

  /** What "Add to CQC evidence" on a survey's results would do, and what is already kept. */
  async forSurvey(user: RequestUser, surveyId: string) {
    const survey = await this.requireVisibleSurvey(user, surveyId);
    const framework = await this.framework.active();
    const plan = await this.statementPlan(survey, framework);
    const periods = await this.prisma.survey.findMany({
      where: { clonedFromId: survey.id, deletedAt: null },
      select: { id: true, status: true },
    });
    const sourceIds = [survey.id, ...periods.map((p) => p.id)];
    const evidence = await this.prisma.cqcEvidence.findMany({
      where: { sourceType: CqcEvidenceSourceType.SURVEY_RESULT, sourceId: { in: sourceIds } },
      orderBy: [{ periodEnd: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        status: true,
        periodEnd: true,
        sourceId: true,
        statements: { select: { statement: { select: { id: true, title: true } } } },
      },
    });
    const isSeries = periods.length > 0;
    const closed = isSeries ? periods.some((p) => p.status === SurveyStatus.CLOSED) : survey.status === SurveyStatus.CLOSED;
    return {
      data: {
        surveyId: survey.id,
        title: survey.title,
        status: survey.status,
        isSeries,
        closedPeriods: periods.filter((p) => p.status === SurveyStatus.CLOSED).length,
        canCapture: closed,
        source: plan.source,
        libraryReference: plan.libraryReference,
        statements: plan.statements.map((s) => ({ id: s.id, code: s.code, title: s.title, keyQuestionCode: s.keyQuestionCode, keyQuestionTitle: s.keyQuestionTitle })),
        unmatchedLabels: plan.unmatched,
        categoryCode: this.categoryFor(survey, plan, framework),
        evidence: evidence.map((e) => ({
          id: e.id,
          title: e.title,
          status: e.status,
          periodEnd: e.periodEnd?.toISOString() ?? null,
          surveyId: e.sourceId,
          statements: e.statements.map((l) => ({ id: l.statement.id, title: l.statement.title })),
        })),
      },
    };
  }

  /**
   * "Add to CQC evidence": optionally save the statements to use (for the survey and its later
   * periods), then capture the survey — or every closed period of a repeating survey.
   */
  async captureForUser(user: RequestUser, surveyId: string, dto: CaptureSurveyEvidenceDto, meta?: RequestAuditMeta) {
    const survey = await this.requireVisibleSurvey(user, surveyId);
    const framework = await this.framework.active();
    const rootId = survey.clonedFromId ?? survey.id;
    if (dto.statementIds !== undefined || dto.categoryCode !== undefined) {
      const known = new Set(framework.statements.map((s) => s.id));
      const statementIds = [...new Set(dto.statementIds ?? [])];
      if (statementIds.some((id) => !known.has(id))) {
        throw new BadRequestException('Choose quality statements from the current CQC framework');
      }
      if (dto.categoryCode && !framework.categories.some((c) => c.code === dto.categoryCode)) {
        throw new BadRequestException(`Unknown evidence category ${dto.categoryCode}`);
      }
      const existing = await this.prisma.cqcSurveyStatementChoice.findUnique({ where: { surveyId: rootId } });
      await this.prisma.cqcSurveyStatementChoice.upsert({
        where: { surveyId: rootId },
        update: {
          ...(dto.statementIds !== undefined ? { statementIds } : {}),
          ...(dto.categoryCode !== undefined ? { categoryCode: dto.categoryCode } : {}),
          chosenById: user.id,
        },
        create: {
          surveyId: rootId,
          statementIds: dto.statementIds !== undefined ? statementIds : (existing?.statementIds ?? []),
          categoryCode: dto.categoryCode ?? null,
          chosenById: user.id,
        },
      });
    }
    const periods = await this.prisma.survey.findMany({
      where: { clonedFromId: survey.id, deletedAt: null, status: SurveyStatus.CLOSED },
      orderBy: [{ opensAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    const targets = periods.length ? periods.map((p) => p.id) : [survey.id];
    const results: CaptureOutcome[] = [];
    for (const id of targets) {
      results.push(await this.captureSurvey(id, { actorId: user.id, trigger: 'manual', meta }));
    }
    const created = results.reduce((n, r) => n + r.created, 0);
    const updated = results.reduce((n, r) => n + r.updated, 0);
    const first = results.find((r) => r.outcome !== 'CAPTURED');
    if (!created && !updated && first) {
      throw new BadRequestException(first.detail ?? 'Nothing could be added to CQC evidence');
    }
    return {
      message:
        `${created} evidence item${created === 1 ? '' : 's'} added` +
        (updated ? `, ${updated} brought up to date` : ''),
      data: {
        created,
        updated,
        skipped: results.reduce((n, r) => n + r.skipped, 0),
        evidenceIds: results.flatMap((r) => r.evidenceIds),
        surveys: results.map((r) => ({ surveyId: r.surveyId, outcome: r.outcome, detail: r.detail })),
      },
    };
  }

  // ─── Capture ──────────────────────────────────────────────────────────────

  /** Create or refresh the evidence for one closed survey (a one-off survey or one period). */
  async captureSurvey(
    surveyId: string,
    opts: { actorId: string | null; trigger: 'close' | 'sweep' | 'manual'; now?: Date; meta?: RequestAuditMeta },
  ): Promise<CaptureOutcome> {
    const now = opts.now ?? new Date();
    const survey = await this.prisma.survey.findFirst({
      where: { id: surveyId, deletedAt: null, isTemplate: false, isCatalogue: false },
    });
    if (!survey) throw new NotFoundException('Survey not found');
    const result: CaptureOutcome = { surveyId, outcome: 'CAPTURED', created: 0, updated: 0, skipped: 0, evidenceIds: [], detail: null };
    const record = (r: CaptureOutcome) =>
      this.prisma.cqcSurveyCapture.upsert({
        where: { surveyId },
        update: { surveyUpdatedAt: survey.updatedAt, outcome: r.outcome, evidenceCount: r.evidenceIds.length, detail: r.detail, capturedAt: now },
        create: { surveyId, surveyUpdatedAt: survey.updatedAt, outcome: r.outcome, evidenceCount: r.evidenceIds.length, detail: r.detail, capturedAt: now },
      });
    /**
     * A failure never clears a recapture mark (late answers still to be taken in): without it, a
     * survey closed more than SWEEP_LOOKBACK_DAYS ago would never be tried again. Each step is one
     * statement that leaves a mark alone, so a mark set in between is not lost either.
     */
    const recordFailure = async (r: CaptureOutcome) => {
      const data = { outcome: r.outcome, evidenceCount: r.evidenceIds.length, detail: r.detail, capturedAt: now };
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const kept = await this.prisma.cqcSurveyCapture.updateMany({
          where: { surveyId, surveyUpdatedAt: CQC_RECAPTURE_MARK },
          data,
        });
        if (kept.count) return;
        const updated = await this.prisma.cqcSurveyCapture.updateMany({
          where: { surveyId, NOT: { surveyUpdatedAt: CQC_RECAPTURE_MARK } },
          data: { ...data, surveyUpdatedAt: survey.updatedAt },
        });
        if (updated.count) return;
        try {
          await this.prisma.cqcSurveyCapture.create({ data: { surveyId, surveyUpdatedAt: survey.updatedAt, ...data } });
          return;
        } catch (e) {
          // Created by another run in the meantime: go round again.
          if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        }
      }
    };

    if (survey.status !== SurveyStatus.CLOSED) {
      return {
        ...result,
        outcome: 'NOT_CLOSED',
        detail: 'Close the survey first: evidence is kept from closed surveys and closed periods only.',
      };
    }
    try {
      // Answers not linked to anyone still waiting to be written go in first (closed: all of them).
      await flushPendingResponses(this.prisma, { surveyIds: [surveyId], force: true, now, timeZone: await this.timeZone() });
      const framework = await this.framework.active();
      const plan = await this.statementPlan(survey, framework);
      if (!plan.statements.length) {
        const r: CaptureOutcome = {
          ...result,
          outcome: 'NO_STATEMENTS',
          detail: 'Choose which quality statements this survey evidences.',
        };
        await record(r);
        return r;
      }
      const categoryCode = this.categoryFor(survey, plan, framework);
      const [recipientGroups, responses, answeredWithoutName, chosenWithoutName, questions] = await Promise.all([
        this.prisma.surveyRecipient.groupBy({ by: ['status'], where: { surveyId }, _count: { _all: true } }),
        this.prisma.surveyResponse.count({ where: { surveyId } }),
        // Named surveys: answers not linked to anyone (the share answered without a name).
        survey.isAnonymous
          ? Promise.resolve(0)
          : this.prisma.surveyResponse.count({ where: { surveyId, isAnonymous: true } }),
        // ...of which given online by people who chose to (who they are can be seen).
        survey.isAnonymous
          ? Promise.resolve(0)
          : this.prisma.surveyResponse.count({ where: { surveyId, ...ANSWERED_WITHOUT_NAME } }),
        this.prisma.surveyQuestion.findMany({
          where: { surveyId, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, questionText: true, questionType: true, options: true, sectionTitle: true, sortOrder: true, key: true, config: true },
        }),
      ]);
      const recipients = recipientGroups.reduce((n, g) => n + g._count._all, 0);
      const completed = recipientGroups.filter((g) => g.status === 'COMPLETED').reduce((n, g) => n + g._count._all, 0);
      const scaleQuestions: MetricsQuestion[] = questions.filter((q) => positiveLabelsFor(q));
      // Only which options were chosen on scale questions: never text, numbers, notes or respondents.
      // Answers given without a name are left out while too few people answered that way: the
      // figures less everyone's named answers would be theirs (same rule as the survey results).
      // (Always closed here, so only the 5-people rule can apply.)
      const holdWithoutName = withoutNameAnswersHeldBack(survey.isAnonymous, chosenWithoutName, true);
      const answers = scaleQuestions.length
        ? await this.prisma.surveyAnswer.findMany({
            where: {
              response: holdWithoutName ? { surveyId, ...NOT_ANSWERED_WITHOUT_NAME } : { surveyId },
              questionId: { in: scaleQuestions.map((q) => q.id) },
            },
            select: { questionId: true, selectedOptions: true },
          })
        : [];

      const periodStart = survey.opensAt ?? survey.publishedAt ?? survey.createdAt;
      const periodEnd = survey.closesAt && survey.closesAt.getTime() <= now.getTime() ? survey.closesAt : survey.updatedAt;
      // Who it's for goes with the evidence ("Survey · Families and representatives").
      const forWhom = audienceGroupLabel(survey.targetKind, survey.audienceGroup, survey.audienceGroupOther);
      const sourceLabel = [survey.clonedFromId ? `Repeating survey, period ${survey.periodKey ?? ''}`.trim() : 'Survey', forWhom]
        .filter(Boolean)
        .join(' · ');

      // The survey's reporting threshold, never below CQC's own minimum.
      const threshold = Math.max(CQC_MIN_REPORTING_RESPONSES, await surveyThreshold(this.prisma, survey));
      for (const statement of plan.statements) {
        const metrics = buildSurveyMetrics({
          threshold,
          survey,
          libraryReference: plan.libraryReference,
          recipients,
          completed,
          responses,
          answeredWithoutName,
          questions: scaleQuestions,
          answers,
          questionIds: plan.questionIdsByStatement ? (plan.questionIdsByStatement.get(statement.id) ?? new Set()) : null,
          now,
        });
        const summary = surveyMetricsSummary(metrics);
        const sourceKey = surveySourceKey(survey.id, statement.id);
        const existing = await this.prisma.cqcEvidence.findUnique({ where: { sourceKey } });
        if (existing?.status === CqcEvidenceStatus.ARCHIVED) {
          result.skipped += 1;
          continue;
        }
        let evidenceId: string;
        if (existing) {
          const previous = readMetrics(existing.metrics);
          const autoSummary = previous ? surveyMetricsSummary(previous) : null;
          await this.prisma.cqcEvidence.update({
            where: { id: existing.id },
            data: {
              metrics: metrics as unknown as Prisma.InputJsonValue,
              // A summary someone rewrote is kept; the automatic one follows the figures.
              ...(existing.summary === null || existing.summary === autoSummary ? { summary } : {}),
              periodStart,
              periodEnd,
              locationIds: survey.locationIds,
              sourceLabel,
              ...(opts.actorId ? { updatedById: opts.actorId } : {}),
            },
          });
          evidenceId = existing.id;
          result.updated += 1;
        } else {
          const created = await this.prisma.cqcEvidence.create({
            data: {
              title: survey.title,
              summary,
              sourceType: CqcEvidenceSourceType.SURVEY_RESULT,
              sourceId: survey.id,
              sourceLabel,
              sourceKey,
              categoryCode,
              periodStart,
              periodEnd,
              locationIds: survey.locationIds,
              reviewDueAt: new Date(periodEnd.getTime() + 365 * DAY_MS),
              metrics: metrics as unknown as Prisma.InputJsonValue,
              actions: [],
              createdById: opts.actorId,
              updatedById: opts.actorId,
              statements: { create: [{ statementId: statement.id }] },
            },
          });
          evidenceId = created.id;
          result.created += 1;
        }
        result.evidenceIds.push(evidenceId);
        if (survey.clonedFromId) await this.supersedeEarlierPeriods(survey, statement.id, evidenceId, periodStart);
      }
      await this.audit.logAudit({
        userId: opts.actorId,
        module: AuditModule.CQC_EVIDENCE,
        action: AuditAction.CQC_EVIDENCE_CAPTURED_FROM_SURVEY,
        recordType: 'Survey',
        recordId: survey.id,
        metadata: {
          trigger: opts.trigger,
          statementSource: plan.source,
          libraryReference: plan.libraryReference,
          evidenceIds: result.evidenceIds,
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          responses,
        },
        ...(opts.meta ?? {}),
      });
      await record(result);
      // Late answers written while this capture was counting (an answer that raced the close, written
      // by the survey job) are not in these figures — and a flush before this capture was first
      // recorded had no capture to mark. Read after recording: waiting answers first, then the count,
      // so an answer written at any moment is seen by one or the other (or its flush marks the
      // capture itself). Either way the capture is taken again.
      const stillWaiting = await pendingResponseCount(this.prisma, surveyId);
      const responsesNow = await this.prisma.surveyResponse.count({ where: { surveyId } });
      if (stillWaiting > 0 || responsesNow !== responses) {
        await this.prisma.cqcSurveyCapture.updateMany({
          where: { surveyId },
          data: { surveyUpdatedAt: CQC_RECAPTURE_MARK },
        });
      }
      return result;
    } catch (err) {
      const r: CaptureOutcome = { ...result, outcome: 'FAILED', detail: (err as Error).message?.slice(0, 500) ?? 'Failed' };
      await recordFailure(r).catch(() => undefined);
      throw err;
    }
  }

  /** The newest period's evidence replaces earlier periods' evidence for the same statement. */
  private async supersedeEarlierPeriods(survey: Survey, statementId: string, evidenceId: string, periodStart: Date) {
    const earlier = await this.prisma.survey.findMany({
      where: {
        clonedFromId: survey.clonedFromId,
        id: { not: survey.id },
        OR: [{ opensAt: { lt: periodStart } }, { opensAt: null, createdAt: { lt: survey.createdAt } }],
      },
      select: { id: true },
    });
    if (!earlier.length) return;
    await this.prisma.cqcEvidence.updateMany({
      where: {
        sourceType: CqcEvidenceSourceType.SURVEY_RESULT,
        sourceId: { in: earlier.map((s) => s.id) },
        status: CqcEvidenceStatus.CURRENT,
        statements: { some: { statementId } },
      },
      data: { status: CqcEvidenceStatus.SUPERSEDED, supersededById: evidenceId },
    });
  }

  // ─── Statements for a survey ──────────────────────────────────────────────

  async statementPlan(survey: Survey, framework: ActiveFramework): Promise<StatementPlan> {
    const parent = survey.clonedFromId
      ? await this.prisma.survey.findUnique({ where: { id: survey.clonedFromId } })
      : null;
    const library = await this.findLibraryMeta([survey, parent].filter((s): s is Survey => Boolean(s)));
    const choice = await this.prisma.cqcSurveyStatementChoice.findFirst({
      where: { surveyId: { in: [survey.id, ...(survey.clonedFromId ? [survey.clonedFromId] : [])] } },
      orderBy: { updatedAt: 'desc' },
    });
    const base = {
      libraryReference: library?.reference ?? null,
      groupShort: library?.meta.group?.short ?? null,
      categoryCode: choice?.categoryCode ?? null,
    };
    if (choice?.statementIds.length) {
      const ids = new Set(await this.framework.inActiveVersion(choice.statementIds, framework));
      return {
        ...base,
        source: 'choice',
        statements: framework.statements.filter((s) => ids.has(s.id)),
        questionIdsByStatement: null,
        unmatched: [],
      };
    }
    if (!library) return { ...base, source: 'none', statements: [], questionIdsByStatement: null, unmatched: [] };

    const { matched, unmatched } = matchStatements(library.meta.cqc?.qualityStatements ?? [], framework.statements);
    // Questions evidence a statement when their section lists it (sections[].evidence).
    const questions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId: survey.id, deletedAt: null },
      select: { id: true, sectionTitle: true },
    });
    const bySection = new Map<string, string[]>();
    for (const q of questions) {
      if (!q.sectionTitle) continue;
      bySection.set(q.sectionTitle, [...(bySection.get(q.sectionTitle) ?? []), q.id]);
    }
    const questionIdsByStatement = new Map<string, Set<string>>();
    for (const section of library.meta.sections ?? []) {
      const ids = bySection.get(section.title) ?? [];
      for (const s of matchStatements(section.evidence ?? [], framework.statements).matched) {
        const set = questionIdsByStatement.get(s.id) ?? new Set<string>();
        ids.forEach((id) => set.add(id));
        questionIdsByStatement.set(s.id, set);
      }
    }
    return { ...base, source: 'library', statements: matched, questionIdsByStatement, unmatched };
  }

  /**
   * Ready-made survey details for a survey: on the survey itself, its repeating survey, or the
   * template it was started from (Survey.createdFromTemplateId; duplicates keep their source's
   * template). Followed at most three steps.
   */
  private async findLibraryMeta(start: Survey[]): Promise<{ meta: SurveyLibraryMeta; reference: string | null } | null> {
    const seen = new Set<string>();
    let frontier = start;
    for (let depth = 0; depth < 3 && frontier.length; depth += 1) {
      for (const s of frontier) {
        seen.add(s.id);
        const meta = libraryMetaOf(s.libraryMeta);
        if (meta) return { meta, reference: s.libraryReference };
      }
      const templateIds = frontier
        .map((s) => s.createdFromTemplateId)
        .filter((id): id is string => typeof id === 'string' && !seen.has(id));
      frontier = templateIds.length
        ? await this.prisma.survey.findMany({ where: { id: { in: [...new Set(templateIds)] }, isCatalogue: false } })
        : [];
    }
    return null;
  }

  private categoryFor(survey: Survey, plan: Pick<StatementPlan, 'categoryCode' | 'groupShort'>, framework: ActiveFramework): string {
    const wanted = plan.categoryCode ?? defaultSurveyCategory(survey.targetKind, plan.groupShort);
    return framework.categories.some((c) => c.code === wanted) ? wanted : (framework.categories[0]?.code ?? wanted);
  }

  /** Same rule as the survey list: branch-restricted users see surveys only for their branches. */
  private async requireVisibleSurvey(user: RequestUser, surveyId: string): Promise<Survey> {
    const survey = await this.prisma.survey.findFirst({
      where: { id: surveyId, deletedAt: null, isTemplate: false, isCatalogue: false },
    });
    if (!survey || !surveyVisible(this.orgScope.fromRequestUser(user), survey)) {
      throw new NotFoundException('Survey not found');
    }
    // Per-survey access: evidence is made from (and shows) the results.
    if (!(await surveyAccessFor(this.prisma, user, survey)).results) throw new ForbiddenException(RESULTS_RESTRICTED);
    return survey;
  }
}

export function surveyVisible(scope: OrgScope, survey: { locationIds: string[] }): boolean {
  if (scope.locationIds === null) return true;
  if (!survey.locationIds.length) return false;
  const allowed = new Set(scope.locationIds);
  return survey.locationIds.every((id) => allowed.has(id));
}

export type { CqcSurveyMetrics };
