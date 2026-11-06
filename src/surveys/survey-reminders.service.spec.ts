import { Logger } from '@nestjs/common';
import { SurveyRemindersService } from './survey-reminders.service';
import { surveyAccessFor, surveyResultsAudience } from './survey-access';
import { ineligibleRecipientIds } from './survey-eligibility.util';

jest.mock('./survey-eligibility.util', () => {
  const actual = jest.requireActual('./survey-eligibility.util');
  // Who can still be sent a survey is tested in survey-eligibility.util.spec; here everyone can unless a test says.
  return { ...actual, ineligibleRecipientIds: jest.fn(async () => new Set<string>()) };
});


jest.mock('./survey-access', () => ({
  surveyAccessFor: jest.fn(),
  surveyResultsAudience: jest.fn(),
}));

const access = surveyAccessFor as jest.Mock;
const audience = surveyResultsAudience as jest.Mock;

const DAY = 86_400_000;
// Wednesday 11:00 in London (GMT): outside the default quiet hours.
const NOW = new Date('2026-11-11T11:00:00Z');

const plan = { reminders: [{ afterDays: 3 }, { afterDays: 7 }], channels: ['APP', 'EMAIL', 'TEXT'], quietStart: '20:00', quietEnd: '09:00', weekdaysOnly: false, call: null };

const survey = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  title: 'Staff survey',
  targetKind: 'EMPLOYEE',
  status: 'ACTIVE',
  isAnonymous: false,
  isTemplate: false,
  isCatalogue: false,
  deletedAt: null,
  locationIds: [],
  closesAt: null,
  clonedFromId: null,
  contactPlan: plan,
  libraryMeta: null,
  accessPolicy: null,
  createdById: 'u1',
  ...over,
});

type Rec = { id: string; token: string; status: string; employeeId: string | null; serviceUserId: string | null; sentAt: Date; reminderCount: number; remindedAt: Date | null };

