import { effectiveThreshold, libraryAccess, readAccessPolicy, surveyAccessFor, surveysHiddenFromAudit, surveysWithoutResultsAccess, thresholdNote, withExcludedUsers } from './survey-access';

const survey = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  clonedFromId: null,
  createdById: 'maker',
  isAnonymous: false,
  allowAnonymousResponses: false,
  libraryReference: null,
  libraryMeta: null,
  accessPolicy: null,
  reportingThreshold: null,
  ...over,
});

const db = (over: { catalogueMeta?: unknown; source?: unknown } = {}) =>
  ({
    role: {
      findMany: jest.fn(async (args: any) => {
        const all = [
          { id: 'role-hr', name: 'HR' },
          { id: 'role-rm', name: 'Registered Manager' },
          { id: 'role-cc', name: 'Care Coordinator' },
        ];
        return args?.where?.name?.in ? all.filter((r) => args.where.name.in.includes(r.name)) : all;
      }),
    },
    surveyAlertOwnerRole: { findMany: jest.fn().mockResolvedValue([]) },
    survey: {
      findFirst: jest.fn().mockResolvedValue(over.catalogueMeta ? { libraryMeta: over.catalogueMeta } : null),
      findUnique: jest.fn().mockResolvedValue(over.source ?? null),
      findMany: jest.fn(),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  }) as any;

const actor = (roles: string[], id = 'u1') => ({ id, roles, permissions: ['surveys.read'], accountKind: 'user' }) as any;

const hrOnly = {
  responses: { restricted: true, ownerKeys: ['HR_MANAGER'], roleIds: [], userIds: [] },
  results: { restricted: true, ownerKeys: ['HR_MANAGER'], roleIds: [], userIds: [] },
};

describe('per-survey access', () => {
  it('is open by default', async () => {
    const a = await surveyAccessFor(db(), actor(['Care Coordinator']), survey());
    expect(a).toMatchObject({ source: 'open', results: true, responses: true, configure: false, threshold: 0 });
  });

  it('limits a survey to a library role through the organisation’s role ("HR manager" → HR)', async () => {
    const s = survey({ accessPolicy: hrOnly });
    expect(await surveyAccessFor(db(), actor(['HR']), s)).toMatchObject({ results: true, responses: true });
    expect(await surveyAccessFor(db(), actor(['Care Coordinator']), s)).toMatchObject({ results: false, responses: false });
  });

  it('can open the figures to everyone and keep individual responses to named people', async () => {
    const s = survey({
      accessPolicy: { responses: { restricted: true, ownerKeys: [], roleIds: [], userIds: ['u9'] }, results: { restricted: false } },
    });
    expect(await surveyAccessFor(db(), actor(['Care Coordinator']), s)).toMatchObject({ results: true, responses: false });
    expect(await surveyAccessFor(db(), actor(['Care Coordinator'], 'u9'), s)).toMatchObject({ results: true, responses: true });
  });

  it('always lets admins and the survey’s maker in (they set it)', async () => {
    const s = survey({ accessPolicy: hrOnly });
    expect(await surveyAccessFor(db(), actor(['Admin']), s)).toMatchObject({ responses: true, configure: true });
    expect(await surveyAccessFor(db(), actor(['Care Coordinator'], 'maker'), s)).toMatchObject({ responses: true, configure: true });
  });

  it('never lets in the person the survey is about (a manager’s copy), whatever their role, even as its maker; admins keep it', async () => {
    const open = { responses: { restricted: false, ownerKeys: [], roleIds: [], userIds: [] }, results: { restricted: false, ownerKeys: [], roleIds: [], userIds: [] } };
    const s = survey({ accessPolicy: withExcludedUsers(open, ['rated']) });
    expect(await surveyAccessFor(db(), actor(['Registered Manager'], 'rated'), s)).toMatchObject({ results: false, responses: false, configure: false });
    expect(await surveyAccessFor(db(), actor(['Care Coordinator'], 'maker'), survey({ createdById: 'rated', accessPolicy: withExcludedUsers(hrOnly, ['maker']) }))).toMatchObject({
      results: false,
      responses: false,
    });
    expect(await surveyAccessFor(db(), actor(['Care Coordinator'], 'someone-else'), s)).toMatchObject({ results: true, responses: true });
    expect(await surveyAccessFor(db(), actor(['Admin'], 'rated'), s)).toMatchObject({ results: true, configure: true });
    // The exclusion is kept when read back, and added to (never replaced).
    expect(readAccessPolicy(withExcludedUsers(readAccessPolicy(s.accessPolicy), ['other']))?.excludeUserIds).toEqual(['rated', 'other']);
  });

  it('uses the ready-made default until the organisation saves its own', async () => {
    const meta = { access: { responses: ['REGISTERED_MANAGER'], results: ['REGISTERED_MANAGER'], reportingThreshold: 10 } };
    const s = survey({ libraryReference: 'SUR-PWS-014', isAnonymous: true });
    const cc = await surveyAccessFor(db({ catalogueMeta: meta }), actor(['Care Coordinator']), s);
    expect(cc).toMatchObject({ source: 'ready-made', results: false, threshold: 10 });
    const rm = await surveyAccessFor(db({ catalogueMeta: meta }), actor(['Registered Manager']), s);
    expect(rm).toMatchObject({ results: true, responses: true });
  });

  it('a period follows its repeating survey', async () => {
    const source = survey({ id: 'src', accessPolicy: hrOnly });
    const a = await surveyAccessFor(db({ source }), actor(['Care Coordinator']), survey({ id: 'p1', clonedFromId: 'src' }));
    expect(a).toMatchObject({ results: false, ownSurveyId: 'src' });
  });

  it('lists the surveys whose results someone may not see (CQC evidence views)', async () => {
    const d = db();
    d.survey.findMany.mockResolvedValue([survey({ id: 'a', accessPolicy: hrOnly }), survey({ id: 'b' })]);
    expect([...(await surveysWithoutResultsAccess(d, actor(['Care Coordinator']), ['a', 'b']))]).toEqual(['a']);
    expect((await surveysWithoutResultsAccess(d, actor(['Admin']), ['a', 'b'])).size).toBe(0);
  });

  it('limits survey audit entries to surveys whose results someone may see, in their branches; admins see all', async () => {
    const d = db();
    d.survey.findMany.mockResolvedValue([
      survey({ id: 'a', accessPolicy: hrOnly, locationIds: ['leeds'], isTemplate: false }),
      survey({ id: 'b', locationIds: ['leeds'], isTemplate: false }),
      survey({ id: 'c', locationIds: ['york'], isTemplate: false }),
      survey({ id: 'd', locationIds: [], isTemplate: false }),
    ]);
    const branchCc = { ...actor(['Care Coordinator']), assignedLocationIds: ['leeds'] };
    expect([...((await surveysHiddenFromAudit(d, branchCc)) as Set<string>)].sort()).toEqual(['a', 'c', 'd']);
    expect([...((await surveysHiddenFromAudit(d, actor(['HR'], 'u2'))) as Set<string>)]).toEqual([]);
    // Library surveys are not the organisation's surveys.
    expect(d.survey.findMany.mock.calls[0][0].where).toEqual({ isCatalogue: false });
    expect(await surveysHiddenFromAudit(d, actor(['Admin']))).toBeNull();
    // Audit access without survey access (e.g. an inspector): no survey entries about a survey.
    expect(await surveysHiddenFromAudit(d, { ...actor(['CQC Inspector']), permissions: ['audit_logs.read'] })).toBe('all');
  });
});

describe('reporting threshold', () => {
  it('defaults to 5 where answers can be given without a name, and is off otherwise', () => {
    expect(effectiveThreshold({ isAnonymous: true, allowAnonymousResponses: false, reportingThreshold: null }, null)).toBe(5);
    expect(effectiveThreshold({ isAnonymous: false, allowAnonymousResponses: true, reportingThreshold: null }, null)).toBe(5);
    expect(effectiveThreshold({ isAnonymous: false, allowAnonymousResponses: false, reportingThreshold: null }, null)).toBe(0);
  });
  it('takes the survey’s own, else the ready-made default, never below 5 when anonymous', () => {
    expect(effectiveThreshold({ isAnonymous: true, allowAnonymousResponses: false, reportingThreshold: 10 }, 20)).toBe(10);
    expect(effectiveThreshold({ isAnonymous: true, allowAnonymousResponses: false, reportingThreshold: null }, 10)).toBe(10);
    expect(effectiveThreshold({ isAnonymous: true, allowAnonymousResponses: false, reportingThreshold: 2 }, null)).toBe(5);
    expect(effectiveThreshold({ isAnonymous: false, allowAnonymousResponses: false, reportingThreshold: 3 }, null)).toBe(3);
  });
  it('says how many more answers are needed', () => {
    expect(thresholdNote(5, 3)).toMatch(/^2 more answers are needed before results show/);
    expect(thresholdNote(5, 4)).toMatch(/^1 more answer is needed/);
    expect(thresholdNote(5, 5)).toBeNull();
    expect(thresholdNote(0, 0)).toBeNull();
  });
  it('reads a ready-made default, giving whoever sees responses the figures too', () => {
    const { policy, threshold } = libraryAccess({ access: { responses: ['HR_MANAGER'], results: ['REGISTERED_MANAGER'], reportingThreshold: 10 } });
    expect(policy?.results.ownerKeys.sort()).toEqual(['HR_MANAGER', 'REGISTERED_MANAGER']);
    expect(threshold).toBe(10);
  });
});
