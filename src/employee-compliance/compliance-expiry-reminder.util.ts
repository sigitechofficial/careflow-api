import {
  COMPLIANCE_STAGE_DAYS,
  type ComplianceReminderStage,
} from '../organisation-general-settings/review-settings.util';

const DAY_MS = 86_400_000;

/** Whole calendar days (UTC) from `today` to `expiry`; negative once expired. */
export function daysToExpiry(expiry: Date, today: Date): number {
  const e = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((e - t) / DAY_MS);
}

/**
 * The reminder stage a record needs today, or null. Each enabled "days before" stage is a
 * threshold: the latest one crossed is returned, so a day the job did not run is caught up once
 * and a record added 20 days before expiry gets the 30-day reminder, not the 90 and 60 as well.
 * EXPIRED is sent once the expiry date has passed (the expiry day itself is still valid).
 */
export function complianceReminderStage(
  daysLeft: number,
  enabled: readonly ComplianceReminderStage[],
): ComplianceReminderStage | null {
  if (daysLeft < 0) return enabled.includes('EXPIRED') ? 'EXPIRED' : null;
  let best: { stage: ComplianceReminderStage; threshold: number } | null = null;
  for (const stage of enabled) {
    if (stage === 'EXPIRED') continue;
    const threshold = COMPLIANCE_STAGE_DAYS[stage];
    if (daysLeft <= threshold && (!best || threshold < best.threshold)) best = { stage, threshold };
  }
  return best?.stage ?? null;
}

/** Furthest ahead any enabled stage looks, so the job only loads records that can need one. */
export function complianceReminderHorizonDays(enabled: readonly ComplianceReminderStage[]): number {
  return Math.max(
    0,
    ...enabled.filter((s): s is Exclude<ComplianceReminderStage, 'EXPIRED'> => s !== 'EXPIRED').map((s) => COMPLIANCE_STAGE_DAYS[s]),
  );
}

/** "expires in 30 days", "expires today", "expired on 3 Nov 2026". */
export function expiryText(daysLeft: number, expiryLabel: string): string {
  if (daysLeft < 0) return `expired on ${expiryLabel}`;
  if (daysLeft === 0) return 'expires today';
  if (daysLeft === 1) return 'expires tomorrow';
  return `expires in ${daysLeft} days (${expiryLabel})`;
}
