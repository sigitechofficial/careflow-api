import { resolveLeadEmployeeId } from '../employee-app/employee-app-multi-carer.util';

/** Attendance note + timeline text for a support clock-out closed by the system. */
export const SUPPORT_AUTO_CLOSE_NOTE = 'Auto-closed at lead clock-out';
/** Key under ScheduledJob.metadata.employeeApp: { [employeeId]: SupportAutoCloseRecord }. */
export const SUPPORT_AUTO_CLOSED_META_KEY = 'supportAutoClosed';

export type SupportAutoCloseRecord = {
  autoClosedAt: string;
  leadEmployeeId: string;
  reason: 'lead_clock_out';
  recordedAt: string;
};

type AllocationForAutoClose = {
  id: string;
  employeeId: string;
  status: string;
  isLeadCarer: boolean;
  allocatedAt: Date;
  actualStartDateTime: Date | null;
  actualEndDateTime: Date | null;
};

/**
 * Lead closed a multi-carer visit: every SUPPORT carer still clocked in
 * (start, no end) is clocked out at the lead's clock-out time. Never earlier
 * than their own clock-in. Single-carer visits: nothing to close.
 */
export function planSupportAutoClose(input: {
  requiredCarers: number;
  allocations: AllocationForAutoClose[];
  leadClockOut: Date;
}): {
  leadEmployeeId: string | null;
  rows: Array<{ allocationId: string; employeeId: string; end: Date }>;
} {
  const leadEmployeeId = resolveLeadEmployeeId(input.requiredCarers, input.allocations);
  if (!leadEmployeeId) return { leadEmployeeId: null, rows: [] };
  const rows = input.allocations
    .filter(
      (a) =>
        a.employeeId !== leadEmployeeId &&
        ['PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED'].includes(a.status) &&
        a.actualStartDateTime != null &&
        a.actualEndDateTime == null,
    )
    .map((a) => ({
      allocationId: a.id,
      employeeId: a.employeeId,
      end:
        input.leadClockOut.getTime() > a.actualStartDateTime!.getTime()
          ? input.leadClockOut
          : a.actualStartDateTime!,
    }));
  return { leadEmployeeId, rows };
}

/** Auto-close records stored on the job (employeeId → record). */
export function readSupportAutoClosed(
  employeeAppMeta: Record<string, unknown> | null | undefined,
): Record<string, SupportAutoCloseRecord> {
  const raw = employeeAppMeta?.[SUPPORT_AUTO_CLOSED_META_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, SupportAutoCloseRecord> = {};
  for (const [employeeId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    if (typeof v.autoClosedAt !== 'string') continue;
    out[employeeId] = {
      autoClosedAt: v.autoClosedAt,
      leadEmployeeId: String(v.leadEmployeeId ?? ''),
      reason: 'lead_clock_out',
      recordedAt: String(v.recordedAt ?? v.autoClosedAt),
    };
  }
  return out;
}
