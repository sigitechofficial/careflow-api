import {
  FutureVisitTimeError,
  attendanceTimeTrustFor,
  mergeCompletion,
  mergeOfficeTime,
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

describe('office-verified times (R-04)', () => {
  it('an office start replaces the server check-in and needs no review', () => {
    const t = resolveTrustedCompletionTimes({
      serverNow: at('10:00'),
      serverCheckInAt: at('09:25'),
      officeStart: '2026-11-03T09:00:00Z',
    });
    expect(t.start).toEqual(at('09:00'));
    expect(t.startSource).toBe('OFFICE');
    expect(t.needsReview).toBe(false);
  });

  it('an office finish is the record even when the completion arrives later', () => {
    const t = resolveTrustedCompletionTimes({
      serverNow: at('11:00'),
      serverCheckInAt: at('09:00'),
      officeEnd: '2026-11-03T10:00:00Z',
    });
    expect(t.end).toEqual(at('10:00'));
    expect(t.endSource).toBe('OFFICE');
    expect(t.needsReview).toBe(false);
  });

  it('a carer finish that contradicts the office finish is flagged, and the office time stays', () => {
    const t = resolveTrustedCompletionTimes({
      serverNow: at('11:00'),
      serverCheckInAt: at('09:00'),
      officeEnd: '2026-11-03T10:00:00Z',
      reportedEnd: '2026-11-03T10:55:00Z',
    });
    expect(t.end).toEqual(at('10:00'));
    expect(t.needsReview).toBe(true);
    expect(t.reviewReasons[0]).toMatch(/office recorded the finish.*55 minutes/);
  });

  it('a carer finish close to the office finish is not a conflict', () => {
    const t = resolveTrustedCompletionTimes({
      serverNow: at('10:10'),
      serverCheckInAt: at('09:00'),
      officeEnd: '2026-11-03T10:00:00Z',
      reportedEnd: '2026-11-03T10:05:00Z',
    });
    expect(t.needsReview).toBe(false);
  });
});

describe('per-carer records (R-03, R-16)', () => {
  const flagged = resolveTrustedCompletionTimes({ serverNow: at('14:00'), serverCheckInAt: at('09:00'), reportedEnd: '2026-11-03T10:00:00Z' });
  const clean = resolveTrustedCompletionTimes({ serverNow: at('10:00'), serverCheckInAt: at('09:00') });
  const officeFinish = { eventType: 'CHECK_OUT' as const, occurredAt: at('10:00'), byUserId: 'office-user', reason: 'Confirmed with client' };

  it('a completion records the outcome and the evidence for that carer', () => {
    const record = mergeCompletion(undefined, flagged);
    expect(record).toMatchObject({ needsReview: true, endSource: 'CARER_REPORTED', office: null, verifiedAt: null });
    expect(record.evidence?.reportedEnd).toBe('2026-11-03T10:00:00.000Z');
    expect(mergeCompletion(undefined, clean).needsReview).toBe(false);
  });

  it('office verification clears the flag and keeps the evidence', () => {
    const record = mergeOfficeTime(mergeCompletion(undefined, flagged), { ...officeFinish, verified: true, at: at('15:00') });
    expect(record.verifiedAt).toBe('2026-11-03T15:00:00.000Z');
    expect(record.office).toMatchObject({ end: '2026-11-03T10:00:00.000Z', byUserId: 'office-user', reason: 'Confirmed with client' });
    expect(record.evidence?.reportedEnd).toBe('2026-11-03T10:00:00.000Z');
    expect(record.reviewReasons).toHaveLength(1); // the reason is history, not erased
  });

  it('an office time recorded before completion survives the completion record', () => {
    const before = mergeOfficeTime(undefined, { eventType: 'CHECK_IN', occurredAt: at('09:00'), byUserId: 'office-user', verified: false });
    expect(before.verifiedAt).toBeUndefined();
    const after = mergeCompletion(before, clean);
    expect(after.office?.start).toBe('2026-11-03T09:00:00.000Z');
  });

  it('a second office entry keeps the first one\'s other time', () => {
    const start = mergeOfficeTime(undefined, { eventType: 'CHECK_IN', occurredAt: at('09:00'), byUserId: 'office-a', verified: false });
    const both = mergeOfficeTime(start, { eventType: 'CHECK_OUT', occurredAt: at('10:00'), byUserId: 'office-b', verified: false });
    expect(both.office).toMatchObject({ start: '2026-11-03T09:00:00.000Z', end: '2026-11-03T10:00:00.000Z', byUserId: 'office-b' });
  });

  it('a new completion is new evidence: an earlier office verification no longer covers it', () => {
    const verified = mergeOfficeTime(mergeCompletion(undefined, flagged), { ...officeFinish, verified: true });
    expect(mergeCompletion(verified, flagged)).toMatchObject({ needsReview: true, verifiedAt: null });
  });

  it('records kept in older job metadata are still read, per carer and visit-wide', () => {
    const perCarer = { employeeApp: { attendanceTimesByEmployee: { 'carer-a': mergeCompletion(undefined, clean), 'carer-b': mergeCompletion(undefined, flagged) } } };
    expect(unverifiedTimeReasons(perCarer, 'carer-a')).toEqual([]);
    expect(unverifiedTimeReasons(perCarer, 'carer-b')).toHaveLength(1);
    expect(attendanceTimeTrustFor(perCarer, 'carer-b')?.evidence?.reportedEnd).toBe('2026-11-03T10:00:00.000Z');

    const visitWide = { employeeApp: { attendanceTimes: { needsReview: true, reviewReasons: ['old'], startSource: 'CARER_REPORTED', endSource: 'SERVER' } } };
    expect(unverifiedTimeReasons(visitWide, 'carer-a')).toEqual(['old']);
    const mixed = { employeeApp: { ...visitWide.employeeApp, attendanceTimesByEmployee: { 'carer-a': mergeCompletion(undefined, clean) } } };
    expect(unverifiedTimeReasons(mixed, 'carer-a')).toEqual([]);
    expect(unverifiedTimeReasons(mixed, 'carer-b')).toEqual(['old']);
  });
});
