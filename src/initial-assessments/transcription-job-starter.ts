import { Injectable } from '@nestjs/common';
import {
  ARM_BASE_URL,
  AzureApiError,
  DefaultArmTokenProvider,
  type ArmTokenProvider,
  type FetchLike,
} from '../platform-costs/azure/azure-arm.client';

/**
 * Where transcriptions run:
 * - `local` (default): Whisper runs inside the API process, jobs kept in memory (VPS / developer machines).
 * - `azure-job`: jobs are queued in the database and a separate Container Apps Job (the Whisper worker
 *   image) is started for them; it scales to zero when there is nothing to transcribe.
 */
export type TranscriptionMode = 'local' | 'azure-job';

export function transcriptionMode(): TranscriptionMode {
  return (process.env.WHISPER_MODE ?? '').trim().toLowerCase() === 'azure-job'
    ? 'azure-job'
    : 'local';
}

const JOB_RESOURCE_ID =
  /^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.App\/jobs\/[^/]+$/i;
const JOBS_API_VERSION = '2024-03-01';

/** WHISPER_JOB_RESOURCE_ID, checked to be a Container Apps Job resource id. */
export function whisperJobResourceId(
  value = process.env.WHISPER_JOB_RESOURCE_ID,
): string {
  const id = (value ?? '').trim();
  if (!JOB_RESOURCE_ID.test(id)) {
    throw new Error(
      'WHISPER_JOB_RESOURCE_ID must be the Container Apps Job resource id ' +
        '(/subscriptions/<id>/resourceGroups/<rg>/providers/Microsoft.App/jobs/<name>)',
    );
  }
  return id;
}

/**
 * Starts one execution of the Whisper Container Apps Job (ARM `jobs/start`), signed in as the API's
 * managed identity. The execution processes every queued transcription and exits, so starting it
 * more often than needed is harmless.
 */
@Injectable()
export class TranscriptionJobStarter {
  /** Replaced in tests. */
  tokens: ArmTokenProvider = new DefaultArmTokenProvider();
  fetchImpl: FetchLike = (url, init) => fetch(url, init);

  async start(): Promise<string | null> {
    const url = `${ARM_BASE_URL}${whisperJobResourceId()}/start?api-version=${JOBS_API_VERSION}`;
    const token = await this.tokens.getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        let detail = '';
        try {
          const body = (await res.json()) as { error?: { code?: string } };
          detail = body?.error?.code ? ` (${body.error.code})` : '';
        } catch {
          // non-JSON error body
        }
        throw new AzureApiError(
          `Starting the Whisper job failed with HTTP ${res.status}${detail}`,
          res.status,
        );
      }
      const text = await res.text();
      return text
        ? ((JSON.parse(text) as { name?: string }).name ?? null)
        : null;
    } finally {
      clearTimeout(timer);
    }
  }
}
