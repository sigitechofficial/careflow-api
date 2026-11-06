import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SurveyQuestionType } from '@prisma/client';
import { SurveyAlertsService } from './survey-alerts.service';

const SAFE_Q = { id: 'q-safe-id', key: 'q-safe', questionText: 'Do you feel safe with your care workers?', questionType: SurveyQuestionType.LIKERT, options: ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never'], config: null, otherOption: null, showIf: null, isActive: true };
const CONTACT_Q = { id: 'q-contact-id', key: 'q-contact', questionText: 'Would you like someone to contact you about your answers?', questionType: SurveyQuestionType.YES_NO, options: null, config: null, otherOption: null, showIf: null, isActive: true };
const PHONE_Q = { id: 'q-phone-id', key: 'q-phone', questionText: 'Your phone number', questionType: SurveyQuestionType.TEXT, options: null, config: null, otherOption: null, showIf: { questionKey: 'q-contact', answers: ['Yes'] }, isActive: true };

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'rule-1',
  surveyId: 's1',
  key: 'library-0',
  position: 0,
  title: 'Feels unsafe',
  whenText: 'Feels unsafe',
  actionText: 'Pass it to the safeguarding lead.',
  conditions: [{ questionKey: 'q-safe', answers: ['Rarely', 'Never'] }],
  ownerKey: 'SAFEGUARDING_LEAD',
  roleId: null,
  dueWorkingDays: 0,
  urgent: true,
  recordKind: 'SAFEGUARDING',
  contactRequest: false,
  isActive: true,
  libraryAlert: 0,
  ...over,
});

const survey = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  title: 'Quality check',
  clonedFromId: null,
  isAnonymous: false,
  allowAnonymousResponses: false,
  targetKind: 'SERVICE_USER',
  locationIds: ['loc-a', 'loc-b'],
  isTemplate: false,
  deletedAt: null,
  libraryMeta: null,
  libraryReference: null,
  alertRulesSetUpAt: new Date(),
  alertNeverRouteTo: [] as string[],
  reportingThreshold: null,
  ...over,
});

