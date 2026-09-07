import { registerAs } from '@nestjs/config';

/**
 * Outbound email (SMTP). When SMTP_HOST is unset, MailService runs in `log` mode
 * (dev-friendly: logs the message and succeeds without sending).
 */
export const mailConfig = registerAs('mail', () => {
  const host = (process.env.SMTP_HOST ?? '').trim();
  const mode =
    (process.env.MAIL_MODE ?? '').trim().toLowerCase() ||
    (host ? 'smtp' : 'log');
  return {
    mode: mode === 'smtp' || mode === 'log' ? mode : 'log',
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
