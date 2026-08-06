import {
  computeVisitTaskProgress,
  encodeVisitTaskOutcomeFields,
  inferVisitTaskOutcome,
  isVisitTaskAddressed,
  stripVisitTaskOutcomeNotes,
} from './visit-task-progress.util';

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

  it('counts DECLINED / PARTIAL as addressed even when isCompleted was false (legacy)', () => {
    expect(
      computeVisitTaskProgress({
        plannedAssignmentIds: ['a', 'b', 'c', 'd', 'e'],
        completions: [
          { assignmentId: 'a', isCompleted: true },
          { assignmentId: 'b', isCompleted: true },
          { assignmentId: 'c', isCompleted: true },
          { assignmentId: 'd', isCompleted: true },
          {
            assignmentId: 'e',
            isCompleted: false,
            recordedValue: 'DECLINED',
            notes: 'Outcome: DECLINED · Reason: CLIENT_REQUESTED_LATER',
          },
        ],
      }),
    ).toEqual({ completed: 5, total: 5 });
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

describe('inferVisitTaskOutcome / isVisitTaskAddressed', () => {
  it('infers declined from notes and recordedValue', () => {
    expect(
      inferVisitTaskOutcome({
        isCompleted: false,
        recordedValue: 'DECLINED',
        notes: 'Outcome: DECLINED · Reason: CLIENT_REQUESTED_LATER',
      }),
    ).toBe('declined');
    expect(
      isVisitTaskAddressed({
        isCompleted: false,
        recordedValue: 'DECLINED',
        notes: 'Outcome: DECLINED',
      }),
    ).toBe(true);
  });

  it('infers completed when isCompleted without partial/declined markers', () => {
    expect(inferVisitTaskOutcome({ isCompleted: true, recordedValue: '5' })).toBe('completed');
  });
});

describe('encodeVisitTaskOutcomeFields / stripVisitTaskOutcomeNotes', () => {
  it('encodes PARTIAL with notes required marker and sentinel', () => {
    expect(
      encodeVisitTaskOutcomeFields({
        outcome: 'PARTIAL',
        notes: 'Client tired',
        recordedValue: null,
      }),
    ).toEqual({
      isCompleted: true,
      notes: 'Outcome: PARTIAL · Client tired',
      recordedValue: 'PARTIAL',
    });
  });

  it('strips outcome markers for editable notes', () => {
    expect(
      stripVisitTaskOutcomeNotes('Outcome: DECLINED · Reason: REFUSED · Asked later'),
    ).toBe('Asked later');
  });

  it('clears PARTIAL sentinel when outcome is COMPLETED', () => {
    expect(
      encodeVisitTaskOutcomeFields({
        outcome: 'COMPLETED',
        notes: 'ok',
        recordedValue: 'PARTIAL',
      }),
    ).toEqual({
      isCompleted: true,
      notes: 'ok',
      recordedValue: null,
    });
  });
});
