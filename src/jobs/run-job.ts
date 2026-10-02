/**
 * Run one scheduled job once and exit (Azure Container Apps Jobs):
 *
 *   node dist/src/jobs/run-job.js <job-name> [--period-key=<key>]
 *
 * Boots the Nest application context (no HTTP server) with CRON_MODE=external forced, runs the
 * job through JobRunner (source `container-job`, exactly-once per period), closes the app.
 * Exit code: 0 = success / skipped / already ran for this period, 1 = failed, 2 = bad usage.
 */
import './force-external-cron-mode';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { JobRunner } from './job-runner.service';
import { RUN_JOB_USAGE, exitCodeFor, parseRunJobArgs } from './run-job.args';

async function main(): Promise<number> {
  const logger = new Logger('run-job');
  const args = parseRunJobArgs(process.argv.slice(2));
  if ('error' in args) {
    logger.error(`${args.error}. ${RUN_JOB_USAGE}`);
    return 2;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  let code = 1;
  try {
    const result = await app.get(JobRunner).runByName(args.name, {
      source: 'container-job',
      periodKey: args.periodKey,
    });
    logger.log(
      `outcome=${result.outcome} status=${result.status ?? '-'} runId=${result.runId ?? '-'} ` +
        `periodKey=${result.periodKey} summary=${JSON.stringify(result.summary ?? {})}`,
    );
    code = exitCodeFor(result.outcome);
  } catch (err) {
    logger.error(
      `run-job crashed: ${err instanceof Error ? err.message : String(err)}`,
    );
    code = 1;
  } finally {
    await app.close().catch(() => undefined);
  }
  return code;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
