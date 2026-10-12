import { isSyncedLate, resolveDeviceEventTime } from './employee-app-device-time.util';

const received = new Date('2026-10-12T16:00:00.000Z');

describe('resolveDeviceEventTime', () => {
  it('uses the phone time for an offline clock-in synced hours later', () => {
    expect(resolveDeviceEventTime('2026-10-12T08:00:00.000Z', received)).toEqual({
      at: new Date('2026-10-12T08:00:00.000Z'),
      source: 'device',
    });
  });

  it('uses the server time when the phone sent none or an invalid one', () => {
    expect(resolveDeviceEventTime(null, received)).toEqual({ at: received, source: 'server' });
    expect(resolveDeviceEventTime('not a date', received)).toEqual({
      at: received,
      source: 'server',
    });
  });

  it('does not trust a phone clock set in the future', () => {
    expect(resolveDeviceEventTime('2026-10-12T17:00:00.000Z', received)).toEqual({
      at: received,
      source: 'server',
    });
  });

  it('treats a few seconds ahead as drift and never stores a future time', () => {
    expect(resolveDeviceEventTime('2026-10-12T16:00:20.000Z', received)).toEqual({
      at: received,
      source: 'device',
    });
  });

  it('does not trust a phone time older than 24 hours', () => {
    expect(resolveDeviceEventTime('2026-10-11T15:00:00.000Z', received)).toEqual({
      at: received,
      source: 'server',
    });
  });
});

describe('isSyncedLate', () => {
  it('is false for a normal online clock-in', () => {
    expect(isSyncedLate(new Date('2026-10-12T15:59:58.000Z'), received)).toBe(false);
    expect(isSyncedLate(new Date('2026-10-12T15:57:00.000Z'), received)).toBe(false);
  });

  it('is true when the server received it more than 5 minutes later', () => {
    expect(isSyncedLate(new Date('2026-10-12T08:00:00.000Z'), received)).toBe(true);
  });

  it('is false when either time is missing', () => {
    expect(isSyncedLate(null, received)).toBe(false);
  });
});
