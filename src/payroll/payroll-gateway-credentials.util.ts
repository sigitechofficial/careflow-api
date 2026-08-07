import { decryptFieldValue, encryptFieldValue } from '../common/utils/field-encryption.util';

export type HmrcGatewayEnvironment = 'TEST' | 'LIVE';

export type GatewayCredentialRow = {
  activeHmrcEnvironment: string;
  gatewayTestUserId: string | null;
  gatewayTestPasswordEnc: string | null;
  gatewayLiveUserId: string | null;
  gatewayLivePasswordEnc: string | null;
  gatewayCredentialsUpdatedAt: Date | null;
};

export function normalizeHmrcEnvironment(value: string | null | undefined): HmrcGatewayEnvironment {
  return value === 'LIVE' ? 'LIVE' : 'TEST';
}

export function encryptGatewayPassword(plain: string): string {
  return encryptFieldValue(plain);
}

/** Internal only — for T16 submit. Never expose via HTTP. */
export function decryptGatewayPassword(enc: string | null | undefined): string | null {
  if (!enc) return null;
  return decryptFieldValue(enc);
}

export function gatewayCredentialsPublicFlags(row: GatewayCredentialRow) {
  const env = normalizeHmrcEnvironment(row.activeHmrcEnvironment);
  const hasTestPassword = Boolean(row.gatewayTestPasswordEnc);
  const hasLivePassword = Boolean(row.gatewayLivePasswordEnc);
  const activeUserId =
    env === 'LIVE' ? row.gatewayLiveUserId?.trim() || null : row.gatewayTestUserId?.trim() || null;
  const activeHasPassword = env === 'LIVE' ? hasLivePassword : hasTestPassword;
  return {
    activeHmrcEnvironment: env,
    gatewayTestUserId: row.gatewayTestUserId?.trim() || null,
    gatewayLiveUserId: row.gatewayLiveUserId?.trim() || null,
    hasTestPassword,
    hasLivePassword,
    gatewayCredentialsUpdatedAt: row.gatewayCredentialsUpdatedAt?.toISOString() ?? null,
    /** Active env has both user ID and a stored password (ready for T16 once wired). */
    gatewayCredentialsReady: Boolean(activeUserId && activeHasPassword),
  };
}

/** Resolve plaintext credentials for the active environment (T16). */
export function resolveActiveGatewayCredentials(row: GatewayCredentialRow): {
  environment: HmrcGatewayEnvironment;
  userId: string | null;
  password: string | null;
  ready: boolean;
} {
  return resolveGatewayCredentialsForEnvironment(
    row,
    normalizeHmrcEnvironment(row.activeHmrcEnvironment),
  );
}

/** Resolve plaintext credentials for a specific TEST/LIVE vault (T18). */
export function resolveGatewayCredentialsForEnvironment(
  row: GatewayCredentialRow,
  environment: HmrcGatewayEnvironment,
): {
  environment: HmrcGatewayEnvironment;
  userId: string | null;
  password: string | null;
  ready: boolean;
} {
  const userId =
    environment === 'LIVE'
      ? row.gatewayLiveUserId?.trim() || null
      : row.gatewayTestUserId?.trim() || null;
  const password = decryptGatewayPassword(
    environment === 'LIVE' ? row.gatewayLivePasswordEnc : row.gatewayTestPasswordEnc,
  );
  return {
    environment,
    userId,
    password,
    ready: Boolean(userId && password),
  };
}
