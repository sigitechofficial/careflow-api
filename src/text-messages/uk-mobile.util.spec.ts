import { firstUkMobile, maskMobile, normaliseUkMobile } from './uk-mobile.util';

describe('normaliseUkMobile', () => {
  it.each([
    ['07700 900123', '+447700900123'],
    ['+44 7700 900123', '+447700900123'],
    ['0044 7700 900123', '+447700900123'],
    ['447700900123', '+447700900123'],
    ['(07700) 900-123', '+447700900123'],
    ['+44 (0)7700 900123', '+447700900123'],
    ['07624 123456', '+447624123456'],
  ])('accepts %s', (raw, e164) => expect(normaliseUkMobile(raw)).toBe(e164));

  it.each([
    ['01632 960001'],
    ['020 7946 0000'],
    ['07012 345678'],
    ['07623 456789'],
    ['0770090012'],
    ['077009001234'],
    ['+33 6 12 34 56 78'],
    ['call 07700 900123'],
    [''],
  ])('refuses %s', (raw) => expect(normaliseUkMobile(raw)).toBeNull());

  it('refuses nothing at all', () => expect(normaliseUkMobile(null)).toBeNull());

  it('masks a number for logs', () => expect(maskMobile('+447700900123')).toBe('07*** ***123'));

  it('takes the first UK mobile of several numbers', () =>
    expect(firstUkMobile('01632 960001', null, '07700 900123')).toBe('+447700900123'));
});
