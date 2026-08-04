import { computeVisitTaskProgress } from './visit-task-progress.util';

describe('computeVisitTaskProgress', () => {
  it('counts planned completions', () => {
    expect(
      computeVisitTaskProgress({
        plannedAssignmentIds: ['a', 'b', 'c', 'd', 'e'],
        completions: [
          { assignmentId: 'a', isCompleted: true },
          { assignmentId: 'b', isCompleted: true },
          { assignmentId: 'c', isCompleted: true },
          { assignmentId: 'd', isCompleted: true },
          { assignmentId: 'e', isCompleted: true },
        ],
      }),
    ).toEqual({ completed: 5, total: 5 });
  });

  it('does not under-count when one planned is incomplete', () => {
    expect(
      computeVisitTaskProgress({
        plannedAssignmentIds: ['a', 'b', 'c', 'd', 'e'],
        completions: [
          { assignmentId: 'a', isCompleted: true },
          { assignmentId: 'b', isCompleted: true },
          { assignmentId: 'c', isCompleted: true },
          { assignmentId: 'd', isCompleted: true },
          { assignmentId: 'e', isCompleted: false },
        ],
      }),
    ).toEqual({ completed: 4, total: 5 });
  });

  it('includes ad-hoc rows in total even when incomplete (matches task list length)', () => {
    expect(
      computeVisitTaskProgress({
        plannedAssignmentIds: ['a', 'b', 'c', 'd'],
        completions: [
          { assignmentId: 'a', isCompleted: true },
          { assignmentId: 'b', isCompleted: true },
          { assignmentId: 'c', isCompleted: true },
          { assignmentId: 'd', isCompleted: true },
          { assignmentId: null, isCompleted: false },
        ],
      }),
    ).toEqual({ completed: 4, total: 5 });
  });

  it('counts completed ad-hoc toward done', () => {
    expect(
      computeVisitTaskProgress({
        plannedAssignmentIds: ['a', 'b', 'c', 'd'],
        completions: [
          { assignmentId: 'a', isCompleted: true },
          { assignmentId: 'b', isCompleted: true },
          { assignmentId: 'c', isCompleted: true },
          { assignmentId: 'd', isCompleted: true },
          { assignmentId: null, isCompleted: true },
        ],
      }),
    ).toEqual({ completed: 5, total: 5 });
  });
});
