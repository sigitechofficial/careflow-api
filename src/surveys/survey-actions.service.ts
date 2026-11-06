import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationModule, NotificationSeverity, NotificationType, Prisma, RoleTaskStatus, type Survey } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { NotificationsService } from '../notifications/notifications.service';
import { readActions } from '../cqc-evidence/cqc-evidence.service';
import { SurveyInsightService } from './survey-insight.service';
import { SurveysService } from './surveys.service';
import { surveyAccessFor, surveyResultsAudience, type SurveyAccess } from './survey-access';
import { writtenPartsOf } from './survey-text-themes.util';
import { unitHiddenReason } from './survey-insight.util';
import { offersAnswerWithoutName } from './survey-respondent-anonymity.util';
import {
  ACTION_SOURCES,
  ACTION_STATUSES,
  ACTION_TASK_SOURCE,
  DISCUSSION_KINDS,
  YSWD_CHANNELS,
  YSWD_MAX_ITEMS,
  YSWD_TEXT_MAX,
  figureWords,
  mergeEvidenceActions,
  carriedForward,
  CARRY_FORWARD_MONTHS,
  quotesWrittenAnswer,
  readItems,
  type ActionSource,
  type ActionStatus,
  type DiscussionKind,
  type YswdChannel,
  type YswdItem,
} from './survey-actions.util';

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isoDay = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null);

export type ActionInput = {
  source?: string;
  sourceKey?: string | null;
  periodId?: string | null;
  discussionId?: string | null;
  title?: string;
  detail?: string | null;
  ownerRoleId?: string;
  ownerUserId?: string | null;
  dueOn?: string;
  status?: string;
  outcome?: string | null;
  youSaid?: string | null;
  weDid?: string | null;
  evidenceNote?: string | null;
};

type ActionRow = Prisma.SurveyActionGetPayload<object>;
/** The survey job carries done actions forward a page at a time. */
const CARRY_FORWARD_PAGE = 500;

/**
 * Acting on results (Phase 2 part 6): actions (a RoleTask each, feeding CQC evidence), team discussion records,
 * "You said, we did" (portal, carer app, letter, public page) and the CQC and commissioner pack. Every figure comes
 * from the figures engine (part 5); answer text is never copied anywhere.
 */
