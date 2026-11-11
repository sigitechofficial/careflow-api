import { ScheduledJobStatus, VisitReconciliationStatus } from '@prisma/client';
import {
  computeTimebankWeeks,
  timebankCareNotDelivered,
  timebankCancelParty,
  timebankHoursAt,
  timebankLowestHoursIn,
  type TimebankJob,
  type TimebankRecon,
} from './service-user-timebank.util';

const TZ = 'Europe/London';

function job(
  id: string,
  startIso: string,
  hours: number,
  status: ScheduledJobStatus,
  extra?: Partial<TimebankJob>,
): TimebankJob {
  const start = new Date(startIso);
  return {
    id,
    jobName: 'Morning',
    start,
    end: new Date(start.getTime() + hours * 3_600_000),
    estimatedDurationMinutes: null,
    requiredCarers: 1,
    status,
    special: false,
    cancellation: null,
    careNotDelivered: null,
    clockedIn: false,
    ...extra,
  };
}

function recon(
  jobId: string,
  minutes: number,
  status = VisitReconciliationStatus.APPROVED_FOR_BOTH,
): TimebankRecon {
  return { scheduledJobId: jobId, status, minutes, invoiced: false };
}

const base = {
  timeZone: TZ,
  // Wednesday 4 Nov 2026 12:00 UK
  now: new Date('2026-11-04T12:00:00Z'),
  hoursChanges: [],
  specialVisitsCount: true,
  weekStartInstant: (iso: string) => new Date(`${iso}T00:00:00Z`),
};

