import { RoleTasksService } from './role-tasks.service';

/** Survey alert tasks follow the survey's access: hidden from people who may not see its results. */
describe('RoleTasksService: survey alert tasks and per-survey access', () => {
  const hr = { restricted: true, ownerKeys: ['HR_MANAGER'], roleIds: [], userIds: [] };
  const prisma: any = {
    surveyAlert: { findMany: jest.fn().mockResolvedValue([{ id: 'al-hr', surveyId: 's-hr' }, { id: 'al-open', surveyId: 's-open' }]) },
    survey: {
      findMany: jest.fn().mockResolvedValue([
        { id: 's-hr', clonedFromId: null, createdById: 'x', isAnonymous: true, allowAnonymousResponses: false, libraryReference: null, libraryMeta: null, accessPolicy: { responses: hr, results: hr }, reportingThreshold: null },
        { id: 's-open', clonedFromId: null, createdById: 'x', isAnonymous: false, allowAnonymousResponses: false, libraryReference: null, libraryMeta: null, accessPolicy: null, reportingThreshold: null },
      ]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    role: {
      findMany: jest.fn(async (args: any) => {
        const all = [{ id: 'role-hr', name: 'HR' }, { id: 'role-m', name: 'Manager' }];
        return args?.where?.name?.in ? all.filter((r) => args.where.name.in.includes(r.name)) : all;
      }),
    },
    surveyAlertOwnerRole: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new RoleTasksService(prisma, {} as any, {} as any);
  const rows = [
    { id: 't1', sourceType: 'SURVEY_ALERT', sourceId: 'al-hr' },
    { id: 't2', sourceType: 'SURVEY_ALERT', sourceId: 'al-open' },
    { id: 't3', sourceType: null, sourceId: null },
  ];

  it('hides an HR-only survey’s alert task from a manager who manages every role task', async () => {
    const out = await (service as any).withoutHiddenSurveyTasks({ id: 'm', roles: ['Manager'], permissions: ['role_tasks.manage'] }, rows);
    expect(out.map((r: any) => r.id)).toEqual(['t2', 't3']);
  });

  it('refuses a status change on a hidden task even with its id', async () => {
    prisma.roleTask = { findUnique: jest.fn().mockResolvedValue({ id: 't1', roleId: 'role-m', locationId: null, status: 'OPEN', sourceType: 'SURVEY_ALERT', sourceId: 'al-hr' }) };
    prisma.role.findMany.mockImplementationOnce(async () => [{ id: 'role-m' }]);
    const user = { id: 'm', roles: ['Manager'], permissions: ['role_tasks.manage'], accountKind: 'user', assignedLocationIds: null };
    await expect(service.updateStatus(user as any, 't1', { status: 'IN_PROGRESS' } as any)).rejects.toThrow(/belongs to another role/);
  });

  it('shows it to HR', async () => {
    const out = await (service as any).withoutHiddenSurveyTasks({ id: 'h', roles: ['HR'], permissions: [] }, rows);
    expect(out.map((r: any) => r.id)).toEqual(['t1', 't2', 't3']);
  });
});
