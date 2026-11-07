import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Survey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { surveyVisibleInScope } from './survey-scope.util';
import { SURVEY_ALERT_OWNERS, SURVEY_ALERT_OWNER_KEYS } from './survey-alert-rules.util';
import { SurveyAlertsService } from './survey-alerts.service';
import {
  MAX_REPORTING_THRESHOLD,
  describeLevel,
  levelRoleIds,
  libraryAccess,
  minimumThreshold,
  readAccessPolicy,
  surveyAccessFor,
  withExcludedUsers,
  type AccessLevelSpec,
  type SurveyAccessPolicy,
} from './survey-access';
import type { AccessLevelDto, UpdateSurveyAccessDto } from './dto/survey-access.dto';
import { effectiveLibraryMeta } from './survey-library-variant.util';

const unique = <T>(v: T[]) => [...new Set(v)];

/** Settings → who may see a survey's answers and results, and its reporting threshold. */
@Injectable()
export class SurveyAccessService {
  /**
   * A results file was downloaded (the admin builds the CSV from figures the user can already see,
   * and calls this first: no audit row, no download). Needs access to the results.
   */
  async recordExport(
    actor: RequestUser,
    surveyId: string,
    input: { kind: 'RESULTS_CSV'; period?: string | null; respondentGroup?: string | null },
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.prisma.survey.findFirst({ where: { id: surveyId, deletedAt: null, isCatalogue: false } });
    if (!survey || !surveyVisibleInScope(this.orgScope.fromRequestUser(actor), survey)) throw new NotFoundException('Survey not found');
    if (!(await surveyAccessFor(this.prisma, actor, survey)).results) {
      throw new ForbiddenException('The results of this survey are limited to particular people.');
    }
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_RESULTS_EXPORTED,
      recordType: 'Survey',
      recordId: surveyId,
      description: `Results of survey "${survey.title}" downloaded as a CSV file`,
      newValues: {
        kind: input.kind,
        ...(input.period ? { period: input.period.slice(0, 200) } : {}),
        ...(input.respondentGroup ? { respondentGroup: input.respondentGroup.slice(0, 200) } : {}),
      },
      ...meta,
    });
    return { message: 'Noted', data: { surveyId } };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
    private readonly alerts: SurveyAlertsService,
  ) {}

  /** Alert rules whose role could not see the results under this access (they would be rerouted). */
  private async rulesOutside(survey: Survey, policy: SurveyAccessPolicy | null) {
    const effective = policy ?? libraryAccess(await this.libraryMetaOf(survey)).policy;
    if (!effective?.results.restricted) return [];
    const roleIds = new Set([...(await levelRoleIds(this.prisma, effective.results)), ...(await levelRoleIds(this.prisma, effective.responses))]);
    return this.alerts.rulesOutsideResults(survey.id, roleIds);
  }

  private async libraryMetaOf(survey: Survey) {
    if (!survey.libraryReference) return effectiveLibraryMeta(survey.libraryMeta, survey.isAnonymous);
    const cat = await this.prisma.survey.findFirst({ where: { isCatalogue: true, libraryReference: survey.libraryReference, deletedAt: null }, select: { libraryMeta: true } });
    return effectiveLibraryMeta(cat?.libraryMeta ?? survey.libraryMeta, survey.isAnonymous);
  }

  private async requireSurvey(actor: RequestUser, id: string): Promise<Survey> {
    const row = await this.prisma.survey.findFirst({ where: { id, deletedAt: null, isCatalogue: false } });
    if (!row || !surveyVisibleInScope(this.orgScope.fromRequestUser(actor), row)) throw new NotFoundException('Survey not found');
    return row;
  }

  async get(actor: RequestUser, surveyId: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    const access = await surveyAccessFor(this.prisma, actor, survey);
    const owner = access.ownSurveyId === survey.id ? survey : await this.prisma.survey.findUnique({ where: { id: access.ownSurveyId } });
    const catalogue = owner?.libraryReference
      ? await this.prisma.survey.findFirst({ where: { isCatalogue: true, libraryReference: owner.libraryReference, deletedAt: null }, select: { libraryMeta: true } })
      : null;
    const lib = libraryAccess(effectiveLibraryMeta(catalogue?.libraryMeta ?? owner?.libraryMeta ?? null, owner?.isAnonymous ?? false));
    return {
      message: 'Survey access',
      data: {
        surveyId: access.ownSurveyId,
        editedOnSurveyId: access.ownSurveyId !== survey.id ? access.ownSurveyId : null,
        source: access.source,
        canConfigure: access.configure && actor.permissions.includes('surveys.manage'),
        you: { results: access.results, responses: access.responses },
        responses: { ...access.policy.responses, ...(await describeLevel(this.prisma, access.policy.responses)) },
        results: { ...access.policy.results, ...(await describeLevel(this.prisma, access.policy.results)) },
        reportingThreshold: {
          inForce: access.threshold,
          own: owner?.reportingThreshold ?? null,
          readyMade: lib.threshold,
          minimum: owner ? minimumThreshold(owner) : 1,
          maximum: MAX_REPORTING_THRESHOLD,
        },
        readyMadeDefault: lib.policy
          ? {
              responses: lib.policy.responses.ownerKeys.map((k) => SURVEY_ALERT_OWNERS[k as keyof typeof SURVEY_ALERT_OWNERS]?.label ?? k),
              results: lib.policy.results.ownerKeys.map((k) => SURVEY_ALERT_OWNERS[k as keyof typeof SURVEY_ALERT_OWNERS]?.label ?? k),
            }
          : null,
        owners: SURVEY_ALERT_OWNER_KEYS.map((key) => ({ key, label: SURVEY_ALERT_OWNERS[key].label })),
        roles: await this.prisma.role.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        /** Always keep access, whatever is chosen: they set it. */
        alwaysIncluded: 'Super Admin, Admin and the person who made the survey',
        /** Never see it, whatever their role (the manager a "Feedback on your manager" copy rates). */
        excludedPeople: access.policy.excludeUserIds?.length
          ? (await describeLevel(this.prisma, { restricted: true, ownerKeys: [], roleIds: [], userIds: access.policy.excludeUserIds })).people
          : [],
      },
    };
  }

  /** Office users to name (search by name or email). */
  async people(actor: RequestUser, surveyId: string, search?: string) {
    await this.requireSurvey(actor, surveyId);
    const term = search?.trim();
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(term
          ? { OR: [{ firstName: { contains: term, mode: 'insensitive' } }, { lastName: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }] }
          : {}),
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 25,
    });
    return { message: 'People', data: users.map((u) => ({ id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email, email: u.email })) };
  }

  private async level(dto: AccessLevelDto): Promise<AccessLevelSpec> {
    const ownerKeys = unique(dto.ownerKeys ?? []).filter((k) => (SURVEY_ALERT_OWNER_KEYS as string[]).includes(k));
    const roleIds = unique(dto.roleIds ?? []);
    const userIds = unique(dto.userIds ?? []);
    if (roleIds.length && (await this.prisma.role.count({ where: { id: { in: roleIds }, deletedAt: null } })) !== roleIds.length) {
      throw new BadRequestException('Some of the chosen roles no longer exist');
    }
    if (userIds.length && (await this.prisma.user.count({ where: { id: { in: userIds }, deletedAt: null } })) !== userIds.length) {
      throw new BadRequestException('Some of the chosen people no longer exist');
    }
    return dto.restricted ? { restricted: true, ownerKeys, roleIds, userIds } : { restricted: false, ownerKeys: [], roleIds: [], userIds: [] };
  }

  async update(actor: RequestUser, surveyId: string, dto: UpdateSurveyAccessDto, meta?: RequestAuditMeta) {
    const survey = await this.requireSurvey(actor, surveyId);
    if (survey.clonedFromId) throw new BadRequestException('This is one period of a repeating survey: change who can see it on the repeating survey.');
    const access = await surveyAccessFor(this.prisma, actor, survey);
    if (!access.configure) {
      throw new ForbiddenException('Only an admin or the person who made this survey can change who can see its answers.');
    }
    let policy: SurveyAccessPolicy | null = null;
    if (!dto.useReadyMadeDefault) {
      const responses = await this.level(dto.responses);
      let results = await this.level(dto.results);
      // Whoever may see individual answers may see the figures; and restricting the figures
      // restricts individual answers at least as much.
      if (results.restricted) {
        results = {
          ...results,
          ownerKeys: unique([...results.ownerKeys, ...responses.ownerKeys]),
          roleIds: unique([...results.roleIds, ...responses.roleIds]),
          userIds: unique([...results.userIds, ...responses.userIds]),
        };
      }
      policy = { responses: !responses.restricted && results.restricted ? { ...results } : responses, results };
    }
    // People this survey is about (a manager's copy) stay excluded whatever else is chosen; with the
    // ready-made default, its levels are stored so the exclusion can be kept.
    const excluded = readAccessPolicy(survey.accessPolicy)?.excludeUserIds ?? [];
    if (excluded.length) {
      policy = withExcludedUsers(
        policy ?? libraryAccess(await this.libraryMetaOf(survey)).policy,
        excluded,
      );
    }
    const min = minimumThreshold(survey);
    const threshold = dto.reportingThreshold ?? null;
    if (threshold !== null && (threshold < min || threshold > MAX_REPORTING_THRESHOLD)) {
      throw new BadRequestException(
        min > 1
          ? `Answers to this survey can be given without a name, so results need at least ${min} answers before they show (up to ${MAX_REPORTING_THRESHOLD}).`
          : `Choose a number from 1 to ${MAX_REPORTING_THRESHOLD}, or leave it empty.`,
      );
    }
    // Alert rules this access would leave without a role that can see the results: shown first
    // (dryRun) so the person can fix them, and returned with the save.
    const affectedRules = await this.rulesOutside(survey, policy);
    if (dto.dryRun) return { message: 'Check only: nothing saved', data: { affectedRules } };
    const before = { accessPolicy: readAccessPolicy(survey.accessPolicy), reportingThreshold: survey.reportingThreshold };
    if (threshold !== survey.reportingThreshold) {
      // A new threshold changes what the figures show (and CQC evidence made from them): a real
      // change to the survey, so updatedAt moves and kept evidence is captured again.
      await this.prisma.survey.update({
        where: { id: surveyId },
        data: {
          accessPolicy: policy ? (policy as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          reportingThreshold: threshold,
          updatedById: actor.id,
        },
      });
    } else {
      // Only who may see it changed: the figures are the same, so updatedAt (which dates CQC
      // evidence and would trigger a needless re-capture) is left alone. Raw SQL for that reason.
      const json = policy ? JSON.stringify(policy) : null;
      await this.prisma.$executeRaw`UPDATE "surveys"."Survey" SET "accessPolicy" = ${json}::jsonb, "updatedById" = ${actor.id}::uuid WHERE "id" = ${surveyId}::uuid`;
    }
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_ACCESS_UPDATED,
      recordType: 'Survey',
      recordId: surveyId,
      description: `Who can see the answers to "${survey.title}" changed`,
      oldValues: before as unknown as Prisma.InputJsonValue,
      newValues: { accessPolicy: policy, reportingThreshold: threshold, useReadyMadeDefault: Boolean(dto.useReadyMadeDefault) } as unknown as Prisma.InputJsonValue,
      ...meta,
    });
    const saved = await this.get(actor, surveyId);
    return { ...saved, data: { ...saved.data, affectedRules } };
  }
}