describe('computeTimebankWeeks', () => {
  it('keeps a cancelled or called-off visit with a Charge decision out of the bank', () => {
    const charged = (noticeHours: number) => ({
      party: 'SERVICE_USER' as const,
      reasonCode: 'CLIENT_REQUEST',
      notes: null,
      chargeable: true,
      noticeHours,
    });
    const jobs = [
      job('a', '2026-10-26T09:00:00Z', 4, ScheduledJobStatus.COMPLETED),
      job('b', '2026-10-27T09:00:00Z', 3, ScheduledJobStatus.CANCELLED, {
        cancellation: charged(6),
      }),
      job('c', '2026-10-28T09:00:00Z', 2, ScheduledJobStatus.CALLED_OFF, {
        cancellation: charged(0),
      }),
      job('d', '2026-10-29T09:00:00Z', 1, ScheduledJobStatus.CANCELLED, {
        cancellation: { ...charged(48), chargeable: false },
      }),
    ];
    const [week] = computeTimebankWeeks({
      ...base,
      startIso: '2026-10-26',
      lastWeekStart: '2026-10-26',
      jobs,
      recons: [recon('a', 240)],
      currentWeeklyHours: 10,
    });
    expect(week.chargeableCancelMinutes).toBe(300);
    expect(week.visits.chargeableCancelled).toBe(2);
    // 10h set − 4h delivered − 5h charged = 1h short: only the visit cancelled without a charge.
    expect(week.freeMinutes).toBe(60);
    expect(week.addedToBankMinutes).toBe(60);
    expect(week.reasons.cancelledByServiceUserMinutes).toBe(60);
    expect(week.reasons.missedMinutes).toBe(0);
    expect(week.reasons.notBookedMinutes).toBe(0);
    const b = week.shortVisits.find((v) => v.jobId === 'b')!;
    expect(b).toMatchObject({
      cancelledAs: 'CANCELLED',
      reason: 'CHARGEABLE_CANCELLATION',
      shortMinutes: 0,
      cancelNoticeHours: 6,
    });
    expect(week.allVisits.find((v) => v.jobId === 'c')?.outcome).toBe(
      'CHARGEABLE_CANCELLATION',
    );
    expect(week.shortVisits.find((v) => v.jobId === 'c')?.cancelledAs).toBe(
      'CALLED_OFF',
    );
  });

  it('puts the hours a finished week did not get in the bank, with the reasons', () => {
    const jobs = [
      job('a', '2026-10-26T09:00:00Z', 4, ScheduledJobStatus.COMPLETED),
      job('b', '2026-10-27T09:00:00Z', 2, ScheduledJobStatus.CANCELLED, {
        cancellation: {
          party: 'SERVICE_USER',
          reasonCode: 'CLIENT_REQUEST',
          notes: null,
          chargeable: false,
          noticeHours: null,
        },
      }),
      job('c', '2026-10-28T09:00:00Z', 2, ScheduledJobStatus.MISSED),
      job('d', '2026-10-29T09:00:00Z', 2, ScheduledJobStatus.COMPLETED),
    ];
    const weeks = computeTimebankWeeks({
      ...base,
      startIso: '2026-10-26',
      lastWeekStart: '2026-10-26',
      jobs,
      recons: [recon('a', 240), recon('d', 90)],
      currentWeeklyHours: 10,
    });
    expect(weeks).toHaveLength(1);
    const w = weeks[0];
    expect(w.status).toBe('short');
    expect(w.setMinutes).toBe(600);
    expect(w.createdMinutes).toBe(480);
    expect(w.deliveredMinutes).toBe(330);
    expect(w.freeMinutes).toBe(270);
    expect(w.addedToBankMinutes).toBe(270);
    expect(w.balanceMinutes).toBe(270);
    expect(w.reasons.cancelledByServiceUserMinutes).toBe(120);
    expect(w.reasons.missedMinutes).toBe(120);
    expect(w.reasons.shorterMinutes).toBe(30);
    expect(w.shortVisits.map((v) => v.reason)).toEqual([
      'CANCELLED_BY_SERVICE_USER',
      'MISSED',
      'SHORTER',
    ]);
    expect(w.allVisits.map((v) => v.outcome)).toEqual([
      'DELIVERED',
      'CANCELLED_BY_SERVICE_USER',
      'MISSED',
      'SHORTER',
    ]);
  });

  it('keeps visits waiting for approval out of the bank and the current week out of it too', () => {
    const jobs = [
      job('a', '2026-10-26T09:00:00Z', 5, ScheduledJobStatus.COMPLETED),
      job('b', '2026-11-02T09:00:00Z', 2, ScheduledJobStatus.COMPLETED),
      job('c', '2026-11-06T09:00:00Z', 3, ScheduledJobStatus.ALLOCATED),
    ];
    const weeks = computeTimebankWeeks({
      ...base,
      startIso: '2026-10-26',
      lastWeekStart: '2026-11-02',
      jobs,
      recons: [
        recon('a', 300, VisitReconciliationStatus.PENDING_REVIEW),
        recon('b', 120),
      ],
      currentWeeklyHours: 6,
    });
    expect(weeks[0].status).toBe('short');
    expect(weeks[0].pendingMinutes).toBe(300);
    expect(weeks[0].freeMinutes).toBe(60);
    expect(weeks[1].status).toBe('current');
    expect(weeks[1].scheduledMinutes).toBe(180);
    expect(weeks[0].allVisits.map((v) => v.outcome)).toEqual(['PENDING']);
    expect(weeks[1].allVisits.map((v) => v.outcome)).toEqual([
      'DELIVERED',
      'SCHEDULED',
    ]);
    expect(weeks[1].freeMinutes).toBe(60);
    expect(weeks[1].addedToBankMinutes).toBe(0);
    expect(weeks[1].balanceMinutes).toBe(60);
  });

  it('marks a visit the office rejected as not approved, not missed, and keeps cancellation notes', () => {
    const jobs = [
      job('a', '2026-10-26T09:00:00Z', 2, ScheduledJobStatus.COMPLETED),
      job('b', '2026-10-27T09:00:00Z', 2, ScheduledJobStatus.CANCELLED, {
        cancellation: {
          party: 'OTHER',
          reasonCode: 'OTHER',
          notes: 'Road closed',
          chargeable: false,
          noticeHours: null,
        },
      }),
    ];
    const weeks = computeTimebankWeeks({
      ...base,
      startIso: '2026-10-26',
      lastWeekStart: '2026-10-26',
      jobs,
      recons: [recon('a', 120, VisitReconciliationStatus.REJECTED_FOR_INVOICE)],
      currentWeeklyHours: 4,
    });
    const w = weeks[0];
    expect(w.visits.missed).toBe(0);
    expect(w.freeMinutes).toBe(240);
    expect(w.shortVisits.map((v) => [v.reason, v.cancelReasonNotes])).toEqual([
      ['NOT_APPROVED', null],
      ['CANCELLED_OTHER', 'Road closed'],
    ]);
  });

  it('counts an unable-to-start visit at its full planned time, in the container its approval puts it in', () => {
    const unable = {
      careNotDelivered: { reasonCode: 'CLIENT_NOT_HOME', notes: 'No answer' },
    };
    const jobs = [
      job('a', '2026-10-26T09:00:00Z', 4, ScheduledJobStatus.COMPLETED, unable),
      job('b', '2026-10-27T09:00:00Z', 4, ScheduledJobStatus.COMPLETED, unable),
      job('c', '2026-10-28T09:00:00Z', 4, ScheduledJobStatus.COMPLETED, unable),
    ];
    const weeks = computeTimebankWeeks({
      ...base,
      startIso: '2026-10-26',
      lastWeekStart: '2026-10-26',
      jobs,
      recons: [
        recon('a', 60, VisitReconciliationStatus.APPROVED_FOR_BOTH),
        recon('b', 60, VisitReconciliationStatus.PENDING_REVIEW),
        recon('c', 60, VisitReconciliationStatus.REJECTED_FOR_INVOICE),
      ],
      currentWeeklyHours: 12,
    });
    const w = weeks[0];
    expect(w.deliveredMinutes).toBe(240);
    expect(w.pendingMinutes).toBe(240);
    expect(w.freeMinutes).toBe(240);
    expect(
      w.allVisits.map((v) => [
        v.outcome,
        v.deliveredMinutes,
        v.pendingMinutes,
        v.shortMinutes,
      ]),
    ).toEqual([
      ['UNABLE_TO_START', 240, 0, 0],
      ['UNABLE_TO_START', 0, 240, 0],
      ['NOT_APPROVED', 0, 0, 240],
    ]);
    expect(w.allVisits[0].careNotDelivered).toEqual({
      reasonCode: 'CLIENT_NOT_HOME',
      notes: 'No answer',
    });
  });

  it('sets a week whose hours were cut at the new hours and keeps the cancelled visits out of the bank', () => {
    const cut = {
      party: 'OTHER' as const,
      reasonCode: 'OTHER',
      notes: 'Weekly contracted hours reduced to 4h',
      chargeable: false,
      noticeHours: null,
    };
    const jobs = [
      job('a', '2026-10-26T09:00:00Z', 4, ScheduledJobStatus.COMPLETED),
      job('b', '2026-10-31T09:00:00Z', 2, ScheduledJobStatus.CANCELLED, {
        cancellation: cut,
      }),
    ];
    const weeks = computeTimebankWeeks({
      ...base,
      startIso: '2026-10-26',
      lastWeekStart: '2026-10-26',
      jobs,
      recons: [recon('a', 240)],
      hoursChanges: [
        { at: new Date('2026-10-27T10:00:00Z'), previous: 6, value: 4 },
      ],
      currentWeeklyHours: 4,
    });
    const w = weeks[0];
    expect(w.setMinutes).toBe(240);
    expect(w.freeMinutes).toBe(0);
    expect(w.reasons.cancelledOtherMinutes).toBe(0);
    expect(w.visits.cancelled).toBe(0);
    expect(w.shortVisits).toHaveLength(0);
    expect(w.allVisits.map((v) => v.outcome)).toEqual([
      'DELIVERED',
      'REMOVED_HOURS_REDUCED',
    ]);
  });

  it('counts only the days from the start date in the first week', () => {
    const weeks = computeTimebankWeeks({
      ...base,
      startIso: '2026-10-29',
      lastWeekStart: '2026-10-26',
      jobs: [],
      recons: [],
      currentWeeklyHours: 14,
    });
    expect(weeks[0].weekStart).toBe('2026-10-26');
    expect(weeks[0].setMinutes).toBe(480);
  });

  it('holds a clocked-in visit with no clock-out as awaiting, out of the short and the bank', () => {
    const jobs = [
      job('a', '2026-10-26T09:00:00Z', 2, ScheduledJobStatus.IN_PROGRESS, {
        clockedIn: true,
      }),
      job('b', '2026-10-27T09:00:00Z', 2, ScheduledJobStatus.NEEDS_ATTENTION),
      job('c', '2026-10-28T09:00:00Z', 2, ScheduledJobStatus.COMPLETED, {
        clockedIn: true,
      }),
    ];
    const weeks = computeTimebankWeeks({
      ...base,
      startIso: '2026-10-26',
      lastWeekStart: '2026-10-26',
      jobs,
      recons: [recon('c', 120, VisitReconciliationStatus.PENDING_REVIEW)],
      currentWeeklyHours: 6,
    });
    const w = weeks[0];
    expect(w.awaitingMinutes).toBe(120);
    expect(w.visits.awaiting).toBe(1);
    expect(w.pendingMinutes).toBe(120);
    expect(w.deliveredMinutes).toBe(0);
    expect(w.reasons.missedMinutes).toBe(120);
    expect(w.freeMinutes).toBe(120);
    expect(w.addedToBankMinutes).toBe(120);
    expect(
      w.allVisits.map((v) => [v.jobId, v.outcome, v.shortMinutes]),
    ).toEqual([
      ['a', 'AWAITING_CLOCK_OUT', 0],
      ['b', 'MISSED', 120],
      ['c', 'PENDING', 0],
    ]);
  });

  it('shows a clocked-in visit still before its end as scheduled', () => {
    const weeks = computeTimebankWeeks({
      ...base,
      startIso: '2026-11-02',
      lastWeekStart: '2026-11-02',
      jobs: [
        job('a', '2026-11-04T11:00:00Z', 2, ScheduledJobStatus.IN_PROGRESS, {
          clockedIn: true,
        }),
      ],
      recons: [],
      currentWeeklyHours: 2,
    });
    expect(weeks[0].scheduledMinutes).toBe(120);
    expect(weeks[0].awaitingMinutes).toBe(0);
  });
});

