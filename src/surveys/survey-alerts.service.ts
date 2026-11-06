import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
  RoleTaskStatus,
  type Survey,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { IDENTITY_ROLE } from '../common/org-scope/org-scope.types';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  operationalTodayIso,
  startOfOperationalDayUtc,
} from '../common/utils/operational-day.util';
import { surveyVisibleInScope } from './survey-scope.util';
import { withLookupOptions } from './survey-lookup-options';
import { ACCESS_SELECT, MIN_REPORTING_THRESHOLD_UNLINKED, surveyAccessFor, surveyResultsAudience, surveyThreshold } from './survey-access';
import {
  SURVEY_ALERT_OWNERS,
  SURVEY_ALERT_OWNER_KEYS,
  SURVEY_ALERT_TASK_SOURCE,
  alertAnswerChoices,
  ruleDueDate,
  answerLabelsByKey,
  conditionProblems,
  isContactRuleShape,
  libraryAlerts,
  libraryMinimumAnswers,
  libraryRuleRows,
  conditionMode,
  flatConditions,
  isGroup,
  matchConditions,
  matchedAnswerText,
  orList,
  readConditions,
  roleForOwner,
  type AlertConditionEntry,
  type AlertQuestion,
  type StoredAlertCondition,
  type SurveyAlertOwnerKey,
} from './survey-alert-rules.util';
import { isContactRequestQuestion, questionsNotAskedWhenUnlinked } from './survey-respondent-anonymity.util';
import { effectiveLibraryMeta } from './survey-library-variant.util';
import type {
  ListSurveyFollowUpsQueryDto,
  SaveSurveyAlertRuleDto,
  UpdateSurveyFollowUpDto,
} from './dto/survey-alerts.dto';

const OPEN_TASK: RoleTaskStatus[] = [RoleTaskStatus.OPEN, RoleTaskStatus.IN_PROGRESS];
/** Who takes an alert when its role is one the survey rates. */
const ESCALATION = ['DEPUTY_MANAGER', 'REGISTERED_MANAGER', 'NOMINATED_INDIVIDUAL'] as const;
type OwnerCtx = {
  roles: Array<{ id: string; name: string }>;
  settings: Map<string, string>;
  /** Library roles this survey's alerts must never go to, and their organisation roles. */
  neverKeys: string[];
  neverRoleIds: Set<string>;
  /** Who may see the answers is limited on this survey (task titles stay generic). */
  restricted: boolean;
  /** Results limited to these roles: alerts go only to them (null = any role). */
  onlyRoleIds: Set<string> | null;
};
/** Task title for a survey whose answers are limited to particular people. */
const RESTRICTED_TASK_TITLE = 'A survey answer needs follow-up';
const RESPONDENT_LABEL: Record<string, string> = {
  SELF: 'the person',
  FAMILY_MEMBER: 'a family member',
  REPRESENTATIVE: 'a representative',
  STAFF: 'staff on their behalf',
};
const CHANNEL_LABEL: Record<string, string> = {
  ONLINE: 'online',
  PORTAL: 'in the portal',
  TELEPHONE: 'by phone',
  PAPER: 'on paper',
  IN_PERSON: 'in person',
};
/** At most this many unchecked responses are looked at per sweep (the rest next minute). */
const SWEEP_LIMIT = 500;
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const unique = <T>(v: T[]) => [...new Set(v)];
/** A survey alert's task text: where to look, never what was answered. */
const alertTaskDescription = (surveyTitle: string) =>
  `An answer to "${surveyTitle}" needs follow-up. Open the page to see the answers, then record what was done there.`;

/**
 * A role task's title and description. Role tasks are listed to everyone who manages role tasks,
 * so they never name the person or quote answers: the rule's title and the survey only, and for a
 * survey whose answers are limited to particular people not even those.
 */
const alertTaskText = (input: { restricted: boolean; ruleTitle: string; surveyTitle: string; urgent: boolean }) => {
  const title = input.restricted ? RESTRICTED_TASK_TITLE : input.ruleTitle;
  return {
    title: (input.urgent ? `Urgent: ${title}` : title).slice(0, 200),
    description: input.restricted
      ? 'A survey answer needs follow-up. Open the page to see it (only people allowed to see this survey’s answers can), then record what was done there.'
      : alertTaskDescription(input.surveyTitle),
  };
};

type RuleRow = Prisma.SurveyAlertRuleGetPayload<object>;
type AlertRow = Prisma.SurveyAlertGetPayload<object>;
type AnswerRow = {
  questionId: string;
  booleanValue: boolean | null;
  numberValue: Prisma.Decimal | null;
  selectedOptions: Prisma.JsonValue;
  textValue: string | null;
  otherText: string | null;
  comment: string | null;
};

/**
 * Survey alert rules and the follow-up list.
 *
 * A rule turns chosen answers into work: a task (identity.RoleTask, "My tasks") for a role with the
 * policy timescale in working days, an in-app notification (high priority when urgent), and an entry
 * on the survey follow-up list with owner, outcome and any complaint, safeguarding case or incident
 * started from it. Ready-made surveys bring their library alerts as rules.
 *
 * Anonymity. Answers linked to no one — every answer to an anonymous survey and "Answer without my
 * name" on named surveys — are never alerted on one by one:
 *  - they are checked only once written out as responses: those held back are written by the survey
 *    job in shuffled batches of at least 5 (or all at the close), dated the day only;
 *  - all of a survey's unchecked unlinked answers are checked together and raise ONE grouped alert per
 *    rule with a count ("2 answers: Never"), never one per answer;
 *  - a grouped alert holds no response, person, written answer, comment or branch (the branch only
 *    when the survey is for a single branch, which everyone knows anyway), and is dated the day only;
 *  - contact-me rules never apply (the question is not asked of anyone answering without a name).
 * The database enforces the first three (CHECK SurveyAlert_unlinked_names_no_one).
 * Named answers raise one alert per rule per response, with the person, the matched answers, the
 * comment given with them and (contact-me) the contact details they gave.
 */
@Injectable()
export class SurveyAlertsService {
  private readonly logger = new Logger(SurveyAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
    private readonly orgScope: OrgScopeService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  // ─── Access ─────────────────────────────────────────────────────────────

  private async requireSurvey(actor: RequestUser, id: string): Promise<Survey> {
    const row = await this.prisma.survey.findFirst({ where: { id, deletedAt: null, isCatalogue: false } });
    if (!row || !surveyVisibleInScope(this.orgScope.fromRequestUser(actor), row)) {
      throw new NotFoundException('Survey not found');
    }
    return row;
  }

  /** The survey that holds the rules: a recurring survey's period uses its source survey's rules. */
  private ruleOwnerId(survey: { id: string; clonedFromId: string | null }) {
    return survey.clonedFromId ?? survey.id;
  }

  private async timeZone() {
    try {
      return (await this.orgSettings.getOperationalTimezone()) || DEFAULT_OPERATIONAL_TIMEZONE;
    } catch {
      return DEFAULT_OPERATIONAL_TIMEZONE;
    }
  }

  /**
   * A survey's questions for rules. CareFlow-list (equality) questions get their entries as answers
   * on named surveys; on an anonymous survey they are blocked: a rule on one entry ("Asian - Gujarati")
   * could point at the few people it fits.
   */
  private async questionsOf(surveyId: string): Promise<AlertQuestion[]> {
    const rows = await this.prisma.surveyQuestion.findMany({
      where: { surveyId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, key: true, questionText: true, questionType: true, options: true, config: true, otherOption: true, showIf: true, isActive: true, optionsFrom: true },
    });
    if (!rows.some((q) => q.optionsFrom)) return rows;
    const survey = await this.prisma.survey.findUnique({ where: { id: surveyId }, select: { isAnonymous: true } });
    if (survey?.isAnonymous) return rows.map((q) => (q.optionsFrom ? { ...q, options: null, lookupBlocked: true } : q));
    return withLookupOptions(this.prisma, rows, { includeRetired: true });
  }

  // ─── Rules ──────────────────────────────────────────────────────────────

  /**
   * Ready-made surveys: copies the library's rules in once (from the current ready-made survey's
   * details, so surveys adopted before rules existed get them too). Marked set up even when none
   * apply, so rules an organisation deletes stay deleted.
   */
  async ensureRules(surveyId: string): Promise<void> {
    const survey = await this.prisma.survey.findUnique({
      where: { id: surveyId },
      select: { id: true, alertRulesSetUpAt: true, libraryReference: true, libraryMeta: true, isAnonymous: true, isCatalogue: true },
    });
    if (!survey || survey.alertRulesSetUpAt || survey.isCatalogue) return;
    const rows = await this.libraryRows(survey);
    await this.prisma.$transaction(async (tx) => {
      // Raw SQL: setting up rules is not a change to the survey (its updatedAt dates CQC evidence).
      const marked = await tx.$executeRaw`UPDATE "surveys"."Survey" SET "alertRulesSetUpAt" = now() WHERE "id" = ${surveyId}::uuid AND "alertRulesSetUpAt" IS NULL`;
      if (marked === 0) return;
      if (rows.length) {
        await tx.surveyAlertRule.createMany({
          data: rows.map((r) => ({ ...r, surveyId, conditions: r.conditions as unknown as Prisma.InputJsonValue })),
          skipDuplicates: true,
        });
      }
    });
  }

  private async libraryRows(survey: { id: string; libraryReference: string | null; libraryMeta: Prisma.JsonValue; isAnonymous: boolean }) {
    if (!survey.libraryReference) return [];
    const meta = await this.libraryMetaFor(survey);
    return libraryRuleRows(meta, await this.questionsOf(survey.id), { anonymous: survey.isAnonymous });
  }

  /**
   * The current ready-made details (surveys started from a template do not keep their own copy); for
   * the anonymous version of a ready-made survey, that version's (its alerts for named answers left out).
   */
  private async libraryMetaFor(survey: { libraryReference: string | null; libraryMeta: Prisma.JsonValue; isAnonymous: boolean }) {
    if (!survey.libraryReference) return effectiveLibraryMeta(survey.libraryMeta, survey.isAnonymous);
    const catalogue = await this.prisma.survey.findFirst({
      where: { isCatalogue: true, libraryReference: survey.libraryReference, deletedAt: null },
      select: { libraryMeta: true },
    });
    return effectiveLibraryMeta(catalogue?.libraryMeta ?? survey.libraryMeta, survey.isAnonymous);
  }

  /** Copy a survey's rules to a new survey made from it (Use template, Duplicate, period copies keep using the source's). */
  async copyRules(fromSurveyId: string, toSurveyId: string, opts: { anonymous: boolean }) {
    await this.ensureRules(fromSurveyId);
    const rules = await this.prisma.surveyAlertRule.findMany({ where: { surveyId: fromSurveyId } });
    const questions = await this.questionsOf(toSurveyId);
    const keys = new Set(questions.map((q) => q.key));
    // Ready-made alerts the new survey does not have (retired, or left out of the anonymous version).
    const target = await this.prisma.survey.findUnique({ where: { id: toSurveyId }, select: { libraryReference: true, libraryMeta: true, isAnonymous: true } });
    const retired = new Set<number>();
    if (target?.libraryReference) {
      const meta = await this.libraryMetaFor(target);
      const alerts = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as { managerGuidance?: { alerts?: unknown } }).managerGuidance?.alerts : null;
      if (Array.isArray(alerts)) alerts.forEach((a, i) => (a && typeof a === 'object' && (a as { retired?: unknown }).retired === true ? retired.add(i) : null));
    }
    const kept = rules.filter(
      (r) =>
        flatConditions(readConditions(r.conditions)).every((c) => keys.has(c.questionKey)) &&
        !(opts.anonymous && r.contactRequest) &&
        !(r.libraryAlert !== null && retired.has(r.libraryAlert)),
    );
    await this.prisma.$transaction([
      this.prisma.survey.update({ where: { id: toSurveyId }, data: { alertRulesSetUpAt: new Date() } }),
      this.prisma.surveyAlertRule.createMany({
        data: kept.map((r) => ({
          surveyId: toSurveyId,
          key: r.key,
          position: r.position,
          title: r.title,
          whenText: r.whenText,
          actionText: r.actionText,
          conditions: r.conditions as Prisma.InputJsonValue,
          ownerKey: r.ownerKey,
          roleId: r.roleId,
          dueWorkingDays: r.dueWorkingDays,
          dueCalendarDays: r.dueCalendarDays,
          urgent: r.urgent,
          recordKind: r.recordKind,
          contactRequest: r.contactRequest,
          isActive: r.isActive,
          libraryAlert: r.libraryAlert,
          // The fewest answers before a grouped alert is raised: a copy keeps it (an own rule's 10 for
          // abuse or equality questions would otherwise fall back to 5 on the copy).
          minimumAnswers: r.minimumAnswers,
        })),
        skipDuplicates: true,
      }),
    ]);
  }

