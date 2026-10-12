import {
  FutureVisitTimeError,
  resolveTrustedCompletionTimes,
  unverifiedTimeReasons,
} from './visit-time-trust.util';

const at = (hm: string) => new Date(`2026-11-03T${hm}:00Z`);

describe('resolveTrustedCompletionTimes (VW-02)', () => {
  it('uses server times when the app reports nothing', () => {
    const t = resolveTrustedCompletionTimes({ serverNow: at('10:02'), serverCheckInAt: at('09:01') });
    expect(t).toMatchObject({ startSource: 'SERVER', endSource: 'SERVER', needsReview: false });
    expect(t.start).toEqual(at('09:01'));
    expect(t.end).toEqual(at('10:02'));
  });

  it('ignores a reported start when the server recorded the check-in', () => {
    const t = resolveTrustedCompletionTimes({
      serverNow: at('10:02'),
      serverCheckInAt: at('09:20'),
      reportedStart: '2026-11-03T08:00:00Z',
      reportedEnd: '2026-11-03T10:00:00Z',
    });
    expect(t.start).toEqual(at('09:20'));
    expect(t.startSource).toBe('SERVER');
    expect(t.needsReview).toBe(false);
    // The claim is kept as evidence.
    expect(t.evidence.reportedStart).toBe('2026-11-03T08:00:00.000Z');
  });

  it('accepts a reported finish close to when the server received it', () => {
    const t = resolveTrustedCompletionTimes({
      serverNow: at('10:10'),
      serverCheckInAt: at('09:00'),
      reportedEnd: '2026-11-03T10:00:00Z',
    });
    expect(t.end).toEqual(at('10:00'));
    expect(t.endSource).toBe('CARER_REPORTED');
    expect(t.needsReview).toBe(false);
  });

  it('keeps an offline finish but holds it for office review', () => {
    const t = resolveTrustedCompletionTimes({
      serverNow: at('14:00'),
      serverCheckInAt: at('09:00'),
      reportedEnd: '2026-11-03T10:00:00Z',
    });
    expect(t.end).toEqual(at('10:00'));
    expect(t.needsReview).toBe(true);
    expect(t.reviewReasons[0]).toMatch(/240 minutes before the server received/);
  });

  it('uses a reported start only when there was no check-in, and flags it', () => {
    const t = resolveTrustedCompletionTimes({
      serverNow: at('10:02'),
      reportedStart: '2026-11-03T09:00:00Z',
      reportedEnd: '2026-11-03T10:00:00Z',
    });
    expect(t.start).toEqual(at('09:00'));
    expect(t.startSource).toBe('CARER_REPORTED');
    expect(t.needsReview).toBe(true);
    expect(t.reviewReasons.join(' ')).toMatch(/no check-in was recorded/);
  });

  it('refuses a finish or start in the future, allowing for small clock drift', () => {
    expect(() =>
      resolveTrustedCompletionTimes({ serverNow: at('10:00'), reportedEnd: '2026-11-03T11:00:00Z' }),
    ).toThrow(FutureVisitTimeError);
    expect(() =>
      resolveTrustedCompletionTimes({ serverNow: at('10:00'), reportedStart: '2026-11-03T12:00:00Z' }),
    ).toThrow(FutureVisitTimeError);
    const drift = resolveTrustedCompletionTimes({
      serverNow: at('10:00'),
      serverCheckInAt: at('09:00'),
      reportedEnd: '2026-11-03T10:01:00Z',
    });
    expect(drift.end).toEqual(at('10:00'));
  });

  it('flags a start that is not before the finish', () => {
    const t = resolveTrustedCompletionTimes({
      serverNow: at('10:00'),
      serverCheckInAt: at('09:30'),
      reportedEnd: '2026-11-03T09:00:00Z',
    });
    expect(t.needsReview).toBe(true);
    expect(t.reviewReasons.join(' ')).toMatch(/not before the finish/);
  });

  it('has no start when there is neither a check-in nor a reported start', () => {
    const t = resolveTrustedCompletionTimes({ serverNow: at('10:00') });
    expect(t.start).toBeNull();
    expect(t.startSource).toBe('NONE');
  });
});

describe('unverifiedTimeReasons', () => {
  const trust = {
    needsReview: true,
    reviewReasons: ['Start time was reported by the carer; no check-in was recorded.'],
    startSource: 'CARER_REPORTED',
    endSource: 'SERVER',
  };
  it('returns the reasons until the office verifies the times', () => {
    expect(unverifiedTimeReasons({ employeeApp: { attendanceTimes: trust } })).toHaveLength(1);
    expect(
      unverifiedTimeReasons({ employeeApp: { attendanceTimes: { ...trust, verifiedAt: '2026-11-04T09:00:00Z' } } }),
    ).toEqual([]);
  });
  it('returns nothing for visits without the record or without a flag', () => {
    expect(unverifiedTimeReasons(null)).toEqual([]);
    expect(unverifiedTimeReasons({})).toEqual([]);
    expect(unverifiedTimeReasons({ employeeApp: { attendanceTimes: { ...trust, needsReview: false } } })).toEqual([]);
  });
});