describe('timebankHoursAt', () => {
  const changes = [
    { at: new Date('2026-10-10T10:00:00Z'), previous: null, value: 20 },
    { at: new Date('2026-10-20T10:00:00Z'), previous: 20, value: 25 },
  ];
  it('reads the value in force at the time', () => {
    expect(timebankHoursAt(changes, new Date('2026-10-01T00:00:00Z'), 25)).toBe(
      20,
    );
    expect(timebankHoursAt(changes, new Date('2026-10-15T00:00:00Z'), 25)).toBe(
      20,
    );
    expect(timebankHoursAt(changes, new Date('2026-10-26T00:00:00Z'), 25)).toBe(
      25,
    );
    expect(timebankHoursAt([], new Date(), 12)).toBe(12);
  });
});

describe('timebankLowestHoursIn', () => {
  const changes = [
    { at: new Date('2026-10-28T10:00:00Z'), previous: 14, value: 10 },
    { at: new Date('2026-11-12T10:00:00Z'), previous: 10, value: 12 },
  ];
  const from = new Date('2026-10-26T00:00:00Z');
  const to = new Date('2026-11-02T00:00:00Z');
  it('takes the lowest value in force during the week', () => {
    expect(timebankLowestHoursIn(changes, from, to, 12)).toBe(10);
    expect(
      timebankLowestHoursIn(
        changes,
        new Date('2026-11-09T00:00:00Z'),
        new Date('2026-11-16T00:00:00Z'),
        12,
      ),
    ).toBe(10);
    expect(
      timebankLowestHoursIn(
        changes,
        new Date('2026-11-16T00:00:00Z'),
        new Date('2026-11-23T00:00:00Z'),
        12,
      ),
    ).toBe(12);
    expect(timebankLowestHoursIn([], from, to, 8)).toBe(8);
  });
});

