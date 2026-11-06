import { SurveyActionsService } from './survey-actions.service';
import { mergeEvidenceActions, quotesWrittenAnswer, readItems } from './survey-actions.util';
import { keepActionLinks } from '../cqc-evidence/cqc-evidence.service';
import { surveyResultsAudience } from './survey-access';

jest.mock('./survey-access', () => ({ ...jest.requireActual('./survey-access'), surveyResultsAudience: jest.fn() }));
const audience = surveyResultsAudience as jest.Mock;

describe('acting on results (helpers)', () => {
  it('refuses a "You said" that quotes 8 or more words of a written answer', () => {
    const written = ['The carers are always rushing and never have time to sit and talk with my mum'];
    expect(quotesWrittenAnswer('You told us visits felt too short for a proper chat with your relative', written)).toBe(false);
    expect(quotesWrittenAnswer('Carers are always rushing and never have time to sit', written)).toBe(true);
    expect(quotesWrittenAnswer('Visits felt rushed', written)).toBe(false);
  });

  it('keeps typed CQC evidence entries and replaces only this action’s own', () => {
    const typed = { youSaid: 'Rota late', weDid: 'Rota out 2 weeks ahead' };
    const mine = { youSaid: 'Old', weDid: 'Old', actionId: 'a1' };
    expect(mergeEvidenceActions([typed, mine], { id: 'a1', done: true, youSaid: 'Calls rushed', weDid: 'Added travel time' })).toEqual([
      typed,
      { youSaid: 'Calls rushed', weDid: 'Added travel time', actionId: 'a1' },
    ]);
    // Reopened: its entry goes; typed ones stay.
    expect(mergeEvidenceActions([typed, mine], { id: 'a1', done: false, youSaid: 'x', weDid: 'y' })).toEqual([typed]);
    // The same words already typed on the evidence are not repeated.
    expect(mergeEvidenceActions([typed], { id: 'a2', done: true, youSaid: 'Rota late', weDid: 'Rota out 2 weeks ahead' })).toEqual([typed]);
    expect(readItems([{ youSaid: 'a', weDid: 'b' }, { bad: 1 }])).toEqual([{ youSaid: 'a', weDid: 'b', actionId: null }]);
  });
  it('catches quotes through punctuation, case, line breaks, accents and other alphabets', () => {
    const written = ['The night carer, Zofia, never ever turns up on time and I have to wait in bed.'];
    expect(quotesWrittenAnswer('THE NIGHT CARER ZOFIA\nnever-ever turns up on time!', written)).toBe(true);
    expect(quotesWrittenAnswer('Café staff are rude every single morning when we arrive there', ['cafe staff are rude every single morning when we arrive'])).toBe(true);
    expect(quotesWrittenAnswer('опікун ніколи не приходить вчасно і я чекаю в ліжку', ['Мій опікун ніколи не приходить вчасно і я чекаю в ліжку щодня'])).toBe(true);
  });

  it('catches near-copies: one word changed, added or left out', () => {
    const written = ['The carers are always rushing and never have time to sit and talk with my mum'];
    expect(quotesWrittenAnswer('carers are always hurrying and never have time to sit', written)).toBe(true);
    expect(quotesWrittenAnswer('carers are always rushing about and never have time to sit', written)).toBe(true);
    expect(quotesWrittenAnswer('carers are always rushing never have time to sit and talk', written)).toBe(true);
    // Its own words: fine.
    expect(quotesWrittenAnswer('You told us visits could feel hurried, so we added travel time between calls', written)).toBe(false);
  });

  it('an evidence form save keeps a survey action’s link on its unchanged entry', () => {
    const existing = [{ youSaid: 'Rota late', weDid: 'Out two weeks ahead', actionId: 'a1' }, { youSaid: 'Typed', weDid: 'Typed' }];
    expect(keepActionLinks(existing, [{ youSaid: ' Rota late ', weDid: 'Out two weeks ahead' }, { youSaid: 'Typed', weDid: 'Typed' }])).toEqual([
      { youSaid: 'Rota late', weDid: 'Out two weeks ahead', actionId: 'a1' },
      { youSaid: 'Typed', weDid: 'Typed' },
    ]);
    expect(keepActionLinks(existing, [{ youSaid: 'Rota late', weDid: 'Reworded by hand' }])).toEqual([{ youSaid: 'Rota late', weDid: 'Reworded by hand' }]);
  });
});

