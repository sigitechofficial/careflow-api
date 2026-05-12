/** Security event type strings stored on `SecurityEvent.eventType`. */
export enum SecurityEventType {
  FAILED_LOGIN = 'failed_login',
  ACCOUNT_LOCKED = 'account_locked',
  PASSWORD_CHANGED = 'password_changed',
  PASSWORD_RESET_REQUESTED = 'password_reset_requested',
  PASSWORD_RESET_COMPLETED = 'password_reset_completed',
  ROLE_CHANGED = 'role_changed',
  PERMISSION_CHANGED = 'permission_changed',
  REFRESH_TOKEN_REUSED = 'refresh_token_reused',
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  MFA_DISABLED = 'mfa_disabled',
  SESSION_REVOKED = 'session_revoked',
}