describe('timebankCareNotDelivered', () => {
  it('reads the flag the completion stores on the job', () => {
    expect(
      timebankCareNotDelivered({
        careNotDelivered: true,
        careNotDeliveredReasonCode: 'CLIENT_REFUSED',
        careNotDeliveredNotes: ' x ',
      }),
    ).toEqual({
      reasonCode: 'CLIENT_REFUSED',
      notes: 'x',
    });
    expect(timebankCareNotDelivered({ special: true })).toBeNull();
    expect(timebankCareNotDelivered(null)).toBeNull();
  });
});

describe('timebankCancelParty', () => {
  it('falls back to the reason when no party was stored', () => {
    expect(timebankCancelParty(null, 'CLIENT_HOSPITAL_ADMISSION')).toBe(
      'SERVICE_USER',
    );
    expect(timebankCancelParty(null, 'PROVIDER_UNABLE_TO_STAFF')).toBe(
      'AGENCY',
    );
    expect(timebankCancelParty('AGENCY', 'OTHER')).toBe('AGENCY');
    expect(timebankCancelParty(undefined, 'OTHER')).toBe('OTHER');
  });
});

describe('computeTimebankWeeks — over care taken back (docs/SU_OVER_CARE_ADJUST_PLAN.md)', () => {
  it('lowers the next week by what it took back and leaves its cancelled visits out', () => {
    // Week of 26 Oct: 10h set, 12h given (2h over). Week of 2 Nov takes the 2h back: one 2h visit
    // cancelled with the over care note, 8h delivered.
    const overCut = {
      party: 'OTHER' as const,
      reasonCode: 'OTHER',
      notes: 'Over care adjustment — week of 26/10/2026 had 2h over',
      chargeable: false,
    };
    const jobs = [
      job('o1', '2026-10-27T09:00:00Z', 12, ScheduledJobStatus.COMPLETED),
      job('n1', '2026-11-02T09:00:00Z', 8, ScheduledJobStatus.COMPLETED),
      job('n2', '2026-11-03T09:00:00Z', 2, ScheduledJobStatus.CANCELLED, { cancellation: overCut }),
    ];
    const adjustment = {
      overWeekStart: '2026-10-26',
      adjustWeekStart: '2026-11-02',
      overMinutes: 120,
      takenBackMinutes: 120,
      cancelledMinutes: 120,
      cancelledVisits: 1,
      notTakenBackMinutes: 0,
    };
    const [over, next] = computeTimebankWeeks({
      ...base,
      now: new Date('2026-11-09T12:00:00Z'),
      startIso: '2026-10-26',
      lastWeekStart: '2026-11-02',
      jobs,
      recons: [recon('o1', 720), recon('n1', 480)],
      currentWeeklyHours: 10,
      overCare: [adjustment],
    });
    expect(over.overMinutes).toBe(120);
    expect(over.overCareAdjustment).toEqual(adjustment);
    expect(next.overCareTakenBack).toEqual(adjustment);
    // 10h − 2h taken back = 8h set; 8h delivered: not short, nothing into the bank.
    expect(next.setMinutes).toBe(480);
    expect(next.freeMinutes).toBe(0);
    expect(next.addedToBankMinutes).toBe(0);
    expect(next.visits.cancelled).toBe(0);
    expect(next.allVisits.find((v) => v.jobId === 'n2')?.outcome).toBe('REMOVED_OVER_CARE');
  });

  it('takes back nothing without an adjustment', () => {
    const [week] = computeTimebankWeeks({
      ...base,
      startIso: '2026-10-26',
      lastWeekStart: '2026-10-26',
      jobs: [job('a', '2026-10-27T09:00:00Z', 12, ScheduledJobStatus.COMPLETED)],
      recons: [recon('a', 720)],
      currentWeeklyHours: 10,
    });
    expect(week.setMinutes).toBe(600);
    expect(week.overMinutes).toBe(120);
    expect(week.overCareAdjustment).toBeNull();
  });
});

