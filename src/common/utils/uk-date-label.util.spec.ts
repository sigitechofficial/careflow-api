import {
  formatUkDateLabel,
  formatUkDateLabelFromYmd,
  formatUkDateRangeLabel,
  formatUkDateTimeLabel,
  formatUkMonthLabel,
  formatUkMonthLabelFromKey,
  formatUkMonthShort,
  formatUkWeekdayDate,
  formatUkWeekdayShort,
} from './uk-date-label.util';

describe('uk-date-label', () => {
  const wed = new Date(Date.UTC(2026, 8, 2));

  it('formats date without a leading zero', () => {
    expect(formatUkDateLabel(wed)).toBe('2 Sep 2026');
  });

  it('formats weekday + date', () => {
    expect(formatUkWeekdayDate(wed)).toBe('Wed 2 Sep 2026');
    expect(formatUkWeekdayDate(wed, { year: false })).toBe('Wed 2 Sep');
    expect(formatUkWeekdayShort(wed)).toBe('Wed');
  });

  it('formats month labels', () => {
    expect(formatUkMonthLabel(wed)).toBe('Sep 2026');
    expect(formatUkMonthShort(wed)).toBe('Sep');
    expect(formatUkMonthLabelFromKey('2026-09')).toBe('Sep 2026');
  });

  it('formats ymd, range, and date+time', () => {
    expect(formatUkDateLabelFromYmd('2026-09-02')).toBe('2 Sep 2026');
    expect(formatUkDateRangeLabel('2026-09-02', '2026-09-15')).toBe(
      '2 Sep 2026 – 15 Sep 2026',
    );
    expect(formatUkDateTimeLabel(wed, '14:30')).toBe('2 Sep 2026, 14:30');
  });
});