function setup(opts: { survey?: Record<string, unknown>; recipients?: Rec[]; optOuts?: Array<{ subjectKind: string; subjectId: string; channel: string }>; textMode?: string } = {}) {
  const s = survey(opts.survey);
  const recipients: Rec[] = opts.recipients ?? [
    { id: 'r1', token: 'tok-1', status: 'SENT', employeeId: 'e1', serviceUserId: null, sentAt: new Date(NOW.getTime() - 4 * DAY), reminderCount: 0, remindedAt: null },
    { id: 'r2', token: 'tok-2', status: 'COMPLETED', employeeId: 'e2', serviceUserId: null, sentAt: new Date(NOW.getTime() - 4 * DAY), reminderCount: 0, remindedAt: null },
    { id: 'r3', token: 'tok-3', status: 'STARTED', employeeId: 'e3', serviceUserId: null, sentAt: new Date(NOW.getTime() - 1 * DAY), reminderCount: 0, remindedAt: null },
  ];
  const updates: Array<{ values: unknown[] }> = [];
  const prisma: any = {
    survey: {
      findFirst: jest.fn().mockResolvedValue(s),
      findUnique: jest.fn().mockResolvedValue(s),
      findMany: jest.fn(async ({ where }: any) => (where?.clonedFromId ? [] : [{ ...s, clonedFrom: null }])),
      update: jest.fn(async ({ data }: any) => ({ ...s, ...data })),
    },
    surveyRecipient: {
      findMany: jest.fn(async ({ where }: any) =>
        where.invitationTextPending ? [] : recipients.filter(
          (r) =>
            (!where.status?.in || where.status.in.includes(r.status)) &&
            (where.reminderCount?.lt === undefined || r.reminderCount < where.reminderCount.lt),
        ).map((r) => ({ ...r, callAttempts: [] })),
      ),
      findFirst: jest.fn(async ({ where }: any) => recipients.find((r) => r.id === where.id) ?? null),
      count: jest.fn(async () => recipients.filter((r) => r.status === 'COMPLETED').length),
    },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      updates.push({ values });
      const ids = values.find(Array.isArray) as string[];
      return ids.map((id) => ({ id }));
    }),
    surveyReminderRun: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([{ id: 'run1', surveyId: 's1', step: 1, manual: false, people: 6, email: 6, app: 0, portal: 0, text: 0, noContact: 0, optedOut: 0, createdAt: NOW }]) },
    surveyContactOptOut: { findMany: jest.fn().mockResolvedValue(opts.optOuts ?? []) },
    employeePersonalDetail: {
      findMany: jest.fn().mockResolvedValue([
        { employeeId: 'e1', firstName: 'Zara', lastName: 'Ali', email: 'zara@example.test', mobileTelephone: '07700 900123', homeTelephone: null },
        { employeeId: 'e3', firstName: 'Ola', lastName: 'Bee', email: 'ola@example.test', mobileTelephone: null, homeTelephone: null },
      ]),
    },
    serviceUser: { findMany: jest.fn().mockResolvedValue([]) },
    companyProfile: { findFirst: jest.fn().mockResolvedValue({ displayName: 'Example Care', companyName: 'Example Care Ltd' }) },
    roleTask: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn() },
    role: { findMany: jest.fn().mockResolvedValue([{ id: 'role-cc', name: 'Care Coordinator' }]), findFirst: jest.fn() },
    surveyAlertOwnerRole: { findUnique: jest.fn().mockResolvedValue(null) },
    userRole: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    surveyCallAttempt: { create: jest.fn(async () => ({ id: 'call1' })) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const audit = { logAudit: jest.fn() };
  const config = { get: (k: string, d?: unknown) => (k === 'app.adminAppUrl' ? 'https://care.example' : k === 'TEXT_MESSAGE_MODE' ? opts.textMode : d) };
  const mail = { send: jest.fn().mockResolvedValue({}) };
  const push = { sendToEmployees: jest.fn().mockResolvedValue({ sent: 1 }) };
  const texts = { isEnabled: () => opts.textMode !== 'off', supportsReplies: () => false, providerName: () => 'log', send: jest.fn().mockResolvedValue({ sent: true, messageId: 'x' }) };
  const notifications = { notifyUsers: jest.fn() };
  const orgScope = { fromRequestUser: () => ({ locationIds: null }) };
  const orgSettings = { getOperationalTimezone: async () => 'Europe/London' };
  const svc = new SurveyRemindersService(prisma, audit as any, config as any, mail as any, push as any, texts as any, notifications as any, orgScope as any, orgSettings as any);
  return { svc, prisma, audit, mail, push, texts, notifications, updates };
}

const actor = { id: 'u1', roles: [], permissions: [] } as any;

beforeAll(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  access.mockResolvedValue({ results: true, responses: true, threshold: 5 });
  audience.mockResolvedValue({ restricted: false, roleIds: null, userIds: [], createdById: 'u1' });
});
afterEach(() => jest.useRealTimers());

