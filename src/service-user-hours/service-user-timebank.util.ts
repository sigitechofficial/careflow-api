import { ScheduledJobStatus, VisitReconciliationStatus } from '@prisma/client';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
} from '../common/utils/operational-day.util';

/**
 * Service user timebank: the weekly hours set for a service user against the care delivered.
 * A finished Monday–Sunday week that got less than its weekly hours puts the difference in the
 * bank. Weeks that got more are shown but take nothing out of the bank (over-delivery is not
 * decided yet). A visit cancelled with a Charge decision (Job Cancellation rules) is paid for, so
 * it counts as covered and never goes in the bank. Nothing is stored: every number is worked out
 * from the rota, the visit reconciliations and the weekly hours history each time.
 */

/** Approved for invoicing — the same minutes an invoice run bills. */
export const TIMEBANK_DELIVERED_RECON: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.APPROVED_FOR_INVOICE,
  VisitReconciliationStatus.APPROVED_FOR_BOTH,
  VisitReconciliationStatus.LOCKED,
];

/** Visit done but the office has not approved it for invoicing yet. */
export const TIMEBANK_PENDING_RECON: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.PENDING_REVIEW,
  VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL,
  VisitReconciliationStatus.APPROVED_FOR_PAY,
];

/** The office rejected the visit — it happened but will not be billed. */
export const TIMEBANK_REJECTED_RECON: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.REJECTED_FOR_PAY,
  VisitReconciliationStatus.REJECTED_FOR_INVOICE,
];

/** A job that has ended on the rota (no longer expected to happen). */
const ENDED_JOB_STATUSES: ScheduledJobStatus[] = [
  ScheduledJobStatus.COMPLETED,
  ScheduledJobStatus.PARTIALLY_COMPLETED,
  ScheduledJobStatus.MISSED,
  ScheduledJobStatus.CALLED_OFF,
];

export type TimebankCancelParty = 'SERVICE_USER' | 'AGENCY' | 'OTHER';

export type TimebankJob = {
  id: string;
  jobName: string;
  start: Date;
  end: Date | null;
  estimatedDurationMinutes: number | null;
  requiredCarers: number | null;
  status: ScheduledJobStatus;
  /** Special visit (not from a plan) — counts only when Dom Rules say so. */
  special: boolean;
  cancellation: {
    party: TimebankCancelParty;
    reasonCode: string;
    notes: string | null;
    /** Charged under the Job Cancellation rules: the visit is paid for, so nothing goes in the bank. */
    chargeable: boolean;
    /** Hours of notice the cancellation gave, when recorded. */
    noticeHours: number | null;
    /** Billing notes saved with the Charge decision. */
    chargeNotes?: string | null;
  } | null;
  /** Carer attended but care was not delivered ("Unable to start"). */
  careNotDelivered: { reasonCode: string | null; notes: string | null } | null;
  /** A carer clocked in (the visit has a start time). */
  clockedIn: boolean;
};

export type TimebankRecon = {
  scheduledJobId: string;
  status: VisitReconciliationStatus;
  /** Billable minutes of this carer's row (approved bill window, else clock times). */
  minutes: number;
  /** In a locked invoice run (the invoice is made). */
  invoiced: boolean;
};

/** One weekly hours value from the audit history; `at` is when it was saved. */
export type TimebankHoursChange = {
  at: Date;
  previous: number | null;
  value: number | null;
};

export type TimebankShortReason =
  | 'CANCELLED_BY_SERVICE_USER'
  | 'CANCELLED_BY_AGENCY'
  | 'CANCELLED_OTHER'
  | 'MISSED'
  | 'CALLED_OFF'
  | 'SHORTER'
  | 'NOT_APPROVED'
  /** Cancelled and charged: listed with the visits not delivered, but nothing is short. */
  | 'CHARGEABLE_CANCELLATION';

export type TimebankShortVisit = {
  jobId: string;
  jobName: string;
  /** Visit day (org timezone). */
  day: string;
  start: string;
  end: string | null;
  plannedMinutes: number;
  deliveredMinutes: number;
  pendingMinutes: number;
  shortMinutes: number;
  reason: TimebankShortReason;
  cancelReasonCode: string | null;
  /** Free text typed with the cancellation (e.g. for "Other"). */
  cancelReasonNotes: string | null;
  /** Hours of notice a chargeable cancellation gave, when recorded. */
  cancelNoticeHours?: number | null;
  /** Chargeable cancellation: cancelled (planned stop) or called off (due but did not happen). */
  cancelledAs?: 'CANCELLED' | 'CALLED_OFF';
  /** Chargeable cancellation: billing notes saved with the Charge decision. */
  chargeNotes?: string | null;
};

