import { MedicationKind, MedicationRecordStatus } from '@prisma/client';
import {
  dayKeyInTimeZone,
  formatHmInTimeZone,
  getOperationalTimeZone,
  operationalDayBounds,
} from '../common/utils/operational-day.util';
import type { PrismaService } from '../prisma/prisma.service';
import { dueTimeFallsInHmWindow } from '../service-user-visit-plans/visit-medication-window.util';
import { isEmarMedicationPromptTask } from './visit-task-emar-prompt.sync';

/**
 * Visit tasks attach to a visit by clock time, the same way scheduled medicines do:
 * a task shows on the visit whose window contains the task's dueTime.
 *
 * - Planned task: assignment.dueTime (falls back to the round's time when unset).
 * - eMAR "Medication prompt": shows wherever a scheduled dose of its round is due,
 *   so it always sits on the same visit as the medicines it prompts for.
 * - No visit window (missing end time): legacy behaviour — match by the visit's round code.
 */

export type VisitHmWindow = { startHm: string; endHm: string };

export type VisitTaskWindowContext = {
  /** Round code (upper) → round clock time HH:mm. */
  roundTimeByCode: Map<string, string>;
  /** `${serviceUserId}|${ROUND}` → scheduled (non-PRN) medicine due times. */
  medDueTimesBySuRound: Map<string, string[]>;
};

export type WindowMatchableAssignment = {
  serviceUserId: string;
  medicationRoundCode: string;
  dueTime?: string | null;
  task?: { name?: string | null; flagsJson?: unknown } | null;
};

export function visitHmWindow(
  start: Date | null | undefined,
  end: Date | null | undefined,
  timeZone: string,
): VisitHmWindow | null {
  if (!start || !end) return null;
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  return { startHm: formatHmInTimeZone(start, timeZone), endHm: formatHmInTimeZone(end, timeZone) };
}

/** Clock times at which this assignment is due (empty → never matches a window). */
export function visitTaskDueTimes(
  assignment: WindowMatchableAssignment,
  ctx: VisitTaskWindowContext,
): string[] {
  const round = assignment.medicationRoundCode.trim().toUpperCase();
  if (assignment.task && isEmarMedicationPromptTask(assignment.task)) {
    return ctx.medDueTimesBySuRound.get(`${assignment.serviceUserId}|${round}`) ?? [];
  }
  const own = assignment.dueTime?.trim() || ctx.roundTimeByCode.get(round);
  return own ? [own] : [];
}

export function visitTaskBelongsToVisit(
  assignment: WindowMatchableAssignment,
  window: VisitHmWindow | null,
  ctx: VisitTaskWindowContext,
  fallbackRoundCode: string | null,
): boolean {
  if (!window) {
    return (
      fallbackRoundCode != null &&
      assignment.medicationRoundCode.trim().toUpperCase() === fallbackRoundCode.trim().toUpperCase()
    );
  }
  return visitTaskDueTimes(assignment, ctx).some((t) =>
    dueTimeFallsInHmWindow(t, window.startHm, window.endHm),
  );
}

/**
 * Filter a service user's assignments down to those on this visit. A visit spanning two
 * rounds can match two "Medication prompt" rows — keep only the first so it shows once.
 */
export function selectVisitTaskAssignments<T extends WindowMatchableAssignment>(
  assignments: T[],
  window: VisitHmWindow | null,
  ctx: VisitTaskWindowContext,
  fallbackRoundCode: string | null,
): T[] {
  let promptKept = false;
  const out: T[] = [];
  for (const a of assignments) {
    if (!visitTaskBelongsToVisit(a, window, ctx, fallbackRoundCode)) continue;
    if (a.task && isEmarMedicationPromptTask(a.task)) {
      if (promptKept) continue;
      promptKept = true;
    }
    out.push(a);
  }
  return out;
}

