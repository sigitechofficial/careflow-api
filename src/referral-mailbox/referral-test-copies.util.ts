import { EMAIL_RE } from './referral-reply-mime.util';

const isProduction = () =>
  (process.env.NODE_ENV ?? 'development') === 'production';

/**
 * Outside production only: extra people (REFERRAL_TEST_COPY_TO, comma-separated) who get a copy of every test
 * referral and of every reply, so testers can see what CareFlow read and sent. Empty in production.
 */
export function referralTestCopyAddresses(): string[] {
  if (isProduction()) return [];
  const list = (process.env.REFERRAL_TEST_COPY_TO ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter((x) => EMAIL_RE.test(x));
  return [...new Set(list)];
}

/**
 * Who may get a copy while testing: our own (@allforcare.co.uk) addresses, the mailbox itself and the
 * REFERRAL_TEST_COPY_TO addresses. Anyone may in production.
 */
export function mayGetCopy(
  address: string,
  mailboxAddress?: string | null,
): boolean {
  if (isProduction()) return true;
  const a = address.trim().toLowerCase();
  return (
    a.endsWith('@allforcare.co.uk') ||
    a === (mailboxAddress ?? '').trim().toLowerCase() ||
    referralTestCopyAddresses().includes(a)
  );
}