/** What happened to one rota visit of the week. */
export type TimebankVisitOutcome =
  | TimebankShortReason
  | 'DELIVERED'
  | 'PENDING'
  | 'SCHEDULED'
  | 'UNABLE_TO_START'
  | 'AWAITING_CLOCK_OUT'
  | 'REMOVED_HOURS_REDUCED'
  | 'REMOVED_OVER_CARE';

/** Over care taken back the next week (docs/SU_OVER_CARE_ADJUST_PLAN.md), one per over week. */
export type TimebankOverCare = {
  overWeekStart: string;
  adjustWeekStart: string;
  overMinutes: number;
  takenBackMinutes: number;
  cancelledMinutes: number;
  cancelledVisits: number;
  notTakenBackMinutes: number;
  /** Over care review (Workforce › Over care reviews): PENDING, ACTION_TAKEN or NO_ACTION_NEEDED. */
  reviewStatus?: string;
};

export type TimebankWeekVisit = Omit<TimebankShortVisit, 'reason'> & {
  outcome: TimebankVisitOutcome;
  /** "Unable to start" reason and notes, when the carer attended but care was not delivered. */
  careNotDelivered: { reasonCode: string | null; notes: string | null } | null;
};

export type TimebankWeekStatus = 'complete' | 'short' | 'current' | 'upcoming';

export type TimebankWeek = {
  weekStart: string;
  weekEnd: string;
  status: TimebankWeekStatus;
  /** Weekly hours for the week in minutes; the first week only counts the days from the start date. */
  setMinutes: number;
  weeklyHours: number | null;
  /** Rota visits of the week that are not cancelled (each carer's time for a double-up). */
  createdMinutes: number;
  deliveredMinutes: number;
  /** Delivered minutes already on a locked invoice run. */
  invoicedMinutes: number;
  pendingMinutes: number;
  /** Visits still to come (not done yet). */
  scheduledMinutes: number;
  /** Clocked in, never clocked out, planned end past: not delivered and not short until the visit is closed. */
  awaitingMinutes: number;
  /** Visits cancelled or called off with a Charge decision: paid for, so covered and never in the bank. */
  chargeableCancelMinutes: number;
  /** Weekly hours not delivered, not waiting for approval, not awaiting clock-out and not still to come. */
  freeMinutes: number;
  overMinutes: number;
  /**
   * Over the weekly hours in care given (delivered + done + chargeable cancellations; a week not
   * finished adds what is still to come). Since 10 Nov 2026 a cancellation the service user is
   * charged for counts as care given (user decision), so it can make over care
   * (docs/SU_OVER_CARE_ADJUST_PLAN.md).
   */
  overCareMinutes: number;
  /** Finished weeks only: what the week put in the bank. */
  addedToBankMinutes: number;
  /** Bank balance after this week (finished weeks only add to it). */
  balanceMinutes: number;
  visits: {
    created: number;
    delivered: number;
    pending: number;
    scheduled: number;
    awaiting: number;
    cancelled: number;
    missed: number;
    chargeableCancelled: number;
  };
  reasons: {
    cancelledByServiceUserMinutes: number;
    cancelledByAgencyMinutes: number;
    cancelledOtherMinutes: number;
    missedMinutes: number;
    shorterMinutes: number;
    longerMinutes: number;
    /** Weekly hours never put on the rota. */
    notBookedMinutes: number;
  };
  shortVisits: TimebankShortVisit[];
  /** Every rota visit of the week, cancelled ones included, in time order. */
  allVisits: TimebankWeekVisit[];
  /** This week got over care and it was taken back the next week. */
  overCareAdjustment: TimebankOverCare | null;
  /** This week's hours were lowered to take back the week before's over care. */
  overCareTakenBack: TimebankOverCare | null;
};

