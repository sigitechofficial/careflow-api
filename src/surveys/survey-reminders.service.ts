import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
  RoleTaskStatus,
  SurveyRecipientStatus,
  SurveyStatus,
  SurveyTargetKind,
  type Survey,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { MailService } from '../mail/mail.service';
import { FcmPushService } from '../notifications/fcm-push.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  dayKeyInTimeZone,
  startOfOperationalDayUtc,
  addDaysToOperationalIso,
} from '../common/utils/operational-day.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { TextMessageService } from '../text-messages/text-message.service';
import { firstUkMobile, normaliseUkMobile } from '../text-messages/uk-mobile.util';
import { surveyVisibleInScope } from './survey-scope.util';
import { usersInSurveyBranches } from './survey-office-recipients';
import { surveyAccessFor, surveyResultsAudience } from './survey-access';
import { roleForOwner } from './survey-alert-rules.util';
import { personalLinkPath } from './survey-recipient-links.service';
import { formatSurveyDateTime } from './survey-recurrence.util';
import { candidateScopeWhere, resolveRecruitmentScope } from '../hr/recruitment/utils/recruitment-scope.util';
import {
  callDue,
  checkContactPlan,
  contactChannelsFor,
  dueReminderStep,
  isQuietTime,
  MAX_SURVEY_REMINDERS,
  MIN_REMINDER_GAP_DAYS,
  readContactPlan,
  reminderGapPassed,
  suggestedContactPlan,
  SURVEY_CONTACT_CHANNEL_LABELS,
  type SurveyContactChannel,
  type SurveyContactPlan,
} from './survey-contact-plan.util';
import { surveyContactMessages } from './survey-contact-messages.util';
import { surveyEmailBranding, surveyEmailFacts } from './survey-email-branding';
import { SURVEY_TEXT_STOP_REASON } from './survey-text-replies.service';
import { SurveyUnsubscribeService } from './survey-unsubscribe.service';
import { LAPSABLE_STATUSES, SURVEY_UNSUBSCRIBE_REASON, ineligibleRecipientIds, noAutomaticContactIds, organisationDomains, personalEmail } from './survey-eligibility.util';
import { staffAnswerPlaces, type StaffAnswerPlaces } from './survey-staff-answer-places';
import { OPEN_OCCURRENCE_STATUSES, SURVEY_TRIGGER_EVENT_INFO } from './survey-event-triggers.util';

/** RoleTask.sourceType of the phone call list task (sourceId = the survey or period). */
export const SURVEY_CALL_LIST_TASK_SOURCE = 'SURVEY_CALL_LIST';

export const SURVEY_CALL_OUTCOMES = ['NO_ANSWER', 'LEFT_MESSAGE', 'CALL_BACK', 'DECLINED', 'WRONG_NUMBER'] as const;
export type SurveyCallOutcome = (typeof SURVEY_CALL_OUTCOMES)[number];
/** These take the person off the call list. */
const FINAL_CALL_OUTCOMES: readonly string[] = ['DECLINED', 'WRONG_NUMBER'];

/** CANDIDATE: a job applicant, kept out of applicant survey invitations (Phase 3). */
export const SURVEY_OPT_OUT_SUBJECTS = ['EMPLOYEE', 'SERVICE_USER', 'CONTACT', 'EXTERNAL', 'CANDIDATE'] as const;
export type SurveyOptOutSubject = (typeof SURVEY_OPT_OUT_SUBJECTS)[number];
export const SURVEY_OPT_OUT_CHANNELS = ['ALL', 'EMAIL', 'TEXT', 'APP', 'PORTAL', 'PHONE'] as const;
export type SurveyOptOutChannel = (typeof SURVEY_OPT_OUT_CHANNELS)[number];

/** People not yet marked Completed (completion is tracked, on anonymous surveys without any link to answers). */
const NOT_ANSWERED: SurveyRecipientStatus[] = [SurveyRecipientStatus.PENDING, SurveyRecipientStatus.SENT, SurveyRecipientStatus.STARTED];
const OPEN_TASK: RoleTaskStatus[] = [RoleTaskStatus.OPEN, RoleTaskStatus.IN_PROGRESS];

type Person = { id: string; token: string; employeeId: string | null; serviceUserId: string | null; externalContactId?: string | null };
type Counts = { people: number; email: number; app: number; portal: number; text: number; noContact: number; optedOut: number };
const zero = (): Counts => ({ people: 0, email: 0, app: 0, portal: 0, text: 0, noContact: 0, optedOut: 0 });

/**
 * Reminders and contact plans (Phase 2 part 1). Reminders go only to people not marked Completed, by
 * the plan's channels, outside quiet hours, never more than three per person. Anonymous surveys: no
 * personal links in any message, reminder dates on the person are the day only, runs are kept as
 * counts and shown without a live "not answered" figure below the reporting threshold, there is no
 * call list and "Remind now" reminds everyone not done (never one person). Named surveys add the
 * phone follow-up: a task for a role and a call list where calls and answers are recorded.
 * Opt-outs (SurveyContactOptOut) are honoured on every channel. Audit rows hold counts only.
 */
