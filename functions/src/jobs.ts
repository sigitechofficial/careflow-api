/**
 * The 12 Careflow jobs that are triggered from Azure Functions (trigger = `function` in the
 * scheduled-jobs contract). The function name IS the job name: it is the canonical ID used by
 * the API (`POST /internal/jobs/:name`), the JobRun table, the admin "System jobs" screen and the
 * per-function kill switch app setting `AzureWebJobs.<name>.Disabled`.
 *
 * Schedules are NCRONTAB (6 fields: second minute hour day month day-of-week) and run in UTC
 * (Flex Consumption is Linux, where WEBSITE_TIME_ZONE is not supported — keep everything UTC).
 *
 * The 4 daily jobs (rolling-rota, visit-plan-scheduled-end, learning-maintenance,
 * care-plan-review-reminders) are NOT here: they run as Container Apps Jobs (API image CLI).
 */
export const FUNCTION_JOBS = [
  { name: 'survey-distribution', schedule: '0 * * * * *', description: 'every minute' },
  { name: 'visit-start-reminder', schedule: '0 */2 * * * *', description: 'every 2 minutes' },
  { name: 'late-visit-alert', schedule: '0 */5 * * * *', description: 'every 5 minutes' },
  { name: 'ecm-missed-visit', schedule: '0 */5 * * * *', description: 'every 5 minutes' },
  { name: 'ecm-missing-checkout', schedule: '0 */15 * * * *', description: 'every 15 minutes' },
  { name: 'platform-costs-sync', schedule: '0 5 * * * *', description: 'hourly at :05' },
  { name: 'employee-payout-auto', schedule: '0 0 * * * *', description: 'hourly at :00' },
  { name: 'supervision-reminders', schedule: '0 10 * * * *', description: 'hourly at :10' },
  { name: 'compliance-expiry-reminders', schedule: '0 20 * * * *', description: 'hourly at :20' },
  { name: 'assessment-review-reminders', schedule: '0 25 * * * *', description: 'hourly at :25' },
  { name: 'policy-acknowledgement-reminders', schedule: '0 35 * * * *', description: 'hourly at :35' },
  { name: 'referral-mailbox-check', schedule: '0 */2 * * * *', description: 'every 2 minutes' },
] as const;

export type FunctionJobName = (typeof FUNCTION_JOBS)[number]['name'];