/** "Unable to start" / care not delivered, as the completion stores it on the job metadata. */
export function timebankCareNotDelivered(
  metadata: unknown,
): TimebankJob['careNotDelivered'] {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const reasonCode =
    typeof meta.careNotDeliveredReasonCode === 'string'
      ? meta.careNotDeliveredReasonCode
      : null;
  if (meta.careNotDelivered !== true && !reasonCode) return null;
  const notes =
    typeof meta.careNotDeliveredNotes === 'string'
      ? meta.careNotDeliveredNotes.trim()
      : '';
  return { reasonCode, notes: notes || null };
}

/** Cancellation party from the stored party, else from the reason (older rows have no party). */
export function timebankCancelParty(
  party: string | null | undefined,
  reasonCode: string,
): TimebankCancelParty {
  if (party === 'SERVICE_USER' || party === 'AGENCY' || party === 'OTHER')
    return party;
  if (reasonCode.startsWith('CLIENT_') || reasonCode === 'SERVICE_NOT_REQUIRED')
    return 'SERVICE_USER';
  if (reasonCode.startsWith('PROVIDER_')) return 'AGENCY';
  return 'OTHER';
}

/** Minutes a rota job uses of the weekly hours — same rule as the weekly hours limit. */
export function timebankJobMinutes(
  job: Pick<
    TimebankJob,
    'start' | 'end' | 'estimatedDurationMinutes' | 'requiredCarers'
  >,
): number {
  const minutes = job.end
    ? Math.round((job.end.getTime() - job.start.getTime()) / 60000)
    : (job.estimatedDurationMinutes ?? 0);
  return Math.max(0, minutes) * Math.max(1, job.requiredCarers ?? 1);
}

