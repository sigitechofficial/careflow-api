import { parseOptionalBoolean } from './optional-boolean-query.transform';

describe('parseOptionalBoolean', () => {
  it('keeps real booleans', () => {
    expect(parseOptionalBoolean(true)).toBe(true);
    expect(parseOptionalBoolean(false)).toBe(false);
  });

  it('parses query-string false without treating it as true', () => {
    expect(parseOptionalBoolean('false')).toBe(false);
    expect(parseOptionalBoolean('FALSE')).toBe(false);
    expect(parseOptionalBoolean('0')).toBe(false);
    expect(parseOptionalBoolean('no')).toBe(false);
  });

  it('parses query-string true', () => {
    expect(parseOptionalBoolean('true')).toBe(true);
    expect(parseOptionalBoolean('1')).toBe(true);
    expect(parseOptionalBoolean('yes')).toBe(true);
  });

  it('treats empty as unset', () => {
    expect(parseOptionalBoolean(undefined)).toBeUndefined();
    expect(parseOptionalBoolean(null)).toBeUndefined();
    expect(parseOptionalBoolean('')).toBeUndefined();
  });
});