@Injectable()
export class SurveyRemindersService {
  private readonly logger = new Logger(SurveyRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly push: FcmPushService,
    private readonly texts: TextMessageService,
    private readonly notifications: NotificationsService,
    private readonly orgScope: OrgScopeService,
    @Optional() private readonly orgSettings?: OrganisationGeneralSettingsService,
    @Optional() private readonly unsubscribe?: SurveyUnsubscribeService,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async timeZone(): Promise<string> {
    try {
      return (await this.orgSettings?.getOperationalTimezone()) || DEFAULT_OPERATIONAL_TIMEZONE;
    } catch {
      return DEFAULT_OPERATIONAL_TIMEZONE;
    }
  }

  private async requireSurvey(actor: RequestUser, id: string): Promise<Survey> {
    const survey = await this.prisma.survey.findFirst({ where: { id, deletedAt: null, isCatalogue: false } });
    if (!survey || !surveyVisibleInScope(this.orgScope.fromRequestUser(actor), survey)) throw new NotFoundException('Survey not found');
    if (survey.isTemplate) throw new BadRequestException('Templates are never sent, so they have no reminders. Start a survey from the template first.');
    return survey;
  }

  /** The survey that holds the plan: a repeating survey's periods use their source survey's. */
  private async planOwner(survey: Survey): Promise<Survey> {
    if (!survey.clonedFromId) return survey;
    return (await this.prisma.survey.findUnique({ where: { id: survey.clonedFromId } })) ?? survey;
  }

  private appBase(): string | null {
    const base = this.config.get<string>('app.adminAppUrl', '') || '';
    return base ? base.replace(/\/+$/, '') : null;
  }

  private async organisationName(): Promise<string | null> {
    const p = await this.prisma.companyProfile
      ?.findFirst({ select: { displayName: true, companyName: true } })
      .catch(() => null);
    return p ? p.displayName?.trim() || p.companyName || null : null;
  }

  /** Opted-out channels per person ("EMPLOYEE:<id>" → channels, ALL included). */
  async optOutsFor(people: Array<{ employeeId: string | null; serviceUserId: string | null; externalContactId?: string | null }>): Promise<Map<string, Set<string>>> {
    const employeeIds = people.map((p) => p.employeeId).filter((x): x is string => Boolean(x));
    const serviceUserIds = people.map((p) => p.serviceUserId).filter((x): x is string => Boolean(x));
    const externalIds = people.map((p) => p.externalContactId).filter((x): x is string => Boolean(x));
    const map = new Map<string, Set<string>>();
    if (!employeeIds.length && !serviceUserIds.length && !externalIds.length) return map;
    // A family member from People involved: their opt-out is kept against that contact (CONTACT).
    const family = externalIds.length
      ? await Promise.resolve()
          .then(() => this.prisma.surveyExternalContact.findMany({ where: { id: { in: externalIds }, sourceType: 'SERVICE_USER_CONTACT' }, select: { id: true, sourceId: true } }))
          .catch(() => [] as Array<{ id: string; sourceId: string | null }>)
      : [];
    const contactIds = family.map((f) => f.sourceId).filter((x): x is string => Boolean(x));
    const rows = await this.prisma.surveyContactOptOut.findMany({
      where: {
        OR: [
          ...(employeeIds.length ? [{ subjectKind: 'EMPLOYEE', subjectId: { in: employeeIds } }] : []),
          ...(serviceUserIds.length ? [{ subjectKind: 'SERVICE_USER', subjectId: { in: serviceUserIds } }] : []),
          ...(externalIds.length ? [{ subjectKind: 'EXTERNAL', subjectId: { in: externalIds } }] : []),
          ...(contactIds.length ? [{ subjectKind: 'CONTACT', subjectId: { in: contactIds } }] : []),
        ],
      },
      select: { subjectKind: true, subjectId: true, channel: true },
    });
    const add = (key: string, channel: string) => {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(channel);
    };
    for (const r of rows) {
      if (r.subjectKind === 'CONTACT') {
        for (const f of family.filter((x) => x.sourceId === r.subjectId)) add(`EXTERNAL:${f.id}`, r.channel);
      } else add(`${r.subjectKind}:${r.subjectId}`, r.channel);
    }
    return map;
  }

  /**
   * Outside people's details as they are now: a family member from People involved is read again from that
   * record (name, email, mobile), as a first send does, so a changed or removed email is never used.
   */
  async outsideCurrentDetails(where: Prisma.SurveyExternalContactWhereInput): Promise<Array<{ id: string; name: string; organisation: string | null; email: string | null; mobile: string | null; phone: string | null }>> {
    const rows = await this.prisma.surveyExternalContact.findMany({
      where,
      select: { id: true, name: true, organisation: true, email: true, mobile: true, phone: true, sourceType: true, sourceId: true },
    });
    const sourceIds = rows.filter((r) => r.sourceType === 'SERVICE_USER_CONTACT' && r.sourceId).map((r) => r.sourceId!);
    const records = sourceIds.length
      ? await this.prisma.serviceUserContact.findMany({ where: { id: { in: sourceIds } }, select: { id: true, firstName: true, lastName: true, email: true, mobile: true, phone: true } })
      : [];
    const byId = new Map(records.map((c) => [c.id, c]));
    const out: Array<{ id: string; name: string; organisation: string | null; email: string | null; mobile: string | null; phone: string | null }> = [];
    for (const r of rows) {
      if (r.sourceType !== 'SERVICE_USER_CONTACT') {
        out.push({ id: r.id, name: r.name, organisation: r.organisation, email: r.email, mobile: r.mobile, phone: r.phone });
        continue;
      }
      const c = r.sourceId ? byId.get(r.sourceId) : undefined;
      if (!c) continue; // the record is gone: nothing to use
      out.push({
        id: r.id,
        name: `${c.firstName} ${c.lastName ?? ''}`.trim(),
        organisation: null,
        email: c.email?.trim() || null,
        mobile: normaliseUkMobile(c.mobile) ?? normaliseUkMobile(c.phone),
        phone: c.phone?.trim() || c.mobile?.trim() || null,
      });
    }
    return out;
  }

  private static optedOut(opts: Map<string, Set<string>>, p: { employeeId: string | null; serviceUserId: string | null; externalContactId?: string | null }, channel: string): boolean {
    const set = opts.get(p.employeeId ? `EMPLOYEE:${p.employeeId}` : p.serviceUserId ? `SERVICE_USER:${p.serviceUserId}` : `EXTERNAL:${p.externalContactId}`);
    return Boolean(set && (set.has('ALL') || set.has(channel)));
  }

  // ─── Plan ─────────────────────────────────────────────────────────────────

  async getPlan(actor: RequestUser, surveyId: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    const owner = await this.planOwner(survey);
    const access = await surveyAccessFor(this.prisma, actor, survey);
    const plan = readContactPlan(owner.contactPlan);
    const tz = await this.timeZone();
    const surveyIds = survey.clonedFromId ? [survey.id] : [survey.id, ...(await this.periodIds(survey.id))];
    const runs = await this.prisma.surveyReminderRun.findMany({
      where: { surveyId: { in: surveyIds } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    // Counts per run only for people who may see the survey's figures; on an anonymous survey only
    // once enough have answered to report (the difference between two runs is otherwise who answered).
    let showCounts = access.results;
    if (showCounts && survey.isAnonymous) {
      const answered = await this.prisma.surveyRecipient.count({ where: { surveyId: { in: surveyIds }, status: SurveyRecipientStatus.COMPLETED } });
      showCounts = answered >= access.threshold;
    }
    return {
      message: 'Reminders and follow-up',
      data: {
        plan,
        suggested: suggestedContactPlan(owner),
        /** Periods use the repeating survey's plan, changed there. */
        inheritedFrom: survey.clonedFromId ? { id: owner.id, title: owner.title } : null,
        isAnonymous: survey.isAnonymous,
        targetKind: survey.targetKind,
        channels: contactChannelsFor(survey.targetKind).map((c) => ({ value: c, label: SURVEY_CONTACT_CHANNEL_LABELS[c] })),
        textMessages: { enabled: this.texts.isEnabled(), provider: this.texts.providerName(), repliesSupported: this.texts.supportsReplies() },
        callListAvailable: !survey.isAnonymous,
        limits: { maxReminders: MAX_SURVEY_REMINDERS, minGapDays: MIN_REMINDER_GAP_DAYS },
        quietNow: isQuietTime(new Date(), plan ?? { quietStart: '20:00', quietEnd: '09:00', weekdaysOnly: false }, tz),
        runs: runs.map((r) => ({
          id: r.id,
          at: survey.isAnonymous ? dayKeyInTimeZone(r.createdAt, tz) : r.createdAt.toISOString(),
          step: r.step,
          manual: r.manual,
          counts: showCounts
            ? { people: r.people, email: r.email, app: r.app, portal: r.portal, text: r.text, noContact: r.noContact, optedOut: r.optedOut }
            : null,
        })),
      },
    };
  }

  private async periodIds(surveyId: string): Promise<string[]> {
    return (await this.prisma.survey.findMany({ where: { clonedFromId: surveyId, deletedAt: null }, select: { id: true } })).map((s) => s.id);
  }

  async savePlan(actor: RequestUser, surveyId: string, input: unknown, meta?: RequestAuditMeta) {
    const survey = await this.requireSurvey(actor, surveyId);
    if (survey.clonedFromId) {
      throw new BadRequestException('This is one period of a repeating survey. Change reminders on the repeating survey itself.');
    }
    let plan: SurveyContactPlan | null = null;
    if (input !== null) {
      const checked = checkContactPlan(input, survey);
      if (!checked.ok) throw new BadRequestException(checked.message);
      plan = checked.plan;
      if (plan.call?.roleId) {
        const role = await this.prisma.role.findFirst({ where: { id: plan.call.roleId, deletedAt: null }, select: { id: true } });
        if (!role) throw new BadRequestException('Choose a role for the calls.');
      }
      if (plan.channels.includes('TEXT') && !this.texts.isEnabled()) {
        throw new BadRequestException('Text messages are turned off for CareFlow. Choose another way to send reminders.');
      }
    }
    const updated = await this.prisma.survey.update({
      where: { id: survey.id },
      data: { contactPlan: plan ? (plan as unknown as Prisma.InputJsonValue) : Prisma.DbNull, updatedById: actor.id },
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_CONTACT_PLAN_UPDATED,
      recordType: 'Survey',
      recordId: survey.id,
      description: plan ? `Reminders and follow-up changed for survey "${survey.title}"` : `Reminders turned off for survey "${survey.title}"`,
      oldValues: { contactPlan: survey.contactPlan ?? null },
      newValues: { contactPlan: (plan as unknown as Prisma.InputJsonValue) ?? null },
      metadata: { surveyId: survey.id },
      ...meta,
    });
    return { message: plan ? 'Reminders saved' : 'Reminders turned off', data: { plan: readContactPlan(updated.contactPlan) } };
  }

  // ─── Reminders ────────────────────────────────────────────────────────────

  /**
   * "Remind now": everyone not marked Completed who has had fewer than three reminders and none in
   * the last two days. Never one person on an anonymous survey (there is no way to ask for one).
   */
  async remindNow(actor: RequestUser, surveyId: string, meta?: RequestAuditMeta) {
    const survey = await this.requireSurvey(actor, surveyId);
    if (survey.targetKind === SurveyTargetKind.PUBLIC && survey.isAnonymous) {
      throw new BadRequestException('Public surveys are answered through their shared link, so there is no one to remind.');
    }
    if (survey.status !== SurveyStatus.ACTIVE) throw new BadRequestException('This survey is not open for answers.');
    const now = new Date();
    if (survey.closesAt && survey.closesAt <= now) throw new BadRequestException('This survey has ended.');
    const owner = await this.planOwner(survey);
    const plan = readContactPlan(owner.contactPlan) ?? this.defaultPlan(survey.targetKind);
    const tz = await this.timeZone();
    if (isQuietTime(now, plan, tz)) {
      throw new BadRequestException(
        `It is within quiet hours (${plan.quietStart} to ${plan.quietEnd}${plan.weekdaysOnly ? ', or a weekend' : ''}), so no reminders are sent now. Try again later.`,
      );
    }
    if (!plan.channels.length) throw new BadRequestException('Choose at least one way to send reminders first.');
    const candidates = await this.prisma.surveyRecipient.findMany({
      where: { surveyId: survey.id, status: { in: NOT_ANSWERED }, sentAt: { not: null }, reminderCount: { lt: MAX_SURVEY_REMINDERS } },
      select: { id: true, token: true, employeeId: true, serviceUserId: true, externalContactId: true, reminderCount: true, remindedAt: true },
    });
    const due = candidates.filter((c) => reminderGapPassed(c.remindedAt, now, survey.isAnonymous));
    const access = await surveyAccessFor(this.prisma, actor, survey);
    if (!due.length) {
      // Anonymous surveys: the same answer whether or not anyone was due, or "no one left to remind"
      // straight after sending would say that everyone has answered.
      if (survey.isAnonymous) {
        return { message: 'Reminders are on their way to everyone who has not answered and can be reminded now.', data: { reminded: null } };
      }
      return {
        message: `No one can be reminded now: everyone who has not answered was reminded in the last ${MIN_REMINDER_GAP_DAYS} days or has had ${MAX_SURVEY_REMINDERS} reminders.`,
        data: { reminded: access.results && !survey.isAnonymous ? 0 : null },
      };
    }
    const counts = await this.remind(survey, plan, due, { step: null, manual: true, actorId: actor.id, now, tz, meta });
    return {
      message: survey.isAnonymous
        ? 'Reminders are on their way to everyone who has not answered and can be reminded now.'
        : !access.results
          ? 'Reminders are on their way to everyone who has not answered.'
          : `Reminders sent to ${counts.people} ${counts.people === 1 ? 'person' : 'people'}.`,
      data: { reminded: survey.isAnonymous || !access.results ? null : counts.people },
    };
  }

  /**
   * Remind one chosen person on a named survey (from the recipients list). Never on an anonymous
   * survey: asking to remind one person there would mean knowing they have not answered. Needs the
   * survey's individual responses access (who has answered is part of them). The same limits as
   * every reminder: three at most, two days apart, quiet hours, opt-outs.
   */
  async remindOne(actor: RequestUser, surveyId: string, recipientId: string, meta?: RequestAuditMeta) {
    const survey = await this.requireSurvey(actor, surveyId);
    if (survey.isAnonymous) {
      throw new BadRequestException('On an anonymous survey you can only remind everyone who has not answered, never one person.');
    }
    if (survey.status !== SurveyStatus.ACTIVE) throw new BadRequestException('This survey is not open for answers.');
    const now = new Date();
    if (survey.closesAt && survey.closesAt <= now) throw new BadRequestException('This survey has ended.');
    const access = await surveyAccessFor(this.prisma, actor, survey);
    if (!access.responses) {
      throw new ForbiddenException('Only people who can see this survey’s individual responses can remind one person.');
    }
    const recipient = await this.prisma.surveyRecipient.findFirst({
      where: { id: recipientId, surveyId: survey.id },
      select: { id: true, token: true, employeeId: true, serviceUserId: true, externalContactId: true, status: true, sentAt: true, reminderCount: true, remindedAt: true },
    });
    if (!recipient) throw new NotFoundException('Person not found on this survey');
    if (recipient.status === SurveyRecipientStatus.COMPLETED) throw new BadRequestException('They have already answered.');
    if (recipient.status === SurveyRecipientStatus.LAPSED || !(await this.keepEligible(survey, [recipient])).length) {
      throw new BadRequestException('They can no longer be sent this survey (for example their care has ended, or they have left).');
    }
    if (!recipient.sentAt) throw new BadRequestException('The survey has not been sent to them yet.');
    if (recipient.reminderCount >= MAX_SURVEY_REMINDERS) {
      throw new BadRequestException(`They have already had ${MAX_SURVEY_REMINDERS} reminders, the most anyone is sent.`);
    }
    if (!reminderGapPassed(recipient.remindedAt, now)) {
      throw new BadRequestException(`They were reminded in the last ${MIN_REMINDER_GAP_DAYS} days. Try again later, or phone them.`);
    }
    const owner = await this.planOwner(survey);
    const plan = readContactPlan(owner.contactPlan) ?? this.defaultPlan(survey.targetKind);
    const tz = await this.timeZone();
    if (isQuietTime(now, plan, tz)) {
      throw new BadRequestException(
        `It is within quiet hours (${plan.quietStart} to ${plan.quietEnd}${plan.weekdaysOnly ? ', or a weekend' : ''}), so no reminders are sent now. Try again later.`,
      );
    }
    if (!plan.channels.length) throw new BadRequestException('Choose at least one way to send reminders first.');
    const counts = await this.remind(survey, plan, [recipient], { step: null, manual: true, actorId: actor.id, now, tz, meta, recipientId: recipient.id });
    const ways = [
      counts.app ? 'the carer app' : null,
      counts.email ? 'email' : null,
      counts.portal ? 'their portal email' : null,
      counts.text ? 'text message' : null,
    ].filter((x): x is string => Boolean(x));
    if (counts.people) {
      return {
        message: `Reminder sent by ${ways.length > 1 ? `${ways.slice(0, -1).join(', ')} and ${ways[ways.length - 1]}` : ways[0]}.`,
        data: { reminded: true, reason: null },
      };
    }
    return {
      message: counts.optedOut
        ? 'Not sent: they have asked not to be contacted about surveys in these ways. Phone them or record their answers instead.'
        : 'Not sent: there is no way to reach them by the survey’s reminder channels. Check their contact details, or phone them.',
      data: { reminded: false, reason: counts.optedOut ? 'OPTED_OUT' : 'NO_CONTACT' },
    };
  }

  private defaultPlan(targetKind: SurveyTargetKind): SurveyContactPlan {
    return {
      reminders: [],
      channels: contactChannelsFor(targetKind).filter((c) => c !== 'TEXT'),
      quietStart: '20:00',
      quietEnd: '09:00',
      weekdaysOnly: false,
      call: null,
    };
  }

  /**
   * Take the people (only those still at their reminder count, so two servers never remind twice),
   * send, keep the run's counts and audit it. Anonymous surveys: the person's reminder date is the day only.
   */
  /**
   * Checked at the moment of every reminder, text and call list: people who can no longer be sent this survey
   * (same rules as sending) are dropped and their unanswered invitation marked LAPSED. Answers are kept.
   */
  async keepEligible<T extends { id: string; employeeId: string | null; serviceUserId: string | null; externalContactId?: string | null }>(
    survey: Survey,
    people: T[],
  ): Promise<T[]> {
    if (!people.length) return people;
    const owner = await this.planOwner(survey);
    const bad = await ineligibleRecipientIds(this.prisma, survey, owner, people);
    if (bad.size) {
      await this.prisma.surveyRecipient.updateMany({
        where: { id: { in: [...bad] }, status: { in: LAPSABLE_STATUSES } },
        data: { status: SurveyRecipientStatus.LAPSED, invitationTextPending: false },
      });
    }
    // After a death: some outside people may still answer the link they were sent, but are never chased
    // (a complaint follow-up to the family member who complained; professionals on a survey about that person).
    const quiet = await noAutomaticContactIds(this.prisma, survey, owner, people.filter((p) => !bad.has(p.id)));
    return people.filter((p) => !bad.has(p.id) && !quiet.has(p.id));
  }

  private async remind(
    survey: Survey,
    plan: SurveyContactPlan,
    people: Array<Person & { reminderCount: number; remindedAt?: Date | null }>,
    opts: { step: number | null; manual: boolean; actorId: string | null; now: Date; tz: string; meta?: RequestAuditMeta; recipientId?: string },
  ): Promise<Counts> {
    people = await this.keepEligible(survey, people);
    if (!people.length) return zero();
    const stamp = survey.isAnonymous ? startOfOperationalDayUtc(dayKeyInTimeZone(opts.now, opts.tz), opts.tz) : opts.now;
    const taken: string[] = [];
    const byCount = new Map<number, string[]>();
    for (const p of people) byCount.set(p.reminderCount, [...(byCount.get(p.reminderCount) ?? []), p.id]);
    for (const [count, ids] of byCount) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE "surveys"."SurveyRecipient"
           SET "reminderCount" = "reminderCount" + 1, "remindedAt" = ${stamp}, "updatedAt" = ${stamp}
         WHERE "id" = ANY(${ids}::uuid[]) AND "reminderCount" = ${count} AND "status"::text <> 'COMPLETED'
         RETURNING "id"`;
      taken.push(...rows.map((r) => r.id));
    }
    const takenSet = new Set(taken);
    const chosen = people.filter((p) => takenSet.has(p.id));
    const counts = chosen.length ? await this.deliver(survey, plan.channels, chosen, { reminder: true }) : zero();
    if (!chosen.length) return counts;
    if (opts.recipientId && !counts.people) {
      // One chosen person who could not be reached: nothing was sent, so it does not count as a reminder.
      const p = chosen[0];
      await this.prisma.surveyRecipient.updateMany({
        where: { id: p.id, reminderCount: p.reminderCount + 1 },
        data: { reminderCount: p.reminderCount, remindedAt: p.remindedAt ?? null },
      });
      return counts;
    }
    await this.prisma.surveyReminderRun.create({
      data: { id: randomUUID(), surveyId: survey.id, step: opts.step, manual: opts.manual, sentById: opts.actorId, ...counts, createdAt: stamp },
    });
    await this.audit.logAudit({
      userId: opts.actorId ?? undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_REMINDERS_SENT,
      // Named surveys only name the person (remindOne refuses anonymous surveys).
      recordType: opts.recipientId && !survey.isAnonymous ? 'SurveyRecipient' : 'Survey',
      recordId: opts.recipientId && !survey.isAnonymous ? opts.recipientId : survey.id,
      description: `${opts.recipientId ? 'Reminder sent by hand to one person' : opts.manual ? 'Reminders sent by hand' : `Reminder ${opts.step} sent`} for survey "${survey.title}"`,
      // Counts only: never who, their numbers or addresses. Anonymous surveys: not even the counts.
      // The audit row has the exact time and is open to everyone who reads the audit log, so counts
      // there would show how many answered between two runs below the reporting threshold (the run's
      // own counts are shown only to people with results access, once the threshold is reached).
      newValues: survey.isAnonymous ? { step: opts.step, manual: opts.manual } : { ...counts, step: opts.step, manual: opts.manual },
      metadata: { surveyId: survey.id },
      ...(opts.meta ?? {}),
    });
    return counts;
  }

  /**
   * Send an invitation or reminder to each person by the chosen channels. Staff: carer-app
   * notification, email, text. People we support: portal account email, their own email (named
   * surveys only: it carries their own link), text. Opt-outs, deaths and missing details are skipped
   * and counted. Never fails the caller.
   */
  private async deliver(
    survey: Survey,
    channels: SurveyContactChannel[],
    people: Person[],
    opts: { reminder: boolean },
  ): Promise<Counts> {
    const counts = zero();
    const base = this.appBase();
    const organisation = await this.organisationName();
    const tz = await this.timeZone();
    // The same branded email as invitations: office contact for other formats, logo, how long it takes.
    const branding = await surveyEmailBranding(this.prisma);
    const facts = await surveyEmailFacts(this.prisma, survey.id, tz);
    const emailExtras = {
      contactPhone: branding.contactPhone,
      contactEmail: branding.contactEmail,
      logoUrl: branding.logoUrl,
      brand: branding,
      minutes: facts.minutes,
      closesDate: facts.closesDate,
      daysLeft: facts.daysLeft,
    };
    const closesOn = survey.closesAt ? formatSurveyDateTime(survey.closesAt, tz) : null;
    const optOuts = await this.optOutsFor(people);
    const want = new Set(channels);
    const employeeIds = people.map((p) => p.employeeId).filter((x): x is string => Boolean(x));
    const serviceUserIds = people.map((p) => p.serviceUserId).filter((x): x is string => Boolean(x));
    const [staff, supported] = await Promise.all([
      employeeIds.length
        ? this.prisma.employeePersonalDetail.findMany({
            where: { employeeId: { in: employeeIds }, employee: { deletedAt: null } },
            select: { employeeId: true, firstName: true, email: true, mobileTelephone: true, employee: { select: { isActive: true } } },
          })
        : [],
      serviceUserIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: serviceUserIds }, deletedAt: null, dateOfDeath: null, NOT: { status: { is: { code: 'DECEASED' } } } },
            select: {
              id: true,
              firstName: true,
              preferredName: true,
              email: true,
              mobile: true,
              phone: true,
              isActive: true,
              portalAccount: { select: { email: true, isEnabled: true, deletedAt: true } },
              status: { select: { code: true } },
            },
          })
        : [],
    ]);
    const staffById = new Map(staff.map((s) => [s.employeeId, s]));
    const supportedById = new Map(supported.map((s) => [s.id, s]));
    const portalLink = base ? `${base}/portal/surveys` : null;
    // Outside people (named public surveys): their current details (removed ones are not reminded).
    const outsideIds = people.map((p) => p.externalContactId).filter((x): x is string => Boolean(x));
    const outside = outsideIds.length
      ? await this.outsideCurrentDetails({ id: { in: outsideIds }, deletedAt: null })
      : [];
    const outsideById = new Map(outside.map((x) => [x.id, x]));
    // Anonymous staff surveys: where each person answers signed in (carer app, My surveys on the web).
    const places = survey.isAnonymous && employeeIds.length ? await staffAnswerPlaces(this.prisma, employeeIds) : new Map<string, StaffAnswerPlaces>();
    const webLink = base ? `${base}/my-surveys` : null;
    // Staff who have left (leavers' surveys only reach them): never the carer app, only a personal email.
    const suDomains = (supported as Array<{ status?: { code: string } | null }>).some((x) => x.status?.code === 'DISCHARGED')
      ? organisationDomains(await Promise.resolve().then(() => this.prisma.companyProfile.findFirst({ select: { email: true, companyWebsite: true } })).catch(() => null))
      : [];
    const domains = (staff as Array<{ employee?: { isActive: boolean } | null }>).some((x) => x.employee?.isActive === false)
      ? organisationDomains(await Promise.resolve().then(() => this.prisma.companyProfile.findFirst({ select: { email: true, companyWebsite: true } })).catch(() => null))
      : [];

    for (const p of people) {
      const link = !survey.isAnonymous && base ? `${base}${personalLinkPath(p.token)}` : null;
      let reached = false;
      let blocked = 0;
      let possible = 0;
      const tryChannel = async (channel: SurveyContactChannel, available: boolean, send: () => Promise<boolean>) => {
        if (!want.has(channel) || !available) return;
        possible += 1;
        if (SurveyRemindersService.optedOut(optOuts, p, channel)) {
          blocked += 1;
          return;
        }
        if (await send().catch(() => false)) {
          reached = true;
          counts[channel === 'EMAIL' ? 'email' : channel === 'APP' ? 'app' : channel === 'PORTAL' ? 'portal' : 'text'] += 1;
        }
      };
      if (p.employeeId) {
        const s = staffById.get(p.employeeId);
        if (!s) {
          counts.noContact += 1;
          continue;
        }
        const m = surveyContactMessages({
          kind: 'EMPLOYEE', anonymous: survey.isAnonymous, reminder: opts.reminder, title: survey.title, firstName: s.firstName,
          link, portalLink: null, closesOn, organisation, ...emailExtras, textRepliesSupported: this.texts.supportsReplies(),
          staffPlaces: survey.isAnonymous
            ? s.employee?.isActive !== false
              ? { ...(places.get(p.employeeId) ?? { app: true, web: false }), webLink }
              : { app: false, web: false, webLink: null }
            : undefined,
        });
        const left = s.employee?.isActive === false;
        if (left && this.unsubscribe) {
          // Former staff: the unsubscribe link in the email (HTML and plain text, invitation and reminder alike) and the text.
          const stopAll = await this.unsubscribe.link(base, { subjectKind: 'EMPLOYEE', subjectId: p.employeeId });
          if (stopAll) {
            const withStop = surveyContactMessages({
              kind: 'EMPLOYEE', anonymous: survey.isAnonymous, reminder: opts.reminder, title: survey.title, firstName: s.firstName,
              link, portalLink: null, closesOn, organisation, ...emailExtras, textRepliesSupported: this.texts.supportsReplies(),
              staffPlaces: survey.isAnonymous ? { app: false, web: false, webLink: null } : undefined,
              unsubscribeLink: stopAll,
            });
            m.emailSubject = withStop.emailSubject;
            m.emailText = withStop.emailText;
            m.emailHtml = withStop.emailHtml;
            m.text = withStop.text;
          }
        }
        const email = left ? personalEmail(s.email, domains) : s.email;
        await tryChannel('APP', !left, async () => {
          const report = await this.push.sendToEmployees([p.employeeId!], {
            title: m.pushTitle,
            body: m.pushBody,
            // Anonymous surveys: no token in the notification either (the app opens its survey list).
            data: { type: 'SURVEY', surveyId: survey.id, ...(survey.isAnonymous ? {} : { token: p.token }), ...(link ? { url: link } : {}) },
          });
          return report.sent > 0;
        });
        await tryChannel('EMAIL', Boolean(email), () => this.mailTo(survey.id, email!, m.emailSubject, m.emailText, m.emailHtml));
        const mobile = firstUkMobile(s.mobileTelephone);
        await tryChannel('TEXT', Boolean(mobile) && this.texts.isEnabled(), async () => (await this.texts.send({ to: mobile!, body: m.text })).sent);
      } else if (p.serviceUserId) {
        const su = supportedById.get(p.serviceUserId);
        if (!su) {
          counts.noContact += 1;
          continue;
        }
        const firstName = su.preferredName?.trim() || su.firstName;
        // Care has ended (a former person chosen by name): never the portal; their own email, with an unsubscribe link.
        const formerSu = (su as { status?: { code: string } | null }).status?.code === 'DISCHARGED';
        const stopSu = formerSu ? ((await this.unsubscribe?.link(base, { subjectKind: 'SERVICE_USER', subjectId: su.id })) ?? null) : null;
        const m = surveyContactMessages({
          kind: 'SERVICE_USER', anonymous: survey.isAnonymous, reminder: opts.reminder, title: survey.title, firstName,
          link, portalLink, closesOn, organisation, ...emailExtras, textRepliesSupported: this.texts.supportsReplies(),
          unsubscribeLink: stopSu,
        });
        const portal = !formerSu && su.isActive && su.portalAccount?.isEnabled && !su.portalAccount.deletedAt ? su.portalAccount.email : null;
        const portalMessages = surveyContactMessages({
          kind: 'SERVICE_USER', anonymous: survey.isAnonymous, reminder: opts.reminder, title: survey.title, firstName,
          link: null, portalLink, closesOn, organisation, ...emailExtras, textRepliesSupported: this.texts.supportsReplies(),
        });
        await tryChannel('PORTAL', Boolean(portal), () => this.mailTo(survey.id, portal!, portalMessages.emailSubject, portalMessages.emailText, portalMessages.emailHtml));
        // Their own email: named surveys only (their own link); never a second copy to the portal address.
        if (formerSu) {
          // Care has ended: their own address (never one on the organisation's domains), never the portal. On an
          // anonymous survey no link: they are asked to answer on paper. Always the unsubscribe link.
          const own = personalEmail(su.email, suDomains);
          const fm = surveyContactMessages({
            kind: link ? 'SERVICE_USER' : 'EXTERNAL', anonymous: survey.isAnonymous, reminder: opts.reminder, title: survey.title, firstName,
            link, portalLink: null, closesOn, organisation, ...emailExtras, textRepliesSupported: this.texts.supportsReplies(),
            unsubscribeLink: stopSu,
          });
          await tryChannel('EMAIL', Boolean(own), () => this.mailTo(survey.id, own!, fm.emailSubject, fm.emailText, fm.emailHtml));
          const fmobile = firstUkMobile(su.mobile, su.phone);
          await tryChannel('TEXT', Boolean(fmobile) && this.texts.isEnabled(), async () => (await this.texts.send({ to: fmobile!, body: fm.text })).sent);
        } else {
          const ownEmail = su.email?.trim() && su.email.trim().toLowerCase() !== portal?.toLowerCase() ? su.email.trim() : null;
          await tryChannel('EMAIL', Boolean(ownEmail) && !survey.isAnonymous, () => this.mailTo(survey.id, ownEmail!, m.emailSubject, m.emailText, m.emailHtml));
          const mobile = firstUkMobile(su.mobile, su.phone);
          // Anonymous surveys: a text can only point to the portal, so only to people who have one.
          await tryChannel('TEXT', Boolean(mobile) && this.texts.isEnabled() && (!survey.isAnonymous || Boolean(portal)), async () =>
            (await this.texts.send({ to: mobile!, body: m.text })).sent,
          );
        }
      } else if (p.externalContactId) {
        const x = outsideById.get(p.externalContactId);
        if (!x) {
          counts.noContact += 1;
          continue;
        }
        const m = surveyContactMessages({
          kind: 'EXTERNAL', anonymous: false, reminder: opts.reminder, title: survey.title, firstName: x.name.split(/\s+/)[0] ?? null,
          link, portalLink: null, closesOn, organisation, ...emailExtras, textRepliesSupported: this.texts.supportsReplies(),
        });
        await tryChannel('EMAIL', Boolean(x.email), () => this.mailTo(survey.id, x.email!, m.emailSubject, m.emailText, m.emailHtml));
        const mobile = firstUkMobile(x.mobile, x.phone);
        await tryChannel('TEXT', Boolean(mobile) && this.texts.isEnabled(), async () => (await this.texts.send({ to: mobile!, body: m.text })).sent);
      }
      if (reached) counts.people += 1;
      else if (possible > 0 && blocked === possible) counts.optedOut += 1;
      else counts.noContact += 1;
    }
    return counts;
  }

  private async mailTo(surveyId: string, to: string, subject: string, text: string, html?: string): Promise<boolean> {
    try {
      // Personal survey links and unsubscribe tokens: never copied to MAIL_BCC.
      await this.mail.send({ to, subject, text, html, skipBcc: true });
      return true;
    } catch (err) {
      this.logger.warn(`Survey ${surveyId}: a reminder email was not sent (${err instanceof Error ? err.name : 'error'})`);
      return false;
    }
  }

  /**
   * Invitations by text message when the survey's plan includes texts (email and app invitations
   * are sent by SurveysService). Counts audited; never fails the send.
   */
  async sendInvitationTexts(surveyId: string, people: Array<{ token: string; employeeId: string | null; serviceUserId: string | null }>): Promise<void> {
    if (!people.length || !this.texts.isEnabled()) return;
    const survey = await this.prisma.survey.findUnique({ where: { id: surveyId } });
    if (!survey) return;
    const plan = readContactPlan((await this.planOwner(survey)).contactPlan);
    if (!plan?.channels.includes('TEXT')) return;
    if (isQuietTime(new Date(), plan, await this.timeZone())) {
      // Quiet hours (or a weekend on a weekdays-only plan): the text waits; the survey job sends it later.
      await this.prisma.surveyRecipient.updateMany({
        where: { surveyId: survey.id, token: { in: people.map((p) => p.token) }, status: { in: NOT_ANSWERED } },
        data: { invitationTextPending: true },
      });
      return;
    }
    const rows = await this.prisma.surveyRecipient.findMany({
      where: { surveyId: survey.id, token: { in: people.map((p) => p.token) }, status: { in: NOT_ANSWERED } },
      select: { id: true, token: true, employeeId: true, serviceUserId: true, externalContactId: true },
    });
    const withIds = await this.keepEligible(survey, rows);
    if (!withIds.length) return;
    const counts = await this.deliver(survey, ['TEXT'], withIds, { reminder: false });
    await this.audit.logAudit({
      userId: undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_INVITATION_TEXTS_SENT,
      recordType: 'Survey',
      recordId: survey.id,
      description: `Survey invitations sent by text for survey "${survey.title}"`,
      newValues: { text: counts.text, noContact: counts.noContact, optedOut: counts.optedOut },
      metadata: { surveyId: survey.id },
    });
  }

  // ─── The survey job ───────────────────────────────────────────────────────

  /**
   * Invitation texts held back by quiet hours: sent once quiet hours end, to people who still have not
   * answered, while the survey is open. Each person is taken once (the flag is cleared first).
   */
  async sendPendingInvitationTexts(now: Date = new Date()): Promise<number> {
    if (!this.texts.isEnabled()) return 0;
    const tz = await this.timeZone();
    const rows = await this.prisma.surveyRecipient.findMany({
      where: { invitationTextPending: true },
      select: { id: true, surveyId: true },
      take: 1000,
    });
    const bySurvey = new Map<string, string[]>();
    for (const r of rows) bySurvey.set(r.surveyId, [...(bySurvey.get(r.surveyId) ?? []), r.id]);
    let sent = 0;
    for (const [surveyId, ids] of bySurvey) {
      const survey = await this.prisma.survey.findUnique({ where: { id: surveyId } });
      const open = survey && !survey.deletedAt && survey.status === SurveyStatus.ACTIVE && (!survey.closesAt || survey.closesAt > now);
      const plan = survey ? readContactPlan((await this.planOwner(survey)).contactPlan) : null;
      if (!survey || !open || !plan?.channels.includes('TEXT')) {
        await this.prisma.surveyRecipient.updateMany({ where: { id: { in: ids } }, data: { invitationTextPending: false } });
        continue;
      }
      if (isQuietTime(now, plan, tz)) continue;
      const taken = await this.prisma.$queryRaw<Array<{ id: string; token: string; employeeId: string | null; serviceUserId: string | null }>>`
        UPDATE "surveys"."SurveyRecipient" SET "invitationTextPending" = false
         WHERE "id" = ANY(${ids}::uuid[]) AND "invitationTextPending" AND "status"::text <> 'COMPLETED'
         RETURNING "id", "token", "employeeId", "serviceUserId"`;
      await this.prisma.surveyRecipient.updateMany({ where: { id: { in: ids } }, data: { invitationTextPending: false } });
      const eligible = await this.keepEligible(survey, taken);
      if (!eligible.length) continue;
      const counts = await this.deliver(survey, ['TEXT'], eligible, { reminder: false });
      sent += counts.text;
      await this.audit.logAudit({
        userId: undefined,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_INVITATION_TEXTS_SENT,
        recordType: 'Survey',
        recordId: survey.id,
        description: `Survey invitations sent by text after quiet hours for survey "${survey.title}"`,
        newValues: { text: counts.text, noContact: counts.noContact, optedOut: counts.optedOut, afterQuietHours: true },
        metadata: { surveyId: survey.id },
      });
    }
    return sent;
  }

  /** Every minute: due reminders (outside quiet hours), call list tasks, and finished call lists closed. */
  async runDue(now: Date = new Date()): Promise<{ reminded: number; runs: number; callTasks: number; callTasksClosed: number }> {
    await this.sendPendingInvitationTexts(now).catch((e: unknown) =>
      this.logger.warn(`Waiting survey invitation texts not sent (${e instanceof Error ? e.name : 'error'})`),
    );
    const tz = await this.timeZone();
    const surveys = await this.prisma.survey.findMany({
      where: {
        status: SurveyStatus.ACTIVE,
        deletedAt: null,
        isTemplate: false,
        isCatalogue: false,
        // Public surveys: only named ones have people (outside people sent their own link).
        NOT: { targetKind: SurveyTargetKind.PUBLIC, isAnonymous: true },
        OR: [{ closesAt: null }, { closesAt: { gt: now } }],
        AND: [{ OR: [{ contactPlan: { not: Prisma.DbNull } }, { clonedFrom: { contactPlan: { not: Prisma.DbNull } } }] }],
      },
      include: { clonedFrom: { select: { contactPlan: true } } },
      take: 500,
    });
    let reminded = 0;
    let runs = 0;
    let callTasks = 0;
    for (const s of surveys) {
      const plan = readContactPlan(s.clonedFromId ? s.clonedFrom?.contactPlan : s.contactPlan);
      if (!plan) continue;
      try {
        if (plan.reminders.length && plan.channels.length && !isQuietTime(now, plan, tz)) {
          const candidates = await this.prisma.surveyRecipient.findMany({
            where: { surveyId: s.id, status: { in: NOT_ANSWERED }, sentAt: { not: null }, reminderCount: { lt: Math.min(plan.reminders.length, MAX_SURVEY_REMINDERS) } },
            select: { id: true, token: true, employeeId: true, serviceUserId: true, externalContactId: true, sentAt: true, reminderCount: true, remindedAt: true },
          });
          const byStep = new Map<number, typeof candidates>();
          for (const c of candidates) {
            const step = dueReminderStep(c, plan, now, s.isAnonymous);
            if (step) byStep.set(step, [...(byStep.get(step) ?? []), c]);
          }
          for (const [step, people] of byStep) {
            const counts = await this.remind(s, plan, people, { step, manual: false, actorId: null, now, tz });
            reminded += counts.people;
            runs += 1;
          }
        }
        if (plan.call && !s.isAnonymous && (await this.ensureCallTask(s, plan, now, tz))) callTasks += 1;
      } catch (e) {
        this.logger.warn(`Survey ${s.id}: reminders not sent this time (${e instanceof Error ? e.name : 'error'})`);
      }
    }
    const callTasksClosed = await this.closeFinishedCallTasks(now).catch(() => 0);
    return { reminded, runs, callTasks, callTasksClosed };
  }

  // ─── Phone follow-up (named surveys) ──────────────────────────────────────

  private async resolveCallRole(call: SurveyContactPlan['call']): Promise<{ id: string; name: string } | null> {
    if (!call) return null;
    const roles = await this.prisma.role.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
    if (call.roleId) return roles.find((r) => r.id === call.roleId) ?? null;
    const key = call.ownerKey ?? 'CARE_COORDINATOR';
    const setting = await this.prisma.surveyAlertOwnerRole.findUnique({ where: { ownerKey: key } }).catch(() => null);
    return (setting ? roles.find((r) => r.id === setting.roleId) : undefined) ?? roleForOwner(key, roles) ?? roleForOwner('REGISTERED_MANAGER', roles);
  }

  /** People on the call list now: not answered, due, not taken off by a final call outcome or a phone opt-out. */
  private async callListPeople(surveyId: string, plan: SurveyContactPlan, now: Date) {
    const found = await this.prisma.surveyRecipient.findMany({
      where: { surveyId, status: { in: NOT_ANSWERED }, sentAt: { not: null } },
      select: {
        id: true,
        employeeId: true,
        serviceUserId: true,
        externalContactId: true,
        sentAt: true,
        status: true,
        reminderCount: true,
        remindedAt: true,
        callAttempts: { orderBy: { createdAt: 'desc' }, select: { id: true, outcome: true, notes: true, calledById: true, createdAt: true } },
      },
    });
    // Nobody who can no longer be sent the survey is on the call list (checked now, every time).
    const survey = found.length ? await this.prisma.survey.findUnique({ where: { id: surveyId } }) : null;
    const rows = survey ? await this.keepEligible(survey, found) : found;
    const optOuts = await this.optOutsFor(rows);
    return rows.map((r) => {
      const optedOut = SurveyRemindersService.optedOut(optOuts, r, 'PHONE');
      const closedBy = r.callAttempts.find((a) => FINAL_CALL_OUTCOMES.includes(a.outcome)) ?? null;
      return { ...r, optedOut, closedBy, due: callDue(r.sentAt, plan, now), open: !optedOut && !closedBy };
    });
  }

  /** One task per survey or period for the call role, once anyone is due a call. True when created. */
  private async ensureCallTask(survey: Survey, plan: SurveyContactPlan, now: Date, tz: string): Promise<boolean> {
    const existing = await this.prisma.roleTask.findFirst({ where: { sourceType: SURVEY_CALL_LIST_TASK_SOURCE, sourceId: survey.id }, select: { id: true } });
    if (existing) return false;
    const people = (await this.callListPeople(survey.id, plan, now)).filter((p) => p.open && p.due);
    if (!people.length) return false;
    const role = await this.resolveCallRole(plan.call);
    if (!role) {
      this.logger.warn(`Survey ${survey.id}: call list not given to anyone (no role found)`);
      return false;
    }
    const audience = await surveyResultsAudience(this.prisma, survey);
    const generic = audience.restricted;
    const today = dayKeyInTimeZone(now, tz);
    const due = addDaysToOperationalIso(today, plan.call!.withinDays);
    const id = randomUUID();
    // Never names on the task (role tasks are listed to everyone who manages tasks): the count only.
    await this.prisma.roleTask.create({
      data: {
        id,
        templateId: null,
        sourceType: SURVEY_CALL_LIST_TASK_SOURCE,
        sourceId: survey.id,
        roleId: role.id,
        locationId: survey.locationIds.length === 1 ? survey.locationIds[0] : null,
        title: generic ? 'Phone people who have not answered a survey' : `Phone people who have not answered "${survey.title}"`.slice(0, 200),
        description: `${people.length} ${people.length === 1 ? 'person has' : 'people have'} not answered yet. Open the call list, phone them, and record each call or their answers.`,
        link: `/surveys/${survey.id}/calls`,
        dueDate: new Date(`${due}T00:00:00.000Z`),
      },
    });
    await this.audit.logAudit({
      userId: undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_UPDATED,
      recordType: 'Survey',
      recordId: survey.id,
      description: `Call list started for survey "${survey.title}" and given to ${role.name}`,
      newValues: { callListTaskId: id, people: people.length },
      metadata: { surveyId: survey.id },
    });
    try {
      const holders = await this.prisma.userRole.findMany({ where: { roleId: role.id, user: { deletedAt: null, isActive: true } }, select: { userId: true } });
      // Only those who will see the task: the same branch rule as the task list (survey-office-recipients).
      const recipients = await usersInSurveyBranches(this.prisma, survey, [...new Set(holders.map((h) => h.userId))]);
      if (recipients.length) {
        await this.notifications.notifyUsers({
          recipientUserIds: recipients,
          type: NotificationType.SYSTEM_MESSAGE,
          module: NotificationModule.SYSTEM,
          severity: NotificationSeverity.INFO,
          title: 'Survey calls to make',
          message: `${people.length} ${people.length === 1 ? 'person has' : 'people have'} not answered ${generic ? 'a survey' : `"${survey.title}"`}. Please phone them by ${due}.`,
          recordType: 'Survey',
          recordId: survey.id,
          metadata: { href: `/surveys/${survey.id}/calls`, surveyId: survey.id, eventType: 'SURVEY_CALL_LIST' },
        });
      }
    } catch (e) {
      this.logger.warn(`Survey ${survey.id}: call list notice not sent (${e instanceof Error ? e.name : 'error'})`);
    }
    return true;
  }

  /** Open call list tasks whose survey has closed, or with nobody left to call, are done. */
  private async closeFinishedCallTasks(now: Date): Promise<number> {
    const tasks = await this.prisma.roleTask.findMany({
      where: { sourceType: SURVEY_CALL_LIST_TASK_SOURCE, status: { in: OPEN_TASK } },
      select: { id: true, sourceId: true },
      take: 500,
    });
    let closed = 0;
    for (const t of tasks) {
      if (!t.sourceId) continue;
      const survey = await this.prisma.survey.findUnique({ where: { id: t.sourceId }, include: { clonedFrom: { select: { contactPlan: true } } } });
      const ended = !survey || survey.deletedAt || survey.status !== SurveyStatus.ACTIVE || (survey.closesAt && survey.closesAt <= now);
      const plan = survey ? readContactPlan(survey.clonedFromId ? survey.clonedFrom?.contactPlan : survey.contactPlan) : null;
      const left = !ended && plan ? (await this.callListPeople(survey!.id, plan, now)).filter((p) => p.open).length : 0;
      if (!ended && left > 0) continue;
      await this.prisma.roleTask.update({
        where: { id: t.id },
        data: {
          status: RoleTaskStatus.DONE,
          completedAt: now,
          note: ended ? 'The survey has closed.' : 'Everyone on the call list has answered or been called.',
        },
      });
      closed += 1;
    }
    return closed;
  }

  /** Call list access: per-survey responses access, or holding the call role; always within branch scope. */
  private async requireCallList(actor: RequestUser, surveyId: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    if (survey.isAnonymous) {
      throw new BadRequestException('Anonymous surveys have no call list: a list of people who have not answered would show who has.');
    }
    if (survey.targetKind === SurveyTargetKind.PUBLIC && survey.isAnonymous) throw new BadRequestException('Public surveys have no list of people.');
    const owner = await this.planOwner(survey);
    const plan = readContactPlan(owner.contactPlan);
    const access = await surveyAccessFor(this.prisma, actor, survey);
    if (!access.responses) {
      const role = plan?.call ? await this.resolveCallRole(plan.call) : null;
      const mine = role ? await this.prisma.userRole.count({ where: { userId: actor.id, roleId: role.id } }) : 0;
      if (!mine) throw new ForbiddenException('Only people who can see this survey’s individual responses, or who make its calls, can see its call list.');
    }
    return { survey, plan };
  }

  async callList(actor: RequestUser, surveyId: string) {
    const { survey, plan } = await this.requireCallList(actor, surveyId);
    const now = new Date();
    const effective = plan ?? { ...this.defaultPlan(survey.targetKind), call: null };
    const people = await this.callListPeople(survey.id, effective, now);
    const rows = await this.describeCallPeople(people);
    const task = await this.prisma.roleTask.findFirst({
      where: { sourceType: SURVEY_CALL_LIST_TASK_SOURCE, sourceId: survey.id },
      select: { id: true, status: true, dueDate: true, role: { select: { name: true } } },
    });
    return {
      message: 'Call list',
      data: {
        survey: { id: survey.id, title: survey.title, targetKind: survey.targetKind, status: survey.status, closesAt: survey.closesAt?.toISOString() ?? null },
        callStep: plan?.call ?? null,
        task: task ? { id: task.id, status: task.status, dueDate: task.dueDate.toISOString().slice(0, 10), roleName: task.role.name } : null,
        outcomes: SURVEY_CALL_OUTCOMES,
        people: rows,
      },
    };
  }

  /**
   * Surveys still to collect (Phase 3 follow-up): every open named survey the user may run a call list for, with the
   * people who have not answered and can still be asked. Optionally for one person (their record's "Surveys due").
   * Staff record the answers with Record response; anonymous surveys never appear (a list would show who answered).
   */
  async toCollect(actor: RequestUser, filter: { serviceUserId?: string; employeeId?: string } = {}) {
    const now = new Date();
    const scope = this.orgScope.fromRequestUser(actor);
    const person = {
      ...(filter.serviceUserId ? { serviceUserId: filter.serviceUserId } : {}),
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
    };
    const surveys = await this.prisma.survey.findMany({
      where: {
        deletedAt: null,
        isCatalogue: false,
        isTemplate: false,
        isAnonymous: false,
        status: SurveyStatus.ACTIVE,
        targetKind: { in: [SurveyTargetKind.SERVICE_USER, SurveyTargetKind.EMPLOYEE] },
        OR: [{ closesAt: null }, { closesAt: { gt: now } }],
        recipients: { some: { status: { in: NOT_ANSWERED }, sentAt: { not: null }, ...person } },
      },
      orderBy: [{ closesAt: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }],
      take: 100,
    });
    const out: Array<{
      survey: { id: string; title: string; targetKind: SurveyTargetKind; closesAt: string | null; libraryReference: string | null };
      people: Awaited<ReturnType<SurveyRemindersService['describeCallPeople']>>;
    }> = [];
    for (const survey of surveys) {
      if (!surveyVisibleInScope(scope, survey)) continue;
      let plan: SurveyContactPlan | null;
      try {
        ({ plan } = await this.requireCallList(actor, survey.id));
      } catch {
        continue; // no access to this survey's people: it is simply not listed
      }
      const effective = plan ?? { ...this.defaultPlan(survey.targetKind), call: null };
      const people = (await this.callListPeople(survey.id, effective, now)).filter(
        (p) => (!filter.serviceUserId || p.serviceUserId === filter.serviceUserId) && (!filter.employeeId || p.employeeId === filter.employeeId),
      );
      // Someone who asked not to be phoned, or whose number is wrong, can still be asked on a visit: only people
      // who said they do not want to take part (or who have died) are left out.
      const rows = (await this.describeCallPeople(people)).filter((r) => !r.declined && !r.died);
      if (!rows.length) continue;
      out.push({
        survey: {
          id: survey.id,
          title: survey.title,
          targetKind: survey.targetKind,
          closesAt: survey.closesAt?.toISOString() ?? null,
          libraryReference: survey.libraryReference ?? null,
        },
        people: rows,
      });
    }
    return { message: 'Surveys to collect', data: out };
  }

  /**
   * One person's surveys, for their record (service user or employee): coming up (waiting after an event, with the
   * day it is due), sent and not answered, and answered (when, how and by whom). Only surveys the user may see
   * (branch scope and the survey's own access); whether someone answered an anonymous survey is never shown, and
   * the link to their answers only to those who may see that survey's individual responses.
   */
  async personHistory(actor: RequestUser, filter: { serviceUserId?: string; employeeId?: string }) {
    if (Boolean(filter.serviceUserId) === Boolean(filter.employeeId)) throw new BadRequestException('Choose one person.');
    const person = filter.serviceUserId ? { serviceUserId: filter.serviceUserId } : { employeeId: filter.employeeId };
    const scope = this.orgScope.fromRequestUser(actor);
    const now = new Date();
    const tz = await this.timeZone();
    const [recipients, occurrences] = await Promise.all([
      this.prisma.surveyRecipient.findMany({
        where: { ...person, survey: { deletedAt: null, isCatalogue: false, isTemplate: false } },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          surveyId: true,
          status: true,
          sentAt: true,
          createdAt: true,
          reminderCount: true,
          remindedAt: true,
          response: { select: { id: true, submittedAt: true, channel: true, respondentRelation: true, respondentName: true, recordedById: true } },
        },
      }),
      this.prisma.surveyEventOccurrence.findMany({
        where: { ...person, status: { in: OPEN_OCCURRENCE_STATUSES } },
        orderBy: { dueOn: 'asc' },
        take: 100,
        select: { id: true, surveyId: true, event: true, eventOn: true, dueOn: true, status: true },
      }),
    ]);
    const surveyIds = [...new Set([...recipients.map((r) => r.surveyId), ...occurrences.map((o) => o.surveyId)])];
    const surveys = surveyIds.length ? await this.prisma.survey.findMany({ where: { id: { in: surveyIds }, deletedAt: null } }) : [];
    const visible = new Map<string, { survey: Survey; responses: boolean; results: boolean }>();
    for (const survey of surveys) {
      if (!surveyVisibleInScope(scope, survey)) continue;
      const access = await surveyAccessFor(this.prisma, actor, survey);
      if (access.results || access.responses) visible.set(survey.id, { survey, responses: access.responses, results: access.results });
    }
    // Not answered yet on an open survey: numbers, reminders and calls, as on the to-collect list (same access rules).
    const open = await this.toCollect(actor, filter).catch(() => ({ data: [] as Awaited<ReturnType<SurveyRemindersService['toCollect']>>['data'] }));
    const toCollectBySurvey = new Map(open.data.map((i) => [i.survey.id, i.people[0] ?? null]));
    const recorderIds = [...new Set(recipients.map((r) => r.response?.recordedById).filter((x): x is string => Boolean(x)))];
    const recorders = recorderIds.length ? await this.prisma.user.findMany({ where: { id: { in: recorderIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [];
    const recorderName = new Map(recorders.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]));
    const canRecord = actor.permissions.includes('surveys.responses.record');
    const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

    const comingUp = occurrences
      .filter((o) => visible.get(o.surveyId)?.results)
      .map((o) => ({
        id: o.id,
        surveyId: o.surveyId,
        title: visible.get(o.surveyId)!.survey.title,
        event: o.event,
        eventLabel: SURVEY_TRIGGER_EVENT_INFO[o.event as keyof typeof SURVEY_TRIGGER_EVENT_INFO]?.label ?? o.event,
        eventOn: dayKeyInTimeZone(o.eventOn, tz),
        dueOn: dayKeyInTimeZone(o.dueOn, tz),
        status: o.status,
      }));
    const notAnswered: Array<Record<string, unknown>> = [];
    const answered: Array<Record<string, unknown>> = [];
    const anonymous: Array<Record<string, unknown>> = [];
    for (const r of recipients) {
      const v = visible.get(r.surveyId);
      if (!v) continue;
      const s = v.survey;
      const base = { recipientId: r.id, surveyId: s.id, title: s.title, sentAt: iso(r.sentAt ?? r.createdAt), closesAt: iso(s.closesAt), surveyStatus: s.status };
      if (s.isAnonymous) {
        // Anonymous: only that it was sent, never whether they answered (the day only, as elsewhere).
        anonymous.push({ ...base, sentAt: dayKeyInTimeZone(r.sentAt ?? r.createdAt, tz) });
        continue;
      }
      if (r.status === SurveyRecipientStatus.COMPLETED) {
        answered.push({
          ...base,
          answeredAt: iso(r.response?.submittedAt),
          channel: r.response?.channel ?? null,
          respondentRelation: r.response?.respondentRelation ?? null,
          respondentName: r.response?.respondentName ?? null,
          recordedBy: r.response?.recordedById ? (recorderName.get(r.response.recordedById) ?? 'Someone') : null,
          canViewAnswers: v.responses && Boolean(r.response),
        });
        continue;
      }
      const isOpen = s.status === SurveyStatus.ACTIVE && (!s.closesAt || s.closesAt > now) && r.status !== SurveyRecipientStatus.LAPSED;
      notAnswered.push({
        ...base,
        recipientStatus: r.status,
        open: isOpen,
        reminders: r.reminderCount,
        lastReminderAt: iso(r.remindedAt),
        person: isOpen ? (toCollectBySurvey.get(s.id) ?? null) : null,
        canRecord: canRecord && isOpen,
      });
    }
    // Open ones first (still to do), then the rest newest first.
    notAnswered.sort((a, b) => Number(b.open) - Number(a.open));
    return { message: 'Surveys for this person', data: { comingUp, notAnswered, answered, anonymous } };
  }

  /** Call list rows: names, numbers on their record, reminders and earlier calls, phone-due people first. */
  private async describeCallPeople(people: Awaited<ReturnType<SurveyRemindersService['callListPeople']>>) {
    const employeeIds = people.map((p) => p.employeeId).filter((x): x is string => Boolean(x));
    const serviceUserIds = people.map((p) => p.serviceUserId).filter((x): x is string => Boolean(x));
    const [staff, supported] = await Promise.all([
      employeeIds.length
        ? this.prisma.employeePersonalDetail.findMany({
            where: { employeeId: { in: employeeIds } },
            select: { employeeId: true, firstName: true, lastName: true, mobileTelephone: true, homeTelephone: true },
          })
        : [],
      serviceUserIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: serviceUserIds } },
            select: { id: true, firstName: true, lastName: true, mobile: true, phone: true, dateOfDeath: true },
          })
        : [],
    ]);
    const staffById = new Map(staff.map((s) => [s.employeeId, s]));
    const suById = new Map(supported.map((s) => [s.id, s]));
    const extIds = people.map((p) => (p as { externalContactId?: string | null }).externalContactId).filter((x): x is string => Boolean(x));
    const outside = extIds.length
      ? await this.outsideCurrentDetails({ id: { in: extIds } })
      : [];
    const extById = new Map(outside.map((x) => [x.id, x]));
    const userIds = [...new Set(people.flatMap((p) => p.callAttempts.map((a) => a.calledById)).filter((x): x is string => Boolean(x)))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [];
    const userName = new Map(users.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]));
    return people
      .map((p) => {
        const s = p.employeeId ? staffById.get(p.employeeId) : undefined;
        const su = p.serviceUserId ? suById.get(p.serviceUserId) : undefined;
        const x = (p as { externalContactId?: string | null }).externalContactId ? extById.get((p as { externalContactId: string }).externalContactId) : undefined;
        const name = s
          ? `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || 'Employee'
          : su
            ? `${su.firstName} ${su.lastName ?? ''}`.trim()
            : x
              ? `${x.name}${x.organisation ? ` (${x.organisation})` : ''}`
              : 'Person';
        const phones = [
          ...(s ? [{ label: 'Mobile', number: s.mobileTelephone }, { label: 'Home', number: s.homeTelephone }] : []),
          ...(su ? [{ label: 'Mobile', number: su.mobile }, { label: 'Phone', number: su.phone }] : []),
          ...(x ? [{ label: 'Mobile', number: x.mobile }, { label: 'Phone', number: x.phone }] : []),
        ].filter((x): x is { label: string; number: string } => Boolean(x.number?.trim()));
        return {
          recipientId: p.id,
          employeeId: p.employeeId,
          serviceUserId: p.serviceUserId,
          name,
          phones,
          died: Boolean(su?.dateOfDeath),
          sentAt: p.sentAt?.toISOString() ?? null,
          reminders: p.reminderCount,
          lastReminderAt: p.remindedAt?.toISOString() ?? null,
          due: p.due,
          optedOut: p.optedOut,
          /** Said on a call that they do not want to take part (a wrong number does not stop asking on a visit). */
          declined: p.closedBy?.outcome === 'DECLINED',
          open: p.open && !su?.dateOfDeath,
          calls: p.callAttempts.map((a) => ({
            id: a.id,
            outcome: a.outcome,
            notes: a.notes,
            at: a.createdAt.toISOString(),
            by: a.calledById ? (userName.get(a.calledById) ?? 'Someone') : null,
          })),
        };
      })
      .sort((a, b) => Number(b.open && b.due) - Number(a.open && a.due) || a.name.localeCompare(b.name));
  }

  async recordCall(actor: RequestUser, surveyId: string, recipientId: string, dto: { outcome: string; notes?: string | null }, meta?: RequestAuditMeta) {
    const { survey } = await this.requireCallList(actor, surveyId);
    if (!(SURVEY_CALL_OUTCOMES as readonly string[]).includes(dto.outcome)) throw new BadRequestException('Choose what happened on the call.');
    const notes = dto.notes?.trim() || null;
    if (notes && notes.length > 1000) throw new BadRequestException('Keep call notes under 1,000 characters.');
    const recipient = await this.prisma.surveyRecipient.findFirst({ where: { id: recipientId, surveyId: survey.id }, select: { id: true, status: true } });
    if (!recipient) throw new NotFoundException('Person not found on this survey');
    if (recipient.status === SurveyRecipientStatus.COMPLETED) throw new BadRequestException('They have already answered.');
    const call = await this.prisma.surveyCallAttempt.create({
      data: { surveyId: survey.id, recipientId: recipient.id, outcome: dto.outcome, notes, calledById: actor.id },
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_CALL_RECORDED,
      recordType: 'SurveyRecipient',
      recordId: recipient.id,
      description: `Call recorded for survey "${survey.title}"`,
      // Never the notes (they can hold personal details) or a number.
      newValues: { surveyId: survey.id, outcome: dto.outcome, withNotes: Boolean(notes) },
      metadata: { surveyId: survey.id },
      ...meta,
    });
    return { message: 'Call recorded', data: { id: call.id } };
  }

  // ─── Opt-outs ─────────────────────────────────────────────────────────────

  private async requireSubjectInScope(actor: RequestUser, subjectKind: string, subjectId: string) {
    const scope = this.orgScope.fromRequestUser(actor);
    if (subjectKind === 'EMPLOYEE') {
      const e = await this.prisma.employee.findFirst({ where: { id: subjectId, deletedAt: null }, select: { employment: { select: { locationId: true } } } });
      if (!e) throw new NotFoundException('Employee not found');
      if (scope.locationIds && !(e.employment?.locationId && scope.locationIds.includes(e.employment.locationId))) throw new NotFoundException('Employee not found');
      return;
    }
    if (subjectKind === 'SERVICE_USER') {
      const su = await this.prisma.serviceUser.findFirst({ where: { id: subjectId, deletedAt: null }, select: { locationId: true } });
      if (!su || (scope.locationIds && !(su.locationId && scope.locationIds.includes(su.locationId)))) throw new NotFoundException('Person not found');
      return;
    }
    if (subjectKind === 'CANDIDATE') {
      // Whoever can see the candidate in Recruitment (a hiring manager only their own vacancies').
      const where = await candidateScopeWhere(this.prisma, await resolveRecruitmentScope(this.prisma, actor));
      const c = await this.prisma.candidate.findFirst({ where: { id: subjectId, deletedAt: null, ...where }, select: { id: true } });
      if (!c) throw new NotFoundException('Candidate not found');
      return;
    }
    throw new BadRequestException('Outside contacts are managed from their contact list.');
  }

  async getOptOuts(actor: RequestUser, subjectKind: string, subjectId: string) {
    await this.requireSubjectInScope(actor, subjectKind, subjectId);
    const rows = await this.prisma.surveyContactOptOut.findMany({ where: { subjectKind, subjectId }, orderBy: { createdAt: 'asc' } });
    // A STOP reply is shown apart from what staff recorded (a START reply lifts only that one).
    const stop = rows.find((r) => r.channel === 'TEXT' && r.reason === SURVEY_TEXT_STOP_REASON) ?? null;
    const staff = rows.filter((r) => r !== stop);
    return {
      message: 'Survey contact preferences',
      data: {
        channels: rows.map((r) => r.channel),
        reason: staff.find((r) => r.reason)?.reason ?? null,
        since: (staff[0] ?? stop)?.createdAt.toISOString() ?? null,
        stoppedByText: stop ? { since: stop.createdAt.toISOString() } : null,
        /** They unsubscribed from all surveys themselves (permanent; staff cannot change it). */
        unsubscribed: rows.some((r) => r.channel === 'ALL' && r.reason === SURVEY_UNSUBSCRIBE_REASON),
      },
    };
  }

  /** Replace a person's survey opt-outs (empty = they may be contacted). Audited without contact details. */
  async setOptOuts(actor: RequestUser, dto: { subjectKind: string; subjectId: string; channels: string[]; reason?: string | null }, meta?: RequestAuditMeta) {
    await this.requireSubjectInScope(actor, dto.subjectKind, dto.subjectId);
    const channels = [...new Set(dto.channels)];
    if (channels.some((c) => !(SURVEY_OPT_OUT_CHANNELS as readonly string[]).includes(c))) throw new BadRequestException('Choose how they do not want to be contacted.');
    const finalChannels = channels.includes('ALL') ? ['ALL'] : channels;
    const reason = dto.reason?.trim().slice(0, 300) || null;
    const before = await this.prisma.surveyContactOptOut.findMany({ where: { subjectKind: dto.subjectKind, subjectId: dto.subjectId }, select: { channel: true, reason: true } });
    // They unsubscribed from all surveys themselves: permanent, never lifted or changed by staff.
    if (before.some((b) => b.channel === 'ALL' && b.reason === SURVEY_UNSUBSCRIBE_REASON)) {
      throw new BadRequestException('They unsubscribed from all surveys themselves, so they are never sent surveys. This cannot be changed by staff.');
    }
    // A text opt-out made by a STOP reply keeps its origin (so a START reply can still lift it).
    const stopMade = new Set(before.filter((b) => b.reason === SURVEY_TEXT_STOP_REASON).map((b) => b.channel));
    await this.prisma.$transaction([
      this.prisma.surveyContactOptOut.deleteMany({ where: { subjectKind: dto.subjectKind, subjectId: dto.subjectId, channel: { notIn: finalChannels } } }),
      ...finalChannels.map((channel) =>
        this.prisma.surveyContactOptOut.upsert({
          where: { subjectKind_subjectId_channel: { subjectKind: dto.subjectKind, subjectId: dto.subjectId, channel } },
          create: { subjectKind: dto.subjectKind, subjectId: dto.subjectId, channel, reason, recordedById: actor.id },
          update: stopMade.has(channel) ? {} : { reason },
        }),
      ),
    ]);
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_CONTACT_OPT_OUT_CHANGED,
      recordType: dto.subjectKind === 'EMPLOYEE' ? 'Employee' : dto.subjectKind === 'CANDIDATE' ? 'Candidate' : 'ServiceUser',
      recordId: dto.subjectId,
      description: finalChannels.length ? 'Survey contact preferences changed: some or all survey messages stopped' : 'Survey contact preferences changed: survey messages allowed again',
      oldValues: { channels: before.map((b) => b.channel) },
      newValues: { channels: finalChannels },
      ...meta,
    });
    return this.getOptOuts(actor, dto.subjectKind, dto.subjectId);
  }
}
