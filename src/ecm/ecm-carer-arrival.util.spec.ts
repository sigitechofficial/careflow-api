import { computeCarerArrivals } from './ecm-carer-arrival.util';

const at = (hm: string) => new Date(`2026-10-08T${hm}:00.000Z`);

const base = {
  visitPlannedStart: at('07:00'),
  lateArrivalToleranceMinutes: 15,
  visitCompleted: false,
  visitMissed: false,
  now: at('10:00'),
};

const alloc = (employeeId: string, plannedHm?: string) => ({
  employeeId,
  scheduledStartDateTime: plannedHm ? at(plannedHm) : null,
  actualStartDateTime: null,
  actualEndDateTime: null,
});

const checkIn = (employeeId: string, hm: string) => ({
  employeeId,
  eventType: 'CHECK_IN',
  occurredAt: at(hm),
});

describe('computeCarerArrivals', () => {
  it('returns nothing for single-carer visits', () => {
    const res = computeCarerArrivals({
      ...base,
      allocations: [alloc('lead')],
      events: [checkIn('lead', '08:00')],
    });
    expect(res.size).toBe(0);
  });

  it('compares support to its own planned start, not the visit start', () => {
    const res = computeCarerArrivals({
      ...base,
      allocations: [alloc('lead'), alloc('support', '09:00')],
      events: [checkIn('lead', '07:00'), checkIn('support', '09:05')],
    });
    expect(res.get('lead')?.lateArrivalMinutes).toBeNull();
    expect(res.get('support')?.plannedStartDateTime).toEqual(at('09:00'));
    expect(res.get('support')?.lateArrivalMinutes).toBeNull();
  });

  it('flags a carer late beyond tolerance with minutes after own planned start', () => {
    const res = computeCarerArrivals({
      ...base,
      allocations: [alloc('lead'), alloc('support', '09:00')],
      events: [checkIn('lead', '07:00'), checkIn('support', '09:25')],
    });
    expect(res.get('support')?.lateArrivalMinutes).toBe(25);
  });

  it('flags a late lead even when the support arrived on time', () => {
    const res = computeCarerArrivals({
      ...base,
      allocations: [alloc('lead'), alloc('support')],
      events: [checkIn('support', '07:00'), checkIn('lead', '07:40')],
    });
    expect(res.get('lead')?.lateArrivalMinutes).toBe(40);
    expect(res.get('support')?.lateArrivalMinutes).toBeNull();
  });

  it('marks a carer not clocked in once past own planned start + tolerance', () => {
    const res = computeCarerArrivals({
      ...base,
      now: at('09:30'),
      allocations: [alloc('lead'), alloc('support', '09:00')],
      events: [checkIn('lead', '07:00')],
    });
    expect(res.get('support')?.notClockedIn).toBe(true);
  });

  it('does not mark not clocked in before own planned start + tolerance', () => {
    const res = computeCarerArrivals({
      ...base,
      now: at('09:10'),
      allocations: [alloc('lead'), alloc('support', '09:00')],
      events: [checkIn('lead', '07:00')],
    });
    expect(res.get('support')?.notClockedIn).toBe(false);
  });

  it('does not mark not clocked in when nobody has a per-carer clock-in', () => {
    const res = computeCarerArrivals({
      ...base,
      allocations: [alloc('lead'), alloc('support')],
      events: [],
    });
    expect(res.get('lead')?.notClockedIn).toBe(false);
    expect(res.get('support')?.notClockedIn).toBe(false);
  });

  it('skips lateness on confirmed missed visits', () => {
    const res = computeCarerArrivals({
      ...base,
      visitMissed: true,
      allocations: [alloc('lead'), alloc('support')],
      events: [checkIn('lead', '09:00')],
    });
    expect(res.get('lead')?.lateArrivalMinutes).toBeNull();
    expect(res.get('support')?.notClockedIn).toBe(false);
  });

  it('uses allocation actual end only for completed visits', () => {
    const allocations = [
      alloc('lead'),
      { ...alloc('support'), actualStartDateTime: at('07:00'), actualEndDateTime: at('08:00') },
    ];
    const open = computeCarerArrivals({ ...base, allocations, events: [] });
    expect(open.get('support')?.checkOutAt).toBeNull();
    const done = computeCarerArrivals({ ...base, visitCompleted: true, allocations, events: [] });
    expect(done.get('support')?.checkOutAt).toEqual(at('08:00'));
  });
});
