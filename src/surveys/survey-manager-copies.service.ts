import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SurveyStatus, SurveyTargetKind, type Survey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { IDENTITY_ROLE } from '../common/org-scope/org-scope.types';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { surveyVisibleInScope } from './survey-scope.util';
import { ACCESS_SELECT, readAccessPolicy, surveyDefaultAccessPolicy, surveyThreshold, withExcludedUsers } from './survey-access';
import { SURVEY_ALERT_OWNERS, SURVEY_ALERT_OWNER_KEYS, roleForOwner, type SurveyAlertOwnerKey } from './survey-alert-rules.util';
import { SurveysService } from './surveys.service';
import {
  MANAGER_TOKEN,
  POOLED_MANAGER_WORDS,
  fillManager,
  fillManagerDeep,
  fillManagerKeysDeep,
  hasManagerToken,
  MANAGER_TOKEN_QUESTION_SELECT,
  MANAGER_TOKEN_RULE_SELECT,
  surveyNamesManager,
  planManagerCopies,
  managerMinTeam,
  managerMinTeamBounds,
  chooseManagerMinTeam,
  minTeamFloorReason,
  type ManagerCopyPlan,
  type ManagerTeam,
} from './survey-manager-copies.util';


const fullName = (p: { firstName?: string | null; lastName?: string | null } | null | undefined) =>
  [p?.firstName?.trim(), p?.lastName?.trim()].filter(Boolean).join(' ');

/**
 * "Make a copy for each manager" (SUR-STF-018 and any staff survey using `{{manager}}`): plans and
 * makes one draft copy per manager, for the staff their staff record names them as supervisor of,
 * plus one pooled copy for smaller teams when it cannot point at anyone (survey-manager-copies.util.ts).
 * Copies are ordinary drafts with chosen staff: they are checked and sent with Send or schedule as
 * usual (which refuses an anonymous survey reaching fewer than 5 people). Company-wide users only:
 * a manager's staff may work in several branches.
 */
