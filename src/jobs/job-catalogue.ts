/**
 * Scheduled jobs catalogue — the single list of the 12 background jobs.
 * Names are the canonical IDs used everywhere (JobRun.jobName, POST /internal/jobs/:name,
 * the CLI, the Azure Functions and Container Apps Jobs, the admin System jobs screen).
 */
export const JOB_NAMES = [
  'survey-distribution',
  'visit-start-reminder',
  'late-visit-alert',
  'ecm-missed-visit',
  'ecm-missing-checkout',
  'platform-costs-sync',
  'employee-payout-auto',
  'rolling-rota',
  'visit-plan-scheduled-end',
  'learning-maintenance',
  'care-plan-review-reminders',
  'over-care-review',
] as const;

export type JobName = (typeof JOB_NAMES)[number];

/** Where the job runs in Azure: a timer Function calling the API, or a Container Apps Job (CLI). */
export type JobTrigger = 'function' | 'container-job';

/**
 * How a scheduled run's period key is derived:
 * - `minutes`: UTC bucket of N minutes (`2026-10-02T10:05Z`); hourly jobs use 60.
 * - `utc-date`: UTC calendar date (`2026-10-02`).
 * - `org-date`: calendar date in the organisation's operational timezone.
 */
export type PeriodGranularity =
  | { kind: 'minutes'; minutes: number }
  | { kind: 'utc-date' }
  | { kind: 'org-date' };

export type JobDefinition = {
  name: JobName;
  label: string;
  description: string;
  trigger: JobTrigger;
  /** UTC schedule (5-field cron) the Azure trigger uses, plus admin-facing text. */
  schedule: { cron: string; human: string };
  expectedIntervalMinutes: number;
  period: PeriodGranularity;
  /** JobRun rows older than this are deleted by the retention pass. */
  retentionDays: number;
};

const MINUTE_JOB_RETENTION_DAYS = 7;
const DAILY_JOB_RETENTION_DAYS = 90;

export const JOB_CATALOGUE: readonly JobDefinition[] = [
  {
    name: 'survey-distribution',
    label: 'Survey distribution',
    description: 'Sends scheduled surveys whose distribution time has passed.',
    trigger: 'function',
    schedule: { cron: '* * * * *', human: 'Every minute' },
    expectedIntervalMinutes: 1,
    period: { kind: 'minutes', minutes: 1 },
    retentionDays: MINUTE_JOB_RETENTION_DAYS,
  },
  {
    name: 'visit-start-reminder',
    label: 'Visit start reminders',
    description:
      'Pushes a reminder to allocated carers 15 minutes before a visit starts.',
    trigger: 'function',
    schedule: { cron: '*/2 * * * *', human: 'Every 2 minutes' },
    expectedIntervalMinutes: 2,
    period: { kind: 'minutes', minutes: 2 },
    retentionDays: MINUTE_JOB_RETENTION_DAYS,
  },
  {
    name: 'late-visit-alert',
    label: 'Late visit alerts',
    description:
      'Alerts the office (and pushes the carer) when a visit has not started past the late threshold.',
    trigger: 'function',
    schedule: { cron: '*/5 * * * *', human: 'Every 5 minutes' },
    expectedIntervalMinutes: 5,
    period: { kind: 'minutes', minutes: 5 },
    retentionDays: MINUTE_JOB_RETENTION_DAYS,
  },
  {
    name: 'ecm-missed-visit',
    label: 'ECM missed visits',
    description:
      'Re-evaluates visits with no check-in 30 minutes after the planned start (potential missed).',
    trigger: 'function',
    schedule: { cron: '*/5 * * * *', human: 'Every 5 minutes' },
    expectedIntervalMinutes: 5,
    period: { kind: 'minutes', minutes: 5 },
    retentionDays: MINUTE_JOB_RETENTION_DAYS,
  },
  {
    name: 'ecm-missing-checkout',
    label: 'ECM missing check-outs',
    description:
      'Flags visits that were checked in but never checked out after the planned end.',
    trigger: 'function',
    schedule: { cron: '*/15 * * * *', human: 'Every 15 minutes' },
    expectedIntervalMinutes: 15,
    period: { kind: 'minutes', minutes: 15 },
    retentionDays: MINUTE_JOB_RETENTION_DAYS,
  },
  {
    name: 'platform-costs-sync',
    label: 'Azure Pricing sync',
    description:
      'Syncs Azure costs, prices and Advisor data when due and sends the monthly cost report (only when AZURE_COST_ENABLED=true).',
    trigger: 'function',
    schedule: {
      cron: '5 * * * *',
      human: 'Hourly at :05 (syncs only what is due)',
    },
    expectedIntervalMinutes: 60,
    period: { kind: 'minutes', minutes: 60 },
    retentionDays: MINUTE_JOB_RETENTION_DAYS,
  },
  {
    name: 'employee-payout-auto',
    label: 'Carer monthly payout',
    description:
      'Hourly check; pays UK net for the previous month at 06:00 on the 4th (organisation timezone).',
    trigger: 'function',
    schedule: {
      cron: '0 * * * *',
      human: 'Hourly at :00 (pays at 06:00 on the 4th, organisation time)',
    },
    expectedIntervalMinutes: 60,
    period: { kind: 'minutes', minutes: 60 },
    retentionDays: MINUTE_JOB_RETENTION_DAYS,
  },
  {
    name: 'rolling-rota',
    label: 'Rolling rota',
    description:
      'Generates scheduled visits for active, ready visit plans across the rota horizon (catch-up; existing visits are skipped).',
    trigger: 'container-job',
    schedule: { cron: '0 2 * * *', human: 'Daily at 02:00 UTC' },
    expectedIntervalMinutes: 1440,
    period: { kind: 'org-date' },
    retentionDays: DAILY_JOB_RETENTION_DAYS,
  },
  {
    name: 'visit-plan-scheduled-end',
    label: 'Visit plan scheduled end',
    description: 'Ends visit plans whose scheduled closure date has passed.',
    trigger: 'container-job',
    schedule: { cron: '30 0 * * *', human: 'Daily at 00:30 UTC' },
    expectedIntervalMinutes: 1440,
    period: { kind: 'utc-date' },
    retentionDays: DAILY_JOB_RETENTION_DAYS,
  },
  {
    name: 'learning-maintenance',
    label: 'Learning maintenance',
    description:
      'Expires certificates, creates refresher assignments, marks overdue assignments and sends learning reminders.',
    trigger: 'container-job',
    schedule: { cron: '30 2 * * *', human: 'Daily at 02:30 UTC' },
    expectedIntervalMinutes: 1440,
    period: { kind: 'utc-date' },
    retentionDays: DAILY_JOB_RETENTION_DAYS,
  },
  {
    name: 'care-plan-review-reminders',
    label: 'Care plan review reminders',
    description: 'Sends reminders for care plans whose review date is due.',
    trigger: 'container-job',
    schedule: { cron: '0 6 * * *', human: 'Daily at 06:00 UTC' },
    expectedIntervalMinutes: 1440,
    period: { kind: 'utc-date' },
    retentionDays: DAILY_JOB_RETENTION_DAYS,
  },  {
    name: 'over-care-review',
    label: 'Over care reviews',
    description:
      "Raises a review request for each service user who got more care than their weekly hours last week, and notifies managers. Runs whether or not auto-extend rota is on.",
    trigger: 'container-job',
    schedule: { cron: '45 2 * * *', human: 'Daily at 02:45 UTC (after rolling rota)' },
    expectedIntervalMinutes: 1440,
    period: { kind: 'org-date' },
    retentionDays: DAILY_JOB_RETENTION_DAYS,
  },

];

