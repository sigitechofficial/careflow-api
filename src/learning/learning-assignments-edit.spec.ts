import { LearningAssignmentsService } from './learning-assignments.service';

const FUTURE = new Date(Date.now() + 10 * 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a-1',
    status: 'ASSIGNED',
    courseId: 'c-1',
    courseVersionId: 'v-1',
    employeeId: 'e-1',
    dueAt: FUTURE,
    assignedAt: new Date('2026-11-17T09:00:00Z'),
    createdAt: new Date('2026-11-17T09:00:00Z'),
    updatedAt: new Date('2026-11-17T09:00:00Z'),
    ...overrides,
  };
}

function setup(row = baseRow()) {
  const tx: any = {
    learningAssignment: { update: jest.fn(async ({ data }: any) => ({ ...row, ...data })) },
    learningEmployeeProgress: { updateMany: jest.fn() },
    learningComplianceSnapshot: { deleteMany: jest.fn() },
  };
  const prisma: any = {
    learningAssignment: {
      findUnique: jest.fn().mockResolvedValue(row),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(async ({ data }: any) => ({ ...row, ...data })),
    },
    learningEmployeeProgress: { findUnique: jest.fn().mockResolvedValue({ startedAt: null, completedContentItems: 0 }) },
    learningAssessmentAttempt: { count: jest.fn().mockResolvedValue(0) },
    learningTrainingEventAttendee: { count: jest.fn().mockResolvedValue(0), updateMany: jest.fn() },
    learningCourse: {
      findFirst: jest.fn().mockResolvedValue({ id: 'c-2', status: 'PUBLISHED', currentVersionId: 'v-2' }),
      findUnique: jest.fn().mockResolvedValue({ title: 'Fire safety' }),
    },
    employee: { findFirst: jest.fn().mockResolvedValue({ id: 'e-2' }) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const audit = { logAudit: jest.fn() };
  const notifications = { notifyAssignmentCreated: jest.fn() };
  const compliance = { recalculateForAssignment: jest.fn() };
  const push = { assigned: jest.fn(), dueDateChanged: jest.fn() };
  const service = new LearningAssignmentsService(
    prisma,
    audit as any,
    {} as any,
    notifications as any,
    compliance as any,
    push as any,
  );
  jest.spyOn(service, 'validateActiveEmployee').mockResolvedValue({} as any);
  return { prisma, tx, audit, push, notifications, service };
}

describe('LearningAssignmentsService edit and unassign', () => {
  it('changes the due date and tells the carer', async () => {
    const { tx, push, service } = setup();
    const due = new Date(Date.now() + 20 * 86_400_000).toISOString();
    await service.update('a-1', 'u-1', { dueAt: due });
    expect(tx.learningAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dueAt: new Date(due) }) }),
    );
    expect(push.dueDateChanged).toHaveBeenCalled();
    expect(push.assigned).not.toHaveBeenCalled();
  });

  it('changes course and carer before the course is started, and moves the progress row', async () => {
    const { tx, push, service } = setup();
    await service.update('a-1', 'u-1', { courseId: 'c-2', employeeId: 'e-2' });
    expect(tx.learningAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ courseId: 'c-2', courseVersionId: 'v-2', employeeId: 'e-2' }),
      }),
    );
    expect(tx.learningEmployeeProgress.updateMany).toHaveBeenCalledWith({
      where: { assignmentId: 'a-1' },
      data: { employeeId: 'e-2', courseVersionId: 'v-2' },
    });
    expect(tx.learningComplianceSnapshot.deleteMany).toHaveBeenCalled();
    expect(push.assigned).toHaveBeenCalledWith([{ employeeId: 'e-2', assignmentId: 'a-1' }], 'Fire safety', FUTURE);
  });

  it('in progress: course or carer cannot change', async () => {
    const { service } = setup(baseRow({ status: 'IN_PROGRESS' }));
    await expect(service.update('a-1', 'u-1', { employeeId: 'e-2' })).rejects.toThrow('Only the due date can be changed');
  });

  it('status still Scheduled but a lesson is done: treated as started', async () => {
    const { prisma, service } = setup();
    prisma.learningEmployeeProgress.findUnique.mockResolvedValue({ startedAt: new Date(), completedContentItems: 1 });
    await expect(service.update('a-1', 'u-1', { courseId: 'c-2' })).rejects.toThrow('Only the due date can be changed');
  });

  it('booked on a session: course or carer cannot change', async () => {
    const { prisma, service } = setup();
    prisma.learningTrainingEventAttendee.count.mockResolvedValue(1);
    await expect(service.update('a-1', 'u-1', { employeeId: 'e-2' })).rejects.toThrow('booked on a session');
  });

  it('the new carer already has the course', async () => {
    const { prisma, service } = setup();
    prisma.learningAssignment.findFirst.mockResolvedValue({ id: 'other' });
    await expect(service.update('a-1', 'u-1', { employeeId: 'e-2' })).rejects.toThrow('already has this course');
  });

  it('due date in the past is refused', async () => {
    const { service } = setup();
    await expect(service.update('a-1', 'u-1', { dueAt: PAST.toISOString() })).rejects.toThrow('must be in the future');
  });

  it('nothing can be edited or unassigned once the due date has passed', async () => {
    const { service } = setup(baseRow({ status: 'OVERDUE', dueAt: PAST }));
    await expect(service.update('a-1', 'u-1', { dueAt: FUTURE.toISOString() })).rejects.toThrow();
    const s2 = setup(baseRow({ dueAt: PAST }));
    await expect(s2.service.unassign('a-1', 'u-1', { cancellationReason: 'Mistake' })).rejects.toThrow('due date has passed');
  });

  it('passed course cannot be unassigned', async () => {
    const { service } = setup(baseRow({ status: 'COMPLETED' }));
    await expect(service.unassign('a-1', 'u-1', { cancellationReason: 'Mistake' })).rejects.toThrow(
      'Only a scheduled or in-progress course',
    );
  });

  it('unassign cancels the course and any session booking, keeps the record', async () => {
    const { prisma, service } = setup();
    await service.unassign('a-1', 'u-1', { cancellationReason: 'Assigned by mistake' });
    expect(prisma.learningAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED', cancellationReason: 'Assigned by mistake' }),
      }),
    );
    expect(prisma.learningTrainingEventAttendee.updateMany).toHaveBeenCalledWith({
      where: { assignmentId: 'a-1', bookingStatus: { not: 'CANCELLED' } },
      data: { bookingStatus: 'CANCELLED' },
    });
  });

  it('unassign needs a reason', async () => {
    const { service } = setup();
    await expect(service.unassign('a-1', 'u-1', { cancellationReason: '  ' })).rejects.toThrow('Write why');
  });
});
