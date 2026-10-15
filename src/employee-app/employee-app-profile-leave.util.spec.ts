import { countLeaveDays, maskTail } from './employee-app-profile-leave.util';

const base = {
  todayYmd: '2026-10-07',
  yearStartYmd: '2026-01-01',
  yearEndYmd: '2026-12-31',
  timeZone: 'Europe/London',
};

describe('countLeaveDays', () => {
  it('splits taken and upcoming days around today', () => {
    const result = countLeaveDays({
      ...base,
      includeWeekends: true,
      spans: [
        { from: new Date('2026-10-05T00:00:00Z'), to: new Date('2026-10-08T00:00:00Z') },
      ],
    });
    expect(result).toEqual({ taken: 2, upcoming: 2 });
  });

  it('skips weekends when the org excludes them', () => {
    // Fri 9 Oct → Mon 12 Oct 2026: Fri + Mon only
    const result = countLeaveDays({
      ...base,
      includeWeekends: false,
      spans: [
        { from: new Date('2026-10-09T00:00:00Z'), to: new Date('2026-10-12T00:00:00Z') },
      ],
    });
    expect(result).toEqual({ taken: 0, upcoming: 2 });
  });

  it('clips spans to the year and counts overlapping days once', () => {
    const result = countLeaveDays({
      ...base,
      includeWeekends: true,
      spans: [
        { from: new Date('2025-12-30T00:00:00Z'), to: new Date('2026-01-02T00:00:00Z') },
        { from: new Date('2026-01-02T00:00:00Z'), to: new Date('2026-01-03T00:00:00Z') },
      ],
    });
    expect(result).toEqual({ taken: 3, upcoming: 0 });
  });
});

describe('maskTail', () => {
  it('keeps the last characters only', () => {
    expect(maskTail('QQ 12 34 56 C')).toBe('••••••56C');
    expect(maskTail(null)).toBeNull();
  });
});
