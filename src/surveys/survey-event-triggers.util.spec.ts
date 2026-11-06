import {
  checkEventTriggerInput,
  detectionRange,
  dueDecision,
  eventPeriodFor,
  libraryEventTrigger,
  occurrenceDays,
  readEventTrigger,
  reasonWords,
} from './survey-event-triggers.util';
import { LIBRARY_EVENT_TRIGGERS, validateLibraryEventTriggers } from '../../prisma/seed-lib/survey-event-triggers';
import { loadSurveyLibrary } from '../../prisma/seed-lib/survey-library';

const base = { event: 'HOSPITAL_DISCHARGE', delayDays: 10, windowDays: 4, exclusions: [], options: { minNights: 1 } };

describe('event triggers: the setting', () => {
  it('accepts an event for the survey’s audience only', () => {
    expect(checkEventTriggerInput(base, { audience: 'SERVICE_USER', today: '2026-11-06' })).toMatchObject({ ok: true });
    expect(checkEventTriggerInput(base, { audience: 'EMPLOYEE', today: '2026-11-06' })).toMatchObject({ ok: false, message: expect.stringMatching(/staff event/) });
    expect(checkEventTriggerInput({ ...base, event: 'DEATH' }, { audience: 'SERVICE_USER', today: '2026-11-06' })).toMatchObject({ ok: false });
    expect(checkEventTriggerInput({ ...base, event: 'NOTICE_GIVEN', options: {} }, { audience: 'EMPLOYEE', today: '2026-11-06' })).toMatchObject({ ok: true });
  });

  it('only a review can be sent before the event; days and checks are bounded', () => {
    expect(checkEventTriggerInput({ ...base, delayDays: -3 }, { audience: 'SERVICE_USER', today: '2026-11-06' })).toMatchObject({ ok: false });
    expect(
      checkEventTriggerInput({ event: 'CARE_REVIEW_DUE', delayDays: -7, windowDays: 3, exclusions: ['IN_HOSPITAL'], options: { firstReviewOnly: true } }, { audience: 'SERVICE_USER', today: '2026-11-06' }),
    ).toMatchObject({ ok: true, trigger: { delayDays: -7, options: { firstReviewOnly: true } } });
    expect(checkEventTriggerInput({ ...base, windowDays: 0 }, { audience: 'SERVICE_USER', today: '2026-11-06' })).toMatchObject({ ok: false });
    expect(checkEventTriggerInput({ ...base, exclusions: ['IN_HOSPITAL'] }, { audience: 'EMPLOYEE', today: '2026-11-06' })).toMatchObject({ ok: false });
    expect(checkEventTriggerInput({ ...base, event: 'COMPLAINT_CLOSED', options: {} }, { audience: 'SERVICE_USER', today: '2026-11-06' })).toMatchObject({ ok: false });
  });

  it('family surveys and deaths are always checked by staff first (an offer, never automatic)', () => {
    const r = checkEventTriggerInput({ event: 'DEATH', delayDays: 42, windowDays: 14, exclusions: [], checkFirst: false }, { audience: 'FAMILY', today: '2026-11-06' });
    expect(r).toMatchObject({ ok: true, trigger: { checkFirst: true } });
  });

  it('counts events from today, or a chosen look-back; a change never moves the start (no re-sends)', () => {
    const on = checkEventTriggerInput(base, { audience: 'SERVICE_USER', today: '2026-11-06' });
    expect(on).toMatchObject({ trigger: { since: '2026-11-06' } });
    const back = checkEventTriggerInput({ ...base, lookBackDays: 14 }, { audience: 'SERVICE_USER', today: '2026-11-06' });
    expect(back).toMatchObject({ trigger: { since: '2026-10-23' } });
    const changed = checkEventTriggerInput({ ...base, windowDays: 6 }, { audience: 'SERVICE_USER', today: '2026-11-20', previous: (back as any).trigger });
    expect(changed).toMatchObject({ trigger: { since: '2026-10-23', windowDays: 6 } });
    expect(checkEventTriggerInput({ ...base, lookBackDays: 91 }, { audience: 'SERVICE_USER', today: '2026-11-06' })).toMatchObject({ ok: false });
  });

  it('reads back only a whole setting', () => {
    expect(readEventTrigger(null)).toBeNull();
    expect(readEventTrigger({ event: 'NOPE', delayDays: 1, windowDays: 1, since: '2026-11-01' })).toBeNull();
    expect(readEventTrigger({ ...base, since: '2026-11-01' })).toMatchObject({ event: 'HOSPITAL_DISCHARGE', ownerKey: 'CARE_COORDINATOR', checkFirst: false });
  });
});

