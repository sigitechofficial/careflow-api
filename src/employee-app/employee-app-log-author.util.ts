import type { EmployeeAppCarerRole } from './employee-app-multi-carer.util';

/**
 * Visit log authorship (who wrote it, their role on the visit at that time, when).
 * Notes / handover / concerns / incidents are stored on ScheduledJob.metadata.employeeApp
 * with `recordedByEmployeeId`, `recordedAt` and (from multi-carer visits) `recordedByRole`.
 */
export type LogAuthorRole = EmployeeAppCarerRole;

export type VisitLogAuthor = {
  employeeId: string;
  name: string;
  /** Role on the visit when the entry was written; null on single-carer / older entries. */
  role: LogAuthorRole | null;
  /** e.g. "Liam Walsh (Support)" */
  label: string;
};

function asRole(value: unknown): LogAuthorRole | null {
  return value === 'lead' || value === 'support' ? value : null;
}

/** entryId → role at time of writing, from the employee-app metadata blob. */
export function logEntryRolesById(
  employeeAppMeta: Record<string, unknown> | null | undefined,
): Map<string, LogAuthorRole> {
  const out = new Map<string, LogAuthorRole>();
  const add = (row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    const r = row as Record<string, unknown>;
    const role = asRole(r.recordedByRole);
    if (r.id != null && role) out.set(String(r.id), role);
  };
  for (const key of ['notes', 'concerns', 'incidents'] as const) {
    const list = employeeAppMeta?.[key];
    if (Array.isArray(list)) list.forEach(add);
  }
  add(employeeAppMeta?.handoverNote);
  return out;
}

export function visitLogAuthorLabel(name: string, role: LogAuthorRole | null): string {
  if (role === 'lead') return `${name} (Lead)`;
  if (role === 'support') return `${name} (Support)`;
  return name;
}

/** Timeline types that carry a carer author line in the admin visit log. */
export const AUTHORED_LOG_TYPES = new Set(['visit_note', 'handover', 'concern', 'incident']);
