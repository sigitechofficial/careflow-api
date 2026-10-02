import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  hashRefreshToken,
  refreshTokenMatches,
} from './refresh-token-hash.util';

describe('refresh-token-hash.util', () => {
  const jwt = new JwtService();
  const secret = 'test-refresh-secret';
  const sub = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

  async function twoTokensOfSameUser() {
    const older = await jwt.signAsync(
      { sub, iat: 1_790_000_000 },
      { secret, expiresIn: '7d' },
    );
    const newer = await jwt.signAsync(
      { sub, iat: 1_790_000_100 },
      { secret, expiresIn: '7d' },
    );
    return { older, newer };
  }

  it('same-user refresh JWTs share a >72-byte prefix (why bcrypt was unsafe)', async () => {
    const { older, newer } = await twoTokensOfSameUser();
    expect(older).not.toBe(newer);
    expect(older.slice(0, 72)).toBe(newer.slice(0, 72));
    // Demonstrates the original bug: bcrypt ignores bytes after 72, so the old token "matches".
    expect(await bcrypt.compare(older, await bcrypt.hash(newer, 4))).toBe(true);
  });

  it('rejects a different refresh token of the same user with an identical long prefix', async () => {
    const { older, newer } = await twoTokensOfSameUser();
    expect(refreshTokenMatches(older, hashRefreshToken(newer))).toBe(false);
  });

  it('accepts the current refresh token', async () => {
    const { newer } = await twoTokensOfSameUser();
    const stored = hashRefreshToken(newer);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(refreshTokenMatches(newer, stored)).toBe(true);
  });

  it('rejects everything when the stored hash is null (logged out / password changed or reset)', async () => {
    const { newer } = await twoTokensOfSameUser();
    expect(refreshTokenMatches(newer, null)).toBe(false);
    expect(refreshTokenMatches(newer, undefined)).toBe(false);
    expect(refreshTokenMatches(newer, '')).toBe(false);
  });

  it('rejects legacy bcrypt hashes and empty tokens', async () => {
    const { newer } = await twoTokensOfSameUser();
    expect(refreshTokenMatches(newer, await bcrypt.hash(newer, 4))).toBe(false);
    expect(refreshTokenMatches('', hashRefreshToken(''))).toBe(false);
  });
});
