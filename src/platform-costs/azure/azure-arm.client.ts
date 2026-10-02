import { DefaultAzureCredential } from '@azure/identity';

export const ARM_BASE_URL = 'https://management.azure.com';
export const ARM_TOKEN_SCOPE = 'https://management.azure.com/.default';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ArmTokenProvider {
  getToken(): Promise<string>;
}

/** DefaultAzureCredential: managed identity (AZURE_CLIENT_ID) on Azure, `az login` locally. */
export class DefaultArmTokenProvider implements ArmTokenProvider {
  private credential: DefaultAzureCredential | null = null;

  async getToken(): Promise<string> {
    if (!this.credential) this.credential = new DefaultAzureCredential();
    const token = await this.credential.getToken(ARM_TOKEN_SCOPE);
    if (!token?.token)
      throw new AzureApiError('Could not obtain an Azure access token', 0);
    return token.token;
  }
}

export class AzureApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'AzureApiError';
  }
}

export type AzureArmClientOptions = {
  tokenProvider: ArmTokenProvider;
  fetchImpl?: FetchLike;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Retries after the first attempt (429 / 5xx / timeout). */
  maxRetries?: number;
  /** Upper bound for a single retry-after wait. */
  maxRetryWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Cost Management throttles with 429 + `x-ms-ratelimit-microsoft.costmanagement-*-retry-after`
 * (seconds). Use the largest retry-after hint present; fall back to `retry-after`.
 */
export function retryAfterMs(headers: Headers): number | null {
  let best: number | null = null;
  headers.forEach((value, name) => {
    const n = name.toLowerCase();
    if (!n.endsWith('retry-after')) return;
    const seconds = Number(value);
    let ms: number | null = null;
    if (Number.isFinite(seconds)) {
      ms = Math.max(0, seconds * 1000);
    } else {
      const at = Date.parse(value);
      if (Number.isFinite(at)) ms = Math.max(0, at - Date.now());
    }
    if (ms !== null && (best === null || ms > best)) best = ms;
  });
  return best;
}

/**
 * Minimal read-only Azure Resource Manager client (plain fetch, no SDK).
 * Callers only issue GETs and the read-only Cost Management POST query/forecast.
 */
export class AzureArmClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxRetryWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: AzureArmClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.maxRetryWaitMs = opts.maxRetryWaitMs ?? 120_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private toUrl(pathOrUrl: string): string {
    if (/^https:\/\//i.test(pathOrUrl)) {
      const u = new URL(pathOrUrl);
      if (u.host.toLowerCase() !== 'management.azure.com') {
        throw new AzureApiError(`Refusing to call non-ARM host ${u.host}`, 0);
      }
      return pathOrUrl;
    }
    return `${ARM_BASE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }

  async get<T>(pathOrUrl: string): Promise<T> {
    return this.request<T>('GET', pathOrUrl);
  }

  /** Only for read-only POST endpoints (Cost Management query / forecast). */
  async postQuery<T>(pathOrUrl: string, body: unknown): Promise<T> {
    return this.request<T>('POST', pathOrUrl, body);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    pathOrUrl: string,
    body?: unknown,
  ): Promise<T> {
    const url = this.toUrl(pathOrUrl);
    let attempt = 0;
    for (;;) {
      const token = await this.opts.tokenProvider.getToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const aborted = err instanceof Error && err.name === 'AbortError';
        if (attempt < this.maxRetries) {
          attempt += 1;
          await this.sleep(this.backoffMs(attempt));
          continue;
        }
        throw new AzureApiError(
          aborted
            ? `Azure request timed out after ${this.timeoutMs} ms`
            : `Azure request failed: ${err instanceof Error ? err.message : String(err)}`,
          0,
        );
      }
      clearTimeout(timer);

      if (res.ok) {
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      }

      if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
        attempt += 1;
        const hinted = retryAfterMs(res.headers);
        const wait = Math.min(
          hinted ?? this.backoffMs(attempt),
          this.maxRetryWaitMs,
        );
        await this.sleep(wait);
        continue;
      }

      let code: string | undefined;
      let message = `Azure ${method} ${new URL(url).pathname} failed with HTTP ${res.status}`;
      try {
        const payload = (await res.json()) as {
          error?: { code?: string; message?: string };
        };
        code = payload?.error?.code;
        if (payload?.error?.message) message += `: ${payload.error.message}`;
      } catch {
        // non-JSON error body
      }
      throw new AzureApiError(message, res.status, code);
    }
  }

  private backoffMs(attempt: number): number {
    return Math.min(1000 * 2 ** (attempt - 1), 30_000);
  }
}
