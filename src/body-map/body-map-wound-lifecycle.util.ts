import { BodyMapConditionStatus } from '@prisma/client';

export const WOUND_LIFECYCLE_STATUSES = [
  'NEW',
  'ACTIVE',
  'TREATMENT_PLANNED',
  'IMPROVING',
  'UNCHANGED',
  'WORSENING',
  'REFERRED',
  'HEALED',
  'CLOSED',
  'ARCHIVED',
] as const;

export type WoundLifecycleStatus = (typeof WOUND_LIFECYCLE_STATUSES)[number];

export function woundLifecycleLabel(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function readWoundLifecycleStatus(
  assessmentData: unknown,
): WoundLifecycleStatus | null {
  if (!assessmentData || typeof assessmentData !== 'object') return null;
  const s = (assessmentData as { woundLifecycleStatus?: string }).woundLifecycleStatus;
  return WOUND_LIFECYCLE_STATUSES.includes(s as WoundLifecycleStatus)
    ? (s as WoundLifecycleStatus)
    : null;
}

export function withWoundLifecycle(
  prior: Record<string, unknown>,
  status: WoundLifecycleStatus,
): Record<string, unknown> {
  const history = Array.isArray(prior.lifecycleHistory)
    ? [...(prior.lifecycleHistory as { status: string; at: string }[])]
    : [];
  const last = history[history.length - 1];
  if (!last || last.status !== status) {
    history.push({ status, at: new Date().toISOString() });
  }
  return {
    ...prior,
    woundLifecycleStatus: status,
    lifecycleHistory: history,
  };
}

export function initialWoundLifecycleData(): Record<string, unknown> {
  return withWoundLifecycle({}, 'NEW');
}

export function deriveWoundLifecycleFromReview(opts: {
  conditionStatus: BodyMapConditionStatus;
  progressionComparison?: 'BETTER' | 'SAME' | 'WORSE';
  escalationRequired?: boolean;
  professionalInvolvement?: string | null;
}): WoundLifecycleStatus {
  if (opts.conditionStatus === BodyMapConditionStatus.RESOLVED) return 'HEALED';
  if (opts.professionalInvolvement?.trim()) return 'REFERRED';
  if (opts.escalationRequired) return 'WORSENING';
  if (opts.conditionStatus === BodyMapConditionStatus.WORSENING) return 'WORSENING';
  if (opts.conditionStatus === BodyMapConditionStatus.IMPROVING) return 'IMPROVING';
  if (opts.progressionComparison === 'BETTER') return 'IMPROVING';
  if (opts.progressionComparison === 'WORSE') return 'WORSENING';
  if (opts.progressionComparison === 'SAME') return 'UNCHANGED';
  if (opts.conditionStatus === BodyMapConditionStatus.UNCHANGED) return 'UNCHANGED';
  return 'ACTIVE';
}

export function deriveWoundLifecycleFromAssessment(opts: {
  dressing?: string | null;
  nextDressingChange?: Date | null;
  professionalInvolvement?: string | null;
  current?: WoundLifecycleStatus | null;
}): WoundLifecycleStatus | null {
  if (opts.professionalInvolvement?.trim()) return 'REFERRED';
  if (opts.dressing?.trim() && opts.nextDressingChange) {
    if (!opts.current || opts.current === 'NEW' || opts.current === 'ACTIVE') {
      return 'TREATMENT_PLANNED';
    }
  }
  if (opts.current === 'NEW') return 'ACTIVE';
  return null;
}
