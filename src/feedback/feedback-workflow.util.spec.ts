import {
  addWorkingDays,
  complaintOverdue,
  formatFeedbackReference,
  nextFeedbackStatus,
} from './feedback-workflow.util';

describe('feedback-workflow.util', () => {
  it('adds working days skipping weekends', () => {
    // Thu 8 Oct 2026 + 3 working days = Tue 13 Oct
    const from = new Date('2026-10-08T10:00:00.000Z');
    expect(addWorkingDays(from, 3).toISOString()).toBe(
      '2026-10-13T10:00:00.000Z',
    );
    // Fri + 1 = Mon
    expect(
      addWorkingDays(new Date('2026-10-09T09:00:00.000Z'), 1).toISOString(),
    ).toBe('2026-10-12T09:00:00.000Z');
  });

  it('formats references per type', () => {
    expect(formatFeedbackReference('COMPLAINT', 2026, 7)).toBe('CMP-2026-0007');
    expect(formatFeedbackReference('COMPLIMENT', 2026, 12)).toBe(
      'CPL-2026-0012',
    );
  });

  it('allows the complaint workflow in order and blocks invalid steps', () => {
    expect(nextFeedbackStatus('COMPLAINT', 'RECEIVED', 'ACKNOWLEDGE')).toBe(
      'ACKNOWLEDGED',
    );
    expect(
      nextFeedbackStatus('COMPLAINT', 'ACKNOWLEDGED', 'START_INVESTIGATION'),
    ).toBe('INVESTIGATING');
    expect(nextFeedbackStatus('COMPLAINT', 'INVESTIGATING', 'RESPOND')).toBe(
      'RESPONDED',
    );
    expect(nextFeedbackStatus('COMPLAINT', 'RESPONDED', 'CLOSE')).toBe(
      'CLOSED',
    );
    expect(nextFeedbackStatus('COMPLAINT', 'CLOSED', 'REOPEN')).toBe(
      'INVESTIGATING',
    );
    expect(nextFeedbackStatus('COMPLAINT', 'CLOSED', 'ACKNOWLEDGE')).toBeNull();
    expect(nextFeedbackStatus('COMPLAINT', 'RECEIVED', 'SHARE')).toBeNull();
  });

  it('compliments are shared or closed, then can be reopened', () => {
    expect(nextFeedbackStatus('COMPLIMENT', 'RECEIVED', 'SHARE')).toBe(
      'CLOSED',
    );
    expect(nextFeedbackStatus('COMPLIMENT', 'CLOSED', 'REOPEN')).toBe(
      'RECEIVED',
    );
    expect(nextFeedbackStatus('COMPLIMENT', 'RECEIVED', 'RESPOND')).toBeNull();
  });

  it('flags overdue acknowledge and response only while open', () => {
    const now = new Date('2026-10-20T00:00:00.000Z');
    const base = {
      type: 'COMPLAINT' as const,
      status: 'RECEIVED' as const,
      acknowledgeDueAt: new Date('2026-10-13T00:00:00.000Z'),
      acknowledgedAt: null,
      responseDueAt: new Date('2026-10-19T00:00:00.000Z'),
      respondedAt: null,
    };
    expect(complaintOverdue(base, now)).toEqual({
      acknowledge: true,
      response: true,
    });
    expect(complaintOverdue({ ...base, status: 'CLOSED' }, now)).toEqual({
      acknowledge: false,
      response: false,
    });
    expect(
      complaintOverdue(
        {
          ...base,
          status: 'RESPONDED',
          acknowledgedAt: now,
          respondedAt: now,
        },
        now,
      ),
    ).toEqual({ acknowledge: false, response: false });
  });
});
