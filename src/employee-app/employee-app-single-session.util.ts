/** Block a second Care-app login while the current session is still considered live. */
export const EMPLOYEE_APP_SESSION_STALE_MS = 24 * 60 * 60 * 1000;

export const EMPLOYEE_APP_SESSION_BLOCK_MESSAGE =
  'This account is already signed in on another device. Sign out there, or ask the office to sign out the session.';

export function isEmployeeAppSessionStale(
  input: { lastSeenAt: Date | null; lastLoginAt: Date | null },
  now = new Date(),
): boolean {
  const at = input.lastSeenAt ?? input.lastLoginAt;
  if (!at) return true;
  return now.getTime() - at.getTime() >= EMPLOYEE_APP_SESSION_STALE_MS;
}

export function shouldBlockSecondEmployeeAppLogin(
  input: {
    policyEnabled: boolean;
    hasRefreshToken: boolean;
    lastSeenAt: Date | null;
    lastLoginAt: Date | null;
    pushTokensDead: boolean;
  },
  now = new Date(),
): boolean {
  if (!input.policyEnabled) return false;
  if (!input.hasRefreshToken) return false;
  if (input.pushTokensDead) return false;
  if (isEmployeeAppSessionStale(input, now)) return false;
  return true;
}
