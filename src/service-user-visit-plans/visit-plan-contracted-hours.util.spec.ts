import { BadRequestException } from '@nestjs/common';
import {
  assertWeeklyContractedHoursForCreate,
  parseWeeklyContractedHours,
} from './visit-plan-contracted-hours.util';

describe('visit-plan-contracted-hours.util', () => {
  it('parseWeeklyContractedHours accepts decimals and zero', () => {
    expect(parseWeeklyContractedHours('10.5')).toBe(10.5);
    expect(parseWeeklyContractedHours('0')).toBe(0);
  });

  it('parseWeeklyContractedHours rejects empty and invalid', () => {
    expect(parseWeeklyContractedHours('')).toBeNull();
    expect(parseWeeklyContractedHours(null)).toBeNull();
    expect(parseWeeklyContractedHours('abc')).toBeNull();
  });

  it('assertWeeklyContractedHoursForCreate requires a value', () => {
    expect(() => assertWeeklyContractedHoursForCreate('')).toThrow(BadRequestException);
    expect(() => assertWeeklyContractedHoursForCreate(null)).toThrow(BadRequestException);
    expect(assertWeeklyContractedHoursForCreate('14')).toBe('14');
    expect(assertWeeklyContractedHoursForCreate(' 10.5 ')).toBe('10.5');
  });
});
