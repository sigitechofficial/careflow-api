import {
  addMinutes,
  branchForCouncil,
  careWeMayNotProvide,
  carerGenderPreference,
  matchFunder,
  shiftTime,
  dayIndexes,
  daysUntil,
  decideReferral,
  rateSummary,
  type ReferralCheck,
} from './referral-checks.util';
import { followUpDate } from './referral-automation.service';

const pass = (key: string): ReferralCheck => ({ key, label: key, result: 'PASS', detail: 'ok' });

describe('referral decision rules', () => {
  it('says yes when every check passes', () => {
    expect(decideReferral([pass('area'), pass('carers:0'), pass('start')]).decision).toBe('YES');
  });
  it('says no outside every branch area', () => {
    const r = decideReferral([{ key: 'area', label: 'Area', result: 'FAIL', detail: 'SW1 is in Westminster' }, pass('carers:0')]);
    expect(r).toEqual({ decision: 'NO', reasons: ['SW1 is in Westminster'] });
  });
  it('says no when no carer is free for any visit', () => {
    const fail = (k: string): ReferralCheck => ({ key: k, label: k, result: 'FAIL', detail: 'none free' });
    expect(decideReferral([pass('area'), fail('carers:0'), fail('carers:1')]).decision).toBe('NO');
  });
  it('asks for information without a postcode or visit times', () => {
    expect(decideReferral([{ key: 'area', label: 'Area', result: 'UNKNOWN', detail: 'No postcode' }, pass('carers:0')]).decision).toBe('NEED_INFO');
    expect(decideReferral([pass('area')]).decision).toBe('NEED_INFO');
  });
  it('says possibly when only some visits can be covered or the start is short notice', () => {
    const r = decideReferral([pass('area'), pass('carers:0'), { key: 'carers:1', label: 'Lunch', result: 'FAIL', detail: 'No carer' }]);
    expect(r.decision).toBe('POSSIBLY');
    expect(r.reasons).toEqual(['Lunch: No carer']);
    expect(decideReferral([pass('area'), pass('carers:0'), { key: 'start', label: 'Start', result: 'WARN', detail: 'short' }]).decision).toBe('POSSIBLY');
  });
  it('does not downgrade for a known person or a new funder', () => {
    const warn = (k: string): ReferralCheck => ({ key: k, label: k, result: 'WARN', detail: 'x' });
    expect(decideReferral([pass('area'), pass('carers:0'), warn('duplicate'), warn('funding')]).decision).toBe('YES');
  });
});

describe('referral check helpers', () => {
  it('matches a council to the branch that covers it', () => {
    const cov = [{ locationId: 'a', localAuthorities: ['Hammersmith and Fulham'] }, { locationId: 'b', localAuthorities: ['Croydon'] }];
    expect(branchForCouncil('Hammersmith & Fulham', cov)?.locationId).toBe('a');
    expect(branchForCouncil('Westminster', cov)).toBeNull();
  });
  it('works out times, days and notice', () => {
    expect(addMinutes('8:00', 45)).toBe('08:45');
    expect(dayIndexes([])).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(dayIndexes(['MON', 'FRI'])).toEqual([1, 5]);
    expect(daysUntil('2026-11-14', new Date('2026-11-09T10:00:00Z'))).toBe(5);
  });
  it('flags care a home care branch may not provide', () => {
    expect(careWeMayNotProvide('Needs live-in care and PEG feeding')).toEqual(['Live-in care', 'Clinical or nursing tasks']);
    expect(careWeMayNotProvide('Help to wash and dress')).toEqual([]);
  });
  it('describes hourly rates', () => {
    expect(
      rateSummary([
        { rateType: 'HOURLY', dayType: 'WEEKDAY', amount: 24.5, label: null },
        { rateType: 'HOURLY', dayType: 'SUNDAY', amount: 27, label: null },
      ]),
    ).toBe('£24.50 an hour on weekdays, £27.00 an hour on Sundays');
  });
  it('follows up urgent referrals today and others the next working day', () => {
    expect(followUpDate('URGENT', new Date('2026-11-13T10:00:00Z')).slice(0, 10)).toBe('2026-11-13');
    expect(followUpDate('ROUTINE', new Date('2026-11-13T10:00:00Z')).slice(0, 10)).toBe('2026-11-16');
  });
});

describe('referral review fixes', () => {
  it('does not mistake an older person for a child', () => {
    expect(careWeMayNotProvide('Samuel is 82 years old and needs 2 visits a day')).toEqual([]);
    expect(careWeMayNotProvide('Her children visit at weekends')).toEqual([]);
    expect(careWeMayNotProvide('Care for a child aged 9 with autism')).toEqual(['Care for a child']);
    expect(careWeMayNotProvide('She is 14 years old')).toEqual(['Care for a child']);
  });
  it('reads a carer gender preference, and no preference as none', () => {
    expect(carerGenderPreference('Male or female is fine')).toBeNull();
    expect(carerGenderPreference('No preference')).toBeNull();
    expect(carerGenderPreference('Either')).toBeNull();
    expect(carerGenderPreference('Female carers only please')).toBe('female');
    expect(carerGenderPreference('Prefers a male carer')).toBe('male');
    expect(carerGenderPreference('')).toBeNull();
  });
  it('matches funders on the distinctive part of the name', () => {
    const funders = [{ name: 'Croydon Council' }, { name: 'Royal Borough of Kensington and Chelsea' }, { name: 'NHS South West London ICB' }];
    expect(matchFunder('London Borough of Croydon', funders)?.name).toBe('Croydon Council');
    expect(matchFunder('Kensington & Chelsea Adult Social Care', funders)?.name).toBe('Royal Borough of Kensington and Chelsea');
    expect(matchFunder('The London Borough of Merton', funders)).toBeNull();
    expect(matchFunder('The family', funders)).toBeNull();
  });
  it('shifts visit times for travel within the day', () => {
    expect(shiftTime('08:00', -15)).toBe('07:45');
    expect(shiftTime('00:10', -15)).toBe('00:00');
    expect(shiftTime('23:50', 15)).toBe('23:59');
  });
});

describe('visit days', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dayIndexes } = require('./referral-checks.util') as typeof import('./referral-checks.util');
  it('reads day names in any case and never returns an empty list', () => {
    expect(dayIndexes(['MON', 'wed', 'Friday'])).toEqual([1, 3, 5]);
    expect(dayIndexes([])).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(dayIndexes(['Weekdays'])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
