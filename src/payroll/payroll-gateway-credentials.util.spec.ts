import {
  encryptGatewayPassword,
  gatewayCredentialsPublicFlags,
  normalizeHmrcEnvironment,
  resolveActiveGatewayCredentials,
  resolveGatewayCredentialsForEnvironment,
} from './payroll-gateway-credentials.util';

describe('payroll-gateway-credentials.util', () => {
  it('normalizes environment to TEST or LIVE', () => {
    expect(normalizeHmrcEnvironment('LIVE')).toBe('LIVE');
    expect(normalizeHmrcEnvironment('TEST')).toBe('TEST');
    expect(normalizeHmrcEnvironment('weird')).toBe('TEST');
    expect(normalizeHmrcEnvironment(null)).toBe('TEST');
  });

  it('exposes flags without password ciphertext', () => {
    const enc = encryptGatewayPassword('secret-password');
    const flags = gatewayCredentialsPublicFlags({
      activeHmrcEnvironment: 'TEST',
      gatewayTestUserId: 'gateway-user',
      gatewayTestPasswordEnc: enc,
      gatewayLiveUserId: null,
      gatewayLivePasswordEnc: null,
      gatewayCredentialsUpdatedAt: new Date('2026-08-07T10:00:00.000Z'),
    });
    expect(flags.hasTestPassword).toBe(true);
    expect(flags.hasLivePassword).toBe(false);
    expect(flags.gatewayCredentialsReady).toBe(true);
    expect(flags.gatewayTestUserId).toBe('gateway-user');
    expect(JSON.stringify(flags)).not.toContain('secret-password');
    expect(JSON.stringify(flags)).not.toContain(enc);
  });

  it('decrypts active credentials for submit helper', () => {
    const enc = encryptGatewayPassword('test-pass-1');
    const resolved = resolveActiveGatewayCredentials({
      activeHmrcEnvironment: 'TEST',
      gatewayTestUserId: 'u1',
      gatewayTestPasswordEnc: enc,
      gatewayLiveUserId: 'live-u',
      gatewayLivePasswordEnc: encryptGatewayPassword('live-pass'),
      gatewayCredentialsUpdatedAt: null,
    });
    expect(resolved.environment).toBe('TEST');
    expect(resolved.userId).toBe('u1');
    expect(resolved.password).toBe('test-pass-1');
    expect(resolved.ready).toBe(true);
  });

  it('resolves LIVE vault independently of active environment (T18)', () => {
    const resolved = resolveGatewayCredentialsForEnvironment(
      {
        activeHmrcEnvironment: 'TEST',
        gatewayTestUserId: 'u1',
        gatewayTestPasswordEnc: encryptGatewayPassword('test-pass'),
        gatewayLiveUserId: 'live-u',
        gatewayLivePasswordEnc: encryptGatewayPassword('live-pass'),
        gatewayCredentialsUpdatedAt: null,
      },
      'LIVE',
    );
    expect(resolved.environment).toBe('LIVE');
    expect(resolved.userId).toBe('live-u');
    expect(resolved.password).toBe('live-pass');
  });
});
