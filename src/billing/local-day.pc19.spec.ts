/**
 * PC-19: every pricing path classifies the day in the organisation's local time.
 *
 * Elapsed time and the order of events use UTC instants. Which day a moment belongs to (weekday,
 * Saturday, Sunday, a holiday) is a civil-date question and is answered in the organisation's
 * timezone. In British Summer Time, 00:00 to 00:59 local is still the previous day in UTC; the
 * fixed-fee, night-duty and travel / mileage paths used the UTC day there.
 */
import {
  calculateBillableAmount,
  calculateMileageAmount,
  calculatePayableAmount,
  calculateTravelTimeAmount,
  calculateWaitingTimeAmount,
} from './visit-reconciliation.util';

const TZ = 'Europe/London';
type Rule = Record<string, unknown>;
const hourly = (dayType: string, amount: number): Rule => ({ dayType, rateType: 'HOURLY', amount });
const fixed = (dayType: string, minutes: number, amount: number): Rule => ({
  dayType,
  rateType: 'FIXED',
  amount,
  minimumMinutes: minutes,
  multiplier: 1,
  priority: 0,
  sortOrder: 0,
});
const typed = (rateType: string, dayType: string, amount: number): Rule => ({
  dayType,
  rateType,
  amount,
  priority: 0,
  sortOrder: 0,
});
const chargeFixed = (dayType: string, minutes: number, amount: number): Rule => ({
  ...fixed(dayType, minutes, amount),
  chargeMethod: 'FIXED_VISIT',
  chargeableFlag: true,
});
const chargeNight = (chargeMethod: string, dayType: string, amount: number): Rule => ({
  dayType,
  rateType: chargeMethod,
  chargeMethod,
  amount,
  chargeableFlag: true,
  priority: 0,
  sortOrder: 0,
});

const pay = (rules: Rule[], startIso: string, minutes: number, nightDuty: string | null = null, isBankHoliday = false) => {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + minutes * 60_000);
  return calculatePayableAmount(rules as never, start, minutes, isBankHoliday, { start, end, timeZone: TZ }, nightDuty, minutes);
};
const charge = (rules: Rule[], startIso: string, minutes: number, nightDuty: string | null = null) => {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + minutes * 60_000);
  return calculateBillableAmount(rules as never, start, minutes, 'HOURLY_PRO_RATA', false, { start, end, timeZone: TZ }, nightDuty);
};

// Summer time (BST = UTC+1). Saturday 6 June 2026 00:15 local is Friday 23:15 UTC.
const SAT_0015_BST = '2026-06-05T23:15:00Z';
const SAT_0030_BST = '2026-06-05T23:30:00Z';
const FRI_2300_BST = '2026-06-05T22:00:00Z';
// Winter time (GMT). Saturday 7 November 2026 00:15 local is the same instant in UTC.
const SAT_0015_GMT = '2026-11-07T00:15:00Z';