describe('SurveyRemindersService — the survey job', () => {
  it('reminds only people who have not answered and whose step is due, by every chosen channel', async () => {
    const { svc, push, mail, texts, prisma, audit } = setup();
    const r = await svc.runDue(NOW);
    expect(r.reminded).toBe(1);
    expect(push.sendToEmployees).toHaveBeenCalledWith(['e1'], expect.objectContaining({ data: expect.objectContaining({ token: 'tok-1' }) }));
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(mail.send.mock.calls[0][0].to).toBe('zara@example.test');
    expect(mail.send.mock.calls[0][0].text).toContain('https://care.example/survey/tok-1');
    expect(texts.send).toHaveBeenCalledWith({ to: '+447700900123', body: expect.stringContaining('tok-1') });
    expect(prisma.surveyReminderRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ step: 1, people: 1, app: 1, email: 1, text: 1 }) });
    // Audit: counts only — no address, number, name or link.
    const row = JSON.stringify(audit.logAudit.mock.calls[0][0]);
    expect(row).not.toMatch(/zara|07700|900123|tok-1|Zara/);
  });

  it('sends nothing during quiet hours', async () => {
    const { svc, push, mail } = setup();
    const r = await svc.runDue(new Date('2026-11-11T21:30:00Z'));
    expect(r.reminded).toBe(0);
    expect(push.sendToEmployees).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('anonymous surveys: no personal link or token in any message, and the reminder is stamped with the day only', async () => {
    const { svc, push, mail, texts, updates } = setup({ survey: { isAnonymous: true } });
    await svc.runDue(NOW);
    const everything = JSON.stringify([push.sendToEmployees.mock.calls, mail.send.mock.calls, texts.send.mock.calls]);
    expect(everything).not.toContain('tok-1');
    expect(everything).not.toContain('/survey/');
    const stamp = updates[0].values.find((v) => v instanceof Date) as Date;
    expect(stamp.toISOString()).toBe('2026-11-11T00:00:00.000Z');
  });

  it('honours opt-outs per channel and counts people who opted out of everything', async () => {
    const one = setup({ optOuts: [{ subjectKind: 'EMPLOYEE', subjectId: 'e1', channel: 'EMAIL' }] });
    await one.svc.runDue(NOW);
    expect(one.mail.send).not.toHaveBeenCalled();
    expect(one.push.sendToEmployees).toHaveBeenCalled();

    const all = setup({ optOuts: [{ subjectKind: 'EMPLOYEE', subjectId: 'e1', channel: 'ALL' }] });
    await all.svc.runDue(NOW);
    expect(all.mail.send).not.toHaveBeenCalled();
    expect(all.push.sendToEmployees).not.toHaveBeenCalled();
    expect(all.texts.send).not.toHaveBeenCalled();
    expect(all.prisma.surveyReminderRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ people: 0, optedOut: 1 }) });
  });

  it('never reminds someone a second server already took (the reminder count moved on)', async () => {
    const { svc, prisma, push } = setup();
    prisma.$queryRaw.mockResolvedValue([]);
    await svc.runDue(NOW);
    expect(push.sendToEmployees).not.toHaveBeenCalled();
    expect(prisma.surveyReminderRun.create).not.toHaveBeenCalled();
  });

  it('starts one call list task for a named survey, with a count and no names', async () => {
    const callPlan = { ...plan, call: { afterDays: 3, roleId: null, ownerKey: 'CARE_COORDINATOR', withinDays: 5 } };
    const { svc, prisma } = setup({ survey: { contactPlan: callPlan } });
    const r = await svc.runDue(NOW);
    expect(r.callTasks).toBe(1);
    const task = prisma.roleTask.create.mock.calls[0][0].data;
    expect(task).toMatchObject({ sourceType: 'SURVEY_CALL_LIST', sourceId: 's1', roleId: 'role-cc', link: '/surveys/s1/calls' });
    expect(task.description).toContain('1 person has not answered');
    expect(JSON.stringify(task)).not.toMatch(/Zara|Ali/);
  });

  it('uses generic task wording when the survey’s answers are limited to some people', async () => {
    audience.mockResolvedValue({ restricted: true, roleIds: new Set(['x']), userIds: [], createdById: 'u1' });
    const callPlan = { ...plan, call: { afterDays: 3, roleId: null, ownerKey: 'CARE_COORDINATOR', withinDays: 5 } };
    const { svc, prisma } = setup({ survey: { contactPlan: callPlan, title: 'Feedback on your manager: Jo' } });
    await svc.runDue(NOW);
    expect(prisma.roleTask.create.mock.calls[0][0].data.title).toBe('Phone people who have not answered a survey');
  });
});

