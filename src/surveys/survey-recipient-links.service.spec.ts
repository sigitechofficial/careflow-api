import { SurveyRecipientLinksService } from './survey-recipient-links.service';

const survey = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  title: 'Staff survey',
  targetKind: 'EMPLOYEE',
  status: 'ACTIVE',
  isAnonymous: false,
  allowAnonymousResponses: false,
  isTemplate: false,
  isCatalogue: false,
  deletedAt: null,
  locationIds: ['loc-leeds'],
  accessPolicy: null,
  libraryMeta: null,
  createdById: 'u1',
  clonedFromId: null,
  ...over,
});

const recipients = [
  { id: 'r1', token: 'tok-1', status: 'SENT', employeeId: 'e1', serviceUserId: null },
  { id: 'r2', token: 'tok-2', status: 'COMPLETED', employeeId: 'e2', serviceUserId: null },
];

function setup(opts: { row?: Record<string, unknown>; restrictedResponses?: boolean } = {}) {
  const prisma: any = {
    survey: { findFirst: jest.fn().mockResolvedValue(survey(opts.row)) },
    surveyRecipient: {
      findMany: jest.fn(async ({ where }: any) =>
        recipients.filter((r) => (!where.id || where.id.in.includes(r.id)) && (!where.status || r.status !== where.status.not)),
      ),
      findFirst: jest.fn(async ({ where }: any) => recipients.find((r) => r.id === where.id) ?? null),
      update: jest.fn(async ({ data }: any) => ({ token: data.token })),
    },
    employeePersonalDetail: {
      findMany: jest.fn().mockResolvedValue([
        { employeeId: 'e1', firstName: 'Zara', lastName: 'Ali' },
        { employeeId: 'e2', firstName: 'Adam', lastName: 'Brown' },
      ]),
    },
    serviceUser: { findMany: jest.fn().mockResolvedValue([]) },
    // surveyAccessFor: a restricted responses level that names nobody.
    role: { findMany: jest.fn().mockResolvedValue([]) },
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
  };
  if (opts.restrictedResponses) {
    prisma.survey.findFirst.mockResolvedValue(
      survey({
        ...opts.row,
        createdById: 'someone-else',
        accessPolicy: {
          responses: { restricted: true, ownerKeys: [], roleIds: [], userIds: [] },
          results: { restricted: false, ownerKeys: [], roleIds: [], userIds: [] },
        },
      }),
    );
  }
  const audit = { logAudit: jest.fn() };
  const orgScope = { fromRequestUser: () => ({ locationIds: null }) };
  return { prisma, audit, service: new SurveyRecipientLinksService(prisma, audit as any, orgScope as any) };
}
const manager: any = { id: 'u1', roles: ['Admin'], permissions: ['surveys.manage', 'surveys.read'] };
const officeManager: any = { id: 'u9', roles: ['Registered Manager'], permissions: ['surveys.manage', 'surveys.read'] };