@Injectable()
export class SurveyManagerCopiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly audit: AuditLogsService,
    private readonly surveys: SurveysService,
  ) {}

  private async requireSource(actor: RequestUser, surveyId: string): Promise<Survey> {
    const survey = await this.prisma.survey.findFirst({ where: { id: surveyId, deletedAt: null, isCatalogue: false } });
    const scope = this.orgScope.fromRequestUser(actor);
    if (!survey || !surveyVisibleInScope(scope, survey)) throw new NotFoundException('Survey not found');
    if (scope.locationIds !== null) {
      throw new ForbiddenException('A copy for each manager reaches staff in every branch, so only someone with access to all branches can make them.');
    }
    if (survey.targetKind !== SurveyTargetKind.EMPLOYEE) throw new BadRequestException('Copies for each manager are for staff surveys.');
    if (!survey.isTemplate && survey.status !== SurveyStatus.DRAFT) {
      throw new BadRequestException('Make the copies from the template, or from a draft that has not been sent.');
    }
    if (!(await this.usesManagerToken(survey))) {
      throw new BadRequestException(`This survey does not name a manager: put ${MANAGER_TOKEN} where the manager's name goes.`);
    }
    return survey;
  }

  /** Whether the survey names a manager with {{manager}} anywhere (details, questions, answers, section titles, alert rules). */
  async usesManagerToken(survey: Pick<Survey, 'id' | 'title' | 'description' | 'closingMessage' | 'sectionIntros'>): Promise<boolean> {
    const [questions, rules] = await Promise.all([
      this.prisma.surveyQuestion.findMany({ where: { surveyId: survey.id, deletedAt: null }, select: MANAGER_TOKEN_QUESTION_SELECT }),
      this.prisma.surveyAlertRule.findMany({ where: { surveyId: survey.id }, select: MANAGER_TOKEN_RULE_SELECT }),
    ]);
    return surveyNamesManager(survey, questions ?? [], rules ?? []);
  }

  /**
   * Library roles whose own staff are never asked: the ready-made survey's perManagerExclude (the
   * template's details, else the current ready-made survey's), unless chosen in the dialog.
   */
  private async libraryExclude(survey: Survey): Promise<SurveyAlertOwnerKey[]> {
    const v = await this.libraryValue(survey, 'perManagerExclude');
    return Array.isArray(v) ? v.filter((k): k is SurveyAlertOwnerKey => (SURVEY_ALERT_OWNER_KEYS as readonly unknown[]).includes(k)) : [];
  }

  /**
   * The fewest staff a manager's own copy (and the pooled copy) goes to: the ready-made survey's
   * perManagerMinTeam (the template's details, else the current ready-made survey's), else 5.
   */
  private async libraryMinTeam(survey: Survey): Promise<number> {
    return managerMinTeam({ perManagerMinTeam: await this.libraryValue(survey, 'perManagerMinTeam') });
  }

  /**
   * The minimum team for these copies: `chosen` in the dialog (whole number, at least the survey's
   * reporting threshold for results and 5, at most 50), else the library default raised to that floor.
   */
  private async minTeamFor(survey: Survey, chosen?: number) {
    const [libraryDefault, threshold] = await Promise.all([this.libraryMinTeam(survey), surveyThreshold(this.prisma, survey)]);
    const bounds = managerMinTeamBounds(threshold);
    const defaultMinTeam = Math.min(bounds.max, Math.max(bounds.min, libraryDefault));
    const pick = chooseManagerMinTeam(libraryDefault, bounds, chosen);
    if (!pick.ok) throw new BadRequestException(pick.message);
    return { minTeam: pick.minTeam, defaultMinTeam, bounds };
  }

  /** A ready-made survey setting: the survey's own details, else the current ready-made survey's. */
  private async libraryValue(survey: Survey, key: 'perManagerExclude' | 'perManagerMinTeam'): Promise<unknown> {
    const read = (meta: unknown) =>
      meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>)[key] : undefined;
    const own = read(survey.libraryMeta);
    if (own !== undefined && own !== null) return own;
    if (!survey.libraryReference) return undefined;
    const catalogue = await this.prisma.survey.findFirst({
      where: { isCatalogue: true, libraryReference: survey.libraryReference, deletedAt: null },
      select: { libraryMeta: true },
    });
    return read(catalogue?.libraryMeta);
  }

  private async excludeFor(survey: Survey, chosen?: string[]): Promise<SurveyAlertOwnerKey[]> {
    if (chosen === undefined) return this.libraryExclude(survey);
    const unknown = chosen.find((k) => !(SURVEY_ALERT_OWNER_KEYS as readonly string[]).includes(k));
    if (unknown) throw new BadRequestException(`Unknown role "${unknown}"`);
    return [...new Set(chosen)] as SurveyAlertOwnerKey[];
  }

  /** Organisation role id → the library role label it stands for (through the who-handles-alerts mapping). */
  private async excludedRoles(keys: readonly SurveyAlertOwnerKey[]): Promise<Map<string, string>> {
    return (await this.resolveExcluded(keys)).byRoleId;
  }

  /**
   * Each excluded library role resolved to the organisation's role; `notFound` = the labels of those
   * no role stands for (no "who handles alerts" setting and no role with its usual name). Their
   * managers cannot be told apart, so they would get a copy: the dialog says so.
   */
  private async resolveExcluded(keys: readonly SurveyAlertOwnerKey[]): Promise<{ byRoleId: Map<string, string>; notFound: string[] }> {
    if (!keys.length) return { byRoleId: new Map(), notFound: [] };
    const [roles, settings] = await Promise.all([
      this.prisma.role.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true } }),
      this.prisma.surveyAlertOwnerRole.findMany({ where: { ownerKey: { in: [...keys] } } }),
    ]);
    const byRoleId = new Map<string, string>();
    const notFound: string[] = [];
    for (const k of keys) {
      const set = settings.find((s) => s.ownerKey === k)?.roleId;
      const id = (set && roles.some((r) => r.id === set) ? set : null) ?? roleForOwner(k, roles)?.id;
      if (!id) notFound.push(SURVEY_ALERT_OWNERS[k].label);
      else if (!byRoleId.has(id)) byRoleId.set(id, SURVEY_ALERT_OWNERS[k].label);
    }
    return { byRoleId, notFound };
  }

  /** Managers (named supervisors) and their active staff, with when each was named and who holds survey access. */
  private async teams(exclude: readonly SurveyAlertOwnerKey[] = []): Promise<ManagerTeam[]> {
    const employments = await this.prisma.employeeEmployment.findMany({
      where: { supervisorUserId: { not: null }, employee: { deletedAt: null, isActive: true } },
      select: {
        employeeId: true,
        supervisorUserId: true,
        employee: { select: { personalDetail: { select: { firstName: true, lastName: true } } } },
      },
    });
    const managerIds = [...new Set(employments.map((e) => e.supervisorUserId!))];
    if (!managerIds.length) return [];
    const [managers, roles, assigned, excluded] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: managerIds }, deletedAt: null, isActive: true },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
      this.prisma.userRole.findMany({
        where: { userId: { in: managerIds } },
        select: {
          userId: true,
          roleId: true,
          role: { select: { name: true, rolePermissions: { select: { permission: { select: { key: true } } } } } },
        },
      }),
      // When each staff record last named its supervisor (the supervision audit trail).
      this.prisma.auditLog.findMany({
        where: { action: AuditAction.SUPERVISION_SUPERVISOR_ASSIGNED, recordType: 'Employee', recordId: { in: employments.map((e) => e.employeeId) } },
        orderBy: { createdAt: 'desc' },
        select: { recordId: true, metadata: true, createdAt: true },
      }),
      this.excludedRoles(exclude),
    ]);
    const latest = new Map<string, { to: unknown; at: Date }>();
    for (const a of assigned) {
      if (a.recordId && !latest.has(a.recordId)) {
        const m = a.metadata && typeof a.metadata === 'object' && !Array.isArray(a.metadata) ? (a.metadata as Record<string, unknown>) : {};
        latest.set(a.recordId, { to: m.to, at: a.createdAt });
      }
    }
    // Each copy leaves out the manager it rates (accessPolicy.excludeUserIds), so only an admin, who
    // always keeps access, could see the answers to their own copy.
    const access = new Set(
      roles.filter((r) => r.role.name === IDENTITY_ROLE.SUPER_ADMIN || r.role.name === IDENTITY_ROLE.ADMIN).map((r) => r.userId),
    );
    return managers.map((m) => ({
      managerUserId: m.id,
      managerName: fullName(m) || m.email,
      holdsSurveyAccess: access.has(m.id),
      excludedAs: roles.filter((r) => r.userId === m.id).map((r) => excluded.get(r.roleId)).find(Boolean) ?? null,
      staff: employments
        .filter((e) => e.supervisorUserId === m.id)
        .map((e) => {
          const last = latest.get(e.employeeId);
          return {
            employeeId: e.employeeId,
            name: fullName(e.employee.personalDetail) || 'A member of staff',
            // Named before the trail began (or by a change that did not record it): not known, kept.
            namedSince: last && last.to === m.id ? last.at : null,
          };
        }),
    }));
  }

  /**
   * `exclude`: library roles whose own staff are not asked (omitted = the ready-made survey's).
   * `minTeam`: the smallest team that gets its own copy (omitted = the ready-made survey's).
   */
  async plan(actor: RequestUser, surveyId: string, exclude?: string[], chosenMinTeam?: number) {
    const survey = await this.requireSource(actor, surveyId);
    const keys = await this.excludeFor(survey, exclude);
    const { minTeam, defaultMinTeam, bounds } = await this.minTeamFor(survey, chosenMinTeam);
    const plan = planManagerCopies(await this.teams(keys), new Date(), minTeam);
    return {
      message: 'Copies for each manager',
      data: {
        surveyId: survey.id,
        title: survey.title,
        isAnonymous: survey.isAnonymous,
        /** Roles whose own staff are left out now, and the ready-made survey's default. */
        exclude: keys,
        /** Left-out roles no organisation role stands for: their managers cannot be found, so they get a copy. */
        excludeNotFound: (await this.resolveExcluded(keys)).notFound,
        libraryExclude: await this.libraryExclude(survey),
        /** The fewest staff a manager's own copy (and the smaller-teams copy) goes to. */
        minTeam,
        /** The ready-made survey's minimum team (raised to the floor); what the dialog starts at. */
        defaultMinTeam,
        /** The range it may be set to: the floor is the reporting threshold for results, never below 5. */
        minTeamMin: bounds.min,
        minTeamMax: bounds.max,
        minTeamFloorReason: minTeamFloorReason(bounds.min),
        owners: SURVEY_ALERT_OWNER_KEYS.map((key) => ({ key, label: SURVEY_ALERT_OWNERS[key].label })),
        ...plan,
      },
    };
  }

  /**
   * Make the copies as drafts (one per manager, and the pooled smaller-teams copy). With managers who
   * hold survey access, `confirmAccess` must say the person making them has dealt with it.
   */
  async create(
    actor: RequestUser,
    surveyId: string,
    dto: { label?: string; confirmAccess?: boolean; exclude?: string[]; minTeam?: number },
    meta?: RequestAuditMeta,
  ) {
    const source = await this.requireSource(actor, surveyId);
    const exclude = await this.excludeFor(source, dto.exclude);
    const { minTeam, defaultMinTeam } = await this.minTeamFor(source, dto.minTeam);
    const plan: ManagerCopyPlan = planManagerCopies(await this.teams(exclude), new Date(), minTeam);
    if (!plan.copies.length && !plan.pooled) {
      throw new BadRequestException('No manager has enough staff named under them for a copy.');
    }
    if (plan.accessWarnings.length && dto.confirmAccess !== true) {
      throw new BadRequestException(
        `${plan.accessWarnings.join(', ')} ${plan.accessWarnings.length === 1 ? 'is an admin' : 'are admins'}, so they would still see the answers to their own copy. Take away their admin role while their copy is open (or leave them out this year), then confirm.`,
      );
    }
    const label = dto.label?.trim();
    const titleFor = (name: string) => {
      const base = source.title.includes(MANAGER_TOKEN) ? fillManager(source.title, name) : `${source.title}: ${name}`;
      return (label ? `${base}, ${label}` : base).slice(0, 200);
    };
    const created: Array<{ surveyId: string; title: string; managerNames: string[]; people: number }> = [];
    const make = async (title: string, words: string, employeeIds: string[], managerNames: string[], ratedUserIds: string[], pooled = false) => {
      const copy = await this.surveys.duplicate(actor, source.id, { title }, meta);
      await this.fillCopy(copy.data.id, words, employeeIds, ratedUserIds, { pooled, minTeam });
      created.push({ surveyId: copy.data.id, title, managerNames, people: employeeIds.length });
    };
    for (const c of plan.copies) await make(titleFor(c.managerName), c.managerName, c.employeeIds, [c.managerName], [c.managerUserId]);
    if (plan.pooled) {
      await make(titleFor('smaller teams'), POOLED_MANAGER_WORDS, plan.pooled.employeeIds, plan.pooled.managerNames, plan.pooled.managerUserIds, true);
    }
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_MANAGER_COPIES_CREATED,
      recordType: 'Survey',
      recordId: source.id,
      description: `${created.length} cop${created.length === 1 ? 'y' : 'ies'} of "${source.title}" made, one for each manager`,
      // Who each copy is about and how many it reaches; never anything anyone answered.
      metadata: {
        copies: created.map((c) => ({ surveyId: c.surveyId, managers: c.managerNames, people: c.people })),
        notSent: plan.notSent,
        excludedRoles: exclude,
        excludedRolesNotFound: (await this.resolveExcluded(exclude)).notFound,
        minTeam,
        minTeamChanged: minTeam !== defaultMinTeam,
        accessConfirmed: plan.accessWarnings.length ? plan.accessWarnings : undefined,
      },
      // The smallest team that gets its own copy: the ready-made survey's, and what was used.
      oldValues: { minTeam: defaultMinTeam },
      newValues: { minTeam },
      ...meta,
    });
    return {
      message: `${created.length} draft cop${created.length === 1 ? 'y' : 'ies'} made. Check each one, then send it.`,
      data: { created, notSent: plan.notSent },
    };
  }

  /**
   * The manager's name (or "your line manager") everywhere the copy says {{manager}}: details,
   * section introductions (titles and text), questions, answers, section titles, and its alert rules
   * (the answers they check are filled the same way, so they still match). Only the chosen staff; and
   * the managers it rates never see it (accessPolicy.excludeUserIds), whatever their role.
   */
  /**
   * `copy`: whether it is the pooled smaller-teams copy, and the fewest staff it may go to. Kept on
   * the copy (Survey.managerCopy) so its team is checked again when it is sent or opened.
   */
  private async fillCopy(surveyId: string, words: string, employeeIds: string[], ratedUserIds: string[], copy: { pooled: boolean; minTeam: number }) {
    const [survey, questions, rules] = await Promise.all([
      this.prisma.survey.findUniqueOrThrow({
        where: { id: surveyId },
        select: { ...ACCESS_SELECT, description: true, closingMessage: true, sectionIntros: true },
      }),
      this.prisma.surveyQuestion.findMany({ where: { surveyId, deletedAt: null }, select: MANAGER_TOKEN_QUESTION_SELECT }),
      this.prisma.surveyAlertRule.findMany({ where: { surveyId }, select: MANAGER_TOKEN_RULE_SELECT }),
    ]);
    const json = (v: Prisma.JsonValue) => (v === null ? Prisma.JsonNull : (fillManagerDeep(v, words) as Prisma.InputJsonValue));
    const named = (v: unknown) => hasManagerToken([JSON.stringify(v ?? null)]);
    // The access in force (its own, else the ready-made default), with the rated managers left out.
    const policy = withExcludedUsers(
      readAccessPolicy(survey.accessPolicy) ?? (await surveyDefaultAccessPolicy(this.prisma, survey)),
      ratedUserIds,
    );
    await this.prisma.$transaction([
      this.prisma.survey.update({
        where: { id: surveyId },
        data: {
          description: survey.description === null ? null : fillManager(survey.description, words),
          closingMessage: survey.closingMessage === null ? null : fillManager(survey.closingMessage, words),
          sectionIntros:
            survey.sectionIntros === null ? Prisma.JsonNull : (fillManagerKeysDeep(survey.sectionIntros, words) as Prisma.InputJsonValue),
          accessPolicy: policy as unknown as Prisma.InputJsonValue,
          audienceEmployeeIds: employeeIds,
          managerCopy: { managerUserIds: ratedUserIds, pooled: copy.pooled, minTeam: copy.minTeam },
          locationIds: [],
          roleIds: [],
        },
      }),
      ...(questions ?? []).filter(named).map((q) =>
        this.prisma.surveyQuestion.update({
          where: { id: q.id },
          data: {
            questionText: fillManager(q.questionText, words),
            helpText: q.helpText === null ? null : fillManager(q.helpText, words),
            sectionTitle: q.sectionTitle === null ? null : fillManager(q.sectionTitle, words),
            options: json(q.options),
            config: json(q.config),
            exclusiveOptions: json(q.exclusiveOptions),
            commentConfig: json(q.commentConfig),
            otherOption: json(q.otherOption),
          },
        }),
      ),
      ...(rules ?? []).filter(named).map((r) =>
        this.prisma.surveyAlertRule.update({
          where: { id: r.id },
          data: {
            title: fillManager(r.title, words),
            whenText: fillManager(r.whenText, words),
            actionText: fillManager(r.actionText, words),
            conditions: json(r.conditions),
          },
        }),
      ),
    ]);
  }
}
