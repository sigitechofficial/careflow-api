import { rightToWorkExpiry } from './employee-absences.service';

describe('rightToWorkExpiry', () => {
  it('uses the latest expiry held in Right to Work compliance', () => {
    expect(
      rightToWorkExpiry([{ expiryDate: new Date('2027-03-01') }, { expiryDate: new Date('2028-06-30') }, { expiryDate: null }], '2025-01-01'),
    ).toEqual({ value: '2028-06-30', fromCompliance: true });
  });
  it('keeps an older typed value only when compliance has none', () => {
    expect(rightToWorkExpiry([], ' 01/02/2026 ')).toEqual({ value: '01/02/2026', fromCompliance: false });
    expect(rightToWorkExpiry([{ expiryDate: null }], null)).toEqual({ value: null, fromCompliance: false });
  });
});
