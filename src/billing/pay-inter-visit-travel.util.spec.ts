import {
  detectInterVisitTravel,
  summariseTravelForDestination,
} from './pay-inter-visit-travel.util';

function at(h: number, m = 0) {
  return new Date(Date.UTC(2026, 6, 14, h, m, 0));
}

describe('detectInterVisitTravel', () => {
  it('Scenario 1-style: 20 min SU→SU gap counts as NMW/payable travel', () => {
    const journeys = detectInterVisitTravel([
      {
        reconciliationId: 'r1',
        employeeId: 'e1',
        visitRef: 'V1',
        payStart: at(8, 0),
        payEnd: at(8, 30),
        serviceUserId: 'su-a',
      },
      {
        reconciliationId: 'r2',
        employeeId: 'e1',
        visitRef: 'V2',
        payStart: at(8, 50),
        payEnd: at(9, 20),
        serviceUserId: 'su-b',
      },
    ]);

    expect(journeys).toHaveLength(1);
    expect(journeys[0].gapMinutes).toBe(20);
    expect(journeys[0].nmwMinutes).toBe(20);
    expect(journeys[0].payableTravelMinutes).toBe(20);
    expect(journeys[0].toReconciliationId).toBe('r2');

    const summary = summariseTravelForDestination(journeys, 'r2');
    expect(summary.nmwMinutes).toBe(20);
    expect(summary.payableTravelMinutes).toBe(20);
  });

  it('short ≤15 min gap is treated as waiting (still NMW)', () => {
    const journeys = detectInterVisitTravel([
      {
        reconciliationId: 'r1',
        employeeId: 'e1',
        visitRef: 'V1',
        payStart: at(10, 0),
        payEnd: at(10, 30),
        serviceUserId: 'su-a',
      },
      {
        reconciliationId: 'r2',
        employeeId: 'e1',
        visitRef: 'V2',
        payStart: at(10, 40),
        payEnd: at(11, 10),
        serviceUserId: 'su-b',
      },
    ]);

    expect(journeys[0].gapMinutes).toBe(10);
    expect(journeys[0].classification).toBe('PAID_WAITING');
    expect(journeys[0].payableWaitingMinutes).toBe(10);
    expect(journeys[0].nmwMinutes).toBe(10);
  });

  it('long same-client gap assumes return home — unpaid personal, not NMW travel', () => {
    const journeys = detectInterVisitTravel([
      {
        reconciliationId: 'r1',
        employeeId: 'e1',
        visitRef: 'V1',
        payStart: at(9, 0),
        payEnd: at(9, 30),
        serviceUserId: 'su-a',
      },
      {
        reconciliationId: 'r2',
        employeeId: 'e1',
        visitRef: 'V2',
        payStart: at(11, 0),
        payEnd: at(11, 30),
        serviceUserId: 'su-a',
      },
    ]);

    expect(journeys[0].gapMinutes).toBe(90);
    expect(journeys[0].nmwMinutes).toBe(0);
    expect(journeys[0].classification).toBe('UNPAID_PERSONAL');
  });

  it('respects manual travel on destination and keeps residual as unpaid NMW', () => {
    const journeys = detectInterVisitTravel([
      {
        reconciliationId: 'r1',
        employeeId: 'e1',
        visitRef: 'V1',
        payStart: at(8, 0),
        payEnd: at(8, 30),
        serviceUserId: 'su-a',
      },
      {
        reconciliationId: 'r2',
        employeeId: 'e1',
        visitRef: 'V2',
        payStart: at(9, 0),
        payEnd: at(9, 30),
        serviceUserId: 'su-b',
        manualTravelMinutes: 15,
      },
    ]);

    expect(journeys[0].payableTravelMinutes).toBe(0);
    expect(journeys[0].nmwMinutes).toBeGreaterThanOrEqual(15);
    expect(journeys[0].unpaidNmwMinutes).toBe(15); // 30 gap − 15 manual
  });

  it('ignores overlapping / contiguous visits and groups by employee', () => {
    const journeys = detectInterVisitTravel([
      {
        reconciliationId: 'a1',
        employeeId: 'e1',
        visitRef: 'A1',
        payStart: at(8, 0),
        payEnd: at(9, 0),
        serviceUserId: 'su-a',
      },
      {
        reconciliationId: 'a2',
        employeeId: 'e1',
        visitRef: 'A2',
        payStart: at(9, 0),
        payEnd: at(9, 30),
        serviceUserId: 'su-b',
      },
      {
        reconciliationId: 'b1',
        employeeId: 'e2',
        visitRef: 'B1',
        payStart: at(8, 0),
        payEnd: at(8, 30),
        serviceUserId: 'su-c',
      },
      {
        reconciliationId: 'b2',
        employeeId: 'e2',
        visitRef: 'B2',
        payStart: at(8, 50),
        payEnd: at(9, 20),
        serviceUserId: 'su-d',
      },
    ]);

    expect(journeys.filter((j) => j.employeeId === 'e1')).toHaveLength(0);
    expect(journeys.filter((j) => j.employeeId === 'e2')).toHaveLength(1);
    expect(journeys[0].nmwMinutes).toBe(20);
  });
});
