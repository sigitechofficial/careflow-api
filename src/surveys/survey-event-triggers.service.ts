import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
  RoleTaskStatus,
  SurveyStatus,
  SurveyTargetKind,
  type Survey,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { DEFAULT_OPERATIONAL_TIMEZONE, dayKeyInTimeZone, startOfOperationalDayUtc } from '../common/utils/operational-day.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { surveyVisibleInScope } from './survey-scope.util';
import { surveyAccessFor, surveyResultsAudience } from './survey-access';
import { roleForOwner } from './survey-alert-rules.util';
import { SurveysService } from './surveys.service';
import {
  EVENT_ANONYMOUS_BATCH,
  EVENT_REPEAT_GAP_DAYS,
  OPEN_OCCURRENCE_STATUSES,
  OCCURRENCE_REASONS,
  SURVEY_TRIGGER_EVENT_INFO,
  SURVEY_TRIGGER_EVENTS,
  SURVEY_TRIGGER_EXCLUSION_INFO,
  addDays,
  checkEventTriggerInput,
  daysBetween,
  detectionRange,
  dueDecision,
  libraryEventTrigger,
  occurrenceDays,
  readEventTrigger,
  reasonWords,
  triggerAudienceOf,
  type OccurrenceReason,
  type SurveyEventTrigger,
  type SurveyTriggerEvent,
  type TriggerAudience,
} from './survey-event-triggers.util';

export const SURVEY_EVENT_DUE_TASK_SOURCE = 'SURVEY_EVENT_DUE';
const OPEN_TASK = [RoleTaskStatus.OPEN, RoleTaskStatus.IN_PROGRESS];
/** A death recorded within this many days stops survey contact (every run; idempotent). */
const DEATH_SWEEP_DAYS = 90;
/** How often the records are read for new events (each server; the unique key makes repeats harmless). */
const DETECT_EVERY_MS = 15 * 60_000;

/** One event found in the records: who, the record that raised it, and the event day. */
export type FoundEvent = {
  personId: string;
  sourceKey: string;
  eventDay: string;
  /** The record behind a sourceKey that also names the day (e.g. a care plan): its row moves when the day does. */
  recordKey?: string;
  /**
   * No real date on the record (care ended without a service end date, a death without a date of death): the
   * day is only when the record was changed. Never sent on that guess: staff decide, told no date is recorded.
   */
  noDate?: boolean;
};
/** Rows skipped because the record that raised them changed (they follow the record if it comes back). */
const CHANGED_REASONS: string[] = ['RECORD_REMOVED', 'REVIEW_CHANGED', 'ABSENCE_CHANGED'];
type Occurrence = Prisma.SurveyEventOccurrenceGetPayload<object>;

/**
 * Surveys sent when something happens in the care records (Phase 2 part 3). Reads the records CareFlow
 * already keeps (visits, care plan reviews, hospital stays, complaints, medicines, care ending, deaths,
 * staff reviews, leaving records, absences): no new event store and nothing changed in other modules.
 * A ledger (SurveyEventOccurrence) keeps each event acted on once. Sends go through SurveysService
 * (the month's copy, the 4-week rule, opt-outs, invitations). Never answers, completion or response times.
 */
