import { SurveyShareLinksService } from './survey-share-links.service';

const survey = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  title: 'Family views',
  targetKind: 'PUBLIC',
  isTemplate: false,
  isCatalogue: false,
  deletedAt: null,
  shareToken: 'main-token',
  locationIds: ['loc-leeds', 'loc-york'],
  ...over,
});

function setup(opts: { scope?: string[] | null; row?: Record<string, unknown> } = {}) {
  const prisma: any = {
    survey: { findFirst: jest.fn().mockResolvedValue(survey(opts.row)) },
    surveyShareLink: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({ id: 'link-1', ...data })),
      update: jest.fn(),
    },
    location: {
      findFirst: jest.fn().mockResolvedValue({ id: 'loc-leeds', name: 'Leeds' }),
      findMany: jest.fn().mockResolvedValue([{ id: 'loc-leeds', name: 'Leeds' }, { id: 'loc-york', name: 'York' }]),
    },
  };
  const audit = { logAudit: jest.fn() };
  const orgScope = { fromRequestUser: () => ({ locationIds: opts.scope === undefined ? null : opts.scope }) };
  return { prisma, audit, service: new SurveyShareLinksService(prisma, audit as any, orgScope as any) };
}
const actor: any = { id: 'u1', roles: ['Admin'], permissions: ['surveys.manage'] };

