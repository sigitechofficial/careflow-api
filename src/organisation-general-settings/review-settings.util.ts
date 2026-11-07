import type { Prisma } from '@prisma/client';
import {
  CARE_PLAN_LIST_DUE_WITHIN_DAYS,
  CARE_PLAN_REVIEW_DUE_SOON_DAYS,
} from '../service-user-care-plans/care-plan-review-schedule';

/**
 * Settings → Reviews & reminders. Stored as JSON on the organisation settings row
 * (`reviewSettings`); missing or invalid keys fall back to the defaults below and unknown keys are
 * dropped on the next save. The admin reads the parsed value (defaults filled in) from
 * GET /organisation-general-settings, so the defaults live only here.
 */

export const COMPLIANCE_REMINDER_STAGES = [
  'EXPIRY_90_DAYS',
  'EXPIRY_60_DAYS',
  'EXPIRY_30_DAYS',
  'EXPIRY_7_DAYS',
  'EXPIRED',
] as const;
export type ComplianceReminderStage = (typeof COMPLIANCE_REMINDER_STAGES)[number];

/** Days before expiry each stage is sent (EXPIRED = after the expiry date). */
export const COMPLIANCE_STAGE_DAYS: Record<Exclude<ComplianceReminderStage, 'EXPIRED'>, number> = {
  EXPIRY_90_DAYS: 90,
  EXPIRY_60_DAYS: 60,
  EXPIRY_30_DAYS: 30,
  EXPIRY_7_DAYS: 7,
};

export const RISK_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type RiskLevelKey = (typeof RISK_LEVELS)[number];

/** Organisation override of one assessment tool's review schedule. Unset = the built-in value. */
export type AssessmentIntervalOverride = {
  defaultIntervalDays?: number;
  elevatedRiskIntervalDays?: number;
  dueSoonLeadDays?: number;
};

export type ReviewSettings = {
  /** Hour of day (0–23, organisation timezone) the hourly reminder jobs start sending. */
  reminderHour: number;
  /** Overdue care plan / assessment reviews are reminded again every this many days. */
  reminderRepeatDays: number;

  /** A published care plan shows as Due soon this many days before its review date. */
  carePlanDueSoonDays: number;
  /** Service user list: amber care plan icon when a review is due within this many days. */
  carePlanListDueWithinDays: number;

  /** Hourly assessment review reminders (job `assessment-review-reminders`). */
  assessmentRemindersEnabled: boolean;
  /** Per assessment tool overrides, keyed by assessment key (e.g. `waterlow`, `must`). */
  assessmentIntervals: Record<string, AssessmentIntervalOverride>;

  /** Hourly compliance / DBS expiry reminders (job `compliance-expiry-reminders`). */
  complianceRemindersEnabled: boolean;
  /** Which reminders go out: 90, 60, 30 and 7 days before expiry, and once expired. */
  complianceReminderStages: ComplianceReminderStage[];
  /** Push the reminder to the employee's carer app as well. */
  complianceNotifyEmployee: boolean;
  /** Email managers as well as the in-app notification. */
  complianceEmailReminders: boolean;

  /** Initial assessment risks: default review date, in days, by risk level. */
  riskReviewDays: Record<RiskLevelKey, number>;

  /** Visit plan drafted from an approved initial assessment: first review this many days later. */
  visitPlanFirstReviewDays: number;
  /** Suspending a visit plan: default "review suspension by" date, this many days ahead. */
  visitPlanSuspensionReviewDays: number;

  /** Medication dashboard: courses ending and pack reviews within this many days. */
  medicationDueSoonDays: number;
  /** Medication dashboard: medication reviews due within this many days count as due soon. */
  medicationReviewDueSoonDays: number;
};

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  reminderHour: 8,
  reminderRepeatDays: 7,
  carePlanDueSoonDays: CARE_PLAN_REVIEW_DUE_SOON_DAYS,
  carePlanListDueWithinDays: CARE_PLAN_LIST_DUE_WITHIN_DAYS,
  assessmentRemindersEnabled: true,
  assessmentIntervals: {},
  complianceRemindersEnabled: true,
  complianceReminderStages: [...COMPLIANCE_REMINDER_STAGES],
  complianceNotifyEmployee: true,
  complianceEmailReminders: false,
  riskReviewDays: { HIGH: 14, MEDIUM: 30, LOW: 90 },
  visitPlanFirstReviewDays: 42,
  visitPlanSuspensionReviewDays: 7,
  medicationDueSoonDays: 14,
  medicationReviewDueSoonDays: 30,
};