export function mondayOfOperationalIso(iso: string): string {
  const offset =
    (new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDaysToOperationalIso(iso, -offset);
}

/**
 * Weekly hours in force at `at`: the last saved value at or before it. Before the first saved
 * change, the value that change replaced (else the first value saved); with no history, `current`.
 */
export function timebankHoursAt(
  changes: TimebankHoursChange[],
  at: Date,
  current: number | null,
): number | null {
  if (!changes.length) return current;
  let found: TimebankHoursChange | null = null;
  for (const c of changes) {
    if (c.at.getTime() <= at.getTime()) found = c;
    else break;
  }
  if (found) return found.value;
  return changes[0].previous ?? changes[0].value;
}

/**
 * The lowest weekly hours in force at any time in [from, to): a week whose hours were cut is set at
 * the new hours (the visits over them were cancelled), and one whose hours went up stays at the old.
 */
export function timebankLowestHoursIn(
  changes: TimebankHoursChange[],
  from: Date,
  to: Date,
  current: number | null,
): number | null {
  let lowest = timebankHoursAt(changes, from, current);
  for (const c of changes) {
    const t = c.at.getTime();
    if (t <= from.getTime() || t >= to.getTime()) continue;
    if (lowest != null && c.value != null && c.value < lowest) lowest = c.value;
  }
  return lowest;
}

/**
 * Visits the system cancelled because the weekly hours were cut (visit-plan-date-changes
 * `applyHoursDecrease` writes reason OTHER with this note). The package got smaller; no care was lost.
 */
const HOURS_REDUCED_NOTE_PREFIX = 'Weekly contracted hours reduced to ';

export function timebankRemovedByHoursCut(
  cancellation: TimebankJob['cancellation'],
): boolean {
  return (
    cancellation?.reasonCode === 'OTHER' &&
    (cancellation.notes ?? '').startsWith(HOURS_REDUCED_NOTE_PREFIX)
  );
}

/**
 * Visits the system cancelled to take back the week before's over care (the over care service
 * writes reason OTHER with this note). The week's hours are lowered by the same amount.
 */
export const OVER_CARE_NOTE_PREFIX = 'Over care adjustment';

export function timebankRemovedForOverCare(
  cancellation: TimebankJob['cancellation'],
): boolean {
  return (
    cancellation?.reasonCode === 'OTHER' &&
    (cancellation.notes ?? '').startsWith(OVER_CARE_NOTE_PREFIX)
  );
}

/**
 * Every Monday–Sunday week from the start date's week to `lastWeekStart`, with the bank running
 * through the finished weeks in order.
 */
export function computeTimebankWeeks(params: {
  timeZone: string;
  now: Date;
  /** First day of service (org day). */
  startIso: string;
  lastWeekStart: string;
  jobs: TimebankJob[];
  recons: TimebankRecon[];
  hoursChanges: TimebankHoursChange[];
  currentWeeklyHours: number | null;
  specialVisitsCount: boolean;
  /** Org-day start instant of a Monday (weekly hours are read at the start of the week). */
  weekStartInstant: (mondayIso: string) => Date;
  /** Over care taken back the next week, for this service user. */
  overCare?: TimebankOverCare[];
}): TimebankWeek[] {
  const today = dayKeyInTimeZone(params.now, params.timeZone);
  const currentMonday = mondayOfOperationalIso(today);
  const firstMonday = mondayOfOperationalIso(params.startIso);

  const reconsByJob = new Map<string, TimebankRecon[]>();
  for (const r of params.recons) {
    const list = reconsByJob.get(r.scheduledJobId) ?? [];
    list.push(r);
    reconsByJob.set(r.scheduledJobId, list);
  }
  const jobsByWeek = new Map<string, TimebankJob[]>();
  for (const job of params.jobs) {
    if (job.special && !params.specialVisitsCount) continue;
    const day = dayKeyInTimeZone(job.start, params.timeZone);
    if (day < params.startIso) continue;
    const monday = mondayOfOperationalIso(day);
    const list = jobsByWeek.get(monday) ?? [];
    list.push(job);
    jobsByWeek.set(monday, list);
  }

  const weeks: TimebankWeek[] = [];
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

    const readAt =
      monday === firstMonday
        ? params.weekStartInstant(params.startIso)
        : params.weekStartInstant(monday);
    const weeklyHours = timebankLowestHoursIn(
      params.hoursChanges,
      readAt,
      params.weekStartInstant(addDaysToOperationalIso(monday, 7)),
      params.currentWeeklyHours,
    );
    const liveDays =
      monday === firstMonday ? daysBetween(params.startIso, sunday) + 1 : 7;
    const overCareAdjustment =
      params.overCare?.find((a) => a.overWeekStart === monday) ?? null;
    // Several over weeks can be taken back in one week (Over care reviews): their minutes add up.
    const takenBackRows =
      params.overCare?.filter((a) => a.adjustWeekStart === monday) ?? [];
    const overCareTakenBack: TimebankOverCare | null = takenBackRows.length
      ? {
          ...takenBackRows[0],
          takenBackMinutes: takenBackRows.reduce((s, a) => s + a.takenBackMinutes, 0),
        }
      : null;
    // A week taking back over care is set that much lower, so it is not short for it.
    const setMinutes = Math.max(
      0,
      (weeklyHours != null
        ? Math.round((weeklyHours * 60 * liveDays) / 7)
        : 0) - (overCareTakenBack?.takenBackMinutes ?? 0),
    );

    const week: TimebankWeek = {
      weekStart: monday,
      weekEnd: sunday,
      status,
      setMinutes,
      weeklyHours,
      createdMinutes: 0,
      deliveredMinutes: 0,
      invoicedMinutes: 0,
      pendingMinutes: 0,
      scheduledMinutes: 0,
      awaitingMinutes: 0,
      chargeableCancelMinutes: 0,
      freeMinutes: 0,
      overMinutes: 0,
      overCareMinutes: 0,
      addedToBankMinutes: 0,
      balanceMinutes: 0,
      visits: {
        created: 0,
        delivered: 0,
        pending: 0,
        scheduled: 0,
        awaiting: 0,
        cancelled: 0,
        missed: 0,
        chargeableCancelled: 0,
      },
      reasons: {
        cancelledByServiceUserMinutes: 0,
        cancelledByAgencyMinutes: 0,
        cancelledOtherMinutes: 0,
        missedMinutes: 0,
        shorterMinutes: 0,
        longerMinutes: 0,
        notBookedMinutes: 0,
      },
      shortVisits: [],
      allVisits: [],
      overCareAdjustment,
      overCareTakenBack,
    };
    const addShort = (v: TimebankShortVisit) => {
      week.shortVisits.push(v);
      const { reason, ...rest } = v;
      week.allVisits.push({ ...rest, outcome: reason, careNotDelivered: null });
    };

    let cancelledMinutes = 0;
    const jobs = (jobsByWeek.get(monday) ?? []).sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
    for (const job of jobs) {
      const planned = timebankJobMinutes(job);
      const base = {
        jobId: job.id,
        jobName: job.jobName,
        day: dayKeyInTimeZone(job.start, params.timeZone),
        start: job.start.toISOString(),
        end: job.end?.toISOString() ?? null,
        plannedMinutes: planned,
      };

      const overCareCut =
        job.status === ScheduledJobStatus.CANCELLED &&
        timebankRemovedForOverCare(job.cancellation);
      if (
        job.status === ScheduledJobStatus.CANCELLED &&
        (timebankRemovedByHoursCut(job.cancellation) || overCareCut)
      ) {
        // Not short: listed in the week only, outside every count.
        week.allVisits.push({
          ...base,
          deliveredMinutes: 0,
          pendingMinutes: 0,
          shortMinutes: 0,
          outcome: overCareCut ? 'REMOVED_OVER_CARE' : 'REMOVED_HOURS_REDUCED',
          cancelReasonCode: null,
          cancelReasonNotes: job.cancellation?.notes ?? null,
          careNotDelivered: null,
        });
        continue;
      }

      const chargeable = (counted: 'cancelled' | 'calledOff') => {
        if (counted === 'cancelled') cancelledMinutes += planned;
        week.chargeableCancelMinutes += planned;
        week.visits.chargeableCancelled += 1;
        addShort({
          ...base,
          deliveredMinutes: 0,
          pendingMinutes: 0,
          shortMinutes: 0,
          reason: 'CHARGEABLE_CANCELLATION',
          cancelReasonCode: job.cancellation?.reasonCode ?? null,
          cancelReasonNotes: job.cancellation?.notes ?? null,
          cancelNoticeHours: job.cancellation?.noticeHours ?? null,
          cancelledAs: counted === 'cancelled' ? 'CANCELLED' : 'CALLED_OFF',
          chargeNotes: job.cancellation?.chargeNotes ?? null,
        });
      };

      if (
        job.status === ScheduledJobStatus.CANCELLED &&
        job.cancellation?.chargeable
      ) {
        chargeable('cancelled');
        continue;
      }

      if (job.status === ScheduledJobStatus.CANCELLED) {
        const party = job.cancellation?.party ?? 'OTHER';
        cancelledMinutes += planned;
        week.visits.cancelled += 1;
        if (party === 'SERVICE_USER')
          week.reasons.cancelledByServiceUserMinutes += planned;
        else if (party === 'AGENCY')
          week.reasons.cancelledByAgencyMinutes += planned;
        else week.reasons.cancelledOtherMinutes += planned;
        addShort({
          ...base,
          deliveredMinutes: 0,
          pendingMinutes: 0,
          shortMinutes: planned,
          reason:
            party === 'SERVICE_USER'
              ? 'CANCELLED_BY_SERVICE_USER'
              : party === 'AGENCY'
                ? 'CANCELLED_BY_AGENCY'
                : 'CANCELLED_OTHER',
          cancelReasonCode: job.cancellation?.reasonCode ?? null,
          cancelReasonNotes: job.cancellation?.notes ?? null,
        });
        continue;
      }

      week.createdMinutes += planned;
      week.visits.created += 1;
      const rows = reconsByJob.get(job.id) ?? [];
      const delivered = rows
        .filter((r) => TIMEBANK_DELIVERED_RECON.includes(r.status))
        .reduce((s, r) => s + r.minutes, 0);
      const pending = rows
        .filter((r) => TIMEBANK_PENDING_RECON.includes(r.status))
        .reduce((s, r) => s + r.minutes, 0);
      const hasRows = rows.some(
        (r) =>
          TIMEBANK_DELIVERED_RECON.includes(r.status) ||
          TIMEBANK_PENDING_RECON.includes(r.status),
      );

      if (
        !hasRows &&
        job.status === ScheduledJobStatus.CALLED_OFF &&
        job.cancellation?.chargeable
      ) {
        // Called off and charged: on the rota (already counted as created), nothing short.
        chargeable('calledOff');
        continue;
      }

      if (!hasRows) {
        const ended = ENDED_JOB_STATUSES.includes(job.status);
        const finishAt =
          job.end ?? new Date(job.start.getTime() + planned * 60000);
        if (!ended && finishAt.getTime() > params.now.getTime()) {
          week.scheduledMinutes += planned;
          week.visits.scheduled += 1;
          week.allVisits.push({
            ...base,
            deliveredMinutes: 0,
            pendingMinutes: 0,
            shortMinutes: 0,
            outcome: 'SCHEDULED',
            cancelReasonCode: null,
            cancelReasonNotes: null,
            careNotDelivered: null,
          });
        } else if (rows.length === 0 && job.clockedIn && !ended) {
          week.awaitingMinutes += planned;
          week.visits.awaiting += 1;
          week.allVisits.push({
            ...base,
            deliveredMinutes: 0,
            pendingMinutes: 0,
            shortMinutes: 0,
            outcome: 'AWAITING_CLOCK_OUT',
            cancelReasonCode: null,
            cancelReasonNotes: null,
            careNotDelivered: null,
          });
        } else if (rows.length === 0) {
          week.reasons.missedMinutes += planned;
          week.visits.missed += 1;
          addShort({
            ...base,
            deliveredMinutes: 0,
            pendingMinutes: 0,
            shortMinutes: planned,
            reason:
              job.status === ScheduledJobStatus.CALLED_OFF
                ? 'CALLED_OFF'
                : 'MISSED',
            cancelReasonCode: null,
            cancelReasonNotes: null,
          });
        } else {
          // Every row was rejected: the visit happened but none of it was approved.
          week.reasons.shorterMinutes += planned;
          addShort({
            ...base,
            deliveredMinutes: 0,
            pendingMinutes: 0,
            shortMinutes: planned,
            reason: 'NOT_APPROVED',
            cancelReasonCode: null,
            cancelReasonNotes: null,
          });
        }
        continue;
      }

      if (job.careNotDelivered) {
        // "Unable to start": the whole planned time counts, in the container its approval puts it in.
        const approved = rows.some((r) =>
          TIMEBANK_DELIVERED_RECON.includes(r.status),
        );
        if (approved) {
          week.deliveredMinutes += planned;
          week.visits.delivered += 1;
          if (
            rows.some(
              (r) => r.invoiced && TIMEBANK_DELIVERED_RECON.includes(r.status),
            )
          ) {
            week.invoicedMinutes += planned;
          }
        } else {
          week.pendingMinutes += planned;
          week.visits.pending += 1;
        }
        week.allVisits.push({
          ...base,
          deliveredMinutes: approved ? planned : 0,
          pendingMinutes: approved ? 0 : planned,
          shortMinutes: 0,
          outcome: 'UNABLE_TO_START',
          cancelReasonCode: null,
          cancelReasonNotes: null,
          careNotDelivered: job.careNotDelivered,
        });
        continue;
      }

      week.deliveredMinutes += delivered;
      week.invoicedMinutes += rows
        .filter(
          (r) => r.invoiced && TIMEBANK_DELIVERED_RECON.includes(r.status),
        )
        .reduce((s, r) => s + r.minutes, 0);
      week.pendingMinutes += pending;
      if (delivered > 0) week.visits.delivered += 1;
      else week.visits.pending += 1;
      const diff = planned - delivered - pending;
      if (diff > 0) {
        week.reasons.shorterMinutes += diff;
        addShort({
          ...base,
          deliveredMinutes: delivered,
          pendingMinutes: pending,
          shortMinutes: diff,
          reason: 'SHORTER',
          cancelReasonCode: null,
          cancelReasonNotes: null,
        });
      } else {
        if (diff < 0) week.reasons.longerMinutes += -diff;
        week.allVisits.push({
          ...base,
          deliveredMinutes: delivered,
          pendingMinutes: pending,
          shortMinutes: 0,
          outcome: delivered > 0 ? 'DELIVERED' : 'PENDING',
          cancelReasonCode: null,
          cancelReasonNotes: null,
          careNotDelivered: null,
        });
      }
    }

    week.reasons.notBookedMinutes = Math.max(
      0,
      setMinutes - week.createdMinutes - cancelledMinutes,
    );
    const covered =
      week.deliveredMinutes +
      week.pendingMinutes +
      week.scheduledMinutes +
      week.awaitingMinutes +
      week.chargeableCancelMinutes;
    week.freeMinutes = Math.max(0, setMinutes - covered);
    week.overMinutes = Math.max(0, covered - setMinutes);
    // A charged cancellation counts as care given (10 Nov 2026), the same as in Over care reviews.
    const careGiven =
      week.deliveredMinutes +
      week.pendingMinutes +
      week.chargeableCancelMinutes +
      (status === 'complete' ? 0 : week.scheduledMinutes + week.awaitingMinutes);
    week.overCareMinutes = Math.max(0, careGiven - setMinutes);
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

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