export async function loadVisitTaskWindowContext(
  prisma: PrismaService,
  serviceUserIds: string[],
): Promise<VisitTaskWindowContext> {
  const [rounds, meds] = await Promise.all([
    prisma.medicationAdministrationRound.findMany({
      where: { deletedAt: null, isActive: true },
      select: { code: true, time: true },
    }),
    serviceUserIds.length
      ? prisma.serviceUserMedication.findMany({
          where: {
            serviceUserId: { in: serviceUserIds },
            deletedAt: null,
            isActive: true,
            status: MedicationRecordStatus.ACTIVE,
            medicationKind: { not: MedicationKind.PRN },
          },
          select: {
            serviceUserId: true,
            schedules: {
              where: { deletedAt: null, isActive: true, dueTime: { not: null } },
              select: { dueTime: true, round: { select: { code: true } } },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const roundTimeByCode = new Map(
    rounds.filter((r) => r.time?.trim()).map((r) => [r.code.trim().toUpperCase(), r.time.trim()]),
  );
  const medDueTimesBySuRound = new Map<string, string[]>();
  for (const med of meds) {
    for (const s of med.schedules) {
      const code = s.round?.code?.trim().toUpperCase();
      const due = s.dueTime?.trim();
      if (!code || !due) continue;
      const key = `${med.serviceUserId}|${code}`;
      const list = medDueTimesBySuRound.get(key) ?? [];
      list.push(due);
      medDueTimesBySuRound.set(key, list);
    }
  }
  return { roundTimeByCode, medDueTimesBySuRound };
}

/** Org operational timezone for services that don't inject OrganisationGeneralSettingsService. */
export async function loadOperationalTimeZone(prisma: PrismaService): Promise<string> {
  const row = await prisma.organisationGeneralSettings.findFirst({ select: { timezone: true } });
  return getOperationalTimeZone(row?.timezone);
}

// ---------------------------------------------------------------------------
// Day placement: every planned task belongs to exactly ONE visit of the client's day.
// ---------------------------------------------------------------------------

export type PlacementVisit = {
  jobId: string;
  window: VisitHmWindow;
  /** Epoch ms of the visit start — orders visits and breaks ties (earlier wins). */
  startMs: number;
  /** Cancelled / called-off visit: keeps its tasks (they are not moved) but they won't be done. */
  cancelled?: boolean;
};

export type TaskPlacement = {
  assignmentId: string;
  /** Due time used for placement (HH:mm); null for the eMAR prompt. */
  dueTime: string | null;
  /** True when no visit covers the due time and the task was moved to the nearest visit. */
  nearest: boolean;
  /** The visit this task belongs to was cancelled / called off — not done, not moved. */
  visitCancelled?: boolean;
};

const MINUTES_PER_DAY = 24 * 60;

function hmToMinutes(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes from window start to t, going forward round the clock (0 = at start). */
function minutesSinceStart(t: number, start: number): number {
  return (t - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function windowLength(start: number, end: number): number {
  return end >= start ? end - start : end + MINUTES_PER_DAY - start;
}

/** Distance in minutes from t to the window (0 when inside). Same day — no wrap past midnight. */
function distanceToWindow(t: number, start: number, end: number): number {
  if (end >= start) {
    if (t < start) return start - t;
    if (t > end) return t - end;
    return 0;
  }
  // Overnight window (e.g. 22:00–07:00): outside part is (end, start).
  if (t >= start || t <= end) return 0;
  return Math.min(t - end, start - t);
}

/**
 * Place a client's planned tasks onto that day's visits:
 * 1. A visit whose window contains the due time gets it. If several do (back-to-back
 *    6–7 and 7–8 with a 07:00 task, or overlapping visits), the one that started latest wins,
 *    so the task appears once.
 * 2. No visit covers it → the nearest visit by minutes (tie → earlier visit), flagged `nearest`,
 *    but only when that visit is within `graceMinutes` of the due time (null = no limit).
 *    Beyond the grace the task is left unplaced for that day.
 * Cancelled / called-off visits still take part: a task that belongs to a cancelled visit stays
 * with it (flagged `visitCancelled`) instead of moving to another visit. When a live and a
 * cancelled visit both qualify (e.g. a replacement visit at the same time), the live one wins.
 * eMAR "Medication prompt" rows are not placed here — they follow medicine due times per visit.
 */
export function placeVisitTasksForDay<T extends WindowMatchableAssignment & { id: string }>(
  assignments: T[],
  visits: PlacementVisit[],
  ctx: VisitTaskWindowContext,
  graceMinutes: number | null = null,
): Map<string, TaskPlacement[]> {
  const out = new Map<string, TaskPlacement[]>(visits.map((v) => [v.jobId, []]));
  const timed = visits
    .map((v) => {
      const start = hmToMinutes(v.window.startHm);
      const end = hmToMinutes(v.window.endHm);
      return start == null || end == null ? null : { ...v, start, end };
    })
    .filter((v): v is NonNullable<typeof v> => v != null)
    .sort((a, b) => a.startMs - b.startMs);
  if (timed.length === 0) return out;

  for (const a of assignments) {
    if (a.task && isEmarMedicationPromptTask(a.task)) continue;
    const due = visitTaskDueTimes(a, ctx)[0];
    const t = due ? hmToMinutes(due) : null;
    if (t == null) continue;

    const covering = timed.filter((v) => {
      if (v.start === v.end) return t === v.start;
      return minutesSinceStart(t, v.start) <= windowLength(v.start, v.end);
    });
    let chosen: (typeof timed)[number];
    let nearest = false;
    if (covering.length > 0) {
      const liveCovering = covering.filter((v) => !v.cancelled);
      const pool = liveCovering.length > 0 ? liveCovering : covering;
      chosen = pool.reduce((best, v) =>
        minutesSinceStart(t, v.start) < minutesSinceStart(t, best.start) ? v : best,
      );
    } else {
      nearest = true;
      chosen = timed.reduce((best, v) => {
        const dv = distanceToWindow(t, v.start, v.end);
        const db = distanceToWindow(t, best.start, best.end);
        if (dv !== db) return dv < db ? v : best;
        // Same distance: prefer a live visit over a cancelled one; otherwise keep the earlier.
        return best.cancelled && !v.cancelled ? v : best;
      });
      if (graceMinutes != null && distanceToWindow(t, chosen.start, chosen.end) > graceMinutes) {
        continue;
      }
    }
    out.get(chosen.jobId)!.push({
      assignmentId: a.id,
      dueTime: due ?? null,
      nearest,
      visitCancelled: Boolean(chosen.cancelled),
    });
  }
  return out;
}

/** Visit statuses whose tasks stay with the visit but won't be done ("visit cancelled"). */
export const CANCELLED_JOB_STATUSES = ['CANCELLED', 'CALLED_OFF'] as const;

export function isCancelledJobStatus(status: string | null | undefined): boolean {
  return (CANCELLED_JOB_STATUSES as readonly string[]).includes(String(status ?? ''));
}

export type TaskPlacementJob = {
  id: string;
  serviceUserId: string;
  start: Date;
  end: Date | null;
};

/**
 * Task placement for the given visits. Loads every other visit of the same client on the same
 * operational day (cancelled / called-off visits included, so their tasks stay with them) so
 * "nearest visit" is chosen across the whole day, and returns the placed tasks per requested job —
 * planned tasks by the day rule above plus the eMAR prompt where a scheduled dose of its round is due.
 */
export async function loadVisitTaskPlacement(
  prisma: PrismaService,
  jobs: TaskPlacementJob[],
  timeZone: string,
): Promise<{
  byJob: Map<string, TaskPlacement[]>;
  ctx: VisitTaskWindowContext;
}> {
  const byJob = new Map<string, TaskPlacement[]>(jobs.map((j) => [j.id, []]));
  if (jobs.length === 0) {
    return { byJob, ctx: { roundTimeByCode: new Map(), medDueTimesBySuRound: new Map() } };
  }
  const suIds = [...new Set(jobs.map((j) => j.serviceUserId))];
  const dayKeys = [...new Set(jobs.map((j) => dayKeyInTimeZone(j.start, timeZone)))];
  const bounds = dayKeys.map((d) => operationalDayBounds(d, timeZone));

  const [assignments, ctx, siblings, graceRows] = await Promise.all([
    prisma.serviceUserVisitTaskAssignment.findMany({
      where: { serviceUserId: { in: suIds }, deletedAt: null, isActive: true },
      select: {
        id: true,
        serviceUserId: true,
        medicationRoundCode: true,
        dueTime: true,
        task: { select: { name: true, flagsJson: true } },
      },
    }),
    loadVisitTaskWindowContext(prisma, suIds),
    prisma.scheduledJob.findMany({
      where: {
        serviceUserId: { in: suIds },
        deletedAt: null,
        isActive: true,
        OR: bounds.map((b) => ({ scheduledStartDateTime: { gte: b.start, lte: b.end } })),
      },
      select: {
        id: true,
        serviceUserId: true,
        status: true,
        scheduledStartDateTime: true,
        scheduledEndDateTime: true,
        visits: {
          where: { deletedAt: null, isActive: true },
          orderBy: { scheduledStartDateTime: 'asc' },
          take: 1,
          select: { scheduledStartDateTime: true, scheduledEndDateTime: true },
        },
      },
    }),
    prisma.serviceUser.findMany({
      where: { id: { in: suIds } },
      select: { id: true, taskNearestVisitGraceMinutes: true },
    }),
  ]);
  const graceBySu = new Map(graceRows.map((r) => [r.id, r.taskNearestVisitGraceMinutes]));

  const cancelledJobIds = new Set(siblings.filter((s) => isCancelledJobStatus(s.status)).map((s) => s.id));

  // Group the client's visits (cancelled ones flagged) by operational day.
  const dayVisits = new Map<string, PlacementVisit[]>();
  for (const s of siblings) {
    const start = s.visits[0]?.scheduledStartDateTime ?? s.scheduledStartDateTime;
    const end = s.visits[0]?.scheduledEndDateTime ?? s.scheduledEndDateTime ?? start;
    const key = `${s.serviceUserId}|${dayKeyInTimeZone(start, timeZone)}`;
    const window = visitHmWindow(start, end, timeZone);
    if (!window) continue;
    const list = dayVisits.get(key) ?? [];
    list.push({
      jobId: s.id,
      window,
      startMs: start.getTime(),
      cancelled: isCancelledJobStatus(s.status),
    });
    dayVisits.set(key, list);
  }

  const assignmentsBySu = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = assignmentsBySu.get(a.serviceUserId) ?? [];
    list.push(a);
    assignmentsBySu.set(a.serviceUserId, list);
  }

  const placedByDay = new Map<string, Map<string, TaskPlacement[]>>();
  for (const job of jobs) {
    const key = `${job.serviceUserId}|${dayKeyInTimeZone(job.start, timeZone)}`;
    let placed = placedByDay.get(key);
    if (!placed) {
      placed = placeVisitTasksForDay(
        assignmentsBySu.get(job.serviceUserId) ?? [],
        dayVisits.get(key) ?? [],
        ctx,
        graceBySu.get(job.serviceUserId) ?? null,
      );
      placedByDay.set(key, placed);
    }
    const list = [...(placed.get(job.id) ?? [])];

    // eMAR prompt: one per visit, wherever a scheduled dose of its round is due.
    const window = visitHmWindow(job.start, job.end ?? job.start, timeZone);
    const prompts = (assignmentsBySu.get(job.serviceUserId) ?? []).filter(
      (a) => a.task && isEmarMedicationPromptTask(a.task),
    );
    const prompt = selectVisitTaskAssignments(prompts, window, ctx, null)[0];
    if (prompt) {
      // Label the prompt with the first dose of its round due in this visit (not the row's time).
      const doseTimes = window
        ? visitTaskDueTimes(prompt, ctx)
            .filter((t) => dueTimeFallsInHmWindow(t, window.startHm, window.endHm))
            .sort()
        : [];
      list.unshift({
        assignmentId: prompt.id,
        dueTime: doseTimes[0] ?? null,
        nearest: false,
        visitCancelled: cancelledJobIds.has(job.id),
      });
    }

    byJob.set(job.id, list);
  }
  return { byJob, ctx };
}

/** Minutes from a due time to the closest of these visits (0 if one covers it); null if none. */
export function nearestVisitGapMinutes(dueTime: string, visits: PlacementVisit[]): number | null {
  const t = hmToMinutes(dueTime);
  if (t == null) return null;
  let best: number | null = null;
  for (const v of visits) {
    const start = hmToMinutes(v.window.startHm);
    const end = hmToMinutes(v.window.endHm);
    if (start == null || end == null) continue;
    const gap = start === end ? Math.abs(t - start) : distanceToWindow(t, start, end);
    if (best == null || gap < best) best = gap;
  }
  return best;
}
