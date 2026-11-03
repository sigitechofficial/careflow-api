import { ScheduledJobStatus, VisitReconciliationStatus } from '@prisma/client';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
} from '../common/utils/operational-day.util';
import {
  mondayOfOperationalIso,
  timebankLowestHoursIn,
  type TimebankCancelParty,
  type TimebankHoursChange,
  type TimebankWeekStatus,
} from '../service-user-hours/service-user-timebank.util';

/**
 * Carer timebank (report only): a carer's contracted weekly hours against the visits they were
 * given and the time they worked. Days off (holiday, sickness, other absence) lower the week's
 * contracted hours. Nothing is stored: every number comes from the rota, the carer's own visit
 * reconciliation rows, absences and the contracted hours history each time.
 */

/** Approved for carer pay — the rows a payroll run pays. */
export const CARER_TIMEBANK_WORKED_RECON: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.APPROVED_FOR_PAY,
  VisitReconciliationStatus.APPROVED_FOR_BOTH,
  VisitReconciliationStatus.LOCKED,
];

/** Visit done but the office has not approved the carer's pay yet. */
export const CARER_TIMEBANK_PENDING_RECON: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.PENDING_REVIEW,
  VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL,
  VisitReconciliationStatus.APPROVED_FOR_INVOICE,
  VisitReconciliationStatus.REJECTED_FOR_INVOICE,
];

/** The office rejected the carer's pay for the visit. */
export const CARER_TIMEBANK_REJECTED_RECON: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.REJECTED_FOR_PAY,
];

/** A job that has ended on the rota (no longer expected to happen). */
const ENDED_JOB_STATUSES: ScheduledJobStatus[] = [
  ScheduledJobStatus.COMPLETED,
  ScheduledJobStatus.PARTIALLY_COMPLETED,
  ScheduledJobStatus.MISSED,
];

/** One rota visit the carer was given (their own allocation). */
export type CarerTimebankVisit = {
  allocationId: string;
  jobId: string;
  jobName: string;
  serviceUserName: string;
  start: Date;
  end: Date | null;
  /** The carer's own time on the visit. */
  minutes: number;
  jobStatus: ScheduledJobStatus;
  /** True when the visit was cancelled or called off with the carer still on it. */
  cancelled: boolean;
  cancellation: {
    party: TimebankCancelParty;
    reasonCode: string;
    notes: string | null;
  } | null;
  /** "Unable to start": the carer attended but care was not delivered. */
  careNotDelivered: { reasonCode: string | null; notes: string | null } | null;
};

/** The carer's own reconciliation row for a visit. */
export type CarerTimebankRecon = {
  scheduledJobId: string;
  status: VisitReconciliationStatus;
  /** Payable minutes (approved pay window, else clock times). */
  minutes: number;
};

export type CarerTimebankAbsence = {
  from: Date;
  to: Date;
  type: string;
  sickness: boolean;
};

export type CarerTimebankOutcome =
  | 'WORKED'
  | 'PENDING'
  | 'SCHEDULED'
  | 'SHORTER'
  | 'MISSED'
  | 'PAY_REJECTED'
  | 'UNABLE_TO_START'
  | 'CANCELLED_BY_SERVICE_USER'
  | 'CANCELLED_BY_AGENCY'
  | 'CANCELLED_OTHER'
  | 'CALLED_OFF';

export type CarerTimebankWeekVisit = {
  jobId: string;
  jobName: string;
  serviceUserName: string;
  /** Visit day (org timezone). */
  day: string;
  start: string;
  end: string | null;
  plannedMinutes: number;
  workedMinutes: number;
  pendingMinutes: number;
  shortMinutes: number;
  outcome: CarerTimebankOutcome;
  /** Cancellation or "Unable to start" reason code, and the note typed with it. */
  reasonCode: string | null;
  reasonNotes: string | null;
};

