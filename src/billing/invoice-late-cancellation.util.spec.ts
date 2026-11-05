import {
  lateCancellationAmount,
  lateCancellationDescription,
  lateCancellationMinutes,
  lateCancellationPercent,
} from './invoice-late-cancellation.util';

const TZ = 'Europe/London';
const chargeRule = (dayType: string, amount: number) =>
  ({
    dayType,
    rateType: 'HOURLY',
    chargeMethod: 'HOURLY_PRO_RATA',
    amount,
    startTime: null,
    endTime: null,
    chargeableFlag: true,
  }) as never;

describe('late cancellation billing', () => {
  const rules = [
    chargeRule('WEEKDAY', 28),
    chargeRule('SATURDAY', 30),
    chargeRule('SUNDAY', 32),
    chargeRule('BANK_HOLIDAY', 40),
  ];
  const price = (
    startIso: string,
    minutes: number,
    percent = 100,
    carers = 1,
    bankHoliday = false,
  ) =>
    lateCancellationAmount({
      rules,
      defaultChargeMethod: 'HOURLY_PRO_RATA',
      start: new Date(startIso),
      minutes,
      carers,
      percent,
      isBankHolidayFn: () => bankHoliday,
      timeZone: TZ,
    });

  it('prices the planned visit like a delivered one (weekday 45m at £28/h)', () => {
    expect(price('2026-11-05T08:00:00Z', 45)).toBe(21);
  });

  it('applies the charge percent and the day type', () => {
    expect(price('2026-11-05T08:00:00Z', 60, 50)).toBe(14);
    expect(price('2026-11-07T08:00:00Z', 60)).toBe(30);
    expect(price('2026-11-05T08:00:00Z', 60, 100, 1, true)).toBe(40);
  });

  it('bills each carer of a double-up', () => {
    expect(price('2026-11-05T08:00:00Z', 30, 100, 2)).toBe(28);
  });

  it('returns null when there is nothing to price', () => {
    expect(price('2026-11-05T08:00:00Z', 0)).toBeNull();
  });

  it('bills the rule percent, else the full visit', () => {
    expect(lateCancellationPercent(null, 100)).toBe(100);
    expect(lateCancellationPercent(50, 100)).toBe(50);
    expect(lateCancellationPercent(null, 0)).toBe(100);
    expect(lateCancellationPercent(null, null)).toBe(100);
  });

  it('uses planned end − start, else the estimated duration', () => {
    const start = new Date('2026-11-05T08:00:00Z');
    expect(
      lateCancellationMinutes({
        scheduledStartDateTime: start,
        scheduledEndDateTime: new Date('2026-11-05T08:45:00Z'),
        estimatedDurationMinutes: 30,
      }),
    ).toBe(45);
    expect(
      lateCancellationMinutes({
        scheduledStartDateTime: start,
        scheduledEndDateTime: null,
        estimatedDurationMinutes: 30,
      }),
    ).toBe(30);
  });

  it('describes the line with notice and percent', () => {
    expect(
      lateCancellationDescription({
        jobName: 'Morning — Edie',
        when: '2026-11-05 08:00',
        noticeHours: 22.09,
        percent: 100,
        late: false,
      }),
    ).toBe(
      'Late cancellation — Morning — Edie (2026-11-05 08:00) · 22.1h notice · 100%',
    );
  });
});
