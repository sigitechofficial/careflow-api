import { registerAs } from '@nestjs/config';

/**
 * Outbound email.
 * - `acs`: Azure Communication Services Email (ACS_ENDPOINT), authenticated with Microsoft
 *   Entra ID — the container's managed identity on Azure, your `az login` locally. No secret.
 * - `api`: ZeptoMail HTTP API. `smtp`: optional fallback. `log`: no send (local/dev).
 * MAIL_REDIRECT_TO sends every email to one inbox instead of the real recipients — a laptop
 * safety net; ignored when NODE_ENV=production.
 */
export const mailConfig = registerAs('mail', () => {
  const apiUrl =
    (process.env.MAIL_API_URL ?? process.env.ZEPTOMAIL_API_URL ?? '')
      .trim() || 'https://api.zeptomail.com/v1.1/email';
  const apiToken = (
    process.env.MAIL_API_TOKEN ??
    process.env.ZEPTOMAIL_API_TOKEN ??
    process.env.SMTP_PASS ??
    ''
  ).trim();
  const host = (process.env.SMTP_HOST ?? '').trim();
  const rawMode = (process.env.MAIL_MODE ?? '').trim().toLowerCase();
  const mode =
    rawMode === 'acs' ||
    rawMode === 'api' ||
    rawMode === 'smtp' ||
    rawMode === 'log'
      ? rawMode
      : apiToken
        ? 'api'
        : host
          ? 'smtp'
          : 'log';

  return {
    mode,
    apiUrl,
    apiToken: apiToken || undefined,
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: (process.env.SMTP_USER ?? '').trim() || undefined,
    pass: (process.env.SMTP_PASS ?? '').trim() || undefined,
    from:
      (process.env.MAIL_FROM ?? '').trim() ||
      'CareAdmin <noreply@careadmin.local>',
    acsEndpoint: (process.env.ACS_ENDPOINT ?? '').trim() || undefined,
    redirectTo:
      process.env.NODE_ENV === 'production'
        ? undefined
        : (process.env.MAIL_REDIRECT_TO ?? '').trim() || undefined,
  };
});