describe('computeTimebankWeeks — over care from care given', () => {
  it('a chargeable cancellation counts as care given, so it can make over care (10 Nov 2026)', () => {
    // 10h set: 8h delivered + a 3h visit cancelled late and charged → 1h over contract and 1h over care.
    const charged = {
      party: 'SERVICE_USER' as const,
      reasonCode: 'CLIENT_REQUEST',
      notes: null,
      chargeable: true,
      noticeHours: 5,
    };
    const [week] = computeTimebankWeeks({
      ...base,
      now: new Date('2026-11-09T12:00:00Z'),
      startIso: '2026-11-02',
      lastWeekStart: '2026-11-02',
      jobs: [
        job('d', '2026-11-03T09:00:00Z', 8, ScheduledJobStatus.COMPLETED),
        job('c', '2026-11-05T09:00:00Z', 3, ScheduledJobStatus.CANCELLED, {
          cancellation: charged,
        }),
      ],
      recons: [recon('d', 480)],
      currentWeeklyHours: 10,
    });
    expect(week.chargeableCancelMinutes).toBe(180);
    expect(week.overMinutes).toBe(60);
    expect(week.overCareMinutes).toBe(60);
  });

  it('care given over the weekly hours is over care', () => {
    const [week] = computeTimebankWeeks({
      ...base,
      now: new Date('2026-11-09T12:00:00Z'),
      startIso: '2026-11-02',
      lastWeekStart: '2026-11-02',
      jobs: [job('d', '2026-11-03T09:00:00Z', 11, ScheduledJobStatus.COMPLETED)],
      recons: [recon('d', 660)],
      currentWeeklyHours: 10,
    });
    expect(week.overMinutes).toBe(60);
    expect(week.overCareMinutes).toBe(60);
  });
});
