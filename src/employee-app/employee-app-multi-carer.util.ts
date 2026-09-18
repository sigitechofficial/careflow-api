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

export type AllocationPresenceView = {
  present: boolean;
  arrivedAt: string | null;
  leftAt: string | null;
  markedByEmployeeId: string | null;
  markedByName: string | null;
  updatedAt: string | null;
};

export function readEmployeeAppMeta(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const ea = metadata?.employeeApp;
  if (!ea || typeof ea !== 'object' || Array.isArray(ea)) return null;
  return ea as Record<string, unknown>;
}

export function allocationPresenceView(
  employeeId: string,
  presenceMap: Record<string, CoCarerPresenceRecord>,
  nameByEmployeeId: Record<string, string>,
): AllocationPresenceView | null {
  const row = presenceMap[employeeId];
  if (!row) return null;
  const markedByEmployeeId = row.markedByEmployeeId?.trim() || null;
  return {
    present: row.present,
    arrivedAt: row.arrivedAt ?? null,
    leftAt: row.leftAt ?? null,
    markedByEmployeeId,
    markedByName: markedByEmployeeId
      ? nameByEmployeeId[markedByEmployeeId] ?? null
      : null,
    updatedAt: row.updatedAt ?? null,
  };
}

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

const VISIT_CLOSED_FOR_DOUBLE_UP = new Set([
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'CANCELLED',
  'CALLED_OFF',
  'MISSED',
]);

export type SupportClockedOutBeforeLeadComplete = {
  /** True when at least one support carer clocked out and lead has not closed the visit. */
  occurred: true;
  leadHasNotCompletedVisit: true;
  visitRemainsOpenForLead: true;
  /** Non-lead carers who already clocked out (support checkout). */
  carers: Array<{
    employeeId: string;
    name: string;
    role: 'support';
    checkedOutAt: string;
    isYou: boolean;
  }>;
};

/**
 * Double-up only: support left (allocation actualEnd) while visit still open for lead.
 * Returns null for single-carer or when visit is already closed.
 */
export function buildSupportClockedOutBeforeLeadComplete(input: {
  requiredCarers: number;
  allocations: Array<
    AllocationLike & {
      employee?: {
        personalDetail?: { firstName?: string | null; lastName?: string | null } | null;
      } | null;
    }
  >;
  visitStatus: string;
  viewingEmployeeId?: string;
}): SupportClockedOutBeforeLeadComplete | null {
  if (!isMultiCarerVisit(input.requiredCarers, input.allocations)) return null;
  if (VISIT_CLOSED_FOR_DOUBLE_UP.has(input.visitStatus)) return null;

  const leadId = resolveLeadEmployeeId(input.requiredCarers, input.allocations);
  if (!leadId) return null;

  const active = activeAllocations(input.allocations);
  const leadAlloc = active.find((a) => a.employeeId === leadId);
  if (leadAlloc?.actualEndDateTime) return null;

  const departed = active
    .filter((a) => a.employeeId !== leadId && a.actualEndDateTime)
    .map((a) => {
      const checkedOutAt = allocationIso(a.actualEndDateTime);
      if (!checkedOutAt) return null;
      const pd = a.employee?.personalDetail;
      const name = [pd?.firstName, pd?.lastName].filter(Boolean).join(' ').trim() || 'Co-carer';
      return {
        employeeId: a.employeeId,
        name,
        role: 'support' as const,
        checkedOutAt,
        isYou: input.viewingEmployeeId ? a.employeeId === input.viewingEmployeeId : false,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  if (departed.length === 0) return null;

  return {
    occurred: true,
    leadHasNotCompletedVisit: true,
    visitRemainsOpenForLead: true,
    carers: departed,
  };
}
