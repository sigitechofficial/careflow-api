/**
 * Lead-carer rules for multi-carer (double / triple) visits.
 *
 * - A multi-carer visit (requiredCarers >= 2) has exactly one lead.
 * - When no allocation is flagged lead (older data), the lead is the active
 *   carer with the earliest `allocatedAt` (tie-break by allocation id). The
 *   carer app and admin use this same order, so the lead never flips when an
 *   allocation row is updated.
 * - When the lead is removed, the remaining carer that comes first in that
 *   order is promoted.
 */

export type AssignedOrderRow = {
  id?: string | null;
  allocatedAt?: Date | string | null;
};

function assignedAtMs(value: Date | string | null | undefined): number {
  if (value == null) return Number.POSITIVE_INFINITY;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** Earliest `allocatedAt` first, then allocation id (stable, deterministic). */
export function compareByAssignedOrder(a: AssignedOrderRow, b: AssignedOrderRow): number {
  const aMs = assignedAtMs(a.allocatedAt);
  const bMs = assignedAtMs(b.allocatedAt);
  if (aMs !== bMs) return aMs < bMs ? -1 : 1;
  const aId = a.id ?? '';
  const bId = b.id ?? '';
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

export function sortByAssignedOrder<T extends AssignedOrderRow>(rows: T[]): T[] {
  return [...rows].sort(compareByAssignedOrder);
}

/** Carer promoted to lead when the lead is removed (null when nobody remains). */
export function pickPromotedLead<T extends AssignedOrderRow>(remaining: T[]): T | null {
  return sortByAssignedOrder(remaining)[0] ?? null;
}

export type TeamCompositionInput = {
  requiredCarers: number;
  /** Carers already actively allocated to the job. */
  existingEmployeeIds: string[];
  /** Carers being added in this save. */
  newEmployeeIds: string[];
  leadEmployeeId: string | null | undefined;
};

function carersLabel(count: number): string {
  return `${count} carer${count === 1 ? '' : 's'}`;
}

/**
 * Validates a team save on a multi-carer visit. Returns a user-facing error
 * message, or null when the team is complete and has exactly one lead.
 */
export function teamCompositionError(input: TeamCompositionInput): string | null {
  const required = input.requiredCarers ?? 1;
  if (required < 2) {
    return 'Team assignment is only for visits that need 2 or more carers. Assign this visit to a single carer instead.';
  }
  if (input.newEmployeeIds.length === 0) {
    return 'Select at least one carer.';
  }
  if (new Set(input.newEmployeeIds).size !== input.newEmployeeIds.length) {
    return 'Each carer can only be selected once.';
  }
  const existing = new Set(input.existingEmployeeIds);
  if (input.newEmployeeIds.some((id) => existing.has(id))) {
    return 'One or more selected carers are already assigned to this visit.';
  }

  const missing = required - existing.size;
  if (missing <= 0) {
    return `This visit already has ${carersLabel(existing.size)} assigned. Remove or change a carer instead.`;
  }
  if (input.newEmployeeIds.length !== missing) {
    return existing.size === 0
      ? `This visit needs ${carersLabel(required)} — ${input.newEmployeeIds.length} selected.`
      : `This visit needs ${missing} more ${missing === 1 ? 'carer' : 'carers'} — ${input.newEmployeeIds.length} selected.`;
  }

  const lead = input.leadEmployeeId?.trim();
  if (!lead) return 'Choose a lead carer.';
  if (!existing.has(lead) && !input.newEmployeeIds.includes(lead)) {
    return 'The lead carer must be one of the carers on this visit.';
  }
  return null;
}

export type LeadChangePushPlan = {
  /** Push "You are now the lead carer" to this carer (null = no push). */
  newLeadEmployeeId: string | null;
  /** Push "<Name> is now the lead carer" to these carers. */
  informEmployeeIds: string[];
};

/**
 * Who to tell after the lead of a multi-carer visit may have changed.
 * - Nothing when the lead did not change, or the visit had no lead before (new team).
 * - Carers assigned in the same change already got "New visit assigned — you are
 *   Lead/Support", so they get no extra lead push.
 * - Everyone else still on the visit (previous lead + other carers) is told who leads now.
 */
export function planLeadChangePushes(input: {
  previousLeadEmployeeId: string | null;
  currentLeadEmployeeId: string | null;
  activeEmployeeIds: string[];
  newlyAssignedEmployeeIds?: Iterable<string>;
}): LeadChangePushPlan {
  const none: LeadChangePushPlan = { newLeadEmployeeId: null, informEmployeeIds: [] };
  const current = input.currentLeadEmployeeId;
  if (!input.previousLeadEmployeeId || !current) return none;
  if (current === input.previousLeadEmployeeId) return none;
  const fresh = new Set(input.newlyAssignedEmployeeIds ?? []);
  return {
    newLeadEmployeeId: fresh.has(current) ? null : current,
    informEmployeeIds: [...new Set(input.activeEmployeeIds)].filter(
      (id) => id !== current && !fresh.has(id),
    ),
  };
}

/** VISIT_ASSIGN body; multi-carer visits say which role the carer has. */
export function visitAssignPushBody(
  jobName: string,
  timeSuffix: string,
  role?: 'lead' | 'support' | null,
): string {
  const base = `You have been allocated to "${jobName}"${timeSuffix}`;
  if (role === 'lead') return `${base} — you are Lead.`;
  if (role === 'support') return `${base} — you are Support.`;
  return `${base}.`;
}

/** Message when a visit has no free carer place (single allocate), else null. */
export function fullVisitMessage(activeCarers: number, requiredCarers: number): string | null {
  const required = Math.max(1, requiredCarers ?? 1);
  if (activeCarers < required) return null;
  return `This visit already has ${activeCarers} of ${required} carer${required === 1 ? '' : 's'} assigned. Remove or change a carer before adding another.`;
}

const CLOSED_JOB_STATUSES = new Set([
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'MISSED',
  'CANCELLED',
  'CALLED_OFF',
]);

/** True while the carer is clocked in on an open visit (started, not clocked out). */
export function isCarerClockedInOnOpenVisit(input: {
  actualStartDateTime?: Date | string | null;
  actualEndDateTime?: Date | string | null;
  jobStatus: string;
}): boolean {
  return (
    input.actualStartDateTime != null &&
    input.actualEndDateTime == null &&
    !CLOSED_JOB_STATUSES.has(input.jobStatus)
  );
}

/** Unallocate / replace / drag must not remove a carer who is clocked in. */
export function clockedInRemovalBlockMessage(input: {
  carerName: string;
  actualStartDateTime?: Date | string | null;
  actualEndDateTime?: Date | string | null;
  jobStatus: string;
}): string | null {
  if (!isCarerClockedInOnOpenVisit(input)) return null;
  return `${input.carerName} is clocked in on this visit and can't be removed. Ask them to clock out first.`;
}
