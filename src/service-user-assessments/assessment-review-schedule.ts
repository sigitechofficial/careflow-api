/**
 * CQC / NICE-aligned review intervals for holistic assessment tools.
 *
 * Schedules are advisory only — they drive alerts and due badges, never block
 * manual completion or repeat on the Care Plan assessments registry.
 *
 * Sources (UK domiciliary / care-at-home context):
 * - NICE CG32 / QS24 — MUST monthly in care settings; more often if medium/high risk
 * - NWCSP / NICE CG179 — pressure risk review at least monthly in community; weekly if high risk
 * - CQC / InspectReady — falls, nutrition, pressure linked; review after significant change
 */
import { getCarePathwayFormReviewSchedule } from './care-pathway-assessment-registry';
export type AssessmentReviewScheduleKind = 'interval' | 'event_driven';

export type AssessmentReviewSchedule = {
  kind: AssessmentReviewScheduleKind;
  /** Stable / low-risk interval in days (community care). */
  defaultIntervalDays?: number;
  /** Shorter interval when snapshot indicates elevated risk. */
  elevatedRiskIntervalDays?: number;
  /** Show "due soon" this many days before the due date. */
  dueSoonLeadDays: number;
  guidanceSource: string;
  guidanceSummary: string;
};

export type AssessmentReviewStatus =
  | 'not_started'
  | 'ok'
  | 'due_soon'
  | 'overdue'
  | 'event_driven';

export type AssessmentReviewState = {
  status: AssessmentReviewStatus;
  scheduleKind: AssessmentReviewScheduleKind;
  effectiveIntervalDays: number | null;
  nextReviewDueAt: string | null;
  lastCompletedAt: string | null;
  guidanceSource: string;
  guidanceSummary: string;
  /** True when status is due_soon or overdue — informational alert only. */
  alertActive: boolean;
};

const ADVISORY =
  'Scheduled review is a reminder only. You can complete or repeat this assessment at any time.';