describe('SurveyRemindersService — plan and Remind now', () => {
  it('anonymous surveys: reminder counts are hidden until enough have answered to report', async () => {
    const { svc } = setup({ survey: { isAnonymous: true } });
    const res = await svc.getPlan(actor, 's1');
    expect(res.data.runs[0].counts).toBeNull();
    expect(res.data.runs[0].at).toBe('2026-11-11');
    expect(res.data.callListAvailable).toBe(false);
  });

  it('named surveys show the counts to people who may see the figures, and never to others', async () => {
    const shown = await setup().svc.getPlan(actor, 's1');
    expect(shown.data.runs[0].counts).toMatchObject({ people: 6 });
    access.mockResolvedValue({ results: false, responses: false, threshold: 5 });
    const hidden = await setup().svc.getPlan(actor, 's1');
    expect(hidden.data.runs[0].counts).toBeNull();
  });

  it('refuses a call list on an anonymous survey and changes to a period’s plan', async () => {
    const callPlan = { ...plan, call: { afterDays: 10 } };
    await expect(setup({ survey: { isAnonymous: true } }).svc.savePlan(actor, 's1', callPlan)).rejects.toThrow(/Anonymous surveys have no call list/);
    await expect(setup({ survey: { clonedFromId: 'src' } }).svc.savePlan(actor, 's1', plan)).rejects.toThrow(/repeating survey itself/);
  });

  it('Remind now on an anonymous survey never says how many were reminded', async () => {
    const { svc, audit } = setup({ survey: { isAnonymous: true } });
    const res = await svc.remindNow(actor, 's1');
    expect(res.data.reminded).toBeNull();
    expect(res.message).toBe('Reminders are on their way to everyone who has not answered and can be reminded now.');
    // The audit row (exact time, open to audit readers) holds no counts on an anonymous survey.
    const row = (audit.logAudit as jest.Mock).mock.calls.find((c) => c[0].action === 'survey_reminders_sent')?.[0];
    expect(row).toBeDefined();
    expect(row.newValues).toEqual({ step: null, manual: true });
  });

  it('Remind now on an anonymous survey answers the same when no one is left to remind', async () => {
    const { svc } = setup({ survey: { isAnonymous: true }, recipients: [] });
    const res = await svc.remindNow(actor, 's1');
    expect(res.data.reminded).toBeNull();
    expect(res.message).toBe('Reminders are on their way to everyone who has not answered and can be reminded now.');
  });

  it('Remind now respects the two-day gap and the maximum', async () => {
    const { svc, push } = setup({
      recipients: [
        { id: 'r1', token: 'tok-1', status: 'SENT', employeeId: 'e1', serviceUserId: null, sentAt: new Date(NOW.getTime() - 9 * DAY), reminderCount: 1, remindedAt: new Date(NOW.getTime() - DAY) },
        { id: 'r3', token: 'tok-3', status: 'SENT', employeeId: 'e3', serviceUserId: null, sentAt: new Date(NOW.getTime() - 9 * DAY), reminderCount: 3, remindedAt: null },
      ],
    });
    const res = await svc.remindNow(actor, 's1');
    expect(res.message).toMatch(/No one can be reminded now/);
    expect(push.sendToEmployees).not.toHaveBeenCalled();
  });
});

describe('SurveyRemindersService — invitation texts and quiet hours', () => {
  it('an invitation sent in quiet hours waits, and goes out once quiet hours end', async () => {
    jest.setSystemTime(new Date('2026-11-11T21:30:00Z'));
    const { svc, prisma, texts } = setup();
    prisma.surveyRecipient.updateMany = jest.fn();
    await svc.sendInvitationTexts('s1', [{ token: 'tok-1', employeeId: 'e1', serviceUserId: null }]);
    expect(texts.send).not.toHaveBeenCalled();
    expect(prisma.surveyRecipient.updateMany).toHaveBeenCalledWith({
      where: { surveyId: 's1', token: { in: ['tok-1'] }, status: { in: ['PENDING', 'SENT', 'STARTED'] } },
      data: { invitationTextPending: true },
    });

    prisma.surveyRecipient.findMany = jest.fn(async () => [{ id: 'r1', surveyId: 's1' }]);
    prisma.$queryRaw = jest.fn(async () => [{ id: 'r1', token: 'tok-1', employeeId: 'e1', serviceUserId: null }]);
    // Still quiet: nothing yet.
    expect(await svc.sendPendingInvitationTexts(new Date('2026-11-11T23:00:00Z'))).toBe(0);
    expect(texts.send).not.toHaveBeenCalled();
    expect(await svc.sendPendingInvitationTexts(new Date('2026-11-12T09:30:00Z'))).toBe(1);
    expect(texts.send).toHaveBeenCalledWith({ to: '+447700900123', body: expect.stringContaining('tok-1') });
  });
});

