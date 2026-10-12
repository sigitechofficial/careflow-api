import { calculateBandedPay, type TimeBandRule } from './pay-time-band.util';
import { classifyPayRule, isNightTimeBand, PAYCARD_SUPPORT, WAGE_TYPE_CODES } from './wage-types.util';
import { parseGovUkBankHolidays } from './bank-holidays.service';

describe('classifyPayRule (derived wage type, no data change)', () => {
  it('maps existing rule shapes to wage types', () => {
    expect(classifyPayRule({ rateType: 'HOURLY', dayType: 'WEEKDAY', startTime: '07:00', endTime: '19:00' })).toBe('BASIC_HOURLY');
    expect(classifyPayRule({ rateType: 'HOURLY', dayType: 'SATURDAY', startTime: '07:00', endTime: '19:00' })).toBe('WEEKEND');
    expect(classifyPayRule({ rateType: 'HOURLY', dayType: 'SUNDAY', startTime: '22:00', endTime: '07:00' })).toBe('WEEKEND');
    expect(classifyPayRule({ rateType: 'HOURLY', dayType: 'BANK_HOLIDAY' })).toBe('BANK_HOLIDAY');
    expect(classifyPayRule({ rateType: 'HOURLY', dayType: 'CHRISTMAS' })).toBe('BANK_HOLIDAY');
    expect(classifyPayRule({ rateType: 'HOURLY', dayType: 'WEEKDAY', startTime: '22:00', endTime: '06:00' })).toBe('NIGHT_SHIFT');
    expect(classifyPayRule({ rateType: 'FIXED', dayType: 'ANY', startTime: '00:00', endTime: '23:59' })).toBe('PER_VISIT');
    expect(classifyPayRule({ rateType: 'MILEAGE', dayType: 'ANY' })).toBe('MILEAGE');
    expect(classifyPayRule({ rateType: 'WAITING_TIME', dayType: 'ANY' })).toBe('TRAVEL_TIME');
    expect(classifyPayRule({ rateType: 'SLEEP_IN', dayType: 'ANY' })).toBe('SLEEP_IN');
    expect(classifyPayRule({ rateType: 'WAKING_NIGHT', dayType: 'ANY' })).toBe('WAKING_NIGHT');
  });

  it('only treats real night bands as night', () => {
    expect(isNightTimeBand('22:00', '06:00')).toBe(true);
    expect(isNightTimeBand('20:00', '23:00')).toBe(true);
    expect(isNightTimeBand('00:00', '06:00')).toBe(true);
    expect(isNightTimeBand('00:00', '23:59')).toBe(false);
    expect(isNightTimeBand('19:00', '22:00')).toBe(false);
    expect(isNightTimeBand(null, null)).toBe(false);
  });

  it('describes support for every wage type', () => {
    for (const code of WAGE_TYPE_CODES) expect(PAYCARD_SUPPORT[code]).toBeDefined();
  });
});

describe('conflict resolution — no accidental stacking', () => {
  // Spec example: base £14, weekend £16, bank holiday £21; one hour on a bank holiday Sunday 22:00–23:00.
  const sunday = new Date('2026-12-27T22:00:00.000Z');
  const end = new Date('2026-12-27T23:00:00.000Z');
  const isBankHolidayFn = () => true;
  const rules: TimeBandRule[] = [
    { label: 'Base', dayType: 'ANY', rateType: 'HOURLY', amount: 14, sortOrder: 0 },
    { label: 'Weekend', dayType: 'SUNDAY', rateType: 'HOURLY', amount: 16, sortOrder: 1 },
    { label: 'Bank holiday', dayType: 'BANK_HOLIDAY', rateType: 'HOURLY', amount: 21, sortOrder: 2 },
  ];

  it('default PRIORITY pays the single most specific rate (£21, not £14 + £16 + £21)', () => {
    const r = calculateBandedPay({ start: sunday, end, rules, isBankHolidayFn });
    expect(r?.totalAmount).toBe(21);
  });

  it('HIGHEST pays the highest applicable rate', () => {
    const r = calculateBandedPay({ start: sunday, end, rules, isBankHolidayFn, stackingPolicy: 'HIGHEST' });
    expect(r?.totalAmount).toBe(21);
  });

  it('HIGHEST compares premiums on the card base rate (+£8 on £14 beats an absolute £21)', () => {
    const withPremium: TimeBandRule[] = [
      { label: 'Base', dayType: 'ANY', rateType: 'HOURLY', amount: 14, sortOrder: 0 },
      { label: 'Bank holiday', dayType: 'BANK_HOLIDAY', rateType: 'HOURLY', amount: 21, sortOrder: 1 },
      { label: 'Sunday premium', dayType: 'SUNDAY', rateType: 'HOURLY', amount: 8, enhancementMethod: 'ADDITIONAL_PER_HOUR', sortOrder: 2 },
    ];
    const r = calculateBandedPay({ start: sunday, end, rules: withPremium, isBankHolidayFn, stackingPolicy: 'HIGHEST' });
    expect(r?.totalAmount).toBe(22);
  });

  it('a multiplier pays base × multiplier', () => {
    const multiplier: TimeBandRule[] = [
      { label: 'Base', dayType: 'ANY', rateType: 'HOURLY', amount: 14, sortOrder: 0 },
      { label: 'Bank holiday ×1.5', dayType: 'BANK_HOLIDAY', rateType: 'HOURLY', amount: 1.5, multiplier: 1.5, enhancementMethod: 'MULTIPLIER', sortOrder: 1 },
    ];
    const r = calculateBandedPay({ start: sunday, end, rules: multiplier, isBankHolidayFn });
    expect(r?.totalAmount).toBe(21);
  });
});

describe('parseGovUkBankHolidays', () => {
  const json = {
    'england-and-wales': { events: [
      { title: 'Christmas Day', date: '2025-12-25' },
      { title: 'New Year’s Day', date: '2027-01-01' },
    ] },
    scotland: { events: [{ title: 'St Andrew’s Day', date: '2027-11-30' }] },
    'northern-ireland': { events: [{ title: 'Battle of the Boyne', date: '2027-07-12' }] },
  };

  it('maps divisions to regions and skips past dates', () => {
    expect(parseGovUkBankHolidays(json, '2026-01-01')).toEqual([
      { region: 'UK', holidayDate: '2027-01-01', name: 'New Year’s Day', isSubstitute: false, substituteForDate: null },
      { region: 'SCOTLAND', holidayDate: '2027-11-30', name: 'St Andrew’s Day', isSubstitute: false, substituteForDate: null },
      { region: 'NORTHERN_IRELAND', holidayDate: '2027-07-12', name: 'Battle of the Boyne', isSubstitute: false, substituteForDate: null },
    ]);
  });

  it('ignores malformed input', () => {
    expect(parseGovUkBankHolidays(null, '2026-01-01')).toEqual([]);
    expect(parseGovUkBankHolidays({ scotland: { events: [{ date: 'x' }] } }, '2026-01-01')).toEqual([]);
  });
});