@Injectable()
export class SurveyActionsService {
  private readonly logger = new Logger(SurveyActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly surveys: SurveysService,
    private readonly insight: SurveyInsightService,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Access ─────────────────────────────────────────────────────────────

  /** The repeating survey (or the survey) actions are kept on; results access needed. */
  private async ownerSurvey(actor: RequestUser, surveyId: string): Promise<{ survey: Survey; owner: Survey; access: SurveyAccess }> {
    const { survey, access } = await this.insight.requireResults(actor, surveyId);
    const owner = survey.clonedFromId ? ((await this.prisma.survey.findUnique({ where: { id: survey.clonedFromId } })) ?? survey) : survey;
    return { survey, owner, access };
  }

  private canManage(actor: RequestUser) {
    return actor.permissions.includes('surveys.manage');
  }

  private assertManage(actor: RequestUser) {
    if (!this.canManage(actor)) throw new ForbiddenException('Only people who manage surveys can do this.');
  }

  private async periodOf(owner: Survey, periodId: string | null | undefined): Promise<Survey | null> {
    if (!periodId || periodId === owner.id) return null;
    const p = await this.prisma.survey.findFirst({ where: { id: periodId, clonedFromId: owner.id, deletedAt: null } });
    if (!p) throw new BadRequestException('That period is not part of this survey.');
    return p;
  }

  /** A task's words: generic when the survey's answers are limited or it is anonymous (a title can point at someone). */
  private async taskText(owner: Survey, title: string) {
    const audience = await surveyResultsAudience(this.prisma, owner);
    const restricted = audience.restricted || owner.isAnonymous;
    return restricted
      ? { title: 'An action from survey results', description: 'An action agreed from survey results is yours. Open the page to see it (only people allowed to see the results can), and record what was done there.' }
      : { title: `Survey action: ${title}`.slice(0, 200), description: `An action agreed from the results of "${owner.title}". Open the page to see it, and record what was done there.` };
  }

  // ─── Listing ────────────────────────────────────────────────────────────

  async overview(actor: RequestUser, surveyId: string) {
    const { owner, access } = await this.ownerSurvey(actor, surveyId);
    const [actions, discussions, updates] = await Promise.all([
      this.prisma.surveyAction.findMany({ where: { surveyId: owner.id }, orderBy: [{ status: 'asc' }, { dueOn: 'asc' }] }),
      this.prisma.surveyDiscussion.findMany({ where: { surveyId: owner.id }, orderBy: { heldOn: 'desc' } }),
      this.prisma.surveyYouSaidWeDid.findMany({ where: { surveyId: owner.id }, orderBy: { createdAt: 'desc' } }),
    ]);
    const roleIds = [...new Set(actions.map((a) => a.ownerRoleId))];
    const userIds = [...new Set(actions.map((a) => a.ownerUserId).filter((x): x is string => Boolean(x)))];
    const [roles, users] = await Promise.all([
      this.prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const trends = (await this.insight.trends(actor, owner.id)).data;
    return {
      message: 'Acting on results',
      data: {
        surveyId: owner.id,
        title: owner.title,
        canManage: this.canManage(actor),
        responsesAccess: access.responses,
        periods: trends.units.map((u) => ({ id: u.id, label: u.label, shown: u.shown })),
        /** Questions to raise an action from: their figure across the shown periods (the figure as Results shows it). */
        questions: trends.questions.map((q) => ({ key: q.key, questionText: q.questionText, figure: figureWords(q.pooled), percent: q.pooled && q.pooled.kind !== 'AVERAGE' ? q.pooled.percent : null })),
        actions: actions.map((a) => ({
          id: a.id,
          periodId: a.periodId,
          source: a.source,
          sourceLabel: a.sourceLabel,
          discussionId: a.discussionId,
          title: a.title,
          detail: a.detail,
          ownerRoleId: a.ownerRoleId,
          ownerRole: roles.find((r) => r.id === a.ownerRoleId)?.name ?? null,
          ownerUserId: a.ownerUserId,
          ownerName: ((u) => (u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || null : null))(users.find((u) => u.id === a.ownerUserId)),
          dueOn: day(a.dueOn),
          overdue: (a.status === 'OPEN' || a.status === 'IN_PROGRESS') && day(a.dueOn)! < today,
          status: a.status,
          outcome: a.outcome,
          youSaid: a.youSaid,
          weDid: a.weDid,
          evidenceNote: a.evidenceNote,
          completedOn: day(a.completedAt),
        })),
        discussions: discussions.map((d) => ({
          id: d.id,
          periodId: d.periodId,
          heldOn: day(d.heldOn),
          kind: d.kind,
          kindLabel: DISCUSSION_KINDS[d.kind as DiscussionKind] ?? d.kind,
          attendees: d.attendees,
          summary: d.summary,
          agreed: d.agreed,
        })),
        youSaidWeDid: updates.map((u) => this.serializeUpdate(u)),
        /** Roles an action can be given to. */
        roles: this.canManage(actor) ? await this.prisma.role.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
        /** Themes to raise an action from (counts only, as shown). */
        themes: (await this.insight.themes(actor, owner.id)).data.themes.map((t) => ({ code: t.code, label: t.label, count: t.count })),
        discussionKinds: Object.entries(DISCUSSION_KINDS).map(([code, label]) => ({ code, label })),
      },
    };
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  private async sourceLabel(actor: RequestUser, owner: Survey, source: ActionSource, key: string | null, discussionId: string | null): Promise<string | null> {
    if (source === 'GENERAL') return null;
    if (source === 'QUESTION') {
      const line = (await this.insight.trends(actor, owner.id)).data.questions.find((q) => q.key === key);
      if (!line) throw new BadRequestException('That question has no figures to raise an action from.');
      return `${line.questionText}: ${figureWords(line.pooled)}`.slice(0, 400);
    }
    if (source === 'THEME') {
      const themes = (await this.insight.themes(actor, owner.id)).data.themes;
      const t = themes.find((x) => x.code === key);
      if (!t) throw new BadRequestException('That theme is not shown for this survey.');
      return `People wrote about: ${t.label}${t.count !== null ? ` (${t.count} mentions)` : ''}`;
    }
    if (source === 'ALERT') {
      const alert = key ? await this.prisma.surveyAlert.findFirst({ where: { id: key, OR: [{ surveyId: owner.id }, { survey: { clonedFromId: owner.id } }] }, select: { rule: { select: { title: true } } } }) : null;
      if (!alert) throw new BadRequestException('That alert is not on this survey.');
      // The rule's title only: an alert's own title can name the person.
      return `From a survey alert: ${alert.rule?.title ?? 'an alert'}`;
    }
    const d = discussionId ? await this.prisma.surveyDiscussion.findFirst({ where: { id: discussionId, surveyId: owner.id } }) : null;
    if (!d) throw new BadRequestException('That discussion is not on this survey.');
    return `Agreed at a ${(DISCUSSION_KINDS[d.kind as DiscussionKind] ?? 'meeting').toLowerCase()} on ${day(d.heldOn)}`;
  }

  private async checkOwner(roleId: string | undefined, userId: string | null | undefined) {
    if (!roleId) throw new BadRequestException('Choose the role that owns this action.');
    const role = await this.prisma.role.findFirst({ where: { id: roleId, deletedAt: null, isActive: true }, select: { id: true } });
    if (!role) throw new BadRequestException('That role no longer exists.');
    if (userId) {
      const holds = await this.prisma.userRole.findFirst({ where: { userId, roleId, user: { deletedAt: null, isActive: true } }, select: { userId: true } });
      if (!holds) throw new BadRequestException('The person chosen does not hold that role.');
    }
  }

  async createAction(actor: RequestUser, surveyId: string, input: ActionInput, meta?: RequestAuditMeta) {
    this.assertManage(actor);
    const { owner } = await this.ownerSurvey(actor, surveyId);
    const source = (ACTION_SOURCES as readonly string[]).includes(input.source ?? 'GENERAL') ? ((input.source ?? 'GENERAL') as ActionSource) : null;
    if (!source) throw new BadRequestException('Choose where the action came from.');
    const title = text(input.title, 200);
    if (title.length < 3) throw new BadRequestException('Give the action a short title.');
    const dueOn = isoDay(input.dueOn);
    if (!dueOn) throw new BadRequestException('Give a due date.');
    await this.checkOwner(input.ownerRoleId, input.ownerUserId ?? null);
    const period = await this.periodOf(owner, input.periodId);
    const label = await this.sourceLabel(actor, owner, source, input.sourceKey ?? null, input.discussionId ?? null);
    await this.assertNoQuotes(owner, [['The title', title], ['"You said"', input.youSaid], ['"We did"', input.weDid]]);
    const id = randomUUID();
    const taskId = randomUUID();
    const task = await this.taskText(owner, title);
    await this.prisma.$transaction(async (tx) => {
      await tx.roleTask.create({
        data: {
          id: taskId,
          templateId: null,
          sourceType: ACTION_TASK_SOURCE,
          sourceId: id,
          roleId: input.ownerRoleId!,
          locationId: owner.locationIds.length === 1 ? owner.locationIds[0] : null,
          ...task,
          link: `/surveys/${owner.id}/actions?action=${id}`,
          dueDate: dueOn,
        },
      });
      await tx.surveyAction.create({
        data: {
          id,
          surveyId: owner.id,
          periodId: period?.id ?? null,
          source,
          sourceKey: source === 'GENERAL' || source === 'DISCUSSION' ? null : (input.sourceKey ?? null),
          sourceLabel: label,
          discussionId: source === 'DISCUSSION' ? (input.discussionId ?? null) : null,
          title,
          detail: text(input.detail, 2000) || null,
          ownerRoleId: input.ownerRoleId!,
          ownerUserId: input.ownerUserId ?? null,
          roleTaskId: taskId,
          dueOn,
          youSaid: text(input.youSaid, YSWD_TEXT_MAX) || null,
          weDid: text(input.weDid, YSWD_TEXT_MAX) || null,
          locationIds: owner.locationIds,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_ACTION_CREATED,
      recordType: 'SurveyAction',
      recordId: id,
      description: `Action added from survey results`,
      newValues: { surveyId: owner.id, source, dueOn: day(dueOn), ownerRoleId: input.ownerRoleId },
      ...(meta ?? {}),
    });
    await this.notifyOwner(owner, id, input.ownerUserId ?? null, actor.id);
    return { message: 'Action added', data: { id } };
  }

  private async notifyOwner(owner: Survey, actionId: string, userId: string | null, by: string) {
    if (!userId || userId === by) return;
    try {
      const generic = (await this.taskText(owner, '')).title === 'An action from survey results';
      await this.notifications.notifyUsers({
        recipientUserIds: [userId],
        type: NotificationType.SYSTEM_MESSAGE,
        module: NotificationModule.SYSTEM,
        severity: NotificationSeverity.INFO,
        title: 'A survey action is yours',
        message: generic ? 'An action agreed from survey results has been given to you.' : `An action agreed from the results of "${owner.title}" has been given to you.`,
        recordType: 'SurveyAction',
        recordId: actionId,
        metadata: { href: `/surveys/${owner.id}/actions?action=${actionId}`, eventType: 'SURVEY_ACTION_ASSIGNED' },
      });
    } catch (e) {
      this.logger.warn(`Survey action ${actionId}: notice not sent (${e instanceof Error ? e.name : 'error'})`);
    }
  }

  private async requireAction(actor: RequestUser, actionId: string) {
    const action = await this.prisma.surveyAction.findUnique({ where: { id: actionId } });
    if (!action) throw new NotFoundException('Action not found');
    const { owner } = await this.ownerSurvey(actor, action.surveyId).catch(() => {
      throw new NotFoundException('Action not found');
    });
    return { action, owner };
  }

  /** Change an action. Managers change anything; the owner (or anyone in the owner role) records progress and closes it. */
  async updateAction(actor: RequestUser, actionId: string, input: ActionInput, meta?: RequestAuditMeta) {
    const { action, owner } = await this.requireAction(actor, actionId);
    const manage = this.canManage(actor);
    const inRole = Boolean(await this.prisma.userRole.findFirst({ where: { userId: actor.id, roleId: action.ownerRoleId }, select: { userId: true } }));
    if (!manage && action.ownerUserId !== actor.id && !inRole) throw new ForbiddenException('This action belongs to another role.');
    const data: Prisma.SurveyActionUpdateInput = { updatedById: actor.id };
    const managerOnly = ['title', 'detail', 'ownerRoleId', 'ownerUserId', 'dueOn'] as const;
    if (!manage && managerOnly.some((k) => input[k] !== undefined)) throw new ForbiddenException('Only people who manage surveys can change the action itself.');
    if (!manage && action.status === 'CANCELLED') throw new ForbiddenException('A cancelled action can only be reopened by someone who manages surveys.');
    if (input.title !== undefined) {
      const t = text(input.title, 200);
      if (t.length < 3) throw new BadRequestException('Give the action a short title.');
      data.title = t;
    }
    if (input.detail !== undefined) data.detail = text(input.detail, 2000) || null;
    if (input.ownerRoleId !== undefined || input.ownerUserId !== undefined) {
      await this.checkOwner(input.ownerRoleId ?? action.ownerRoleId, input.ownerUserId === undefined ? action.ownerUserId : input.ownerUserId);
      if (input.ownerRoleId) data.ownerRoleId = input.ownerRoleId;
      if (input.ownerUserId !== undefined) data.ownerUserId = input.ownerUserId;
    }
    if (input.dueOn !== undefined) {
      const d = isoDay(input.dueOn);
      if (!d) throw new BadRequestException('Give a due date.');
      data.dueOn = d;
    }
    if (input.youSaid !== undefined) data.youSaid = text(input.youSaid, YSWD_TEXT_MAX) || null;
    if (input.weDid !== undefined) data.weDid = text(input.weDid, YSWD_TEXT_MAX) || null;
    if (input.evidenceNote !== undefined) data.evidenceNote = text(input.evidenceNote, 2000) || null;
    if (input.outcome !== undefined) data.outcome = text(input.outcome, 2000) || null;
    let status = action.status as ActionStatus;
    if (input.status !== undefined) {
      if (!(ACTION_STATUSES as readonly string[]).includes(input.status)) throw new BadRequestException('Unknown status.');
      status = input.status as ActionStatus;
      if (status === 'CANCELLED' && !manage) throw new ForbiddenException('Only people who manage surveys can cancel an action.');
      const outcome = input.outcome !== undefined ? text(input.outcome, 2000) : (action.outcome ?? '');
      if ((status === 'DONE' || status === 'CANCELLED') && outcome.length < 5) {
        throw new BadRequestException(status === 'DONE' ? 'Say what was done before closing the action.' : 'Say why the action is cancelled.');
      }
      data.status = status;
      if (status === action.status) {
        // Unchanged: the completion stamp stays as it was.
      } else if (status === 'DONE') {
        data.completedAt = new Date();
        data.completedById = actor.id;
      } else {
        data.completedAt = null;
        data.completedById = null;
      }
    } else if ((status === 'DONE' || status === 'CANCELLED') && input.outcome !== undefined && text(input.outcome, 2000).length < 5) {
      // A closed action keeps what was done (or why it was cancelled): it is the record CQC and the pack show.
      throw new BadRequestException(status === 'DONE' ? 'Say what was done.' : 'Say why the action is cancelled.');
    }
    await this.assertNoQuotes(owner, [
      ['The title', input.title],
      ['What was done', input.outcome],
      ['"You said"', input.youSaid],
      ['"We did"', input.weDid],
    ]);
    const statusChanged = input.status !== undefined && status !== action.status;
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.surveyAction.update({ where: { id: actionId }, data });
      if (row.roleTaskId) {
        const task = await this.taskText(owner, row.title);
        await tx.roleTask.update({
          where: { id: row.roleTaskId },
          data: {
            status: status as RoleTaskStatus,
            roleId: row.ownerRoleId,
            dueDate: row.dueOn,
            ...task,
            // Completion is stamped when the status changes, not again on every later edit.
            ...(statusChanged
              ? status === 'DONE' || status === 'CANCELLED'
                ? { completedAt: new Date(), completedById: actor.id }
                : { completedAt: null, completedById: null }
              : {}),
            ...(statusChanged && status === 'IN_PROGRESS' ? { startedAt: new Date() } : {}),
          },
        });
      }
      return row;
    });
    await this.syncEvidence(saved);
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: input.status && input.status !== action.status && (status === 'DONE' || status === 'CANCELLED') ? AuditAction.SURVEY_ACTION_CLOSED : AuditAction.SURVEY_ACTION_UPDATED,
      recordType: 'SurveyAction',
      recordId: actionId,
      description: status === 'DONE' && action.status !== 'DONE' ? 'Survey action done' : 'Survey action changed',
      oldValues: { status: action.status, dueOn: day(action.dueOn), ownerRoleId: action.ownerRoleId },
      newValues: { status, dueOn: day(saved.dueOn), ownerRoleId: saved.ownerRoleId },
      ...(meta ?? {}),
    });
    if (input.ownerUserId && input.ownerUserId !== action.ownerUserId) await this.notifyOwner(owner, actionId, input.ownerUserId, actor.id);
    return { message: 'Action saved', data: { id: actionId, status } };
  }

  /** CQC evidence for the survey and its periods: this action's "You said, we did" entry, kept in step. */
  async syncEvidence(action: ActionRow) {
    const periods = await this.prisma.survey.findMany({ where: { clonedFromId: action.surveyId }, select: { id: true } });
    const sourceIds = action.periodId ? [action.periodId] : [action.surveyId, ...periods.map((p) => p.id)];
    // Every status: an entry this action wrote on evidence since superseded or archived must still follow a reopen or
    // an edit. New entries go on current evidence only.
    const evidence = await this.prisma.cqcEvidence.findMany({
      where: { sourceType: 'SURVEY_RESULT', sourceId: { in: sourceIds } },
      select: { id: true, actions: true, status: true },
    });
    const now = new Date();
    for (const e of evidence) {
      const before = readActions(e.actions);
      const current = e.status === 'CURRENT';
      const has = before.some((a) => a.actionId === action.id);
      if (!current && !has) continue;
      // A done action for the whole survey goes onto later periods' evidence too, for 12 months after it was done
      // (decision, November 2026); evidence that already has it keeps it in step.
      const done = action.status === 'DONE' && (has || carriedForward(action.completedAt, now));
      const next = mergeEvidenceActions(before, {
        id: action.id,
        done,
        youSaid: action.youSaid,
        weDid: action.weDid,
        completedOn: action.completedAt ? action.completedAt.toISOString().slice(0, 10) : null,
      });
      if (JSON.stringify(next) === JSON.stringify(before)) continue;
      await this.prisma.cqcEvidence.update({ where: { id: e.id }, data: { actions: next as unknown as Prisma.InputJsonValue } });
    }
  }

  /**
   * The survey job: done actions for a whole survey (no period) are put onto CQC evidence made since (a later period's,
   * when the earlier evidence was superseded), for 12 months after they were done.
   */
  async carryForward(now: Date = new Date()): Promise<number> {
    const since = new Date(now);
    since.setUTCMonth(since.getUTCMonth() - CARRY_FORWARD_MONTHS);
    // Every one, a page at a time in a fixed order (by id), so none is missed however many there are.
    let count = 0;
    let after: string | null = null;
    for (;;) {
      const rows: ActionRow[] = await this.prisma.surveyAction.findMany({
        where: { status: 'DONE', periodId: null, completedAt: { gte: since }, youSaid: { not: null }, weDid: { not: null }, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: CARRY_FORWARD_PAGE,
      });
      for (const a of rows) await this.syncEvidence(a);
      count += rows.length;
      if (rows.length < CARRY_FORWARD_PAGE) break;
      after = rows[rows.length - 1]!.id;
    }
    return count;
  }

  // ─── Team discussions ───────────────────────────────────────────────────

  async createDiscussion(actor: RequestUser, surveyId: string, input: { periodId?: string | null; heldOn?: string; kind?: string; attendees?: number | null; summary?: string; agreed?: string | null }, meta?: RequestAuditMeta) {
    this.assertManage(actor);
    const { owner } = await this.ownerSurvey(actor, surveyId);
    const heldOn = isoDay(input.heldOn);
    if (!heldOn || heldOn.getTime() > Date.now()) throw new BadRequestException('Give the day it was discussed (not in the future).');
    if (!input.kind || !(input.kind in DISCUSSION_KINDS)) throw new BadRequestException('Choose the kind of meeting.');
    const summary = text(input.summary, 4000);
    if (summary.length < 5) throw new BadRequestException('Say what was discussed.');
    if (input.attendees != null && (!Number.isInteger(input.attendees) || input.attendees < 1 || input.attendees > 1000)) {
      throw new BadRequestException('Attendees must be a number from 1 to 1000.');
    }
    const period = await this.periodOf(owner, input.periodId);
    await this.assertNoQuotes(owner, [['What was discussed', summary], ['What was agreed', input.agreed]]);
    const row = await this.prisma.surveyDiscussion.create({
      data: {
        surveyId: owner.id,
        periodId: period?.id ?? null,
        heldOn,
        kind: input.kind,
        attendees: input.attendees ?? null,
        summary,
        agreed: text(input.agreed, 4000) || null,
        locationIds: owner.locationIds,
        recordedById: actor.id,
      },
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_DISCUSSION_RECORDED,
      recordType: 'SurveyDiscussion',
      recordId: row.id,
      description: 'Survey results discussion recorded',
      newValues: { surveyId: owner.id, heldOn: day(heldOn), kind: input.kind, attendees: input.attendees ?? null },
      ...(meta ?? {}),
    });
    return { message: 'Discussion recorded', data: { id: row.id } };
  }

  async deleteDiscussion(actor: RequestUser, discussionId: string, meta?: RequestAuditMeta) {
    this.assertManage(actor);
    const d = await this.prisma.surveyDiscussion.findUnique({ where: { id: discussionId } });
    if (!d) throw new NotFoundException('Discussion not found');
    await this.ownerSurvey(actor, d.surveyId);
    await this.prisma.surveyDiscussion.delete({ where: { id: discussionId } });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_DISCUSSION_RECORDED,
      recordType: 'SurveyDiscussion',
      recordId: discussionId,
      description: 'Survey results discussion record removed',
      oldValues: { surveyId: d.surveyId, heldOn: day(d.heldOn), kind: d.kind },
      ...(meta ?? {}),
    });
    return { message: 'Discussion removed', data: { id: discussionId } };
  }

  // ─── "You said, we did" ─────────────────────────────────────────────────

  private serializeUpdate(u: Prisma.SurveyYouSaidWeDidGetPayload<object>) {
    return {
      id: u.id,
      periodId: u.periodId,
      title: u.title,
      intro: u.intro,
      items: readItems(u.items),
      headline: (u.headline as { percent: number; base: number; label: string } | null) ?? null,
      channels: u.channels,
      status: u.status,
      publicToken: u.status === 'PUBLISHED' && u.channels.includes('PUBLIC') ? u.publicToken : null,
      publishedOn: day(u.publishedAt),
    };
  }

  /** Every written answer to the survey and its periods (read here only to refuse quotes; never returned). */
  private async writtenAnswers(owner: Survey): Promise<string[]> {
    const rows = await this.prisma.surveyAnswer.findMany({
      where: { response: { survey: { OR: [{ id: owner.id }, { clonedFromId: owner.id }] } }, OR: [{ textValue: { not: null } }, { otherText: { not: null } }, { comment: { not: null } }] },
      select: { textValue: true, otherText: true, comment: true },
    });
    return rows.flatMap(writtenPartsOf);
  }

  /**
   * Refuses words that quote a written answer (8 words in a row, or nearly). Used on everything that leaves the people
   * with results access: "You said, we did", and an action's or discussion's words that reach CQC evidence, the role
   * task and the pack.
   */
  private async assertNoQuotes(owner: Survey, fields: ReadonlyArray<readonly [label: string, value: string | null | undefined]>) {
    const filled = fields.filter(([, v]) => typeof v === 'string' && v.trim());
    if (!filled.length) return;
    const written = await this.writtenAnswers(owner);
    for (const [label, v] of filled) {
      if (quotesWrittenAnswer(v!, written)) {
        throw new BadRequestException(`${label} looks like a quote from a written answer, which could point to who wrote it. Say it in your own words.`);
      }
    }
  }

  private async checkItems(owner: Survey, raw: unknown): Promise<YswdItem[]> {
    if (!Array.isArray(raw) || raw.length < 1) throw new BadRequestException('Add at least one "You said, we did".');
    if (raw.length > YSWD_MAX_ITEMS) throw new BadRequestException(`At most ${YSWD_MAX_ITEMS}.`);
    const items = raw.map((r) => ({
      youSaid: text((r as YswdItem)?.youSaid, YSWD_TEXT_MAX),
      weDid: text((r as YswdItem)?.weDid, YSWD_TEXT_MAX),
      actionId: typeof (r as YswdItem)?.actionId === 'string' ? (r as YswdItem).actionId : null,
    }));
    if (items.some((i) => i.youSaid.length < 3 || i.weDid.length < 3)) throw new BadRequestException('Each one needs both "You said" and "We did".');
    const written = await this.writtenAnswers(owner);
    items.forEach((i, n) => {
      if (quotesWrittenAnswer(i.youSaid, written) || quotesWrittenAnswer(i.weDid, written)) {
        throw new BadRequestException(`Number ${n + 1} looks like a quote from a written answer, which could point to who wrote it. Say it in your own words.`);
      }
    });
    return items;
  }

  /** The overall figure as shown now (only when it could be shown), for the summary. */
  private async headlineFor(owner: Survey, periodId: string | null, threshold: number) {
    const unit = periodId ? await this.prisma.survey.findUnique({ where: { id: periodId } }) : owner;
    if (!unit) return null;
    const figures = await this.surveys.figuresFor(unit, threshold);
    const counted = figures.participation.responsesInFigures;
    const unlinkedPossible = owner.isAnonymous || offersAnswerWithoutName(owner);
    if (counted < Math.max(1, threshold) || (unlinkedPossible && unit.status !== 'CLOSED')) return null;
    const h = figures.headline as { percent: number | null; base: number; questionText: string } | null;
    return h && h.percent !== null ? { percent: h.percent, base: h.base, label: h.questionText } : null;
  }

  async saveUpdate(actor: RequestUser, surveyId: string, updateId: string | null, input: { periodId?: string | null; title?: string; intro?: string | null; items?: unknown; channels?: unknown }, meta?: RequestAuditMeta) {
    this.assertManage(actor);
    const { owner } = await this.ownerSurvey(actor, surveyId);
    const existing = updateId ? await this.prisma.surveyYouSaidWeDid.findFirst({ where: { id: updateId, surveyId: owner.id } }) : null;
    if (updateId && !existing) throw new NotFoundException('Not found');
    if (existing?.status === 'PUBLISHED') throw new BadRequestException('Withdraw it before changing it.');
    const title = text(input.title, 160);
    if (title.length < 3) throw new BadRequestException('Give it a title.');
    const channels = Array.isArray(input.channels) ? [...new Set(input.channels.filter((c): c is YswdChannel => (YSWD_CHANNELS as readonly string[]).includes(c as string)))] : [];
    if (owner.targetKind === 'EMPLOYEE' && channels.includes('PORTAL')) throw new BadRequestException('A staff survey is shared with staff (the carer app), not on the portal.');
    if (owner.targetKind !== 'EMPLOYEE' && channels.includes('APP')) throw new BadRequestException('Only staff surveys are shared in the carer app.');
    const items = await this.checkItems(owner, input.items);
    const intro = text(input.intro, 1500) || null;
    await this.assertNoQuotes(owner, [['The title', title], ['The introduction', intro]]);
    const period = await this.periodOf(owner, input.periodId);
    const data = {
      periodId: period?.id ?? null,
      title,
      intro,
      items: items as unknown as Prisma.InputJsonValue,
      channels,
      updatedById: actor.id,
    };
    const row = existing
      ? await this.prisma.surveyYouSaidWeDid.update({ where: { id: existing.id }, data })
      : await this.prisma.surveyYouSaidWeDid.create({ data: { ...data, surveyId: owner.id, audience: owner.targetKind, locationIds: owner.locationIds, createdById: actor.id } });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_YOU_SAID_WE_DID_SAVED,
      recordType: 'SurveyYouSaidWeDid',
      recordId: row.id,
      description: '"You said, we did" saved as a draft',
      newValues: { surveyId: owner.id, items: items.length, channels },
      ...(meta ?? {}),
    });
    return { message: 'Saved', data: this.serializeUpdate(row) };
  }

