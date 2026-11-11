import { BadRequestException, ConflictException, ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { INDEPENDENT_REVIEWER_ROLE, SURVEY_REVIEW_PERMISSION } from '../common/auth/independent-reviewer';
import { UsersService } from '../users/users.service';
import { TemporaryInspectorsService } from '../temporary-inspectors/temporary-inspectors.service';
import { AuthController } from '../auth/auth.controller';
import { ServiceUsersController } from '../service-users/service-users.controller';
import { SurveyReviewersService, NOT_A_REVIEWER_ACCOUNT } from './survey-reviewers.service';
import { SurveyReviewerGrantsController, SurveyReviewsController } from './survey-reviewers.controller';
import { SurveysController } from './surveys.controller';

const admin = { id: 'admin-1', email: 'a@x', roles: ['Super Admin'], permissions: ['surveys.manage'], accountKind: 'user', assignedLocationIds: null } as any;
const branchManager = { id: 'bm-1', email: 'bm@x', roles: ['Manager'], permissions: ['surveys.manage'], accountKind: 'user', assignedLocationIds: ['loc-1'] } as any;
const reviewer = {
  id: 'rev-1',
  email: 'rita@review.example',
  roles: [INDEPENDENT_REVIEWER_ROLE],
  permissions: [SURVEY_REVIEW_PERMISSION],
  accountKind: 'user',
  firstName: 'Rita',
  lastName: 'Review',
  assignedLocationIds: [],
} as any;
const day = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

const namedSurvey = { id: 's1', title: 'Independent review 2027', targetKind: 'SERVICE_USER', isAnonymous: false, isTemplate: false, isCatalogue: false, status: 'ACTIVE', locationIds: [], deletedAt: null, clonedFromId: null, recurrence: null };
const reviewerAccount = (over: Record<string, unknown> = {}) => ({
  id: 'rev-1',
  email: 'rita@review.example',
  firstName: 'Rita',
  lastName: 'Review',
  isActive: true,
  userRoles: [{ role: { name: INDEPENDENT_REVIEWER_ROLE } }],
  userLocations: [],
  ...over,
});

function setup(opts: { survey?: any; grant?: any; account?: any; staffEmail?: boolean; inScope?: boolean; periods?: number; existingUser?: boolean; links?: { staff?: any[]; contacts?: any[] } } = {}) {
  const survey = opts.survey ?? namedSurvey;
  const grant = opts.grant === undefined ? { id: 'g1', surveyId: 's1', userId: 'rev-1', personIds: ['su-1', 'su-2'], validFrom: day(-1), validTo: day(10), survey } : opts.grant;
  const prisma: any = {
    survey: { findFirst: jest.fn(async () => survey), count: jest.fn(async () => opts.periods ?? 0) },
    user: {
      findFirst: jest.fn(async (a: any) => (a?.where?.email ? (opts.existingUser ? { id: 'u-x' } : null) : opts.account === undefined ? reviewerAccount() : opts.account)),
      findMany: jest.fn(async () => [{ id: 'rev-1', firstName: 'Rita', lastName: 'Review', email: 'rita@review.example', isActive: true }]),
      count: jest.fn(async () => (opts.inScope === false ? 0 : 1)),
      create: jest.fn(async (a: any) => ({ id: 'rev-new', email: a.data.email, firstName: a.data.firstName })),
    },
    role: { findFirst: jest.fn(async () => ({ id: 'role-ir' })) },
    employeePersonalDetail: {
      findFirst: jest.fn(async () => (opts.staffEmail ? { employeeId: 'e1' } : null)),
      // Links to us (findReviewerLinks): nobody, unless a test says so.
      findMany: jest.fn(async () => opts.links?.staff ?? []),
    },
    serviceUserContact: { findMany: jest.fn(async () => opts.links?.contacts ?? []) },
    surveyExternalContact: { findMany: jest.fn(async () => []) },
    surveyReviewerGrant: {
      create: jest.fn(async (a: any) => ({ id: 'g-new', ...a.data })),
      findFirst: jest.fn(async () => grant),
      findMany: jest.fn(async () => (grant ? [{ ...grant, revokedAt: null, user: { firstName: 'Rita', lastName: 'Review', email: 'rita@review.example', isActive: true } }] : [])),
      update: jest.fn(async (a: any) => a),
    },
    serviceUser: {
      findMany: jest.fn(async (a: any) => (a.where.id ? ['su-1', 'su-2', 'su-3'].filter((id) => a.where.id.in.includes(id)).map((id) => ({ id, firstName: 'Person', lastName: id })) : [])),
    },
    employee: { findMany: jest.fn(async () => []) },
    surveyRecipient: { findMany: jest.fn(async () => [{ serviceUserId: 'su-2', employeeId: null, status: 'COMPLETED' }]) },
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  const orgScope = new OrgScopeService(prisma);
  jest.spyOn(orgScope, 'assertServiceUserInScope').mockResolvedValue(undefined as never);
  const audit = { logAudit: jest.fn() };
  const surveys = {
    recordResponse: jest.fn(async () => ({ message: 'Response recorded', data: { id: 'resp-1' } })),
    reviewerForm: jest.fn(async () => ({ message: 'Survey to record', data: { questions: [] } })),
  };
  const auth = { sendAccountInvite: jest.fn(async () => true) };
  const notifications = { notifyUsers: jest.fn() };
  const service = new SurveyReviewersService(prisma, orgScope, audit as any, surveys as any, auth as any, notifications as any);
  return { service, prisma, audit, surveys, auth, notifications };
}

const window = { validFrom: day(0).toISOString(), validTo: day(14).toISOString() };

describe('SurveyReviewersService: survey managers', () => {
  it('gives a reviewer account access to one survey for a sample and a window, audited', async () => {
    const { service, prisma, audit } = setup();
    await service.grant(admin, 's1', { userId: 'rev-1', personIds: ['su-1', 'su-3', 'su-1'], ...window });
    expect(prisma.surveyReviewerGrant.create.mock.calls[0][0].data).toMatchObject({ surveyId: 's1', userId: 'rev-1', personIds: ['su-1', 'su-3'], createdById: 'admin-1' });
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'survey_reviewer_granted', metadata: expect.objectContaining({ sampleSize: 2, reviewerUserId: 'rev-1' }) }),
    );
  });

  it('keeps people the reviewer is connected to out of their sample', async () => {
    const family = [{ serviceUserId: 'su-3', firstName: 'Rita', lastName: 'Review', email: null, serviceUser: { firstName: 'Person', lastName: 'su-3' } }];
    await expect(
      setup({ links: { contacts: family } }).service.grant(admin, 's1', { userId: 'rev-1', personIds: ['su-1', 'su-3'], ...window }),
    ).rejects.toThrow(/Take Person su-3 out of the sample/);
    const { service, prisma } = setup({ links: { contacts: family } });
    await service.grant(admin, 's1', { userId: 'rev-1', personIds: ['su-1'], ...window });
    expect(prisma.surveyReviewerGrant.create).toHaveBeenCalled();
  });

  it('asks for a declaration when the new reviewer was previously involved with us, and records it', async () => {
    const formerStaff = [{ employeeId: 'e9', firstName: 'Rita', lastName: 'Review', email: 'old@allforcare.co.uk', employee: { isActive: false } }];
    const first = setup({ links: { staff: formerStaff } });
    const refused = first.service.createAccount(admin, 's1', { firstName: 'Rita', lastName: 'Review', email: 'rita@review.example' });
    await expect(refused).rejects.toBeInstanceOf(ConflictException);
    await expect(refused).rejects.toMatchObject({ response: { links: [{ kind: 'FORMER_STAFF', match: 'NAME' }] } });
    expect(first.prisma.user.create).not.toHaveBeenCalled();
    const { service, audit } = setup({ links: { staff: formerStaff } });
    await service.createAccount(admin, 's1', {
      firstName: 'Rita',
      lastName: 'Review',
      email: 'rita@review.example',
      declaration: 'Left in 2022, never worked with this branch',
    });
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'survey_reviewer_account_created',
        metadata: expect.objectContaining({ declaredLinks: ['Former member of staff: Rita Review'], declaration: 'Left in 2022, never worked with this branch' }),
      }),
    );
  });

  it('never grants to a staff account or an account with any other role or any branch', async () => {
    const refuse = (o: Parameters<typeof setup>[0]) =>
      expect(setup(o).service.grant(admin, 's1', { userId: 'rev-1', personIds: ['su-1'], ...window })).rejects.toThrow(NOT_A_REVIEWER_ACCOUNT);
    await refuse({ account: reviewerAccount({ userRoles: [{ role: { name: 'Care Coordinator' } }] }) });
    await refuse({ account: reviewerAccount({ userRoles: [{ role: { name: INDEPENDENT_REVIEWER_ROLE } }, { role: { name: 'Care Coordinator' } }] }) });
    await refuse({ account: reviewerAccount({ userRoles: [] }) });
    await refuse({ account: reviewerAccount({ userLocations: [{ locationId: 'loc-1' }] }) });
    // A member of staff's email (an employee record), even with only the reviewer role.
    await refuse({ staffEmail: true });
    await expect(setup({ account: null }).service.grant(admin, 's1', { userId: 'x', personIds: ['su-1'], ...window })).rejects.toThrow(/Choose a reviewer account/);
    await expect(
      setup({ account: reviewerAccount({ isActive: false }) }).service.grant(admin, 's1', { userId: 'rev-1', personIds: ['su-1'], ...window }),
    ).rejects.toThrow(/switched off/);
  });

  it('refuses a repeating survey (the period being run is given instead), a closed survey and a template', async () => {
    await expect(
      setup({ survey: { ...namedSurvey, recurrence: 'MONTHLY' } }).service.grant(admin, 's1', { userId: 'rev-1', personIds: ['su-1'], ...window }),
    ).rejects.toThrow(/repeating survey\. Open the period being run now/);
    await expect(setup({ periods: 2 }).service.grant(admin, 's1', { userId: 'rev-1', personIds: ['su-1'], ...window })).rejects.toThrow(/repeating survey/);
    // A period of a repeating survey is fine.
    const period = setup({ survey: { ...namedSurvey, clonedFromId: 'parent', recurrence: 'MONTHLY' } });
    await period.service.grant(admin, 's1', { userId: 'rev-1', personIds: ['su-1'], ...window });
    expect(period.prisma.surveyReviewerGrant.create).toHaveBeenCalled();
    await expect(
      setup({ survey: { ...namedSurvey, status: 'CLOSED' } }).service.grant(admin, 's1', { userId: 'rev-1', personIds: ['su-1'], ...window }),
    ).rejects.toThrow(/closed/);
    await expect(
      setup({ survey: { ...namedSurvey, isTemplate: true } }).service.grant(admin, 's1', { userId: 'rev-1', personIds: ['su-1'], ...window }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses: no sample on a named survey, people on an anonymous one, over 90 days, unknown people', async () => {
    await expect(setup().service.grant(admin, 's1', { userId: 'rev-1', personIds: [], ...window })).rejects.toThrow(/Choose the people/);
    await expect(
      setup({ survey: { ...namedSurvey, isAnonymous: true } }).service.grant(admin, 's1', { userId: 'rev-1', personIds: ['su-1'], ...window }),
    ).rejects.toThrow(/anonymous answers only/);
    await expect(
      setup().service.grant(admin, 's1', { userId: 'rev-1', personIds: ['su-1'], validFrom: day(-100).toISOString(), validTo: day(1).toISOString() }),
    ).rejects.toThrow(/at most 90 days/);
    await expect(setup().service.grant(admin, 's1', { userId: 'rev-1', personIds: ['su-1', 'su-9'], ...window })).rejects.toThrow(/were not found/);
  });

  it('reviewer accounts are listed and chosen only within scope: all for company-wide users, else those made in the manager’s branches', async () => {
    const { service, prisma } = setup({ survey: { ...namedSurvey, locationIds: ['loc-1'] } });
    const { data } = await service.list(branchManager, 's1');
    expect(data.accounts).toEqual([{ id: 'rev-1', name: 'Rita Review', email: 'rita@review.example', active: true }]);
    expect(data.grants[0]!.reviewer).toMatchObject({ id: 'rev-1', name: 'Rita Review' });
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({
      deletedAt: null,
      userRoles: { some: { role: { name: INDEPENDENT_REVIEWER_ROLE } }, every: { role: { name: INDEPENDENT_REVIEWER_ROLE } } },
      userLocations: { none: {} },
      OR: [{ createdById: 'bm-1' }, { createdBy: { userLocations: { some: { locationId: { in: ['loc-1'] } } } } }],
    });
    await service.list(admin, 's1');
    expect(prisma.user.findMany.mock.calls[1][0].where).not.toHaveProperty('OR');
    await expect(setup({ inScope: false, survey: { ...namedSurvey, locationIds: ['loc-1'] } }).service.grant(branchManager, 's1', { userId: 'rev-1', personIds: ['su-1'], ...window })).rejects.toThrow(
      /made in your branches/,
    );
  });

  it('"Add a reviewer" makes an account with only the reviewer role and emails a link to choose their own password', async () => {
    const { service, prisma, audit, auth } = setup();
    const res = await service.createAccount(admin, 's1', { firstName: ' Rita ', lastName: 'Review', email: 'Rita@Review.example ' });
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      email: 'rita@review.example',
      firstName: 'Rita',
      lastName: 'Review',
      createdById: 'admin-1',
      userRoles: { create: { roleId: 'role-ir' } },
    });
    // A hash of a random value nobody is given: never a password someone set or saw.
    expect(data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(JSON.stringify(res)).not.toMatch(/passwordHash/);
    expect(res.data).toEqual({ id: 'rev-new', inviteSent: true });
    expect(auth.sendAccountInvite).toHaveBeenCalledWith(
      { id: 'rev-new', email: 'rita@review.example', firstName: 'Rita' },
      expect.objectContaining({ purpose: expect.any(String) }),
    );
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'survey_reviewer_account_created', recordType: 'User', recordId: 'rev-new' }));
    await expect(setup({ staffEmail: true }).service.createAccount(admin, 's1', { firstName: 'A', lastName: 'B', email: 'staff@x' })).rejects.toThrow(/member of staff/);
    await expect(setup({ existingUser: true }).service.createAccount(admin, 's1', { firstName: 'A', lastName: 'B', email: 'a@x' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('ends access, audited', async () => {
    const { service, prisma, audit } = setup({ grant: { id: 'g1', surveyId: 's1', userId: 'rev-1', personIds: [], revokedAt: null } });
    await service.revoke(admin, 's1', 'g1');
    expect(prisma.surveyReviewerGrant.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { revokedAt: expect.any(Date), revokedById: 'admin-1' } });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'survey_reviewer_revoked', metadata: { surveyId: 's1', reviewerUserId: 'rev-1' } }));
  });
});