export const MAX_REVIEW_INTERVAL_DAYS = 730;
const ASSESSMENT_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function intInRange(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

function optionalInt(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseAssessmentIntervals(v: unknown): Record<string, AssessmentIntervalOverride> {
  const out: Record<string, AssessmentIntervalOverride> = {};
  for (const [key, raw] of Object.entries(record(v))) {
    if (!ASSESSMENT_KEY_RE.test(key)) continue;
    const r = record(raw);
    const entry: AssessmentIntervalOverride = {};
    const d = optionalInt(r.defaultIntervalDays, 1, MAX_REVIEW_INTERVAL_DAYS);
    const e = optionalInt(r.elevatedRiskIntervalDays, 1, MAX_REVIEW_INTERVAL_DAYS);
    const lead = optionalInt(r.dueSoonLeadDays, 0, 90);
    if (d !== undefined) entry.defaultIntervalDays = d;
    if (e !== undefined) entry.elevatedRiskIntervalDays = e;
    if (lead !== undefined) entry.dueSoonLeadDays = lead;
    if (Object.keys(entry).length) out[key] = entry;
  }
  return out;
}

function parseStages(v: unknown): ComplianceReminderStage[] {
  if (!Array.isArray(v)) return [...DEFAULT_REVIEW_SETTINGS.complianceReminderStages];
  const set = new Set(v.filter((s): s is ComplianceReminderStage => COMPLIANCE_REMINDER_STAGES.includes(s)));
  // Keep the canonical order whatever order the client sent.
  return COMPLIANCE_REMINDER_STAGES.filter((s) => set.has(s));
}

export function parseReviewSettings(value: Prisma.JsonValue | null | undefined): ReviewSettings {
  const raw = record(value);
  const d = DEFAULT_REVIEW_SETTINGS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const risk = record(raw.riskReviewDays);
  return {
    reminderHour: intInRange(raw.reminderHour, 0, 23, d.reminderHour),
    reminderRepeatDays: intInRange(raw.reminderRepeatDays, 1, 90, d.reminderRepeatDays),
    carePlanDueSoonDays: intInRange(raw.carePlanDueSoonDays, 1, 180, d.carePlanDueSoonDays),
    carePlanListDueWithinDays: intInRange(raw.carePlanListDueWithinDays, 1, 90, d.carePlanListDueWithinDays),
    assessmentRemindersEnabled: bool(raw.assessmentRemindersEnabled, d.assessmentRemindersEnabled),
    assessmentIntervals: parseAssessmentIntervals(raw.assessmentIntervals),
    complianceRemindersEnabled: bool(raw.complianceRemindersEnabled, d.complianceRemindersEnabled),
    complianceReminderStages: parseStages(raw.complianceReminderStages),
    complianceNotifyEmployee: bool(raw.complianceNotifyEmployee, d.complianceNotifyEmployee),
    complianceEmailReminders: bool(raw.complianceEmailReminders, d.complianceEmailReminders),
    riskReviewDays: {
      HIGH: intInRange(risk.HIGH, 1, 365, d.riskReviewDays.HIGH),
      MEDIUM: intInRange(risk.MEDIUM, 1, 365, d.riskReviewDays.MEDIUM),
      LOW: intInRange(risk.LOW, 1, 365, d.riskReviewDays.LOW),
    },
    visitPlanFirstReviewDays: intInRange(raw.visitPlanFirstReviewDays, 1, 365, d.visitPlanFirstReviewDays),
    visitPlanSuspensionReviewDays: intInRange(
      raw.visitPlanSuspensionReviewDays,
      1,
      90,
      d.visitPlanSuspensionReviewDays,
    ),
    medicationDueSoonDays: intInRange(raw.medicationDueSoonDays, 1, 90, d.medicationDueSoonDays),
    medicationReviewDueSoonDays: intInRange(raw.medicationReviewDueSoonDays, 1, 180, d.medicationReviewDueSoonDays),
  };
}

/**
 * Reads Settings → Reviews & reminders with any Prisma client or transaction, for code that runs
 * inside a transaction or has no OrganisationGeneralSettingsService (the row is a singleton).
 */
export async function loadReviewSettings(client: {
  organisationGeneralSettings: {
    findFirst(args: { select: { reviewSettings: true } }): Promise<{ reviewSettings: Prisma.JsonValue } | null>;
  };
}): Promise<ReviewSettings> {
  const row = await client.organisationGeneralSettings.findFirst({ select: { reviewSettings: true } });
  return parseReviewSettings(row?.reviewSettings);
}
