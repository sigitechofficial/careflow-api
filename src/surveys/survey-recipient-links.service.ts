import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SurveyRecipientStatus, SurveyStatus, SurveyTargetKind, type Survey } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { surveyVisibleInScope } from './survey-scope.util';
import { surveyAccessFor } from './survey-access';

/** Why copying a link is used (kept in the audit row). */
export type RecipientLinkPurpose = 'ONE' | 'ALL' | 'CSV';

/** The path of a person's own survey link (the admin app adds its address). */
export const personalLinkPath = (token: string) => `/survey/${token}`;

/**
 * Said when personal links are asked for on an anonymous survey. Whoever holds a person's own link
 * can open it and see whether they have answered, which an anonymous survey never shows.
 */
export const ANONYMOUS_PERSONAL_LINKS_REFUSED =
  'Personal links are never shown on an anonymous survey: anyone holding a person’s link could see whether they have answered. Use Send to remind everyone, or turn on the shared link.';

/**
 * People's own survey links on a named staff or service-user survey: copy one, copy them all, or
 * download them for a mail merge (each audited as survey_links_copied), and make a new link for one
 * person (the old one stops working; survey_link_renewed). Managers only (surveys.manage). Never on
 * anonymous surveys, and whether each person has answered only for people who may see the
 * survey's individual responses.
 */
