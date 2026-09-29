import {
  EmployeePayoutAutoJob,
  isMonthlyPayoutHour,
} from './employee-payout-auto.job';
import type { EmployeePayoutsService } from './employee-payouts.service';
import type { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';

describe('isMonthlyPayoutHour', () => {
  it('fires at 06:00 London time on the 4th in winter (GMT = UTC)', () => {
    expect(
      isMonthlyPayoutHour(new Date('2026-01-04T06:00:00Z'), 'Europe/London'),
    ).toBe(true);
    expect(
      isMonthlyPayoutHour(new Date('2026-01-04T05:59:00Z'), 'Europe/London'),
    ).toBe(false);
  });

  it('fires at 06:00 London time on the 4th in summer (BST = UTC+1)', () => {
    expect(
      isMonthlyPayoutHour(new Date('2026-07-04T05:00:00Z'), 'Europe/London'),
    ).toBe(true);
    expect(
      isMonthlyPayoutHour(new Date('2026-07-04T06:00:00Z'), 'Europe/London'),
    ).toBe(false);
  });

  it('does not fire on other days', () => {
    expect(
      isMonthlyPayoutHour(new Date('2026-07-03T05:00:00Z'), 'Europe/London'),
    ).toBe(false);
    expect(
      isMonthlyPayoutHour(new Date('2026-07-05T05:00:00Z'), 'Europe/London'),
    ).toBe(false);
  });

  it('follows whatever timezone the organisation is set to', () => {
    // 06:00 in Karachi (UTC+5) is 01:00 UTC
    expect(
      isMonthlyPayoutHour(new Date('2026-07-04T01:00:00Z'), 'Asia/Karachi'),
    ).toBe(true);
    expect(
      isMonthlyPayoutHour(new Date('2026-07-04T01:00:00Z'), 'Europe/London'),
    ).toBe(false);
  });
});

describe('EmployeePayoutAutoJob', () => {
  const make = (timeZone: string) => {
    const execute = jest
      .fn()
      .mockResolvedValue({ outcome: 'skipped', periodKey: '2026-06' });
    const job = new EmployeePayoutAutoJob(
      {
        executeAutomaticMonthlyPayout: execute,
      } as unknown as EmployeePayoutsService,
      {
        getOperationalTimezone: () => Promise.resolve(timeZone),
      } as unknown as OrganisationGeneralSettingsService,
    );
    return { job, execute };
  };

  afterEach(() => jest.useRealTimers());

  it('pays only at the payout hour in the organisation timezone', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-04T05:00:00Z') }); // 06:00 BST
    const london = make('Europe/London');
    await london.job.handleMonthlyAutoPayout();
    expect(london.execute).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-07-04T01:00:00Z')); // 02:00 BST (06:00 Karachi)
    const stillLondon = make('Europe/London');
    await stillLondon.job.handleMonthlyAutoPayout();
    expect(stillLondon.execute).not.toHaveBeenCalled();
  });
});
