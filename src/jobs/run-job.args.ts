import {
  JOB_NAMES,
  PERIOD_KEY_PATTERN,
  isJobName,
  type JobName,
} from './job-catalogue';

export type RunJobArgs = { name: JobName; periodKey?: string };

export const RUN_JOB_USAGE = `Usage: node dist/src/jobs/run-job.js <${JOB_NAMES.join('|')}> [--period-key=<key>]`;

export function parseRunJobArgs(
  argv: string[],
): RunJobArgs | { error: string } {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const flag = argv.find((a) => a.startsWith('--period-key='));
  const name = positional[0];
  if (!name) return { error: 'Missing job name' };
  if (!isJobName(name)) return { error: `Unknown job "${name}"` };
  const periodKey = flag ? flag.slice('--period-key='.length) : undefined;
  if (periodKey !== undefined && !PERIOD_KEY_PATTERN.test(periodKey)) {
    return { error: `Invalid --period-key "${periodKey}"` };
  }
  return { name, periodKey };
}

/** 0 = success / skipped / already ran for this period; 1 = failed. */
export function exitCodeFor(outcome: 'ran' | 'already-ran' | 'failed'): number {
  return outcome === 'failed' ? 1 : 0;
}