describe('PC-19: the day is the local day', () => {
  describe('fixed visit fee', () => {
    const rules = [fixed('WEEKDAY', 30, 8), fixed('SATURDAY', 30, 10), hourly('ANY', 14)];

    it('a 30-minute visit at 00:15 on a Saturday in summer is paid the Saturday fee', () => {
      expect(pay(rules, SAT_0015_BST, 30)?.amount).toBe(10);
    });
    it('the same visit in winter, and a Friday-evening visit, are unchanged', () => {
      expect(pay(rules, SAT_0015_GMT, 30)?.amount).toBe(10);
      expect(pay(rules, '2026-06-05T19:00:00Z', 30)?.amount).toBe(8); // Friday 20:00 local
    });
    it('the client charge uses the same day', () => {
      const chargeRules = [chargeFixed('WEEKDAY', 30, 13), chargeFixed('SATURDAY', 30, 16)];
      expect(charge(chargeRules, SAT_0015_BST, 30)?.amount).toBe(16);
      expect(charge(chargeRules, '2026-06-05T19:00:00Z', 30)?.amount).toBe(13);
    });
    it('Monday 00:15 local after a Sunday is not paid the Sunday fee', () => {
      const sundayRules = [fixed('WEEKDAY', 30, 8), fixed('SUNDAY', 30, 12), hourly('ANY', 14)];
      expect(pay(sundayRules, '2026-06-07T23:15:00Z', 30)?.amount).toBe(8); // Mon 8 June 00:15 BST
      expect(pay(sundayRules, '2026-06-06T23:15:00Z', 30)?.amount).toBe(12); // Sun 7 June 00:15 BST
    });
  });

  describe('night duty: the rule of the day the shift starts on', () => {
    const sleepIn = [typed('SLEEP_IN', 'WEEKDAY', 60), typed('SLEEP_IN', 'SATURDAY', 70)];
    const waking = [typed('WAKING_NIGHT', 'WEEKDAY', 15), typed('WAKING_NIGHT', 'SATURDAY', 18)];

    it('a sleep-in starting 00:30 on a Saturday in summer uses the Saturday allowance', () => {
      expect(pay(sleepIn, SAT_0030_BST, 480, 'SLEEPING_NIGHT')?.amount).toBe(70);
    });
    it('a sleep-in starting Friday 23:00 and running into Saturday keeps the Friday allowance', () => {
      expect(pay(sleepIn, FRI_2300_BST, 480, 'SLEEPING_NIGHT')?.amount).toBe(60);
    });
    it('a waking night starting 00:30 on a Saturday in summer uses the Saturday rate', () => {
      const result = pay(waking, SAT_0030_BST, 480, 'WAKING_NIGHT');
      expect(result?.amount).toBe(144); // 8h × £18
    });
    it('the client charge for night duty uses the same day', () => {
      const rules = [chargeNight('SLEEP_IN', 'WEEKDAY', 90), chargeNight('SLEEP_IN', 'SATURDAY', 110)];
      expect(charge(rules, SAT_0030_BST, 480, 'SLEEPING_NIGHT')?.amount).toBe(110);
    });
  });

  describe('mileage, travel time and waiting time', () => {
    const at = new Date(SAT_0015_BST);
    it('take the rate of the local day', () => {
      const mileage = [typed('MILEAGE', 'WEEKDAY', 0.4), typed('MILEAGE', 'SATURDAY', 0.5)];
      expect(calculateMileageAmount(mileage as never, at, 10, false, TZ)?.unitRate).toBe(0.5);
      const travel = [typed('TRAVEL_TIME', 'WEEKDAY', 12), typed('TRAVEL_TIME', 'SATURDAY', 15)];
      expect(calculateTravelTimeAmount(travel as never, at, 60, false, TZ)?.amount).toBe(15);
      const waiting = [typed('WAITING_TIME', 'WEEKDAY', 10), typed('WAITING_TIME', 'SATURDAY', 11)];
      expect(calculateWaitingTimeAmount(waiting as never, at, 60, false, TZ)?.amount).toBe(11);
    });
    it('Monday 00:15 local in summer is a weekday, not the Sunday it still is in UTC', () => {
      const travel = [typed('TRAVEL_TIME', 'WEEKDAY', 12), typed('TRAVEL_TIME', 'SUNDAY', 20)];
      const monday = new Date('2026-08-30T23:15:00Z'); // Monday 31 August 2026, 00:15 BST
      expect(calculateTravelTimeAmount(travel as never, monday, 60, false, TZ)?.amount).toBe(12);
      const sunday = new Date('2026-08-29T23:15:00Z'); // Sunday 30 August 2026, 00:15 BST
      expect(calculateTravelTimeAmount(travel as never, sunday, 60, false, TZ)?.amount).toBe(20);
    });
    it('without a timezone the old UTC reading still applies (callers must pass one)', () => {
      const travel = [typed('TRAVEL_TIME', 'WEEKDAY', 12), typed('TRAVEL_TIME', 'SUNDAY', 20)];
      expect(calculateTravelTimeAmount(travel as never, new Date('2026-08-30T23:15:00Z'), 60)?.amount).toBe(20);
    });
  });

  describe('hourly pay across midnight (already local; kept as a guard)', () => {
    const rules = [hourly('WEEKDAY', 14), hourly('SATURDAY', 16), hourly('SUNDAY', 18)];
    it('Friday 23:00 to Saturday 02:00 in summer: one weekday hour, two Saturday hours', () => {
      expect(pay(rules, FRI_2300_BST, 180)?.amount).toBe(46);
    });
    it('Sunday 23:30 to Monday 00:30 in summer: half an hour of each', () => {
      expect(pay(rules, '2026-06-07T22:30:00Z', 60)?.amount).toBe(16); // 9 + 7
    });
    it('clocks forward (29 March 2026): 00:30 to 03:30 local is two hours worked', () => {
      const start = new Date('2026-03-29T00:30:00Z');
      const end = new Date('2026-03-29T02:30:00Z'); // 03:30 BST
      expect(calculatePayableAmount(rules as never, start, 120, false, { start, end, timeZone: TZ }, null, 120)?.amount).toBe(36);
    });
    it('clocks back (25 October 2026): 00:30 to 02:30 local is three hours worked', () => {
      const start = new Date('2026-10-24T23:30:00Z');
      const end = new Date('2026-10-25T02:30:00Z');
      expect(calculatePayableAmount(rules as never, start, 180, false, { start, end, timeZone: TZ }, null, 180)?.amount).toBe(54);
    });
  });
});
