import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ReplaceServiceUserVisitTasksDto } from './dto/replace-service-user-visit-tasks.dto';
import {
  mergeVisitTaskSchedule,
  pickScheduleFromAssignment,
  visitTaskMatchesDay,
  type VisitTaskScheduleShape,
} from '../visit-tasks/visit-task-schedule.util';
import { UpdateServiceUserVisitTaskSettingsDto } from './dto/update-visit-task-settings.dto';
import {
  dayKeyInTimeZone,
  operationalDayBounds,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import {
  isCancelledJobStatus,
  loadOperationalTimeZone,
  loadVisitTaskWindowContext,
  nearestVisitGapMinutes,
  placeVisitTasksForDay,
  visitHmWindow,
  visitTaskDueTimes,
  type PlacementVisit,
} from '../visit-tasks/visit-task-window.util';
import {
  isEmarMedicationPromptTask,
  syncEmarMedicationPromptsForServiceUser,
} from '../visit-tasks/visit-task-emar-prompt.sync';
import { catalogueFeedsBodyMap } from '../employee-app/visit-task-obs-link.util';
import { IDENTITY_ROLE } from '../common/org-scope/org-scope.types';

type VisitLinkSummary = {
  dueDays: number;
  linkedDays: number;
  /** Due days with no live visit created. */
  noVisitDays: number;
  /** Due days with visits, but none covers the time and the nearest is beyond the grace. */
  beyondGraceDays: number;
  /** Due days where the task's visit was cancelled / called off (task not done, not moved). */
  cancelledDays: number;
};

/** How many days ahead (from today) the planner warns about days with tasks but no visit. */
const UPCOMING_COVERAGE_DAYS = 7;

const assignmentInclude = {
  task: {
    include: {
      category: {
        include: {
          group: true,
        },
      },
    },
  },
  createdBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      username: true,
    },
  },
} satisfies Prisma.ServiceUserVisitTaskAssignmentInclude;

function userDisplayName(
  user:
    | {
        firstName: string | null;
        lastName: string | null;
        email: string;
        username: string | null;
      }
    | null
    | undefined,
): string | null {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email || user.username || null;
}