describe('SurveyRemindersService — remind one person', () => {
  it('reminds one chosen person on a named survey, with their own link, and audits it against them', async () => {
    const { svc, push, mail, prisma, audit } = setup();
    prisma.surveyRecipient.updateMany = jest.fn();
    const res = await svc.remindOne(actor, 's1', 'r1');
    expect(res.data.reminded).toBe(true);
    expect(res.message).toBe('Reminder sent by the carer app, email and text message.');
    expect(push.sendToEmployees).toHaveBeenCalledWith(['e1'], expect.anything());
    expect(mail.send.mock.calls[0][0].text).toContain('/survey/tok-1');
    expect(audit.logAudit.mock.calls[0][0]).toMatchObject({ recordType: 'SurveyRecipient', recordId: 'r1', description: expect.stringContaining('one person') });
    expect(JSON.stringify(audit.logAudit.mock.calls[0][0])).not.toMatch(/zara|07700|tok-1/);
    expect(prisma.surveyRecipient.updateMany).not.toHaveBeenCalled();
  });

  it('is never possible on an anonymous survey', async () => {
    const { svc, push } = setup({ survey: { isAnonymous: true } });
    await expect(svc.remindOne(actor, 's1', 'r1')).rejects.toThrow(/anonymous survey you can only remind everyone/);
    expect(push.sendToEmployees).not.toHaveBeenCalled();
  });

  it('needs the survey’s individual responses access', async () => {
    access.mockResolvedValue({ results: true, responses: false, threshold: 5 });
    await expect(setup().svc.remindOne(actor, 's1', 'r1')).rejects.toThrow(/individual responses/);
  });

  it('refuses people who answered, were reminded in the last two days, or had three reminders', async () => {
    const recent = { id: 'r9', token: 't9', status: 'SENT', employeeId: 'e1', serviceUserId: null, sentAt: new Date(NOW.getTime() - 9 * DAY), reminderCount: 1, remindedAt: new Date(NOW.getTime() - DAY) };
    const most = { ...recent, id: 'r8', reminderCount: 3, remindedAt: null };
    const { svc } = setup({ recipients: [recent, most, { ...recent, id: 'r7', status: 'COMPLETED' }] });
    await expect(svc.remindOne(actor, 's1', 'r9')).rejects.toThrow(/last 2 days/);
    await expect(svc.remindOne(actor, 's1', 'r8')).rejects.toThrow(/3 reminders/);
    await expect(svc.remindOne(actor, 's1', 'r7')).rejects.toThrow(/already answered/);
  });

  it('does not count a reminder that could not reach them (opted out of everything)', async () => {
    const { svc, prisma, audit } = setup({ optOuts: [{ subjectKind: 'EMPLOYEE', subjectId: 'e1', channel: 'ALL' }] });
    prisma.surveyRecipient.updateMany = jest.fn();
    const res = await svc.remindOne(actor, 's1', 'r1');
    expect(res.data).toEqual({ reminded: false, reason: 'OPTED_OUT' });
    expect(prisma.surveyRecipient.updateMany).toHaveBeenCalledWith({ where: { id: 'r1', reminderCount: 1 }, data: { reminderCount: 0, remindedAt: null } });
    expect(prisma.surveyReminderRun.create).not.toHaveBeenCalled();
    expect(audit.logAudit).not.toHaveBeenCalled();
  });
});