function makePrisma(opts: { rules?: unknown[]; survey?: Record<string, unknown> } = {}) {
  const created: { alerts: any[]; tasks: any[] } = { alerts: [], tasks: [] };
  const prisma: any = {
    survey: {
      findUnique: jest.fn().mockResolvedValue(survey(opts.survey)),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    surveyQuestion: { findMany: jest.fn().mockResolvedValue([SAFE_Q, CONTACT_Q, PHONE_Q]) },
    surveyAlertRule: { findMany: jest.fn().mockResolvedValue(opts.rules ?? [rule()]) },
    surveyAlertOwnerRole: { findMany: jest.fn().mockResolvedValue([]) },
    role: { findMany: jest.fn().mockResolvedValue([{ id: 'role-rm', name: 'Registered Manager' }, { id: 'role-cc', name: 'Care Coordinator' }]), findFirst: jest.fn() },
    bankHoliday: { findMany: jest.fn().mockResolvedValue([]) },
    serviceUser: { findFirst: jest.fn().mockResolvedValue({ firstName: 'Mary', lastName: 'Smith' }) },
    employeePersonalDetail: { findFirst: jest.fn() },
    surveyResponse: { findUnique: jest.fn() },
    surveyAnswer: { findMany: jest.fn() },
    surveyAlert: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn(async ({ data }: any) => {
        created.alerts.push(data);
        return data;
      }),
      update: jest.fn(),
    },
    roleTask: {
      create: jest.fn(async ({ data }: any) => {
        created.tasks.push(data);
        return data;
      }),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
    permission: { findFirst: jest.fn().mockResolvedValue(null) },
    rolePermission: { findMany: jest.fn().mockResolvedValue([]) },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn(),
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  return { prisma, created };
}

function makeService(prisma: any) {
  const audit = { logAudit: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notifyUsers: jest.fn().mockResolvedValue(undefined) };
  const orgScope = { fromRequestUser: jest.fn().mockReturnValue({ locationIds: null }) };
  const orgSettings = { getOperationalTimezone: jest.fn().mockResolvedValue('Europe/London'), getBankHolidayRegion: jest.fn().mockResolvedValue('UK') };
  return { service: new SurveyAlertsService(prisma, audit as any, notifications as any, orgScope as any, orgSettings as any), audit, notifications };
}

const namedResponse = (over: Record<string, unknown> = {}) => ({
  id: 'resp-1',
  surveyId: 's1',
  recipientId: 'rec-1',
  isAnonymous: false,
  alertsChecked: false,
  locationId: 'loc-a',
  respondentRelation: 'FAMILY_MEMBER',
  respondentName: 'John Smith',
  channel: 'TELEPHONE',
  recipient: { employeeId: null, serviceUserId: 'su-1' },
  survey: survey(),
  answers: [
    { questionId: 'q-safe-id', booleanValue: null, numberValue: null, selectedOptions: ['Never'], textValue: null, otherText: null, comment: 'They shout at me' },
    { questionId: 'q-contact-id', booleanValue: true, numberValue: null, selectedOptions: null, textValue: null, otherText: null, comment: null },
    { questionId: 'q-phone-id', booleanValue: null, numberValue: null, selectedOptions: null, textValue: '07700 900123', otherText: null, comment: null },
  ],
  ...over,
});

describe('SurveyAlertsService', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-11-06T10:15:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterAll(() => jest.useRealTimers());

  describe('named answers', () => {
    it('raises an alert and a task for the role, naming the person, the answer and their comment', async () => {
      const { prisma, created } = makePrisma();
      prisma.surveyResponse.findUnique.mockResolvedValue(namedResponse());
      const { service, audit } = makeService(prisma);
      await expect(service.checkResponse('resp-1')).resolves.toBe(1);
      // The audit entry never carries the alert title (it names the person): audit readers may
      // have no access to this survey's answers.
      for (const call of audit.logAudit.mock.calls) expect(JSON.stringify(call[0].description)).not.toContain('Mary Smith');
      expect(created.tasks).toHaveLength(1);
      expect(created.tasks[0]).toMatchObject({
        roleId: 'role-rm', // Safeguarding lead → the Registered Manager role by its usual name
        sourceType: 'SURVEY_ALERT',
        templateId: null,
        locationId: 'loc-a',
        // Role tasks never name the person (everyone who manages role tasks can list them).
        title: 'Urgent: Feels unsafe',
        dueDate: new Date('2026-11-06T00:00:00.000Z'),
      });
      expect(created.tasks[0].link).toMatch(/^\/surveys\/follow-ups\?alert=/);
      // The task (listed to everyone who manages role tasks) never carries the answers or comments.
      expect(created.tasks[0].description).not.toContain('They shout at me');
      expect(created.tasks[0].description).not.toContain('Never');
      expect(prisma.bankHoliday.findMany.mock.calls[0][0].where.isActive).toBe(true);
      const a = created.alerts[0];
      expect(a).toMatchObject({ unlinked: false, responseId: 'resp-1', serviceUserId: 'su-1', urgent: true, recordKind: 'SAFEGUARDING' });
      expect(a.details).toContain('Mary Smith answered "Quality check" by phone, answered by a family member (John Smith)');
      expect(a.details).toContain('"Do you feel safe with your care workers?": Never');
      expect(a.details).toContain('Their comment: "They shout at me"');
    });

    it('adds the contact details the person gave to a contact-me follow-up', async () => {
      const { prisma, created } = makePrisma({
        rules: [rule({ id: 'rule-c', title: 'Asked to be contacted', conditions: [{ questionKey: 'q-contact', answers: ['Yes'] }], ownerKey: 'CARE_COORDINATOR', urgent: false, contactRequest: true, dueWorkingDays: 5 })],
      });
      prisma.surveyResponse.findUnique.mockResolvedValue(namedResponse());
      const { service } = makeService(prisma);
      await service.checkResponse('resp-1');
      expect(created.alerts[0]).toMatchObject({ contactRequest: true, roleId: 'role-cc', dueDate: new Date('2026-11-13T00:00:00.000Z') });
      expect(created.alerts[0].details).toContain('Your phone number 07700 900123');
    });

    it('uses calendar days when the rule has them ("within 7 days")', async () => {
      const { prisma, created } = makePrisma({ rules: [rule({ dueWorkingDays: 0, dueCalendarDays: 7, urgent: false })] });
      prisma.surveyResponse.findUnique.mockResolvedValue(namedResponse());
      await makeService(prisma).service.checkResponse('resp-1');
      expect(created.alerts[0].dueDate).toEqual(new Date('2026-11-13T00:00:00.000Z'));
    });

    it('does nothing when the response was already checked by a racing call', async () => {
      const { prisma, created } = makePrisma();
      prisma.surveyResponse.findUnique.mockResolvedValue(namedResponse());
      prisma.$executeRaw.mockResolvedValue(0);
      const { service } = makeService(prisma);
      await expect(service.checkResponse('resp-1')).resolves.toBe(0);
      expect(created.alerts).toHaveLength(0);
    });

    it.each([
      ['an answer given without a name', { isAnonymous: true, recipientId: null }],
      ['an answer to an anonymous survey', { recipientId: null, survey: survey({ isAnonymous: true }) }],
    ])('never alerts on %s one by one (left to the grouped sweep)', async (_label, over) => {
      const { prisma, created } = makePrisma();
      prisma.surveyResponse.findUnique.mockResolvedValue(namedResponse(over));
      const { service } = makeService(prisma);
      await expect(service.checkResponse('resp-1')).resolves.toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(created.alerts).toHaveLength(0);
    });
  });

  describe('answers linked to no one', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}` }));
    /** The sweep's three raw queries: the rows to check, the claim, then the count of failing rows. */
    const sweepRows = (prisma: any, claimed: Array<{ id: string }>) =>
      prisma.$queryRaw
        .mockResolvedValueOnce(claimed.map((c) => ({ id: c.id, surveyId: 's1', unlinked: true })))
        .mockResolvedValueOnce(claimed)
        .mockResolvedValueOnce([{ failing: 0 }]);
    const safe = (responseId: string, answer: string) => ({ responseId, questionId: 'q-safe-id', booleanValue: null, numberValue: null, selectedOptions: [answer] });

    it('raises one grouped alert at the close with counts only: no person, response, written answer, branch or time of day', async () => {
      const { prisma, created } = makePrisma({ survey: { isAnonymous: true, status: 'CLOSED' } });
      sweepRows(prisma, ids(6));
      prisma.surveyAnswer.findMany.mockResolvedValue([safe('r1', 'Never'), safe('r2', 'Rarely'), safe('r3', 'Always'), safe('r4', 'Always'), safe('r5', 'Usually'), safe('r6', 'Always')]);
      const { service, notifications } = makeService(prisma);
      await expect(service.sweep()).resolves.toEqual({ named: 0, grouped: 1, failing: 0 });
      expect(created.alerts).toHaveLength(1);
      const a = created.alerts[0];
      expect(a).toMatchObject({ unlinked: true, matchCount: 2, responseId: null, serviceUserId: null, employeeId: null, contactRequest: false, locationId: null });
      // The day only (midnight UK time), never the time it was checked.
      expect(a.createdAt.toISOString()).toBe('2026-11-06T00:00:00.000Z');
      expect(created.tasks[0].createdAt.toISOString()).toBe('2026-11-06T00:00:00.000Z');
      // Anonymous: the task says neither the rule nor the survey (a title can point at someone).
      expect(created.tasks[0].title).toBe('Urgent: A survey answer needs follow-up');
      expect(created.tasks[0].description).not.toContain('Quality check');
      expect(a.details).toContain('Never (1), Rarely (1)');
      expect(a.details).not.toMatch(/comment/i);
      expect(a.title).toBe('Feels unsafe');
      // Answers were never read for written text.
      expect(prisma.surveyAnswer.findMany.mock.calls[0][0].select).toEqual({ responseId: true, questionId: true, booleanValue: true, numberValue: true, selectedOptions: true });
      expect(notifications.notifyUsers).not.toHaveBeenCalled(); // nobody holds the role or manages surveys here
    });

    it('never looks at answers linked to no one while the survey is open (the sweep query leaves them out)', async () => {
      const { prisma, created } = makePrisma({ survey: { isAnonymous: true, status: 'ACTIVE' } });
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ failing: 0 }]);
      const { service } = makeService(prisma);
      await service.sweep(new Date('2026-11-06T10:15:00Z'));
      const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
      expect(sql).toMatch(/s\."status" = 'CLOSED'/);
      expect(sql).toMatch(/"closesAt" <= \?/);
      expect(created.alerts).toHaveLength(0);
      // And the guard inside: an open survey is never grouped even if asked.
      await expect((service as any).raiseGrouped('s1')).resolves.toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('raises nothing when fewer than the reporting threshold answered without a name (e.g. a few late answers)', async () => {
      const { prisma, created } = makePrisma({ survey: { isAnonymous: true, status: 'CLOSED' } });
      sweepRows(prisma, ids(4));
      prisma.surveyAnswer.findMany.mockResolvedValue([safe('r1', 'Never')]);
      const { service } = makeService(prisma);
      await expect(service.sweep()).resolves.toMatchObject({ grouped: 0 });
      expect(created.alerts).toHaveLength(0);
      expect(prisma.surveyAnswer.findMany).not.toHaveBeenCalled(); // claimed (checked), never read
    });

    it("follows the survey's own threshold and a rule's higher minimum (e.g. 10 for abuse or equality)", async () => {
      const t = makePrisma({ survey: { isAnonymous: true, status: 'CLOSED', reportingThreshold: 8 } });
      sweepRows(t.prisma, ids(6));
      t.prisma.surveyAnswer.findMany.mockResolvedValue([safe('r1', 'Never')]);
      await makeService(t.prisma).service.sweep();
      expect(t.created.alerts).toHaveLength(0);

      const r = makePrisma({ survey: { isAnonymous: true, status: 'CLOSED' }, rules: [rule({ minimumAnswers: 10 }), rule({ id: 'rule-2', title: 'Second', minimumAnswers: null })] });
      sweepRows(r.prisma, ids(6));
      r.prisma.surveyAnswer.findMany.mockResolvedValue([safe('r1', 'Never')]);
      await makeService(r.prisma).service.sweep();
      expect(r.created.alerts.map((a: any) => a.title)).toEqual(['Second']);
    });

    it('keeps the branch only when the survey is for one branch, and never raises contact-me', async () => {
      const { prisma, created } = makePrisma({
        survey: { isAnonymous: true, status: 'CLOSED', locationIds: ['loc-a'] },
        rules: [rule(), rule({ id: 'rule-c', conditions: [{ questionKey: 'q-contact', answers: ['Yes'] }], contactRequest: true })],
      });
      sweepRows(prisma, ids(5));
      prisma.surveyAnswer.findMany.mockResolvedValue([
        safe('r1', 'Never'),
        { responseId: 'r1', questionId: 'q-contact-id', booleanValue: true, numberValue: null, selectedOptions: null },
      ]);
      const { service } = makeService(prisma);
      await service.sweep();
      expect(created.alerts).toHaveLength(1);
      expect(created.alerts[0].locationId).toBe('loc-a');
    });

    it('counts a failed check and leaves rows that keep failing (they cannot hold up the rest)', async () => {
      const { prisma } = makePrisma();
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'n1', surveyId: 's1', unlinked: false }]).mockResolvedValueOnce([{ failing: 1 }]);
      prisma.surveyResponse.findUnique.mockRejectedValue(new Error('boom'));
      const { service } = makeService(prisma);
      await expect(service.sweep()).resolves.toEqual({ named: 0, grouped: 0, failing: 1 });
      expect(prisma.$executeRaw.mock.calls[0][0].join('?')).toMatch(/"alertCheckFailures" = "alertCheckFailures" \+ 1/);
      expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toMatch(/ORDER BY r\."alertCheckFailures" ASC/);
    });
  });

  describe('roles a survey rates', () => {
    it('never gives an alert to a role the survey rates: it goes to the next role up', async () => {
      const { prisma, created } = makePrisma({
        survey: { alertNeverRouteTo: ['CARE_COORDINATOR'] },
        rules: [rule({ ownerKey: 'CARE_COORDINATOR', urgent: false })],
      });
      prisma.survey.findUnique.mockImplementation(async () => survey({ alertNeverRouteTo: ['CARE_COORDINATOR'] }));
      prisma.surveyResponse.findUnique.mockResolvedValue(namedResponse());
      await makeService(prisma).service.checkResponse('resp-1');
      expect(created.tasks[0].roleId).toBe('role-rm');
    });

    it('refuses to reassign a follow-up to a role the survey rates, and tells a new role when reassigned', async () => {
      const { prisma } = makePrisma();
      const base = { id: 'al-1', surveyId: 's1', roleId: 'role-rm', roleTaskId: 'task-1', ruleId: 'rule-1', contactRequest: false, unlinked: false, matchCount: 1, outcomeKind: null, outcome: null, ownerUserId: null, locationId: null, linkedRecordId: null, title: 'Feels unsafe: Mary Smith', details: 'x', dueDate: new Date('2026-11-06'), urgent: false };
      const actor: any = { id: 'u1', permissions: ['surveys.manage'], roles: [], accountKind: 'user' };
      prisma.surveyAlert.findUnique.mockResolvedValue({ ...base, survey: survey({ alertNeverRouteTo: ['CARE_COORDINATOR'] }) });
      prisma.survey.findUnique.mockResolvedValue(survey({ alertNeverRouteTo: ['CARE_COORDINATOR'] }));
      prisma.role.findFirst.mockResolvedValue({ id: 'role-cc', name: 'Care Coordinator' });
      const { service, notifications } = makeService(prisma);
      await expect(service.updateFollowUp(actor, 'al-1', { roleId: 'role-cc' })).rejects.toThrow(/rates the Care Coordinator role/);

      prisma.survey.findUnique.mockResolvedValue(survey());
      prisma.surveyAlert.findUnique.mockResolvedValue({ ...base, survey: survey() });
      prisma.userRole.findMany.mockResolvedValue([{ userId: 'cc-user', user: { userLocations: [] } }]);
      prisma.surveyAlertRule.findUnique = jest.fn().mockResolvedValue({ title: 'Feels unsafe' });
      await service.updateFollowUp(actor, 'al-1', { roleId: 'role-cc' });
      const notice = notifications.notifyUsers.mock.calls[0][0];
      expect(notice.recipientUserIds).toEqual(['cc-user']);
      expect(notice.message).toBe('Given to your role: Feels unsafe. Due 2026-11-06.');
      expect(`${notice.title} ${notice.message}`).not.toMatch(/Mary/);
    });

    it('tells survey managers when the only holder of the role is the manager the copy rates', async () => {
      const { prisma } = makePrisma();
      const rated = survey({ accessPolicy: { excludeUserIds: ['cc-user'] } });
      const base = { id: 'al-1', surveyId: 's1', roleId: 'role-rm', roleTaskId: 'task-1', ruleId: 'rule-1', contactRequest: false, unlinked: true, matchCount: 2, outcomeKind: null, outcome: null, ownerUserId: null, locationId: null, linkedRecordId: null, title: 'x', details: 'x', dueDate: new Date('2026-11-06'), urgent: false };
      const actor: any = { id: 'admin-1', permissions: ['surveys.manage'], roles: ['Admin'], accountKind: 'user' };
      prisma.surveyAlert.findUnique.mockResolvedValue({ ...base, survey: rated });
      prisma.survey.findUnique.mockResolvedValue(rated);
      prisma.role.findFirst.mockResolvedValue({ id: 'role-cc', name: 'Care Coordinator' });
      prisma.permission.findFirst.mockResolvedValue({ id: 'perm-manage' });
      prisma.rolePermission.findMany.mockResolvedValue([{ roleId: 'role-sm' }]);
      prisma.userRole.findMany.mockImplementation(async ({ where }: any) =>
        where.roleId === 'role-cc'
          ? [{ userId: 'cc-user', user: { userLocations: [] } }]
          : [{ userId: 'sm-user', user: { userLocations: [] } }, { userId: 'cc-user', user: { userLocations: [] } }],
      );
      prisma.surveyAlertRule.findUnique = jest.fn().mockResolvedValue({ title: 'Feels unsafe' });
      const { service, notifications } = makeService(prisma);
      await service.updateFollowUp(actor, 'al-1', { roleId: 'role-cc' });
      // Before: the rated manager was dropped and nobody was told. Now the survey managers are, never them.
      expect(notifications.notifyUsers).toHaveBeenCalledTimes(1);
      expect(notifications.notifyUsers.mock.calls[0][0].recipientUserIds).toEqual(['sm-user']);
    });
  });

  describe('AND / NOT conditions', () => {
    it('raises an "all of these" rule only when every condition holds, and a "not chosen" one for a checklist gap', async () => {
      const rules = [
        rule({ id: 'and', title: 'Unsafe and wants a call', urgent: false, conditions: [{ all: [{ questionKey: 'q-safe', answers: ['Never'] }, { questionKey: 'q-contact', answers: ['Yes'] }] }] }),
        rule({ id: 'and-no', title: 'Unsafe and no call', urgent: false, conditions: [{ all: [{ questionKey: 'q-safe', answers: ['Never'] }, { questionKey: 'q-contact', answers: ['No'] }] }] }),
        rule({ id: 'not', title: 'Never said Always', urgent: false, conditions: [{ questionKey: 'q-safe', answers: ['Always'], not: true }] }),
      ];
      const { prisma, created } = makePrisma({ rules });
      prisma.surveyResponse.findUnique.mockResolvedValue(namedResponse());
      const { service } = makeService(prisma);
      await expect(service.checkResponse('resp-1')).resolves.toBe(2);
      expect(created.alerts.map((a: any) => a.ruleId)).toEqual(['and', 'not']);
      expect(created.alerts[1].details).toContain('none of: Always');
    });
  });

  describe('follow-ups', () => {
    const alertRow = (over: Record<string, unknown> = {}) => ({
      id: 'al-1',
      surveyId: 's1',
      roleId: 'role-cc',
      roleTaskId: 'task-1',
      contactRequest: true,
      outcomeKind: null,
      outcome: null,
      ownerUserId: null,
      locationId: null,
      linkedRecordId: null,
      title: 'Asked to be contacted',
      survey: survey(),
      ...over,
    });

    it('refuses to close a contact request without saying what happened', async () => {
      const { prisma } = makePrisma();
      prisma.surveyAlert.findUnique.mockResolvedValue(alertRow());
      const { service } = makeService(prisma);
      const actor: any = { id: 'u1', permissions: ['surveys.manage'], roles: [], accountKind: 'user' };
      await expect(service.updateFollowUp(actor, 'al-1', { status: 'DONE' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets only survey managers or the role it was given to update it', async () => {
      const { prisma } = makePrisma();
      prisma.surveyAlert.findUnique.mockResolvedValue(alertRow());
      prisma.role.findMany.mockResolvedValue([{ id: 'role-other' }]);
      const { service } = makeService(prisma);
      const actor: any = { id: 'u2', permissions: ['surveys.read'], roles: ['Accountant'], accountKind: 'user' };
      await expect(service.updateFollowUp(actor, 'al-1', { outcome: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('closes the task with the outcome and audits it', async () => {
      const { prisma } = makePrisma();
      prisma.surveyAlert.findUnique.mockResolvedValue(alertRow());
      prisma.roleTask.findUnique.mockResolvedValue({ id: 'task-1', status: 'OPEN', startedAt: null, note: null });
      const { service, audit } = makeService(prisma);
      const actor: any = { id: 'u1', permissions: ['surveys.manage'], roles: [], accountKind: 'user' };
      await service.updateFollowUp(actor, 'al-1', { status: 'DONE', outcomeKind: 'CONTACTED', outcome: 'Spoke to her daughter' });
      expect(prisma.roleTask.update.mock.calls[0][0].data).toMatchObject({ status: 'DONE', completedById: 'u1', note: 'Spoke to her daughter' });
      expect(prisma.surveyAlert.update.mock.calls[0][0].data).toMatchObject({ outcomeKind: 'CONTACTED', outcome: 'Spoke to her daughter' });
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'survey_alert_updated' }));
    });
  });

  describe('follow-up list', () => {
    it('lists every open follow-up, however many are done', async () => {
      const { prisma } = makePrisma();
      prisma.roleTask.findMany = jest.fn().mockResolvedValueOnce([{ id: 'task-open' }]).mockResolvedValue([]);
      prisma.surveyAlert.findMany = jest.fn().mockResolvedValue([]);
      const { service } = makeService(prisma);
      const actor: any = { id: 'u1', permissions: ['surveys.read'], roles: [], accountKind: 'user' };
      await service.listFollowUps(actor, { view: 'open' } as any);
      expect(prisma.surveyAlert.findMany).toHaveBeenCalledTimes(1);
      const call = prisma.surveyAlert.findMany.mock.calls[0][0];
      expect(call.take).toBeUndefined();
      expect(call.where.AND[1]).toEqual({ OR: [{ roleTaskId: null }, { roleTaskId: { in: ['task-open'] } }] });
    });
  });

  describe('copies', () => {
    it('keeps a rule’s minimum answers on a copy (duplicate or template use)', async () => {
      const { prisma } = makePrisma({ rules: [rule({ id: 'rule-m', key: 'own-1', libraryAlert: null, minimumAnswers: 10 })] });
      prisma.surveyAlertRule.createMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.survey.update = jest.fn().mockResolvedValue({});
      prisma.$transaction = jest.fn(async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
      const { service } = makeService(prisma);
      await service.copyRules('s1', 's2', { anonymous: false });
      expect(prisma.surveyAlertRule.createMany.mock.calls[0][0].data[0]).toMatchObject({ surveyId: 's2', minimumAnswers: 10 });
    });
  });

  describe('rules', () => {
    it('refuses a contact-me follow-up on an anonymous survey', async () => {
      const { prisma } = makePrisma();
      prisma.survey.findFirst.mockResolvedValue(survey({ isAnonymous: true }));
      const { service } = makeService(prisma);
      const actor: any = { id: 'u1', permissions: ['surveys.manage'], roles: [], accountKind: 'user' };
      await expect(
        service.createRule(actor, 's1', {
          title: 'Call them',
          actionText: 'Call them back',
          conditions: [{ questionKey: 'q-contact', answers: ['Yes'] }],
          dueWorkingDays: 5,
          contactRequest: true,
        }),
      ).rejects.toThrow(/anonymous survey cannot have a contact-me/);
    });

    it('refuses both working and calendar days, like the library', async () => {
      const { prisma } = makePrisma();
      prisma.survey.findFirst.mockResolvedValue(survey());
      const actor: any = { id: 'u1', permissions: ['surveys.manage'], roles: [], accountKind: 'user' };
      await expect(
        makeService(prisma).service.createRule(actor, 's1', { title: 'Call', actionText: 'Call them', conditions: [{ questionKey: 'q-safe', answers: ['Never'] }], dueWorkingDays: 5, dueCalendarDays: 7 }),
      ).rejects.toThrow(/either working days or calendar days/);
    });

    it('refuses a rule role that cannot see a restricted survey’s results', async () => {
      const hrOnly = { responses: { restricted: true, ownerKeys: ['REGISTERED_MANAGER'], roleIds: [], userIds: [] }, results: { restricted: true, ownerKeys: ['REGISTERED_MANAGER'], roleIds: [], userIds: [] } };
      const { prisma } = makePrisma({ survey: { accessPolicy: hrOnly } });
      prisma.survey.findFirst.mockResolvedValue(survey({ accessPolicy: hrOnly }));
      const actor: any = { id: 'u1', permissions: ['surveys.manage'], roles: [], accountKind: 'user' };
      const service = makeService(prisma).service;
      const base = { title: 'Call', actionText: 'Call them', conditions: [{ questionKey: 'q-safe', answers: ['Never'] }], dueWorkingDays: 5 };
      await expect(service.createRule(actor, 's1', { ...base, ownerKey: 'CARE_COORDINATOR' })).rejects.toThrow(/Care Coordinator cannot see this survey's results/);
      prisma.surveyAlertRule.aggregate = jest.fn().mockResolvedValue({ _max: { position: 0 } });
      prisma.surveyAlertRule.create = jest.fn().mockResolvedValue({ id: 'new', title: 'Call' });
      await expect(service.createRule(actor, 's1', { ...base, ownerKey: 'REGISTERED_MANAGER' })).resolves.toMatchObject({ data: { id: 'new' } });
    });

    it('refuses conditions on written answers', async () => {
      const { prisma } = makePrisma();
      prisma.survey.findFirst.mockResolvedValue(survey());
      const { service } = makeService(prisma);
      const actor: any = { id: 'u1', permissions: ['surveys.manage'], roles: [], accountKind: 'user' };
      await expect(
        service.createRule(actor, 's1', { title: 'Phone', actionText: 'x x x', conditions: [{ questionKey: 'q-phone', answers: ['x'] }], dueWorkingDays: 1 }),
      ).rejects.toThrow(/written answer/);
    });
  });
});

