import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Survey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveysService } from './surveys.service';
import {
  MONTH_LABELS,
  WORDING_RULE_LABELS,
  checkOptionGroups,
  checkRetentionMonths,
  checkRotation,
  checkSkipMonths,
  checkWording,
  estimateSeconds,
  libraryNotInMonths,
  libraryRetentionMonths,
  readOptionGroups,
  retentionDue,
} from './survey-platform.util';

const RETENTION_BATCH = 20;
const RETENTION_NOTE = 'Answers deleted under the retention period.';

/**
 * Platform items (Phase 2 part 7): repeat months, the rotating question, answer retention, grouped answer choices
 * and the wording checker. The repeat and period work itself is in SurveysService (runRecurringPeriod).
 */
@Injectable()
export class SurveyPlatformService {
  private readonly logger = new Logger(SurveyPlatformService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly surveys: SurveysService,
    private readonly audit: AuditLogsService,
  ) {}

  private async requireSurvey(actor: RequestUser, surveyId: string): Promise<Survey> {
    const s = await this.surveys.visibleSurvey(actor, surveyId);
    if (!s || s.isCatalogue) throw new NotFoundException('Survey not found');
    return s;
  }

  private async libraryMetaOf(s: Survey): Promise<unknown> {
    if (!s.libraryReference) return s.libraryMeta;
    const c = await this.prisma.survey.findFirst({ where: { isCatalogue: true, libraryReference: s.libraryReference }, select: { libraryMeta: true } });
    return c?.libraryMeta ?? s.libraryMeta;
  }

  // ─── Settings ───────────────────────────────────────────────────────────

  async getSettings(actor: RequestUser, surveyId: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    const owner = survey.clonedFromId ? ((await this.prisma.survey.findUnique({ where: { id: survey.clonedFromId } })) ?? survey) : survey;
    const meta = await this.libraryMetaOf(owner);
    const libraryMonths = libraryRetentionMonths(meta);
    const periods = await this.prisma.survey.findMany({ where: { clonedFromId: owner.id, deletedAt: null }, select: { id: true, answersDeletedAt: true } });
    return {
      message: 'Repeats, retention and checks',
      data: {
        surveyId: owner.id,
        editedOnSurveyId: owner.id !== survey.id ? owner.id : null,
        repeating: Boolean(owner.recurrence),
        recurrence: owner.recurrence,
        skipMonths: owner.recurrenceSkipMonths ?? [],
        librarySkipMonths: libraryNotInMonths(meta),
        months: MONTH_LABELS,
        rotatingQuestionIds: owner.rotatingQuestionIds ?? [],
        retention: {
          months: owner.answerRetentionMonths ?? null,
          libraryMonths,
          effectiveMonths: owner.answerRetentionMonths ?? libraryMonths,
          deletedAt: owner.answersDeletedAt?.toISOString() ?? null,
          periodsDeleted: periods.filter((p) => p.answersDeletedAt).length,
        },
      },
    };
  }

