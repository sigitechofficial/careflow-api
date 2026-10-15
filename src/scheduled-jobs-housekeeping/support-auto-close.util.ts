/**
 * Older visits only: until 12 Oct 2026 a support carer still clocked in was clocked
 * out by the system at the lead's clock-out. That no longer happens (each carer's
 * session is their own); these helpers only read the markers those visits kept.
 */

/** Key under ScheduledJob.metadata.employeeApp: { [employeeId]: SupportAutoCloseRecord }. */
export const SUPPORT_AUTO_CLOSED_META_KEY = 'supportAutoClosed';

export type SupportAutoCloseRecord = {
  autoClosedAt: string;
  leadEmployeeId: string;
  reason: 'lead_clock_out';
  recordedAt: string;
};

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
