import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SurveyResponseChannel, SurveyStatus, SurveyTargetKind, type Survey } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { hashPassword } from '../common/utils/password.util';
import { INDEPENDENT_REVIEWER_ROLE, SURVEY_REVIEW_PERMISSION, isReviewerOnly } from '../common/auth/independent-reviewer';
import { findReviewerLinks } from './survey-reviewer-links';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuthService } from '../auth/auth.service';
import { surveyVisibleInScope } from './survey-scope.util';
import { SurveysService } from './surveys.service';
import type { RecordSurveyResponseDto } from './dto/record-survey-response.dto';

/** The most people one reviewer's sample can hold (SUR-CQC-001 asks for 10 to 30). */
export const MAX_REVIEW_SAMPLE = 100;
/** The longest a reviewer may hold access to one survey. */
export const MAX_REVIEW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_CHANNELS: SurveyResponseChannel[] = [SurveyResponseChannel.TELEPHONE, SurveyResponseChannel.IN_PERSON, SurveyResponseChannel.PAPER];

/** Why an account cannot be given reviewer access (the Governance and Quality Assurance Policy). */
export const NOT_A_REVIEWER_ACCOUNT =
  'Only an independent reviewer account can be given access: its only role is Independent reviewer and it has no branch. Staff accounts cannot be used, because the reviewer must have no other role here. Use "Add a reviewer" to make one.';

const NO_ACCESS_NOW = 'You do not have access to record answers on this survey now.';

const fullName = (p: { firstName?: string | null; lastName?: string | null } | null | undefined) =>
  [p?.firstName?.trim(), p?.lastName?.trim()].filter(Boolean).join(' ');

/**
 * Independent reviewer accounts (SUR-CQC-001 independent quality review; SUR-CQC-002 paper returns).
 * The reviewer signs in with an ordinary user account whose only role is "Independent reviewer"
 * (no permissions, no branch, no employee record). A survey manager makes the account ("Add a
 * reviewer": the person is emailed a link to choose their own password) and gives it a grant
 * (SurveyReviewerGrant) to record answers on ONE survey (a repeating survey's period, never the
 * repeating survey itself), for a time window, only for the sample of people chosen; on an anonymous
 * survey, anonymous answers only (no people at all). While a grant is live the account holds
 * surveys.review.record and nothing else, and every other route refuses it (JwtAuthGuard). The
 * reviewer sees the questions and their sample's names, never results, counts, other answers, care
 * records or anyone else. Making the account, granting, revoking and every named answer recorded are
 * audited; answers go through the same Record response path (and checks) as office staff use.
 * Temporary Inspector logins are never used for this: they can open care records.
 */
