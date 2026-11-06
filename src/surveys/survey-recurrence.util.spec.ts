import { SurveyRecurrence } from '@prisma/client';
import {
  addOperationalDays,
  formatSurveyDateTime,
  nextSurveyDistributeAt,
  surveyPeriodKey,
  surveyPeriodLabel,
  surveyRunAt,
} from './survey-recurrence.util';

const LONDON = 'Europe/London';
const londonClock = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);

describe('survey recurrence (operational timezone)', () => {
  it('clamps monthly runs to the month end without drifting the day', () => {
    // 31 Jan 2027 09:00 GMT
    const anchor = new Date('2027-01-31T09:00:00.000Z');
    const runs = [1, 2, 3, 4].map((k) => londonClock(surveyRunAt(anchor, SurveyRecurrence.MONTHLY, k, LONDON)));
    expect(runs).toEqual([
      '28/02/2027, 09:00',
      '31/03/2027, 09:00',
      '30/04/2027, 09:00',
      '31/05/2027, 09:00',
    ]);
  });

  it('keeps 29 Feb in leap years and clamps yearly runs otherwise', () => {
    const anchor = new Date('2028-02-29T10:00:00.000Z');
    expect(londonClock(surveyRunAt(anchor, SurveyRecurrence.YEARLY, 1, LONDON))).toBe('28/02/2029, 10:00');
    expect(londonClock(surveyRunAt(anchor, SurveyRecurrence.YEARLY, 4, LONDON))).toBe('29/02/2032, 10:00');
  });

  it('keeps the local send time across the clocks changing (DST-safe)', () => {
    // 09:00 GMT on 20 Mar 2027 → next week is BST, still 09:00 London (08:00Z).
    const anchor = new Date('2027-03-20T09:00:00.000Z');
    const next = surveyRunAt(anchor, SurveyRecurrence.WEEKLY, 1, LONDON);
    expect(next.toISOString()).toBe('2027-03-27T09:00:00.000Z');
    const after = surveyRunAt(anchor, SurveyRecurrence.WEEKLY, 2, LONDON);
    expect(after.toISOString()).toBe('2027-04-03T08:00:00.000Z');
    expect(londonClock(after)).toBe('03/04/2027, 09:00');
  });

  it('counts the next run from the anchor and skips past runs already missed', () => {
    const anchor = new Date('2027-01-31T09:00:00.000Z');
    const afterFeb = surveyRunAt(anchor, SurveyRecurrence.MONTHLY, 1, LONDON);
    const next = nextSurveyDistributeAt(anchor, SurveyRecurrence.MONTHLY, afterFeb, afterFeb, LONDON);
    expect(londonClock(next)).toBe('31/03/2027, 09:00');

    // Server was down for months: next run is the first one after "now".
    const now = new Date('2027-06-10T12:00:00.000Z');
    const late = nextSurveyDistributeAt(anchor, SurveyRecurrence.MONTHLY, anchor, now, LONDON);
    expect(londonClock(late)).toBe('30/06/2027, 09:00');
  });

  it('labels periods in UK format and in local time', () => {
    // 00:30 BST on 1 Oct = 23:30Z on 30 Sep — the label must say October, not September.
    const justAfterMidnight = new Date('2026-09-30T23:30:00.000Z');
    expect(surveyPeriodLabel(justAfterMidnight, SurveyRecurrence.MONTHLY, LONDON)).toBe('Oct 2026');
    expect(surveyPeriodKey(justAfterMidnight, SurveyRecurrence.MONTHLY, LONDON)).toBe('2026-10');

    const weekly = new Date('2026-11-05T09:00:00.000Z');
    expect(surveyPeriodLabel(weekly, SurveyRecurrence.WEEKLY, LONDON)).toBe('5 Nov 2026');
    expect(surveyPeriodKey(weekly, SurveyRecurrence.WEEKLY, LONDON)).toBe('2026-11-05');
    expect(surveyPeriodLabel(weekly, SurveyRecurrence.QUARTERLY, LONDON)).toBe('Q4 2026');
    expect(surveyPeriodKey(weekly, SurveyRecurrence.QUARTERLY, LONDON)).toBe('2026-Q4');
    expect(surveyPeriodLabel(weekly, SurveyRecurrence.YEARLY, LONDON)).toBe('2026');
    expect(formatSurveyDateTime(weekly, LONDON)).toBe('5 Nov 2026, 09:00');
  });

  it('adds open-for-N-days at the same local time across a clock change', () => {
    const opens = new Date('2026-10-20T09:00:00.000Z'); // 10:00 BST
    const closes = addOperationalDays(opens, 14, LONDON); // 3 Nov, GMT
    expect(londonClock(closes)).toBe('03/11/2026, 10:00');
    expect(closes.toISOString()).toBe('2026-11-03T10:00:00.000Z');
  });
});