@Injectable()
export class SurveyEventTriggersService {
  private readonly logger = new Logger(SurveyEventTriggersService.name);
  private lastDetectAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
    private readonly surveys: SurveysService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly orgSettings?: OrganisationGeneralSettingsService,
  ) {}

  async timeZone(): Promise<string> {
    try {
      return (await this.orgSettings?.getOperationalTimezone()) || DEFAULT_OPERATIONAL_TIMEZONE;
    } catch {
      return DEFAULT_OPERATIONAL_TIMEZONE;
    }
  }

  // ─── Settings ────────────────────────────────────────────────────────────

  private async requireSurvey(actor: RequestUser, id: string): Promise<Survey> {
    const survey = await this.prisma.survey.findFirst({ where: { id, deletedAt: null, isCatalogue: false } });
    if (!survey || !surveyVisibleInScope(this.orgScope.fromRequestUser(actor), survey)) throw new NotFoundException('Survey not found');
    return survey;
  }

  /** Why this survey cannot be sent by events (null when it can). */
  private async notAllowed(survey: Survey): Promise<string | null> {
    if (survey.isTemplate) return 'Templates are never sent. Use the template to make a survey first.';
    if (survey.clonedFromId) return 'This is one month or period of another survey. Change this on that survey.';
    if (survey.recurrence) return 'A repeating survey cannot also be sent after events. Stop the repeat first, or use a separate copy.';
    if (survey.status === SurveyStatus.CLOSED) return 'This survey is closed.';
    // A scheduled send would still go to everyone on its day.
    if (survey.distributeAt && !survey.distributedAt) return 'This survey is scheduled to be sent. Cancel the schedule first.';
    const recipients = await this.prisma.surveyRecipient.count({ where: { surveyId: survey.id } });
    if (recipients > 0) return 'This survey has already been sent. Duplicate it to send a copy after events.';
    return null;
  }

  async getSettings(actor: RequestUser, surveyId: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    const tz = await this.timeZone();
    const audience = triggerAudienceOf(survey.targetKind);
    const trigger = readEventTrigger(survey.eventTrigger);
    // Like the recipient list: only for people who manage surveys and may see this survey's results
    // (a restricted survey, e.g. one about a manager, keeps even who was sent it from others).
    const canManage = actor.permissions.includes('surveys.manage') && (await surveyAccessFor(this.prisma, actor, survey)).results;
    const events = SURVEY_TRIGGER_EVENTS.filter((e) => SURVEY_TRIGGER_EVENT_INFO[e].audiences.includes(audience)).map((e) => ({
      code: e,
      ...SURVEY_TRIGGER_EVENT_INFO[e],
    }));
    const exclusions = Object.entries(SURVEY_TRIGGER_EXCLUSION_INFO)
      .filter(([, x]) => x.audiences.includes(audience))
      .map(([code, x]) => ({ code, label: x.label }));
    // The list names people and what happened to them: only for people who manage surveys.
    const rows = canManage
      ? await this.prisma.surveyEventOccurrence.findMany({ where: { surveyId: survey.id }, orderBy: [{ dueOn: 'desc' }, { createdAt: 'desc' }], take: 300 })
      : [];
    const names = await this.names(rows);
    const periods = new Map(
      (await this.prisma.survey.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.sentSurveyId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, title: true } })).map(
        (p) => [p.id, p.title],
      ),
    );
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return {
      message: 'Sent when something happens',
      data: {
        audience,
        trigger: trigger ? { ...trigger, label: SURVEY_TRIGGER_EVENT_INFO[trigger.event].label } : null,
        library: survey.libraryReference ? libraryEventTrigger(survey.libraryReference) : null,
        libraryWords: (survey.libraryMeta as { timing?: { trigger?: string | null } } | null)?.timing?.trigger ?? null,
        notAllowed: trigger ? null : await this.notAllowed(survey),
        events,
        exclusions,
        canSeeList: canManage,
        counts,
        occurrences: rows.map((r) => ({
          id: r.id,
          name: names.get((r.serviceUserId ?? r.employeeId)!) ?? (r.serviceUserId ? 'Person we support' : 'Employee'),
          personId: r.serviceUserId ?? r.employeeId,
          event: r.event,
          eventLabel: SURVEY_TRIGGER_EVENT_INFO[r.event as SurveyTriggerEvent]?.label ?? r.event,
          eventOn: dayKeyInTimeZone(r.eventOn, tz),
          dueOn: dayKeyInTimeZone(r.dueOn, tz),
          lastDay: dayKeyInTimeZone(r.lastDay, tz),
          status: r.status,
          reason: reasonWords(r.reason),
          sentIn: r.sentSurveyId ? { id: r.sentSurveyId, title: periods.get(r.sentSurveyId) ?? null } : null,
          resolvedOn: r.resolvedAt ? dayKeyInTimeZone(r.resolvedAt, tz) : null,
        })),
      },
    };
  }

  private async names(rows: Array<{ employeeId: string | null; serviceUserId: string | null }>): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const suIds = [...new Set(rows.map((r) => r.serviceUserId).filter((x): x is string => Boolean(x)))];
    const empIds = [...new Set(rows.map((r) => r.employeeId).filter((x): x is string => Boolean(x)))];
    if (suIds.length) {
      for (const s of await this.prisma.serviceUser.findMany({ where: { id: { in: suIds } }, select: { id: true, firstName: true, lastName: true, preferredName: true } })) {
        out.set(s.id, `${s.preferredName?.trim() || s.firstName} ${s.lastName ?? ''}`.trim());
      }
    }
    if (empIds.length) {
      for (const e of await this.prisma.employeePersonalDetail.findMany({ where: { employeeId: { in: empIds } }, select: { employeeId: true, firstName: true, lastName: true } })) {
        out.set(e.employeeId, `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || 'Employee');
      }
    }
    return out;
  }

  /** Switch on, change or (null) switch off. Audited; a change never re-sends events already acted on. */
  async saveSettings(actor: RequestUser, surveyId: string, input: unknown, meta?: RequestAuditMeta) {
    const survey = await this.requireSurvey(actor, surveyId);
    const before = readEventTrigger(survey.eventTrigger);
    const tz = await this.timeZone();
    const now = new Date();
    let data: Prisma.SurveyUpdateInput;
    let after: SurveyEventTrigger | null = null;
    if (input === null) {
      if (!before) return this.getSettings(actor, surveyId);
      data = { eventTrigger: Prisma.DbNull, updatedById: actor.id };
    } else {
      if (!before) {
        const why = await this.notAllowed(survey);
        if (why) throw new BadRequestException(why);
      }
      if ((await this.prisma.surveyQuestion.count({ where: { surveyId: survey.id, deletedAt: null } })) === 0) {
        throw new BadRequestException('Add at least one question first.');
      }
      const checked = checkEventTriggerInput(input, { audience: triggerAudienceOf(survey.targetKind), today: dayKeyInTimeZone(now, tz), previous: before });
      if (!checked.ok) throw new BadRequestException(checked.message);
      after = checked.trigger;
      data = { eventTrigger: after as unknown as Prisma.InputJsonValue, updatedById: actor.id };
      // A branch manager's switch-on never reaches beyond their branches.
      const scope = this.orgScope.fromRequestUser(actor);
      if (!survey.locationIds.length && scope.locationIds) data.locationIds = scope.locationIds;
    }
    await this.prisma.survey.update({ where: { id: survey.id }, data });
    if (after && before && before.event === after.event && (before.delayDays !== after.delayDays || before.windowDays !== after.windowDays)) {
      // A new delay or late window: rows still waiting move to their new days (as when a record's date changes).
      const waiting = await this.prisma.surveyEventOccurrence.findMany({ where: { surveyId: survey.id, status: { in: ['WAITING', 'BATCH'] } }, select: { id: true, eventOn: true, status: true } });
      for (const w of waiting) {
        const d = occurrenceDays(dayKeyInTimeZone(w.eventOn, tz), after);
        await this.prisma.surveyEventOccurrence.updateMany({
          where: { id: w.id, status: w.status },
          data: { dueOn: startOfOperationalDayUtc(d.dueOn, tz), lastDay: startOfOperationalDayUtc(d.lastDay, tz) },
        });
      }
    }
    if (!after || (before && before.event !== after.event)) {
      // Switched off (or another event chosen): nothing still waiting for the old setting is sent.
      await this.prisma.surveyEventOccurrence.updateMany({
        where: { surveyId: survey.id, status: { in: OPEN_OCCURRENCE_STATUSES }, ...(after ? { event: { not: after.event } } : {}) },
        data: { status: 'CANCELLED', reason: 'SURVEY_STOPPED', resolvedAt: now, resolvedById: actor.id },
      });
    }
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_EVENT_TRIGGER_CHANGED,
      recordType: 'Survey',
      recordId: survey.id,
      description: after
        ? `Survey "${survey.title}" is sent after: ${SURVEY_TRIGGER_EVENT_INFO[after.event].label}`
        : `Survey "${survey.title}" is no longer sent after events`,
      oldValues: { trigger: before },
      newValues: { trigger: after },
      metadata: { surveyId: survey.id },
      ...meta,
    });
    return this.getSettings(actor, surveyId);
  }

  // ─── The survey job ──────────────────────────────────────────────────────

  /** Every minute from the survey job: deaths first, then (every 15 minutes) new events, then due rows. */
  async run(now: Date = new Date(), opts: { detect?: boolean } = {}) {
    const stopped = await this.stopAfterDeaths(now).catch((e: Error) => {
      this.logger.warn(`Survey contact after deaths not checked (${e.name})`);
      return 0;
    });
    let found = 0;
    if (opts.detect ?? now.getTime() - this.lastDetectAt >= DETECT_EVERY_MS) {
      this.lastDetectAt = now.getTime();
      found = await this.detect(now).catch((e: Error) => {
        this.logger.warn(`Survey events not read (${e.name})`);
        return 0;
      });
    }
    const processed = await this.processDue(now).catch((e: Error) => {
      this.logger.warn(`Survey event sends not processed (${e.name})`);
      return { sent: 0, due: 0 };
    });
    const tasks = await this.syncTasks(now).catch(() => 0);
    return { stopped, found, ...processed, tasks };
  }

  private async triggeredSurveys(): Promise<Array<{ survey: Survey; trigger: SurveyEventTrigger }>> {
    const rows = await this.prisma.survey.findMany({
      where: {
        eventTrigger: { not: Prisma.DbNull },
        deletedAt: null,
        isTemplate: false,
        isCatalogue: false,
        clonedFromId: null,
        status: { not: SurveyStatus.CLOSED },
      },
    });
    return rows.map((survey) => ({ survey, trigger: readEventTrigger(survey.eventTrigger)! })).filter((x) => Boolean(x.trigger));
  }

  /** Read the records for new events and add them to the ledger (each once). */
  async detect(now: Date): Promise<number> {
    const tz = await this.timeZone();
    const today = dayKeyInTimeZone(now, tz);
    let added = 0;
    for (const { survey, trigger } of await this.triggeredSurveys()) {
      try {
        const range = detectionRange(trigger, today);
        if (!range) continue;
        const found = await this.findEvents(survey, trigger, range.from, range.to, tz);
        added += await this.addOccurrences(survey, trigger, found, today, tz);
      } catch (e) {
        this.logger.warn(`Survey ${survey.id}: events not read (${e instanceof Error ? e.name : 'error'})`);
      }
    }
    return added;
  }

  private async addOccurrences(survey: Survey, trigger: SurveyEventTrigger, found: FoundEvent[], today: string, tz: string): Promise<number> {
    if (!found.length) return 0;
    const forEmployees = survey.targetKind === SurveyTargetKind.EMPLOYEE;
    const known = await this.prisma.surveyEventOccurrence.findMany({
      where: {
        surveyId: survey.id,
        event: trigger.event,
        ...(forEmployees ? { employeeId: { in: found.map((f) => f.personId) } } : { serviceUserId: { in: found.map((f) => f.personId) } }),
      },
      select: { id: true, sourceKey: true, employeeId: true, serviceUserId: true, eventOn: true, status: true, reason: true },
    });
    const keys = new Set(known.map((k) => k.sourceKey));
    const byKey = new Map(known.map((k) => [k.sourceKey, k]));
    const repeats = SURVEY_TRIGGER_EVENT_INFO[trigger.event].repeats;
    const personOf = (k: { employeeId?: string | null; serviceUserId?: string | null }) => k.employeeId ?? k.serviceUserId;
    // A row not sent because its record changed, let go, or stopped: it does not count as a survey had.
    const lapsed = (k: (typeof known)[number]) =>
      k.status === 'EXPIRED' || (k.status === 'SKIPPED' && CHANGED_REASONS.includes(k.reason ?? '')) || (k.status === 'CANCELLED' && k.reason === 'SURVEY_STOPPED');
    // Still waiting, or skipped only because its record changed: follows the record's new day.
    const movable = (k: (typeof known)[number]) => k.status === 'WAITING' || k.status === 'BATCH' || (k.status === 'SKIPPED' && CHANGED_REASONS.includes(k.reason ?? ''));
    const data: Prisma.SurveyEventOccurrenceCreateManyInput[] = [];
    let moved = 0;
    for (const f of [...found].sort((a, b) => a.eventDay.localeCompare(b.eventDay))) {
      const { dueOn, lastDay } = occurrenceDays(f.eventDay, trigger);
      // The same record with a new day (a discharge date corrected, an absence made longer, a review moved):
      // the row moves with it rather than being lost or sent twice.
      const same =
        byKey.get(f.sourceKey) ??
        (f.recordKey ? known.find((k) => k.sourceKey !== f.sourceKey && k.sourceKey.startsWith(`${f.recordKey}:`) && movable(k)) : undefined);
      if (same || keys.has(f.sourceKey)) {
        if (same && movable(same) && dayKeyInTimeZone(same.eventOn, tz) !== f.eventDay && lastDay >= today) {
          try {
            const r = await this.prisma.surveyEventOccurrence.updateMany({
              where: { id: same.id, status: same.status },
              data: {
                sourceKey: f.sourceKey,
                eventOn: startOfOperationalDayUtc(f.eventDay, tz),
                dueOn: startOfOperationalDayUtc(dueOn, tz),
                lastDay: startOfOperationalDayUtc(lastDay, tz),
                status: 'WAITING',
                reason: null,
                resolvedAt: null,
                resolvedById: null,
              },
            });
            moved += r.count;
          } catch (e) {
            if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
          }
        }
        keys.add(f.sourceKey);
        continue;
      }
      if (lastDay < today && !f.noDate) continue;
      const theirs = known.filter((k) => personOf(k) === f.personId && !lapsed(k));
      const added = data.filter((d) => personOf(d) === f.personId);
      // An event that happens once (care ending, a sign-off): one survey per person, even if the record is edited.
      if (!repeats && (theirs.length || added.length)) continue;
      // A burst of the same event for one person (e.g. several medicine changes): one survey.
      if (repeats) {
        const near = [...theirs.map((k) => dayKeyInTimeZone(k.eventOn, tz)), ...added.map((d) => dayKeyInTimeZone(d.eventOn as Date, tz))].some(
          (d) => Math.abs(daysBetween(d, f.eventDay)) < EVENT_REPEAT_GAP_DAYS,
        );
        if (near) continue;
      }
      keys.add(f.sourceKey);
      data.push({
        surveyId: survey.id,
        event: trigger.event,
        sourceKey: f.sourceKey,
        employeeId: forEmployees ? f.personId : null,
        serviceUserId: forEmployees ? null : f.personId,
        eventOn: startOfOperationalDayUtc(f.eventDay, tz),
        ...(f.noDate
          ? {
              // No real date: straight to staff, with the note; never sent automatically on a guessed day.
              dueOn: startOfOperationalDayUtc(today, tz),
              lastDay: startOfOperationalDayUtc(addDays(today, Math.max(trigger.windowDays, 14)), tz),
              status: 'DUE',
              reason: 'NO_DATE',
            }
          : { dueOn: startOfOperationalDayUtc(dueOn, tz), lastDay: startOfOperationalDayUtc(lastDay, tz), status: 'WAITING' }),
      });
    }
    if (!data.length) return moved;
    const res = await this.prisma.surveyEventOccurrence.createMany({ data, skipDuplicates: true });
    return res.count + moved;
  }

  /** Events for one survey with event days from..to (YYYY-MM-DD, the organisation's days). */
  async findEvents(survey: Survey, trigger: SurveyEventTrigger, from: string, to: string, tz: string): Promise<FoundEvent[]> {
    const gte = startOfOperationalDayUtc(from, tz);
    const lt = startOfOperationalDayUtc(addDays(to, 1), tz);
    const inDays = (d: Date | null | undefined) => {
      if (!d) return null;
      const day = dayKeyInTimeZone(d, tz);
      return day >= from && day <= to ? day : null;
    };
    const branches = survey.locationIds;
    const suBranch: Prisma.ServiceUserWhereInput = { deletedAt: null, ...(branches.length ? { locationId: { in: branches } } : {}) };
    const empWhere: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      ...(branches.length || survey.roleIds.length
        ? {
            employment: {
              ...(branches.length ? { locationId: { in: branches } } : {}),
              ...(survey.roleIds.length ? { jobTitleId: { in: survey.roleIds } } : {}),
            },
          }
        : {}),
    };
    const o = trigger.options;
    switch (trigger.event) {
      case 'FIRST_VISIT': {
        const groups = await this.prisma.scheduledVisit.groupBy({
          by: ['serviceUserId'],
          where: { deletedAt: null, status: { in: ['COMPLETED', 'PARTIALLY_COMPLETED'] }, serviceUser: suBranch },
          _min: { scheduledStartDateTime: true },
          having: { scheduledStartDateTime: { _min: { gte, lt } } },
        });
        return groups
          .map((g) => ({ personId: g.serviceUserId, day: inDays(g._min.scheduledStartDateTime) }))
          .filter((g): g is { personId: string; day: string } => Boolean(g.day))
          .map((g) => ({ personId: g.personId, sourceKey: `first-visit:${g.personId}`, eventDay: g.day }));
      }
      case 'CARE_REVIEW_DUE': {
        const rows = await this.prisma.serviceUserCarePlanInstance.findMany({
          where: {
            nextReviewDueAt: { gte, lt },
            status: 'PUBLISHED',
            lifecycleStatus: 'ACTIVE',
            carePathwayForm: { formType: 'CARE_PLAN' },
            serviceUser: suBranch,
            ...(o.firstReviewOnly ? { lastReviewedAt: null } : {}),
          },
          select: { id: true, serviceUserId: true, nextReviewDueAt: true },
        });
        return rows
          .map((r) => ({ r, day: inDays(r.nextReviewDueAt) }))
          .filter((x): x is { r: (typeof rows)[number]; day: string } => Boolean(x.day))
          .map(({ r, day }) => ({ personId: r.serviceUserId, sourceKey: `care-review:${r.id}:${day}`, eventDay: day, recordKey: `care-review:${r.id}` }));
      }
      case 'HOSPITAL_DISCHARGE': {
        const rows = await this.prisma.serviceUserAbsence.findMany({
          where: { deletedAt: null, isActive: true, endDate: { gte, lt }, absenceReasonCatalog: { code: 'HOSPITALISED' }, serviceUser: suBranch },
          select: { id: true, serviceUserId: true, startDate: true, endDate: true },
        });
        return rows
          .map((r) => ({ r, day: inDays(r.endDate) }))
          .filter((x): x is { r: (typeof rows)[number]; day: string } => Boolean(x.day))
          .filter(({ r, day }) => daysBetween(dayKeyInTimeZone(r.startDate, tz), day) >= (o.minNights ?? 1))
          .map(({ r, day }) => ({ personId: r.serviceUserId, sourceKey: `hospital:${r.id}`, eventDay: day }));
      }
      case 'COMPLAINT_CLOSED': {
        const family = o.complaintFrom === 'FAMILY';
        const rows = await this.prisma.feedbackRecord.findMany({
          where: {
            deletedAt: null,
            type: 'COMPLAINT',
            status: 'CLOSED',
            fromKind: family ? 'FAMILY' : 'SERVICE_USER',
            OR: [{ respondedAt: { gte, lt } }, { respondedAt: null, closedAt: { gte, lt } }],
          },
          select: { id: true, fromServiceUserId: true, aboutServiceUserId: true, respondedAt: true, closedAt: true },
        });
        const personOf = (r: (typeof rows)[number]) => (family ? r.aboutServiceUserId : r.fromServiceUserId);
        const ids = [...new Set(rows.map(personOf).filter((x): x is string => Boolean(x)))];
        const inBranch = new Set((await this.prisma.serviceUser.findMany({ where: { ...suBranch, id: { in: ids } }, select: { id: true } })).map((s) => s.id));
        return rows
          .map((r) => ({ personId: personOf(r), day: inDays(r.respondedAt ?? r.closedAt), id: r.id }))
          .filter((x): x is { personId: string; day: string; id: string } => Boolean(x.personId && x.day && inBranch.has(x.personId)))
          .map((x) => ({ personId: x.personId, sourceKey: `complaint:${x.id}`, eventDay: x.day }));
      }
      case 'MEDICINES_CHANGE': {
        const rows = await this.prisma.serviceUserMedication.findMany({
          where: { deletedAt: null, serviceUser: suBranch, OR: [{ createdAt: { gte, lt } }, { statusEndedAt: { gte, lt } }] },
          select: { serviceUserId: true, createdAt: true, statusEndedAt: true, serviceUser: { select: { serviceStartDate: true } } },
        });
        const first = new Map<string, string>();
        for (const r of rows) {
          for (const d of [inDays(r.createdAt), inDays(r.statusEndedAt)]) {
            if (!d) continue;
            const start = r.serviceUser.serviceStartDate ? dayKeyInTimeZone(r.serviceUser.serviceStartDate, tz) : null;
            // A new package: its medicines are asked about at the first review, not separately.
            if (start && daysBetween(start, d) < (o.ignoreFirstDays ?? 42)) continue;
            const prev = first.get(r.serviceUserId);
            if (!prev || d < prev) first.set(r.serviceUserId, d);
          }
        }
        return [...first].map(([personId, day]) => ({ personId, sourceKey: `medicines:${personId}:${day}`, eventDay: day }));
      }
      case 'CARE_ENDED': {
        const rows = await this.prisma.serviceUser.findMany({
          where: {
            ...suBranch,
            dateOfDeath: null,
            status: { is: { code: 'DISCHARGED' } },
            OR: [{ serviceEndDate: { gte, lt } }, { serviceEndDate: null, updatedAt: { gte, lt } }],
          },
          select: { id: true, serviceEndDate: true, updatedAt: true },
        });
        return rows
          .map((r) => ({ id: r.id, day: inDays(r.serviceEndDate ?? r.updatedAt), noDate: !r.serviceEndDate }))
          .filter((x): x is { id: string; day: string; noDate: boolean } => Boolean(x.day))
          .map((x) =>
            x.noDate
              ? { personId: x.id, sourceKey: `care-ended:${x.id}:nodate`, eventDay: x.day, recordKey: `care-ended:${x.id}`, noDate: true }
              : { personId: x.id, sourceKey: `care-ended:${x.id}:${x.day}`, eventDay: x.day, recordKey: `care-ended:${x.id}` },
          );
      }
      case 'DEATH': {
        const rows = await this.prisma.serviceUser.findMany({
          where: {
            ...suBranch,
            OR: [{ dateOfDeath: { gte, lt } }, { dateOfDeath: null, status: { is: { code: 'DECEASED' } }, updatedAt: { gte, lt } }],
          },
          select: { id: true, dateOfDeath: true, updatedAt: true },
        });
        return rows
          .map((r) => ({ id: r.id, day: inDays(r.dateOfDeath ?? r.updatedAt), noDate: !r.dateOfDeath }))
          .filter((x): x is { id: string; day: string; noDate: boolean } => Boolean(x.day))
          .map((x) => ({ personId: x.id, sourceKey: `death:${x.id}`, eventDay: x.day, ...(x.noDate ? { noDate: true } : {}) }));
      }
      case 'NEW_STARTER_SIGN_OFF': {
        const rows = await this.prisma.employeeReview.findMany({
          where: {
            deletedAt: null,
            nextDue: null,
            lastDone: { gte, lt },
            reviewType: { code: o.reviewType ?? 'PROBATION_REVIEW', scheduleKind: 'MILESTONES' },
            employee: empWhere,
          },
          select: { id: true, employeeId: true, lastDone: true },
        });
        return rows
          .map((r) => ({ r, day: inDays(r.lastDone) }))
          .filter((x): x is { r: (typeof rows)[number]; day: string } => Boolean(x.day))
          .map(({ r, day }) => ({ personId: r.employeeId, sourceKey: `staff-review:${r.id}:${day}`, eventDay: day, recordKey: `staff-review:${r.id}` }));
      }
      case 'NOTICE_GIVEN': {
        const rows = await this.prisma.employeeLeavingRecord.findMany({
          where: { deletedAt: null, createdAt: { gte, lt }, employee: empWhere },
          select: { id: true, employeeId: true, createdAt: true },
        });
        return rows
          .map((r) => ({ r, day: inDays(r.createdAt) }))
          .filter((x): x is { r: (typeof rows)[number]; day: string } => Boolean(x.day))
          .map(({ r, day }) => ({ personId: r.employeeId, sourceKey: `leaving:${r.id}`, eventDay: day }));
      }
      case 'RETURN_FROM_LONG_ABSENCE': {
        // The first day back is the day after the absence ends.
        const rows = await this.prisma.employeeAbsenceRecord.findMany({
          where: {
            deletedAt: null,
            OR: [{ absenceType: { in: ['Sickness', 'Maternity', 'Paternity'] } }, { sicknessFlag: true }],
            toDateTime: { gte: startOfOperationalDayUtc(addDays(from, -1), tz), lt: startOfOperationalDayUtc(to, tz) },
            employee: empWhere,
          },
          select: { id: true, employeeId: true, fromDateTime: true, toDateTime: true },
        });
        return rows
          .map((r) => {
            const end = dayKeyInTimeZone(r.toDateTime, tz);
            const back = addDays(end, 1);
            const long = daysBetween(dayKeyInTimeZone(r.fromDateTime, tz), end) + 1 >= (o.minDays ?? 28);
            return long && back >= from && back <= to ? { personId: r.employeeId, sourceKey: `absence:${r.id}`, eventDay: back } : null;
          })
          .filter((x): x is FoundEvent => Boolean(x));
      }
      default:
        return [];
    }
  }

  /**
   * Checks made when a survey falls due (built-in for the event, plus the survey's chosen ones). Returns
   * the reason a row is not sent, or null.
   */
  async checkRows(rows: Occurrence[], trigger: SurveyEventTrigger, now: Date, tz: string): Promise<Map<string, OccurrenceReason | null>> {
    const out = new Map<string, OccurrenceReason | null>();
    const today = dayKeyInTimeZone(now, tz);
    const todayStart = startOfOperationalDayUtc(today, tz);
    const suIds = [...new Set(rows.map((r) => r.serviceUserId).filter((x): x is string => Boolean(x)))];
    const empIds = [...new Set(rows.map((r) => r.employeeId).filter((x): x is string => Boolean(x)))];
    const [sus, inHospital, safeguarding, complaints, emps, leaving] = await Promise.all([
      suIds.length
        ? this.prisma.serviceUser.findMany({ where: { id: { in: suIds } }, select: { id: true, deletedAt: true, dateOfDeath: true, status: { select: { code: true } } } })
        : [],
      suIds.length
        ? this.prisma.serviceUserAbsence.findMany({
            where: {
              serviceUserId: { in: suIds },
              deletedAt: null,
              isActive: true,
              absenceReasonCatalog: { code: 'HOSPITALISED' },
              startDate: { lt: startOfOperationalDayUtc(addDays(today, 1), tz) },
              OR: [{ endDate: null }, { endDate: { gte: todayStart } }],
            },
            select: { serviceUserId: true },
          })
        : [],
      suIds.length && trigger.exclusions.includes('OPEN_SAFEGUARDING')
        ? this.prisma.safeguardingCase.findMany({ where: { aboutServiceUserId: { in: suIds }, deletedAt: null, status: { not: 'CLOSED' } }, select: { aboutServiceUserId: true } })
        : [],
      suIds.length && trigger.exclusions.includes('OPEN_COMPLAINT')
        ? this.prisma.feedbackRecord.findMany({ where: { aboutServiceUserId: { in: suIds }, deletedAt: null, type: 'COMPLAINT', status: { not: 'CLOSED' } }, select: { aboutServiceUserId: true } })
        : [],
      empIds.length ? this.prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, deletedAt: true, isActive: true } }) : [],
      empIds.length
        ? this.prisma.employeeLeavingRecord.findMany({
            where: { employeeId: { in: empIds }, deletedAt: null },
            select: { id: true, employeeId: true, leavingDate: true, leavingReason: { select: { name: true } } },
          })
        : Promise.resolve([] as Array<{ id: string; employeeId: string; leavingDate: Date; leavingReason: { name: string } | null }>),
    ]);
    const suById = new Map(sus.map((s) => [s.id, s]));
    const hospital = new Set(inHospital.map((a) => a.serviceUserId));
    const openSg = new Set(safeguarding.map((c) => c.aboutServiceUserId));
    const openCo = new Set(complaints.map((c) => c.aboutServiceUserId));
    const empById = new Map(emps.map((e) => [e.id, e]));
    for (const r of rows) {
      let reason: OccurrenceReason | null = null;
      if (r.serviceUserId) {
        const su = suById.get(r.serviceUserId);
        const died = !su || Boolean(su.dateOfDeath) || su.status?.code === 'DECEASED';
        const ended = su?.status?.code === 'DISCHARGED' || su?.status?.code === 'INACTIVE';
        if (!su || su.deletedAt) reason = 'RECORD_REMOVED';
        else if (trigger.event !== 'DEATH' && died) reason = 'DIED';
        else if (ended && !['CARE_ENDED', 'COMPLAINT_CLOSED', 'DEATH'].includes(trigger.event)) reason = 'CARE_ENDED';
        else if (hospital.has(r.serviceUserId) && (trigger.event === 'HOSPITAL_DISCHARGE' || trigger.exclusions.includes('IN_HOSPITAL'))) reason = 'IN_HOSPITAL';
        else if (openSg.has(r.serviceUserId)) reason = 'OPEN_SAFEGUARDING';
        else if (openCo.has(r.serviceUserId)) reason = 'OPEN_COMPLAINT';
      } else if (r.employeeId) {
        const e = empById.get(r.employeeId);
        const theirs = leaving.filter((l) => l.employeeId === r.employeeId);
        if (!e || e.deletedAt || (!e.isActive && trigger.event !== 'NOTICE_GIVEN')) reason = 'LEFT';
        else if (trigger.event === 'NOTICE_GIVEN') {
          const rec = theirs.find((l) => r.sourceKey === `leaving:${l.id}`);
          if (!rec) reason = 'RECORD_REMOVED';
          else if (/death|deceased|died/i.test(rec.leavingReason?.name ?? '')) reason = 'DEATH_IN_SERVICE';
        } else if (theirs.length) {
          // Notice of leaving (or having left) stops every other named staff event survey.
          reason = 'LEFT';
        }
      }
      if (!reason) reason = await this.eventStillTrue(r, trigger, tz);
      out.set(r.id, reason);
    }
    return out;
  }

  /** The record that raised it still says the same (not reopened, moved or removed). */
  private async eventStillTrue(r: Occurrence, trigger: SurveyEventTrigger, tz: string): Promise<OccurrenceReason | null> {
    const [, id] = r.sourceKey.split(':');
    const eventDay = dayKeyInTimeZone(r.eventOn, tz);
    const needsRecord = ['COMPLAINT_CLOSED', 'CARE_REVIEW_DUE', 'HOSPITAL_DISCHARGE', 'RETURN_FROM_LONG_ABSENCE'].includes(trigger.event);
    if (needsRecord && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) return 'RECORD_REMOVED';
    switch (trigger.event) {
      case 'COMPLAINT_CLOSED': {
        const c = await this.prisma.feedbackRecord.findUnique({ where: { id }, select: { status: true, deletedAt: true } });
        return !c || c.deletedAt ? 'RECORD_REMOVED' : c.status !== 'CLOSED' ? 'COMPLAINT_REOPENED' : null;
      }
      case 'CARE_REVIEW_DUE': {
        const p = await this.prisma.serviceUserCarePlanInstance.findUnique({ where: { id }, select: { nextReviewDueAt: true, lifecycleStatus: true } });
        return !p || p.lifecycleStatus !== 'ACTIVE' || !p.nextReviewDueAt || dayKeyInTimeZone(p.nextReviewDueAt, tz) !== eventDay ? 'REVIEW_CHANGED' : null;
      }
      case 'HOSPITAL_DISCHARGE': {
        const a = await this.prisma.serviceUserAbsence.findUnique({ where: { id }, select: { deletedAt: true, isActive: true, endDate: true } });
        return !a || a.deletedAt || !a.isActive || !a.endDate || dayKeyInTimeZone(a.endDate, tz) !== eventDay ? 'RECORD_REMOVED' : null;
      }
      case 'RETURN_FROM_LONG_ABSENCE': {
        const a = await this.prisma.employeeAbsenceRecord.findUnique({ where: { id }, select: { deletedAt: true, toDateTime: true } });
        return !a || a.deletedAt || addDays(dayKeyInTimeZone(a.toDateTime, tz), 1) !== eventDay ? 'ABSENCE_CHANGED' : null;
      }
      default:
        return null;
    }
  }

  /** Rows whose due day has come: let go, checked, given to staff, batched or sent. */
  async processDue(now: Date): Promise<{ sent: number; due: number }> {
    const tz = await this.timeZone();
    const today = dayKeyInTimeZone(now, tz);
    const rows = await this.prisma.surveyEventOccurrence.findMany({
      where: { status: { in: ['WAITING', 'BATCH', 'DUE'] }, dueOn: { lte: startOfOperationalDayUtc(today, tz) } },
      orderBy: { dueOn: 'asc' },
      take: 1000,
    });
    const bySurvey = new Map<string, Occurrence[]>();
    for (const r of rows) bySurvey.set(r.surveyId, [...(bySurvey.get(r.surveyId) ?? []), r]);
    let sent = 0;
    let due = 0;
    for (const [surveyId, list] of bySurvey) {
      try {
        const survey = await this.prisma.survey.findUnique({ where: { id: surveyId } });
        const trigger = survey ? readEventTrigger(survey.eventTrigger) : null;
        if (!survey || !trigger || survey.deletedAt || survey.status === SurveyStatus.CLOSED) {
          await this.resolve(list.map((r) => r.id), 'CANCELLED', 'SURVEY_STOPPED', now);
          continue;
        }
        // Rows raised under an earlier setting (another event): never sent as this one.
        const other = list.filter((r) => r.event !== trigger.event);
        if (other.length) await this.resolve(other.map((r) => r.id), 'CANCELLED', 'SURVEY_STOPPED', now);
        const mine = list.filter((r) => r.event === trigger.event);
        const expired = mine.filter((r) => dayKeyInTimeZone(r.lastDay, tz) < today);
        if (expired.length) await this.resolve(expired.map((r) => r.id), 'EXPIRED', 'WINDOW_PASSED', now);
        const live = mine.filter((r) => dayKeyInTimeZone(r.lastDay, tz) >= today && r.status !== 'DUE');
        if (!live.length) continue;
        const checks = await this.checkRows(live, trigger, now, tz);
        const ready: Occurrence[] = [];
        for (const r of live) {
          const reason = checks.get(r.id);
          if (reason) {
            await this.resolve([r.id], 'SKIPPED', reason, now);
            continue;
          }
          const d = dueDecision({ dueOn: dayKeyInTimeZone(r.dueOn, tz), lastDay: dayKeyInTimeZone(r.lastDay, tz) }, today, trigger);
          // A BATCH row was already checked (or needed no check): it waits only for 5 people.
          if ((d === 'CHECK' && r.status !== 'BATCH') || survey.targetKind === SurveyTargetKind.PUBLIC) {
            await this.prisma.surveyEventOccurrence.updateMany({ where: { id: r.id, status: { in: ['WAITING', 'BATCH'] } }, data: { status: 'DUE' } });
            due += 1;
          } else if (d === 'SEND' || d === 'CHECK') ready.push(r);
        }
        sent += await this.sendRows(survey, ready, now, null);
      } catch (e) {
        this.logger.warn(`Survey ${surveyId}: event sends not processed (${e instanceof Error ? e.name : 'error'})`);
      }
    }
    return { sent, due };
  }

  /** Send these rows now (the job, or staff's Send). Anonymous surveys: only 5 or more at once (else BATCH). */
  private async sendRows(survey: Survey, rows: Occurrence[], now: Date, actorId: string | null): Promise<number> {
    if (!rows.length) return 0;
    if (survey.isAnonymous && rows.length < EVENT_ANONYMOUS_BATCH) {
      await this.prisma.surveyEventOccurrence.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'BATCH' } });
      return 0;
    }
    const prior = new Map(rows.map((r) => [r.id, r.status]));
    // Claimed first, with a mark of this run: another server (or job run) never sends the same rows, and
    // rows it took first are left to it (a partial claim never strands rows marked sent but not sent).
    const claim = `CLAIM:${randomUUID()}`;
    await this.prisma.surveyEventOccurrence.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, status: { in: [...new Set(prior.values())] } },
      data: { status: 'SENT', reason: claim, resolvedAt: now, resolvedById: actorId },
    });
    const claimedIds = new Set(
      (await this.prisma.surveyEventOccurrence.findMany({ where: { id: { in: rows.map((r) => r.id) }, reason: claim }, select: { id: true } })).map((r) => r.id),
    );
    rows = rows.filter((r) => claimedIds.has(r.id));
    if (!rows.length) return 0;
    const ids = rows.map((r) => r.id);
    const backToBatch = () =>
      this.prisma.surveyEventOccurrence.updateMany({ where: { id: { in: ids } }, data: { status: 'BATCH', reason: null, resolvedAt: null, resolvedById: null } });
    if (survey.isAnonymous && rows.length < EVENT_ANONYMOUS_BATCH) {
      await backToBatch();
      return 0;
    }
    const personOf = (r: Occurrence) => (r.serviceUserId ?? r.employeeId)!;
    let result: Awaited<ReturnType<SurveysService['sendForEvents']>>;
    try {
      result = await this.surveys.sendForEvents(survey, rows.map(personOf), now);
    } catch (e) {
      // Put them back as they were: tried again next run (still within their last day).
      for (const r of rows) await this.prisma.surveyEventOccurrence.update({ where: { id: r.id }, data: { status: prior.get(r.id), reason: null, resolvedAt: null, resolvedById: null } });
      throw e;
    }
    if (result.deferred) {
      await backToBatch();
      return 0;
    }
    const sets: Array<[string[], string, OccurrenceReason | null]> = [
      [result.sent, 'SENT', null],
      [result.held, 'HELD', null],
      [result.skipped, 'SKIPPED', 'HELD_NOT_SENT'],
      [result.already, 'SKIPPED', 'ALREADY_SENT'],
      [result.unreachable, 'SKIPPED', result.periodClosed ? 'SURVEY_CLOSED' : 'NOT_REACHABLE'],
    ];
    for (const [ids, status, reason] of sets) {
      const set = new Set(ids);
      const mine = rows.filter((r) => set.has(personOf(r))).map((r) => r.id);
      if (mine.length) {
        await this.prisma.surveyEventOccurrence.updateMany({ where: { id: { in: mine } }, data: { status, reason, sentSurveyId: result.periodId } });
      }
    }
    // Anyone the send left out (e.g. not sampled): not sent, never left marked as sent.
    await this.prisma.surveyEventOccurrence.updateMany({ where: { id: { in: ids }, reason: claim }, data: { status: 'SKIPPED', reason: 'NOT_REACHABLE' } });
    return result.sent.length;
  }

  private async resolve(ids: string[], status: string, reason: string | null, now: Date, actorId: string | null = null) {
    if (!ids.length) return;
    await this.prisma.surveyEventOccurrence.updateMany({
      where: { id: { in: ids }, status: { in: OPEN_OCCURRENCE_STATUSES } },
      data: { status, reason, resolvedAt: now, resolvedById: actorId },
    });
  }

  // ─── Staff decisions (check first, family offers) ────────────────────────

  async decide(
    actor: RequestUser,
    surveyId: string,
    input: { ids: string[]; action: 'SEND' | 'DONT_SEND' | 'OFFERED'; reason?: string },
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.requireSurvey(actor, surveyId);
    const trigger = readEventTrigger(survey.eventTrigger);
    if (!trigger) throw new BadRequestException('This survey is not sent after events.');
    const reason = input.reason?.trim() ?? '';
    if (input.action === 'DONT_SEND' && (reason.length < 5 || reason.length > 300)) {
      throw new BadRequestException("Say why it should not be sent (5 to 300 characters).");
    }
    if (reason.length > 300) throw new BadRequestException('Keep the note under 300 characters.');
    const family = survey.targetKind === SurveyTargetKind.PUBLIC;
    if (input.action === 'SEND' && family) {
      throw new BadRequestException('Family surveys are offered by staff (by phone, letter or the survey link): mark them as offered.');
    }
    if (input.action === 'OFFERED' && !family) throw new BadRequestException('Send it, or choose not to send it.');
    const rows = await this.prisma.surveyEventOccurrence.findMany({ where: { surveyId, id: { in: input.ids }, status: 'DUE' } });
    if (!rows.length) throw new BadRequestException('Nothing is waiting for a decision. Refresh and try again.');
    const now = new Date();
    let sent = 0;
    if (input.action === 'SEND') {
      if (survey.status === SurveyStatus.CLOSED) throw new BadRequestException('This survey is closed.');
      const tz = await this.timeZone();
      const checks = await this.checkRows(rows, trigger, now, tz);
      const ok = rows.filter((r) => !checks.get(r.id));
      for (const r of rows.filter((r) => checks.get(r.id))) await this.resolve([r.id], 'SKIPPED', checks.get(r.id)!, now, actor.id);
      sent = await this.sendRows(survey, ok, now, actor.id);
    } else {
      await this.resolve(rows.map((r) => r.id), input.action === 'OFFERED' ? 'OFFERED' : 'SKIPPED', reason || null, now, actor.id);
    }
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_EVENT_SEND_DECIDED,
      recordType: 'Survey',
      recordId: survey.id,
      description: `Event sends for survey "${survey.title}": ${input.action === 'SEND' ? 'sent' : input.action === 'OFFERED' ? 'offered' : 'not sent'}`,
      // Counts and the reason only: never who, or what happened to them.
      newValues: { action: input.action, people: rows.length, sent, ...(reason ? { reason } : {}) },
      metadata: { surveyId: survey.id },
      ...meta,
    });
    await this.syncTasks(now).catch(() => 0);
    const word = input.action === 'SEND' ? `Sent to ${sent}` : input.action === 'OFFERED' ? `Marked ${rows.length} as offered` : `${rows.length} will not be sent it`;
    return { message: word, data: { people: rows.length, sent } };
  }

  // ─── Tasks for staff checks and offers ───────────────────────────────────

  private async resolveRole(ownerKey: string): Promise<{ id: string; name: string } | null> {
    const roles = await this.prisma.role.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
    const setting = await this.prisma.surveyAlertOwnerRole.findUnique({ where: { ownerKey } }).catch(() => null);
    return (setting ? roles.find((r) => r.id === setting.roleId) : undefined) ?? roleForOwner(ownerKey as never, roles) ?? roleForOwner('REGISTERED_MANAGER', roles);
  }

  /** One open task per survey while rows wait for staff; closed when none wait. Counts only, never names. */
  async syncTasks(now: Date): Promise<number> {
    const waiting = await this.prisma.surveyEventOccurrence.groupBy({ by: ['surveyId'], where: { status: 'DUE' }, _count: { _all: true } });
    const waitingBy = new Map(waiting.map((w) => [w.surveyId, w._count._all]));
    const open = await this.prisma.roleTask.findMany({ where: { sourceType: SURVEY_EVENT_DUE_TASK_SOURCE, status: { in: OPEN_TASK } }, select: { id: true, sourceId: true } });
    let changed = 0;
    for (const t of open) {
      if (t.sourceId && waitingBy.has(t.sourceId)) continue;
      await this.prisma.roleTask.update({ where: { id: t.id }, data: { status: RoleTaskStatus.DONE, completedAt: now, note: 'Nothing is waiting for a decision.' } });
      changed += 1;
    }
    const hasTask = new Set(open.map((t) => t.sourceId));
    const tz = await this.timeZone();
    for (const [surveyId, count] of waitingBy) {
      if (hasTask.has(surveyId)) continue;
      const survey = await this.prisma.survey.findUnique({ where: { id: surveyId } });
      const trigger = survey ? readEventTrigger(survey.eventTrigger) : null;
      if (!survey || !trigger) continue;
      const role = await this.resolveRole(trigger.ownerKey);
      if (!role) continue;
      const generic = (await surveyResultsAudience(this.prisma, survey)).restricted;
      const family = survey.targetKind === SurveyTargetKind.PUBLIC;
      const name = generic ? 'a survey' : `"${survey.title}"`;
      const due = addDays(dayKeyInTimeZone(now, tz), 2);
      const made = await this.prisma.$transaction(async (tx) => {
        // Two servers (or job runs) never both make it: one at a time per survey, then look again.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`survey-event-due:${survey.id}`}))`;
        const exists = await tx.roleTask.findFirst({ where: { sourceType: SURVEY_EVENT_DUE_TASK_SOURCE, sourceId: survey.id, status: { in: OPEN_TASK } }, select: { id: true } });
        if (exists) return false;
        await tx.roleTask.create({
        data: {
          id: randomUUID(),
          templateId: null,
          sourceType: SURVEY_EVENT_DUE_TASK_SOURCE,
          sourceId: survey.id,
          roleId: role.id,
          locationId: survey.locationIds.length === 1 ? survey.locationIds[0] : null,
          title: (family ? `Offer ${name} to families` : `Check who should be sent ${name}`).slice(0, 200),
          description: `${count} ${count === 1 ? 'person is' : 'people are'} due ${family ? 'to be offered it' : 'to be sent it after something recorded in their records'}. Open the survey's "Sent when something happens" list to decide.`,
          link: `/surveys/${survey.id}?panel=events`,
          dueDate: new Date(`${due}T00:00:00.000Z`),
        },
        });
        return true;
      });
      if (!made) continue;
      changed += 1;
      try {
        const holders = await this.prisma.userRole.findMany({ where: { roleId: role.id, user: { deletedAt: null, isActive: true } }, select: { userId: true } });
        if (holders.length && this.notifications) {
          await this.notifications.notifyUsers({
            recipientUserIds: [...new Set(holders.map((h) => h.userId))],
            type: NotificationType.SYSTEM_MESSAGE,
            module: NotificationModule.SYSTEM,
            severity: NotificationSeverity.INFO,
            title: family ? 'Survey to offer' : 'Survey sends to check',
            message: `${count} ${count === 1 ? 'person is' : 'people are'} waiting for a decision on ${name}.`,
            recordType: 'Survey',
            recordId: survey.id,
            metadata: { href: `/surveys/${survey.id}?panel=events`, surveyId: survey.id, eventType: 'SURVEY_EVENT_DUE' },
          });
        }
      } catch {
        // The task is enough.
      }
    }
    return changed;
  }

  // ─── Deaths ──────────────────────────────────────────────────────────────

  /**
   * A death recorded on a person's record stops every survey contact still waiting for them: event sends
   * (except the bereaved-family survey), people held back by the 4-week rule, and waiting invitation texts.
   * Reminders and call lists already leave them out. Idempotent; audited as counts only.
   */
  async stopAfterDeaths(now: Date): Promise<number> {
    const since = new Date(now.getTime() - DEATH_SWEEP_DAYS * 86_400_000);
    const died = await this.prisma.serviceUser.findMany({
      // A death recorded late (date of death long ago, entered recently) counts from when it was recorded.
      where: {
        OR: [
          { dateOfDeath: { gte: since } },
          { dateOfDeath: { not: null }, updatedAt: { gte: since } },
          { status: { is: { code: 'DECEASED' } }, updatedAt: { gte: since } },
        ],
      },
      select: { id: true },
    });
    if (!died.length) return 0;
    const ids = died.map((d) => d.id);
    const [occ, held, texts] = await Promise.all([
      this.prisma.surveyEventOccurrence.updateMany({
        where: { serviceUserId: { in: ids }, status: { in: OPEN_OCCURRENCE_STATUSES }, event: { not: 'DEATH' } },
        data: { status: 'CANCELLED', reason: 'DIED', resolvedAt: now },
      }),
      this.prisma.surveyHeldBack.updateMany({ where: { serviceUserId: { in: ids }, status: 'HELD' }, data: { status: 'CANCELLED', resolvedAt: now } }),
      this.prisma.surveyRecipient.updateMany({ where: { serviceUserId: { in: ids }, invitationTextPending: true }, data: { invitationTextPending: false } }),
    ]);
    const total = occ.count + held.count + texts.count;
    if (total) {
      await this.audit.logAudit({
        userId: undefined,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_CONTACT_STOPPED_AFTER_DEATH,
        recordType: 'Survey',
        description: 'Survey contact stopped after deaths recorded on people\'s records',
        // Counts only: never who.
        newValues: { eventSends: occ.count, heldBack: held.count, waitingTexts: texts.count },
      });
    }
    return total;
  }

  /** For tests and the screens: the words for a reason. */
  static reasonWords(reason: string | null): string | null {
    return reasonWords(reason);
  }

  static audienceOf(targetKind: string): TriggerAudience {
    return triggerAudienceOf(targetKind);
  }
}

export { OCCURRENCE_REASONS };
