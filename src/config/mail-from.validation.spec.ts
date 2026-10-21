import { validateEnv } from './env.validation';
import { resolveMailMode } from './mail.config';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
  JWT_REFRESH_TOKEN_SECRET: 'b'.repeat(32),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('MAIL_FROM is required in production when email sending is on', () => {
  it('fails in production with MAIL_MODE=acs and no MAIL_FROM', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        MAIL_MODE: 'acs',
        ACS_ENDPOINT: 'https://x',
      }),
    ).toThrow(/MAIL_FROM is required in production/);
  });

  it('passes in production when MAIL_FROM is set', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        MAIL_MODE: 'acs',
        ACS_ENDPOINT: 'https://x',
        MAIL_FROM: 'Allfor Care <noreply@allforcare.co.uk>',
      }),
    ).not.toThrow(/MAIL_FROM/);
  });

  it('does not require MAIL_FROM in log mode or outside production', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', MAIL_MODE: 'log' }),
    ).not.toThrow(/MAIL_FROM/);
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'development', MAIL_MODE: 'acs' }),
    ).not.toThrow(/MAIL_FROM/);
  });

  it('resolves the transport the same way as the mail config', () => {
    expect(resolveMailMode({ MAIL_MODE: 'ACS' })).toBe('acs');
    expect(resolveMailMode({ MAIL_API_TOKEN: 't' })).toBe('api');
    expect(resolveMailMode({ SMTP_HOST: 'h' })).toBe('smtp');
    expect(resolveMailMode({})).toBe('log');
  });
});
