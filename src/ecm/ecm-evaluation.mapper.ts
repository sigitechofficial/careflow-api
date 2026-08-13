import {
  EcmArrivalClassification,
  EcmAttendanceConfidence,
  EcmCriticality,
  EcmDepartureClassification,
  EcmDurationClassification,
  EcmLifecycleStatus,
  EcmMissedClassification,
  EcmSettingsLevel,
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  VisitAttendanceEventType,
  VisitAttendanceVerificationMethod,
} from '@prisma/client';

import { DEFAULT_OPERATIONAL_TIMEZONE } from '../common/utils/operational-day.util';
import {
  deriveArrivalWindow,
  evaluateEcmTiming,
} from './ecm-timing.util';
import {
  orgSettingsToEcmLayer,
  resolveEcmSettings,
  type EcmCriticalityCode,
  type EcmSettingsLevelCode,
  type EcmSettingsLayer,
} from './ecm-settings-resolver.util';

export type EcmLifecycleContext = {
  jobStatus: ScheduledJobStatus | string;
  visitStatus?: ScheduledVisitStatus | string | null;
  allocatedCarers: number;
  hasCheckIn: boolean;
  hasCheckOut: boolean;
  latestAttendanceEventType?: string | null;
  hasTimingOrOperationalException: boolean;
};

export function mapToEcmLifecycle(ctx: EcmLifecycleContext): EcmLifecycleStatus {
  const job = String(ctx.jobStatus ?? '').toUpperCase();
  const visit = String(ctx.visitStatus ?? '').toUpperCase();

  if (job === 'CANCELLED' || visit === 'CANCELLED' || job === 'CALLED_OFF' || visit === 'CALLED_OFF') {
    return EcmLifecycleStatus.CLOSED;
  }
  if (job === 'DRAFT') return EcmLifecycleStatus.DRAFT;

  // Workspace status is authoritative. Timestamps only refine within that status.
  if (job === 'COMPLETED' || visit === 'COMPLETED') {
    return ctx.hasTimingOrOperationalException
      ? EcmLifecycleStatus.COMPLETED_WITH_EXCEPTION
      : EcmLifecycleStatus.COMPLETED;
  }
  if (job === 'PARTIALLY_COMPLETED' || visit === 'PARTIALLY_COMPLETED') {
    return EcmLifecycleStatus.COMPLETED_WITH_EXCEPTION;
  }
  if (job === 'IN_PROGRESS' || visit === 'STARTED') {
    return EcmLifecycleStatus.IN_PROGRESS;
  }

  // Evidence-only path when job/visit status has not been updated yet.
  if (ctx.hasCheckOut) {
    return ctx.hasTimingOrOperationalException
      ? EcmLifecycleStatus.COMPLETED_WITH_EXCEPTION
      : EcmLifecycleStatus.COMPLETED;
  }
  if (ctx.hasCheckIn) {
    return EcmLifecycleStatus.IN_PROGRESS;
  }

  const attendance = String(ctx.latestAttendanceEventType ?? '').toUpperCase();
  if (attendance === 'EN_ROUTE') return EcmLifecycleStatus.EN_ROUTE;

  if (ctx.allocatedCarers <= 0 || job === 'UNALLOCATED') {
    return EcmLifecycleStatus.UNASSIGNED;
  }
  if (job === 'ALLOCATED' || ctx.allocatedCarers > 0) {
    return EcmLifecycleStatus.ASSIGNED;
  }
  return EcmLifecycleStatus.SCHEDULED;
}

export function mapConfidence(input: {
  verificationMethod?: VisitAttendanceVerificationMethod | string | null;
  outsideGeofence?: boolean;
  isMockLocation?: boolean;
  manual?: boolean;
  hasCheckIn: boolean;
  hasCheckOut: boolean;
  accuracyMeters?: number | null;
  identityConfirmed?: boolean;
  disputed?: boolean;
}): EcmAttendanceConfidence {
  if (input.disputed) return EcmAttendanceConfidence.DISPUTED;
  if (!input.hasCheckIn) return EcmAttendanceConfidence.UNVERIFIED;
  if (input.isMockLocation) return EcmAttendanceConfidence.REJECTED;
  if (input.manual) return EcmAttendanceConfidence.MANUALLY_VERIFIED;

  const method = String(input.verificationMethod ?? '').toUpperCase();
  if (method === 'MANUAL_OFFICE') return EcmAttendanceConfidence.MANUALLY_VERIFIED;

  const highAccuracy =
    input.accuracyMeters == null || Number(input.accuracyMeters) <= 100;
  const gpsLike = method === 'MOBILE_GPS' || method === '' || method === 'NFC' || method === 'QR';

  if (gpsLike && !input.outsideGeofence && input.hasCheckIn && input.hasCheckOut && highAccuracy) {
    return input.identityConfirmed === false
      ? EcmAttendanceConfidence.PARTIALLY_VERIFIED
      : EcmAttendanceConfidence.VERIFIED;
  }
  if (gpsLike && input.hasCheckIn) {
    return EcmAttendanceConfidence.PARTIALLY_VERIFIED;
  }
  if (method === 'TELEPHONE') return EcmAttendanceConfidence.PARTIALLY_VERIFIED;
  return EcmAttendanceConfidence.UNVERIFIED;
}