  /**
   * Roles and the organisation's alert-role settings; given a survey, also the roles its alerts must
   * never go to (the survey rates them: its own list, else the ready-made default).
   */
  private async ownerRoleMap(survey?: { id: string; clonedFromId: string | null }): Promise<OwnerCtx> {
    const [roles, settings] = await Promise.all([
      this.prisma.role.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.surveyAlertOwnerRole.findMany(),
    ]);
    const ctx: OwnerCtx = { roles, settings: new Map(settings.map((s) => [s.ownerKey, s.roleId])), neverKeys: [], neverRoleIds: new Set(), restricted: false, onlyRoleIds: null };
    if (survey) {
      ctx.neverKeys = await this.neverRouteTo(this.ruleOwnerId(survey));
      for (const k of ctx.neverKeys) {
        const id = ctx.settings.get(k) ?? roleForOwner(k, roles)?.id;
        if (id) ctx.neverRoleIds.add(id);
      }
      // Results limited to particular people: alerts go only to roles allowed to see them.
      const full = await this.prisma.survey.findUnique({ where: { id: survey.id }, select: ACCESS_SELECT });
      if (full) {
        const audience = await surveyResultsAudience(this.prisma, full);
        ctx.restricted = audience.restricted;
        ctx.onlyRoleIds = audience.roleIds;
      }
    }
    return ctx;
  }

