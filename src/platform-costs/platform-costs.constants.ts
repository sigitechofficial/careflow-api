export const PLATFORM_COSTS_READ = 'platform_costs.read';
export const PLATFORM_COSTS_MANAGE = 'platform_costs.manage';

export const SYNC_KINDS = [
  'costs',
  'prices',
  'budgets',
  'forecast',
  'advisor',
] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];
export type SyncTrigger = 'schedule' | 'manual';
export type SyncStatus = 'running' | 'success' | 'failed';

export const GROUP_BY_VALUES = [
  'service',
  'resource',
  'resourceGroup',
  'meter',
] as const;
export type CostGroupBy = (typeof GROUP_BY_VALUES)[number];

export const ANOMALY_STATUSES = ['open', 'acknowledged'] as const;
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number];

/** Manual sync: at most one per window (persisted via AzureSyncRun, survives restarts). */
export const MANUAL_SYNC_WINDOW_MS = 5 * 60 * 1000;

/** Scheduled cadence (hourly tick; runs when the last success is older than this). */
export const COSTS_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DAILY_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** A "running" row older than this is treated as abandoned (process restart mid-sync). */
export const STALE_RUNNING_MS = 60 * 60 * 1000;

export const MONTHLY_REPORT_DAY_OF_MONTH = 1;
export const MONTHLY_REPORT_HOUR = 8;

export const SETTINGS_ID = 'default';
