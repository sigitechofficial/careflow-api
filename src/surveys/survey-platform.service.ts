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
  runMonthsOf,
  WORDING_RULE_LABELS,
  checkOptionGroups,
  checkRetentionMonths,
  checkRotation,
  checkSkipMonths,
  checkWording,
  estimateSeconds,
  libraryNotInMonths,
  closedAtOf,
  libraryRetention,
  readOptionGroups,
  retentionCutoff,
  retentionDue,
  type RetentionRule,
} from './survey-platform.util';

const RETENTION_BATCH = 20;
const RETENTION_PAGE = 500;
const RETENTION_SCAN_PAGES = 40;
const RETENTION_NOTE = 'Answers deleted under the retention period.';

const RETENTION_UNIT_SELECT = {
  id: true,
  title: true,
  status: true,
  clonedFromId: true,
  closesAt: true,
  updatedAt: true,
  deletedAt: true,
  answerRetentionMonths: true,
  libraryReference: true,
  libraryMeta: true,
} as const;
type RetentionUnit = Prisma.SurveyGetPayload<{ select: typeof RETENTION_UNIT_SELECT }>;
type RetentionOwner = { answerRetentionMonths: number | null; libraryReference: string | null; libraryMeta: Prisma.JsonValue };

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
    const library = libraryRetention(meta);
    const libraryMonths = library?.months ?? null;
    const effectiveMonths = owner.answerRetentionMonths ?? libraryMonths;
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
          effectiveMonths,
          /** Where the period starts: the close (FROM_CLOSE) or each answer (FROM_ANSWER), as the privacy notice says. */
          basis: effectiveMonths ? (library?.basis ?? 'FROM_CLOSE') : null,
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
      const anchor = survey.recurrenceAnchorAt ?? survey.distributeAt;
      if (months.length && survey.recurrence && anchor) {
        const runs = runMonthsOf(anchor, survey.recurrence, await this.surveys.organisationTimeZone());
        if (runs.every((m) => months.includes(m))) {
          throw new BadRequestException(`This survey only runs in ${runs.map((m) => MONTH_LABELS[m - 1]).join(', ')}: skipping ${runs.length === 1 ? 'that month' : 'all of them'} would stop it.`);
        }
      }
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

  /** The retention rule for a unit: the repeating / sending survey's own months, else the ready-made notice's. */
  private async retentionRuleFor(
    owner: { answerRetentionMonths: number | null; libraryReference: string | null; libraryMeta: Prisma.JsonValue },
    cache: Map<string, RetentionRule | null>,
  ): Promise<RetentionRule | null> {
    let library: RetentionRule | null;
    const ref = owner.libraryReference;
    if (!ref) library = libraryRetention(owner.libraryMeta);
    else {
      if (!cache.has(ref)) {
        const c = await this.prisma.survey.findFirst({ where: { isCatalogue: true, libraryReference: ref }, select: { libraryMeta: true } });
        cache.set(ref, libraryRetention(c?.libraryMeta ?? owner.libraryMeta));
      }
      library = cache.get(ref) ?? null;
    }
    // The organisation's own months keep the notice's starting point (what people were told); otherwise from the close.
    if (owner.answerRetentionMonths) return { months: owner.answerRetentionMonths, basis: library?.basis ?? 'FROM_CLOSE' };
    return library;
  }

  /**
   * Deletes answers kept longer than the retention period. FROM_CLOSE: all of a survey's (or period's) answers once it
   * has been closed that long. FROM_ANSWER (the notice counts from each answer, e.g. "after this call"): each answer
   * once it is that old, while the survey stays open, then the rest when the closed unit is due.
   *
   * Safeguards: a closed unit's CQC evidence (totals only) must be captured and up to date first; answers and follow-up
   * details linked to an open complaint, safeguarding case or incident are held until it closes; one server at a time
   * per unit (an advisory lock, then looked at again); the survey's updatedAt is left alone (it is what the CQC capture
   * and this job read as "changed"). Who it was sent to, the follow-ups and their outcomes are kept. Audited as counts.
   */
  async runRetention(now: Date = new Date()): Promise<{ units: number; responses: number }> {
    const cache = new Map<string, RetentionRule | null>();
    const owners = new Map<string, RetentionOwner | null>();
    let units = 0;
    let responses = 0;
    let after: string | null = null;
    // Every unit not yet fully deleted, a page at a time (units kept for ever must never hide later ones).
    for (let page = 0; page < RETENTION_SCAN_PAGES && units < RETENTION_BATCH; page += 1) {
      const rows: RetentionUnit[] = await this.prisma.survey.findMany({
        where: {
          answersDeletedAt: null,
          isTemplate: false,
          isCatalogue: false,
          status: { in: ['ACTIVE', 'CLOSED'] },
          ...(after ? { id: { gt: after } } : {}),
        },
        select: RETENTION_UNIT_SELECT,
        orderBy: { id: 'asc' },
        take: RETENTION_PAGE,
      });
      if (!rows.length) break;
      after = rows[rows.length - 1]!.id;
      const missing = [...new Set(rows.map((r) => r.clonedFromId).filter((x): x is string => Boolean(x) && !owners.has(x as string)))];
      if (missing.length) {
        const found = await this.prisma.survey.findMany({ where: { id: { in: missing } }, select: { id: true, answerRetentionMonths: true, libraryReference: true, libraryMeta: true } });
        for (const id of missing) owners.set(id, found.find((f) => f.id === id) ?? null);
      }
      for (const u of rows) {
        if (units >= RETENTION_BATCH) break;
        const owner = (u.clonedFromId && owners.get(u.clonedFromId)) || u;
        const rule = await this.retentionRuleFor(owner, cache);
        if (!rule) continue;
        const whole = u.status === 'CLOSED' && retentionDue(closedAtOf(u), rule.months) <= now;
        if (!whole && rule.basis !== 'FROM_ANSWER') continue;
        try {
          const done = await this.retainUnit(u, rule, whole, now);
          if (!done) continue;
          units += 1;
          responses += done.responses;
          await this.audit.logAudit({
            userId: undefined,
            module: AuditModule.SURVEY,
            action: AuditAction.SURVEY_ANSWERS_DELETED_RETENTION,
            recordType: 'Survey',
            recordId: u.id,
            description: whole
              ? `Answers to "${u.title}" deleted under the retention period (${rule.months} months after it closed)`
              : `Answers to "${u.title}" given more than ${rule.months} months ago deleted under the retention period`,
            // Counts only: never who answered or what.
            newValues: {
              responses: done.responses,
              waiting: done.waiting,
              followUps: done.followUps,
              callNotes: done.callNotes,
              held: done.held,
              months: rule.months,
              basis: rule.basis,
              whole: whole && !done.held,
            },
          });
        } catch (e) {
          this.logger.warn(`Survey ${u.id}: answers not deleted under retention (${e instanceof Error ? e.name : 'error'})`);
        }
      }
      if (rows.length < RETENTION_PAGE) break;
    }
    return { units, responses };
  }

  /**
   * One unit, in one transaction under its own lock. Null when there was nothing to do (or it is not safe yet).
   * whole: everything (the closed unit is due); otherwise answers given on or before the cut-off only.
   */
  private async retainUnit(u: RetentionUnit, rule: RetentionRule, whole: boolean, now: Date) {
    const cutoff = retentionCutoff(now, rule.months);
    const answered = whole ? {} : { submittedAt: { lte: cutoff } };
    const waitingWhere = { surveyId: u.id, ...(whole ? {} : { createdAt: { lte: cutoff } }) };
    // A quick look first (most units, most hours, have nothing due), outside the lock.
    const [due, waitingDue] = await Promise.all([
      this.prisma.surveyResponse.count({ where: { surveyId: u.id, ...answered } }),
      this.prisma.surveyPendingResponse.count({ where: waitingWhere }),
    ]);
    if (!whole && !due && !waitingDue) return null;
    // A closed unit's CQC evidence (totals) is kept first: captured, and not waiting to be taken again.
    if (u.status === 'CLOSED' && !u.deletedAt && (due || waitingDue)) {
      const capture = await this.prisma.cqcSurveyCapture.findUnique({ where: { surveyId: u.id }, select: { outcome: true, surveyUpdatedAt: true } });
      const upToDate =
        Boolean(capture) &&
        (capture!.outcome === 'CAPTURED' || capture!.outcome === 'NO_STATEMENTS') &&
        capture!.surveyUpdatedAt.getTime() >= u.updatedAt.getTime();
      if (!upToDate) return null;
    }
    const held = await this.legalHolds(u.id);
    return this.prisma.$transaction(async (tx) => {
      // One server at a time per unit; then look again (another may have just done it).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`survey-retention:${u.id}`}))`;
      const fresh = await tx.survey.findUnique({ where: { id: u.id }, select: { answersDeletedAt: true, updatedAt: true } });
      if (!fresh || fresh.answersDeletedAt) return null;
      const ids = (
        await tx.surveyResponse.findMany({
          where: { surveyId: u.id, ...answered, ...(held.responseIds.length ? { id: { notIn: held.responseIds } } : {}) },
          select: { id: true },
        })
      ).map((r) => r.id);
      if (ids.length) await tx.surveyAnswer.deleteMany({ where: { responseId: { in: ids } } });
      const r = ids.length ? await tx.surveyResponse.deleteMany({ where: { id: { in: ids } } }) : { count: 0 };
      const w = await tx.surveyPendingResponse.deleteMany({ where: waitingWhere });
      // Follow-ups stay (what was done is a record of its own); the answers they quoted go. Answers linked to no one
      // are grouped by day: those raised on or before the cut-off.
      const f = await tx.surveyAlert.updateMany({
        where: {
          surveyId: u.id,
          NOT: { details: RETENTION_NOTE },
          ...(held.alertIds.length ? { id: { notIn: held.alertIds } } : {}),
          ...(whole ? {} : { OR: [{ responseId: { in: ids } }, { responseId: null, createdAt: { lte: cutoff } }] }),
        },
        data: { details: RETENTION_NOTE, matched: [] },
      });
      // Notes taken on calls can hold what the person said: the call and its outcome stay, the notes go.
      const c = await tx.surveyCallAttempt.updateMany({
        where: { surveyId: u.id, notes: { not: null }, ...(whole ? {} : { createdAt: { lte: cutoff } }) },
        data: { notes: null },
      });
      const heldCount = held.responseIds.length + held.alertIds.length;
      // Fully deleted only when nothing is held. updatedAt is kept as it was: not a change to the survey.
      const finished = whole && !heldCount;
      if (finished) {
        await tx.survey.updateMany({ where: { id: u.id, answersDeletedAt: null }, data: { answersDeletedAt: now, updatedAt: fresh.updatedAt } });
      }
      if (!r.count && !w.count && !f.count && !c.count && !finished) return null;
      return { responses: r.count, waiting: w.count, followUps: f.count, callNotes: c.count, held: heldCount };
    });
  }

  /**
   * Legal holds: follow-ups linked to a complaint, safeguarding case or incident that is still open. Their answers
   * (named ones) and quoted details are kept until it closes; everything else follows the retention period.
   */
  private async legalHolds(surveyId: string): Promise<{ responseIds: string[]; alertIds: string[] }> {
    const linked = await this.prisma.surveyAlert.findMany({
      where: { surveyId, linkedRecordId: { not: null }, linkedRecordType: { in: ['COMPLAINT', 'SAFEGUARDING', 'INCIDENT'] } },
      select: { id: true, responseId: true, linkedRecordType: true, linkedRecordId: true },
    });
    if (!linked.length) return { responseIds: [], alertIds: [] };
    const idsOf = (t: string) => linked.filter((a) => a.linkedRecordType === t).map((a) => a.linkedRecordId!);
    const none: Array<{ id: string }> = [];
    const [complaints, cases, incidents] = await Promise.all([
      idsOf('COMPLAINT').length
        ? this.prisma.feedbackRecord.findMany({ where: { id: { in: idsOf('COMPLAINT') }, deletedAt: null, status: { not: 'CLOSED' } }, select: { id: true } })
        : none,
      idsOf('SAFEGUARDING').length
        ? this.prisma.safeguardingCase.findMany({ where: { id: { in: idsOf('SAFEGUARDING') }, deletedAt: null, status: { not: 'CLOSED' } }, select: { id: true } })
        : none,
      idsOf('INCIDENT').length
        ? this.prisma.incident.findMany({ where: { id: { in: idsOf('INCIDENT') }, deletedAt: null, status: { not: 'CLOSED' } }, select: { id: true } })
        : none,
    ]);
    const open = new Set([...complaints, ...cases, ...incidents].map((x) => x.id));
    const holding = linked.filter((a) => open.has(a.linkedRecordId!));
    return { responseIds: holding.map((a) => a.responseId).filter((x): x is string => Boolean(x)), alertIds: holding.map((a) => a.id) };
  }
}
