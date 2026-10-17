import { decidedTravelForVisit, intervalIsPayable, travelTreatment } from './travel-interval.util';

const interval = (category: string, minutes: number, over: Record<string, unknown> = {}) => ({
  category,
  minutes,
  evidence: 'RECORDED',
  payable: false,
  status: 'APPROVED',
  ...over,
});

describe('travel-time intervals (TR-01 / TR-04 / TR-05 / TR-06)', () => {
  it('treats each category by its nature, and leaves policy categories to a person', () => {
    expect(travelTreatment('BETWEEN_SERVICE_USERS')).toBe('TRAVEL');
    expect(travelTreatment('REQUIRED_WAITING')).toBe('WAITING');
    expect(travelTreatment('REST_BREAK')).toBe('NOT_WORKING_TIME');
    expect(travelTreatment('ORDINARY_COMMUTE')).toBe('NOT_WORKING_TIME');
    for (const category of ['TRAINING_JOURNEY', 'CANCELLED_VISIT_JOURNEY', 'OTHER']) {
      expect(travelTreatment(category)).toBe('BY_DECISION');
      expect(intervalIsPayable(category, false)).toBe(false);
      expect(intervalIsPayable(category, true)).toBe(true);
    }
    // The flag cannot make a rest break payable, or travel between service users unpaid.
    expect(intervalIsPayable('REST_BREAK', true)).toBe(false);
    expect(intervalIsPayable('ORDINARY_COMMUTE', true)).toBe(false);
    expect(intervalIsPayable('BETWEEN_SERVICE_USERS', false)).toBe(true);
  });

  it('nothing approved means nothing is decided: the estimate still applies', () => {
    expect(decidedTravelForVisit([])).toBeNull();
    expect(decidedTravelForVisit([interval('BETWEEN_SERVICE_USERS', 20, { status: 'PENDING' })])).toBeNull();
    expect(decidedTravelForVisit([interval('BETWEEN_SERVICE_USERS', 20, { status: 'REJECTED' })])).toBeNull();
  });

  it('splits a gap into travel, waiting and a rest break', () => {
    const decided = decidedTravelForVisit([
      interval('BETWEEN_SERVICE_USERS', 20, { evidence: 'VERIFIED' }),
      interval('REQUIRED_WAITING', 10),
      interval('REST_BREAK', 30),
      interval('BETWEEN_SERVICE_USERS', 15, { status: 'PENDING' }),
    ]);
    expect(decided).toMatchObject({ travelMinutes: 20, waitingMinutes: 10, notPaidMinutes: 30 });
    expect(decided?.summary).toBe(
      '20 min travel between service users (verified); 10 min required waiting (recorded); 30 min rest break, not paid (recorded)',
    );
  });

  it('an approved rest break alone decides the gap as not travel', () => {
    expect(decidedTravelForVisit([interval('REST_BREAK', 45)])).toMatchObject({ travelMinutes: 0, waitingMinutes: 0, notPaidMinutes: 45 });
  });

  it('a journey to a cancelled visit is paid only when the approver says so', () => {
    expect(decidedTravelForVisit([interval('CANCELLED_VISIT_JOURNEY', 25)])).toMatchObject({ travelMinutes: 0, notPaidMinutes: 25 });
    expect(decidedTravelForVisit([interval('CANCELLED_VISIT_JOURNEY', 25, { payable: true })])).toMatchObject({ travelMinutes: 25, notPaidMinutes: 0 });
  });
});
