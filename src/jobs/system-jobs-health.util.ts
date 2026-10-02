export type JobHealth = 'ok' | 'late' | 'failing' | 'never-run' | 'running';

/** Extra allowance for daily jobs on top of 2x the expected interval. */
export const DAILY_LATE_GRACE_MINUTES = 15;

export type JobHealthInput = {
  /** Most recent run of any status. */
  lastRun: { status: string } | null;
  /** Status of the most recent run that has finished (not `running`). */
  lastFinishedStatus: string | null;
  /** Most recent finished run that did not fail (`success` or `skipped`). */
  lastSuccessAt: Date | null;
  expectedIntervalMinutes: number;
  daily: boolean;
  now: Date;
};

/**
 * Admin health badge, in priority order:
 * never-run (no runs) → running (a run is in progress) → failing (last finished run failed)
 * → late (no success/skipped run within 2x the expected interval, +15 min for daily jobs) → ok.
 */
export function computeJobHealth(input: JobHealthInput): JobHealth {
  if (!input.lastRun) return 'never-run';
  if (input.lastRun.status === 'running') return 'running';
  if (input.lastFinishedStatus === 'failed') return 'failing';
  const allowanceMs =
    (2 * input.expectedIntervalMinutes +
      (input.daily ? DAILY_LATE_GRACE_MINUTES : 0)) *
    60_000;
  if (
    !input.lastSuccessAt ||
    input.now.getTime() - input.lastSuccessAt.getTime() > allowanceMs
  ) {
    return 'late';
  }
  return 'ok';
}

/** Share of finished runs in the window that did not fail, as a percentage (1 dp); null if none. */
export function successRatePercent(
  finished: number,
  failed: number,
): number | null {
  if (finished <= 0) return null;
  return Math.round(((finished - failed) / finished) * 1000) / 10;
}