describe('event triggers: days', () => {
  const t = { ...readEventTrigger({ ...base, since: '2026-10-01' })! };

  it('works out the due day and the last day it may go', () => {
    expect(occurrenceDays('2026-11-01', t)).toEqual({ dueOn: '2026-11-11', lastDay: '2026-11-15' });
  });

  it('looks for events whose send is still open, never before the start day', () => {
    expect(detectionRange(t, '2026-11-20')).toEqual({ from: '2026-11-06', to: '2026-11-20' });
    expect(detectionRange({ ...t, since: '2026-11-18' }, '2026-11-20')).toEqual({ from: '2026-11-18', to: '2026-11-20' });
    // Sent before a review: reviews up to 7 days ahead are found today.
    expect(detectionRange({ ...t, delayDays: -7, windowDays: 3 }, '2026-11-20')).toEqual({ from: '2026-11-24', to: '2026-11-27' });
  });

  it('waits, lets go, asks staff, or sends', () => {
    expect(dueDecision({ dueOn: '2026-11-21', lastDay: '2026-11-25' }, '2026-11-20', { checkFirst: false })).toBe('WAIT');
    expect(dueDecision({ dueOn: '2026-11-10', lastDay: '2026-11-14' }, '2026-11-20', { checkFirst: false })).toBe('EXPIRE');
    expect(dueDecision({ dueOn: '2026-11-20', lastDay: '2026-11-25' }, '2026-11-20', { checkFirst: true })).toBe('CHECK');
    expect(dueDecision({ dueOn: '2026-11-20', lastDay: '2026-11-25' }, '2026-11-20', { checkFirst: false })).toBe('SEND');
  });

  it('a month copy is open until 4 weeks after its month', () => {
    expect(eventPeriodFor('2026-11-06')).toEqual({ periodKey: '2026-11', monthStart: '2026-11-01', closesOn: '2026-12-29' });
    expect(eventPeriodFor('2026-12-31')).toEqual({ periodKey: '2026-12', monthStart: '2026-12-01', closesOn: '2027-01-29' });
  });

  it('reasons read as words; a person’s own reason is kept as written', () => {
    expect(reasonWords('DIED')).toBe('The person has died');
    expect(reasonWords('Family asked us not to write')).toBe('Family asked us not to write');
  });
});

describe('event triggers: the ready-made library', () => {
  it('every structured trigger points at a released survey with trigger words, for the right audience', () => {
    const surveys = loadSurveyLibrary().flatMap((f) => f.surveys);
    expect(validateLibraryEventTriggers(surveys)).toEqual([]);
    expect(Object.keys(LIBRARY_EVENT_TRIGGERS).length).toBeGreaterThanOrEqual(10);
    expect(libraryEventTrigger('SUR-PWS-007')).toMatchObject({ event: 'HOSPITAL_DISCHARGE', delayDays: 10 });
    expect(libraryEventTrigger('SUR-PWS-003')).toBeNull();
  });

  it('the checker catches a trigger for the wrong audience or a family survey sent automatically', () => {
    const errs = validateLibraryEventTriggers([
      { reference: 'SUR-PWS-001', audience: 'EMPLOYEE', timing: { trigger: 'x' } },
      { reference: 'SUR-FAM-002', audience: 'PUBLIC', timing: { trigger: null } },
    ]);
    expect(errs.some((e) => /SUR-PWS-001: FIRST_VISIT is not for EMPLOYEE/.test(e))).toBe(true);
    expect(errs.some((e) => /SUR-FAM-002: event trigger but no timing.trigger words/.test(e))).toBe(true);
  });
});


describe('review fixes: library timing and the bereaved-family delay', () => {
  it('a family is never offered the survey sooner than 6 weeks after a death', () => {
    const base = { event: 'DEATH', windowDays: 14, exclusions: [], options: {} };
    expect(checkEventTriggerInput({ ...base, delayDays: 7 }, { audience: 'FAMILY', today: '2026-11-06' })).toMatchObject({ ok: false });
    expect(checkEventTriggerInput({ ...base, delayDays: 42 }, { audience: 'FAMILY', today: '2026-11-06' })).toMatchObject({ ok: true });
  });

  it('SUR-PWS-002 goes at least 5 working days (7 calendar days) before the review', () => {
    const t = LIBRARY_EVENT_TRIGGERS['SUR-PWS-002'];
    expect(t.delayDays + t.windowDays).toBeLessThanOrEqual(-7);
  });
});
