import { LearningTasksService } from './learning-tasks.service';

const NOW = Date.now();

function setup(assignment: Record<string, unknown>, openTasks: Record<string, unknown>[] = []) {
  const prisma: any = {
    learningAssignment: { findUnique: jest.fn().mockResolvedValue(assignment) },
    employeePersonalDetail: { findFirst: jest.fn().mockResolvedValue({ firstName: 'Grace', lastName: 'Mensah' }) },
    employeeEmployment: { findFirst: jest.fn().mockResolvedValue({ locationId: 'loc-1', baseLocationId: null }) },
    role: {
      findFirst: jest.fn(async ({ where }: any) => (where.id ? null : { id: 'role-admin' })),
    },
    rolePermission: { findFirst: jest.fn().mockResolvedValue(null) },
    roleTask: {
      findFirst: jest.fn(async ({ where }: any) => openTasks.find((t) => t.sourceType === where.sourceType) ?? null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const settings = { getOrCreate: jest.fn().mockResolvedValue({ taskRoleId: null, defaultExpiryWarningDays: 30 }) };
  return { prisma, service: new LearningTasksService(prisma, settings as any) };
}

const base = {
  id: 'a-1',
  employeeId: 'e-1',
  status: 'IN_PROGRESS',
  dueAt: new Date(NOW + 86_400_000),
  completedLate: false,
  completedAt: null,
  course: { title: 'Fire safety' },
  reviews: [],
};

describe('LearningTasksService', () => {
  it('waiting for sign-off: opens an outcome task for the Admin role at the carer branch', async () => {
    const { prisma, service } = setup({ ...base, status: 'AWAITING_APPROVAL' });
    await service.syncAssignment('a-1');
    expect(prisma.roleTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceType: 'LEARNING_OUTCOME',
        sourceId: 'a-1',
        roleId: 'role-admin',
        locationId: 'loc-1',
        title: 'Record the outcome: Grace Mensah, Fire safety',
        link: '/learning/assignments?open=a-1',
      }),
    });
  });

  it('outcome saved: the open outcome task is closed as done', async () => {
    const { prisma, service } = setup({ ...base, status: 'COMPLETED' }, [
      { id: 't-1', sourceType: 'LEARNING_OUTCOME', title: 'x', description: null, dueDate: new Date() },
    ]);
    await service.syncAssignment('a-1');
    expect(prisma.roleTask.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: expect.objectContaining({ status: 'DONE', note: 'Done in Learning' }),
    });
    expect(prisma.roleTask.create).not.toHaveBeenCalled();
  });

  it('overdue: one task, not a second one on the next sync', async () => {
    const overdue = { ...base, status: 'OVERDUE', dueAt: new Date(NOW - 86_400_000) };
    const first = setup(overdue);
    await first.service.syncAssignment('a-1');
    expect(first.prisma.roleTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceType: 'LEARNING_OVERDUE' }),
    });
    const again = setup(overdue, [
      {
        id: 't-2',
        sourceType: 'LEARNING_OVERDUE',
        title: 'Overdue training: Grace Mensah, Fire safety',
        description: 'Extend the due date, take action or mark it as incomplete.',
        dueDate: new Date(Date.UTC(overdue.dueAt.getUTCFullYear(), overdue.dueAt.getUTCMonth(), overdue.dueAt.getUTCDate())),
        roleId: 'role-admin',
      },
    ]);
    await again.service.syncAssignment('a-1');
    expect(again.prisma.roleTask.create).not.toHaveBeenCalled();
    expect(again.prisma.roleTask.update).not.toHaveBeenCalled();
  });

  it('carer gave a late reason: review task until the office saves a review', async () => {
    const reason = { kind: 'CARER_LATE_REASON', createdAt: new Date(NOW - 1000), note: 'I was off sick' };
    const open = setup({ ...base, status: 'IN_PROGRESS', reviews: [reason] });
    await open.service.syncAssignment('a-1');
    expect(open.prisma.roleTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceType: 'LEARNING_LATE_REVIEW', description: "Carer's reason: I was off sick" }),
    });
    const reviewed = setup(
      { ...base, reviews: [{ kind: 'REASON', createdAt: new Date(NOW), note: null }, reason] },
      [{ id: 't-3', sourceType: 'LEARNING_LATE_REVIEW', title: 'x', description: null, dueDate: new Date() }],
    );
    await reviewed.service.syncAssignment('a-1');
    expect(reviewed.prisma.roleTask.update).toHaveBeenCalledWith({
      where: { id: 't-3' },
      data: expect.objectContaining({ status: 'DONE' }),
    });
  });

  it('unassigned course: its open task is cancelled, not done', async () => {
    const { prisma, service } = setup({ ...base, status: 'CANCELLED' }, [
      { id: 't-4', sourceType: 'LEARNING_OVERDUE', title: 'x', description: null, dueDate: new Date() },
    ]);
    await service.syncAssignment('a-1');
    expect(prisma.roleTask.update).toHaveBeenCalledWith({ where: { id: 't-4' }, data: { status: 'CANCELLED' } });
  });
});