function normalizeInstructions(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

const VISIT_TASK_PRIORITY_CODES = new Set(['routine', 'important', 'critical']);

function normalizePriority(value: string | null | undefined): string {
  const code = value?.trim().toLowerCase() ?? 'routine';
  return VISIT_TASK_PRIORITY_CODES.has(code) ? code : 'routine';
}

@Injectable()
export class ServiceUserVisitTasksService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureServiceUser(serviceUserId: string) {
    const row = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Service user not found');
  }

  /** Temporary fallback for legacy visit tasks created before createdBy was stored. */
  private async resolveSuperAdminFallback(): Promise<{
    id: string;
    name: string;
  } | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        userRoles: {
          some: {
            role: { name: IDENTITY_ROLE.SUPER_ADMIN, deletedAt: null, isActive: true },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        username: true,
      },
    });
    if (!user) return null;
    return {
      id: user.id,
      name: userDisplayName(user) || 'Super Admin',
    };
  }

  async list(serviceUserId: string, actorUserId?: string | null) {
    await this.ensureServiceUser(serviceUserId);

    const sync = await syncEmarMedicationPromptsForServiceUser(
      this.prisma,
      serviceUserId,
      actorUserId,
    );

    const [assignments, rounds, superAdmin] = await Promise.all([
      this.prisma.serviceUserVisitTaskAssignment.findMany({
        where: { serviceUserId, deletedAt: null, isActive: true },
        orderBy: [
          { medicationRoundCode: 'asc' },
          { sortOrder: 'asc' },
          { createdAt: 'asc' },
        ],
        include: assignmentInclude,
      }),
      this.prisma.medicationAdministrationRound.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          code: true,
          time: true,
          windowStart: true,
          windowEnd: true,
          sortOrder: true,
        },
      }),
      this.resolveSuperAdminFallback(),
    ]);
    const [defaultDueTimeByRound, settings] = await Promise.all([
      this.defaultDueTimeByRound(serviceUserId),
      this.prisma.serviceUser.findUnique({
        where: { id: serviceUserId },
        select: { taskNearestVisitGraceMinutes: true },
      }),
    ]);
    const coverage = await this.upcomingTaskCoverage(
      serviceUserId,
      settings?.taskNearestVisitGraceMinutes ?? null,
      assignments,
    );

    const byRound = new Map<string, ReturnType<typeof this.mapAssignment>[]>();
    for (const assignment of assignments) {
      const code = assignment.medicationRoundCode;
      const list = byRound.get(code) ?? [];
      list.push(this.mapAssignment(assignment, superAdmin));
      byRound.set(code, list);
    }

    return {
      data: {
        rounds,
        assignmentsByRound: Object.fromEntries(byRound),
        /** Pre-fill for a new task's due time: this client's slot start for the round, else round time. */
        defaultDueTimeByRound: Object.fromEntries(defaultDueTimeByRound),
        /** No visit covers a task → nearest visit only within this many minutes (null = no limit). */
        nearestVisitGraceMinutes: settings?.taskNearestVisitGraceMinutes ?? null,
        /** Next 7 days with tasks due but no live visit created — those tasks reach no carer. */
        daysWithoutVisit: coverage.daysWithoutVisit,
        /** Next 7 days: tasks on days with visits that no visit covers and none is within grace. */
        unplacedTasks: coverage.unplacedTasks,
        /** Per task (assignment id), next 7 days: due days vs days it reaches a visit. */
        visitLinkByAssignment: coverage.linkByAssignment,
        emarPrompt: {
          medicationCountByRound: sync.medicationCountByRound,
          addedRoundCodes: sync.added,
          removedRoundCodes: sync.removed,
        },
      },
    };
  }

  async replace(
    userId: string,
    serviceUserId: string,
    dto: ReplaceServiceUserVisitTasksDto,
    meta?: RequestAuditMeta,
  ) {
    void meta;
    await this.ensureServiceUser(serviceUserId);

    const desired = new Map<
      string,
      Array<{
        taskCatalogueTaskId: string;
        carerInstructions: string | null;
        priority: string;
        schedule: VisitTaskScheduleShape;
        bodyMapRequired: boolean | undefined;
        dueTime: string | null;
      }>
    >();
    for (const round of dto.rounds) {
      const code = round.medicationRoundCode.trim().toUpperCase();
      if (!code) continue;
      const seen = new Set<string>();
      const items: Array<{
        taskCatalogueTaskId: string;
        carerInstructions: string | null;
        priority: string;
        schedule: VisitTaskScheduleShape;
        bodyMapRequired: boolean | undefined;
        dueTime: string | null;
      }> = [];
      for (const task of round.tasks) {
        if (seen.has(task.taskCatalogueTaskId)) continue;
        seen.add(task.taskCatalogueTaskId);
        items.push({
          taskCatalogueTaskId: task.taskCatalogueTaskId,
          carerInstructions: normalizeInstructions(task.carerInstructions),
          priority: normalizePriority(task.priority),
          schedule: mergeVisitTaskSchedule(task.schedule ?? null),
          bodyMapRequired: task.bodyMapRequired,
          dueTime: task.dueTime?.trim() || null,
        });
      }
      desired.set(code, items);
    }

    const taskIds = [
      ...new Set(
        dto.rounds.flatMap((round) => round.tasks.map((task) => task.taskCatalogueTaskId)),
      ),
    ];
    const catalogueRows =
      taskIds.length > 0
        ? await this.prisma.taskCatalogueTask.findMany({
            where: { id: { in: taskIds }, deletedAt: null, isActive: true },
            select: { id: true, flagsJson: true },
          })
        : [];
    if (catalogueRows.length !== taskIds.length) {
      throw new NotFoundException('One or more catalogue tasks were not found');
    }
    const feedsBodyMapById = new Map(
      catalogueRows.map((row) => [row.id, catalogueFeedsBodyMap(row.flagsJson)]),
    );

    const defaultDueTimeByRound = await this.defaultDueTimeByRound(serviceUserId);

    await this.prisma.$transaction(async (tx) => {
      // 24 Aug 2026: re-adding a removed task hit unique (serviceUser + slot + catalogue).
      // Soft-deleted rows were ignored so create() failed — include them and reactivate.
      const existing = await tx.serviceUserVisitTaskAssignment.findMany({
        where: { serviceUserId },
      });

      const existingByKey = new Map(
        existing.map((row) => [`${row.medicationRoundCode}:${row.taskCatalogueTaskId}`, row]),
      );

      const keepIds = new Set<string>();

      for (const [roundCode, items] of desired.entries()) {
        let sortOrder = 0;
        for (const item of items) {
          const key = `${roundCode}:${item.taskCatalogueTaskId}`;
          const prev = existingByKey.get(key);
          const scheduleData = {
            daysOfWeek: item.schedule.daysOfWeek,
            scheduleFrequency: item.schedule.scheduleFrequency,
            repeatEvery: item.schedule.repeatEvery,
            repeatUnit: item.schedule.repeatUnit,
            timeCritical: item.schedule.timeCritical,
            timeToleranceMinutes: item.schedule.timeToleranceMinutes,
            monthlyDayMode: item.schedule.monthlyDayMode,
            monthlyDaysOfMonth: item.schedule.monthlyDaysOfMonth,
            monthlyPatternOrdinal: item.schedule.monthlyPatternOrdinal,
            monthlyPatternWeekday: item.schedule.monthlyPatternWeekday,
          };
          const bodyMapRequired =
            item.bodyMapRequired !== undefined
              ? Boolean(item.bodyMapRequired)
              : prev != null
                ? prev.bodyMapRequired
                : Boolean(feedsBodyMapById.get(item.taskCatalogueTaskId));
          // Task attaches to the visit whose window contains this time (like medicines).
          const dueTime =
            item.dueTime ?? prev?.dueTime ?? defaultDueTimeByRound.get(roundCode) ?? null;
          if (prev) {
            await tx.serviceUserVisitTaskAssignment.update({
              where: { id: prev.id },
              data: {
                isActive: true,
                deletedAt: null,
                sortOrder,
                carerInstructions: item.carerInstructions,
                priority: item.priority,
                bodyMapRequired,
                dueTime,
                ...scheduleData,
                updatedById: userId,
              },
            });
            keepIds.add(prev.id);
          } else {
            const created = await tx.serviceUserVisitTaskAssignment.create({
              data: {
                serviceUserId,
                medicationRoundCode: roundCode,
                taskCatalogueTaskId: item.taskCatalogueTaskId,
                sortOrder,
                carerInstructions: item.carerInstructions,
                priority: item.priority,
                bodyMapRequired,
                dueTime,
                ...scheduleData,
                createdById: userId,
                updatedById: userId,
              },
            });
            keepIds.add(created.id);
          }
          sortOrder += 1;
        }
      }

      const toDeactivate = existing.filter(
        (row) => !keepIds.has(row.id) && row.deletedAt == null,
      );
      if (toDeactivate.length > 0) {
        await tx.serviceUserVisitTaskAssignment.updateMany({
          where: { id: { in: toDeactivate.map((row) => row.id) } },
          data: {
            isActive: false,
            deletedAt: new Date(),
            updatedById: userId,
          },
        });
      }
    });

    // Re-apply eMAR prompts after replace so slots with scheduled meds always keep one prompt.
    return this.list(serviceUserId, userId);
  }

  async updateSettings(
    userId: string,
    serviceUserId: string,
    dto: UpdateServiceUserVisitTaskSettingsDto,
  ) {
    await this.ensureServiceUser(serviceUserId);
    if (dto.nearestVisitGraceMinutes !== undefined) {
      await this.prisma.serviceUser.update({
        where: { id: serviceUserId },
        data: { taskNearestVisitGraceMinutes: dto.nearestVisitGraceMinutes, updatedById: userId },
      });
    }
    return this.list(serviceUserId, userId);
  }

  /**
   * Next week (org timezone, from today), planned tasks that will reach no carer:
   * - daysWithoutVisit: days with tasks due but no visit at all;
   * - cancelled visits keep their tasks (counted as cancelledDays, not moved);
   * - unplacedTasks: on days that do have visits, tasks no visit covers and whose nearest visit is
   *   beyond the client's grace minutes.
   */
  private async upcomingTaskCoverage(
    serviceUserId: string,
    graceMinutes: number | null,
    assignments: Array<
      Parameters<typeof pickScheduleFromAssignment>[0] & {
        id: string;
        serviceUserId: string;
        medicationRoundCode: string;
        dueTime: string | null;
        task: { name: string; flagsJson: Prisma.JsonValue };
      }
    >,
  ): Promise<{
    daysWithoutVisit: Array<{ date: string; taskCount: number }>;
    unplacedTasks: Array<{
      date: string;
      assignmentId: string;
      taskName: string;
      medicationRoundCode: string;
      dueTime: string | null;
      nearestGapMinutes: number | null;
    }>;
    /**
     * Per task over the next week: days it is due, days it reaches a visit, and why not on the
     * rest (no visit that day / nearest visit beyond the grace).
     */
    linkByAssignment: Record<string, VisitLinkSummary>;
  }> {
    const planned = assignments.filter((a) => !isEmarMedicationPromptTask(a.task));
    if (planned.length === 0) {
      return { daysWithoutVisit: [], unplacedTasks: [], linkByAssignment: {} };
    }
    const linkByAssignment: Record<string, VisitLinkSummary> = {};
    for (const a of planned) {
      linkByAssignment[a.id] = {
        dueDays: 0,
        linkedDays: 0,
        noVisitDays: 0,
        beyondGraceDays: 0,
        cancelledDays: 0,
      };
    }
    const timeZone = await loadOperationalTimeZone(this.prisma);
    const today = operationalTodayIso(new Date(), timeZone);
    const days = Array.from({ length: UPCOMING_COVERAGE_DAYS }, (_, i) => {
      const d = new Date(`${today}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
    const first = operationalDayBounds(days[0], timeZone);
    const last = operationalDayBounds(days[days.length - 1], timeZone);
    const [jobs, ctx] = await Promise.all([
      this.prisma.scheduledJob.findMany({
        where: {
          serviceUserId,
          deletedAt: null,
          isActive: true,
          scheduledStartDateTime: { gte: first.start, lte: last.end },
        },
        select: {
          id: true,
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
      loadVisitTaskWindowContext(this.prisma, [serviceUserId]),
    ]);

    // Tasks already done on a visit that was later cancelled count as done, not "cancelled".
    const cancelledJobIds = jobs.filter((j) => isCancelledJobStatus(j.status)).map((j) => j.id);
    const doneOnCancelled = new Set(
      cancelledJobIds.length
        ? (
            await this.prisma.scheduledVisitTaskCompletion.findMany({
              where: {
                scheduledJobId: { in: cancelledJobIds },
                assignmentId: { not: null },
                isCompleted: true,
              },
              select: { scheduledJobId: true, assignmentId: true },
            })
          ).map((c) => `${c.scheduledJobId}:${c.assignmentId}`)
        : [],
    );

    const visitsByDay = new Map<string, PlacementVisit[]>();
    for (const j of jobs) {
      const start = j.visits[0]?.scheduledStartDateTime ?? j.scheduledStartDateTime;
      const end = j.visits[0]?.scheduledEndDateTime ?? j.scheduledEndDateTime ?? start;
      const window = visitHmWindow(start, end, timeZone);
      if (!window) continue;
      const key = dayKeyInTimeZone(start, timeZone);
      const list = visitsByDay.get(key) ?? [];
      list.push({
        jobId: j.id,
        window,
        startMs: start.getTime(),
        cancelled: isCancelledJobStatus(j.status),
      });
      visitsByDay.set(key, list);
    }

    const daysWithoutVisit: Array<{ date: string; taskCount: number }> = [];
    const unplacedTasks: Array<{
      date: string;
      assignmentId: string;
      taskName: string;
      medicationRoundCode: string;
      dueTime: string | null;
      nearestGapMinutes: number | null;
    }> = [];
    for (const day of days) {
      const dayDate = new Date(`${day}T00:00:00.000Z`);
      const due = planned.filter((a) =>
        visitTaskMatchesDay(pickScheduleFromAssignment(a), dayDate, dayDate),
      );
      if (due.length === 0) continue;
      for (const a of due) linkByAssignment[a.id].dueDays += 1;
      const visits = visitsByDay.get(day) ?? [];
      if (visits.length === 0) {
        daysWithoutVisit.push({ date: day, taskCount: due.length });
        for (const a of due) linkByAssignment[a.id].noVisitDays += 1;
        continue;
      }
      const placements = new Map(
        [...placeVisitTasksForDay(due, visits, ctx, graceMinutes).entries()].flatMap(
          ([jobId, list]) => list.map((p) => [p.assignmentId, { ...p, jobId }] as const),
        ),
      );
      for (const a of due) {
        const placed = placements.get(a.id);
        if (placed?.visitCancelled && !doneOnCancelled.has(`${placed.jobId}:${a.id}`)) {
          linkByAssignment[a.id].cancelledDays += 1;
          continue;
        }
        if (placed) {
          linkByAssignment[a.id].linkedDays += 1;
          continue;
        }
        linkByAssignment[a.id].beyondGraceDays += 1;
        const dueTime = visitTaskDueTimes(a, ctx)[0] ?? null;
        unplacedTasks.push({
          date: day,
          assignmentId: a.id,
          taskName: a.task.name,
          medicationRoundCode: a.medicationRoundCode,
          dueTime,
          nearestGapMinutes: dueTime ? nearestVisitGapMinutes(dueTime, visits) : null,
        });
      }
    }
    return { daysWithoutVisit, unplacedTasks, linkByAssignment };
  }

  /**
   * Default due time per round for this client: start of their own active visit-plan slot
   * for that round (earliest), else the round's clock time. Same rule as the migration backfill.
   */
  private async defaultDueTimeByRound(serviceUserId: string): Promise<Map<string, string>> {
    const [rounds, slots] = await Promise.all([
      this.prisma.medicationAdministrationRound.findMany({
        where: { deletedAt: null, isActive: true },
        select: { code: true, time: true },
      }),
      this.prisma.visitPlanSlot.findMany({
        where: { visitPlan: { serviceUserId, status: 'ACTIVE', deletedAt: null } },
        select: { slotCode: true, medicationRoundCode: true, plannedStartTime: true },
        orderBy: { plannedStartTime: 'asc' },
      }),
    ]);
    const out = new Map<string, string>();
    for (const slot of slots) {
      const code = (slot.medicationRoundCode ?? slot.slotCode)?.trim().toUpperCase();
      if (code && slot.plannedStartTime && !out.has(code)) out.set(code, slot.plannedStartTime);
    }
    for (const r of rounds) {
      const code = r.code.trim().toUpperCase();
      if (!out.has(code) && r.time?.trim()) out.set(code, r.time.trim());
    }
    return out;
  }

  private mapAssignment(
    row: Prisma.ServiceUserVisitTaskAssignmentGetPayload<{ include: typeof assignmentInclude }>,
    superAdminFallback?: { id: string; name: string } | null,
  ) {
    const createdByName = userDisplayName(row.createdBy);
    const useFallback = !row.createdById || !createdByName;
    return {
      id: row.id,
      medicationRoundCode: row.medicationRoundCode,
      sortOrder: row.sortOrder,
      carerInstructions: row.carerInstructions,
      bodyMapRequired: Boolean(row.bodyMapRequired),
      priority: row.priority,
      dueTime: row.dueTime,
      schedule: pickScheduleFromAssignment(row),
      createdAt: row.createdAt.toISOString(),
      createdById: useFallback
        ? (superAdminFallback?.id ?? row.createdById ?? null)
        : row.createdById,
      createdByName: useFallback
        ? (superAdminFallback?.name ?? 'Super Admin')
        : createdByName,
      isEmarPrompt: isEmarMedicationPromptTask({
        name: row.task.name,
        flagsJson: row.task.flagsJson,
      }),
      task: {
        id: row.task.id,
        name: row.task.name,
        categoryId: row.task.categoryId,
        categoryName: row.task.category.name,
        groupCode: row.task.category.group.code,
        supportLevelApplicable: row.task.supportLevelApplicable,
        consentRequired: row.task.consentRequired,
        competencyGated: row.task.competencyGated,
        competency: row.task.competency,
        outOfScope: row.task.outOfScope,
        requiresMultipleCarers: row.task.requiresMultipleCarers,
        flagsJson: row.task.flagsJson,
      },
    };
  }
}