  async publishUpdate(actor: RequestUser, surveyId: string, updateId: string, publish: boolean, meta?: RequestAuditMeta) {
    this.assertManage(actor);
    const { owner, access } = await this.ownerSurvey(actor, surveyId);
    const row = await this.prisma.surveyYouSaidWeDid.findFirst({ where: { id: updateId, surveyId: owner.id } });
    if (!row) throw new NotFoundException('Not found');
    let saved;
    if (publish) {
      if (!row.channels.length) throw new BadRequestException('Choose where to share it.');
      // Checked again: answers may have been written since it was saved.
      await this.checkItems(owner, readItems(row.items));
      await this.assertNoQuotes(owner, [['The title', row.title], ['The introduction', row.intro]]);
      saved = await this.prisma.surveyYouSaidWeDid.update({
        where: { id: row.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          publishedById: actor.id,
          withdrawnAt: null,
          headline: (await this.headlineFor(owner, row.periodId, access.threshold)) ?? Prisma.DbNull,
          publicToken: row.channels.includes('PUBLIC') ? (row.publicToken ?? randomBytes(18).toString('base64url')) : null,
        },
      });
    } else {
      saved = await this.prisma.surveyYouSaidWeDid.update({ where: { id: row.id }, data: { status: 'WITHDRAWN', withdrawnAt: new Date(), publicToken: null } });
    }
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: publish ? AuditAction.SURVEY_YOU_SAID_WE_DID_PUBLISHED : AuditAction.SURVEY_YOU_SAID_WE_DID_WITHDRAWN,
      recordType: 'SurveyYouSaidWeDid',
      recordId: row.id,
      description: publish ? `"You said, we did" published (${row.channels.join(', ')})` : '"You said, we did" withdrawn',
      newValues: { surveyId: owner.id, channels: row.channels },
      ...(meta ?? {}),
    });
    return { message: publish ? 'Published' : 'Withdrawn', data: this.serializeUpdate(saved) };
  }

  private async organisation() {
    const p = await this.prisma.companyProfile.findFirst({ select: { displayName: true, companyName: true, displayLogoUrl: true, phoneNumber: true, email: true } });
    return p ? { name: p.displayName || p.companyName, logoUrl: p.displayLogoUrl, phone: p.phoneNumber, email: p.email } : null;
  }

  private publicShape(u: Prisma.SurveyYouSaidWeDidGetPayload<object>) {
    return { id: u.id, title: u.title, intro: u.intro, items: readItems(u.items).map(({ youSaid, weDid }) => ({ youSaid, weDid })), headline: u.headline ?? null, publishedOn: day(u.publishedAt) };
  }

  private branchMatch(locationIds: string[], branch: string | null) {
    return { OR: [{ locationIds: { isEmpty: true } }, ...(branch ? [{ locationIds: { has: branch } }] : [])] } satisfies Prisma.SurveyYouSaidWeDidWhereInput;
  }

  /** The portal: published summaries for people we support (and families) in the person's branch. */
  async forPortal(serviceUserId: string) {
    const su = await this.prisma.serviceUser.findUnique({ where: { id: serviceUserId }, select: { locationId: true } });
    const rows = await this.prisma.surveyYouSaidWeDid.findMany({
      where: { status: 'PUBLISHED', channels: { has: 'PORTAL' }, audience: { in: ['SERVICE_USER', 'PUBLIC'] }, survey: { deletedAt: null }, ...this.branchMatch([], su?.locationId ?? null) },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });
    return { message: 'You said, we did', data: { organisation: await this.organisation(), updates: rows.map((r) => this.publicShape(r)) } };
  }

  /** The carer app payload: published summaries of staff surveys for the employee's branch. */
  async forEmployeeApp(employeeId: string) {
    const emp = await this.prisma.employeeEmployment.findUnique({ where: { employeeId }, select: { locationId: true, baseLocationId: true } });
    const rows = await this.prisma.surveyYouSaidWeDid.findMany({
      where: { status: 'PUBLISHED', channels: { has: 'APP' }, audience: 'EMPLOYEE', survey: { deletedAt: null }, ...this.branchMatch([], emp?.locationId ?? emp?.baseLocationId ?? null) },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });
    return { message: 'You said, we did', data: { updates: rows.map((r) => this.publicShape(r)) } };
  }

  /** The public page (no login), only while published with the public link. */
  async forPublic(token: string) {
    const row = typeof token === 'string' && token.length >= 16 ? await this.prisma.surveyYouSaidWeDid.findFirst({ where: { publicToken: token, status: 'PUBLISHED', channels: { has: 'PUBLIC' }, survey: { deletedAt: null } } }) : null;
    if (!row) throw new NotFoundException('This page is no longer available.');
    return { message: 'You said, we did', data: { organisation: await this.organisation(), update: this.publicShape(row) } };
  }

  /** The printable letter (staff print it from the survey; no names, organisation letterhead). */
  async letter(actor: RequestUser, surveyId: string, updateId: string) {
    const { owner } = await this.ownerSurvey(actor, surveyId);
    const row = await this.prisma.surveyYouSaidWeDid.findFirst({ where: { id: updateId, surveyId: owner.id, status: 'PUBLISHED', channels: { has: 'LETTER' } } });
    if (!row) throw new NotFoundException('Publish it with "Printable letter" first.');
    return { message: 'Letter', data: { organisation: await this.organisation(), update: this.publicShape(row), audience: owner.targetKind } };
  }

  // ─── CQC and commissioner pack ──────────────────────────────────────────

  async pack(actor: RequestUser, surveyId: string, periodId: string | null, meta?: RequestAuditMeta) {
    const { owner, access } = await this.ownerSurvey(actor, surveyId);
    const period = await this.periodOf(owner, periodId);
    const unitId = period?.id ?? owner.id;
    const [trends, themes, scores, overview, statements] = await Promise.all([
      this.insight.trends(actor, owner.id),
      this.insight.themes(actor, unitId),
      this.insight.scores(actor, unitId),
      this.overview(actor, owner.id),
      this.prisma.cqcEvidence.findMany({
        where: { sourceType: 'SURVEY_RESULT', sourceId: { in: [unitId, ...(period ? [] : (await this.prisma.survey.findMany({ where: { clonedFromId: owner.id }, select: { id: true } })).map((p) => p.id))] }, status: 'CURRENT' },
        select: { statements: { select: { statement: { select: { code: true, title: true } } } } },
      }),
    ]);
    // A period: its own figures under the unit rules. The whole survey: a repeating survey's shown periods pooled
    // (trends), a single survey under the unit rules (closed first where answers can be linked to no one).
    const isSeries = !period && trends.data.units.length > 1;
    const unit = period ?? owner;
    const figures = await this.surveys.figuresFor(unit, access.threshold);
    const unitShown = unitHiddenReason({
      responsesInFigures: figures.participation.responsesInFigures,
      threshold: access.threshold,
      closed: unit.status === 'CLOSED',
      unlinkedPossible: owner.isAnonymous || offersAnswerWithoutName(owner),
    }) === null;
    const shown = isSeries ? trends.data.units.some((u) => u.shown) : unitShown;
    const counted = isSeries ? trends.data.responsesInFigures : figures.participation.responsesInFigures;
    const inThisPeriod = <T extends { periodId: string | null }>(rows: T[]) => (period ? rows.filter((r) => r.periodId === period.id || r.periodId === null) : rows);
    const o = overview.data;
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_RESULTS_EXPORTED,
      recordType: 'Survey',
      recordId: owner.id,
      description: `CQC and commissioner pack for survey "${owner.title}" opened`,
      newValues: { kind: 'PACK', ...(period ? { periodId: period.id } : {}) },
      ...(meta ?? {}),
    });
    const p = figures.participation as { sentTo: number | null; answered: number; responseRate: number | null };
    return {
      message: 'CQC and commissioner pack',
      data: {
        organisation: await this.organisation(),
        survey: { id: owner.id, title: owner.title, targetKind: owner.targetKind, isAnonymous: owner.isAnonymous, libraryReference: owner.libraryReference },
        period: period ? { id: period.id, title: period.title, opensAt: period.opensAt?.toISOString() ?? null, closesAt: period.closesAt?.toISOString() ?? null } : null,
        generatedOn: day(new Date()),
        threshold: access.threshold,
        // A repeating survey: the periods' answers that can be shown (each period's own figures are on its pack).
        participation: isSeries
          ? { sentTo: null, answered: counted, responseRate: null, inFigures: shown ? counted : null }
          : { sentTo: p.sentTo, answered: p.answered, responseRate: p.responseRate, inFigures: shown ? counted : null },
        figuresShown: shown,
        figuresNote: shown ? null : 'Too few answers to show figures, or not closed yet where answers can be linked to no one.',
        headline: shown && !isSeries ? (figures.headline ?? null) : null,
        questions: isSeries
          ? trends.data.questions.filter((q) => q.pooled).map((q) => ({ questionText: q.questionText, figure: figureWords(q.pooled) }))
          : shown
          ? ((figures.questionSummaries ?? []) as Array<{ questionText: string; questionType: string; topTwo?: { percent: number | null; base: number } | null; options?: Array<{ label: string; count: number }>; numeric?: { average: number | null } | null; answerCount: number }>)
              .map((q) => ({
                questionText: q.questionText,
                figure: q.topTwo && q.topTwo.base > 0
                  ? `${q.topTwo.percent}% (of ${q.topTwo.base})`
                  : q.questionType === 'YES_NO' && q.options
                    ? `${Math.round(((q.options.find((x) => x.label === 'Yes')?.count ?? 0) / Math.max(1, (q.options.find((x) => x.label === 'Yes')?.count ?? 0) + (q.options.find((x) => x.label === 'No')?.count ?? 0))) * 100)}% Yes`
                    : q.numeric?.average != null
                      ? `average ${q.numeric.average}`
                      : null,
              }))
              .filter((q) => q.figure)
          : [],
        trends: period ? null : { units: trends.data.units, questions: trends.data.questions },
        themes: themes.data.themes,
        /** A repeating survey's themes come from one period (the latest that can be shown): which one. */
        themesPeriod: (themes.data as { period?: { id: string; label: string } | null }).period ?? null,
        /** Periods the pack can be made for (those that can be shown), for the period chooser. */
        periods: trends.data.units.filter((u) => u.shown).map((u) => ({ id: u.id, label: u.label })),
        scores: scores.data.scales,
        // Owners as roles only: the pack is shared outside the organisation.
        actions: inThisPeriod(o.actions).map((a) => ({ title: a.title, source: a.sourceLabel, ownerRole: a.ownerRole, dueOn: a.dueOn, status: a.status, outcome: a.status === 'DONE' ? a.outcome : null, completedOn: a.completedOn })),
        discussions: inThisPeriod(o.discussions).map((d) => ({ heldOn: d.heldOn, kind: d.kindLabel, attendees: d.attendees, agreed: d.agreed })),
        youSaidWeDid: inThisPeriod(o.youSaidWeDid.filter((u) => u.status === 'PUBLISHED')).map((u) => ({ title: u.title, items: u.items.map(({ youSaid, weDid }) => ({ youSaid, weDid })), publishedOn: u.publishedOn })),
        cqcStatements: [...new Map(statements.flatMap((e) => e.statements.map((s) => [s.statement.code, s.statement.title] as const))).entries()].map(([code, title]) => ({ code, title })),
      },
    };
  }
}
