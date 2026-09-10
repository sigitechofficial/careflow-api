import { resolveJobMedicationRoundCode } from '../scheduled-jobs-housekeeping/visit-job-tasks.util';
import {
  pickScheduleFromAssignment,
  visitTaskMatchesDay,
  type VisitTaskScheduleShape,
} from '../visit-tasks/visit-task-schedule.util';

export type VisitTaskProgress = {
  completed: number;
  total: number;
};

type JobForTaskProgress = {
  id: string;
  serviceUserId: string;
  scheduledStartDateTime?: Date | string | null;
  visits: Array<{
    visitPlanSlot: { slotCode: string; medicationRoundCode: string | null } | null;
    scheduledStartDateTime?: Date | string | null;
  }>;
};

type AssignmentRow = {
  id: string;
  serviceUserId: string;
  medicationRoundCode: string;
} & Partial<VisitTaskScheduleShape>;

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

export type VisitTaskOutcomeCode = 'COMPLETED' | 'PARTIAL' | 'DECLINED';

export function normalizeVisitTaskOutcomeCode(
  value: string | null | undefined,
): VisitTaskOutcomeCode | null {
  if (!value?.trim()) return null;
  const upper = value.trim().toUpperCase();
  if (upper === 'COMPLETED' || upper === 'PARTIAL' || upper === 'DECLINED') return upper;
  if (upper === 'COMPLETE') return 'COMPLETED';
  return null;
}

/** Strip mobile/admin outcome markers so free-text notes stay editable. */
export function stripVisitTaskOutcomeNotes(notes: string | null | undefined): string | null {
  if (!notes?.trim()) return null;
  const cleaned = notes
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 0 &&
        !/^Outcome:\s*/i.test(part) &&
        !/^Reason:\s*/i.test(part) &&
        !/^Checklist:\s*/i.test(part) &&
        !/^Auto-completed:/i.test(part),
    )
    .join(' · ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function isVisitTaskOutcomeSentinel(value: string | null | undefined): boolean {
  const upper = String(value ?? '')
    .trim()
    .toUpperCase();
  return upper === 'PARTIAL' || upper === 'DECLINED';
}

/**
 * Encode carer/admin task outcome the same way as employee-app saveTask
 * (notes Outcome: marker + PARTIAL/DECLINED recordedValue sentinel).
 */
export function encodeVisitTaskOutcomeFields(input: {
  outcome: VisitTaskOutcomeCode;
  notes?: string | null;
  recordedValue?: string | null;
  outcomeReasonCode?: string | null;
}): {
  isCompleted: true;
  notes: string | null;
  recordedValue: string | null;
} {
  const freeNotes = stripVisitTaskOutcomeNotes(input.notes);
  const notesParts = [
    input.outcome !== 'COMPLETED' ? `Outcome: ${input.outcome}` : null,
    input.outcomeReasonCode?.trim() ? `Reason: ${input.outcomeReasonCode.trim()}` : null,
    freeNotes,
  ].filter(Boolean);

  let recordedValue = input.recordedValue?.trim() || null;
  if (isVisitTaskOutcomeSentinel(recordedValue) && input.outcome === 'COMPLETED') {
    recordedValue = null;
  }
  if (input.outcome === 'PARTIAL') recordedValue = recordedValue || 'PARTIAL';
  if (input.outcome === 'DECLINED') recordedValue = recordedValue || 'DECLINED';

  return {
    isCompleted: true,
    notes: notesParts.length > 0 ? notesParts.join(' · ') : null,
    recordedValue,
  };
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

function resolveJobVisitDay(job: JobForTaskProgress): Date | null {
  const raw =
    job.scheduledStartDateTime ??
    job.visits.find((v) => v.scheduledStartDateTime)?.scheduledStartDateTime ??
    null;
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function assignmentDueOnDay(
  assignment: AssignmentRow,
  day: Date | null,
  jobCompletions: CompletionRow[],
): boolean {
  if (jobCompletions.some((c) => c.assignmentId === assignment.id)) return true;
  if (!day) return true;
  if (assignment.scheduleFrequency == null && assignment.daysOfWeek == null) return true;
  return visitTaskMatchesDay(pickScheduleFromAssignment(assignment as VisitTaskScheduleShape), day, day);
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

  const assignmentsByKey = new Map<string, AssignmentRow[]>();
  for (const a of input.assignments) {
    const key = `${a.serviceUserId}|${a.medicationRoundCode}`;
    const list = assignmentsByKey.get(key) ?? [];
    list.push(a);
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
    const visitDay = resolveJobVisitDay(job);
    const jobCompletions = completionsByJob.get(job.id) ?? [];
    const plannedIds = (assignmentsByKey.get(`${job.serviceUserId}|${round}`) ?? [])
      .filter((a) => assignmentDueOnDay(a, visitDay, jobCompletions))
      .map((a) => a.id);
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