@Injectable()
export class SurveyReviewersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly audit: AuditLogsService,
    private readonly surveys: SurveysService,
    private readonly auth: AuthService,
  ) {}

  // ─── Survey managers ──────────────────────────────────────────────────────

  private async requireManagedSurvey(actor: RequestUser, surveyId: string): Promise<Survey> {
    const survey = await this.prisma.survey.findFirst({ where: { id: surveyId, deletedAt: null, isCatalogue: false } });
    if (!survey || !surveyVisibleInScope(this.orgScope.fromRequestUser(actor), survey)) throw new NotFoundException('Survey not found');
    if (survey.isTemplate) throw new BadRequestException('Give a reviewer access to the survey started from this template, not the template.');
    return survey;
  }

  /** Answers to this survey are linked to no one: a reviewer records anonymous answers only. */
  private anonymousOnly(survey: Pick<Survey, 'isAnonymous' | 'targetKind'>) {
    return survey.isAnonymous || survey.targetKind === SurveyTargetKind.PUBLIC;
  }

  /**
   * Reviewer accounts (only role Independent reviewer, no branch) this manager may see and choose:
   * every one for someone with access to all branches; otherwise those they made, or that someone
   * in one of their branches made.
   */
  reviewerAccountsWhere(actor: RequestUser): Prisma.UserWhereInput {
    const branches = actor.assignedLocationIds;
    return {
      deletedAt: null,
      userRoles: { some: { role: { name: INDEPENDENT_REVIEWER_ROLE } }, every: { role: { name: INDEPENDENT_REVIEWER_ROLE } } },
      userLocations: { none: {} },
      ...(branches == null
        ? {}
        : {
            OR: [
              { createdById: actor.id },
              ...(branches.length ? [{ createdBy: { userLocations: { some: { locationId: { in: branches } } } } }] : []),
            ],
          }),
    };
  }

  /**
   * Every independent reviewer the person can see, across all surveys: each one's access (survey, dates,
   * sample size, live or not) and how many answers they recorded there, newest first. Survey managers only.
   */
  async overview(actor: RequestUser) {
    const accounts = await this.prisma.user.findMany({
      where: this.reviewerAccountsWhere(actor),
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, email: true, isActive: true, createdAt: true },
    });
    const ids = accounts.map((a) => a.id);
    const [grants, recorded] = ids.length
      ? await Promise.all([
          this.prisma.surveyReviewerGrant.findMany({
            where: { userId: { in: ids } },
            orderBy: { validFrom: 'desc' },
            include: { survey: { select: { id: true, title: true, clonedFromId: true } } },
          }),
          this.prisma.surveyResponse.groupBy({
            by: ['recordedById', 'surveyId'],
            where: { recordedById: { in: ids } },
            _count: { _all: true },
            _max: { submittedAt: true },
          }),
        ])
      : [[], []];
    const now = new Date();
    const countOf = new Map(recorded.map((r) => [`${r.recordedById}:${r.surveyId}`, r]));
    // What the manager declared when the reviewer was already connected to us (from the audit log).
    const made = ids.length
      ? await this.prisma.auditLog.findMany({
          where: { action: AuditAction.SURVEY_REVIEWER_ACCOUNT_CREATED, recordId: { in: ids } },
          select: { recordId: true, metadata: true },
        })
      : [];
    const declared = new Map(
      made.map((m) => {
        const md = (m.metadata ?? {}) as { declaredLinks?: string[]; declaration?: string };
        return [m.recordId ?? '', { links: md.declaredLinks ?? [], declaration: md.declaration ?? null }];
      }),
    );
    const reviewers = accounts.map((a) => {
      const mine = grants.filter((g) => g.userId === a.id);
      const access = mine.map((g) => {
        const c = countOf.get(`${a.id}:${g.surveyId}`);
        return {
          grantId: g.id,
          survey: { id: g.survey.id, title: g.survey.title },
          validFrom: g.validFrom.toISOString(),
          validTo: g.validTo.toISOString(),
          status: g.revokedAt ? 'REVOKED' : g.validTo < now ? 'ENDED' : g.validFrom > now ? 'NOT_STARTED' : 'ACTIVE',
          sampleSize: g.personIds.length,
          answersRecorded: c?._count._all ?? 0,
          lastRecordedAt: c?._max.submittedAt?.toISOString() ?? null,
        };
      });
      return {
        id: a.id,
        name: fullName(a) || a.email,
        email: a.email,
        accountActive: a.isActive,
        createdAt: a.createdAt.toISOString(),
        liveAccess: access.filter((x) => x.status === 'ACTIVE').length,
        /** Connected to us when added, and what the manager declared. */
        declaredLinks: declared.get(a.id)?.links ?? [],
        declaration: declared.get(a.id)?.declaration ?? null,
        answersRecorded: access.reduce((n, x) => n + x.answersRecorded, 0),
        access,
      };
    });
    return { message: 'Independent reviewers', data: { reviewers } };
  }

  /**
   * "Add a reviewer" → choose someone already in CareFlow: reviewers added before (used as they are), outside survey contacts
   * (social workers, GPs, commissioners), family and other contacts of people we support, and former staff. Current
   * staff are never offered (they can't be reviewers). Choosing one still goes through the declaration check.
   */
  async knownPeople(actor: RequestUser, surveyId: string, search: string) {
    await this.requireManagedSurvey(actor, surveyId);
    const q = search.trim();
    if (q.length < 2) return { data: { people: [] } };
    const has = { contains: q, mode: 'insensitive' as const };
    const [reviewers, outside, contacts, former] = await Promise.all([
      // Reviewers added before: chosen as they are (no new account), then given access.
      this.prisma.user.findMany({
        where: { AND: [this.reviewerAccountsWhere(actor), { OR: [{ firstName: has }, { lastName: has }, { email: has }] }] },
        select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
        orderBy: { firstName: 'asc' },
        take: 8,
      }),
      this.prisma.surveyExternalContact.findMany({
        where: { deletedAt: null, OR: [{ name: has }, { email: has }] },
        select: { id: true, name: true, email: true, role: true, kind: true, organisation: true },
        orderBy: { name: 'asc' },
        take: 8,
      }),
      this.prisma.serviceUserContact.findMany({
        where: { deletedAt: null, OR: [{ firstName: has }, { lastName: has }, { email: has }] },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          relationshipType: { select: { name: true } },
          serviceUser: { select: { firstName: true, lastName: true } },
        },
        orderBy: { firstName: 'asc' },
        take: 8,
      }),
      this.prisma.employeePersonalDetail.findMany({
        where: { employee: { deletedAt: null, isActive: false }, OR: [{ firstName: has }, { lastName: has }, { email: has }] },
        select: {
          employeeId: true,
          firstName: true,
          lastName: true,
          email: true,
          employee: { select: { employment: { select: { jobTitle: { select: { name: true } }, endDate: true } } } },
        },
        orderBy: { firstName: 'asc' },
        take: 8,
      }),
    ]);
    // What each person is, in plain words, shown with their name ("Jane Doe · Independent reviewer").
    const OUTSIDE_TYPE: Record<string, string> = { FAMILY: 'Family member', PROFESSIONAL: 'Professional', COMMISSIONER: 'Commissioner', OTHER: 'Outside contact' };
    const yearLeft = (d?: Date | null) => (d ? `left ${d.getUTCFullYear()}` : '');
    const split = (name: string) => {
      const parts = name.trim().split(/\s+/);
      return { firstName: parts.slice(0, -1).join(' ') || parts[0] || '', lastName: parts.length > 1 ? parts[parts.length - 1]! : '' };
    };
    const people = [
      ...reviewers.map((r) => ({
        id: `reviewer:${r.id}`,
        firstName: r.firstName ?? '',
        lastName: r.lastName ?? '',
        email: r.email,
        source: 'REVIEWER',
        typeLabel: 'Independent reviewer',
        detail: r.isActive ? 'Added before: no new account, just give access' : 'Account switched off',
      })),
      ...outside.map((o) => ({
        id: `outside:${o.id}`,
        ...split(o.name),
        email: o.email ?? '',
        source: 'OUTSIDE_CONTACT',
        typeLabel: o.role?.trim() || OUTSIDE_TYPE[o.kind] || 'Outside contact',
        detail: ['Outside contact on our surveys', o.organisation?.trim()].filter(Boolean).join(' · '),
      })),
      ...contacts.map((c) => ({
        id: `contact:${c.id}`,
        firstName: c.firstName,
        lastName: c.lastName ?? '',
        email: c.email ?? '',
        source: 'FAMILY_CONTACT',
        typeLabel: c.relationshipType?.name?.trim() ? `${c.relationshipType.name.trim()} of a person we support` : 'Family / contact of a person we support',
        detail: `Contact of ${fullName(c.serviceUser) || 'a person we support'}`,
      })),
      ...former.map((e) => ({
        id: `former:${e.employeeId}`,
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email ?? '',
        source: 'FORMER_STAFF',
        typeLabel: 'Former staff',
        detail: [e.employee.employment?.jobTitle?.name, yearLeft(e.employee.employment?.endDate)].filter(Boolean).join(' · ') || 'No longer works here',
      })),
    ];
    return { data: { people } };
  }

  /**
   * Staff whose role has the "Record survey responses" responsibility: they collect answers by phone, paper or in
   * person (Surveys to collect), recorded as the office's answers. Listed so managers see who can already run a
   * survey; staff are never given independent reviewer access (an independent review needs someone from outside).
   */
  async surveyStaff(actor: RequestUser, surveyId: string) {
    await this.requireManagedSurvey(actor, surveyId);
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        userRoles: {
          some: { role: { isActive: true, deletedAt: null, rolePermissions: { some: { permission: { key: 'surveys.responses.record' } } } } },
          none: { role: { name: INDEPENDENT_REVIEWER_ROLE } },
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        userRoles: { select: { role: { select: { name: true } } } },
        userLocations: { select: { location: { select: { name: true } } } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 200,
    });
    return {
      data: {
        staff: users.map((u) => ({
          id: u.id,
          name: fullName(u) || u.email,
          email: u.email,
          roles: u.userRoles.map((r) => r.role.name),
          branches: u.userLocations.map((l) => l.location.name),
        })),
      },
    };
  }

  /** "Add a reviewer", before saving: how this person is already connected to us (each needs a declaration). */
  async checkAccount(actor: RequestUser, surveyId: string, dto: { firstName: string; lastName: string; email: string }) {
    await this.requireManagedSurvey(actor, surveyId);
    const links = await findReviewerLinks(this.prisma, dto);
    return { data: { links: links.map(({ kind, label, match }) => ({ kind, label, match })) } };
  }

  /** The ids among these users that are independent reviewer accounts (to mark the answers they recorded). */
  async reviewerIds(userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: userIds }, userRoles: { some: { role: { name: INDEPENDENT_REVIEWER_ROLE } } } },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /** A repeating survey (not one of its periods): access is given to the period being run instead. */
  private async isRepeatingParent(survey: Pick<Survey, 'id' | 'clonedFromId' | 'recurrence'>): Promise<boolean> {
    if (survey.clonedFromId) return false;
    if (survey.recurrence) return true;
    return (await this.prisma.survey.count({ where: { clonedFromId: survey.id, deletedAt: null } })) > 0;
  }

  /** The survey's reviewer grants, and the reviewer accounts that can be given one. */
  async list(actor: RequestUser, surveyId: string) {
    const survey = await this.requireManagedSurvey(actor, surveyId);
    const now = new Date();
    const [grants, accounts, repeatingParent] = await Promise.all([
      this.prisma.surveyReviewerGrant.findMany({
        where: { surveyId },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { firstName: true, lastName: true, email: true, isActive: true } } },
      }),
      this.prisma.user.findMany({
        where: this.reviewerAccountsWhere(actor),
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
      }),
      this.isRepeatingParent(survey),
    ]);
    const names = await this.personNames(survey, [...new Set(grants.flatMap((g) => g.personIds))]);
    return {
      message: 'Independent reviewers',
      data: {
        anonymousOnly: this.anonymousOnly(survey),
        repeatingParent,
        grants: grants.map((g) => ({
          id: g.id,
          reviewer: { id: g.userId, name: fullName(g.user) || g.user.email, email: g.user.email, accountActive: g.user.isActive },
          sample: g.personIds.map((id) => ({ id, name: names.get(id) ?? 'Not found' })),
          validFrom: g.validFrom.toISOString(),
          validTo: g.validTo.toISOString(),
          status: g.revokedAt ? 'REVOKED' : g.validTo < now ? 'ENDED' : g.validFrom > now ? 'NOT_STARTED' : 'ACTIVE',
        })),
        accounts: accounts.map((a) => ({ id: a.id, name: fullName(a) || a.email, email: a.email, active: a.isActive })),
      },
    };
  }

  /**
   * "Add a reviewer": an account with only the Independent reviewer role (no permissions, no branch).
   * Nobody sets or sees its password: the person is emailed a link to choose their own (the password
   * reset link, worded as an invitation). Never a member of staff's email.
   */
  async createAccount(
    actor: RequestUser,
    surveyId: string,
    dto: { firstName: string; lastName: string; email: string; declaration?: string },
    meta?: RequestAuditMeta,
  ) {
    await this.requireManagedSurvey(actor, surveyId);
    const email = dto.email.trim().toLowerCase();
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    if (!firstName || !lastName) throw new BadRequestException('Give the reviewer’s first and last name.');
    const [existing, staff, role] = await Promise.all([
      this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } }),
      this.prisma.employeePersonalDetail.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, employee: { deletedAt: null } },
        select: { employeeId: true },
      }),
      this.prisma.role.findFirst({ where: { name: INDEPENDENT_REVIEWER_ROLE, deletedAt: null, isActive: true }, select: { id: true } }),
    ]);
    if (staff) throw new BadRequestException('This email belongs to a member of staff. An independent reviewer must have no other role here.');
    if (existing) {
      throw new ConflictException('An account with this email already exists. Choose it from the list if it is a reviewer account; staff accounts cannot be used.');
    }
    if (!role) throw new BadRequestException('The Independent reviewer role is missing. Ask an admin to run the setup.');
    // Previously involved with us (former staff, a person we support or their family, an outside contact):
    // allowed only once the manager declares they have weighed it, with a reason (independence allows declared links).
    const links = await findReviewerLinks(this.prisma, { firstName, lastName, email });
    const declaration = dto.declaration?.trim() ?? '';
    if (links.length && declaration.length < 10) {
      throw new ConflictException({
        message: 'This person is already connected to us. Check it, then declare why they are still independent enough for this review.',
        links: links.map(({ kind, label, match }) => ({ kind, label, match })),
      });
    }
    // A random value nobody knows and nobody is shown: the account has no usable password until the
    // person chooses one through the emailed link.
    const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, firstName, lastName, passwordHash, createdById: actor.id, userRoles: { create: { roleId: role.id } } },
        select: { id: true, email: true, firstName: true },
      });
      await this.audit.logAudit({
        tx,
        userId: actor.id,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_REVIEWER_ACCOUNT_CREATED,
        recordType: 'User',
        recordId: created.id,
        description: `Independent reviewer account made for ${firstName} ${lastName}`,
        metadata: {
          surveyId,
          role: INDEPENDENT_REVIEWER_ROLE,
          ...(links.length ? { declaredLinks: links.map((l) => l.label), declaration: declaration.slice(0, 1000) } : {}),
        },
        ...meta,
      });
      return created;
    });
    const inviteSent = await this.auth
      .sendAccountInvite(user, { requestedIp: meta?.ipAddress ?? null, purpose: 'to record survey answers as an independent reviewer' })
      .catch(() => false);
    return {
      message: inviteSent
        ? 'Reviewer account made. They have been emailed a link to choose their own password.'
        : 'Reviewer account made, but the email could not be sent. They can use "Forgot password" on the sign-in page to choose their password.',
      data: { id: user.id, inviteSent },
    };
  }

  /** Give a reviewer account the right to record answers on this survey, for its sample, in a window. */
  async grant(
    actor: RequestUser,
    surveyId: string,
    dto: { userId: string; personIds?: string[]; validFrom: string; validTo: string },
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.requireManagedSurvey(actor, surveyId);
    if (survey.status === SurveyStatus.CLOSED) throw new BadRequestException('This survey is closed. Reopen it first.');
    if (await this.isRepeatingParent(survey)) {
      throw new BadRequestException('This is a repeating survey. Open the period being run now (Periods) and give the reviewer access to that period.');
    }
    const account = await this.prisma.user.findFirst({
      where: { id: dto.userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        userRoles: { select: { role: { select: { name: true } } } },
        userLocations: { select: { locationId: true } },
      },
    });
    if (!account) throw new BadRequestException('Choose a reviewer account.');
    // Never a staff account, and never one with any other role or any branch: a grant must never
    // widen anyone's access to care records or results.
    const staff = await this.prisma.employeePersonalDetail.findFirst({
      where: { email: { equals: account.email, mode: 'insensitive' }, employee: { deletedAt: null } },
      select: { employeeId: true },
    });
    if (!isReviewerOnly(account.userRoles.map((r) => r.role.name)) || account.userLocations.length || staff) {
      throw new BadRequestException(NOT_A_REVIEWER_ACCOUNT);
    }
    if (!account.isActive) throw new BadRequestException('This reviewer account is switched off. Switch it on first (Settings, Users).');
    if (!(await this.prisma.user.count({ where: { AND: [{ id: account.id }, this.reviewerAccountsWhere(actor)] } }))) {
      throw new BadRequestException('Choose a reviewer account made in your branches.');
    }
    const validFrom = new Date(dto.validFrom);
    const validTo = new Date(dto.validTo);
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime()) || validTo <= validFrom) {
      throw new BadRequestException('The end must be after the start.');
    }
    if (validTo.getTime() - validFrom.getTime() > MAX_REVIEW_DAYS * DAY_MS) {
      throw new BadRequestException(`A reviewer can be given at most ${MAX_REVIEW_DAYS} days on one survey.`);
    }
    if (validTo <= new Date()) throw new BadRequestException('The end has already passed.');
    const personIds = [...new Set(dto.personIds ?? [])];
    if (this.anonymousOnly(survey)) {
      if (personIds.length) {
        throw new BadRequestException('Answers to this survey are linked to no one, so the reviewer records anonymous answers only: choose no people.');
      }
    } else {
      if (!personIds.length) throw new BadRequestException('Choose the people in the reviewer’s sample.');
      if (personIds.length > MAX_REVIEW_SAMPLE) throw new BadRequestException(`A sample can have at most ${MAX_REVIEW_SAMPLE} people.`);
      await this.assertSample(actor, survey, personIds);
      // Never someone the reviewer is connected to (their relative, or themselves as a former employee or client).
      const links = await findReviewerLinks(this.prisma, { firstName: account.firstName ?? '', lastName: account.lastName ?? '', email: account.email });
      const tied = new Set(links.flatMap((l) => (survey.targetKind === SurveyTargetKind.SERVICE_USER ? l.serviceUserIds : l.employeeIds)));
      const clash = personIds.filter((id) => tied.has(id));
      if (clash.length) {
        const names = await this.personNames(survey, clash);
        throw new BadRequestException(
          `Take ${clash.map((id) => names.get(id) ?? 'one person').join(', ')} out of the sample: the reviewer is connected to them.`,
        );
      }
    }
    const created = await this.prisma.surveyReviewerGrant.create({
      data: { surveyId, userId: account.id, personIds, validFrom, validTo, createdById: actor.id },
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_REVIEWER_GRANTED,
      recordType: 'SurveyReviewerGrant',
      recordId: created.id,
      description: `${fullName(account) || account.email} may record answers on "${survey.title}"`,
      metadata: { surveyId, reviewerUserId: account.id, sampleSize: personIds.length, personIds, validFrom, validTo },
      ...meta,
    });
    return { message: 'Reviewer access given', data: { id: created.id } };
  }

  async revoke(actor: RequestUser, surveyId: string, grantId: string, meta?: RequestAuditMeta) {
    const survey = await this.requireManagedSurvey(actor, surveyId);
    const grant = await this.prisma.surveyReviewerGrant.findFirst({ where: { id: grantId, surveyId } });
    if (!grant) throw new NotFoundException('Reviewer access not found');
    if (!grant.revokedAt) {
      await this.prisma.surveyReviewerGrant.update({ where: { id: grantId }, data: { revokedAt: new Date(), revokedById: actor.id } });
      await this.audit.logAudit({
        userId: actor.id,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_REVIEWER_REVOKED,
        recordType: 'SurveyReviewerGrant',
        recordId: grantId,
        description: `Reviewer access to "${survey.title}" ended`,
        metadata: { surveyId, reviewerUserId: grant.userId },
        ...meta,
      });
    }
    return { message: 'Reviewer access ended', data: { id: grantId } };
  }

  /** Every sample person is the survey's kind of person, in the granting manager's branches, still with us. */
  private async assertSample(actor: RequestUser, survey: Survey, personIds: string[]) {
    const scope = this.orgScope.fromRequestUser(actor);
    if (survey.targetKind === SurveyTargetKind.SERVICE_USER) {
      const found = await this.prisma.serviceUser.findMany({ where: { id: { in: personIds }, deletedAt: null }, select: { id: true } });
      if (found.length !== personIds.length) throw new BadRequestException('Some people in the sample were not found.');
      for (const id of personIds) await this.orgScope.assertServiceUserInScope(scope, id);
    } else {
      const found = await this.prisma.employee.findMany({ where: { id: { in: personIds }, deletedAt: null }, select: { id: true } });
      if (found.length !== personIds.length) throw new BadRequestException('Some people in the sample were not found.');
      for (const id of personIds) await this.orgScope.assertEmployeeInScope(scope, id);
    }
  }

  private async personNames(survey: Pick<Survey, 'targetKind'>, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    if (survey.targetKind === SurveyTargetKind.SERVICE_USER) {
      const rows = await this.prisma.serviceUser.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
      return new Map(rows.map((r) => [r.id, fullName(r)]));
    }
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
      select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
    });
    return new Map(rows.map((r) => [r.id, fullName(r.personalDetail)]));
  }

  // ─── The reviewer ─────────────────────────────────────────────────────────

  private assertReviewer(reviewer: RequestUser) {
    if (reviewer.accountKind !== 'user' || !isReviewerOnly(reviewer.roles)) {
      throw new ForbiddenException('Only an independent reviewer account can do this.');
    }
  }

  /** A live grant for this reviewer on this survey (the newest, if several). */
  private async liveGrant(reviewer: RequestUser, surveyId: string) {
    this.assertReviewer(reviewer);
    // Given at sign-in only while a grant is live (and the account is still reviewer-only, no branch).
    if (!reviewer.permissions?.includes(SURVEY_REVIEW_PERMISSION)) throw new NotFoundException(NO_ACCESS_NOW);
    const now = new Date();
    const grant = await this.prisma.surveyReviewerGrant.findFirst({
      where: { userId: reviewer.id, surveyId, revokedAt: null, validFrom: { lte: now }, validTo: { gte: now }, survey: { deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      include: { survey: true },
    });
    // The same answer whether there is no such survey or no access: nothing is given away.
    if (!grant) throw new NotFoundException(NO_ACCESS_NOW);
    return grant;
  }

  /** The surveys this reviewer may record answers on now (none: an empty list). */
  async mine(reviewer: RequestUser) {
    this.assertReviewer(reviewer);
    const now = new Date();
    const grants = reviewer.permissions?.includes(SURVEY_REVIEW_PERMISSION)
      ? await this.prisma.surveyReviewerGrant.findMany({
          where: { userId: reviewer.id, revokedAt: null, validFrom: { lte: now }, validTo: { gte: now }, survey: { deletedAt: null } },
          orderBy: { validTo: 'asc' },
          include: { survey: { select: { id: true, title: true, targetKind: true, isAnonymous: true, status: true } } },
        })
      : [];
    return {
      message: 'Surveys to record',
      data: grants.map((g) => ({
        surveyId: g.surveyId,
        title: g.survey.title,
        targetKind: g.survey.targetKind,
        anonymousOnly: this.anonymousOnly(g.survey),
        sampleSize: g.personIds.length,
        validTo: g.validTo.toISOString(),
        closed: g.survey.status === SurveyStatus.CLOSED,
      })),
    };
  }

  async form(reviewer: RequestUser, surveyId: string) {
    const grant = await this.liveGrant(reviewer, surveyId);
    const form = await this.surveys.reviewerForm(surveyId, { anonymous: this.anonymousOnly(grant.survey) });
    return { ...form, data: { ...form.data, anonymousOnly: this.anonymousOnly(grant.survey), validTo: grant.validTo.toISOString() } };
  }

  /**
   * The reviewer's sample only, in the shape the Record response picker uses. On a named survey,
   * whether each sample person has answered (to avoid recording twice); nothing on anonymous ones.
   */
  async people(reviewer: RequestUser, surveyId: string, search?: string) {
    const grant = await this.liveGrant(reviewer, surveyId);
    if (!grant.personIds.length) return { message: 'Sample', data: [] };
    const names = await this.personNames(grant.survey, grant.personIds);
    const forServiceUsers = grant.survey.targetKind === SurveyTargetKind.SERVICE_USER;
    const recipients = await this.prisma.surveyRecipient.findMany({
      where: { surveyId, ...(forServiceUsers ? { serviceUserId: { in: grant.personIds } } : { employeeId: { in: grant.personIds } }) },
      select: { serviceUserId: true, employeeId: true, status: true },
    });
    const statusOf = new Map(recipients.map((r) => [(forServiceUsers ? r.serviceUserId : r.employeeId) ?? '', r.status]));
    const q = search?.trim().toLocaleLowerCase('en-GB');
    return {
      message: 'Sample',
      data: grant.personIds
        .map((id) => ({
          id,
          name: names.get(id) || 'Not found',
          recipientStatus: statusOf.get(id) ?? null,
          hasResponse: statusOf.get(id) === 'COMPLETED',
          hasPortal: null,
          careEnded: null,
        }))
        .filter((p) => !q || p.name.toLocaleLowerCase('en-GB').includes(q))
        .sort((a, b) => a.name.localeCompare(b.name, 'en-GB')),
    };
  }

  /** Record one answer for a sample person (or anonymously), through the usual Record response checks. */
  async record(reviewer: RequestUser, surveyId: string, dto: RecordSurveyResponseDto, meta?: RequestAuditMeta) {
    const grant = await this.liveGrant(reviewer, surveyId);
    if (!REVIEW_CHANNELS.includes(dto.channel as SurveyResponseChannel)) {
      throw new BadRequestException('Record it as a telephone call, an in-person conversation or a paper form.');
    }
    const anonymousOnly = this.anonymousOnly(grant.survey);
    if (anonymousOnly) {
      if (dto.personId) throw new BadRequestException('Answers to this survey are linked to no one: record it without choosing a person.');
      dto.isAnonymous = true;
    } else if (!dto.isAnonymous && (!dto.personId || !grant.personIds.includes(dto.personId))) {
      throw new ForbiddenException('You can only record answers for the people in your sample.');
    }
    if (dto.isAnonymous) dto.personId = undefined;
    // The reviewer acts through Record response as an office user limited to this one survey.
    const actor: RequestUser = {
      id: reviewer.id,
      email: reviewer.email,
      roles: [INDEPENDENT_REVIEWER_ROLE],
      permissions: ['surveys.responses.record'],
      accountKind: reviewer.accountKind,
      firstName: reviewer.firstName,
      lastName: reviewer.lastName,
      username: reviewer.username,
      assignedLocationIds: null,
    };
    const result = await this.surveys.recordResponse(actor, surveyId, dto, meta, { byReviewer: true });
    // An anonymous answer has no row of its own: it is in the survey's count for the day (as
    // recorded by an independent reviewer), so its time cannot date the call or the paper return.
    if (dto.isAnonymous) return result;
    await this.audit.logAudit({
      userId: reviewer.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_REVIEWER_RESPONSE_RECORDED,
      recordType: 'SurveyReviewerGrant',
      recordId: grant.id,
      description: `Independent reviewer ${fullName(reviewer) || reviewer.email} recorded an answer on "${grant.survey.title}"`,
      // Never the answers.
      metadata: { surveyId, channel: dto.channel, anonymous: false, personId: dto.personId },
      ...meta,
    });
    return result;
  }
}
