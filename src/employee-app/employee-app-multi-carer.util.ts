/**
 * Multi-carer (double-up) helpers for employee-app visits.
 * Single-carer visits (requiredCarers < 2 and < 2 active allocations) must keep
 * identical behaviour — these helpers return null / false so callers skip branching.
 */

export type EmployeeAppCarerRole = 'lead' | 'support';

export type AllocationLike = {
  employeeId: string;
  status: string;
  isLeadCarer?: boolean;
  actualStartDateTime?: Date | string | null;
  actualEndDateTime?: Date | string | null;
};

const ACTIVE = new Set([
  'PENDING_CONFIRMATION',
  'ALLOCATED',
  'CONFIRMED',
]);

export function activeAllocations<T extends AllocationLike>(allocations: T[]): T[] {
  return allocations.filter((a) => ACTIVE.has(a.status));
}

/** True when the visit is a double-up (2+ carers required or allocated). */
export function isMultiCarerVisit(
  requiredCarers: number | null | undefined,
  allocations: AllocationLike[],
): boolean {
  const active = activeAllocations(allocations);
  return (requiredCarers ?? 1) >= 2 || active.length >= 2;
}

/**
 * Resolve lead employee id for a multi-carer visit.
 * Prefers explicit isLeadCarer; otherwise first active allocation.
 * Returns null for single-carer (no lead/support distinction).
 */
export function resolveLeadEmployeeId(
  requiredCarers: number | null | undefined,
  allocations: AllocationLike[],
): string | null {
  if (!isMultiCarerVisit(requiredCarers, allocations)) return null;
  const active = activeAllocations(allocations);
  const lead = active.find((a) => a.isLeadCarer) ?? active[0];
  return lead?.employeeId ?? null;
}

export function resolveCarerRole(
  employeeId: string,
  requiredCarers: number | null | undefined,
  allocations: AllocationLike[],
): EmployeeAppCarerRole | null {
  const leadId = resolveLeadEmployeeId(requiredCarers, allocations);
  if (!leadId) return null;
  return employeeId === leadId ? 'lead' : 'support';
}

export function isLeadCarerOnVisit(
  employeeId: string,
  requiredCarers: number | null | undefined,
  allocations: AllocationLike[],
): boolean {
  const role = resolveCarerRole(employeeId, requiredCarers, allocations);
  // Single-carer: treat as lead for write rules that are lead-only on double-up.
  return role === null || role === 'lead';
}

export function allocationIso(
  value: Date | string | null | undefined,
): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type CoCarerPresenceRecord = {
  present: boolean;
  arrivedAt?: string | null;
  leftAt?: string | null;
  markedByEmployeeId?: string | null;
  updatedAt?: string | null;
};

export function readCoCarerPresenceMap(
  employeeAppMeta: Record<string, unknown> | null | undefined,
): Record<string, CoCarerPresenceRecord> {
  const raw = employeeAppMeta?.coCarerPresence;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, CoCarerPresenceRecord> = {};
  for (const [id, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    out[id] = {
      present: Boolean(r.present),
      arrivedAt: r.arrivedAt != null ? String(r.arrivedAt) : null,
      leftAt: r.leftAt != null ? String(r.leftAt) : null,
      markedByEmployeeId:
        r.markedByEmployeeId != null ? String(r.markedByEmployeeId) : null,
      updatedAt: r.updatedAt != null ? String(r.updatedAt) : null,
    };
  }
  return out;
}

/**
 * Canonical employee-app task flag for dual / support-needed tasks.
 * Source of truth in DB: TaskCatalogueTask.requiresMultipleCarers.
 */
export function mapTwoPersonTaskFlags(requiresMultipleCarers: boolean): {
  twoPerson: boolean;
  requiresSupport: boolean;
  requiredForRoles: Array<'lead' | 'support'> | null;
} {
  if (!requiresMultipleCarers) {
    return { twoPerson: false, requiresSupport: false, requiredForRoles: null };
  }
  return {
    twoPerson: true,
    requiresSupport: true,
    requiredForRoles: ['lead', 'support'],
  };
}
