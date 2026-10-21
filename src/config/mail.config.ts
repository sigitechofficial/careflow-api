import { registerAs } from '@nestjs/config';

/**
 * Outbound email via SMTP (`MAIL_MODE=smtp`, e.g. Azure Communication Services).
 * `log` succeeds without sending (local/dev).
 */
export const mailConfig = registerAs('mail', () => {
  const host = (process.env.SMTP_HOST ?? '').trim();
  const rawMode = (process.env.MAIL_MODE ?? '').trim().toLowerCase();
  const mode =
    rawMode === 'smtp' || rawMode === 'log'
      ? rawMode
      : host
        ? 'smtp'
        : 'log';

  return {
    mode,
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: (process.env.SMTP_USER ?? '').trim() || undefined,
    pass: (process.env.SMTP_PASS ?? '').trim() || undefined,
    from:
      (process.env.MAIL_FROM ?? '').trim() ||
      'CareAdmin <noreply@careadmin.local>',
  };
});