  async saveSettings(
    actor: RequestUser,
    surveyId: string,
    input: { skipMonths?: unknown; rotatingQuestionIds?: unknown; answerRetentionMonths?: unknown },
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.requireSurvey(actor, surveyId);
    if (survey.clonedFromId) throw new BadRequestException('Change these on the repeating survey, not on one period.');
    const data: Prisma.SurveyUpdateInput = { updatedById: actor.id };
    if (input.skipMonths !== undefined) {
      const months = checkSkipMonths(input.skipMonths);
      if (months.length && !survey.recurrence) throw new BadRequestException('Only a repeating survey can skip months.');
      data.recurrenceSkipMonths = months;
    }
    if (input.rotatingQuestionIds !== undefined) {
      if (!survey.recurrence && !survey.eventTrigger && Array.isArray(input.rotatingQuestionIds) && input.rotatingQuestionIds.length) {
        throw new BadRequestException('Only a repeating survey (or one sent after events) can rotate questions.');
      }
      const questions = await this.prisma.surveyQuestion.findMany({
        where: { surveyId, deletedAt: null },
        select: { id: true, key: true, questionText: true, questionType: true, showIf: true, sortOrder: true },
      });
      data.rotatingQuestionIds = checkRotation(input.rotatingQuestionIds, questions);
    }
    if (input.answerRetentionMonths !== undefined) data.answerRetentionMonths = checkRetentionMonths(input.answerRetentionMonths);
    await this.prisma.survey.update({ where: { id: survey.id }, data });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_PLATFORM_SETTINGS_CHANGED,
      recordType: 'Survey',
      recordId: survey.id,
      description: `Repeats, retention or rotating question changed on survey "${survey.title}"`,
      oldValues: { skipMonths: survey.recurrenceSkipMonths, rotating: survey.rotatingQuestionIds.length, answerRetentionMonths: survey.answerRetentionMonths },
      newValues: {
        ...(data.recurrenceSkipMonths !== undefined ? { skipMonths: data.recurrenceSkipMonths } : {}),
        ...(data.rotatingQuestionIds !== undefined ? { rotating: (data.rotatingQuestionIds as string[]).length } : {}),
        ...(data.answerRetentionMonths !== undefined ? { answerRetentionMonths: data.answerRetentionMonths } : {}),
      },
      ...(meta ?? {}),
    });
    return this.getSettings(actor, surveyId);
  }

  // ─── Grouped answer choices ─────────────────────────────────────────────

  async setOptionGroups(actor: RequestUser, surveyId: string, questionId: string, groups: unknown, meta?: RequestAuditMeta) {
    const survey = await this.requireSurvey(actor, surveyId);
    if (survey.clonedFromId) throw new BadRequestException('Change this on the repeating survey, not on one period.');
    const q = await this.prisma.surveyQuestion.findFirst({ where: { id: questionId, surveyId, deletedAt: null } });
    if (!q) throw new NotFoundException('Question not found');
    if (q.optionsFrom) throw new BadRequestException('Answers from a CareFlow list are already grouped by the list.');
    const options = Array.isArray(q.options) ? (q.options as unknown[]).filter((o): o is string => typeof o === 'string') : [];
    const checked = checkOptionGroups(groups, q.questionType, options);
    const value = checked ? (checked as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
    await this.prisma.surveyQuestion.update({ where: { id: q.id }, data: { optionGroups: value } });
    // Open period copies show the same headings (closed ones keep what people saw).
    await this.prisma.surveyQuestion.updateMany({
      where: { sourceQuestionId: q.id, deletedAt: null, survey: { clonedFromId: surveyId, status: { not: 'CLOSED' } } },
      data: { optionGroups: value },
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_PLATFORM_SETTINGS_CHANGED,
      recordType: 'SurveyQuestion',
      recordId: q.id,
      description: checked ? `Answers grouped under ${checked.length} headings` : 'Answer groups removed',
      newValues: { surveyId, groups: checked?.map((g) => ({ heading: g.heading, options: g.options.length })) ?? [] },
      ...(meta ?? {}),
    });
    return { message: checked ? 'Groups saved' : 'Groups removed', data: { questionId: q.id, optionGroups: readOptionGroups(checked) } };
  }

  // ─── Wording checker ────────────────────────────────────────────────────

  async wordingCheck(actor: RequestUser, surveyId: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    const questions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, questionText: true, questionType: true, options: true, config: true, isRequired: true, sectionTitle: true },
    });
    const findings = checkWording({ description: survey.description, isAnonymous: survey.isAnonymous }, questions);
    return {
      message: 'Wording check',
      data: {
        surveyId,
        fromLibrary: Boolean(survey.libraryReference),
        estimatedMinutes: Math.ceil(estimateSeconds(questions) / 60),
        problems: findings.filter((f) => f.severity === 'PROBLEM').length,
        suggestions: findings.filter((f) => f.severity === 'SUGGESTION').length,
        findings: findings.map((f) => ({ ...f, ruleLabel: WORDING_RULE_LABELS[f.rule] })),
      },
    };
  }

  // ─── Answer retention (the survey job) ──────────────────────────────────

  /**
   * Deletes the answers of surveys (and periods) closed for longer than their retention period. Who it was sent to,
   * the follow-ups (their written details replaced) and CQC evidence (totals only) are kept. Audited as counts.
   */
  async runRetention(now: Date = new Date()): Promise<{ units: number; responses: number }> {
    const closed = await this.prisma.survey.findMany({
      where: { status: 'CLOSED', answersDeletedAt: null, isTemplate: false, isCatalogue: false, closesAt: { not: null, lt: now } },
      select: { id: true, title: true, clonedFromId: true, closesAt: true, answerRetentionMonths: true, libraryReference: true, libraryMeta: true },
      orderBy: { closesAt: 'asc' },
      take: 500,
    });
    const owners = new Map<string, { answerRetentionMonths: number | null; libraryReference: string | null; libraryMeta: Prisma.JsonValue }>();
    const ownerIds = [...new Set(closed.map((c) => c.clonedFromId).filter((x): x is string => Boolean(x)))];
    for (const o of ownerIds.length ? await this.prisma.survey.findMany({ where: { id: { in: ownerIds } }, select: { id: true, answerRetentionMonths: true, libraryReference: true, libraryMeta: true } }) : []) owners.set(o.id, o);
    const libraryCache = new Map<string, number | null>();
    const monthsFor = async (u: (typeof closed)[number]) => {
      const owner = (u.clonedFromId && owners.get(u.clonedFromId)) || u;
      if (owner.answerRetentionMonths) return owner.answerRetentionMonths;
      const ref = owner.libraryReference;
      if (!ref) return libraryRetentionMonths(owner.libraryMeta);
      if (!libraryCache.has(ref)) {
        const c = await this.prisma.survey.findFirst({ where: { isCatalogue: true, libraryReference: ref }, select: { libraryMeta: true } });
        libraryCache.set(ref, libraryRetentionMonths(c?.libraryMeta ?? owner.libraryMeta));
      }
      return libraryCache.get(ref) ?? null;
    };
    let units = 0;
    let responses = 0;
    for (const u of closed) {
      if (units >= RETENTION_BATCH) break;
      const months = await monthsFor(u);
      if (!months || retentionDue(u.closesAt!, months) > now) continue;
      try {
        const deleted = await this.prisma.$transaction(async (tx) => {
          const ids = (await tx.surveyResponse.findMany({ where: { surveyId: u.id }, select: { id: true } })).map((r) => r.id);
          await tx.surveyAnswer.deleteMany({ where: { responseId: { in: ids } } });
          const r = await tx.surveyResponse.deleteMany({ where: { surveyId: u.id } });
          await tx.surveyPendingResponse.deleteMany({ where: { surveyId: u.id } });
          // Follow-ups stay (what was done is a record of its own); the answers they quoted go.
          await tx.surveyAlert.updateMany({ where: { surveyId: u.id }, data: { details: RETENTION_NOTE, matched: [] } });
          await tx.survey.update({ where: { id: u.id }, data: { answersDeletedAt: now } });
          return r.count;
        });
        units += 1;
        responses += deleted;
        await this.audit.logAudit({
          userId: undefined,
          module: AuditModule.SURVEY,
          action: AuditAction.SURVEY_ANSWERS_DELETED_RETENTION,
          recordType: 'Survey',
          recordId: u.id,
          description: `Answers to "${u.title}" deleted under the retention period (${months} months after it closed)`,
          newValues: { responses: deleted, months },
        });
      } catch (e) {
        this.logger.warn(`Survey ${u.id}: answers not deleted under retention (${e instanceof Error ? e.name : 'error'})`);
      }
    }
    return { units, responses };
  }
}