const survey = (over: Record<string, unknown> = {}) => ({
  id: 's1', title: 'Feedback on your manager', clonedFromId: null, isAnonymous: true, allowAnonymousResponses: false,
  targetKind: 'EMPLOYEE', status: 'CLOSED', locationIds: ['L1'], periodKey: null, opensAt: null, closesAt: null,
  libraryReference: null, ...over,
}) as any;

function setup(opts: { survey?: any; written?: string[] } = {}) {
  const created: { tasks: any[]; actions: any[]; audits: any[] } = { tasks: [], actions: [], audits: [] };
  const s = opts.survey ?? survey();
  const prisma: any = {
    survey: { findUnique: jest.fn().mockResolvedValue(s), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    role: { findFirst: jest.fn().mockResolvedValue({ id: 'role-rm' }), findMany: jest.fn().mockResolvedValue([{ id: 'role-rm', name: 'Registered Manager' }]) },
    userRole: { findFirst: jest.fn().mockResolvedValue({ userId: 'u2' }) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    roleTask: { create: jest.fn(async ({ data }: any) => created.tasks.push(data)), update: jest.fn() },
    surveyAction: {
      create: jest.fn(async ({ data }: any) => created.actions.push(data)),
      findUnique: jest.fn(),
      update: jest.fn(async ({ data }: any) => ({ id: 'a1', surveyId: 's1', periodId: null, roleTaskId: 't1', title: 'Fix rota', ownerRoleId: 'role-rm', dueOn: new Date('2026-12-01'), status: data.status ?? 'OPEN', youSaid: 'Rota late', weDid: 'Rota two weeks ahead', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    surveyDiscussion: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    surveyYouSaidWeDid: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(async ({ data }: any) => ({ id: 'y1', status: 'DRAFT', channels: [], ...data })), update: jest.fn() },
    surveyAnswer: { findMany: jest.fn().mockResolvedValue((opts.written ?? []).map((t) => ({ textValue: t, otherText: null, comment: null }))) },
    surveyAlert: { findFirst: jest.fn() },
    cqcEvidence: { findMany: jest.fn().mockResolvedValue([{ id: 'e1', status: 'CURRENT', actions: [{ youSaid: 'Typed', weDid: 'Typed' }] }]), update: jest.fn() },
    serviceUser: { findUnique: jest.fn().mockResolvedValue({ locationId: 'L1' }) },
    employeeEmployment: { findUnique: jest.fn() },
    companyProfile: { findFirst: jest.fn().mockResolvedValue({ displayName: 'Allfor Care', companyName: 'Allfor Care Ltd', displayLogoUrl: null, phoneNumber: '0100', email: 'a@b' }) },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const insight: any = {
    requireResults: jest.fn().mockResolvedValue({ survey: s, access: { results: true, responses: false, threshold: 5 } }),
    trends: jest.fn().mockResolvedValue({ data: { units: [{ id: 's1', label: 'x', shown: true }], questions: [{ key: 'LIKERT|I feel listened to', questionText: 'I feel listened to', pooled: { kind: 'TOP_TWO', percent: 42, positive: 5, base: 12 } }], responsesInFigures: 12 } }),
    themes: jest.fn().mockResolvedValue({ data: { themes: [] } }),
    scores: jest.fn().mockResolvedValue({ data: { scales: [] } }),
  };
  const surveys: any = { figuresFor: jest.fn().mockResolvedValue({ participation: { responsesInFigures: 12, sentTo: 20, answered: 12, responseRate: 60 }, headline: null, questionSummaries: [] }) };
  const audit = { logAudit: jest.fn(async (a: any) => created.audits.push(a)) };
  const notifications = { notifyUsers: jest.fn() };
  audience.mockResolvedValue({ restricted: true });
  const service = new SurveyActionsService(prisma, surveys, insight, audit as any, notifications as any);
  return { service, prisma, created, notifications };
}

const manager = { id: 'u1', permissions: ['surveys.manage', 'surveys.read'], roles: [] } as any;

describe('SurveyActionsService', () => {
  it('raises an action as a role task that names no one, labelled with the figure as shown', async () => {
    const { service, created, notifications } = setup();
    await service.createAction(manager, 's1', { source: 'QUESTION', sourceKey: 'LIKERT|I feel listened to', title: 'Monthly listening sessions', ownerRoleId: 'role-rm', ownerUserId: 'u2', dueOn: '2026-12-01' });
    expect(created.tasks[0]).toMatchObject({ sourceType: 'SURVEY_ACTION', roleId: 'role-rm', title: 'An action from survey results', locationId: 'L1' });
    expect(created.tasks[0].description).not.toContain('Feedback on your manager');
    expect(created.actions[0]).toMatchObject({ sourceLabel: 'I feel listened to: 42% gave one of the top two answers', source: 'QUESTION' });
    expect(created.audits[0]).toMatchObject({ action: 'survey_action_created' });
    expect(JSON.stringify(created.audits[0])).not.toContain('Monthly listening');
    expect(notifications.notifyUsers.mock.calls[0][0].message).not.toContain('Feedback on your manager');
  });

  it('refuses an action from a figure that is not shown', async () => {
    const { service } = setup();
    await expect(service.createAction(manager, 's1', { source: 'QUESTION', sourceKey: 'nope', title: 'X y z', ownerRoleId: 'role-rm', dueOn: '2026-12-01' })).rejects.toThrow(/no figures/);
  });

  it('closing needs what was done; then CQC evidence gets the "You said, we did" and typed entries stay', async () => {
    const { service, prisma } = setup();
    prisma.surveyAction.findUnique.mockResolvedValue({ id: 'a1', surveyId: 's1', status: 'OPEN', ownerRoleId: 'role-rm', ownerUserId: 'u2', outcome: null, dueOn: new Date('2026-12-01') });
    await expect(service.updateAction(manager, 'a1', { status: 'DONE' })).rejects.toThrow(/Say what was done/);
    await service.updateAction(manager, 'a1', { status: 'DONE', outcome: 'Rota published two weeks ahead since October' });
    expect(prisma.roleTask.update.mock.calls[0][0].data).toMatchObject({ status: 'DONE' });
    expect(prisma.cqcEvidence.update.mock.calls[0][0].data.actions).toEqual([
      { youSaid: 'Typed', weDid: 'Typed' },
      { youSaid: 'Rota late', weDid: 'Rota two weeks ahead', actionId: 'a1' },
    ]);
  });

  it('only the owner role (or a manager) may record progress', async () => {
    const { service, prisma } = setup();
    prisma.surveyAction.findUnique.mockResolvedValue({ id: 'a1', surveyId: 's1', status: 'OPEN', ownerRoleId: 'role-rm', ownerUserId: 'u2', dueOn: new Date() });
    prisma.userRole.findFirst.mockResolvedValue(null);
    await expect(service.updateAction({ id: 'u9', permissions: ['surveys.read'] } as any, 'a1', { status: 'IN_PROGRESS' })).rejects.toThrow(/another role/);
    prisma.userRole.findFirst.mockResolvedValue({ userId: 'u3' });
    await expect(service.updateAction({ id: 'u3', permissions: ['surveys.read'] } as any, 'a1', { dueOn: '2027-01-01' })).rejects.toThrow(/Only people who manage/);
  });

  it('"You said, we did" refuses a quote from a written answer, and staff surveys never go on the portal', async () => {
    const { service } = setup({ written: ['I was told off in front of the whole team at the meeting last week'] });
    await expect(
      service.saveUpdate(manager, 's1', null, { title: 'What changed', items: [{ youSaid: 'told off in front of the whole team at the meeting', weDid: 'Feedback in private now' }], channels: ['APP'] }),
    ).rejects.toThrow(/quote from a written answer/);
    await expect(service.saveUpdate(manager, 's1', null, { title: 'What changed', items: [{ youSaid: 'Feedback felt public', weDid: 'Feedback in private now' }], channels: ['PORTAL'] })).rejects.toThrow(/not on the portal/);
    const ok = await service.saveUpdate(manager, 's1', null, { title: 'What changed', items: [{ youSaid: 'Feedback felt public', weDid: 'Feedback in private now' }], channels: ['APP', 'LETTER'] });
    expect(ok.data).toMatchObject({ status: 'DRAFT', publicToken: null });
  });

  it('the public page shows only a published summary with the public link', async () => {
    const { service, prisma } = setup();
    prisma.surveyYouSaidWeDid.findFirst.mockResolvedValue(null);
    await expect(service.forPublic('short')).rejects.toThrow(/no longer available/);
    await expect(service.forPublic('x'.repeat(24))).rejects.toThrow(/no longer available/);
    expect(prisma.surveyYouSaidWeDid.findFirst.mock.calls[0][0].where).toMatchObject({ status: 'PUBLISHED', channels: { has: 'PUBLIC' } });
  });

  it('the portal lists summaries for the person’s branch or everyone, never staff surveys', async () => {
    const { service, prisma } = setup();
    await service.forPortal('su1');
    const where = prisma.surveyYouSaidWeDid.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'PUBLISHED', channels: { has: 'PORTAL' }, audience: { in: ['SERVICE_USER', 'PUBLIC'] } });
    expect(where.OR).toEqual([{ locationIds: { isEmpty: true } }, { locationIds: { has: 'L1' } }]);
  });

  it('the pack is audited as an export, names owners by role only, and hides figures of an open anonymous survey', async () => {
    const { service, prisma, created } = setup({ survey: survey({ status: 'ACTIVE' }) });
    prisma.cqcEvidence.findMany.mockResolvedValue([]);
    prisma.surveyAction.findMany.mockResolvedValue([{ id: 'a1', surveyId: 's1', periodId: null, title: 'Fix rota', ownerRoleId: 'role-rm', ownerUserId: 'u2', dueOn: new Date('2026-12-01'), status: 'OPEN', source: 'GENERAL' }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u2', firstName: 'Jo', lastName: 'Bloggs' }]);
    const out = (await service.pack(manager, 's1', null)).data;
    expect(created.audits.at(-1)).toMatchObject({ action: 'survey_results_exported', newValues: { kind: 'PACK' } });
    expect(out.actions[0]).toMatchObject({ ownerRole: 'Registered Manager' });
    expect(JSON.stringify(out)).not.toContain('Bloggs');
    expect(out.figuresShown).toBe(false);
    expect(out.questions).toEqual([]);
  });
  it('refuses a quote in the title or introduction too, at save and again at publish', async () => {
    const quote = 'I was told off in front of the whole team at the meeting last week';
    const { service, prisma } = setup({ written: [quote] });
    const item = [{ youSaid: 'Feedback felt public', weDid: 'Feedback in private now' }];
    await expect(service.saveUpdate(manager, 's1', null, { title: 'What changed', intro: `Someone said: ${quote}`, items: item, channels: ['APP'] })).rejects.toThrow(/introduction looks like a quote/);
    prisma.surveyYouSaidWeDid.findFirst.mockResolvedValue({ id: 'y1', surveyId: 's1', status: 'DRAFT', channels: ['APP'], items: item, title: 'Told off in front of the whole team at the meeting', intro: null });
    await expect(service.publishUpdate(manager, 's1', 'y1', true)).rejects.toThrow(/title looks like a quote/);
  });

  it('refuses a quote in an action’s outcome or "You said", and in what a discussion agreed', async () => {
    const quote = 'my manager shouts at me when the rota changes at short notice';
    const { service, prisma } = setup({ written: [quote] });
    prisma.surveyAction.findUnique.mockResolvedValue({ id: 'a1', surveyId: 's1', status: 'OPEN', ownerRoleId: 'role-rm', ownerUserId: 'u2', outcome: null, dueOn: new Date('2026-12-01') });
    await expect(service.updateAction(manager, 'a1', { status: 'DONE', outcome: `Spoke to the team: ${quote}` })).rejects.toThrow(/What was done looks like a quote/);
    await expect(service.createAction(manager, 's1', { source: 'GENERAL', title: 'Rota changes', youSaid: quote, ownerRoleId: 'role-rm', dueOn: '2026-12-01' })).rejects.toThrow(/"You said" looks like a quote/);
    await expect(service.createDiscussion(manager, 's1', { heldOn: '2026-10-01', kind: 'TEAM_MEETING', summary: 'Results talked through', agreed: quote })).rejects.toThrow(/agreed looks like a quote/);
    expect(prisma.roleTask.update).not.toHaveBeenCalled();
  });

  it('a closed action keeps what was done; a non-manager cannot reopen a cancelled one', async () => {
    const { service, prisma } = setup();
    prisma.surveyAction.findUnique.mockResolvedValue({ id: 'a1', surveyId: 's1', status: 'DONE', ownerRoleId: 'role-rm', ownerUserId: 'u2', outcome: 'Rota out early', dueOn: new Date('2026-12-01') });
    await expect(service.updateAction(manager, 'a1', { outcome: '' })).rejects.toThrow(/Say what was done/);
    prisma.surveyAction.findUnique.mockResolvedValue({ id: 'a1', surveyId: 's1', status: 'CANCELLED', ownerRoleId: 'role-rm', ownerUserId: 'u2', outcome: 'No longer needed', dueOn: new Date('2026-12-01') });
    await expect(service.updateAction({ id: 'u2', permissions: ['surveys.read'] } as any, 'a1', { status: 'OPEN' })).rejects.toThrow(/cancelled action/);
  });

  it('reopening takes the action’s entry off superseded evidence too, and leaves other superseded evidence alone', async () => {
    const { service, prisma } = setup();
    prisma.cqcEvidence.findMany.mockResolvedValue([
      { id: 'old', status: 'SUPERSEDED', actions: [{ youSaid: 'Rota late', weDid: 'Rota two weeks ahead', actionId: 'a1' }] },
      { id: 'other', status: 'SUPERSEDED', actions: [{ youSaid: 'Typed', weDid: 'Typed' }] },
    ]);
    prisma.surveyAction.findUnique.mockResolvedValue({ id: 'a1', surveyId: 's1', status: 'DONE', ownerRoleId: 'role-rm', ownerUserId: 'u2', outcome: 'Done it', dueOn: new Date('2026-12-01') });
    await service.updateAction(manager, 'a1', { status: 'IN_PROGRESS' });
    expect(prisma.cqcEvidence.update.mock.calls).toEqual([[{ where: { id: 'old' }, data: { actions: [] } }]]);
  });

  it('feeds and the public page leave out summaries of deleted surveys', async () => {
    const { service, prisma } = setup();
    prisma.employeeEmployment.findUnique.mockResolvedValue({ locationId: 'L1', baseLocationId: null });
    prisma.surveyYouSaidWeDid.findFirst.mockResolvedValue(null);
    await service.forPortal('su1');
    await service.forEmployeeApp('e1');
    await expect(service.forPublic('x'.repeat(24))).rejects.toThrow(/no longer available/);
    for (const call of [...prisma.surveyYouSaidWeDid.findMany.mock.calls, ...prisma.surveyYouSaidWeDid.findFirst.mock.calls]) {
      expect(call[0].where.survey).toEqual({ deletedAt: null });
    }
  });
});