export function confidenceFactors(input: {
  verificationMethod?: string | null;
  outsideGeofence?: boolean;
  isMockLocation?: boolean;
  manual?: boolean;
  hasCheckIn: boolean;
  hasCheckOut: boolean;
  accuracyMeters?: number | null;
  identityConfirmed?: boolean;
}): string[] {
  const factors: string[] = [];
  if (!input.hasCheckIn) factors.push('NO_CHECK_IN');
  if (input.hasCheckOut) factors.push('HAS_CHECK_OUT');
  if (input.manual) factors.push('MANUAL_OFFICE');
  if (input.isMockLocation) factors.push('MOCK_LOCATION');
  if (input.outsideGeofence) factors.push('OUTSIDE_GEOFENCE');
  if (input.identityConfirmed) factors.push('IDENTITY_CONFIRMED');
  if (input.accuracyMeters != null && Number(input.accuracyMeters) > 100) {
    factors.push('LOW_GPS_ACCURACY');
  }
  if (input.verificationMethod) factors.push(`METHOD_${String(input.verificationMethod).toUpperCase()}`);
  return factors;
}

export function toPrismaCriticality(c: EcmCriticalityCode): EcmCriticality {
  switch (c) {
    case 'PRIORITY':
      return EcmCriticality.PRIORITY;
    case 'TIME_CRITICAL':
      return EcmCriticality.TIME_CRITICAL;
    default:
      return EcmCriticality.STANDARD;
  }
}

export function toPrismaSettingsLevel(l: EcmSettingsLevelCode): EcmSettingsLevel {
  switch (l) {
    case 'PLATFORM':
      return EcmSettingsLevel.PLATFORM;
    case 'BRANCH':
      return EcmSettingsLevel.BRANCH;
    case 'CONTRACT':
      return EcmSettingsLevel.CONTRACT;
    case 'SERVICE_USER':
      return EcmSettingsLevel.SERVICE_USER;
    case 'VISIT_TEMPLATE':
      return EcmSettingsLevel.VISIT_TEMPLATE;
    case 'VISIT':
      return EcmSettingsLevel.VISIT;
    default:
      return EcmSettingsLevel.ORGANISATION;
  }
}

export function toPrismaArrival(c: string): EcmArrivalClassification {
  return (EcmArrivalClassification as Record<string, EcmArrivalClassification>)[c]
    ?? EcmArrivalClassification.NOT_ASSESSED;
}

export function toPrismaDeparture(c: string): EcmDepartureClassification {
  return (EcmDepartureClassification as Record<string, EcmDepartureClassification>)[c]
    ?? EcmDepartureClassification.NOT_ASSESSED;
}

export function toPrismaDuration(c: string): EcmDurationClassification {
  return (EcmDurationClassification as Record<string, EcmDurationClassification>)[c]
    ?? EcmDurationClassification.NOT_ASSESSED;
}

export function toPrismaMissed(c: string): EcmMissedClassification {
  return (EcmMissedClassification as Record<string, EcmMissedClassification>)[c]
    ?? EcmMissedClassification.NONE;
}

export function localVisitDateFromStart(
  plannedStart: Date,
  _timezone = DEFAULT_OPERATIONAL_TIMEZONE,
): Date {
  // Store as UTC midnight of the organisation operational calendar day via Intl when possible.
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: _timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(plannedStart);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) {
      return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    }
  } catch {
    /* fall through */
  }
  return new Date(
    Date.UTC(plannedStart.getUTCFullYear(), plannedStart.getUTCMonth(), plannedStart.getUTCDate()),
  );
}

/** True when planned start falls on operational YYYY-MM-DD in the given timezone. */
export function plannedStartOnOperationalDate(
  plannedStart: Date,
  operationalDate: string,
  timezone = DEFAULT_OPERATIONAL_TIMEZONE,
): boolean {
  const local = localVisitDateFromStart(plannedStart, timezone);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}` === operationalDate;
}

export {
  deriveArrivalWindow,
  evaluateEcmTiming,
  orgSettingsToEcmLayer,
  resolveEcmSettings,
};

export type { EcmSettingsLayer };

export const CHECK_IN_EVENT = VisitAttendanceEventType.CHECK_IN;
export const CHECK_OUT_EVENT = VisitAttendanceEventType.CHECK_OUT;

export type EcmEvaluationUpsertData = Prisma.EcmVisitEvaluationUncheckedCreateInput;
