/**
 * The Whisper worker (WHISPER_MODE=azure-job), run by the Whisper Container Apps Job:
 *
 *   node dist/src/initial-assessments/run-transcription-worker.js
 *
 * Boots the Nest application context (no HTTP server, in-process crons idle), transcribes every
 * queued Initial Assessment recording, then exits. The API starts one execution per upload.
 * Exit code: 0 = queue handled (failed transcriptions are recorded on the job, not a crash), 1 = crashed.
 */
import '../jobs/force-external-cron-mode';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TranscriptionWorker } from './transcription-worker.service';

async function main(): Promise<number> {
  const logger = new Logger('transcription-worker');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  let code = 1;
  try {
    const summary = await app.get(TranscriptionWorker).runPending();
    logger.log(`done=${summary.done} failed=${summary.failed}`);
    code = 0;
  } catch (err) {
    logger.error(
      `transcription worker crashed: ${err instanceof Error ? err.message : String(err)}`,
    );
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
