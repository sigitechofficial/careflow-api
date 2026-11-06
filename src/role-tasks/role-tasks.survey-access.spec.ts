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

  it('hides a survey action task the same way, and never closes or reopens one from the task list', async () => {
    prisma.surveyAction = { findMany: jest.fn().mockResolvedValue([{ id: 'act-hr', surveyId: 's-hr' }, { id: 'act-open', surveyId: 's-open' }]), updateMany: jest.fn() };
    const actionRows = [
      { id: 'a1', sourceType: 'SURVEY_ACTION', sourceId: 'act-hr' },
      { id: 'a2', sourceType: 'SURVEY_ACTION', sourceId: 'act-open' },
    ];
    const out = await (service as any).withoutHiddenSurveyTasks({ id: 'm', roles: ['Manager'], permissions: ['role_tasks.manage'] }, actionRows);
    expect(out.map((r: any) => r.id)).toEqual(['a2']);

    const user = { id: 'm', roles: ['Manager'], permissions: ['role_tasks.manage'], accountKind: 'user', assignedLocationIds: null };
    prisma.roleTask = { findUnique: jest.fn().mockResolvedValue({ id: 'a2', roleId: 'role-m', locationId: null, status: 'OPEN', sourceType: 'SURVEY_ACTION', sourceId: 'act-open' }), update: jest.fn() };
    prisma.role.findMany.mockImplementationOnce(async () => [{ id: 'role-m' }]);
    await expect(service.updateStatus(user as any, 'a2', { status: 'DONE' } as any)).rejects.toThrow(/Close a survey action on its page/);
    prisma.roleTask.findUnique.mockResolvedValue({ id: 'a2', roleId: 'role-m', locationId: null, status: 'DONE', sourceType: 'SURVEY_ACTION', sourceId: 'act-open' });
    prisma.role.findMany.mockImplementationOnce(async () => [{ id: 'role-m' }]);
    await expect(service.updateStatus(user as any, 'a2', { status: 'OPEN' } as any)).rejects.toThrow(/Reopen a survey action on its page/);
    expect(prisma.roleTask.update).not.toHaveBeenCalled();
    expect(prisma.surveyAction.updateMany).not.toHaveBeenCalled();
  });

  it('shows it to HR', async () => {
    const out = await (service as any).withoutHiddenSurveyTasks({ id: 'h', roles: ['HR'], permissions: [] }, rows);
    expect(out.map((r: any) => r.id)).toEqual(['t1', 't2', 't3']);
  });

  it('a task with no branch (a survey for several branches) shows only to people whose branches cover the survey', async () => {
    prisma.survey.findMany.mockImplementation(async (args: any) =>
      args?.select?.locationIds
        ? [{ id: 's-open', locationIds: ['L1', 'L2'], isTemplate: false }]
        : [{ id: 's-open', clonedFromId: null, createdById: 'x', isAnonymous: false, allowAnonymousResponses: false, libraryReference: null, libraryMeta: null, accessPolicy: null, reportingThreshold: null }],
    );
    prisma.surveyAlert.findMany.mockResolvedValueOnce([{ id: 'al-open', surveyId: 's-open' }]);
    const t = [{ id: 't2', sourceType: 'SURVEY_ALERT', sourceId: 'al-open' }];
    const oneBranch = await (service as any).withoutHiddenSurveyTasks({ id: 'b', roles: ['Manager'], permissions: [], assignedLocationIds: ['L1'] }, t);
    expect(oneBranch).toEqual([]);
    prisma.surveyAlert.findMany.mockResolvedValueOnce([{ id: 'al-open', surveyId: 's-open' }]);
    const both = await (service as any).withoutHiddenSurveyTasks({ id: 'b', roles: ['Manager'], permissions: [], assignedLocationIds: ['L1', 'L2'] }, t);
    expect(both.map((r: any) => r.id)).toEqual(['t2']);
  });

  it('a done survey follow-up is never reopened from the task list', async () => {
    const user = { id: 'm', roles: ['Manager'], permissions: ['role_tasks.manage'], accountKind: 'user', assignedLocationIds: null };
    prisma.surveyAlert.findMany.mockResolvedValueOnce([{ id: 'al-open', surveyId: 's-open' }]);
    prisma.roleTask = { findUnique: jest.fn().mockResolvedValue({ id: 't2', roleId: 'role-m', locationId: null, status: 'DONE', sourceType: 'SURVEY_ALERT', sourceId: 'al-open' }), update: jest.fn() };
    prisma.role.findMany.mockImplementationOnce(async () => [{ id: 'role-m' }]);
    await expect(service.updateStatus(user as any, 't2', { status: 'OPEN' } as any)).rejects.toThrow(/Reopen a survey follow-up on its page/);
    expect(prisma.roleTask.update).not.toHaveBeenCalled();
  });
});
