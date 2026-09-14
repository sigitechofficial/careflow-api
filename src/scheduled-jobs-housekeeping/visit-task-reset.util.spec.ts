import {
  applyVisitTaskResetMetadata,
  extraVisitTaskAssignmentId,
  parseTaskResets,
  parseVisitTaskAssignmentKey,
  taskCompletionHasDeliveryToReset,
} from './visit-task-reset.util';

describe('visit-task-reset.util', () => {
  it('parses planned and extra assignment keys', () => {
    expect(parseVisitTaskAssignmentKey('abc-123')).toEqual({
      kind: 'planned',
      assignmentId: 'abc-123',
      taskCatalogueTaskId: null,
      stampKey: 'abc-123',
    });
    expect(parseVisitTaskAssignmentKey(extraVisitTaskAssignmentId('cat-9'))).toEqual({
      kind: 'extra',
      assignmentId: null,
      taskCatalogueTaskId: 'cat-9',
      stampKey: 'extra-cat-9',
    });
  });

  it('detects completion to reset', () => {
    expect(taskCompletionHasDeliveryToReset({ isCompleted: false })).toBe(false);
    expect(taskCompletionHasDeliveryToReset({ isCompleted: true })).toBe(true);
    expect(taskCompletionHasDeliveryToReset({ notes: 'partial' })).toBe(true);
  });

  it('stamps taskResets without dropping other assignment ids', () => {
    const next = applyVisitTaskResetMetadata(
      { taskResets: { 'task-a': '2026-09-14T10:00:00.000Z' }, notes: 'keep' },
      {
        assignmentId: 'task-b',
        resetAt: '2026-09-14T11:00:00.000Z',
        reason: 'Wrong outcome',
        resetById: 'user-1',
      },
    );
    expect(parseTaskResets(next.taskResets)).toEqual({
      'task-a': '2026-09-14T10:00:00.000Z',
      'task-b': '2026-09-14T11:00:00.000Z',
    });
    expect(next.notes).toBe('keep');
    expect(next.taskResetReason).toBe('Wrong outcome');
  });
});
