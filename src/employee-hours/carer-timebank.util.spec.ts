import { ScheduledJobStatus, VisitReconciliationStatus } from '@prisma/client';
import {
  computeCarerTimebankWeeks,
  type CarerTimebankRecon,
  type CarerTimebankVisit,
} from './carer-timebank.util';

function visit(
  id: string,
  startIso: string,
  hours: number,
  status: ScheduledJobStatus,
  extra?: Partial<CarerTimebankVisit>,
): CarerTimebankVisit {
  const start = new Date(startIso);
  return {
    allocationId: `alloc-${id}`,
    jobId: id,
    jobName: 'Morning',
    serviceUserName: 'Ruth Evans',
    start,
    end: new Date(start.getTime() + hours * 3_600_000),
    minutes: hours * 60,
    jobStatus: status,
    cancelled: false,
    cancellation: null,
    careNotDelivered: null,
    ...extra,
  };
}

function recon(
  jobId: string,
  minutes: number,
  status = VisitReconciliationStatus.APPROVED_FOR_BOTH,
): CarerTimebankRecon {
  return { scheduledJobId: jobId, status, minutes };
}

const base = {
  timeZone: 'Europe/London',
  // Wednesday 4 Nov 2026 12:00 UK
  now: new Date('2026-11-04T12:00:00Z'),
  endIso: null,
  hoursChanges: [],
  absences: [],
  dayBounds: (iso: string) => {
    const start = new Date(`${iso}T00:00:00Z`);
    return { start, end: new Date(start.getTime() + 86_400_000) };
  },
};

describe('computeCarerTimebankWeeks', () => {
  it('splits a finished week into not given and not worked, with the reasons', () => {
    const visits = [
      visit('a', '2026-10-26T09:00:00Z', 4, ScheduledJobStatus.COMPLETED),
      visit('b', '2026-10-27T09:00:00Z', 2, ScheduledJobStatus.MISSED),
      visit('c', '2026-10-28T09:00:00Z', 2, ScheduledJobStatus.COMPLETED),
      visit('d', '2026-10-29T09:00:00Z', 2, ScheduledJobStatus.CANCELLED, {
        cancelled: true,
        cancellation: {
          party: 'SERVICE_USER',
          reasonCode: 'CLIENT_REQUEST',
          notes: null,
        },
      }),
      visit('e', '2026-10-30T09:00:00Z', 1, ScheduledJobStatus.COMPLETED),
    ];
    const weeks = computeCarerTimebankWeeks({
      ...base,
      startIso: '2026-10-26',
      lastWeekStart: '2026-10-26',
      visits,
      recons: [
        recon('a', 240),
        recon('c', 90),
        recon('e', 60, VisitReconciliationStatus.REJECTED_FOR_PAY),
      ],
      currentWeeklyHours: 14,
    });
    const w = weeks[0];
    expect(w.status).toBe('short');
    expect(w.setMinutes).toBe(840);
    expect(w.assignedMinutes).toBe(540);
    expect(w.cancelledMinutes).toBe(120);
    expect(w.notGivenMinutes).toBe(180);
    expect(w.workedMinutes).toBe(330);
    expect(w.notWorkedMinutes).toBe(210);
    expect(w.freeMinutes).toBe(510);
    expect(w.balanceMinutes).toBe(510);
    expect(w.allVisits.map((v) => v.outcome)).toEqual([
      'WORKED',
      'MISSED',
      'SHORTER',
      'CANCELLED_BY_SERVICE_USER',
      'PAY_REJECTED',
    ]);
  });

  it('takes days off out of the contracted hours and keeps visits to come out of the bank', () => {
    const weeks = computeCarerTimebankWeeks({
      ...base,
      startIso: '2026-10-26',
      lastWeekStart: '2026-11-02',
      visits: [
        visit('a', '2026-11-02T09:00:00Z', 2, ScheduledJobStatus.COMPLETED),
        visit('b', '2026-11-06T09:00:00Z', 3, ScheduledJobStatus.ALLOCATED),
      ],
      recons: [recon('a', 120, VisitReconciliationStatus.PENDING_REVIEW)],
      absences: [
        {
          from: new Date('2026-10-26T00:00:00Z'),
          to: new Date('2026-10-28T00:00:00Z'),
          type: 'Holiday',
          sickness: false,
        },
      ],
      currentWeeklyHours: 7,
    });
    expect(weeks[0].absentDays).toBe(2);
    expect(weeks[0].setMinutes).toBe(300);
    expect(weeks[0].freeMinutes).toBe(300);
    expect(weeks[1].status).toBe('current');
    expect(weeks[1].pendingMinutes).toBe(120);
    expect(weeks[1].scheduledMinutes).toBe(180);
    expect(weeks[1].freeMinutes).toBe(120);
    expect(weeks[1].addedToBankMinutes).toBe(0);
  });

  it('shows the rest of an unable-to-start visit as not worked, with the reason', () => {
    const weeks = computeCarerTimebankWeeks({
      ...base,
      startIso: '2026-10-26',
      lastWeekStart: '2026-10-26',
      visits: [
        visit('a', '2026-10-26T09:00:00Z', 3, ScheduledJobStatus.COMPLETED, {
          careNotDelivered: {
            reasonCode: 'CLIENT_NOT_HOME',
            notes: 'No answer',
          },
        }),
      ],
      recons: [recon('a', 60)],
      currentWeeklyHours: 3,
    });
    const v = weeks[0].allVisits[0];
    expect([v.outcome, v.workedMinutes, v.shortMinutes, v.reasonCode]).toEqual([
      'UNABLE_TO_START',
      60,
      120,
      'CLIENT_NOT_HOME',
    ]);
    expect(weeks[0].reasons.unableToStartMinutes).toBe(120);
  });

  it('counts only the days employed in the first week', () => {
    const weeks = computeCarerTimebankWeeks({
      ...base,
      startIso: '2026-10-29',
      lastWeekStart: '2026-10-26',
      visits: [],
      recons: [],
      currentWeeklyHours: 14,
    });
    expect(weeks[0].contractedMinutes).toBe(480);
    expect(weeks[0].notGivenMinutes).toBe(480);
  });
});