@Injectable()
export class SurveyRecipientLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  private async requireNamedSurvey(actor: RequestUser, id: string): Promise<Survey> {
    const survey = await this.prisma.survey.findFirst({ where: { id, deletedAt: null, isCatalogue: false } });
    if (!survey || !surveyVisibleInScope(this.orgScope.fromRequestUser(actor), survey)) throw new NotFoundException('Survey not found');
    if (survey.isTemplate) throw new BadRequestException('Templates have no links. Start a survey from the template first.');
    if (survey.targetKind === SurveyTargetKind.PUBLIC) {
      throw new BadRequestException('Public surveys have no personal links. Use the shared link.');
    }
    if (survey.isAnonymous) throw new BadRequestException(ANONYMOUS_PERSONAL_LINKS_REFUSED);
    return survey;
  }

  async copyLinks(
    actor: RequestUser,
    surveyId: string,
    opts: { recipientIds?: string[]; onlyNotAnswered?: boolean; purpose: RecipientLinkPurpose },
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.requireNamedSurvey(actor, surveyId);
    if (survey.status !== SurveyStatus.ACTIVE) {
      throw new BadRequestException('This survey is not open for answers, so its links would not work.');
    }
    if (opts.purpose === 'ONE' && opts.recipientIds?.length !== 1) throw new BadRequestException('Choose one person.');
    // Who has answered is part of the individual responses (see listRecipients).
    const access = await surveyAccessFor(this.prisma, actor, survey);
    if (opts.onlyNotAnswered && !access.responses) {
      throw new ForbiddenException('Only people who can see this survey’s individual responses can see who has answered.');
    }
    const rows = await this.prisma.surveyRecipient.findMany({
      where: {
        surveyId,
        ...(opts.recipientIds?.length ? { id: { in: opts.recipientIds } } : {}),
        ...(opts.onlyNotAnswered ? { status: { not: SurveyRecipientStatus.COMPLETED } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, token: true, status: true, employeeId: true, serviceUserId: true },
    });
    if (opts.recipientIds?.length && rows.length !== opts.recipientIds.length && !opts.onlyNotAnswered) {
      throw new NotFoundException('Person not found on this survey');
    }
    const names = await this.names(rows);
    const links = rows
      .map((r) => ({
        recipientId: r.id,
        name: names.get((r.employeeId ?? r.serviceUserId)!) ?? (r.employeeId ? 'Employee' : 'Person we support'),
        kind: r.employeeId ? SurveyTargetKind.EMPLOYEE : SurveyTargetKind.SERVICE_USER,
        path: personalLinkPath(r.token),
        /** Null when this user may not see who has answered. */
        answered: access.responses ? r.status === SurveyRecipientStatus.COMPLETED : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_LINKS_COPIED,
      recordType: 'Survey',
      recordId: surveyId,
      description: `${links.length} personal ${links.length === 1 ? 'link' : 'links'} ${opts.purpose === 'CSV' ? 'downloaded for a mail merge' : 'copied'} for survey "${survey.title}"`,
      metadata: { surveyId },
      // Never the links themselves.
      newValues: {
        purpose: opts.purpose,
        count: links.length,
        ...(opts.onlyNotAnswered ? { onlyNotAnswered: true } : {}),
        ...(opts.purpose === 'ONE' ? { recipientId: links[0]?.recipientId ?? null } : {}),
      },
      ...meta,
    });
    return { message: 'Personal links', data: { links } };
  }

  /** A new link for one person: the old one stops working at once (e.g. it was sent to the wrong person). */
  async renewLink(actor: RequestUser, surveyId: string, recipientId: string, meta?: RequestAuditMeta) {
    const survey = await this.requireNamedSurvey(actor, surveyId);
    const recipient = await this.prisma.surveyRecipient.findFirst({
      where: { id: recipientId, surveyId },
      select: { id: true, status: true, employeeId: true, serviceUserId: true },
    });
    if (!recipient) throw new NotFoundException('Person not found on this survey');
    if (recipient.status === SurveyRecipientStatus.COMPLETED) {
      throw new BadRequestException('They have already answered, so they do not need a new link.');
    }
    const updated = await this.prisma.surveyRecipient.update({
      where: { id: recipient.id },
      data: { token: randomUUID() },
      select: { token: true },
    });
    const name = (await this.names([recipient])).get((recipient.employeeId ?? recipient.serviceUserId)!) ?? null;
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_LINK_RENEWED,
      recordType: 'SurveyRecipient',
      recordId: recipient.id,
      description: `New personal link made${name ? ` for ${name}` : ''} on survey "${survey.title}"; the old link no longer works`,
      newValues: { surveyId, link: 'person' },
      metadata: { surveyId },
      ...meta,
    });
    return { message: 'New link made. The old link no longer works.', data: { recipientId: recipient.id, path: personalLinkPath(updated.token) } };
  }

  /**
   * Who copied people's own links, or made a new one, and when (and how many): from the audit trail,
   * never the links. For managers who may see the survey's individual responses.
   */
  async history(actor: RequestUser, surveyId: string) {
    const survey = await this.requireNamedSurvey(actor, surveyId);
    if (!(await surveyAccessFor(this.prisma, actor, survey)).responses) {
      throw new ForbiddenException('Only people who can see this survey\u2019s individual responses can see who copied its links.');
    }
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: { in: [AuditAction.SURVEY_LINKS_COPIED, AuditAction.SURVEY_LINK_RENEWED] },
        metadata: { path: ['surveyId'], equals: surveyId },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { action: true, createdAt: true, userId: true, newValues: true },
    });
    const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => Boolean(x)))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]));
    return {
      message: 'Links copied',
      data: rows.map((r) => {
        const v = (r.newValues ?? {}) as Record<string, unknown>;
        const renewed = r.action === AuditAction.SURVEY_LINK_RENEWED;
        return {
          at: r.createdAt.toISOString(),
          by: r.userId ? (nameOf.get(r.userId) ?? 'Someone') : 'Someone',
          what: renewed ? 'NEW_LINK' : v.purpose === 'CSV' ? 'MAIL_MERGE' : v.purpose === 'ONE' ? 'ONE' : 'ALL',
          count: renewed ? 1 : typeof v.count === 'number' ? v.count : 0,
        };
      }),
    };
  }

  private async names(rows: Array<{ employeeId: string | null; serviceUserId: string | null }>): Promise<Map<string, string>> {
    const employeeIds = rows.map((r) => r.employeeId).filter((x): x is string => Boolean(x));
    const serviceUserIds = rows.map((r) => r.serviceUserId).filter((x): x is string => Boolean(x));
    const [employees, people] = await Promise.all([
      employeeIds.length
        ? this.prisma.employeePersonalDetail.findMany({
            where: { employeeId: { in: employeeIds } },
            select: { employeeId: true, firstName: true, lastName: true },
          })
        : [],
      serviceUserIds.length
        ? this.prisma.serviceUser.findMany({ where: { id: { in: serviceUserIds } }, select: { id: true, firstName: true, lastName: true } })
        : [],
    ]);
    const map = new Map<string, string>();
    for (const e of employees) map.set(e.employeeId, `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || 'Employee');
    for (const p of people) map.set(p.id, `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'Person we support');
    return map;
  }
}