describe('SurveyRemindersService — call list', () => {
  it('is refused on anonymous surveys', async () => {
    await expect(setup({ survey: { isAnonymous: true } }).svc.callList(actor, 's1')).rejects.toThrow(/Anonymous surveys have no call list/);
  });

  it('needs responses access or the call role', async () => {
    access.mockResolvedValue({ results: true, responses: false, threshold: 5 });
    const callPlan = { ...plan, call: { afterDays: 3, roleId: null, ownerKey: 'CARE_COORDINATOR', withinDays: 5 } };
    const denied = setup({ survey: { contactPlan: callPlan } });
    await expect(denied.svc.callList(actor, 's1')).rejects.toThrow(/call list/);
    const roleHolder = setup({ survey: { contactPlan: callPlan } });
    roleHolder.prisma.userRole.count.mockResolvedValue(1);
    const res = await roleHolder.svc.callList(actor, 's1');
    expect(res.data.people.map((p: any) => p.name)).toEqual(['Zara Ali', 'Ola Bee']);
  });

  it('records a call without putting the notes in the audit trail', async () => {
    const { svc, audit } = setup();
    await svc.recordCall(actor, 's1', 'r1', { outcome: 'LEFT_MESSAGE', notes: 'Spoke to her son on 07700 900123' });
    const row = JSON.stringify(audit.logAudit.mock.calls[0][0]);
    expect(row).not.toContain('07700');
    expect(row).not.toContain('son');
    await expect(svc.recordCall(actor, 's1', 'r2', { outcome: 'NO_ANSWER' })).rejects.toThrow(/already answered/);
  });
});

describe('SurveyRemindersService — contact preferences', () => {
  it('a text opt-out made by a STOP reply keeps its origin when staff save other preferences', async () => {
    const { svc, prisma } = setup();
    const STOP = 'Replied STOP to a survey text message';
    prisma.employee = { findFirst: jest.fn(async () => ({ employment: { locationId: 'loc-1' } })) };
    prisma.surveyContactOptOut.findMany = jest.fn(async () => [{ channel: 'TEXT', reason: STOP, createdAt: NOW }]);
    prisma.surveyContactOptOut.deleteMany = jest.fn();
    prisma.surveyContactOptOut.upsert = jest.fn((args: unknown) => args);
    prisma.$transaction = jest.fn(async () => []);
    await svc.setOptOuts(actor, { subjectKind: 'EMPLOYEE', subjectId: 'e1', channels: ['TEXT', 'EMAIL'], reason: 'Asked at review' });
    const upserts = prisma.surveyContactOptOut.upsert.mock.calls.map((c: any[]) => c[0]);
    expect(upserts.find((u: any) => u.create.channel === 'TEXT').update).toEqual({});
    expect(upserts.find((u: any) => u.create.channel === 'EMAIL').update).toEqual({ reason: 'Asked at review' });
    const res = await svc.getOptOuts(actor, 'EMPLOYEE', 'e1');
    expect(res.data.stoppedByText).toEqual({ since: NOW.toISOString() });
    expect(res.data.reason).toBeNull();
  });
});


describe('SurveyRemindersService — people who can no longer be sent it', () => {
  const ineligible = ineligibleRecipientIds as jest.Mock;
  afterEach(() => ineligible.mockResolvedValue(new Set()));

  it('a reminder never reaches them: their invitation lapses instead (checked at the moment of sending)', async () => {
    ineligible.mockResolvedValue(new Set(['r1']));
    const { svc, push, mail, texts, prisma } = setup();
    prisma.surveyRecipient.updateMany = jest.fn(async () => ({ count: 1 }));
    const r = await svc.runDue(NOW);
    expect(r.reminded).toBe(0);
    expect(push.sendToEmployees).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
    expect(texts.send).not.toHaveBeenCalled();
    expect(prisma.surveyRecipient.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1'] }, status: { in: ['PENDING', 'SENT', 'STARTED'] } },
      data: { status: 'LAPSED', invitationTextPending: false },
    });
  });

  it('"remind one person" refuses them', async () => {
    ineligible.mockResolvedValue(new Set(['r1']));
    const { svc, prisma } = setup();
    prisma.surveyRecipient.updateMany = jest.fn(async () => ({ count: 1 }));
    await expect(svc.remindOne(actor, 's1', 'r1')).rejects.toThrow(/can no longer be sent this survey/);
  });
});