export const ASSESSMENT_REVIEW_SCHEDULES: Record<string, AssessmentReviewSchedule> = {
  'mca-screening': {
    kind: 'event_driven',
    dueSoonLeadDays: 7,
    guidanceSource: 'MCA Code of Practice',
    guidanceSummary:
      'Repeat MCA screening when a specific decision arises or capacity may have changed — not on a fixed calendar.',
  },
  'skin-integrity': {
    kind: 'interval',
    defaultIntervalDays: 30,
    elevatedRiskIntervalDays: 7,
    dueSoonLeadDays: 7,
    guidanceSource: 'NWCSP / NICE CG179',
    guidanceSummary:
      'Review skin integrity at least monthly when stable; more often if pressure risk is elevated or skin changes.',
  },
  waterlow: {
    kind: 'interval',
    defaultIntervalDays: 30,
    elevatedRiskIntervalDays: 7,
    dueSoonLeadDays: 7,
    guidanceSource: 'NWCSP clinical recommendations',
    guidanceSummary:
      'Minimum monthly review in community care; weekly when Waterlow score indicates high risk. Reassess after falls, illness, or hospital discharge.',
  },
  must: {
    kind: 'interval',
    defaultIntervalDays: 30,
    elevatedRiskIntervalDays: 7,
    dueSoonLeadDays: 7,
    guidanceSource: 'NICE CG32 / QS24',
    guidanceSummary:
      'Screen on admission and at least monthly in care settings; weekly or sooner if medium/high MUST score or clinical concern.',
  },
  'falls-screening': {
    kind: 'interval',
    defaultIntervalDays: 30,
    elevatedRiskIntervalDays: 7,
    dueSoonLeadDays: 7,
    guidanceSource: 'CQC / NICE falls guidance',
    guidanceSummary:
      'Review falls risk regularly (typically monthly) and immediately after any fall, hospital admission, or mobility change.',
  },
  'moving-handling': {
    kind: 'interval',
    defaultIntervalDays: 365,
    elevatedRiskIntervalDays: 30,
    dueSoonLeadDays: 14,
    guidanceSource: 'HSE / CQC moving & handling',
    guidanceSummary:
      'Review annually when stable; sooner after equipment change, injury, or decline in mobility.',
  },
  'pain-tool': {
    kind: 'interval',
    defaultIntervalDays: 30,
    elevatedRiskIntervalDays: 7,
    dueSoonLeadDays: 7,
    guidanceSource: 'NICE pain assessment in adults',
    guidanceSummary:
      'Reassess pain at least monthly or when pain reports, behaviour, or analgesia change.',
  },
  'therapy-memoire': {
    kind: 'interval',
    defaultIntervalDays: 180,
    dueSoonLeadDays: 14,
    guidanceSource: 'Therapy referral good practice',
    guidanceSummary:
      'Review therapy needs when care needs change or at periodic intervals agreed with therapy teams.',
  },
  'environment-assessment': {
    kind: 'interval',
    defaultIntervalDays: 365,
    elevatedRiskIntervalDays: 30,
    dueSoonLeadDays: 14,
    guidanceSource: 'CQC Safe / Effective — environment',
    guidanceSummary:
      'Review home environment annually or when layout, equipment, or risks change.',
  },
  'advance-care-planning': {
    kind: 'interval',
    defaultIntervalDays: 365,
    dueSoonLeadDays: 30,
    guidanceSource: 'NICE / ReSPECT advance care planning',
    guidanceSummary:
      'Review advance care plans at least annually and when preferences or health status change.',
  },
  'end-of-life-assessment': {
    kind: 'event_driven',
    dueSoonLeadDays: 7,
    guidanceSource: 'Gold Standards Framework',
    guidanceSummary:
      'Review when a person is recognised as approaching end of life or when symptoms and preferences change.',
  },
  'mental-capacity-checklist': {
    kind: 'event_driven',
    dueSoonLeadDays: 7,
    guidanceSource: 'MCA Code of Practice',
    guidanceSummary:
      'Complete when a specific decision requires formal capacity assessment — not on a fixed schedule.',
  },
  'photography-consent': {
    kind: 'interval',
    defaultIntervalDays: 365,
    dueSoonLeadDays: 30,
    guidanceSource: 'ICO / consent management',
    guidanceSummary: 'Renew photography consent annually or when consent scope changes.',
  },
};

export function getAssessmentReviewSchedule(
  assessmentKey: string,
  carePathwayFormName?: string | null,
): AssessmentReviewSchedule | null {
  return (
    ASSESSMENT_REVIEW_SCHEDULES[assessmentKey] ??
    getCarePathwayFormReviewSchedule(carePathwayFormName) ??
    null
  );
}

function numField(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Derive effective review interval from completion snapshot (risk-stratified where configured). */
export function resolveEffectiveReviewIntervalDays(
  assessmentKey: string,
  snapshot?: Record<string, unknown> | null,
  carePathwayFormName?: string | null,
): number | null {
  const schedule = getAssessmentReviewSchedule(assessmentKey, carePathwayFormName);
  if (!schedule || schedule.kind !== 'interval') return null;
  const defaultDays = schedule.defaultIntervalDays ?? null;
  const elevatedDays = schedule.elevatedRiskIntervalDays;
  if (!snapshot || typeof snapshot !== 'object' || elevatedDays == null) return defaultDays;

  if (assessmentKey === 'waterlow') {
    const raw = snapshot.waterlow;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const score = numField(raw as Record<string, unknown>, 'score');
      if (score != null && score >= 15) return elevatedDays;
    }
  }

  if (assessmentKey === 'must') {
    const raw = snapshot.must;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const row = raw as Record<string, unknown>;
      const score = numField(row, 'score');
      const level = row.riskLevel;
      if (score != null && score >= 1) return elevatedDays;
      if (level === 'medium' || level === 'high') return elevatedDays;
    }
  }

  if (assessmentKey === 'falls-screening' || assessmentKey === 'skin-integrity') {
    // Keep monthly unless org policy adds score-based tiers later.
    return defaultDays;
  }

  if (assessmentKey === 'moving-handling') {
    const raw = snapshot.movingHandlingOperations;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const rf = (raw as Record<string, unknown>).riskFilter;
      if (rf && typeof rf === 'object' && (rf as Record<string, unknown>).totallyIndependentLowRisk === false) {
        return elevatedDays;
      }
    }
  }

  return defaultDays;
}

