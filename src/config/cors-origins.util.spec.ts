import { corsOrigin, parseAllowedOrigins } from './cors-origins.util';

describe('parseAllowedOrigins', () => {
  it('splits, trims and drops trailing slashes and blanks', () => {
    expect(
      parseAllowedOrigins(' https://a.example.com/ , https://b.example.com,, '),
    ).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('is empty when unset', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe('corsOrigin', () => {
  it('uses the allow-list when ALLOWED_ORIGINS is set (any NODE_ENV)', () => {
    expect(
      corsOrigin({
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: 'https://app.example.com',
      }),
    ).toEqual(['https://app.example.com']);
    expect(
      corsOrigin({
        NODE_ENV: 'development',
        ALLOWED_ORIGINS: 'https://a.test',
      }),
    ).toEqual(['https://a.test']);
  });

  it('fails closed in production when no allow-list is configured', () => {
    expect(corsOrigin({ NODE_ENV: 'production' })).toBe(false);
    expect(corsOrigin({ NODE_ENV: 'production', ALLOWED_ORIGINS: ' , ' })).toBe(
      false,
    );
  });

  it('stays permissive outside production when unset (local dev unchanged)', () => {
    expect(corsOrigin({ NODE_ENV: 'development' })).toBe(true);
    expect(corsOrigin({})).toBe(true);
  });
});
