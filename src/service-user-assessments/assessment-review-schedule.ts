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
import {
  CARE_PATHWAY_ASSESSMENT_CATALOG,
  resolveCarePathwayAssessmentCatalogEntry,
} from './care-pathway-assessment-registry';
import { IA_ASSESSMENT_TOOL_CATALOGUE } from './assessment-tool-registry';
import type { AssessmentIntervalOverride } from '../organisation-general-settings/review-settings.util';
import {
  isPainElevatedReview,
  type PainAssessmentMetadataLike,
} from '../initial-assessments/initial-assessment-abbey.util';
export type AssessmentReviewScheduleKind = 'interval' | 'event_driven';

export type AssessmentReviewSchedule = {
  kind: AssessmentReviewScheduleKind;
  /** Stable / low-risk interval in days (community care). */
  defaultIntervalDays?: number;
  /** Shorter interval when snapshot indicates elevated risk. */
  elevatedRiskIntervalDays?: number;
  /** Show "due soon" this many days before the due date. */
  dueSoonLeadDays: number;
  /**
   * Score-based tools: a completion scoring at least this uses `elevatedRiskIntervalDays`
   * (Waterlow 15+ = high risk, MUST 1+ = medium/high risk). The admin uses it to pre-fill the
   * next review date on the initial assessment, so the rule lives only here.
   */
  elevatedRiskScoreFrom?: number;
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
    elevatedRiskScoreFrom: 15,
    guidanceSource: 'NWCSP clinical recommendations',
    guidanceSummary:
      'Minimum monthly review in community care; weekly when Waterlow score indicates high risk. Reassess after falls, illness, or hospital discharge.',
  },
  must: {
    kind: 'interval',
    defaultIntervalDays: 30,
    elevatedRiskIntervalDays: 7,
    dueSoonLeadDays: 7,
    elevatedRiskScoreFrom: 1,
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

/** Organisation overrides (Settings → Reviews & reminders), keyed by schedule key. */
export type AssessmentScheduleOverrides = Record<string, AssessmentIntervalOverride>;

function withOverride(
  schedule: AssessmentReviewSchedule,
  override: AssessmentIntervalOverride | undefined,
): AssessmentReviewSchedule {
  if (!override || schedule.kind !== 'interval') return schedule;
  return {
    ...schedule,
    ...(override.defaultIntervalDays !== undefined ? { defaultIntervalDays: override.defaultIntervalDays } : {}),
    ...(override.elevatedRiskIntervalDays !== undefined && schedule.elevatedRiskIntervalDays !== undefined
      ? { elevatedRiskIntervalDays: override.elevatedRiskIntervalDays }
      : {}),
    ...(override.dueSoonLeadDays !== undefined ? { dueSoonLeadDays: override.dueSoonLeadDays } : {}),
  };
}

/**
 * Key an organisation override is stored under: the tool's assessment key, or the catalogue slug
 * for a Care Pathway assessment form (whose assessment key is the form id).
 */
export function assessmentScheduleKey(
  assessmentKey: string,
  carePathwayFormName?: string | null,
): string | null {
  if (ASSESSMENT_REVIEW_SCHEDULES[assessmentKey]) return assessmentKey;
  return resolveCarePathwayAssessmentCatalogEntry(carePathwayFormName)?.nameSlug ?? null;
}

export function getAssessmentReviewSchedule(
  assessmentKey: string,
  carePathwayFormName?: string | null,
  overrides?: AssessmentScheduleOverrides,
): AssessmentReviewSchedule | null {
  const tool = ASSESSMENT_REVIEW_SCHEDULES[assessmentKey];
  if (tool) return withOverride(tool, overrides?.[assessmentKey]);
  const entry = resolveCarePathwayAssessmentCatalogEntry(carePathwayFormName);
  return entry ? withOverride(entry.reviewSchedule, overrides?.[entry.nameSlug]) : null;
}

export type AssessmentReviewScheduleRow = {
  /** Key overrides are stored under (tool key or Care Pathway form slug). */
  key: string;
  title: string;
  source: 'assessment_tool' | 'care_pathway_form';
  /** Schedule in force (built-in values with the organisation's overrides applied). */
  schedule: AssessmentReviewSchedule;
  /** Built-in values, shown as the default and used by "reset". */
  builtIn: Pick<AssessmentReviewSchedule, 'defaultIntervalDays' | 'elevatedRiskIntervalDays' | 'dueSoonLeadDays'>;
  overridden: boolean;
};

/** Every assessment review schedule, as the admin shows and edits them. */
export function listAssessmentReviewSchedules(
  overrides: AssessmentScheduleOverrides = {},
): AssessmentReviewScheduleRow[] {
  const titleByKey = new Map<string, string>(
    IA_ASSESSMENT_TOOL_CATALOGUE.map((t) => [t.assessmentKey, t.title] as [string, string]),
  );
  const row = (
    key: string,
    title: string,
    source: AssessmentReviewScheduleRow['source'],
    base: AssessmentReviewSchedule,
  ): AssessmentReviewScheduleRow => ({
    key,
    title,
    source,
    schedule: withOverride(base, overrides[key]),
    builtIn: {
      defaultIntervalDays: base.defaultIntervalDays,
      elevatedRiskIntervalDays: base.elevatedRiskIntervalDays,
      dueSoonLeadDays: base.dueSoonLeadDays,
    },
    overridden: base.kind === 'interval' && Boolean(overrides[key]),
  });
  return [
    ...Object.entries(ASSESSMENT_REVIEW_SCHEDULES).map(([key, base]) =>
      row(key, titleByKey.get(key) ?? key, 'assessment_tool', base),
    ),
    ...CARE_PATHWAY_ASSESSMENT_CATALOG.map((entry) =>
      row(entry.nameSlug, entry.formName, 'care_pathway_form', entry.reviewSchedule),
    ),
  ];
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
  overrides?: AssessmentScheduleOverrides,
): number | null {
  const schedule = getAssessmentReviewSchedule(assessmentKey, carePathwayFormName, overrides);
  if (!schedule || schedule.kind !== 'interval') return null;
  const defaultDays = schedule.defaultIntervalDays ?? null;
  const elevatedDays = schedule.elevatedRiskIntervalDays;
  if (!snapshot || typeof snapshot !== 'object' || elevatedDays == null) return defaultDays;

  if (assessmentKey === 'waterlow') {
    const raw = snapshot.waterlow;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const score = numField(raw as Record<string, unknown>, 'score');
      if (score != null && score >= (schedule.elevatedRiskScoreFrom ?? 15)) return elevatedDays;
    }
  }

  if (assessmentKey === 'must') {
    const raw = snapshot.must;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const row = raw as Record<string, unknown>;
      const score = numField(row, 'score');
      const level = row.riskLevel;
      if (score != null && score >= (schedule.elevatedRiskScoreFrom ?? 1)) return elevatedDays;
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

  if (assessmentKey === 'pain-tool') {
    const raw = snapshot.painAssessment;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if (isPainElevatedReview(raw as PainAssessmentMetadataLike)) return elevatedDays;
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
  /** Settings → Reviews & reminders `assessmentIntervals`. */
  overrides?: AssessmentScheduleOverrides;
}): AssessmentReviewState {
  const schedule = getAssessmentReviewSchedule(params.assessmentKey, params.carePathwayFormName, params.overrides);
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
    params.overrides,
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
