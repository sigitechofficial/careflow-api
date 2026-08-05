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
  recordedValue?: string | null;
  notes?: string | null;
};

export type VisitTaskOutcome = 'completed' | 'partial' | 'declined';

/**
 * Carer has finished the task from their side: COMPLETED, PARTIAL, or DECLINED.
 * Progress (Home / Details) counts addressed tasks, not only fully completed.
 */
export function isVisitTaskAddressed(input: {
  isCompleted?: boolean | null;
  recordedValue?: string | null;
  notes?: string | null;
}): boolean {
  if (input.isCompleted) return true;
  const rv = String(input.recordedValue ?? '')
    .trim()
    .toUpperCase();
  if (rv === 'PARTIAL' || rv === 'DECLINED') return true;
  if (/Outcome:\s*(PARTIAL|DECLINED)\b/i.test(String(input.notes ?? ''))) return true;
  return false;
}

export function inferVisitTaskOutcome(input: {
  isCompleted?: boolean | null;
  recordedValue?: string | null;
  notes?: string | null;
}): VisitTaskOutcome | null {
  const notes = String(input.notes ?? '');
  const rv = String(input.recordedValue ?? '')
    .trim()
    .toUpperCase();
  if (/Outcome:\s*DECLINED\b/i.test(notes) || rv === 'DECLINED') return 'declined';
  if (/Outcome:\s*PARTIAL\b/i.test(notes) || rv === 'PARTIAL') return 'partial';
  if (input.isCompleted) return 'completed';
  return null;
}

/**
 * Shared Home / Details / client-detail task progress.
 * Must match visit-task list semantics: planned assignments + all ad-hoc rows.
 */
export function computeVisitTaskProgress(input: {
  plannedAssignmentIds: string[];
  completions: Array<{
    assignmentId: string | null;
    isCompleted: boolean;
    recordedValue?: string | null;
    notes?: string | null;
  }>;
}): VisitTaskProgress {
  const addressedAssignmentIds = new Set(
    input.completions
      .filter((c) => c.assignmentId && isVisitTaskAddressed(c))
      .map((c) => c.assignmentId as string),
  );
  const adHoc = input.completions.filter((c) => !c.assignmentId);
  const adHocAddressed = adHoc.filter((c) => isVisitTaskAddressed(c)).length;
  const plannedAddressed = input.plannedAssignmentIds.filter((id) =>
    addressedAssignmentIds.has(id),
  ).length;

  return {
    completed: plannedAddressed + adHocAddressed,
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
