import { registerAs } from '@nestjs/config';

/**
 * Outbound email.
 * - `acs`: Azure Communication Services Email (ACS_ENDPOINT), authenticated with Microsoft
 *   Entra ID — the container's managed identity on Azure, your `az login` locally. No secret.
 * - `api`: ZeptoMail HTTP API. `smtp`: optional fallback. `log`: no send (local/dev).
 * MAIL_REDIRECT_TO sends every email to one inbox instead of the real recipients — a laptop
 * safety net; ignored when NODE_ENV=production.
 */
/** Used only outside production when MAIL_FROM is unset (local log mode). */
export const LOCAL_FALLBACK_MAIL_FROM = 'CareAdmin <noreply@careadmin.local>';

export type MailMode = 'acs' | 'api' | 'smtp' | 'log';

/** Which transport is active — same rule for the mail config and env validation. */
export function resolveMailMode(env: Record<string, unknown>): MailMode {
  const str = (k: string) => {
    const v = env[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const rawMode = str('MAIL_MODE').toLowerCase();
  if (
    rawMode === 'acs' ||
    rawMode === 'api' ||
    rawMode === 'smtp' ||
    rawMode === 'log'
  ) {
    return rawMode;
  }
  const apiToken =
    str('MAIL_API_TOKEN') || str('ZEPTOMAIL_API_TOKEN') || str('SMTP_PASS');
  if (apiToken) return 'api';
  return str('SMTP_HOST') ? 'smtp' : 'log';
}

export const mailConfig = registerAs('mail', () => {
  const apiUrl =
    (process.env.MAIL_API_URL ?? process.env.ZEPTOMAIL_API_URL ?? '').trim() ||
    'https://api.zeptomail.com/v1.1/email';
  const apiToken = (
    process.env.MAIL_API_TOKEN ??
    process.env.ZEPTOMAIL_API_TOKEN ??
    process.env.SMTP_PASS ??
    ''
  ).trim();
  const host = (process.env.SMTP_HOST ?? '').trim();
  const mode = resolveMailMode(process.env);

  return {
    mode,
    apiUrl,
    apiToken: apiToken || undefined,
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: (process.env.SMTP_USER ?? '').trim() || undefined,
    pass: (process.env.SMTP_PASS ?? '').trim() || undefined,
    // Sender comes only from MAIL_FROM (e.g. "Allfor Care <noreply@allforcare.co.uk>").
    // Production requires it (env validation); the fallback is for local log mode only.
    from:
      (process.env.MAIL_FROM ?? '').trim() ||
      (process.env.NODE_ENV === 'production' ? '' : LOCAL_FALLBACK_MAIL_FROM),
    acsEndpoint: (process.env.ACS_ENDPOINT ?? '').trim() || undefined,
    // Optional Entra app used only for email (servers with no managed identity, e.g. the VPS).
    // Kept apart from AZURE_CLIENT_* so other Azure clients keep their own login.
    acsTenantId: (process.env.ACS_TENANT_ID ?? '').trim() || undefined,
    acsClientId: (process.env.ACS_CLIENT_ID ?? '').trim() || undefined,
    acsClientSecret: (process.env.ACS_CLIENT_SECRET ?? '').trim() || undefined,
    // MAIL_BCC: comma-separated addresses that get a silent copy of every email
    // (password-reset emails excluded).
    bcc: (process.env.MAIL_BCC ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
    redirectTo:
      process.env.NODE_ENV === 'production'
        ? undefined
        : (process.env.MAIL_REDIRECT_TO ?? '').trim() || undefined,
  };
});
