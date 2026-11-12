import { EcmExceptionKind } from '@prisma/client';
import {
  buildAdminCheckInSummary,
  extractEmployeeAppCheckInsByEmployee,
} from '../employee-app/check-in-display.util';
import { visitTimingExceptionReasonLabel } from '../scheduling/visit-timing-exception-reason.util';

/**
 * The reason a carer gave in the app for an early / late arrival or an early
 * finish, shown read-only on the ECM queue card so the office can triage
 * without opening the visit. Never copied onto the exception itself:
 * `EcmException.reasonCode` stays the system / office resolution field.
 */
export type EcmCarerReason = {
  /** null for the visit's clock-out reason (recorded once for the visit). */
  employeeId: string | null;
  name: string | null;
  kind: 'arrival' | 'clock_out';
  label: string | null;
  notes: string | null;
};

const ARRIVAL_KINDS = new Set<EcmExceptionKind>([
  EcmExceptionKind.EARLY_ARRIVAL,
  EcmExceptionKind.LATE_ARRIVAL,
  EcmExceptionKind.VERY_LATE_ARRIVAL,
]);

const CLOCK_OUT_KINDS = new Set<EcmExceptionKind>([
  EcmExceptionKind.EARLY_DEPARTURE,
  EcmExceptionKind.SHORT_VISIT,
]);

export function ecmKindUsesCarerReasons(kind: EcmExceptionKind): boolean {
  return ARRIVAL_KINDS.has(kind) || CLOCK_OUT_KINDS.has(kind);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function buildEcmCarerReasons(input: {
  kind: EcmExceptionKind;
  metadata: unknown;
  carers: Array<{ employeeId: string; name: string }>;
}): EcmCarerReason[] {
  const { kind, metadata, carers } = input;
  if (ARRIVAL_KINDS.has(kind)) {
    const byEmployee = extractEmployeeAppCheckInsByEmployee(metadata);
    const out: EcmCarerReason[] = [];
    for (const [employeeId, blob] of Object.entries(byEmployee)) {
      const summary = buildAdminCheckInSummary(blob);
      const label = summary?.timingExceptionReasonLabel ?? null;
      const notes = summary?.timingExceptionNotes ?? null;
      if (!label && !notes) continue;
      out.push({
        employeeId,
        name: carers.find((c) => c.employeeId === employeeId)?.name ?? null,
        kind: 'arrival',
        label,
        notes: notes && notes !== label ? notes : null,
      });
    }
    return out;
  }
  if (CLOCK_OUT_KINDS.has(kind)) {
    const meta =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {};
    const code = readString(meta.timingExceptionReasonCode);
    const notes = readString(meta.timingExceptionNotes);
    if (!code && !notes) return [];
    const label = code ? visitTimingExceptionReasonLabel(code) : null;
    return [
      {
        employeeId: null,
        name: null,
        kind: 'clock_out',
        label,
        notes: notes && notes !== label ? notes : null,
      },
    ];
  }
  return [];
}