const BY_NAME = new Map<string, JobDefinition>(
  JOB_CATALOGUE.map((j) => [j.name, j]),
);

export function isJobName(value: string): value is JobName {
  return BY_NAME.has(value);
}

export function getJobDefinition(name: string): JobDefinition | undefined {
  return BY_NAME.get(name);
}

export function isDailyJob(def: JobDefinition): boolean {
  return def.period.kind !== 'minutes';
}

/**
 * A trigger that arrives up to this much before a bucket boundary (clock skew between the
 * Function host and the API) still counts for the upcoming bucket.
 */
export const PERIOD_EARLY_TOLERANCE_MS = 5_000;

/** `2026-10-02T10:05Z` — ISO minute in UTC. */
export function isoMinuteUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16)}Z`;
}

/** Calendar date (YYYY-MM-DD) in an IANA timezone. */
export function isoDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Scheduled period key for a run at `now`.
 * `orgTimeZone` is only used by `org-date` jobs (rolling rota).
 */
export function periodKeyFor(
  def: JobDefinition,
  now: Date,
  orgTimeZone?: string,
): string {
  const t = now.getTime() + PERIOD_EARLY_TOLERANCE_MS;
  switch (def.period.kind) {
    case 'minutes': {
      const bucketMs = def.period.minutes * 60_000;
      return isoMinuteUtc(new Date(Math.floor(t / bucketMs) * bucketMs));
    }
    case 'utc-date':
      return new Date(t).toISOString().slice(0, 10);
    case 'org-date':
      return isoDateInTimeZone(new Date(t), orgTimeZone || 'UTC');
  }
}

/** Period key for an admin "Run now": `manual:<ISO minute>` (also the 1-per-minute guard). */
export function manualPeriodKey(now: Date): string {
  return `manual:${isoMinuteUtc(now)}`;
}

/** Accepted shape for an explicit period key (internal trigger body / CLI flag). */
export const PERIOD_KEY_PATTERN = /^[A-Za-z0-9:._+-]{1,64}$/;