  /** The library roles a survey's alerts must never go to. */
  async neverRouteTo(ownerSurveyId: string): Promise<string[]> {
    const s = await this.prisma.survey.findUnique({ where: { id: ownerSurveyId }, select: { alertNeverRouteTo: true, libraryReference: true, libraryMeta: true, isAnonymous: true } });
    if (!s) return [];
    if (s.alertNeverRouteTo?.length) return s.alertNeverRouteTo;
    const meta = await this.libraryMetaFor(s);
    const lib = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>).alertsNeverTo : null;
    return Array.isArray(lib) ? lib.filter((k): k is string => typeof k === 'string') : [];
  }

  /** The role a rule names (its own role, else its library role in this organisation), before any rerouting. */
  intendedRole(rule: { roleId: string | null; ownerKey: string | null }, ctx: Pick<OwnerCtx, 'roles' | 'settings'>): { id: string; name: string } | null {
    if (rule.roleId) return ctx.roles.find((r) => r.id === rule.roleId) ?? null;
    if (!rule.ownerKey) return null;
    const set = ctx.settings.get(rule.ownerKey);
    return (set ? ctx.roles.find((r) => r.id === set) : undefined) ?? roleForOwner(rule.ownerKey, ctx.roles);
  }

  /** Active rules whose role could not see the results under a proposed set of results roles. */
  async rulesOutsideResults(surveyId: string, resultsRoleIds: ReadonlySet<string>) {
    const rules = await this.prisma.surveyAlertRule.findMany({ where: { surveyId, isActive: true }, orderBy: { position: 'asc' } });
    const ctx = await this.ownerRoleMap();
    return rules.flatMap((r) => {
      const role = this.intendedRole(r, ctx);
      return role && resultsRoleIds.has(role.id) ? [] : [{ id: r.id, title: r.title, role: role?.name ?? null }];
    });
  }

  /**
   * The role a rule's task goes to: the rule's own role, else the organisation's role for its owner,
   * else the usual name, else the Registered Manager. Never a role the survey rates: then the next
   * one up (Deputy Manager, Registered Manager, Nominated Individual) that the survey does not rate.
   */
  private resolveRole(rule: { roleId: string | null; ownerKey: string | null }, ctx: OwnerCtx): { id: string; name: string } | null {
    const byId = (id: string | null | undefined) => (id ? (ctx.roles.find((r) => r.id === id) ?? null) : null);
    const forKey = (k: string) => byId(ctx.settings.get(k)) ?? roleForOwner(k, ctx.roles);
    const usable = (r: { id: string; name: string } | null) =>
      r && !ctx.neverRoleIds.has(r.id) && (!ctx.onlyRoleIds || ctx.onlyRoleIds.has(r.id)) ? r : null;
    const first =
      byId(rule.roleId) ?? (rule.ownerKey ? forKey(rule.ownerKey) : null) ?? forKey('REGISTERED_MANAGER');
    if (usable(first) && !(rule.ownerKey && ctx.neverKeys.includes(rule.ownerKey) && !rule.roleId)) return first;
    for (const k of ESCALATION) {
      if (ctx.neverKeys.includes(k)) continue;
      const r = usable(forKey(k));
      if (r) return r;
    }
    return null;
  }

  /** Rules for a survey's page: rules, roles, questions that can be checked and the library alerts that stay manual. */
  async listRules(actor: RequestUser, surveyId: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    const ownerId = this.ruleOwnerId(survey);
    await this.ensureRules(ownerId);
    const [rules, questions, ctx] = await Promise.all([
      this.prisma.surveyAlertRule.findMany({ where: { surveyId: ownerId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.questionsOf(ownerId),
      this.ownerRoleMap(survey),
    ]);
    const holderRows = await this.prisma.userRole.findMany({ where: { user: { deletedAt: null, isActive: true } }, select: { roleId: true } });
    const holders = new Map<string, number>();
    for (const h of holderRows) holders.set(h.roleId, (holders.get(h.roleId) ?? 0) + 1);
    const withHolders = (role: { id: string; name: string } | null) => (role ? { ...role, holders: holders.get(role.id) ?? 0 } : null);
    const unlinkedOnly = survey.isAnonymous;
    const sharedLink = survey.targetKind === 'PUBLIC';
    const manual = libraryAlerts(await this.libraryMetaFor(survey))
      .filter((a) => !a.rule || !rules.some((r) => r.libraryAlert === a.index))
      .map((a) => ({ when: a.when, action: a.action }));
    return {
      message: 'Survey alert rules',
      data: {
        surveyId: ownerId,
        /** A period of a recurring survey: rules are edited on the recurring survey. */
        editedOnSurveyId: ownerId !== survey.id ? ownerId : null,
        isAnonymous: survey.isAnonymous,
        offersAnswerWithoutName: survey.allowAnonymousResponses,
        /** A ready-made survey (its library rules can be restored). */
        fromLibrary: Boolean(survey.libraryReference),
        anonymityNote: unlinkedOnly
          ? sharedLink
            ? 'Answers to this survey are linked to no one. Alerts from them are grouped: each shows how many answers matched, never who gave them, their written answers or their branch. Read the written answers in the results.'
            : 'Answers to this survey are linked to no one. Alerts from them are grouped and raised only when answers are added to the results (in batches of at least 5, or when the survey closes). They show how many answers matched, never who gave them, their written answers or their branch.'
          : survey.allowAnonymousResponses
            ? 'Answers given without a name are grouped and raised only when they are added to the results (in batches of at least 5, or when the survey closes), and never say who gave them. Named answers raise an alert for that person straight away.'
            : null,
        rules: rules.map((r) => {
          const out = this.serializeRule(r, questions, ctx);
          return { ...out, role: withHolders(out.role) };
        }),
        questions: questions
          .filter((q) => q.key && alertAnswerChoices(q))
          .map((q) => ({
            key: q.key!,
            questionText: q.questionText,
            answers: alertAnswerChoices(q)!,
            contactRequest: isContactRequestQuestion(q),
          })),
        owners: SURVEY_ALERT_OWNER_KEYS.map((key) => ({
          key,
          label: SURVEY_ALERT_OWNERS[key].label,
          role: withHolders(this.resolveRole({ roleId: null, ownerKey: key }, ctx)),
          chosen: ctx.settings.has(key),
        })),
        roles: ctx.roles,
        /** Library alerts that need someone to read the answers (written comments): still checked by hand. */
        manualChecks: manual,
        /** Library roles this survey rates: its alerts go to the next role up instead. */
        neverRouteTo: ctx.neverKeys,
      },
    };
  }

  private serializeRule(
    r: RuleRow,
    questions: AlertQuestion[],
    ctx: OwnerCtx,
  ) {
    const byKey = new Map(questions.map((q) => [q.key, q]));
    const conditions = readConditions(r.conditions);
    const problems = conditionProblems(conditions, questions);
    return {
      id: r.id,
      key: r.key,
      title: r.title,
      whenText: r.whenText,
      actionText: r.actionText,
      /** "any" (one of them), "all" (every one), or "mixed" (a ready-made combination edited as a whole). */
      match: conditionMode(conditions),
      conditions: flatConditions(conditions).map((c) => ({ ...c, questionText: byKey.get(c.questionKey)?.questionText ?? null })),
      minimumAnswers: r.minimumAnswers,
      ownerKey: r.ownerKey,
      ownerLabel: r.ownerKey && r.ownerKey in SURVEY_ALERT_OWNERS ? SURVEY_ALERT_OWNERS[r.ownerKey as SurveyAlertOwnerKey].label : null,
      roleId: r.roleId,
      role: this.resolveRole(r, ctx),
      dueWorkingDays: r.dueWorkingDays,
      dueCalendarDays: r.dueCalendarDays,
      urgent: r.urgent,
      recordKind: r.recordKind,
      contactRequest: r.contactRequest,
      isActive: r.isActive,
      fromLibrary: r.libraryAlert !== null,
      /** Why it cannot fire as it stands (a question removed or changed), shown to the manager. */
      problems,
    };
  }

  /** Every rule's "when" in words from its conditions (own rules with no wording). */
  private describeConditions(entries: AlertConditionEntry[], questions: AlertQuestion[]) {
    const byKey = new Map(questions.map((q) => [q.key, q]));
    const one = (c: StoredAlertCondition) =>
      `"${byKey.get(c.questionKey)?.questionText ?? c.questionKey}" ${c.not ? `answered without choosing ${orList(c.answers)}` : `answered ${orList(c.answers)}`}`;
    return entries.map((e) => (isGroup(e) ? e.all.map(one).join(' and ') : one(e))).join(', or ');
  }

  private async validatedRuleInput(survey: Survey, dto: SaveSurveyAlertRuleDto, keepConditions?: AlertConditionEntry[]) {
    const questions = await this.questionsOf(survey.id);
    const simple = dto.conditions.map((c): StoredAlertCondition => {
      const out = { questionKey: c.questionKey.trim(), answers: unique(c.answers.map((a) => a.trim())) };
      return c.not ? { ...out, not: true } : out;
    });
    // "All of these" is one group; "any" keeps each condition on its own. A ready-made combination
    // the editor cannot show is kept as it is (keepConditions) while its other settings change.
    const conditions: AlertConditionEntry[] =
      keepConditions ?? (dto.match === 'all' && simple.length > 1 ? [{ all: simple }] : simple);
    const problems = conditionProblems(conditions, questions);
    if (problems.length) throw new BadRequestException(problems[0]);
    const contactRequest = dto.contactRequest === true;
    if (contactRequest && survey.isAnonymous) {
      throw new BadRequestException('An anonymous survey cannot have a contact-me follow-up: nobody could be contacted.');
    }
    if (contactRequest && !isContactRuleShape(conditions, questions)) {
      throw new BadRequestException(
        'A contact-me follow-up checks only "Would you like someone to contact you…" answered Yes.',
      );
    }
    if (dto.roleId) {
      const role = await this.prisma.role.findFirst({ where: { id: dto.roleId, deletedAt: null, isActive: true } });
      if (!role) throw new BadRequestException('That role no longer exists');
      if ((await this.ownerRoleMap(survey)).neverRoleIds.has(role.id)) {
        throw new BadRequestException(`This survey rates the ${role.name} role, so its alerts cannot go to them. Choose another role.`);
      }
    }
    // Results limited to some roles: the alert must go to one of them (or it would be rerouted and
    // its instructions would name the wrong person).
    {
      const ctx = await this.ownerRoleMap(survey);
      if (ctx.onlyRoleIds) {
        const intended = this.intendedRole({ roleId: dto.roleId ?? null, ownerKey: dto.ownerKey ?? null }, ctx);
        if (!intended || !ctx.onlyRoleIds.has(intended.id)) {
          throw new BadRequestException(
            `${intended?.name ?? 'That role'} cannot see this survey's results, so it cannot be given its alerts. Choose a role that can, or change who can see the answers first.`,
          );
        }
      }
    }
    // Exactly one timescale, as in the ready-made library.
    if ((dto.dueWorkingDays == null) === (dto.dueCalendarDays == null)) {
      throw new BadRequestException('Give the time to do it in either working days or calendar days, not both.');
    }
    if (dto.minimumAnswers != null && dto.minimumAnswers < MIN_REPORTING_THRESHOLD_UNLINKED) {
      throw new BadRequestException(`An alert from answers given without a name needs at least ${MIN_REPORTING_THRESHOLD_UNLINKED} answers.`);
    }
    return {
      minimumAnswers: dto.minimumAnswers ?? null,
      title: dto.title.trim(),
      whenText: dto.whenText?.trim() || this.describeConditions(conditions, questions),
      actionText: dto.actionText.trim(),
      conditions: conditions as unknown as Prisma.InputJsonValue,
      ownerKey: dto.ownerKey ?? null,
      roleId: dto.roleId ?? null,
      dueWorkingDays: dto.dueWorkingDays ?? 0,
      dueCalendarDays: dto.dueCalendarDays ?? null,
      urgent: dto.urgent ?? false,
      recordKind: dto.recordKind ?? null,
      contactRequest,
      isActive: dto.isActive ?? true,
    };
  }

  private async requireRuleSurvey(actor: RequestUser, surveyId: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    if (survey.clonedFromId) {
      throw new BadRequestException('This is one period of a repeating survey: change its alert rules on the repeating survey.');
    }
    if (this.orgScope.fromRequestUser(actor).locationIds !== null && survey.isTemplate && survey.locationIds.length === 0) {
      throw new ForbiddenException('This is a shared company template, so only someone with access to all branches can change its alert rules.');
    }
    await this.ensureRules(survey.id);
    return survey;
  }

  async createRule(actor: RequestUser, surveyId: string, dto: SaveSurveyAlertRuleDto) {
    const survey = await this.requireRuleSurvey(actor, surveyId);
    const data = await this.validatedRuleInput(survey, dto);
    const last = await this.prisma.surveyAlertRule.aggregate({ where: { surveyId }, _max: { position: true } });
    const created = await this.prisma.surveyAlertRule.create({
      data: { ...data, surveyId, key: `own-${randomUUID().slice(0, 8)}`, position: (last._max.position ?? -1) + 1, createdById: actor.id, updatedById: actor.id },
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_ALERT_RULE_CREATED,
      recordType: 'SurveyAlertRule',
      recordId: created.id,
      description: `Alert rule "${created.title}" added to survey "${survey.title}"`,
      newValues: { ...data, conditions: dto.conditions },
      metadata: { surveyId },
    });
    return { message: 'Alert rule added', data: { id: created.id } };
  }

  async updateRule(actor: RequestUser, surveyId: string, ruleId: string, dto: SaveSurveyAlertRuleDto) {
    const survey = await this.requireRuleSurvey(actor, surveyId);
    const existing = await this.prisma.surveyAlertRule.findFirst({ where: { id: ruleId, surveyId } });
    if (!existing) throw new NotFoundException('Alert rule not found');
    const data = await this.validatedRuleInput(survey, dto, dto.keepConditions ? readConditions(existing.conditions) : undefined);
    await this.prisma.surveyAlertRule.update({ where: { id: ruleId }, data: { ...data, updatedById: actor.id } });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_ALERT_RULE_UPDATED,
      recordType: 'SurveyAlertRule',
      recordId: ruleId,
      description: `Alert rule "${data.title}" changed on survey "${survey.title}"`,
      oldValues: {
        title: existing.title,
        conditions: existing.conditions,
        ownerKey: existing.ownerKey,
        roleId: existing.roleId,
        dueWorkingDays: existing.dueWorkingDays,
        urgent: existing.urgent,
        recordKind: existing.recordKind,
        isActive: existing.isActive,
      },
      newValues: { ...data, conditions: dto.conditions },
      metadata: { surveyId },
    });
    return { message: 'Alert rule saved', data: { id: ruleId } };
  }

  async deleteRule(actor: RequestUser, surveyId: string, ruleId: string) {
    const survey = await this.requireRuleSurvey(actor, surveyId);
    const existing = await this.prisma.surveyAlertRule.findFirst({ where: { id: ruleId, surveyId } });
    if (!existing) throw new NotFoundException('Alert rule not found');
    // Alerts already raised keep their task and history (ruleId is set to null).
    await this.prisma.surveyAlertRule.delete({ where: { id: ruleId } });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_ALERT_RULE_DELETED,
      recordType: 'SurveyAlertRule',
      recordId: ruleId,
      description: `Alert rule "${existing.title}" removed from survey "${survey.title}"`,
      oldValues: { title: existing.title, conditions: existing.conditions, ownerKey: existing.ownerKey },
      metadata: { surveyId },
    });
    return { message: 'Alert rule removed', data: { id: ruleId } };
  }

  /** Ready-made surveys: put back library rules that were removed or changed (own rules are kept). */
  async restoreLibraryRules(actor: RequestUser, surveyId: string) {
    const survey = await this.requireRuleSurvey(actor, surveyId);
    const rows = await this.libraryRows(survey);
    if (!rows.length) throw new BadRequestException('This survey has no ready-made alert rules.');
    await this.prisma.$transaction(async (tx) => {
      await tx.surveyAlertRule.deleteMany({ where: { surveyId, key: { in: rows.map((r) => r.key) } } });
      await tx.surveyAlertRule.createMany({
        data: rows.map((r) => ({ ...r, surveyId, conditions: r.conditions as unknown as Prisma.InputJsonValue, createdById: actor.id, updatedById: actor.id })),
      });
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_ALERT_RULES_RESTORED,
      recordType: 'Survey',
      recordId: surveyId,
      description: `Ready-made alert rules restored on survey "${survey.title}"`,
      newValues: { restored: rows.length },
    });
    return { message: 'Ready-made alert rules restored', data: { restored: rows.length } };
  }

  /** Roles this survey rates, so its alerts never go to them (e.g. Care Coordinators on a rota survey). */
  async setNeverRouteTo(actor: RequestUser, surveyId: string, ownerKeys: string[]) {
    const survey = await this.requireRuleSurvey(actor, surveyId);
    const keys = unique(ownerKeys).filter((k) => (SURVEY_ALERT_OWNER_KEYS as string[]).includes(k));
    if (keys.length >= SURVEY_ALERT_OWNER_KEYS.length) throw new BadRequestException('Leave at least one role that can take this survey’s alerts.');
    const before = await this.neverRouteTo(survey.id);
    // Raw SQL: not a change to the survey's content (its updatedAt dates CQC evidence).
    await this.prisma.$executeRaw`UPDATE "surveys"."Survey" SET "alertNeverRouteTo" = ${keys}::text[] WHERE "id" = ${survey.id}::uuid`;
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_ALERT_RULE_UPDATED,
      recordType: 'Survey',
      recordId: survey.id,
      description: `Roles that survey "${survey.title}" alerts never go to changed`,
      oldValues: { alertNeverRouteTo: before },
      newValues: { alertNeverRouteTo: keys },
    });
    return { message: 'Saved', data: { neverRouteTo: keys } };
  }

  /** Who does each library role's alerts in this organisation (Surveys → alert roles). */
  async setOwnerRole(actor: RequestUser, ownerKey: string, roleId: string | null) {
    if (!(SURVEY_ALERT_OWNER_KEYS as string[]).includes(ownerKey)) throw new NotFoundException('Unknown alert role');
    if (this.orgScope.fromRequestUser(actor).locationIds !== null) {
      throw new ForbiddenException('Only someone with access to all branches can choose who handles survey alerts.');
    }
    const before = await this.prisma.surveyAlertOwnerRole.findUnique({ where: { ownerKey } });
    if (roleId) {
      const role = await this.prisma.role.findFirst({ where: { id: roleId, deletedAt: null, isActive: true } });
      if (!role) throw new BadRequestException('That role no longer exists');
      await this.prisma.surveyAlertOwnerRole.upsert({
        where: { ownerKey },
        create: { ownerKey, roleId, updatedById: actor.id },
        update: { roleId, updatedById: actor.id },
      });
    } else {
      await this.prisma.surveyAlertOwnerRole.deleteMany({ where: { ownerKey } });
    }
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_ALERT_OWNER_ROLE_SET,
      recordType: 'SurveyAlertOwnerRole',
      recordId: ownerKey,
      description: `Survey alerts for ${SURVEY_ALERT_OWNERS[ownerKey as SurveyAlertOwnerKey].label} now go to ${roleId ? 'a chosen role' : 'the usual role'}`,
      oldValues: { roleId: before?.roleId ?? null },
      newValues: { roleId },
    });
    return { message: 'Saved', data: { ownerKey, roleId } };
  }

  // ─── Raising alerts ─────────────────────────────────────────────────────

  /** Bank holidays in the organisation's region (Settings), plus its own special days. */
  private async holidays(fromIso: string): Promise<Set<string>> {
    const region = await Promise.resolve()
      .then(() => this.orgSettings.getBankHolidayRegion())
      .catch(() => 'UK');
    const rows = await this.prisma.bankHoliday.findMany({
      where: { isActive: true, region: { in: [region, 'ORGANISATION'] }, holidayDate: { gte: toDate(fromIso), lte: toDate(`${Number(fromIso.slice(0, 4)) + 1}-12-31`) } },
      select: { holidayDate: true },
    });
    return new Set(rows.map((r) => toIso(r.holidayDate)));
  }

  /**
   * Check one response against its survey's rules (fire-and-forget after a response is saved; the
   * survey job's sweep catches anything missed). Named responses only: answers linked to no one are
   * left to the sweep, which groups them.
   */
  async checkResponse(responseId: string): Promise<number> {
    const response = await this.prisma.surveyResponse.findUnique({
      where: { id: responseId },
      include: { answers: true, recipient: { select: { employeeId: true, serviceUserId: true } }, survey: true },
    });
    if (!response || response.alertsChecked) return 0;
    if (this.isUnlinked(response, response.survey)) return 0;
    return this.raiseForNamed(response);
  }

  /** Re-check a corrected (staff-recorded) response: alerts already raised for it are not raised again. */
  async recheckResponse(responseId: string): Promise<number> {
    // Never an answer linked to no one: the sweep would raise a second grouped alert for it.
    await this.prisma.$executeRaw`UPDATE "surveys"."SurveyResponse" r SET "alertsChecked" = false
       FROM "surveys"."Survey" s
      WHERE r."id" = ${responseId}::uuid AND s."id" = r."surveyId"
        AND r."isAnonymous" = false AND NOT (s."isAnonymous" AND r."recipientId" IS NULL)`;
    return this.checkResponse(responseId);
  }

  private isUnlinked(r: { recipientId: string | null; isAnonymous: boolean }, s: { isAnonymous: boolean }) {
    return r.isAnonymous || (s.isAnonymous && r.recipientId === null);
  }

  private async activeRules(survey: Survey) {
    const ownerId = this.ruleOwnerId(survey);
    await this.ensureRules(ownerId);
    return this.prisma.surveyAlertRule.findMany({ where: { surveyId: ownerId, isActive: true }, orderBy: { position: 'asc' } });
  }

  private async raiseForNamed(
    response: Prisma.SurveyResponseGetPayload<{ include: { answers: true; recipient: { select: { employeeId: true; serviceUserId: true } }; survey: true } }>,
  ): Promise<number> {
    const survey = response.survey;
    const rules = await this.activeRules(survey);
    const questions = await this.questionsOf(survey.id);
    const labels = answerLabelsByKey(questions, response.answers.map((a) => ({ ...a, numberValue: a.numberValue == null ? null : Number(a.numberValue) })));
    const hits = rules
      .map((rule) => ({ rule, matched: matchConditions(readConditions(rule.conditions), labels) }))
      .filter((h) => h.matched.length);
    const tz = await this.timeZone();
    const now = new Date();
    const today = operationalTodayIso(now, tz);
    const holidays = hits.length ? await this.holidays(today) : new Set<string>();
    const ctx: OwnerCtx = hits.length ? await this.ownerRoleMap(survey) : { roles: [], settings: new Map(), neverKeys: [], neverRoleIds: new Set(), restricted: false, onlyRoleIds: null };
    const who = hits.length ? await this.personOf(response) : null;
    const raised: Array<{ alert: AlertRow; roleName: string | null }> = [];

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`UPDATE "surveys"."SurveyResponse" SET "alertsChecked" = true WHERE "id" = ${response.id}::uuid AND "alertsChecked" = false`;
      if (claimed === 0) return;
      for (const { rule, matched } of hits) {
        const exists = await tx.surveyAlert.findFirst({ where: { ruleId: rule.id, responseId: response.id }, select: { id: true } });
        if (exists) continue;
        const role = this.resolveRole(rule, ctx);
        const details = this.namedDetails(survey, response, who!, rule, matched, questions);
        const alert = await this.createAlertWithTask(tx, {
          restricted: ctx.restricted,
          survey,
          rule,
          role,
          due: ruleDueDate(today, rule, holidays),
          createdAt: now,
          title: who?.name ? `${rule.title}: ${who.name}` : rule.title,
          details,
          matched: matched.map((m) => ({ question: questions.find((q) => q.key === m.questionKey)?.questionText ?? m.questionKey, answers: m.answers, count: 1 })),
          responseId: response.id,
          unlinked: false,
          matchCount: 1,
          serviceUserId: response.recipient?.serviceUserId ?? null,
          employeeId: response.recipient?.employeeId ?? null,
          locationId: response.locationId ?? (survey.locationIds.length === 1 ? survey.locationIds[0] : null),
        });
        raised.push({ alert, roleName: role?.name ?? null });
      }
    });
    await this.afterRaised(survey, raised);
    return raised.length;
  }

  /** Who gave a named response, for the task (never called for answers linked to no one). */
  private async personOf(response: { recipient: { employeeId: string | null; serviceUserId: string | null } | null; respondentRelation: string | null; respondentName: string | null; channel: string }) {
    let name: string | null = null;
    if (response.recipient?.serviceUserId) {
      const su = await this.prisma.serviceUser.findFirst({ where: { id: response.recipient.serviceUserId }, select: { firstName: true, lastName: true } });
      name = su ? `${su.firstName} ${su.lastName}`.trim() : null;
    } else if (response.recipient?.employeeId) {
      const e = await this.prisma.employeePersonalDetail.findFirst({ where: { employeeId: response.recipient.employeeId }, select: { firstName: true, lastName: true } });
      name = e ? `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || null : null;
    }
    const by =
      response.respondentRelation && response.respondentRelation !== 'SELF'
        ? `${RESPONDENT_LABEL[response.respondentRelation] ?? 'someone else'}${response.respondentName ? ` (${response.respondentName})` : ''}`
        : null;
    return { name, by, channel: CHANNEL_LABEL[response.channel] ?? null };
  }

  private namedDetails(
    survey: Survey,
    response: { answers: AnswerRow[] },
    who: { name: string | null; by: string | null; channel: string | null },
    rule: RuleRow,
    matched: StoredAlertCondition[],
    questions: AlertQuestion[],
  ): string {
    const byKey = new Map(questions.map((q) => [q.key, q]));
    const answerOf = new Map(response.answers.map((a) => [a.questionId, a]));
    const lines: string[] = [];
    lines.push(
      `${who.name ? `${who.name} answered` : 'Someone answered'} "${survey.title}"${who.channel ? ` ${who.channel}` : ''}${who.by ? `, answered by ${who.by}` : ''}.`,
    );
    for (const m of matched) {
      const q = byKey.get(m.questionKey);
      const a = q ? answerOf.get(q.id) : undefined;
      lines.push(`• "${q?.questionText ?? m.questionKey}": ${matchedAnswerText(m)}`);
      if (a?.otherText) lines.push(`  Other: "${a.otherText}"`);
      if (a?.comment) lines.push(`  Their comment: "${a.comment}"`);
    }
    if (rule.contactRequest) {
      // The contact details they chose to give (the questions asked only after contact-me).
      const all = questions as Array<AlertQuestion & { showIf?: unknown; isActive?: boolean }>;
      const details = questionsNotAskedWhenUnlinked(
        all.map((q) => ({ id: q.id, key: q.key, questionType: q.questionType, questionText: q.questionText, showIf: q.showIf ?? null })),
      );
      for (const q of all) {
        if (!details.has(q.id) || isContactRequestQuestion(q)) continue;
        const a = answerOf.get(q.id);
        const text = a?.textValue?.trim() || (Array.isArray(a?.selectedOptions) ? (a!.selectedOptions as string[]).join(', ') : '');
        if (text) lines.push(`• ${q.questionText} ${text}`);
      }
    }
    lines.push('', `What to do: ${rule.actionText}`);
    return lines.join('\n');
  }

  private async createAlertWithTask(
    tx: Prisma.TransactionClient,
    input: {
      survey: Survey;
      rule: RuleRow;
      role: { id: string; name: string } | null;
      due: string;
      createdAt: Date;
      title: string;
      details: string;
      matched: unknown;
      responseId: string | null;
      unlinked: boolean;
      matchCount: number;
      serviceUserId: string | null;
      employeeId: string | null;
      locationId: string | null;
      /** Who may see the survey's answers is limited (generic task text). */
      restricted: boolean;
    },
  ): Promise<AlertRow> {
    const id = randomUUID();
    const taskId = input.role ? randomUUID() : null;
    if (input.role) {
      await tx.roleTask.create({
        data: {
          id: taskId!,
          templateId: null,
          sourceType: SURVEY_ALERT_TASK_SOURCE,
          sourceId: id,
          roleId: input.role.id,
          locationId: input.locationId,
          // Never the person, answers or comments: role tasks are listed to everyone who manages role
          // tasks, who may have no survey access. The follow-up (opened from the link) holds the details.
          // Anonymous surveys and answers given without a name count as restricted whatever the
          // access settings: a survey's title can itself point at someone ("Feedback on your manager: …").
          ...alertTaskText({ restricted: input.restricted || input.unlinked || input.survey.isAnonymous, ruleTitle: input.rule.title, surveyTitle: input.survey.title, urgent: input.rule.urgent }),
          link: `/surveys/follow-ups?alert=${id}`,
          dueDate: toDate(input.due),
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        },
      });
    }
    return tx.surveyAlert.create({
      data: {
        id,
        surveyId: input.survey.id,
        ruleId: input.rule.id,
        responseId: input.responseId,
        unlinked: input.unlinked,
        matchCount: input.matchCount,
        matched: input.matched as Prisma.InputJsonValue,
        title: input.title.slice(0, 200),
        details: input.details,
        contactRequest: input.unlinked ? false : input.rule.contactRequest,
        serviceUserId: input.serviceUserId,
        employeeId: input.employeeId,
        locationId: input.locationId,
        roleId: input.role?.id ?? null,
        roleTaskId: taskId,
        dueDate: toDate(input.due),
        urgent: input.rule.urgent,
        recordKind: input.rule.recordKind,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      },
    });
  }

  /** Audit and notify after the alerts are saved. Never fails the caller. */
  private async afterRaised(survey: Survey, raised: Array<{ alert: AlertRow; roleName: string | null }>) {
    for (const { alert, roleName } of raised) {
      try {
        await this.audit.logAudit({
          userId: undefined,
          module: AuditModule.SURVEY,
          action: AuditAction.SURVEY_ALERT_RAISED,
          recordType: 'SurveyAlert',
          recordId: alert.id,
          // Never the alert's title: it can name the person and what they answered, and audit
          // readers need not have access to this survey's answers. The record id leads to it.
          description: `Survey alert raised${roleName ? ` for ${roleName}` : ' (no role found)'}`,
          // Grouped alerts: no response or person, as on the alert itself.
          newValues: {
            surveyId: survey.id,
            ruleId: alert.ruleId,
            unlinked: alert.unlinked,
            matchCount: alert.matchCount,
            ...(alert.unlinked ? {} : { responseId: alert.responseId }),
            dueDate: toIso(alert.dueDate),
          },
        });
        await this.notifyAlert(survey, alert, roleName);
      } catch (e) {
        this.logger.warn(`Survey alert ${alert.id}: follow-up notice failed (${e instanceof Error ? e.name : 'error'})`);
      }
    }
  }

  private async usersWithRole(roleId: string, locationId: string | null): Promise<string[]> {
    const links = await this.prisma.userRole.findMany({
      where: { roleId, user: { deletedAt: null, isActive: true } },
      select: { userId: true, user: { select: { userLocations: { select: { locationId: true } } } } },
    });
    return unique(
      links
        .filter((l) => !locationId || !l.user.userLocations.length || l.user.userLocations.some((x) => x.locationId === locationId))
        .map((l) => l.userId),
    );
  }

  /**
   * Survey managers who can see this survey and this alert's branch: company-wide users, and
   * branch users whose branches cover the survey's branches (and the alert's branch).
   */
  private async surveyManagerIds(scope: { surveyLocationIds: string[]; locationId: string | null }): Promise<string[]> {
    const perm = await this.prisma.permission.findFirst({ where: { key: 'surveys.manage', deletedAt: null } });
    const roleIds = perm ? (await this.prisma.rolePermission.findMany({ where: { permissionId: perm.id }, select: { roleId: true } })).map((r) => r.roleId) : [];
    const superAdmin = await this.prisma.role.findMany({ where: { name: IDENTITY_ROLE.SUPER_ADMIN, deletedAt: null }, select: { id: true } });
    const users = await this.prisma.userRole.findMany({
      where: { roleId: { in: [...roleIds, ...superAdmin.map((r) => r.id)] }, user: { deletedAt: null, isActive: true } },
      select: { userId: true, user: { select: { userLocations: { select: { locationId: true } } } } },
    });
    const needed = unique([...scope.surveyLocationIds, ...(scope.locationId ? [scope.locationId] : [])]);
    return unique(
      users
        .filter((u) => {
          const mine = u.user.userLocations.map((l) => l.locationId);
          if (!mine.length) return true; // not branch-restricted
          return needed.length > 0 && needed.every((id) => mine.includes(id));
        })
        .map((u) => u.userId),
    );
  }

  /**
   * Tell the role (or, when nobody holds it, the survey managers for that branch) that an alert needs
   * action. Notifications never name the person or quote answers: the rule's title, the survey and
   * the due date only; the follow-up page shows the rest to those allowed to see it.
   */
  private async notifyAlert(survey: Survey, alert: AlertRow, roleName: string | null, opts: { reassigned?: boolean } = {}) {
    const full = await this.prisma.survey.findUnique({ where: { id: survey.id }, select: ACCESS_SELECT });
    const audience = full
      ? await surveyResultsAudience(this.prisma, full)
      : { restricted: false, roleIds: null, userIds: [] as string[], createdById: null, excludedUserIds: [] as string[] };
    // The person the survey is about (the manager a copy rates) never counts as holding the role: when
    // they are its only holder, survey managers are told instead.
    const holders = (alert.roleId ? await this.usersWithRole(alert.roleId, alert.locationId) : []).filter(
      (id) => !audience.excludedUserIds.includes(id),
    );
    // Nobody to give it to (no role found, or no one holds the role): survey managers are told, so
    // an urgent alert never lands on no one.
    let recipients = holders.length ? holders : await this.surveyManagerIds({ surveyLocationIds: survey.locationIds, locationId: alert.locationId });
    // Results limited to particular people: managers told instead must be among them.
    if (!holders.length && audience.roleIds) {
      const allowedRoles = [...audience.roleIds];
      const admins = await this.prisma.role.findMany({ where: { name: { in: [IDENTITY_ROLE.SUPER_ADMIN, IDENTITY_ROLE.ADMIN] }, deletedAt: null }, select: { id: true } });
      const links = await this.prisma.userRole.findMany({
        where: { userId: { in: recipients }, roleId: { in: [...allowedRoles, ...admins.map((r) => r.id)] } },
        select: { userId: true },
      });
      const ok = new Set([...links.map((l) => l.userId), ...audience.userIds, ...(audience.createdById ? [audience.createdById] : [])]);
      recipients = recipients.filter((id) => ok.has(id));
    }
    // Never the person the survey is about (the manager a copy rates), even if they hold the role.
    recipients = recipients.filter((id) => !audience.excludedUserIds.includes(id));
    if (!recipients.length) return;
    const rule = alert.ruleId ? await this.prisma.surveyAlertRule.findUnique({ where: { id: alert.ruleId }, select: { title: true } }) : null;
    // A survey whose answers are limited: say nothing about it beyond "a survey answer".
    // Limited, anonymous or answered without a name: nothing about the survey beyond "a survey answer"
    // (its title can itself point at someone, e.g. one copy per manager).
    const generic = audience.restricted || alert.unlinked || survey.isAnonymous;
    const what = generic ? RESTRICTED_TASK_TITLE : (rule?.title ?? 'A survey alert');
    survey = generic ? { ...survey, title: 'a survey' } : survey;
    const message = !alert.roleId
      ? `"${what}" from "${survey.title}" has no role to go to. Choose who handles it on the survey follow-up list.`
      : !holders.length
        ? `No one has the ${roleName ?? 'chosen'} role, so "${what}" from "${survey.title}" came to you. Give the role to someone, or choose another role for the alert.`
      : alert.unlinked
        ? `${alert.matchCount} answers to "${survey.title}" need action: ${what}. The answers are not linked to anyone.`
        : `${opts.reassigned ? 'Given to your role: ' : ''}${what}. Due ${toIso(alert.dueDate)}.`;
    await this.notifications.notifyUsers({
      recipientUserIds: recipients,
      type: NotificationType.SYSTEM_MESSAGE,
      module: NotificationModule.SYSTEM,
      severity: alert.urgent ? NotificationSeverity.CRITICAL : NotificationSeverity.WARNING,
      title: generic
        ? alert.urgent ? 'Urgent survey alert' : 'Survey alert'
        : alert.urgent ? `Urgent survey alert — ${survey.title}` : `Survey alert — ${survey.title}`,
      message,
      recordType: 'SurveyAlert',
      recordId: alert.id,
      metadata: { href: `/surveys/follow-ups?alert=${alert.id}`, surveyId: survey.id, eventType: 'SURVEY_ALERT_RAISED', roleName },
    });
  }

  /** A failed check is retried at most this many times; then it is reported and left. */
  static readonly MAX_CHECK_FAILURES = 5;

  /** Count a failed check (raw SQL: never moves updatedAt, which is day-only on unlinked rows). */
  private async checkFailed(ids: string[]) {
    if (!ids.length) return;
    await this.prisma.$executeRaw`UPDATE "surveys"."SurveyResponse" SET "alertCheckFailures" = "alertCheckFailures" + 1 WHERE "id" = ANY(${ids}::uuid[])`;
  }

  /**
   * The survey job. Named responses not yet checked, one by one. Answers linked to no one only once
   * their survey (or period) has closed: then all of them together, one alert per rule with counts
   * (see raiseGrouped) — never while it is open, so nobody can be narrowed down from the people
   * whose survey shows Completed since the last alert. Oldest first, failures last; a response that
   * keeps failing is left after MAX_CHECK_FAILURES and reported, so it cannot hold up the rest.
   */
  async sweep(now: Date = new Date()): Promise<{ named: number; grouped: number; failing: number }> {
    const max = SurveyAlertsService.MAX_CHECK_FAILURES;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; surveyId: string; unlinked: boolean }>>`
      SELECT r."id", r."surveyId", (r."isAnonymous" OR (s."isAnonymous" AND r."recipientId" IS NULL)) AS "unlinked"
        FROM "surveys"."SurveyResponse" r JOIN "surveys"."Survey" s ON s."id" = r."surveyId"
       WHERE r."alertsChecked" = false
         AND r."alertCheckFailures" < ${max}
         AND (
           NOT (r."isAnonymous" OR (s."isAnonymous" AND r."recipientId" IS NULL))
           OR s."status" = 'CLOSED' OR s."deletedAt" IS NOT NULL OR (s."closesAt" IS NOT NULL AND s."closesAt" <= ${now})
         )
       ORDER BY r."alertCheckFailures" ASC, r."submittedAt" ASC, r."id" ASC
       LIMIT ${SWEEP_LIMIT}`;
    let named = 0;
    let grouped = 0;
    for (const r of rows.filter((x) => !x.unlinked)) {
      named += await this.checkResponse(r.id).catch(async (e: unknown) => {
        this.logger.warn(`Survey alerts: a response could not be checked (${e instanceof Error ? e.name : 'error'})`);
        await this.checkFailed([r.id]).catch(() => undefined);
        return 0;
      });
    }
    const bySurvey = new Map<string, string[]>();
    for (const r of rows.filter((x) => x.unlinked)) bySurvey.set(r.surveyId, [...(bySurvey.get(r.surveyId) ?? []), r.id]);
    for (const [surveyId, ids] of bySurvey) {
      grouped += await this.raiseGrouped(surveyId).catch(async (e: unknown) => {
        this.logger.warn(`Survey alerts: answers to survey ${surveyId} could not be checked (${e instanceof Error ? e.name : 'error'})`);
        await this.checkFailed(ids).catch(() => undefined);
        return 0;
      });
    }
    const [{ failing }] = await this.prisma.$queryRaw<Array<{ failing: number }>>`
      SELECT COUNT(*)::int AS "failing" FROM "surveys"."SurveyResponse" WHERE "alertsChecked" = false AND "alertCheckFailures" >= ${max}`;
    if (failing > 0) this.logger.error(`Survey alerts: ${failing} response(s) could not be checked after ${max} tries and need attention.`);
    return { named, grouped, failing };
  }

  /**
   * Answers linked to no one, once the survey (or period) has closed: one grouped alert per rule,
   * with counts only — and only when at least the survey's reporting threshold (5 at the least; a
   * rule can ask for more, e.g. 10 for abuse or equality) answered this way in the group checked
   * now. A smaller group (e.g. a few late answers after the survey was reopened) raises nothing.
   */
  private async raiseGrouped(surveyId: string): Promise<number> {
    const survey = await this.prisma.survey.findUnique({ where: { id: surveyId } });
    if (!survey) return 0;
    const closed =
      survey.status === 'CLOSED' || Boolean(survey.deletedAt) || Boolean(survey.closesAt && survey.closesAt.getTime() <= Date.now());
    if (!closed) return 0; // the sweep never passes these; kept as a guard
    const floor = Math.max(MIN_REPORTING_THRESHOLD_UNLINKED, await surveyThreshold(this.prisma, survey));
    const rules = await this.activeRules(survey);
    const questions = await this.questionsOf(survey.id);
    const tz = await this.timeZone();
    const now = new Date();
    const today = operationalTodayIso(now, tz);
    const day = startOfOperationalDayUtc(today, tz);
    const holidays = await this.holidays(today);
    const ctx = await this.ownerRoleMap(survey);
    // A ready-made rule never raises from fewer answers than the library says (e.g. 10 for abuse),
    // even if its own setting was cleared or it was set up before the setting was copied.
    const libraryMinimum = new Map(libraryAlerts(await this.libraryMetaFor(survey)).map((a) => [a.index, libraryMinimumAnswers(a.rule)]));
    const raised: Array<{ alert: AlertRow; roleName: string | null }> = [];

    await this.prisma.$transaction(async (tx) => {
      // Claim them (a racing sweep gets none), then read their answers.
      // Every unchecked answer linked to no one for this survey, not only those the sweep listed,
      // so a large survey is never split into small groups.
      const claimed = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "surveys"."SurveyResponse" SET "alertsChecked" = true
         WHERE "surveyId" = ${surveyId}::uuid AND "alertsChecked" = false
           AND ("isAnonymous" OR (${survey.isAnonymous} AND "recipientId" IS NULL))
         RETURNING "id"`;
      if (!claimed.length) return;
      // Too few answered without a name to say anything without pointing at someone: checked, nothing raised.
      if (claimed.length < floor) return;
      const answers = await tx.surveyAnswer.findMany({
        where: { responseId: { in: claimed.map((c) => c.id) } },
        select: { responseId: true, questionId: true, booleanValue: true, numberValue: true, selectedOptions: true },
      });
      const byResponse = new Map<string, typeof answers>();
      for (const a of answers) byResponse.set(a.responseId, [...(byResponse.get(a.responseId) ?? []), a]);
      for (const rule of rules) {
        if (rule.contactRequest) continue; // never asked of anyone answering without a name
        const libraryFloor = rule.libraryAlert !== null ? (libraryMinimum.get(rule.libraryAlert) ?? 0) : 0;
        if (claimed.length < Math.max(floor, rule.minimumAnswers ?? 0, libraryFloor)) continue;
        const conditions = readConditions(rule.conditions);
        // Never on single CareFlow-list (equality) entries from answers given without a name.
        const lookupKeys = new Set(questions.filter((q) => q.optionsFrom).map((q) => q.key));
        if (flatConditions(conditions).some((c) => lookupKeys.has(c.questionKey))) continue;
        let count = 0;
        const tally = new Map<string, Map<string, number>>();
        for (const c of claimed) {
          const labels = answerLabelsByKey(questions, (byResponse.get(c.id) ?? []).map((a) => ({ ...a, numberValue: a.numberValue == null ? null : Number(a.numberValue) })));
          const matched = matchConditions(conditions, labels);
          if (!matched.length) continue;
          count += 1;
          for (const m of matched) {
            const t = tally.get(m.questionKey) ?? new Map<string, number>();
            if (m.not) t.set(matchedAnswerText(m), (t.get(matchedAnswerText(m)) ?? 0) + 1);
            else for (const a of m.answers) t.set(a, (t.get(a) ?? 0) + 1);
            tally.set(m.questionKey, t);
          }
        }
        if (!count) continue;
        const matchedJson = [...tally].map(([key, t]) => ({
          question: questions.find((q) => q.key === key)?.questionText ?? key,
          answers: [...t.keys()],
          counts: Object.fromEntries(t),
        }));
        const how = survey.isAnonymous ? 'to this anonymous survey' : 'given without a name';
        const details = [
          `${count} ${count === 1 ? 'answer' : 'answers'} ${how} matched this alert:`,
          ...matchedJson.map((m) => `• "${m.question}": ${Object.entries(m.counts).map(([a, n]) => `${a} (${n})`).join(', ')}`),
          '',
          'These answers are not linked to anyone, so nobody can be contacted about them and they must never be traced back to a person. Act on what they tell you about the service as a whole, and look at the survey results for the pattern.',
          '',
          `What to do: ${rule.actionText}`,
        ].join('\n');
        const role = this.resolveRole(rule, ctx);
        const alert = await this.createAlertWithTask(tx, {
          restricted: ctx.restricted,
          survey,
          rule,
          role,
          due: ruleDueDate(today, rule, holidays),
          createdAt: day,
          title: rule.title,
          details,
          matched: matchedJson,
          responseId: null,
          unlinked: true,
          matchCount: count,
          serviceUserId: null,
          employeeId: null,
          // The branch only when the survey is for one branch (which everyone knows anyway).
          locationId: survey.locationIds.length === 1 ? survey.locationIds[0] : null,
        });
        raised.push({ alert, roleName: role?.name ?? null });
      }
    });
    await this.afterRaised(survey, raised);
    return raised.length;
  }

  // ─── Follow-up list ─────────────────────────────────────────────────────

  async listFollowUps(actor: RequestUser, query: ListSurveyFollowUpsQueryDto) {
    const scope = this.orgScope.fromRequestUser(actor);
    const tz = await this.timeZone();
    const today = operationalTodayIso(new Date(), tz);
    const view = query.alertId ? 'all' : (query.view ?? 'open');
    const where: Prisma.SurveyAlertWhereInput = {
      ...(query.alertId ? { id: query.alertId } : {}),
      ...(query.surveyId ? { OR: [{ surveyId: query.surveyId }, { survey: { clonedFromId: query.surveyId } }] } : {}),
      ...(view === 'contact' ? { contactRequest: true } : {}),
      survey: { deletedAt: null },
    };
    // Every open follow-up (no role yet, or its task open), plus the most recent closed ones: a cap
    // over all of them would, once enough were done, hide newly raised alerts.
    const openTaskIds = (
      await this.prisma.roleTask.findMany({
        where: { sourceType: SURVEY_ALERT_TASK_SOURCE, status: { in: OPEN_TASK } },
        select: { id: true },
      })
    ).map((t) => t.id);
    const include = { survey: { select: { id: true, title: true, locationIds: true, isTemplate: true, clonedFromId: true, periodKey: true } } } as const;
    const openRows = await this.prisma.surveyAlert.findMany({
      where: { AND: [where, { OR: [{ roleTaskId: null }, { roleTaskId: { in: openTaskIds } }] }] },
      include,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    const closedRows =
      query.alertId || view === 'done' || view === 'all'
        ? await this.prisma.surveyAlert.findMany({
            where: { AND: [where, { roleTaskId: { not: null } }, { roleTaskId: { notIn: openTaskIds } }] },
            include,
            orderBy: [{ createdAt: 'desc' }],
            take: 500,
          })
        : [];
    const rows = [...openRows, ...closedRows];
    // Survey readers see every follow-up in their branches; anyone else only those given to their roles.
    const readsSurveys = actor.permissions.includes('surveys.read') || actor.permissions.includes('surveys.manage');
    const myRoleIds = readsSurveys ? null : await this.actorRoleIds(actor);
    // Per-survey access: follow-ups from a survey whose results someone may not see are not listed
    // to them at all (not even that an alert was raised), whatever their role.
    const resultsAccess = new Map<string, boolean>();
    for (const sid of unique(rows.map((r) => r.surveyId))) {
      const s = await this.prisma.survey.findUnique({ where: { id: sid }, select: ACCESS_SELECT });
      resultsAccess.set(sid, s ? (await surveyAccessFor(this.prisma, actor, s)).results : false);
    }
    const visible = rows.filter(
      (r) =>
        resultsAccess.get(r.surveyId) === true &&
        surveyVisibleInScope(scope, r.survey) &&
        (scope.locationIds === null || !r.locationId || scope.locationIds.includes(r.locationId)) &&
        (myRoleIds === null || (r.roleId !== null && myRoleIds.includes(r.roleId))),
    );
    const tasks = await this.prisma.roleTask.findMany({
      where: { id: { in: visible.map((r) => r.roleTaskId).filter((x): x is string => !!x) } },
      include: { role: { select: { id: true, name: true } } },
    });
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const items = visible.map((r) => {
      const task = r.roleTaskId ? taskById.get(r.roleTaskId) : undefined;
      const status = task ? task.status : 'NO_ROLE';
      const open = status === 'OPEN' || status === 'IN_PROGRESS' || status === 'NO_ROLE';
      const due = toIso(r.dueDate);
      return { r, task, status, open, due };
    });
    const filtered = items.filter(({ open, due, status }) => {
      if (query.alertId) return true;
      if (view === 'open' || view === 'contact') return view === 'contact' ? true : open;
      if (view === 'overdue') return open && due < today;
      if (view === 'done') return status === 'DONE';
      return status !== 'CANCELLED';
    });
    // Named alerts carry someone's answers: shown in full to the role they were given to and to
    // people who may see the survey's individual responses; to anyone else, the title only.
    const responsesAccess = new Map<string, boolean>();
    for (const sid of unique(filtered.filter((x) => !x.r.unlinked).map((x) => x.r.surveyId))) {
      const s = await this.prisma.survey.findUnique({ where: { id: sid }, select: ACCESS_SELECT });
      responsesAccess.set(sid, s ? (await surveyAccessFor(this.prisma, actor, s)).responses : false);
    }
    const people = await this.namesFor(filtered.map((x) => x.r));
    const myRoles = await this.actorRoleIds(actor);
    const manager = actor.permissions.includes('surveys.manage');
    return {
      message: 'Survey follow-ups',
      data: {
        today,
        counts: {
          open: items.filter((x) => x.open).length,
          overdue: items.filter((x) => x.open && x.due < today).length,
          contact: items.filter((x) => x.open && x.r.contactRequest).length,
        },
        items: filtered.map(({ r, task, status, open, due }) => {
          const full = r.unlinked || responsesAccess.get(r.surveyId) === true || Boolean(r.roleId && myRoles.includes(r.roleId));
          return {
          id: r.id,
          survey: { id: r.survey.id, title: r.survey.title, periodKey: r.survey.periodKey, recurringSurveyId: r.survey.clonedFromId },
          title: full ? r.title : `A follow-up from "${r.survey.title}"`,
          details: full ? r.details : 'The answers behind this follow-up are limited to particular people.',
          matched: full ? r.matched : [],
          detailsRestricted: !full,
          unlinked: r.unlinked,
          matchCount: r.matchCount,
          contactRequest: r.contactRequest,
          urgent: r.urgent,
          person: !full
            ? null
            : r.serviceUserId
            ? { kind: 'SERVICE_USER', id: r.serviceUserId, name: people.get(r.serviceUserId) ?? null }
            : r.employeeId
              ? { kind: 'EMPLOYEE', id: r.employeeId, name: people.get(r.employeeId) ?? null }
              : null,
          responseId: r.unlinked || !full ? null : r.responseId,
          role: task?.role ?? null,
          status,
          dueDate: due,
          dueState: !open ? null : due < today ? 'overdue' : due === today ? 'today' : 'upcoming',
          owner: r.ownerUserId ? { id: r.ownerUserId, name: people.get(r.ownerUserId) ?? null } : null,
          outcomeKind: r.outcomeKind,
          outcome: r.outcome,
          recordKind: r.recordKind,
          linkedRecord: r.linkedRecordType ? { type: r.linkedRecordType, id: r.linkedRecordId, reference: people.get(`ref:${r.linkedRecordId}`) ?? null } : null,
          /** The note left when the task was marked done in My tasks. */
          taskNote: task?.note ?? null,
          completedAt: task?.completedAt?.toISOString() ?? null,
          completedByName: task?.completedById ? (people.get(task.completedById) ?? null) : null,
          /** Grouped (unlinked) alerts: the day only. */
          raisedOn: toIso(r.createdAt),
          /** May update it: a survey manager, or someone in the role it was given to. */
          canAct: manager || Boolean(r.roleId && myRoles.includes(r.roleId)),
          };
        }),
      },
    };
  }

  private async namesFor(rows: AlertRow[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const suIds = unique(rows.map((r) => r.serviceUserId).filter((x): x is string => !!x));
    const empIds = unique(rows.map((r) => r.employeeId).filter((x): x is string => !!x));
    const userIds = unique(rows.map((r) => r.ownerUserId).filter((x): x is string => !!x));
    const taskDone = await this.prisma.roleTask.findMany({
      where: { id: { in: rows.map((r) => r.roleTaskId).filter((x): x is string => !!x) }, completedById: { not: null } },
      select: { completedById: true },
    });
    userIds.push(...taskDone.map((t) => t.completedById!));
    const [sus, emps, users] = await Promise.all([
      suIds.length ? this.prisma.serviceUser.findMany({ where: { id: { in: suIds } }, select: { id: true, firstName: true, lastName: true } }) : [],
      empIds.length ? this.prisma.employeePersonalDetail.findMany({ where: { employeeId: { in: empIds } }, select: { employeeId: true, firstName: true, lastName: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: unique(userIds) } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [],
    ]);
    for (const s of sus) out.set(s.id, `${s.firstName} ${s.lastName}`.trim());
    for (const e of emps) out.set(e.employeeId, `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim());
    for (const u of users) out.set(u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email);
    for (const r of rows) {
      if (!r.linkedRecordId || !r.linkedRecordType) continue;
      const ref = await this.referenceOf(r.linkedRecordType, r.linkedRecordId);
      if (ref) out.set(`ref:${r.linkedRecordId}`, ref);
    }
    return out;
  }

  private async referenceOf(type: string, id: string): Promise<string | null> {
    if (type === 'COMPLAINT' || type === 'COMPLIMENT') return (await this.prisma.feedbackRecord.findUnique({ where: { id }, select: { referenceNumber: true } }))?.referenceNumber ?? null;
    if (type === 'SAFEGUARDING') return (await this.prisma.safeguardingCase.findUnique({ where: { id }, select: { referenceNumber: true } }))?.referenceNumber ?? null;
    if (type === 'INCIDENT') return (await this.prisma.incident.findUnique({ where: { id }, select: { referenceNumber: true } }))?.referenceNumber ?? null;
    return null;
  }

  /** Find a complaint, compliment, safeguarding case or incident by its reference. */
  private async recordByReference(reference: string): Promise<{ type: string; id: string } | null> {
    const ref = reference.trim().toUpperCase();
    const feedback = await this.prisma.feedbackRecord.findFirst({ where: { referenceNumber: ref, deletedAt: null }, select: { id: true, type: true } });
    if (feedback) return { type: feedback.type === 'COMPLAINT' ? 'COMPLAINT' : 'COMPLIMENT', id: feedback.id };
    const sg = await this.prisma.safeguardingCase.findFirst({ where: { referenceNumber: ref, deletedAt: null }, select: { id: true } });
    if (sg) return { type: 'SAFEGUARDING', id: sg.id };
    const inc = await this.prisma.incident.findFirst({ where: { referenceNumber: ref }, select: { id: true } });
    if (inc) return { type: 'INCIDENT', id: inc.id };
    return null;
  }

  /** People who hold the alert's role (owners to choose from). */
  async ownerOptions(actor: RequestUser, alertId: string) {
    const alert = await this.requireAlert(actor, alertId);
    if (!alert.roleId) return { message: 'Owners', data: [] };
    const full = await this.prisma.survey.findUnique({ where: { id: alert.surveyId }, select: ACCESS_SELECT });
    const excluded = full ? (await surveyResultsAudience(this.prisma, full)).excludedUserIds : [];
    const ids = (await this.usersWithRole(alert.roleId, alert.locationId)).filter((id) => !excluded.includes(id));
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, email: true }, orderBy: [{ firstName: 'asc' }] });
    return { message: 'Owners', data: users.map((u) => ({ id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email })) };
  }

  private async requireAlert(actor: RequestUser, alertId: string) {
    const alert = await this.prisma.surveyAlert.findUnique({ where: { id: alertId }, include: { survey: true } });
    const scope = this.orgScope.fromRequestUser(actor);
    const readsSurveys = actor.permissions.includes('surveys.read') || actor.permissions.includes('surveys.manage');
    if (
      !alert ||
      (!readsSurveys && !(alert.roleId && (await this.actorRoleIds(actor)).includes(alert.roleId))) ||
      alert.survey.deletedAt ||
      !surveyVisibleInScope(scope, alert.survey) ||
      (scope.locationIds !== null && alert.locationId && !scope.locationIds.includes(alert.locationId)) ||
      !(await surveyAccessFor(this.prisma, actor, alert.survey)).results
    ) {
      throw new NotFoundException('Survey follow-up not found');
    }
    return alert;
  }

  async updateFollowUp(actor: RequestUser, alertId: string, dto: UpdateSurveyFollowUpDto) {
    const alert = await this.requireAlert(actor, alertId);
    const roleIds = await this.actorRoleIds(actor);
    const mayAct = actor.permissions.includes('surveys.manage') || (alert.roleId !== null && roleIds.includes(alert.roleId));
    if (!mayAct) throw new ForbiddenException('Only the role this follow-up was given to, or a survey manager, can update it.');
    const now = new Date();
    let reassignedTo: string | null = null;
    let reassignCtx: OwnerCtx | null = null;
    const data: Prisma.SurveyAlertUpdateInput = { updatedById: actor.id };
    const changes: Record<string, unknown> = {};

    if (dto.roleId !== undefined && dto.roleId !== alert.roleId) {
      if (!actor.permissions.includes('surveys.manage')) throw new ForbiddenException('Only a survey manager can give a follow-up to another role.');
      const role = await this.prisma.role.findFirst({ where: { id: dto.roleId, deletedAt: null, isActive: true } });
      if (!role) throw new BadRequestException('That role no longer exists');
      const ctx = await this.ownerRoleMap(alert.survey);
      reassignCtx = ctx;
      if (ctx.onlyRoleIds && !ctx.onlyRoleIds.has(role.id)) {
        throw new BadRequestException(`Only some roles may see this survey's answers, and ${role.name} is not one of them. Choose another role.`);
      }
      if (ctx.neverRoleIds.has(role.id)) {
        throw new BadRequestException(`This survey rates the ${role.name} role, so its follow-ups cannot go to them. Choose another role.`);
      }
      data.roleId = role.id;
      changes.roleId = role.id;
      reassignedTo = role.name;
    }
    if (dto.ownerUserId !== undefined) {
      if (dto.ownerUserId) {
        const roleId = (data.roleId as string | undefined) ?? alert.roleId;
        const full = await this.prisma.survey.findUnique({ where: { id: alert.surveyId }, select: ACCESS_SELECT });
        const excluded = full ? (await surveyResultsAudience(this.prisma, full)).excludedUserIds : [];
        const holders = (roleId ? await this.usersWithRole(roleId, alert.locationId) : []).filter((id) => !excluded.includes(id));
        if (!holders.includes(dto.ownerUserId)) throw new BadRequestException('Choose someone who holds the role this follow-up is for.');
      }
      data.ownerUserId = dto.ownerUserId;
      changes.ownerUserId = dto.ownerUserId;
    }
    if (dto.outcomeKind !== undefined) {
      data.outcomeKind = dto.outcomeKind;
      changes.outcomeKind = dto.outcomeKind;
    }
    if (dto.outcome !== undefined) {
      data.outcome = dto.outcome?.trim() || null;
      changes.outcome = data.outcome;
    }
    if (dto.linkedReference !== undefined) {
      if (dto.linkedReference && dto.linkedReference.trim()) {
        const rec = await this.recordByReference(dto.linkedReference);
        if (!rec) throw new BadRequestException(`No complaint, compliment, safeguarding case or incident has the reference ${dto.linkedReference.trim()}.`);
        data.linkedRecordType = rec.type;
        data.linkedRecordId = rec.id;
        changes.linkedRecord = rec;
      } else {
        data.linkedRecordType = null;
        data.linkedRecordId = null;
        changes.linkedRecord = null;
      }
    }
    const finalOutcomeKind = dto.outcomeKind !== undefined ? dto.outcomeKind : alert.outcomeKind;
    if (dto.status === 'DONE' && alert.contactRequest && !finalOutcomeKind) {
      throw new BadRequestException('Say what happened (contacted, could not reach them, or no longer needed) before closing a contact request.');
    }
    if (dto.status === 'DONE' && !alert.contactRequest && !finalOutcomeKind && !(dto.outcome ?? alert.outcome)) {
      throw new BadRequestException('Say what was done before marking this follow-up done.');
    }

    await this.prisma.$transaction(async (tx) => {
      let taskId = alert.roleTaskId;
      const newRoleId = (data.roleId as string | undefined) ?? null;
      if (newRoleId) {
        if (taskId) {
          await tx.roleTask.update({ where: { id: taskId }, data: { roleId: newRoleId } });
        } else {
          taskId = randomUUID();
          await tx.roleTask.create({
            data: {
              id: taskId,
              templateId: null,
              sourceType: SURVEY_ALERT_TASK_SOURCE,
              sourceId: alert.id,
              roleId: newRoleId,
              locationId: alert.locationId,
              ...alertTaskText({
                restricted: (reassignCtx?.restricted ?? true) || alert.unlinked || alert.survey.isAnonymous,
                ruleTitle: alert.ruleId ? ((await tx.surveyAlertRule.findUnique({ where: { id: alert.ruleId }, select: { title: true } }))?.title ?? 'Survey alert') : 'Survey alert',
                surveyTitle: alert.survey.title,
                urgent: alert.urgent,
              }),
              link: `/surveys/follow-ups?alert=${alert.id}`,
              dueDate: alert.dueDate,
            },
          });
          data.roleTaskId = taskId;
        }
      }
      if (dto.status) {
        if (!taskId) throw new BadRequestException('Choose a role for this follow-up first.');
        const task = await tx.roleTask.findUnique({ where: { id: taskId } });
        if (!task || task.status === RoleTaskStatus.CANCELLED) throw new BadRequestException('This follow-up was cancelled');
        await tx.roleTask.update({
          where: { id: taskId },
          data:
            dto.status === 'OPEN'
              ? { status: 'OPEN', startedAt: null, completedAt: null, completedById: null }
              : dto.status === 'IN_PROGRESS'
                ? { status: 'IN_PROGRESS', startedAt: task.startedAt ?? now, completedAt: null, completedById: null }
                : {
                    status: 'DONE',
                    startedAt: task.startedAt ?? now,
                    completedAt: now,
                    completedById: actor.id,
                    note: (dto.outcome ?? alert.outcome)?.trim() || task.note,
                  },
        });
        changes.status = dto.status;
      }
      await tx.surveyAlert.update({ where: { id: alert.id }, data });
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_ALERT_UPDATED,
      recordType: 'SurveyAlert',
      recordId: alert.id,
      // Not the title (it can name the person); the record id leads to the follow-up.
      description: 'Survey follow-up updated',
      oldValues: { ownerUserId: alert.ownerUserId, outcomeKind: alert.outcomeKind, roleId: alert.roleId, linkedRecordId: alert.linkedRecordId },
      newValues: changes as Prisma.InputJsonValue,
      metadata: { surveyId: alert.surveyId },
    });
    // Given to another role: tell that role (without names or answers, like every alert notice).
    if (reassignedTo) {
      const saved = await this.prisma.surveyAlert.findUnique({ where: { id: alert.id } });
      if (saved) {
        await this.notifyAlert(alert.survey, saved, reassignedTo, { reassigned: true }).catch((e: unknown) =>
          this.logger.warn(`Survey follow-up ${alert.id}: notice to the new role failed (${e instanceof Error ? e.name : 'error'})`),
        );
      }
    }
    return { message: 'Follow-up updated', data: { id: alert.id } };
  }

  private async actorRoleIds(actor: RequestUser): Promise<string[]> {
    if (!actor.roles?.length) return [];
    const roles = await this.prisma.role.findMany({ where: { name: { in: actor.roles }, deletedAt: null }, select: { id: true } });
    return roles.map((r) => r.id);
  }

  /** Open follow-ups per survey (Surveys list badge). */
  async openCounts(surveyIds: string[]): Promise<Map<string, number>> {
    if (!surveyIds.length) return new Map();
    const alerts = await this.prisma.surveyAlert.findMany({
      where: { OR: [{ surveyId: { in: surveyIds } }, { survey: { clonedFromId: { in: surveyIds } } }], roleTaskId: { not: null } },
      select: { surveyId: true, roleTaskId: true, survey: { select: { clonedFromId: true } } },
    });
    const open = new Set(
      (await this.prisma.roleTask.findMany({ where: { id: { in: alerts.map((a) => a.roleTaskId!) }, status: { in: OPEN_TASK } }, select: { id: true } })).map((t) => t.id),
    );
    const out = new Map<string, number>();
    for (const a of alerts) {
      if (!open.has(a.roleTaskId!)) continue;
      const id = a.survey.clonedFromId && surveyIds.includes(a.survey.clonedFromId) ? a.survey.clonedFromId : a.surveyId;
      out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  }
}
