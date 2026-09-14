export const EXTRA_VISIT_TASK_ASSIGNMENT_PREFIX = 'extra-';

export function extraVisitTaskAssignmentId(taskCatalogueTaskId: string): string {
  return `${EXTRA_VISIT_TASK_ASSIGNMENT_PREFIX}${taskCatalogueTaskId}`;
}

export function parseVisitTaskAssignmentKey(raw: string): {
  kind: 'planned' | 'extra';
  assignmentId: string | null;
  taskCatalogueTaskId: string | null;
  stampKey: string;
} {
  const value = raw.trim();
  if (value.startsWith(EXTRA_VISIT_TASK_ASSIGNMENT_PREFIX)) {
    const taskCatalogueTaskId = value.slice(EXTRA_VISIT_TASK_ASSIGNMENT_PREFIX.length).trim();
    return {
      kind: 'extra',
      assignmentId: null,
      taskCatalogueTaskId: taskCatalogueTaskId || null,
      stampKey: value,
    };
  }
  return {
    kind: 'planned',
    assignmentId: value || null,
    taskCatalogueTaskId: null,
    stampKey: value,
  };
}

export function taskCompletionHasDeliveryToReset(row: {
  isCompleted?: boolean | null;
  recordedValue?: string | null;
  notes?: string | null;
  completedAt?: Date | string | null;
}): boolean {
  if (row.isCompleted) return true;
  if (row.completedAt instanceof Date && !Number.isNaN(row.completedAt.getTime())) return true;
  if (typeof row.completedAt === 'string' && row.completedAt.trim()) return true;
  if (String(row.recordedValue ?? '').trim()) return true;
  if (String(row.notes ?? '').trim()) return true;
  return false;
}

export function parseTaskResets(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = key.trim();
    if (!id || typeof value !== 'string' || !value.trim()) continue;
    out[id] = value.trim();
  }
  return out;
}

export function applyVisitTaskResetMetadata(
  metadata: Record<string, unknown>,
  input: { assignmentId: string; resetAt: string; reason: string; resetById: string },
): Record<string, unknown> {
  const previous = parseTaskResets(metadata.taskResets);
  return {
    ...metadata,
    taskResets: { ...previous, [input.assignmentId]: input.resetAt },
    taskResetReason: input.reason,
    taskResetById: input.resetById,
  };
}
