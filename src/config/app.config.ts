import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  swaggerTitle: process.env.SWAGGER_TITLE ?? 'CareAdmin API',
  swaggerDescription: process.env.SWAGGER_DESCRIPTION ?? 'CareAdmin backend API',
  swaggerVersion: process.env.SWAGGER_VERSION ?? '1.0.0',
  swaggerPath: process.env.SWAGGER_PATH ?? 'api/docs',
  uploadMaxFileSizeBytes: (() => {
    const fromMb = Number(process.env.MAX_UPLOAD_FILE_SIZE_MB ?? 10) * 1024 * 1024;
    const explicit = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 0);
    if (explicit > 0) return explicit;
    return Number.isFinite(fromMb) && fromMb > 0 ? fromMb : 10_485_760;
  })(),
  uploadBasePath: process.env.UPLOAD_BASE_PATH ?? 'uploads',
  /** Sliding window for default IP rate limit (milliseconds). */
  throttleTtlMs: Number(process.env.RATE_LIMIT_TTL_MS ?? 60_000),
  /** Max requests per IP per window (global default). */
  throttleLimit: Number(process.env.RATE_LIMIT_MAX ?? 200),
  /** Node HTTP server: max time to receive the full request (ms). */
  httpRequestTimeoutMs: Number(process.env.HTTP_REQUEST_TIMEOUT_MS ?? 120_000),
}));

