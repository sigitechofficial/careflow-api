import { resolveJobMedicationRoundCode } from '../scheduled-jobs-housekeeping/visit-job-tasks.util';

export type VisitTaskProgress = {
  completed: number;
  total: number;
};

type JobForTaskProgress = {
  id: string;
  serviceUserId: string;
  visits: Array<{
    visitPlanSlot: { slotCode: string; medicationRoundCode: string | null } | null;
  }>;
};

type AssignmentRow = {
  id: string;
  serviceUserId: string;
  medicationRoundCode: string;
};

type CompletionRow = {
  scheduledJobId: string;
  assignmentId: string | null;
  isCompleted: boolean;
};

/**
 * Shared Home / Details / client-detail task progress.
 * Must match visit-task list semantics: planned assignments + all ad-hoc rows.
 */
export function computeVisitTaskProgress(input: {
  plannedAssignmentIds: string[];
  completions: Array<{ assignmentId: string | null; isCompleted: boolean }>;
}): VisitTaskProgress {
  const completedAssignmentIds = new Set(
    input.completions
      .filter((c) => c.assignmentId && c.isCompleted)
      .map((c) => c.assignmentId as string),
  );
  const adHoc = input.completions.filter((c) => !c.assignmentId);
  const adHocCompleted = adHoc.filter((c) => c.isCompleted).length;
  const plannedCompleted = input.plannedAssignmentIds.filter((id) =>
    completedAssignmentIds.has(id),
  ).length;

  return {
    completed: plannedCompleted + adHocCompleted,
    /** Include incomplete ad-hoc rows so total matches the tasks list length. */
    total: input.plannedAssignmentIds.length + adHoc.length,
  };
}

export function buildVisitTaskProgressByJobId(input: {
  jobs: JobForTaskProgress[];
  assignments: AssignmentRow[];
  completions: CompletionRow[];
}): Map<string, VisitTaskProgress> {
  const result = new Map<string, VisitTaskProgress>();
  if (input.jobs.length === 0) return result;

  const jobRound = new Map<string, string | null>();
  for (const job of input.jobs) {
    jobRound.set(job.id, resolveJobMedicationRoundCode(job.visits));
  }

  const assignmentsByKey = new Map<string, string[]>();
  for (const a of input.assignments) {
    const key = `${a.serviceUserId}|${a.medicationRoundCode}`;
    const list = assignmentsByKey.get(key) ?? [];
    list.push(a.id);
    assignmentsByKey.set(key, list);
  }

  const completionsByJob = new Map<string, CompletionRow[]>();
  for (const c of input.completions) {
    const list = completionsByJob.get(c.scheduledJobId) ?? [];
    list.push(c);
    completionsByJob.set(c.scheduledJobId, list);
  }

  for (const job of input.jobs) {
    const round = jobRound.get(job.id);
    if (!round) {
      result.set(job.id, { completed: 0, total: 0 });
      continue;
    }
    const plannedIds = assignmentsByKey.get(`${job.serviceUserId}|${round}`) ?? [];
    const jobCompletions = completionsByJob.get(job.id) ?? [];
    result.set(
      job.id,
      computeVisitTaskProgress({
        plannedAssignmentIds: plannedIds,
        completions: jobCompletions,
      }),
    );
  }

  return result;
}