export type CarerTimebankWeek = {
  weekStart: string;
  weekEnd: string;
  status: TimebankWeekStatus;
  weeklyHours: number | null;
  /** Contracted hours for the days employed, before days off. */
  contractedMinutes: number;
  /** Days off in the week (holiday, sickness, other absence). */
  absentDays: number;
  absenceMinutes: number;
  /** Contracted hours after days off — what the week is measured against. */
  setMinutes: number;
  /** Visits the carer is on that still stand (not cancelled). */
  assignedMinutes: number;
  workedMinutes: number;
  /** Visits done, carer pay not approved yet. */
  pendingMinutes: number;
  /** Visits still to come. */
  scheduledMinutes: number;
  /** Visits the carer was given that were then cancelled or called off. */
  cancelledMinutes: number;
  /** Contracted hours the carer was never given visits for. */
  notGivenMinutes: number;
  /** Visits given but not (fully) worked: missed, shorter, pay rejected, unable to start. */
  notWorkedMinutes: number;
  /** Contracted hours not worked, not waiting for approval and not still to come. */
  freeMinutes: number;
  overMinutes: number;
  /** Finished weeks only: what the week put in the bank. */
  addedToBankMinutes: number;
  balanceMinutes: number;
  visits: {
    assigned: number;
    worked: number;
    pending: number;
    scheduled: number;
    cancelled: number;
    missed: number;
  };
  reasons: {
    cancelledByServiceUserMinutes: number;
    cancelledByAgencyMinutes: number;
    cancelledOtherMinutes: number;
    calledOffMinutes: number;
    missedMinutes: number;
    shorterMinutes: number;
    payRejectedMinutes: number;
    unableToStartMinutes: number;
  };
  /** Days off touching the week: first and last day (org days). */
  absences: Array<{
    from: string;
    to: string;
    type: string;
    sickness: boolean;
  }>;
  allVisits: CarerTimebankWeekVisit[];
};

/** Days of the week (org days) that an absence touches. */
function absentDaysIn(
  days: string[],
  absences: CarerTimebankAbsence[],
  dayBounds: (iso: string) => { start: Date; end: Date },
): Set<string> {
  const out = new Set<string>();
  for (const day of days) {
    const { start, end } = dayBounds(day);
    if (
      absences.some(
        (a) =>
          a.from.getTime() < end.getTime() && a.to.getTime() > start.getTime(),
      )
    )
      out.add(day);
  }
  return out;
}

/**
 * Every Monday–Sunday week from the carer's start week to `lastWeekStart`, the bank running
 * through the finished weeks in order.
 */
