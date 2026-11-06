import { SurveyAccessService } from './survey-access.service';

const survey = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  title: 'Feedback on your manager',
  clonedFromId: null,
  createdById: 'maker',
  isAnonymous: true,
  allowAnonymousResponses: false,
  isTemplate: false,
  locationIds: [],
  libraryReference: null,
  libraryMeta: null,
  accessPolicy: null,
  reportingThreshold: null,
  deletedAt: null,
  ...over,
});

function setup(row = survey()) {
  const prisma: any = {
    survey: { findFirst: jest.fn().mockResolvedValue(row), findUnique: jest.fn().mockResolvedValue(row), update: jest.fn() },
    role: { findMany: jest.fn().mockResolvedValue([{ id: 'role-hr', name: 'HR' }]), count: jest.fn().mockResolvedValue(1) },
    user: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    surveyAlertOwnerRole: { findMany: jest.fn().mockResolvedValue([]) },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const audit = { logAudit: jest.fn() };
  const orgScope = { fromRequestUser: () => ({ locationIds: null }) };
  const alerts = { rulesOutsideResults: jest.fn().mockResolvedValue([{ id: 'r1', title: 'Feels disrespected', role: 'Registered Manager' }]) };
  return { prisma, audit, alerts, service: new SurveyAccessService(prisma, audit as any, orgScope as any, alerts as any) };
}

const admin: any = { id: 'a1', roles: ['Admin'], permissions: ['surveys.manage'] };
const hr = { restricted: true, ownerKeys: ['HR_MANAGER'] };

describe('SurveyAccessService.update', () => {
  it('changes who can see the answers without moving updatedAt (no needless CQC re-capture)', async () => {
    const { prisma, audit, service } = setup();
    const res = await service.update(admin, 's1', { responses: hr, results: hr, reportingThreshold: null } as any);
    expect(prisma.survey.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw.mock.calls[0][0].join('?')).toMatch(/SET "accessPolicy" = \?::jsonb, "updatedById"/);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'survey_access_updated' }));
    expect((res.data as any).affectedRules).toHaveLength(1);
  });

  it('moves updatedAt when the threshold changes (the figures change)', async () => {
    const { prisma, service } = setup();
    await service.update(admin, 's1', { responses: hr, results: hr, reportingThreshold: 10 } as any);
    expect(prisma.survey.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reportingThreshold: 10 }) }));
  });

  it('a check only (dryRun) lists the alerts that would be rerouted and saves nothing', async () => {
    const { prisma, alerts, service } = setup();
    const res = await service.update(admin, 's1', { responses: hr, results: hr, dryRun: true } as any);
    expect(res).toEqual({ message: 'Check only: nothing saved', data: { affectedRules: [{ id: 'r1', title: 'Feels disrespected', role: 'Registered Manager' }] } });
    expect(alerts.rulesOutsideResults).toHaveBeenCalledWith('s1', expect.any(Set));
    expect(prisma.survey.update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('refuses a threshold below 5 where answers are given without a name, and anyone but an admin or the maker', async () => {
    const { service } = setup();
    await expect(service.update(admin, 's1', { responses: hr, results: hr, reportingThreshold: 3 } as any)).rejects.toThrow(/at least 5/);
    const other: any = { id: 'x', roles: ['Manager'], permissions: ['surveys.manage'] };
    await expect(service.update(other, 's1', { responses: hr, results: hr } as any)).rejects.toThrow(/Only an admin or the person who made/);
  });
});

describe('SurveyAccessService.recordExport (results downloaded)', () => {
  it('is audited with what the file covers, for people who may see the results', async () => {
    const { audit, service } = setup();
    await service.recordExport(admin, 's1', { kind: 'RESULTS_CSV', period: 'All 3 periods', respondentGroup: 'Volunteers' });
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'survey_results_exported',
        recordId: 's1',
        newValues: { kind: 'RESULTS_CSV', period: 'All 3 periods', respondentGroup: 'Volunteers' },
      }),
    );
  });

  it('is refused (so nothing is downloaded) for someone the results are not for', async () => {
    const { audit, service } = setup(survey({ accessPolicy: { responses: { restricted: true, ownerKeys: [], roleIds: [], userIds: [] }, results: { restricted: true, ownerKeys: [], roleIds: [], userIds: [] } } }));
    const officeUser: any = { id: 'o1', roles: ['Care Coordinator'], permissions: ['surveys.read'] };
    await expect(service.recordExport(officeUser, 's1', { kind: 'RESULTS_CSV' })).rejects.toThrow(/limited to particular people/);
    expect(audit.logAudit).not.toHaveBeenCalled();
  });
});
