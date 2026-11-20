import {
  isWorryingArrival,
  areaAllowedEntry,
  areaLockedEntry,
  arrivalEntry,
  mockLocationEntry,
  outsideAreaEntry,
} from './visit-safety-timeline.util';

describe('visit safety Log rows', () => {
  it('says how the person was found, with seen / key safe / review lines', () => {
    expect(
      arrivalEntry('e1', {
        welfareOutcomeLabel: 'Found on the floor',
        welfareOutcomeTone: 'bad',
        personSeen: true,
        accessViaKeySafe: true,
        requiresManagerReview: true,
      }),
    ).toEqual({
      eventType: 'clock_in',
      sourceType: 'check_in',
      sourceId: 'arrival:e1',
      title: 'On arrival: Found on the floor',
      detail: 'Person seen: yes\nGot in using the key safe\nNeeds a manager to review this visit',
      tone: 'danger',
    });
  });

  it('raises a calm answer to amber when the person was not seen or a manager must review', () => {
    expect(arrivalEntry('e1', { welfareOutcomeLabel: 'Well', welfareOutcomeTone: 'ok', personSeen: false })?.tone).toBe('warning');
    expect(arrivalEntry('e1', { welfareOutcomeLabel: 'Well', welfareOutcomeTone: 'ok' })?.tone).toBe('success');
  });

  it('adds no arrival row when the carer answered nothing', () => {
    expect(arrivalEntry('e1', {})).toBeNull();
  });

  it('flags a mock location at clock-in and at clock-out as separate rows', () => {
    expect(mockLocationEntry('e1', 'in')).toMatchObject({ sourceId: 'mock_location:in:e1', tone: 'danger', title: 'Mock location at clock-in' });
    expect(mockLocationEntry('e1', 'out').sourceId).toBe('mock_location:out:e1');
  });

  it('shows how far outside the area the carer clocked in, and why', () => {
    expect(outsideAreaEntry('e1', { distanceMeters: 412.6, reason: 'Client at day centre' })).toMatchObject({
      title: 'Clocked in 413 m outside the visit area',
      detail: 'Reason: Client at day centre',
      tone: 'warning',
    });
    expect(outsideAreaEntry('e1', {})).toBeNull();
  });

  it('logs the lock and who allowed the visit to continue', () => {
    expect(areaLockedEntry({ id: 'L1', distanceMeters: 250 })).toMatchObject({
      sourceId: 'area_lock:L1',
      title: 'Left the visit area: Care app locked',
      tone: 'danger',
    });
    expect(areaAllowedEntry({ id: 'L1', allowedByName: 'Sam Office', allowNote: 'Went to the pharmacy for the client' })).toMatchObject({
      sourceId: 'area_allow:L1',
      title: 'Allowed to continue by Sam Office',
      detail: 'Went to the pharmacy for the client',
      tone: 'success',
    });
  });

  it('alerts the office for amber or red answers, a person not seen, or a manager review', () => {
    expect(isWorryingArrival({ welfareTone: 'bad' })).toBe(true);
    expect(isWorryingArrival({ welfareTone: 'warn' })).toBe(true);
    expect(isWorryingArrival({ welfareTone: 'ok', personSeen: false })).toBe(true);
    expect(isWorryingArrival({ welfareTone: 'ok', requiresManagerReview: true })).toBe(true);
    expect(isWorryingArrival({ welfareTone: 'ok', personSeen: true })).toBe(false);
    expect(isWorryingArrival({})).toBe(false);
  });
});
