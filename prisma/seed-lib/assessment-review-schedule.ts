/**
 * Assessment review schedule — deploy-safe copy for prisma seeds.
 * Mirrors src/service-user-assessments/assessment-review-schedule.ts schedule
 * tables + computeAssessmentReviewState, without importing from src/
 * (no care-pathway registry / abbey util — seed only uses known assessment keys).
 */
export type AssessmentReviewScheduleKind = 'interval' | 'event_driven';

export type AssessmentReviewSchedule = {
  kind: AssessmentReviewScheduleKind;
  defaultIntervalDays?: number;
  elevatedRiskIntervalDays?: number;
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
  'equipment-selection': {
    kind: 'event_driven',
    dueSoonLeadDays: 14,
    guidanceSource: 'Pressure-care / equipment good practice',
    guidanceSummary:
      'Review equipment selection when Waterlow, mobility, or the equipment in place changes.',
  },
  peep: {
    kind: 'event_driven',
    dueSoonLeadDays: 14,
    guidanceSource: 'Fire safety / PEEP good practice',
    guidanceSummary:
      'Review the personal emergency evacuation plan when mobility, equipment, or the home layout changes, and by the recorded review date.',
  },
};

export function getAssessmentReviewSchedule(
  assessmentKey: string,
): AssessmentReviewSchedule | null {
  return ASSESSMENT_REVIEW_SCHEDULES[assessmentKey] ?? null;
}

function numField(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Lightweight pain elevated check (seed-safe; mirrors abbey util thresholds). */
function isPainElevatedReview(pain: Record<string, unknown> | undefined): boolean {
  if (!pain) return false;
  const nrs = pain.nrsScore;
  if (typeof nrs === 'number' && nrs >= 4) return true;
  const abbey = pain.abbey;
  if (abbey && typeof abbey === 'object' && !Array.isArray(abbey)) {
    const total = (abbey as { total?: number }).total;
    if (typeof total === 'number' && total >= 8) return true;
  }
  return false;
}

export function resolveEffectiveReviewIntervalDays(
  assessmentKey: string,
  snapshot?: Record<string, unknown> | null,
): number | null {
  const schedule = getAssessmentReviewSchedule(assessmentKey);
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
    return defaultDays;
  }

  if (assessmentKey === 'moving-handling') {
    const raw = snapshot.movingHandlingOperations;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const rf = (raw as Record<string, unknown>).riskFilter;
      if (
        rf &&
        typeof rf === 'object' &&
        (rf as Record<string, unknown>).totallyIndependentLowRisk === false
      ) {
        return elevatedDays;
      }
    }
  }

  if (assessmentKey === 'pain-tool') {
    const raw = snapshot.painAssessment;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if (isPainElevatedReview(raw as Record<string, unknown>)) return elevatedDays;
    }
  }

  return defaultDays;
}

export function computeAssessmentReviewState(params: {
  assessmentKey: string;
  lastCompletedAt?: string | Date | null;
  snapshot?: Record<string, unknown> | null;
  now?: Date;
}): AssessmentReviewState {
  const schedule = getAssessmentReviewSchedule(params.assessmentKey);
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