describe('SurveyShareLinksService (one link per branch)', () => {
  it('makes a link for a branch, audited, and refuses a second live one', async () => {
    const { prisma, audit, service } = setup();
    const res = await service.create(actor, 's1', 'loc-leeds');
    expect(res.data.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(prisma.surveyShareLink.create.mock.calls[0][0].data).toMatchObject({ surveyId: 's1', locationId: 'loc-leeds', label: 'Leeds' });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'survey_share_link_created' }));
    prisma.surveyShareLink.findFirst.mockResolvedValue({ id: 'link-1' });
    await expect(service.create(actor, 's1', 'loc-leeds')).rejects.toThrow(/already has a link/);
  });

  it('refuses a branch the survey is not for, or outside the user’s branches', async () => {
    await expect(setup().service.create(actor, 's1', 'loc-hull')).rejects.toThrow(/not for that branch/);
    await expect(setup({ scope: ['loc-york'], row: { locationIds: ['loc-york'] } }).service.create(actor, 's1', 'loc-leeds')).rejects.toThrow(/your own branches/);
  });

  it('staff and service-user surveys have a shared link only once it is turned on', async () => {
    const off = await setup({ row: { targetKind: 'EMPLOYEE' } }).service.list(actor, 's1');
    expect(off.data).toEqual({ main: null, enabled: false, oncePerDevice: false, branches: [], availableBranches: [] });
    await expect(setup({ row: { targetKind: 'EMPLOYEE' } }).service.create(actor, 's1', 'loc-leeds')).rejects.toThrow(/Turn the shared link on first/);
    await expect(setup({ row: { isTemplate: true } }).service.list(actor, 's1')).rejects.toThrow(/Templates have no links/);
    const on = await setup({ row: { targetKind: 'SERVICE_USER', sharedLinkEnabled: true } }).service.list(actor, 's1');
    expect(on.data).toMatchObject({ main: { token: 'main-token' }, enabled: true });
  });

  it('turning the shared link on gives a new link (an old leaked one never comes back), audited', async () => {
    const { prisma, audit, service } = setup({ row: { targetKind: 'EMPLOYEE', sharedLinkEnabled: false } });
    prisma.survey.update = jest.fn(async ({ data }: any) => ({ ...survey(), ...data }));
    const res = await service.setSharedLink(actor, 's1', true);
    const data = prisma.survey.update.mock.calls[0][0].data;
    expect(data.sharedLinkEnabled).toBe(true);
    expect(data.shareToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.shareToken).not.toBe('main-token');
    expect(res.data.token).toBe(data.shareToken);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'survey_updated', newValues: { sharedLinkEnabled: true } }));
    await expect(setup({ row: { targetKind: 'PUBLIC' } }).service.setSharedLink(actor, 's1', false)).rejects.toThrow(/always have their shared link/);
    await expect(setup({ row: { targetKind: 'EMPLOYEE', clonedFromId: 'src' } }).service.setSharedLink(actor, 's1', true)).rejects.toThrow(/repeating survey/);
  });

  it('a new main link stops the old one at once, audited as survey_link_renewed', async () => {
    const { prisma, audit, service } = setup();
    prisma.survey.update = jest.fn(async ({ data }: any) => ({ ...survey(), ...data }));
    const res = await service.renewMain(actor, 's1');
    expect(res.data.token).not.toBe('main-token');
    expect(prisma.survey.update.mock.calls[0][0].data.shareToken).toBe(res.data.token);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'survey_link_renewed' }));
    await expect(setup({ row: { targetKind: 'EMPLOYEE' } }).service.renewMain(actor, 's1')).rejects.toThrow(/Turn the shared link on first/);
  });

  it('turns a link off (a leaked link) and can replace it with a new one for the branch', async () => {
    const { prisma, audit, service } = setup();
    prisma.surveyShareLink.findFirst
      .mockResolvedValueOnce({ id: 'link-1', surveyId: 's1', locationId: 'loc-leeds', revokedAt: null })
      .mockResolvedValueOnce(null);
    const res = await service.turnOff(actor, 's1', 'link-1', { replace: true });
    expect(prisma.surveyShareLink.update.mock.calls[0][0].data).toMatchObject({ revokedById: 'u1' });
    expect(audit.logAudit.mock.calls.map((c) => c[0].action)).toEqual(['survey_share_link_turned_off', 'survey_share_link_created']);
    expect(res.data).toHaveProperty('token');
  });

  it('two people making the same branch link at once both get the one link, never a server error', async () => {
    const { prisma, audit, service } = setup();
    prisma.surveyShareLink.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'link-9', token: 'tok-9' });
    prisma.surveyShareLink.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    const res = await service.create(actor, 's1', 'loc-leeds');
    expect(res.data).toEqual({ id: 'link-9', token: 'tok-9' });
    expect(audit.logAudit).not.toHaveBeenCalled();
    // The other link vanished in between: a friendly conflict, not a 500.
    prisma.surveyShareLink.findFirst.mockResolvedValue(null);
    prisma.surveyShareLink.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    await expect(service.create(actor, 's1', 'loc-leeds')).rejects.toThrow(/same moment/);
  });

  it('a branch-restricted user cannot turn off or replace a link that is not for one branch, nor another branch’s', async () => {
    const { prisma, service } = setup({ scope: ['loc-leeds'], row: { locationIds: ['loc-leeds'] } });
    prisma.surveyShareLink.findFirst.mockResolvedValue({ id: 'link-0', surveyId: 's1', locationId: null, revokedAt: null });
    await expect(service.turnOff(actor, 's1', 'link-0', { replace: true })).rejects.toThrow(/manager of every branch/);
    prisma.surveyShareLink.findFirst.mockResolvedValue({ id: 'link-2', surveyId: 's1', locationId: 'loc-york', revokedAt: null });
    await expect(service.turnOff(actor, 's1', 'link-2')).rejects.toThrow(/Link not found/);
    expect(prisma.surveyShareLink.update).not.toHaveBeenCalled();
  });

  it('a survey manager can raise the per-link limit for a planned sitting, audited, within bounds, and put it back', async () => {
    const { prisma, audit, service } = setup();
    prisma.survey.update = jest.fn();
    const until = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const res = await service.setLinkLimit(actor, 's1', { limit: 300, until });
    expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({ sharedLinkLimit: 300, sharedLinkLimitUntil: new Date(until) });
    expect(res.data).toMatchObject({ standard: 60, inForce: 300, raisedUntil: until });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringMatching(/raised to 300 answers per 10 minutes/) }));
    await expect(service.setLinkLimit(actor, 's1', { limit: 5000, until })).rejects.toThrow(/61 to 1000/);
    await expect(service.setLinkLimit(actor, 's1', { limit: 300 })).rejects.toThrow(/until when/);
    await expect(
      service.setLinkLimit(actor, 's1', { limit: 300, until: new Date(Date.now() + 8 * 24 * 60 * 60_000).toISOString() }),
    ).rejects.toThrow(/at most 7 days/);
    await service.setLinkLimit(actor, 's1', { limit: null });
    expect(prisma.survey.update.mock.calls[1][0].data).toMatchObject({ sharedLinkLimit: null, sharedLinkLimitUntil: null });
  });

  it('one answer per device is a shared-link setting, audited, and only where there is a shared link', async () => {
    const { prisma, audit, service } = setup();
    prisma.survey.update = jest.fn();
    await service.updateSettings(actor, 's1', { oncePerDevice: true });
    expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({ sharedLinkOncePerDevice: true });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ newValues: { sharedLinkOncePerDevice: true } }));
    await expect(setup({ row: { targetKind: 'EMPLOYEE' } }).service.updateSettings(actor, 's1', { oncePerDevice: true })).rejects.toThrow(/Turn the shared link on first/);
  });

  it('a printed paper copy is audited (any survey the user can see, templates included)', async () => {
    const { audit, service } = setup({ row: { isTemplate: true, targetKind: 'EMPLOYEE' } });
    await service.paperCopyPrinted(actor, 's1');
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'survey_paper_copy_printed', recordId: 's1' }));
    const hidden = setup({ scope: ['loc-york'] });
    await expect(hidden.service.paperCopyPrinted(actor, 's1')).rejects.toThrow(/Survey not found/);
  });

  it('lists the main link, branch links and branches still without one', async () => {
    const { prisma, service } = setup();
    prisma.surveyShareLink.findMany.mockResolvedValue([{ id: 'l1', token: 't1', locationId: 'loc-leeds', createdAt: new Date('2026-11-06') }]);
    const res = await service.list(actor, 's1');
    expect(res.data.main).toEqual({ token: 'main-token' });
    expect(res.data.branches[0]).toMatchObject({ token: 't1', locationName: 'Leeds' });
    expect(res.data.availableBranches).toEqual([{ id: 'loc-york', name: 'York' }]);
  });
});
