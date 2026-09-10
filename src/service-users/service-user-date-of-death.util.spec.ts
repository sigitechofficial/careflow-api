import { describe, expect, it } from 'vitest';
import { parseServiceUserDateOfDeath } from './service-user-date-of-death.util';

describe('parseServiceUserDateOfDeath', () => {
  it('parses YYYY-MM-DD at UTC noon', () => {
    expect(parseServiceUserDateOfDeath('2026-03-15')?.toISOString()).toBe(
      '2026-03-15T12:00:00.000Z',
    );
  });

  it('returns null for empty or invalid', () => {
    expect(parseServiceUserDateOfDeath('')).toBeNull();
    expect(parseServiceUserDateOfDeath('not-a-date')).toBeNull();
  });
});
