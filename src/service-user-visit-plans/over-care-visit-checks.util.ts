import { MedicationKind, MedicationRecordStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  dayKeyInTimeZone,
  formatHmInTimeZone,
} from '../common/utils/operational-day.util';
import { utcDayBounds } from '../scheduling/schedule-date-range.util';
import { loadVisitTaskPlacement } from '../visit-tasks/visit-task-window.util';
import {
  pickScheduleFromAssignment,
  visitTaskMatchesDay,
} from '../visit-tasks/visit-task-schedule.util';
import { isEmarMedicationPromptTask } from '../visit-tasks/visit-task-emar-prompt.sync';
import {
  VISIT_DUE_MEDICATION_SELECT,
  filterSchedulesDueOnVisit,
} from '../medications/medication-visit-due.util';

/**
 * What to check before cancelling a future visit (Over care reviews): a scheduled medicine due on
 * it, or a critical / time-critical task on it. Read only — the same rules as the carer app
 * (task placement by due time + weekday, medicine due in the visit's clock window), batched for
 * many visits, and never the eMAR prompt sync (that one writes).
 */
export type VisitCareChecks = {
  medicationDue: boolean;
  criticalTasks: string[];
  timeCriticalTasks: string[];
};

export type VisitCheckJob = {
  id: string;
  serviceUserId: string;
  start: Date;
  end: Date | null;
};

export async function loadVisitCareChecks(
  prisma: PrismaService,
  jobs: VisitCheckJob[],
  timeZone: string,
): Promise<Map<string, VisitCareChecks>> {
  const out = new Map<string, VisitCareChecks>(
    jobs.map((j) => [
      j.id,
      { medicationDue: false, criticalTasks: [], timeCriticalTasks: [] },
    ]),
  );
  if (!jobs.length) return out;
  const suIds = [...new Set(jobs.map((j) => j.serviceUserId))];

  const [{ byJob }, meds] = await Promise.all([
    loadVisitTaskPlacement(prisma, jobs, timeZone),
    prisma.serviceUserMedication.findMany({
      where: {
        serviceUserId: { in: suIds },
        deletedAt: null,
        status: MedicationRecordStatus.ACTIVE,
        medicationKind: { not: MedicationKind.PRN },
        schedules: {
          some: { deletedAt: null, isActive: true, dueTime: { not: null } },
        },
      },
      select: {
        serviceUserId: true,
        ...VISIT_DUE_MEDICATION_SELECT,
        schedules: {
          where: { deletedAt: null, isActive: true, dueTime: { not: null } },
          select: { dueTime: true, daysOfWeek: true },
        },
      },
    }),
  ]);

  const assignmentIds = [
    ...new Set([...byJob.values()].flat().map((p) => p.assignmentId)),
  ];
  const assignments = assignmentIds.length
    ? await prisma.serviceUserVisitTaskAssignment.findMany({
        where: { id: { in: assignmentIds } },
        select: {
          id: true,
          priority: true,
          timeCritical: true,
          daysOfWeek: true,
          scheduleFrequency: true,
          repeatEvery: true,
          repeatUnit: true,
          timeToleranceMinutes: true,
          monthlyDayMode: true,
          monthlyDaysOfMonth: true,
          monthlyPatternOrdinal: true,
          monthlyPatternWeekday: true,
          task: { select: { name: true, flagsJson: true } },
        },
      })
    : [];
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));

  for (const job of jobs) {
    const checks = out.get(job.id)!;
    const dayKey = dayKeyInTimeZone(job.start, timeZone);
    const visitDay = utcDayBounds(dayKey).start;
    for (const placed of byJob.get(job.id) ?? []) {
      const a = assignmentById.get(placed.assignmentId);
      if (!a || isEmarMedicationPromptTask(a.task)) continue;
      if (
        !visitTaskMatchesDay(pickScheduleFromAssignment(a), visitDay, visitDay)
      )
        continue;
      if (a.priority === 'critical') checks.criticalTasks.push(a.task.name);
      if (a.timeCritical) checks.timeCriticalTasks.push(a.task.name);
    }
    if (job.end) {
      const window = {
        startHm: formatHmInTimeZone(job.start, timeZone),
        endHm: formatHmInTimeZone(job.end, timeZone),
      };
      checks.medicationDue = meds.some(
        (m) =>
          m.serviceUserId === job.serviceUserId &&
          filterSchedulesDueOnVisit(m, dayKey, window).length > 0,
      );
    }
  }
  return out;
}
