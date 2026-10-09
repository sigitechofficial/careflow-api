import { EmployeeAppVisitsService } from './employee-app-visits.service';

type UpdateManyArgs = {
  where: { OR: Array<Record<string, unknown>> };
  data: unknown;
};

function serviceWith(
  doneBefore: Array<{
    assignmentId: string | null;
    taskCatalogueTaskId: string | null;
  }>,
) {
  const calls: UpdateManyArgs[] = [];
  const svc = Object.create(
    EmployeeAppVisitsService.prototype,
  ) as EmployeeAppVisitsService & Record<string, unknown>;
  Object.assign(svc, {
    prisma: {
      scheduledVisitTaskCompletion: {
        findMany: async () => doneBefore,
        updateMany: async (args: UpdateManyArgs) => {
          calls.push(args);
          return { count: args.where.OR.length };
        },
      },
    },
    housekeeping: { saveVisitJobTasks: async () => ({}) },
    assertOperationsUnlocked: async () => undefined,
    loadJobForEmployee: async () => ({
      job: { requiredCarers: 1, allocations: [] },
    }),
    assertLeadMayWriteCareRecord: () => undefined,
    getTasks: async () => ({ data: {} }),
  });
  return { svc, calls };
}

describe('task "completed by" stamping', () => {
  it('bulk save stamps only tasks this save completed — not the office-marked one', async () => {
    const { svc, calls } = serviceWith([
      { assignmentId: 'office-task', taskCatalogueTaskId: 'c1' },
    ]);
    await svc.saveTasks('lead-1', 'job-1', {
      tasks: [
        { assignmentId: 'office-task', isCompleted: true },
        { assignmentId: 'new-task', isCompleted: true },
        { assignmentId: 'not-done', isCompleted: false },
        { taskCatalogueTaskId: 'extra-1', isExtra: true, isCompleted: true },
      ],
    } as never);
    expect(calls).toHaveLength(1);
    expect(calls[0].where.OR).toEqual([
      { assignmentId: 'new-task' },
      { assignmentId: null, taskCatalogueTaskId: 'extra-1' },
    ]);
    expect(calls[0].data).toEqual({ completedById: 'lead-1' });
  });

  it('nothing newly completed → no update at all', async () => {
    const { svc, calls } = serviceWith([
      { assignmentId: 'office-task', taskCatalogueTaskId: 'c1' },
    ]);
    await svc.saveTasks('lead-1', 'job-1', {
      tasks: [{ assignmentId: 'office-task', isCompleted: true }],
    } as never);
    expect(calls).toHaveLength(0);
  });
});