export function computeCarerTimebankWeeks(params: {
  timeZone: string;
  now: Date;
  /** First day counted (org day). */
  startIso: string;
  /** Last day employed (org day), if they left. */
  endIso: string | null;
  lastWeekStart: string;
  visits: CarerTimebankVisit[];
  recons: CarerTimebankRecon[];
  absences: CarerTimebankAbsence[];
  hoursChanges: TimebankHoursChange[];
  currentWeeklyHours: number | null;
  dayBounds: (iso: string) => { start: Date; end: Date };
}): CarerTimebankWeek[] {
  const today = dayKeyInTimeZone(params.now, params.timeZone);
  const currentMonday = mondayOfOperationalIso(today);
  const firstMonday = mondayOfOperationalIso(params.startIso);

  const reconsByJob = new Map<string, CarerTimebankRecon[]>();
  for (const r of params.recons) {
    const list = reconsByJob.get(r.scheduledJobId) ?? [];
    list.push(r);
    reconsByJob.set(r.scheduledJobId, list);
  }
  const visitsByWeek = new Map<string, CarerTimebankVisit[]>();
  for (const v of params.visits) {
    const day = dayKeyInTimeZone(v.start, params.timeZone);
    if (day < params.startIso) continue;
    const monday = mondayOfOperationalIso(day);
    const list = visitsByWeek.get(monday) ?? [];
    list.push(v);
    visitsByWeek.set(monday, list);
  }

  const weeks: CarerTimebankWeek[] = [];
  let balance = 0;
  for (
    let monday = firstMonday;
    monday <= params.lastWeekStart;
    monday = addDaysToOperationalIso(monday, 7)
  ) {
    const sunday = addDaysToOperationalIso(monday, 6);
    const status: TimebankWeekStatus =
      monday > currentMonday
        ? 'upcoming'
        : monday === currentMonday
          ? 'current'
          : 'complete';

    const days = Array.from({ length: 7 }, (_, i) =>
      addDaysToOperationalIso(monday, i),
    );
    const employedDays = days.filter(
      (d) => d >= params.startIso && (!params.endIso || d <= params.endIso),
    );
    const weekFrom = params.dayBounds(employedDays[0] ?? monday).start;
    const weekTo = params.dayBounds(addDaysToOperationalIso(sunday, 1)).start;
    const weeklyHours = timebankLowestHoursIn(
      params.hoursChanges,
      weekFrom,
      weekTo,
      params.currentWeeklyHours,
    );
    const perDay = weeklyHours != null ? (weeklyHours * 60) / 7 : 0;
    const absent = absentDaysIn(
      employedDays,
      params.absences,
      params.dayBounds,
    );
    const contractedMinutes = Math.round(perDay * employedDays.length);
    const setMinutes = Math.round(perDay * (employedDays.length - absent.size));

    const week: CarerTimebankWeek = {
      weekStart: monday,
      weekEnd: sunday,
      status,
      weeklyHours,
      contractedMinutes,
      absentDays: absent.size,
      absenceMinutes: contractedMinutes - setMinutes,
      setMinutes,
      assignedMinutes: 0,
      workedMinutes: 0,
      pendingMinutes: 0,
      scheduledMinutes: 0,
      cancelledMinutes: 0,
      notGivenMinutes: 0,
      notWorkedMinutes: 0,
      freeMinutes: 0,
      overMinutes: 0,
      addedToBankMinutes: 0,
      balanceMinutes: 0,
      visits: {
        assigned: 0,
        worked: 0,
        pending: 0,
        scheduled: 0,
        cancelled: 0,
        missed: 0,
      },
      reasons: {
        cancelledByServiceUserMinutes: 0,
        cancelledByAgencyMinutes: 0,
        cancelledOtherMinutes: 0,
        calledOffMinutes: 0,
        missedMinutes: 0,
        shorterMinutes: 0,
        payRejectedMinutes: 0,
        unableToStartMinutes: 0,
      },
      absences: params.absences
        .filter(
          (a) =>
            a.from.getTime() < weekTo.getTime() &&
            a.to.getTime() > params.dayBounds(monday).start.getTime(),
        )
        .map((a) => ({
          from: dayKeyInTimeZone(a.from, params.timeZone),
          to: dayKeyInTimeZone(a.to, params.timeZone),
          type: a.type,
          sickness: a.sickness,
        })),
      allVisits: [],
    };

    const visits = (visitsByWeek.get(monday) ?? []).sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
    for (const v of visits) {
      const planned = v.minutes;
      const base = {
        jobId: v.jobId,
        jobName: v.jobName,
        serviceUserName: v.serviceUserName,
        day: dayKeyInTimeZone(v.start, params.timeZone),
        start: v.start.toISOString(),
        end: v.end?.toISOString() ?? null,
        plannedMinutes: planned,
      };

      if (v.cancelled) {
        // Given to the carer, then taken away by a cancellation: short, with the reason.
        const party = v.cancellation?.party ?? 'OTHER';
        const outcome: CarerTimebankOutcome =
          v.jobStatus === ScheduledJobStatus.CALLED_OFF
            ? 'CALLED_OFF'
            : party === 'SERVICE_USER'
              ? 'CANCELLED_BY_SERVICE_USER'
              : party === 'AGENCY'
                ? 'CANCELLED_BY_AGENCY'
                : 'CANCELLED_OTHER';
        week.cancelledMinutes += planned;
        week.visits.cancelled += 1;
        if (outcome === 'CALLED_OFF') week.reasons.calledOffMinutes += planned;
        else if (outcome === 'CANCELLED_BY_SERVICE_USER')
          week.reasons.cancelledByServiceUserMinutes += planned;
        else if (outcome === 'CANCELLED_BY_AGENCY')
          week.reasons.cancelledByAgencyMinutes += planned;
        else week.reasons.cancelledOtherMinutes += planned;
        week.allVisits.push({
          ...base,
          workedMinutes: 0,
          pendingMinutes: 0,
          shortMinutes: planned,
          outcome,
          reasonCode: v.cancellation?.reasonCode ?? null,
          reasonNotes: v.cancellation?.notes ?? null,
        });
        continue;
      }

      week.assignedMinutes += planned;
      week.visits.assigned += 1;
      const rows = reconsByJob.get(v.jobId) ?? [];
      const worked = rows
        .filter((r) => CARER_TIMEBANK_WORKED_RECON.includes(r.status))
        .reduce((s, r) => s + r.minutes, 0);
      const pending = rows
        .filter((r) => CARER_TIMEBANK_PENDING_RECON.includes(r.status))
        .reduce((s, r) => s + r.minutes, 0);
      const hasRows = rows.some(
        (r) =>
          CARER_TIMEBANK_WORKED_RECON.includes(r.status) ||
          CARER_TIMEBANK_PENDING_RECON.includes(r.status),
      );

      if (!hasRows) {
        const ended = ENDED_JOB_STATUSES.includes(v.jobStatus);
        const finishAt = v.end ?? new Date(v.start.getTime() + planned * 60000);
        const reason = (outcome: CarerTimebankOutcome) => ({
          ...base,
          workedMinutes: 0,
          pendingMinutes: 0,
          shortMinutes: outcome === 'SCHEDULED' ? 0 : planned,
          outcome,
          reasonCode: null,
          reasonNotes: null,
        });
        if (!ended && finishAt.getTime() > params.now.getTime()) {
          week.scheduledMinutes += planned;
          week.visits.scheduled += 1;
          week.allVisits.push(reason('SCHEDULED'));
        } else if (
          rows.some((r) => CARER_TIMEBANK_REJECTED_RECON.includes(r.status))
        ) {
          week.reasons.payRejectedMinutes += planned;
          week.notWorkedMinutes += planned;
          week.allVisits.push(reason('PAY_REJECTED'));
        } else {
          week.reasons.missedMinutes += planned;
          week.notWorkedMinutes += planned;
          week.visits.missed += 1;
          week.allVisits.push(reason('MISSED'));
        }
        continue;
      }

      week.workedMinutes += worked;
      week.pendingMinutes += pending;
      if (worked > 0) week.visits.worked += 1;
      else week.visits.pending += 1;
      const diff = Math.max(0, planned - worked - pending);
      const outcome: CarerTimebankOutcome = v.careNotDelivered
        ? 'UNABLE_TO_START'
        : diff > 0
          ? 'SHORTER'
          : worked > 0
            ? 'WORKED'
            : 'PENDING';
      if (diff > 0) {
        week.notWorkedMinutes += diff;
        if (outcome === 'UNABLE_TO_START')
          week.reasons.unableToStartMinutes += diff;
        else week.reasons.shorterMinutes += diff;
      }
      week.allVisits.push({
        ...base,
        workedMinutes: worked,
        pendingMinutes: pending,
        shortMinutes: diff,
        outcome,
        reasonCode: v.careNotDelivered?.reasonCode ?? null,
        reasonNotes: v.careNotDelivered?.notes ?? null,
      });
    }

    week.notGivenMinutes = Math.max(
      0,
      setMinutes - week.assignedMinutes - week.cancelledMinutes,
    );
    const covered =
      week.workedMinutes + week.pendingMinutes + week.scheduledMinutes;
    week.freeMinutes = Math.max(0, setMinutes - covered);
    week.overMinutes = Math.max(0, covered - setMinutes);
    if (status === 'complete') {
      if (week.freeMinutes > 0) week.status = 'short';
      week.addedToBankMinutes = week.freeMinutes;
      balance += week.freeMinutes;
    }
    week.balanceMinutes = balance;
    weeks.push(week);
  }
  return weeks;
}
