import { CqcEvidenceService } from './cqc-evidence.service';

/** CQC evidence made from survey results follows the survey's access (src/surveys/survey-access.ts). */
describe('CQC evidence: per-survey access', () => {
  const hr = { restricted: true, ownerKeys: ['HR_MANAGER'], roleIds: [], userIds: [] };
  const prisma: any = {
    location: { findMany: jest.fn().mockResolvedValue([]) },
    cqcEvidence: { findMany: jest.fn().mockResolvedValue([{ sourceId: 'staff-survey' }, { sourceId: 'open-survey' }]) },
    survey: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'staff-survey', clonedFromId: null, createdById: 'x', isAnonymous: true, allowAnonymousResponses: false, libraryReference: null, libraryMeta: null, accessPolicy: { responses: hr, results: hr }, reportingThreshold: null },
        { id: 'open-survey', clonedFromId: null, createdById: 'x', isAnonymous: false, allowAnonymousResponses: false, libraryReference: null, libraryMeta: null, accessPolicy: null, reportingThreshold: null },
      ]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    role: {
      findMany: jest.fn(async (args: any) => {
        const all = [{ id: 'role-hr', name: 'HR' }, { id: 'role-cc', name: 'Care Coordinator' }];
        return args?.where?.name?.in ? all.filter((r) => args.where.name.in.includes(r.name)) : all;
      }),
    },
    surveyAlertOwnerRole: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new CqcEvidenceService(prisma, {} as any, {} as any, {} as any);

  it('hides evidence from a survey whose results are limited to other people', async () => {
    const where = await service.visibleWhere({ locationIds: null } as any, { id: 'cc', roles: ['Care Coordinator'], permissions: [] } as any);
    expect(where).toEqual({ AND: [{ NOT: { sourceType: 'SURVEY_RESULT', sourceId: { in: ['staff-survey'] } } }] });
  });

  it('shows it to the named role and to admins', async () => {
    expect(await service.visibleWhere({ locationIds: null } as any, { id: 'h', roles: ['HR'], permissions: [] } as any)).toEqual({});
    expect(await service.visibleWhere({ locationIds: null } as any, { id: 'a', roles: ['Admin'], permissions: [] } as any)).toEqual({});
  });
});