describe('SurveyRecipientLinksService (people’s own links)', () => {
  it('copies everyone’s links by name, with who has answered, and audits it without the links', async () => {
    const { audit, service } = setup();
    const res = await service.copyLinks(manager, 's1', { purpose: 'CSV' });
    expect(res.data.links).toEqual([
      { recipientId: 'r2', name: 'Adam Brown', kind: 'EMPLOYEE', path: '/survey/tok-2', answered: true },
      { recipientId: 'r1', name: 'Zara Ali', kind: 'EMPLOYEE', path: '/survey/tok-1', answered: false },
    ]);
    const row = audit.logAudit.mock.calls[0][0];
    expect(row).toMatchObject({ action: 'survey_links_copied', recordId: 's1', newValues: { purpose: 'CSV', count: 2 } });
    expect(JSON.stringify(row)).not.toMatch(/tok-/);
  });

  it('copies only people who have not answered yet, or one person', async () => {
    const { service, audit } = setup();
    const res = await service.copyLinks(manager, 's1', { purpose: 'ALL', onlyNotAnswered: true });
    expect(res.data.links.map((l) => l.recipientId)).toEqual(['r1']);
    const one = await service.copyLinks(manager, 's1', { purpose: 'ONE', recipientIds: ['r1'] });
    expect(one.data.links).toHaveLength(1);
    expect(audit.logAudit.mock.calls[1][0].newValues).toMatchObject({ purpose: 'ONE', recipientId: 'r1' });
    await expect(service.copyLinks(manager, 's1', { purpose: 'ONE', recipientIds: ['r1', 'r2'] })).rejects.toThrow(/Choose one person/);
  });

  it('never on an anonymous survey (holding a link would show whether that person has answered)', async () => {
    const { service, audit } = setup({ row: { isAnonymous: true } });
    await expect(service.copyLinks(manager, 's1', { purpose: 'ALL' })).rejects.toThrow(/never shown on an anonymous survey/);
    await expect(service.renewLink(manager, 's1', 'r1')).rejects.toThrow(/never shown on an anonymous survey/);
    expect(audit.logAudit).not.toHaveBeenCalled();
  });

  it('not on public surveys or templates, nor while the survey is not open', async () => {
    await expect(setup({ row: { targetKind: 'PUBLIC' } }).service.copyLinks(manager, 's1', { purpose: 'ALL' })).rejects.toThrow(/Use the shared link/);
    await expect(setup({ row: { isTemplate: true } }).service.copyLinks(manager, 's1', { purpose: 'ALL' })).rejects.toThrow(/Templates have no links/);
    await expect(setup({ row: { status: 'CLOSED' } }).service.copyLinks(manager, 's1', { purpose: 'ALL' })).rejects.toThrow(/not open for answers/);
  });

  it('without access to the individual responses: links but not who has answered', async () => {
    const { service } = setup({ restrictedResponses: true });
    const res = await service.copyLinks(officeManager, 's1', { purpose: 'ALL' });
    expect(res.data.links.every((l) => l.answered === null)).toBe(true);
    await expect(service.copyLinks(officeManager, 's1', { purpose: 'ALL', onlyNotAnswered: true })).rejects.toThrow(/who has answered/);
  });

  it('shows who copied links and when (never the links), to managers who may see the responses', async () => {
    const { prisma, service } = setup();
    prisma.auditLog = {
      findMany: jest.fn().mockResolvedValue([
        { action: 'survey_links_copied', createdAt: new Date('2026-11-06T10:00:00Z'), userId: 'u1', newValues: { purpose: 'CSV', count: 12 } },
        { action: 'survey_link_renewed', createdAt: new Date('2026-11-05T09:00:00Z'), userId: 'u1', newValues: { surveyId: 's1', link: 'person' } },
      ]),
    };
    prisma.user = { findMany: jest.fn().mockResolvedValue([{ id: 'u1', firstName: 'Sam', lastName: 'Lee', email: 'sam@x' }]) };
    const res = await service.history(manager, 's1');
    expect(res.data).toEqual([
      { at: '2026-11-06T10:00:00.000Z', by: 'Sam Lee', what: 'MAIL_MERGE', count: 12 },
      { at: '2026-11-05T09:00:00.000Z', by: 'Sam Lee', what: 'NEW_LINK', count: 1 },
    ]);
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.metadata).toEqual({ path: ['surveyId'], equals: 's1' });
    await expect(setup({ restrictedResponses: true }).service.history(officeManager, 's1')).rejects.toThrow(/who copied its links/);
  });

  it('a new link for one person stops the old one, audited, and is refused once they have answered', async () => {
    const { prisma, audit, service } = setup();
    const res = await service.renewLink(manager, 's1', 'r1');
    const token = prisma.surveyRecipient.update.mock.calls[0][0].data.token;
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.data.path).toBe(`/survey/${token}`);
    const row = audit.logAudit.mock.calls[0][0];
    expect(row).toMatchObject({ action: 'survey_link_renewed', recordId: 'r1' });
    expect(JSON.stringify(row)).not.toContain(token);
    await expect(service.renewLink(manager, 's1', 'r2')).rejects.toThrow(/already answered/);
  });
});