export function computeAssessmentReviewState(params: {
  assessmentKey: string;
  carePathwayFormName?: string | null;
  lastCompletedAt?: string | Date | null;
  snapshot?: Record<string, unknown> | null;
  now?: Date;
}): AssessmentReviewState {
  const schedule = getAssessmentReviewSchedule(params.assessmentKey, params.carePathwayFormName);
  const now = params.now ?? new Date();
  const lastAt = params.lastCompletedAt
    ? params.lastCompletedAt instanceof Date
      ? params.lastCompletedAt
      : new Date(params.lastCompletedAt)
    : null;

  if (!schedule) {
    return {
      status: lastAt ? 'ok' : 'not_started',
      scheduleKind: 'event_driven',
      effectiveIntervalDays: null,
      nextReviewDueAt: null,
      lastCompletedAt: lastAt?.toISOString() ?? null,
      guidanceSource: 'Organisation policy',
      guidanceSummary: ADVISORY,
      alertActive: false,
    };
  }

  if (schedule.kind === 'event_driven') {
    return {
      status: lastAt ? 'event_driven' : 'not_started',
      scheduleKind: 'event_driven',
      effectiveIntervalDays: null,
      nextReviewDueAt: null,
      lastCompletedAt: lastAt?.toISOString() ?? null,
      guidanceSource: schedule.guidanceSource,
      guidanceSummary: `${schedule.guidanceSummary} ${ADVISORY}`,
      alertActive: false,
    };
  }

  if (!lastAt) {
    return {
      status: 'not_started',
      scheduleKind: 'interval',
      effectiveIntervalDays: schedule.defaultIntervalDays ?? null,
      nextReviewDueAt: null,
      lastCompletedAt: null,
      guidanceSource: schedule.guidanceSource,
      guidanceSummary: `${schedule.guidanceSummary} ${ADVISORY}`,
      alertActive: false,
    };
  }

  const intervalDays = resolveEffectiveReviewIntervalDays(
    params.assessmentKey,
    params.snapshot,
    params.carePathwayFormName,
  );
  if (intervalDays == null) {
    return {
      status: 'ok',
      scheduleKind: 'interval',
      effectiveIntervalDays: null,
      nextReviewDueAt: null,
      lastCompletedAt: lastAt.toISOString(),
      guidanceSource: schedule.guidanceSource,
      guidanceSummary: `${schedule.guidanceSummary} ${ADVISORY}`,
      alertActive: false,
    };
  }

  const dueAt = new Date(lastAt.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  const leadMs = schedule.dueSoonLeadDays * 24 * 60 * 60 * 1000;
  let status: AssessmentReviewStatus = 'ok';
  if (now.getTime() > dueAt.getTime()) status = 'overdue';
  else if (dueAt.getTime() - now.getTime() <= leadMs) status = 'due_soon';

  return {
    status,
    scheduleKind: 'interval',
    effectiveIntervalDays: intervalDays,
    nextReviewDueAt: dueAt.toISOString(),
    lastCompletedAt: lastAt.toISOString(),
    guidanceSource: schedule.guidanceSource,
    guidanceSummary: `${schedule.guidanceSummary} ${ADVISORY}`,
    alertActive: status === 'due_soon' || status === 'overdue',
  };
}
