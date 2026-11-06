import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SurveyTargetKind, type Survey } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { surveyVisibleInScope } from './survey-scope.util';
import { LINK_LIMIT, MAX_RAISED_LINK_DAYS, MAX_RAISED_LINK_LIMIT, linkLimitFor } from './survey-link-guard';

/**
 * Shared links of a public survey: its main link (Survey.shareToken) and one link per branch
 * (SurveyShareLink), so answers through a branch's link (its poster, its website page) carry that
 * branch. Branch-restricted users manage their own branches' links only. Every change is audited.
 */
@Injectable()
export class SurveyShareLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  private async requireVisibleSurvey(actor: RequestUser, id: string): Promise<Survey> {
    const survey = await this.prisma.survey.findFirst({ where: { id, deletedAt: null, isCatalogue: false } });
    if (!survey || !surveyVisibleInScope(this.orgScope.fromRequestUser(actor), survey)) throw new NotFoundException('Survey not found');
    if (survey.isTemplate) throw new BadRequestException('Templates have no links. Start a survey from the template first.');
    return survey;
  }

  /** A survey whose shared link is on: public surveys always; staff and service-user surveys once turned on. */
  private async requirePublicSurvey(actor: RequestUser, id: string): Promise<Survey> {
    const survey = await this.requireVisibleSurvey(actor, id);
    if (survey.targetKind !== SurveyTargetKind.PUBLIC && !survey.sharedLinkEnabled) {
      throw new BadRequestException('This survey has no shared link. Turn the shared link on first.');
    }
    return survey;
  }

  /**
   * Staff and service-user surveys: turn the shared link on or off. Turning it on always gives a new
   * link, so a link that was turned off because it went too far never works again. A repeating
   * survey's link is set on the repeating survey (it always opens the period that is open).
   */
  async setSharedLink(actor: RequestUser, surveyId: string, enabled: boolean, meta?: RequestAuditMeta) {
    const survey = await this.requireVisibleSurvey(actor, surveyId);
    if (survey.targetKind === SurveyTargetKind.PUBLIC) throw new BadRequestException('Public surveys always have their shared link.');
    if (survey.clonedFromId) throw new BadRequestException('Set the shared link on the repeating survey: it always opens the period that is open.');
    if (survey.sharedLinkEnabled === enabled) return { message: enabled ? 'Shared link is on' : 'Shared link is off', data: { enabled } };
    const updated = await this.prisma.survey.update({
      where: { id: surveyId },
      data: { sharedLinkEnabled: enabled, ...(enabled ? { shareToken: randomUUID() } : {}), updatedById: actor.id },
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_UPDATED,
      recordType: 'Survey',
      recordId: surveyId,
      description: `Shared link turned ${enabled ? 'on' : 'off'} for survey "${survey.title}"`,
      oldValues: { sharedLinkEnabled: !enabled },
      newValues: { sharedLinkEnabled: enabled },
      ...meta,
    });
    return { message: enabled ? 'Shared link turned on' : 'Shared link turned off', data: { enabled, token: enabled ? updated.shareToken : null } };
  }

  /**
   * Shared link settings: one answer per device. The link page then keeps a random marker on the
   * device after an answer (never sent with or stored against the answer) and says so; a second
   * answer from the same browser is turned away. It cannot stop someone using another device or
   * clearing their browser, so Results still warn about bursts.
   */
  async updateSettings(actor: RequestUser, surveyId: string, settings: { oncePerDevice: boolean }, meta?: RequestAuditMeta) {
    const survey = await this.requirePublicSurvey(actor, surveyId);
    if (survey.clonedFromId && survey.targetKind !== SurveyTargetKind.PUBLIC) {
      throw new BadRequestException('Change this on the repeating survey.');
    }
    if (survey.sharedLinkOncePerDevice === settings.oncePerDevice) {
      return { message: 'Shared link settings', data: { oncePerDevice: settings.oncePerDevice } };
    }
    await this.prisma.survey.update({
      where: { id: surveyId },
      data: { sharedLinkOncePerDevice: settings.oncePerDevice, updatedById: actor.id },
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_UPDATED,
      recordType: 'Survey',
      recordId: surveyId,
      description: `One answer per device turned ${settings.oncePerDevice ? 'on' : 'off'} for the shared link of survey "${survey.title}"`,
      oldValues: { sharedLinkOncePerDevice: !settings.oncePerDevice },
      newValues: { sharedLinkOncePerDevice: settings.oncePerDevice },
      ...meta,
    });
    return { message: 'Shared link settings saved', data: { oncePerDevice: settings.oncePerDevice } };
  }

  /**
   * Raise the shared links' answer limit for a planned sitting (e.g. 300 in 10 minutes while staff
   * answer together at a meeting), until a time at most MAX_RAISED_LINK_DAYS ahead; null puts the
   * standard limit back. Audited. The other spam checks (form token, hidden field) still apply.
   */
  async setLinkLimit(actor: RequestUser, surveyId: string, dto: { limit: number | null; until?: string | null }, meta?: RequestAuditMeta) {
    const survey = await this.requirePublicSurvey(actor, surveyId);
    if (survey.clonedFromId && survey.targetKind !== SurveyTargetKind.PUBLIC) {
      throw new BadRequestException('Change this on the repeating survey.');
    }
    let limit: number | null = null;
    let until: Date | null = null;
    if (dto.limit !== null) {
      if (!Number.isInteger(dto.limit) || dto.limit <= LINK_LIMIT || dto.limit > MAX_RAISED_LINK_LIMIT) {
        throw new BadRequestException(`Choose a number from ${LINK_LIMIT + 1} to ${MAX_RAISED_LINK_LIMIT} answers per 10 minutes.`);
      }
      until = dto.until ? new Date(dto.until) : null;
      const now = Date.now();
      if (!until || Number.isNaN(until.getTime()) || until.getTime() <= now) {
        throw new BadRequestException('Say until when the higher limit is needed.');
      }
      if (until.getTime() - now > MAX_RAISED_LINK_DAYS * 24 * 60 * 60_000) {
        throw new BadRequestException(`A higher limit is for a planned sitting: at most ${MAX_RAISED_LINK_DAYS} days ahead.`);
      }
      limit = dto.limit;
    }
    await this.prisma.survey.update({
      where: { id: surveyId },
      data: { sharedLinkLimit: limit, sharedLinkLimitUntil: until, updatedById: actor.id },
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_UPDATED,
      recordType: 'Survey',
      recordId: surveyId,
      description: limit
        ? `Shared link limit raised to ${limit} answers per 10 minutes until ${until!.toISOString()} for survey "${survey.title}"`
        : `Shared link limit back to the standard ${LINK_LIMIT} answers per 10 minutes for survey "${survey.title}"`,
      oldValues: { sharedLinkLimit: survey.sharedLinkLimit, sharedLinkLimitUntil: survey.sharedLinkLimitUntil },
      newValues: { sharedLinkLimit: limit, sharedLinkLimitUntil: until },
      ...meta,
    });
    return { message: limit ? 'Higher limit set' : 'Standard limit back', data: this.linkLimitOf({ sharedLinkLimit: limit, sharedLinkLimitUntil: until }) };
  }

  /** The shared links' answer limit, as the Sharing panel shows it. */
  private linkLimitOf(survey: { sharedLinkLimit: number | null; sharedLinkLimitUntil: Date | null }) {
    const raised = linkLimitFor(survey) > LINK_LIMIT;
    return {
      standard: LINK_LIMIT,
      inForce: linkLimitFor(survey),
      raisedUntil: raised ? survey.sharedLinkLimitUntil!.toISOString() : null,
      max: MAX_RAISED_LINK_LIMIT,
      maxDays: MAX_RAISED_LINK_DAYS,
    };
  }

  /**
   * A new main shared link: the old one stops working at once (posters, messages and website pages
   * with it show "link not found"). Branch links are not changed. Managers of every branch the survey
   * is for only (a branch-restricted user sees the survey only when all its branches are theirs).
   */
  async renewMain(actor: RequestUser, surveyId: string, meta?: RequestAuditMeta) {
    const survey = await this.requirePublicSurvey(actor, surveyId);
    if (survey.clonedFromId && survey.targetKind !== SurveyTargetKind.PUBLIC) {
      throw new BadRequestException('Make a new link on the repeating survey.');
    }
    const updated = await this.prisma.survey.update({
      where: { id: surveyId },
      data: { shareToken: randomUUID(), updatedById: actor.id },
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_LINK_RENEWED,
      recordType: 'Survey',
      recordId: surveyId,
      description: `New main shared link made for survey "${survey.title}"; the old link no longer works`,
      newValues: { link: 'main' },
      ...meta,
    });
    return { message: 'New link made. The old link no longer works.', data: { token: updated.shareToken } };
  }

  /**
   * A paper copy of the survey was printed (the print view tells the API when it is opened for
   * printing). Paper answers are typed in later with Record response; the copy holds no answers.
   */
  async paperCopyPrinted(actor: RequestUser, surveyId: string, meta?: RequestAuditMeta) {
    const survey = await this.prisma.survey.findFirst({ where: { id: surveyId, deletedAt: null, isCatalogue: false } });
    if (!survey || !surveyVisibleInScope(this.orgScope.fromRequestUser(actor), survey)) throw new NotFoundException('Survey not found');
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_PAPER_COPY_PRINTED,
      recordType: 'Survey',
      recordId: surveyId,
      description: `Paper copy of survey "${survey.title}" printed`,
      ...meta,
    });
    return { message: 'Noted', data: { surveyId } };
  }

  async list(actor: RequestUser, surveyId: string) {
    const survey = await this.requireVisibleSurvey(actor, surveyId);
    if (survey.targetKind !== SurveyTargetKind.PUBLIC && !survey.sharedLinkEnabled) {
      return { message: 'Shared links', data: { main: null, enabled: false, oncePerDevice: false, branches: [], availableBranches: [] } };
    }
    const scope = this.orgScope.fromRequestUser(actor);
    const links = await this.prisma.surveyShareLink.findMany({
      where: { surveyId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const locationIds = [...new Set([...links.map((l) => l.locationId).filter((x): x is string => !!x), ...survey.locationIds])];
    const locations = locationIds.length
      ? await this.prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } })
      : [];
    const name = new Map(locations.map((l) => [l.id, l.name]));
    // Branches a link can be made for: the survey's branches (all, when it has none) within the user's.
    const candidates = survey.locationIds.length
      ? survey.locationIds
      : (await this.prisma.location.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true } })).map((l) => l.id);
    const allowed = candidates.filter((id) => scope.locationIds === null || scope.locationIds.includes(id));
    const branchNames = allowed.length
      ? await this.prisma.location.findMany({ where: { id: { in: allowed } }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
      : [];
    return {
      message: 'Shared links',
      data: {
        main: { token: survey.shareToken },
        /** Staff and service-user surveys: the shared link is on (public surveys: always). */
        enabled: true,
        /** One answer per device (a marker kept only on the device). */
        oncePerDevice: survey.sharedLinkOncePerDevice,
        /** Answers per 10 minutes through each link: standard, or raised for a planned sitting. */
        linkLimit: this.linkLimitOf(survey),
        branches: links.map((l) => ({
          id: l.id,
          token: l.token,
          locationId: l.locationId,
          locationName: l.locationId ? (name.get(l.locationId) ?? null) : null,
          createdAt: l.createdAt.toISOString(),
        })),
        /** Branches without a link yet. */
        availableBranches: branchNames.filter((b) => !links.some((l) => l.locationId === b.id)),
      },
    };
  }

  async create(actor: RequestUser, surveyId: string, locationId: string, meta?: RequestAuditMeta) {
    const survey = await this.requirePublicSurvey(actor, surveyId);
    const scope = this.orgScope.fromRequestUser(actor);
    if (scope.locationIds !== null && !scope.locationIds.includes(locationId)) throw new BadRequestException('You can only choose your own branches.');
    if (survey.locationIds.length && !survey.locationIds.includes(locationId)) throw new BadRequestException('This survey is not for that branch.');
    const location = await this.prisma.location.findFirst({ where: { id: locationId, deletedAt: null }, select: { id: true, name: true } });
    if (!location) throw new BadRequestException('Branch not found');
    const existing = await this.prisma.surveyShareLink.findFirst({ where: { surveyId, locationId, revokedAt: null } });
    if (existing) throw new BadRequestException(`${location.name} already has a link. Make a new one with "New link" if the old one has been shared too widely.`);
    let link: { id: string; token: string };
    try {
      link = await this.prisma.surveyShareLink.create({
        data: { surveyId, locationId, token: randomUUID(), label: location.name, createdById: actor.id },
      });
    } catch (e) {
      // Two people made the branch's link at the same moment (one live link per branch): the other
      // one's link is the branch's link.
      if ((e as { code?: string })?.code !== 'P2002') throw e;
      const made = await this.prisma.surveyShareLink.findFirst({ where: { surveyId, locationId, revokedAt: null } });
      if (!made) throw new ConflictException(`${location.name}'s link was being changed at the same moment. Please try again.`);
      return { message: 'Link made', data: { id: made.id, token: made.token } };
    }
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_SHARE_LINK_CREATED,
      recordType: 'SurveyShareLink',
      recordId: link.id,
      description: `Shared link for ${location.name} made for survey "${survey.title}"`,
      newValues: { surveyId, locationId },
      ...meta,
    });
    return { message: 'Link made', data: { id: link.id, token: link.token } };
  }

  /** Turn a branch link off (and, with `replace`, make a new one for the same branch). */
  async turnOff(actor: RequestUser, surveyId: string, linkId: string, opts: { replace?: boolean } = {}, meta?: RequestAuditMeta) {
    const survey = await this.requirePublicSurvey(actor, surveyId);
    const link = await this.prisma.surveyShareLink.findFirst({ where: { id: linkId, surveyId, revokedAt: null } });
    if (!link) throw new NotFoundException('Link not found');
    const scope = this.orgScope.fromRequestUser(actor);
    // Branch-restricted users change their own branches' links only; a link for no branch (the whole
    // survey) belongs to managers of every branch.
    if (scope.locationIds !== null) {
      if (!link.locationId) throw new ForbiddenException('Only a manager of every branch can change a link that is not for one branch.');
      if (!scope.locationIds.includes(link.locationId)) throw new NotFoundException('Link not found');
    }
    await this.prisma.surveyShareLink.update({ where: { id: linkId }, data: { revokedAt: new Date(), revokedById: actor.id } });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_SHARE_LINK_TURNED_OFF,
      recordType: 'SurveyShareLink',
      recordId: linkId,
      description: `A shared link for survey "${survey.title}" was turned off${opts.replace ? ' and replaced' : ''}`,
      oldValues: { locationId: link.locationId },
      ...meta,
    });
    if (opts.replace && link.locationId) return this.create(actor, surveyId, link.locationId, meta);
    return { message: 'Link turned off', data: { id: linkId } };
  }
}