describe('SurveyReviewersService: the reviewer', () => {
  const answers = { channel: 'IN_PERSON', answers: [] } as any;

  it('sees only their sample (names, whether answered), never anyone else', async () => {
    const { service } = setup();
    const { data } = await service.people(reviewer, 's1');
    expect(data.map((p) => p.id)).toEqual(['su-1', 'su-2']);
    expect(data.find((p) => p.id === 'su-2')).toMatchObject({ hasResponse: true });
  });

  it('records for a sample person through Record response, limited to this survey, audited as the reviewer’s user, without answers', async () => {
    const { service, surveys, audit } = setup();
    await service.record(reviewer, 's1', { ...answers, personId: 'su-1' });
    const [actor, surveyId, dto, , opts] = (surveys.recordResponse as jest.Mock).mock.calls[0];
    expect(surveyId).toBe('s1');
    expect(dto.personId).toBe('su-1');
    expect(actor).toMatchObject({ id: 'rev-1', permissions: ['surveys.responses.record'], roles: [INDEPENDENT_REVIEWER_ROLE], assignedLocationIds: null });
    expect(opts).toEqual({ byReviewer: true });
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'survey_reviewer_response_recorded',
        // A real user now, so "Recorded by" and the audit name them.
        userId: 'rev-1',
        metadata: { surveyId: 's1', channel: 'IN_PERSON', anonymous: false, personId: 'su-1' },
      }),
    );
  });

  it('refuses people outside the sample, online answers, anyone without a live grant, and office users', async () => {
    await expect(setup().service.record(reviewer, 's1', { ...answers, personId: 'su-3' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup().service.record(reviewer, 's1', { ...answers, channel: 'ONLINE', personId: 'su-1' })).rejects.toThrow(/telephone call/);
    // Ended, revoked or never given: the same answer, giving nothing away.
    await expect(setup({ grant: null }).service.record(reviewer, 's1', { ...answers, personId: 'su-1' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup({ grant: null }).service.form(reviewer, 's1')).rejects.toBeInstanceOf(NotFoundException);
    // Without the permission (no live grant at sign-in), a grant row is not used.
    await expect(setup().service.form({ ...reviewer, permissions: [] }, 's1')).rejects.toBeInstanceOf(NotFoundException);
    expect((await setup().service.mine({ ...reviewer, permissions: [] })).data).toEqual([]);
    // Office users, mixed-role accounts and Temporary Inspector logins never act as reviewers.
    await expect(setup().service.mine(admin)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup().service.mine({ ...reviewer, accountKind: 'temporary_inspector', roles: ['Temporary Inspector'] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup().service.mine({ ...reviewer, roles: [INDEPENDENT_REVIEWER_ROLE, 'Care Coordinator'] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('on an anonymous survey every answer is recorded as anonymous, never with a person, with no audit row of its own (the daily count)', async () => {
    const anonymous = { ...namedSurvey, targetKind: 'EMPLOYEE', isAnonymous: true };
    const { service, surveys, audit } = setup({
      survey: anonymous,
      grant: { id: 'g1', surveyId: 's1', userId: 'rev-1', personIds: [], validFrom: day(-1), validTo: day(1), survey: anonymous },
    });
    await expect(service.record(reviewer, 's1', { ...answers, channel: 'PAPER', personId: 'emp-1' })).rejects.toThrow(/without choosing a person/);
    await service.record(reviewer, 's1', { ...answers, channel: 'PAPER' });
    expect((surveys.recordResponse as jest.Mock).mock.calls[0][2]).toMatchObject({ isAnonymous: true, personId: undefined });
    // Counted for the day by Record response (as a reviewer's), never a row with its own time.
    expect(audit.logAudit).not.toHaveBeenCalled();
    expect((await service.people(reviewer, 's1')).data).toEqual([]);
  });
});

describe('reviewer accounts: the permission follows the grant', () => {
  const userRow = (roles: string[], locations: string[] = []) => ({
    id: 'rev-1',
    email: 'rita@review.example',
    firstName: 'Rita',
    lastName: 'Review',
    username: null,
    userRoles: roles.map((name) => ({ role: { name, rolePermissions: [] } })),
    userLocations: locations.map((locationId) => ({ locationId, location: { id: locationId, name: locationId } })),
  });
  const users = (row: any, liveGrants: number) => {
    const prisma: any = {
      user: { findFirst: jest.fn(async () => row) },
      surveyReviewerGrant: { count: jest.fn(async () => liveGrants) },
      employeePersonalDetail: { findFirst: jest.fn(async () => null) },
      location: { findMany: jest.fn(async () => []) },
    };
    return { prisma, service: new UsersService(prisma, { logAudit: jest.fn() } as any) };
  };

  it('holds surveys.review.record only while a grant is live; it drops when revoked or expired', async () => {
    const live = users(userRow([INDEPENDENT_REVIEWER_ROLE]), 1);
    expect((await live.service.getAuthContext('rev-1'))?.permissions).toEqual([SURVEY_REVIEW_PERMISSION]);
    // Only grants not revoked, already started and not yet ended count.
    expect(live.prisma.surveyReviewerGrant.count.mock.calls[0][0].where).toMatchObject({
      userId: 'rev-1',
      revokedAt: null,
      validFrom: { lte: expect.any(Date) },
      validTo: { gte: expect.any(Date) },
      survey: { deletedAt: null },
    });
    expect((await users(userRow([INDEPENDENT_REVIEWER_ROLE]), 0).service.getAuthContext('rev-1'))?.permissions).toEqual([]);
  });

  it('never for a staff or mixed-role account, or one with a branch', async () => {
    for (const row of [userRow(['Care Coordinator']), userRow([INDEPENDENT_REVIEWER_ROLE, 'Care Coordinator']), userRow([INDEPENDENT_REVIEWER_ROLE], ['loc-1'])]) {
      const u = users(row, 1);
      expect((await u.service.getAuthContext('rev-1'))?.permissions).not.toContain(SURVEY_REVIEW_PERMISSION);
      expect(u.prisma.surveyReviewerGrant.count).not.toHaveBeenCalled();
    }
  });

  it('a Temporary Inspector login never gets it (those logins can open care records)', async () => {
    const prisma: any = {
      temporaryInspector: { findFirst: jest.fn(async () => ({ id: 'ti-1', firstName: 'T', lastName: 'I', username: 'ti', validFrom: day(-1), validTo: day(1) })) },
    };
    expect((await new TemporaryInspectorsService(prisma).getAuthContextForJwt('ti-1'))?.permissions).toEqual(['temporary_inspector.session']);
  });
});

describe('reviewer accounts reach only their account and "Surveys to record"', () => {
  const guard = new JwtAuthGuard(new Reflector());
  // Signed in (passport) as `user`; only the reviewer lockdown is under test here.
  const contextFor = (user: any, controller: any, handler: string): ExecutionContext =>
    ({
      getHandler: () => controller.prototype[handler],
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;
  beforeAll(() => {
    jest.spyOn(AuthGuard('jwt').prototype, 'canActivate').mockResolvedValue(true as never);
  });
  afterAll(() => jest.restoreAllMocks());

  it('a reviewer account is refused everything else (service users, results, other surveys), whatever the route asks', async () => {
    const serviceUserRoute = Object.getOwnPropertyNames(ServiceUsersController.prototype).find((n) => n !== 'constructor')!;
    for (const [controller, handler] of [
      [SurveysController, 'results'],
      [SurveysController, 'list'],
      [SurveysController, 'listResponses'],
      [SurveyReviewerGrantsController, 'list'],
      [ServiceUsersController, serviceUserRoute],
    ] as const) {
      await expect(guard.canActivate(contextFor(reviewer, controller, handler))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('their account, signing out and "Surveys to record" are open to them; staff are unaffected', async () => {
    for (const [controller, handler] of [
      [SurveyReviewsController, 'mine'],
      [SurveyReviewsController, 'record'],
      [AuthController, 'me'],
      [AuthController, 'logout'],
      [AuthController, 'changePassword'],
    ] as const) {
      await expect(guard.canActivate(contextFor(reviewer, controller, handler))).resolves.toBe(true);
    }
    await expect(guard.canActivate(contextFor(admin, SurveysController, 'results'))).resolves.toBe(true);
    // An account given another role is a staff account: not locked down (and never reviewing).
    await expect(guard.canActivate(contextFor({ ...reviewer, roles: [INDEPENDENT_REVIEWER_ROLE, 'Manager'] }, SurveysController, 'list'))).resolves.toBe(true);
  });
});

describe('SurveyReviewersService: staff who run surveys', () => {
  const branchSurvey = { ...namedSurvey, locationIds: ['loc-1'] };
  const coordinator = {
    id: 'u-1',
    email: 'sam@care.example',
    firstName: 'Sam',
    lastName: 'Office',
    isActive: true,
    userRoles: [{ role: { name: 'Care coordinator' } }],
    userLocations: [{ locationId: 'loc-1', location: { name: 'North' } }],
  };
  const withStaff = (survey: any = branchSurvey) => {
    const s = setup({ survey });
    s.prisma.user.findMany.mockResolvedValue([coordinator]);
    return s;
  };

  it('lists staff who can record responses in the survey’s branches, never independent reviewers', async () => {
    const { service, prisma } = withStaff();
    const res = await service.surveyStaff(admin, 's1');
    expect(res.data.staff).toEqual([{ id: 'u-1', name: 'Sam Office', email: 'sam@care.example', roles: ['Care coordinator'], branches: ['North'] }]);
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.userRoles.none).toEqual({ role: { name: INDEPENDENT_REVIEWER_ROLE } });
    expect(JSON.stringify(where)).toContain('surveys.responses.record');
  });

  it('leaves out staff whose branches do not cover the survey', async () => {
    const { service } = withStaff({ ...namedSurvey, locationIds: ['loc-2'] });
    expect((await service.surveyStaff(admin, 's1')).data.staff).toEqual([]);
  });

  it('asks chosen staff to collect answers: a notice linking to Surveys to collect, audited, no reviewer access', async () => {
    const { service, notifications, audit, prisma } = withStaff();
    await expect(service.askStaffToCollect(admin, 's1', ['u-1', 'u-1'], ' By Friday ')).resolves.toEqual({ data: { asked: 1 } });
    expect(notifications.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: ['u-1'],
        message: expect.stringContaining('By Friday'),
        metadata: expect.objectContaining({ href: '/surveys/to-collect', surveyId: 's1' }),
      }),
    );
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('Asked Sam Office to collect answers') }));
    expect(prisma.surveyReviewerGrant.create).not.toHaveBeenCalled();
  });

  it('refuses anyone who is not on the staff list, and a survey that is not live', async () => {
    await expect(withStaff().service.askStaffToCollect(admin, 's1', ['someone-else'])).rejects.toThrow('Only staff who can record');
    await expect(withStaff({ ...branchSurvey, status: 'DRAFT' }).service.askStaffToCollect(admin, 's1', ['u-1'])).rejects.toThrow('not live');
  });
});
