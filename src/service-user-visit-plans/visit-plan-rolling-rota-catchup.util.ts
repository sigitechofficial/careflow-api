import {
  addDaysToIsoDate,
  clampRotaHorizonDays,
  endOfMonthIsoDate,
  parseIsoDateUtc,
  type RotaHorizonMode,
} from './visit-plan-rolling-rota.util';

/**
 * Rolling rota catch-up: every run (re)generates the WHOLE window instead of only the far-edge
 * day, so a missed night, a failed run or a deleted visit is filled in next time. Existing
 * visits are skipped by generation, so re-running is idempotent.
 *
 * - FIXED_DAYS: today .. today + horizonDays (the far edge the old daily job generated).
 * - CALENDAR_MONTH: today .. end of the month containing today + horizonDays (whole months,
 *   never less than the horizon).
 */
export type RotaCatchUpWindow = { fromDate: string; toDate: string };

/** generateSchedule rejects ranges whose span exceeds 31 days; chunks stay ≤ 31 days inclusive. */
export const ROTA_CATCHUP_MAX_CHUNK_DAYS = 31;

export function resolveRollingRotaCatchUpWindow(
  todayIso: string,
  mode: RotaHorizonMode,
  horizonDays: number,
): RotaCatchUpWindow {
  const horizon = clampRotaHorizonDays(horizonDays);
  const edge = addDaysToIsoDate(todayIso, horizon);
  return {
    fromDate: todayIso,
    toDate: mode === 'CALENDAR_MONTH' ? endOfMonthIsoDate(edge) : edge,
  };
}

/** Splits an inclusive ISO date range into consecutive chunks of at most `maxDays` days. */
export function chunkIsoDateRange(
  fromIso: string,
  toIso: string,
  maxDays = ROTA_CATCHUP_MAX_CHUNK_DAYS,
): RotaCatchUpWindow[] {
  const from = parseIsoDateUtc(fromIso);
  const to = parseIsoDateUtc(toIso);
  if (!from || !to || to.getTime() < from.getTime()) return [];
  const size = Math.max(1, Math.floor(maxDays));
  const chunks: RotaCatchUpWindow[] = [];
  let start = fromIso;
  while (parseIsoDateUtc(start)!.getTime() <= to.getTime()) {
    const candidateEnd = addDaysToIsoDate(start, size - 1);
    const end =
      parseIsoDateUtc(candidateEnd)!.getTime() > to.getTime()
        ? toIso
        : candidateEnd;
    chunks.push({ fromDate: start, toDate: end });
    start = addDaysToIsoDate(end, 1);
  }
  return chunks;
}

export type RotaPlanResult = {
  planId: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  skipReason?: string;
};

/**
 * One status per plan across all chunks: failed if any chunk failed, else success if any
 * chunk succeeded, else skipped (e.g. plan not ready).
 */
export function summarisePlanResults(results: RotaPlanResult[]): {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  failures: Array<{ planId: string; error: string }>;
} {
  const byPlan = new Map<
    string,
    { status: RotaPlanResult['status']; error?: string }
  >();
  for (const r of results) {
    const prev = byPlan.get(r.planId);
    if (!prev) {
      byPlan.set(r.planId, { status: r.status, error: r.error });
      continue;
    }
    if (r.status === 'failed')
      byPlan.set(r.planId, { status: 'failed', error: r.error });
    else if (r.status === 'success' && prev.status === 'skipped')
      byPlan.set(r.planId, { status: 'success' });
  }
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const failures: Array<{ planId: string; error: string }> = [];
  for (const [planId, v] of byPlan) {
    if (v.status === 'failed') {
      failed += 1;
      failures.push({
        planId,
        error: v.error ?? 'Could not generate schedule',
      });
    } else if (v.status === 'success') succeeded += 1;
    else skipped += 1;
  }
  return { processed: byPlan.size, succeeded, failed, skipped, failures };
}
