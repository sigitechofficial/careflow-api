import { BadRequestException } from '@nestjs/common';
import {
  cleanStringList,
  dateOnlyToIso,
  optionalText,
  parseDateOnly,
} from './date-only.util';

describe('date-only.util', () => {
  it('round-trips YYYY-MM-DD through a UTC-midnight Date', () => {
    const d = parseDateOnly('2004-06-01');
    expect(d).toEqual(new Date('2004-06-01T00:00:00.000Z'));
    expect(dateOnlyToIso(d as Date)).toBe('2004-06-01');
    expect(dateOnlyToIso(null)).toBeNull();
  });

  it('undefined leaves unchanged, null / blank clears, invalid is a 400', () => {
    expect(parseDateOnly(undefined)).toBeUndefined();
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly('  ')).toBeNull();
    expect(() => parseDateOnly('2004-02-30', 'incorporationDate')).toThrow(
      BadRequestException,
    );
    expect(() => parseDateOnly('01/06/2004')).toThrow(BadRequestException);
  });

  it('optionalText and cleanStringList', () => {
    expect(optionalText(undefined)).toBeUndefined();
    expect(optionalText(null)).toBeNull();
    expect(optionalText('  ')).toBeNull();
    expect(optionalText(' x ')).toBe('x');
    expect(cleanStringList(undefined)).toBeUndefined();
    expect(cleanStringList([' 86900 ', '', '86900', '87100'])).toEqual([
      '86900',
      '87100',
    ]);
  });
});
