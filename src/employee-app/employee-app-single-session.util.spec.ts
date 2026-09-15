import {
  isEmployeeAppSessionStale,
  shouldBlockSecondEmployeeAppLogin,
} from './employee-app-single-session.util';

const now = new Date('2026-09-15T12:00:00.000Z');
const recent = new Date('2026-09-15T11:00:00.000Z');
const stale = new Date('2026-09-14T11:00:00.000Z');

describe('employee-app-single-session.util', () => {
  it('treats missing timestamps as stale', () => {
    expect(isEmployeeAppSessionStale({ lastSeenAt: null, lastLoginAt: null }, now)).toBe(true);
  });

  it('uses lastLoginAt when lastSeenAt is missing', () => {
    expect(isEmployeeAppSessionStale({ lastSeenAt: null, lastLoginAt: recent }, now)).toBe(false);
    expect(isEmployeeAppSessionStale({ lastSeenAt: null, lastLoginAt: stale }, now)).toBe(true);
  });

  it('does not block when the policy is off or there is no refresh token', () => {
    expect(
      shouldBlockSecondEmployeeAppLogin(
        {
          policyEnabled: false,
          hasRefreshToken: true,
          lastSeenAt: recent,
          lastLoginAt: recent,
          pushTokensDead: false,
        },
        now,
      ),
    ).toBe(false);
    expect(
      shouldBlockSecondEmployeeAppLogin(
        {
          policyEnabled: true,
          hasRefreshToken: false,
          lastSeenAt: recent,
          lastLoginAt: recent,
          pushTokensDead: false,
        },
        now,
      ),
    ).toBe(false);
  });

  it('blocks a second login while the current session is live', () => {
    expect(
      shouldBlockSecondEmployeeAppLogin(
        {
          policyEnabled: true,
          hasRefreshToken: true,
          lastSeenAt: recent,
          lastLoginAt: recent,
          pushTokensDead: false,
        },
        now,
      ),
    ).toBe(true);
  });

  it('allows login when the session is stale or push tokens are dead', () => {
    expect(
      shouldBlockSecondEmployeeAppLogin(
        {
          policyEnabled: true,
          hasRefreshToken: true,
          lastSeenAt: stale,
          lastLoginAt: stale,
          pushTokensDead: false,
        },
        now,
      ),
    ).toBe(false);
    expect(
      shouldBlockSecondEmployeeAppLogin(
        {
          policyEnabled: true,
          hasRefreshToken: true,
          lastSeenAt: recent,
          lastLoginAt: recent,
          pushTokensDead: true,
        },
        now,
      ),
    ).toBe(false);
  });
});
